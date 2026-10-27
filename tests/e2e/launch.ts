// Launches the built app (dist/, so `pnpm build` first) as a user starts it,
// with a fresh profile of its own: never the real one. ATOM_E2E_EXECUTABLE
// runs a packaged build instead, e.g. pack/win-unpacked/YouTube Music.exe.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test';

export type PlayerBar = 'classic' | 'new';

const appPath = path.resolve(import.meta.dirname, '..', '..');

const APP_VERSION = (
  JSON.parse(readFileSync(path.join(appPath, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

/**
 * The track every test starts on, with the radio queue YTM builds from it so
 * next and previous have somewhere to go. It plays without signing in.
 */
export const TEST_VIDEO_ID = 'GtPLYvYeZ_4';
const TEST_URL = `https://music.youtube.com/watch?v=${TEST_VIDEO_ID}&list=RDAMVMm9SMT5ipbxk`;

/** How long the consent screen, YTM and the player get to load. */
const LOAD_TIMEOUT_MS = 45_000;
/**
 * How long the renderer gets to finish its startup once the player is up. Past
 * it the tests go on: the one on the startup reports the failure.
 */
const STARTUP_GRACE_MS = 15_000;
/** After pausing, a moment for YTM to settle before the window closes. */
const PAUSE_SETTLE_MS = 300;
/** app.close() can hang after media playback; past this the process is killed. */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Main-process channels the tests listen to: what the page tells the main
 * process, which the plugins and the system integrations act on.
 */
const RECORDED_CHANNELS = [
  'ytmd:player-api-loaded',
  'ytmd:time-changed',
  'ytmd:get-shuffle-response',
];

export interface LaunchOptions {
  /** Pins YTM's player bar (options.playerBar). */
  playerBar: PlayerBar;
  /** Plugin settings written to config.json, e.g. `{ downloader: { enabled: true } }`. */
  plugins?: Record<string, Record<string, unknown>>;
}

/**
 * The profile's config.json. Everything that reaches outside the app is off:
 * Discord, notifications, the tray, updates and start at login.
 */
function configFile({ playerBar, plugins = {} }: LaunchOptions) {
  return {
    'window-size': { width: 1130, height: 822 },
    'url': TEST_URL,
    'options': {
      tray: false,
      autoUpdates: false,
      startAtLogin: false,
      resumeOnStart: true,
      playerBar,
    },
    'plugins': {
      discord: { enabled: false },
      notifications: { enabled: false },
      ...plugins,
    },
    '__internal__': { migrations: { version: APP_VERSION } },
  };
}

/**
 * Launch the app with a new profile in ATOM_E2E_PROFILES (default: the
 * system's temporary folder), removed by closeApp.
 */
export async function launchApp(options: LaunchOptions) {
  const profiles = process.env.ATOM_E2E_PROFILES ?? tmpdir();
  mkdirSync(profiles, { recursive: true });
  const userData = mkdtempSync(path.join(profiles, 'atom-e2e-'));
  writeFileSync(
    path.join(userData, 'config.json'),
    JSON.stringify(configFile(options)),
  );

  // NODE_ENV=test turns the renderer sandbox on (src/index.ts), which the
  // preload does not run under: start the app as users do.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !(entry[0] === 'NODE_ENV' && entry[1] === 'test'),
    ),
  );

  const executablePath = process.env.ATOM_E2E_EXECUTABLE;
  const app = await electron.launch({
    executablePath,
    cwd: appPath,
    args: [
      ...(executablePath ? [] : [appPath]),
      `--user-data-dir=${userData}`,
      '--mute-audio',
      // GitHub's Linux runners can't start Chromium's sandbox and have no GPU.
      ...(process.env.CI && process.platform === 'linux'
        ? ['--no-sandbox', '--disable-gpu']
        : []),
    ],
    env,
  });

  const used = await app.evaluate(({ app }) => app.getPath('userData'));
  if (path.resolve(used) !== path.resolve(userData)) {
    await closeApp(Object.assign(app, { userData }));
    throw new Error(`The app ignored --user-data-dir and used ${used}`);
  }

  await app.evaluate(({ ipcMain }, channels) => {
    const messages: E2eIpcMessage[] = [];
    globalThis.__atomE2eIpc = messages;
    for (const channel of channels) {
      ipcMain.on(channel, (_event, ...args: unknown[]) => {
        messages.push({ channel, at: Date.now(), args });
      });
    }
  }, RECORDED_CHANNELS);

  return Object.assign(app, { userData });
}

export type AtomApp = Awaited<ReturnType<typeof launchApp>>;

export interface E2eIpcMessage {
  channel: string;
  /** Date.now() in the main process. */
  at: number;
  args: unknown[];
}

declare global {
  // The main process's record of RECORDED_CHANNELS.
  var __atomE2eIpc: E2eIpcMessage[] | undefined;
}

/**
 * Closes the app, pausing first (playing media can hold the window), kills it
 * if closing hangs, and removes its profile.
 */
export async function closeApp(app: AtomApp) {
  const child = app.process();
  if (child.exitCode === null && child.signalCode === null) {
    for (const page of app.windows()) {
      await page
        .evaluate(() => document.querySelector('video')?.pause())
        .catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, PAUSE_SETTLE_MS));
    const closed = app.close().then(
      () => true,
      () => true,
    );
    const timedOut = new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), CLOSE_TIMEOUT_MS),
    );
    if (!(await Promise.race([closed, timedOut])) && child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
  // Chromium's helper processes can hold the profile for a moment after exit.
  rmSync(app.userData, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  });
}

/**
 * The main window, on music.youtube.com. A new profile in the EU first gets
 * Google's consent screen: it is answered with "Reject all", whatever the
 * language (that form is the one with set_eom=true).
 */
export async function mainWindow(app: ElectronApplication) {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => dialog.accept().catch(() => {}));
  await page.waitForURL(/^https:\/\/(consent|music)\.youtube\.com\//, {
    timeout: LOAD_TIMEOUT_MS,
  });
  if (page.url().startsWith('https://consent.youtube.com/')) {
    await page
      .locator(
        'form[action="https://consent.youtube.com/save"]:has(input[name="set_eom"][value="true"]) button',
      )
      // The page repeats the form below the text.
      .first()
      .click({ timeout: LOAD_TIMEOUT_MS });
    await page.waitForURL(/^https:\/\/music\.youtube\.com\//, {
      timeout: LOAD_TIMEOUT_MS,
    });
  }
  await page.waitForFunction(
    () =>
      typeof document.querySelector<
        HTMLElement & { getPlayerState?: () => number }
      >('#movie_player')?.getPlayerState === 'function',
    undefined,
    { timeout: LOAD_TIMEOUT_MS },
  );
  // The renderer registers its handlers for the main process's controls, then
  // sends ytmd:player-api-loaded.
  const deadline = Date.now() + STARTUP_GRACE_MS;
  while (
    Date.now() < deadline &&
    (await ipcMessages(app, 'ytmd:player-api-loaded')).length === 0
  ) {
    await page.waitForTimeout(250);
  }
  return page;
}

/** Messages the page sent the main process on `channel` since `since` (main's Date.now()). */
export const ipcMessages = (
  app: ElectronApplication,
  channel: string,
  since = 0,
) =>
  app.evaluate(
    (_electron, [channel, since]) =>
      (globalThis.__atomE2eIpc ?? []).filter(
        (message) => message.channel === channel && message.at >= since,
      ),
    [channel, since] as const,
  );

/** Date.now() in the main process, to pass to ipcMessages. */
export const mainNow = (app: ElectronApplication) =>
  app.evaluate(() => Date.now());

/**
 * Runs a youtubemusic:// command the way a second launch with a link hands it
 * to the running app (src/index.ts, 'second-instance'). The command goes to
 * the song controls that the tray and the shortcuts call too.
 */
export const protocol = (app: ElectronApplication, command: string) =>
  app.evaluate(({ app }, command) => {
    app.emit(
      'second-instance',
      {},
      [process.execPath, `youtubemusic://${command}`],
      '',
    );
  }, command);

/** Sends the page a message from the main process, as the plugins and integrations do. */
export const sendToPage = (
  app: ElectronApplication,
  channel: string,
  ...args: unknown[]
) =>
  app.evaluate(
    ({ BrowserWindow }, [channel, args]) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(channel, ...args);
      }
    },
    [channel, args] as const,
  );
