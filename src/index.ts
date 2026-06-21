import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

import {
  BrowserWindow,
  app,
  screen,
  globalShortcut,
  session,
  shell,
  dialog,
  ipcMain,
  protocol,
  type BrowserWindowConstructorOptions,
} from 'electron';
import enhanceWebRequest, {
  type BetterSession,
} from '@jellybrick/electron-better-web-request';
import is from 'electron-is';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import { deepmerge } from 'deepmerge-ts';
import { deepEqual } from 'fast-equals';

import { allPlugins, mainPlugins } from 'virtual:plugins';

import { languageResources } from 'virtual:i18n';

import * as config from '@/config';

import { refreshMenu, setApplicationMenu } from '@/menu';
import { fileExists, injectCSS, injectCSSAsFile } from '@/plugins/utils/main';
import { isTesting } from '@/utils/testing';
import { setUpTray } from '@/tray';
import { setupSongInfo } from '@/providers/song-info';
import { restart, setupAppControls } from '@/providers/app-controls';
import {
  APP_PROTOCOL,
  handleProtocol,
  setupProtocolHandler,
} from '@/providers/protocol-handler';

import { globalStyles as youtubeMusicCSS } from '@/theme/global-styles';

import {
  forceLoadMainPlugin,
  forceUnloadMainPlugin,
  getAllLoadedMainPlugins,
  loadAllMainPlugins,
} from '@/loader/main';

import { LoggerPrefix } from '@/utils';
import { loadI18n, setLanguage, t } from '@/i18n';

import ErrorHtmlAsset from '@assets/error.html?asset';

import type { PluginConfig } from '@/types/plugins';

// Catch errors and log them
unhandled({
  logger: console.error,
  showDialog: false,
});

// Prevent window being garbage collected
let mainWindow: Electron.BrowserWindow | null;
autoUpdater.autoDownload = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'http',
    privileges: {
      standard: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  {
    scheme: 'https',
    privileges: {
      standard: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  { scheme: 'mailto', privileges: { standard: true } },
  { scheme: 'ytmd-local', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// https://github.com/electron/electron/issues/46538#issuecomment-2808806722
if (is.linux()) {
  app.commandLine.appendSwitch('gtk-version', '3');
}

// Ozone platform hint: Required for Wayland support
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// SharedArrayBuffer: Required for downloader (@ffmpeg/core-mt)
// OverlayScrollbar: Required for overlay scrollbars
// UseOzonePlatform: Required for Wayland support
// WaylandWindowDecorations: Required for Wayland decorations
app.commandLine.appendSwitch(
  'enable-features',
  'OverlayScrollbar,SharedArrayBuffer,UseOzonePlatform,WaylandWindowDecorations',
);
// Disable Fluent Scrollbar (for OverlayScrollbar)
app.commandLine.appendSwitch('disable-features', 'FluentScrollbar');
if (config.get('options.disableHardwareAcceleration')) {
  if (is.dev()) {
    console.log('Disabling hardware acceleration');
  }

  app.disableHardwareAcceleration();
}

if (is.linux()) {
  // Overrides WM_CLASS for X11 to correspond to icon filename
  app.setName('com.github.th_ch.youtube_music');

  // Stops chromium from launching its own MPRIS service
  if (await config.plugins.isEnabled('shortcuts')) {
    app.commandLine.appendSwitch('disable-features', 'MediaSessionService');
  }
}

if (config.get('options.proxy')) {
  const proxyToUse = config.get('options.proxy');
  console.log(LoggerPrefix, `Using proxy: ${proxyToUse}`);
  app.commandLine.appendSwitch('proxy-server', proxyToUse);
}

// Adds debug features like hotkeys for triggering dev tools and reload
if (is.dev()) {
  const { default: electronDebug } = await import('electron-debug');
  electronDebug({
    showDevTools: false, // Disable automatic devTools on new window
  });
}

// Resolve an asset path that works both in dev (cwd = project root) and in the
// packaged app (assets are asar-unpacked under resources/). Returns the first
// candidate that actually exists, so the window/taskbar icon never silently
// falls back to a missing file on Windows.
const resolveAsset = (relativePath: string): string => {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', relativePath)
      : '',
    process.resourcesPath ? path.join(process.resourcesPath, relativePath) : '',
    path.join(app.getAppPath(), relativePath),
    path.join(process.cwd(), relativePath),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return relativePath;
};

let icon = resolveAsset('assets/youtube-music.png');
if (process.platform === 'win32') {
  icon = resolveAsset('assets/generated/icons/win/icon.ico');
} else if (process.platform === 'darwin') {
  icon = resolveAsset('assets/generated/icons/mac/icon.icns');
}

function onClosed() {
  // Dereference the window
  // For multiple Windows store them in an array
  mainWindow = null;
}

ipcMain.handle('ytmd:get-main-plugin-names', async () =>
  Object.keys(await mainPlugins()),
);

// List downloaded music files for the in-app downloads view
ipcMain.handle('ytmd:list-downloads', async () => {
  const dlConfig = config.get('plugins.downloader') as Record<string, unknown> | undefined;
  const folder = (dlConfig?.downloadFolder as string) || app.getPath('downloads');
  try {
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    const musicExts = ['.mp3', '.opus', '.ogg', '.m4a', '.flac', '.wav', '.webm'];
    const files = entries
      .filter(e => e.isFile() && musicExts.some(ext => e.name.toLowerCase().endsWith(ext)))
      .map(e => {
        const filePath = path.join(folder, e.name);
        const stat = fs.statSync(filePath);
        let meta: { imageSrc?: string; title?: string; artist?: string } = {};
        try {
          const metaPath = filePath + '.meta.json';
          if (fs.existsSync(metaPath)) {
            const parsed: unknown = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
              meta = parsed as { imageSrc?: string; title?: string; artist?: string };
            }
          }
        } catch { /* ignore */ }
        return { name: e.name, path: filePath, size: stat.size, modified: stat.mtimeMs, imageSrc: meta.imageSrc };
      })
      .sort((a, b) => b.modified - a.modified); // newest first
    return { folder, files };
  } catch {
    return { folder, files: [] };
  }
});

// Extract embedded cover art from audio file ID3 tags
ipcMain.handle('ytmd:get-cover', async (_, filePath: string) => {
  try {
    // Check meta.json first
    const metaPath = filePath + '.meta.json';
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
        imageSrc?: string;
      };
      if (meta.imageSrc) return { imageSrc: meta.imageSrc };
    }
    // Fallback: read ID3 embedded artwork
    const NodeID3 = await import('node-id3');
    const tags = NodeID3.read(filePath);
    const img = tags.image;
    if (img && typeof img === 'object' && 'imageBuffer' in img && img.imageBuffer) {
      const mime = img.mime || 'image/png';
      const b64 = Buffer.from(img.imageBuffer).toString('base64');
      return { imageSrc: `data:${mime};base64,${b64}` };
    }
    return { imageSrc: null };
  } catch {
    return { imageSrc: null };
  }
});

// Open a specific file with default app
ipcMain.on('ytmd:open-file', (_, filePath: string) => {
  shell.openPath(filePath);
});

ipcMain.on('ytmd:open-url', (_, url: string) => {
  shell.openExternal(url);
});

// Delete a downloaded file
ipcMain.handle('ytmd:delete-download', (_, filePath: string) => {
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch {
    return { success: false };
  }
});

let hooksInstalled = false;

const initHook = async (_win: BrowserWindow) => {
  // These registrations are process-global (IPC handlers + a single config
  // watcher), so they must run only once. createMainWindow() is called again on
  // macOS `activate`; re-running this previously threw ("second handler for
  // 'ytmd:set-config'") and leaked a config.watch listener every time.
  if (hooksInstalled) return;
  hooksInstalled = true;

  const allPluginStubs = await allPlugins();

  ipcMain.handle(
    'ytmd:get-config',
    (_, id: string) => {
      const stored = config.get(`plugins.${id}`);
      const def = allPluginStubs[id]?.config ?? { enabled: false };
      const merged = deepmerge(def, stored ?? {}) as PluginConfig;
      return merged;
    },
  );
  ipcMain.handle('ytmd:set-config', (_, name: string, obj: object) =>
    config.setPartial(`plugins.${name}`, obj, allPluginStubs[name].config),
  );

  ipcMain.handle('ytmd:get-all-plugin-meta', () =>
    Object.entries(allPluginStubs).map(([id, stub]) => ({
      id,
      name: stub.name?.() ?? id,
      description: stub.description?.() ?? '',
      restartNeeded: stub.restartNeeded ?? false,
      defaultConfig: stub.config ?? { enabled: false },
    })),
  );

  config.watch((newValue, oldValue) => {
    const newPluginConfigList = (newValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;
    const oldPluginConfigList = (oldValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;

    // Fast-path: skip deep comparison if plugins object reference is the same
    if (newPluginConfigList === oldPluginConfigList) return;

    Object.entries(newPluginConfigList).forEach(([id, newPluginConfig]) => {
      const isEqual = deepEqual(oldPluginConfigList[id], newPluginConfig);

      if (!isEqual) {
        const oldConfig = oldPluginConfigList[id] as PluginConfig;
        const config = deepmerge(
          allPluginStubs[id].config ?? { enabled: false },
          newPluginConfig ?? {},
        ) as PluginConfig;

        // Always target the current live window (it may have been recreated).
        const targetWindow = mainWindow;

        if (config.enabled !== oldConfig?.enabled) {
          if (config.enabled) {
            targetWindow?.webContents.send('plugin:enable', id);
            ipcMain.emit('plugin:enable', id);
            if (targetWindow) forceLoadMainPlugin(id, targetWindow);
          } else {
            targetWindow?.webContents.send('plugin:unload', id);
            ipcMain.emit('plugin:unload', id);
            if (targetWindow) forceUnloadMainPlugin(id, targetWindow);
          }

          if (allPluginStubs[id]?.restartNeeded) {
            showNeedToRestartDialog(id);
          }
        }

        const mainPlugin = getAllLoadedMainPlugins()[id];
        if (mainPlugin) {
          if (config.enabled && typeof mainPlugin.backend !== 'function') {
            mainPlugin.backend?.onConfigChange?.call(
              mainPlugin.backend,
              config,
            );
          }
        }

        targetWindow?.webContents.send('config-changed', id, config);
      }
    });
  });
};

const showNeedToRestartDialog = async (id: string) => {
  const plugin = (await allPlugins())[id];

  const dialogOptions: Electron.MessageBoxOptions = {
    type: 'info',
    buttons: [
      t('main.dialog.need-to-restart.buttons.restart-now'),
      t('main.dialog.need-to-restart.buttons.later'),
    ],
    title: t('main.dialog.need-to-restart.title'),
    message: t('main.dialog.need-to-restart.message', {
      pluginName: plugin?.name?.() ?? id,
    }),
    detail: t('main.dialog.need-to-restart.detail', {
      pluginName: plugin?.name?.() ?? id,
    }),
    defaultId: 0,
    cancelId: 1,
  };

  let dialogPromise: Promise<Electron.MessageBoxReturnValue>;
  if (mainWindow) {
    dialogPromise = dialog.showMessageBox(mainWindow, dialogOptions);
  } else {
    dialogPromise = dialog.showMessageBox(dialogOptions);
  }

  dialogPromise.then((dialogOutput) => {
    switch (dialogOutput.response) {
      case 0: {
        restart();
        break;
      }

      // Ignore
      default: {
        break;
      }
    }
  }).catch((err) => console.error(LoggerPrefix, 'Restart dialog error:', err));
};

function initTheme(win: BrowserWindow) {
  injectCSS(win.webContents, youtubeMusicCSS);
  // Load user CSS
  const themes: string[] = config.get('options.themes');
  if (Array.isArray(themes)) {
    for (const cssFile of themes) {
      fileExists(
        cssFile,
        () => {
          injectCSSAsFile(win.webContents, cssFile);
        },
        () => {
          console.warn(
            LoggerPrefix,
            t('main.console.theme.css-file-not-found', { cssFile }),
          );
        },
      );
    }
  }

  win.webContents.once('did-finish-load', () => {
    if (is.dev()) {
      console.debug(LoggerPrefix, t('main.console.did-finish-load.dev-tools'));
    }
  });
}

async function createMainWindow() {
  const windowSize = config.get('window-size');
  const windowMaximized = config.get('window-maximized');
  const windowPosition: Electron.Point = config.get('window-position');
  const useInlineMenu = await config.plugins.isEnabled('in-app-menu');

  const defaultTitleBarOverlayOptions: Electron.TitleBarOverlay = {
    color: '#00000000',
    symbolColor: '#ffffff',
    height: 32,
  };

  const decorations: Partial<BrowserWindowConstructorOptions> = {
    frame: !is.macOS() && !useInlineMenu,
    titleBarOverlay: defaultTitleBarOverlayOptions,
    titleBarStyle: useInlineMenu
      ? 'hidden'
      : is.macOS()
        ? 'hiddenInset'
        : 'default',
    autoHideMenuBar: config.get('options.hideMenu'),
  };

  // Note: on linux, for some weird reason, having these extra properties with 'frame: false' does not work
  if (is.linux() && useInlineMenu) {
    delete decorations.titleBarOverlay;
    delete decorations.titleBarStyle;
  }

  const electronWindowSettings: Electron.BrowserWindowConstructorOptions = {
    icon,
    width: windowSize.width,
    height: windowSize.height,
    minWidth: 325,
    minHeight: 425,
    backgroundColor: '#000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      ...(isTesting()
        ? undefined
        : {
            // Sandbox is only enabled in tests for now
            // See https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts
            sandbox: false,
          }),
    },
    ...decorations,
  };

  const win = new BrowserWindow(electronWindowSettings);

  await initHook(win);
  initTheme(win);

  await loadAllMainPlugins(win);

  if (windowPosition) {
    const { x: windowX, y: windowY } = windowPosition;
    const winSize = win.getSize();
    const display = screen.getDisplayNearestPoint(windowPosition);
    const primaryDisplay = screen.getPrimaryDisplay();

    const scaleFactor = is.windows()
      ? primaryDisplay.scaleFactor / display.scaleFactor
      : 1;
    const scaledWidth = Math.floor(windowSize.width * scaleFactor);
    const scaledHeight = Math.floor(windowSize.height * scaleFactor);

    const scaledX = windowX;
    const scaledY = windowY;

    // Use the display workArea (excludes taskbar/dock) and a coherent margin
    // on every edge so the visibility check is symmetric. We require at least
    // half of the window (in each axis) to overlap the usable area.
    const area = display.workArea;
    const margin = 8;

    if (
      scaledX + scaledWidth / 2 < area.x - margin || // Left
      scaledX + scaledWidth / 2 > area.x + area.width + margin || // Right
      scaledY + scaledHeight / 2 < area.y - margin || // Top
      scaledY + scaledHeight / 2 > area.y + area.height + margin // Bottom
    ) {
      // Window is offscreen
      if (is.dev()) {
        console.warn(
          LoggerPrefix,
          t('main.console.window.tried-to-render-offscreen', {
            windowSize: String(winSize),
            displaySize: JSON.stringify(display.bounds),
            position: JSON.stringify(windowPosition),
          }),
        );
      }
    } else {
      win.setSize(scaledWidth, scaledHeight);
      win.setPosition(scaledX, scaledY);
    }
  }

  if (windowMaximized) {
    win.maximize();
  }

  if (config.get('options.alwaysOnTop')) {
    win.setAlwaysOnTop(true);
  }

  const urlToLoad = config.get('options.resumeOnStart')
    ? config.get('url')
    : config.defaultConfig.url;
  win.on('closed', onClosed);

  win.on('move', () => {
    if (win.isMaximized() || win.isFullScreen()) {
      return;
    }

    const [x, y] = win.getPosition();
    lateSaveDeferred('window-position', { x, y });
  });

  let winWasMaximized: boolean;

  win.on('resize', () => {
    const [width, height] = win.getSize();
    const isMaximized = win.isMaximized();

    if (winWasMaximized !== isMaximized) {
      winWasMaximized = isMaximized;
      config.set('window-maximized', isMaximized);
    }

    if (isMaximized || win.isFullScreen()) {
      return;
    }

    lateSaveDeferred('window-size', {
      width,
      height,
    });
  });

  const savedTimeouts: Record<string, NodeJS.Timeout | undefined> = {};

  function lateSave(
    key: string,
    value: unknown,
    fn: (key: string, value: unknown) => void = config.set,
  ) {
    if (savedTimeouts[key]) {
      clearTimeout(savedTimeouts[key]);
    }

    savedTimeouts[key] = setTimeout(() => {
      fn(key, value);
      savedTimeouts[key] = undefined;
    }, 600);
  }

  const pendingSaves: Record<
    string,
    { value: unknown; fn: (key: string, value: unknown) => void }
  > = {};

  function lateSaveDeferred(
    key: string,
    value: unknown,
    fn: (key: string, value: unknown) => void = config.set,
  ) {
    pendingSaves[key] = { value, fn };
    lateSave(
      key,
      value,
      (k, v) => {
        delete pendingSaves[k];
        fn(k, v);
      },
    );
  }

  // Flush any debounced saves immediately so we don't lose the latest
  // window-position/window-size when the app is closing.
  function flushSavedTimeouts() {
    for (const key of Object.keys(savedTimeouts)) {
      const timeout = savedTimeouts[key];
      if (timeout) {
        clearTimeout(timeout);
        savedTimeouts[key] = undefined;
      }
    }

    for (const key of Object.keys(pendingSaves)) {
      const pending = pendingSaves[key];
      if (pending) {
        pending.fn(key, pending.value);
        delete pendingSaves[key];
      }
    }
  }

  app.on('before-quit', flushSavedTimeouts);
  win.on('close', flushSavedTimeouts);

  app.on('render-process-gone', (_event, _webContents, details) => {
    showUnresponsiveDialog(win, details);
  });

  win.once('ready-to-show', () => {
    if (config.get('options.appVisible')) {
      win.show();
    }
  });

  removeContentSecurityPolicy();

  // Pipe renderer console messages to main process stdout for debugging
  win.webContents.on('console-message', (event) => {
    const { level, message } = event;
    console.log(`[RENDERER:${level}] ${message}`);
  });

  win.webContents.on('dom-ready', () => {
    if (useInlineMenu && is.windows()) {
      win.setTitleBarOverlay({
        ...defaultTitleBarOverlayOptions,
        height: Math.floor(
          defaultTitleBarOverlayOptions.height! *
            win.webContents.getZoomFactor(),
        ),
      });
    }
  });
  // Hostnames that are allowed to be navigated to within the app window.
  // Anything else (external links, ads, third-party redirects) is opened in
  // the user's default browser instead. This is intentionally permissive so
  // we never block legitimate YouTube Music / Google sign-in flows.
  const isInternalNavigation = (rawUrl: string): boolean => {
    let host: string;
    try {
      const parsed = new URL(rawUrl);
      // Allow non-http(s) schemes (e.g. blob:, data:, devtools:) to pass
      // through untouched.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return true;
      }
      host = parsed.hostname;
    } catch {
      return true;
    }

    return (
      host === 'music.youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube.com' ||
      host.endsWith('.google.com') ||
      host === 'google.com' ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.gstatic.com') ||
      host.endsWith('.ggpht.com') ||
      host === 'accounts.google.com'
    );
  };

  // window.open / target=_blank: allow internal (YouTube/Google, including the
  // OAuth sign-in popup) windows to open normally, send external destinations to
  // the default browser, and deny anything else.
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (isInternalNavigation(openUrl)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//.test(openUrl)) {
      shell.openExternal(openUrl).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Keep top-level navigations inside trusted domains; send external ones to
  // the default browser instead of navigating away from the app.
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isInternalNavigation(navigationUrl)) {
      event.preventDefault();
      if (/^https?:\/\//.test(navigationUrl)) {
        shell.openExternal(navigationUrl).catch(() => {});
      }
    }
  });

  win.webContents.on('will-redirect', (event) => {
    const url = new URL(event.url);

    // Workarounds for regions where YTM is restricted
    if (url.hostname.endsWith('youtube.com') && url.pathname === '/premium') {
      event.preventDefault();

      win.webContents.loadURL(
        'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F',
      );
    }
  });

  win.webContents.loadURL(urlToLoad);

  return win;
}

app.once('browser-window-created', (_event, win) => {
  if (config.get('options.overrideUserAgent')) {
    // User agents are from https://developers.whatismybrowser.com/useragents/explore/
    const originalUserAgent = win.webContents.userAgent;
    const userAgents = {
      mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
      windows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
      linux:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
    };

    const updatedUserAgent = is.macOS()
      ? userAgents.mac
      : is.windows()
        ? userAgents.windows
        : userAgents.linux;

    win.webContents.userAgent = updatedUserAgent;
    app.userAgentFallback = updatedUserAgent;

    win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
      // This will only happen if login failed, and "retry" was pressed
      if (
        win.webContents.getURL().startsWith('https://accounts.google.com') &&
        details.url.startsWith('https://accounts.google.com')
      ) {
        details.requestHeaders['User-Agent'] = originalUserAgent;
      }

      cb({ requestHeaders: details.requestHeaders });
    });
  }

  setupSongInfo(win);
  setupAppControls();

  win.webContents.on(
    'did-fail-load',
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    ) => {
      const log = JSON.stringify(
        {
          error: 'did-fail-load',
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
          frameProcessId,
          frameRoutingId,
        },
        null,
        '\t',
      );
      if (is.dev()) {
        console.log(log);
      }

      if (
        errorCode !== -3 &&
        // Workaround for #2435
        !new URL(validatedURL).hostname.includes('doubleclick.net')
      ) {
        // -3 is a false positive
        win.webContents.send('log', log);
        win.webContents.loadFile(ErrorHtmlAsset);
      }
    },
  );

  win.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  const customWindowTitle = config.get('options.customWindowTitle');

  if (customWindowTitle) {
    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle(customWindowTitle);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }

  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
});

app.on('activate', async () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    mainWindow = await createMainWindow();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
});

const getDefaultLocale = async (locale: string) =>
  Object.keys(await languageResources()).includes(locale) ? locale : null;

app.whenReady().then(async () => {
  // About panel — Revamp credits
  app.setAboutPanelOptions({
    applicationName: 'YouTube Music — Revamp by @IsSlashy',
    applicationVersion: '4.0.1',
    copyright: [
      'Revamp by @IsSlashy',
      'X: https://x.com/Slashy_fx',
      'Dernière mise à jour: 21/06/2026',
      '',
      'Credits: Pear Desktop',
      'https://github.com/pear-devs/pear-desktop',
    ].join('\n'),
    version: 'Revamp Edition',
  });

  // Register protocol for serving local audio files (with range request support)
  protocol.handle('ytmd-local', (request) => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path') || '';
    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg', '.opus': 'audio/opus', '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.wav': 'audio/wav',
        '.webm': 'audio/webm',
      };
      const contentType = mimeTypes[ext] || 'audio/mpeg';
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const buffer = Buffer.alloc(chunkSize);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buffer, 0, chunkSize, start);
        fs.closeSync(fd);
        return new Response(buffer, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(chunkSize),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });

  if (!config.get('options.language')) {
    const locale = await getDefaultLocale(app.getLocale());
    if (locale) {
      config.set('options.language', locale);
    }
  }

  // Start i18n loading in background — don't block window creation
  const i18nReady = loadI18n().then(async () => {
    await setLanguage(config.get('options.language') ?? 'en');
    console.log(LoggerPrefix, t('main.console.i18n.loaded'));
  });

  if (config.get('options.autoResetAppCache')) {
    // Clear cache after 20s
    const clearCacheTimeout = setTimeout(() => {
      if (is.dev()) {
        console.log(
          LoggerPrefix,
          t('main.console.when-ready.clearing-cache-after-20s'),
        );
      }

      session.defaultSession.clearCache();
      clearTimeout(clearCacheTimeout);
    }, 20_000);
  }

  // Register appID on windows
  if (is.windows()) {
    const appID = 'com.github.th-ch.youtube-music';
    app.setAppUserModelId(appID);
    const appLocation = process.execPath;
    const appData = app.getPath('appData');
    // Check shortcut validity if not in dev mode / running portable app
    if (
      !is.dev() &&
      !appLocation.startsWith(path.join(appData, '..', 'Local', 'Temp'))
    ) {
      const shortcutPath = path.join(
        appData,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'YouTube Music.lnk',
      );
      try {
        // Check if shortcut is registered and valid
        const shortcutDetails = shell.readShortcutLink(shortcutPath); // Throw error if it doesn't exist yet
        if (
          shortcutDetails.target !== appLocation ||
          shortcutDetails.appUserModelId !== appID
        ) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'needUpdate';
        }
      } catch (error) {
        // If not valid -> Register shortcut
        shell.writeShortcutLink(
          shortcutPath,
          error === 'needUpdate' ? 'update' : 'create',
          {
            target: appLocation,
            cwd: path.dirname(appLocation),
            description: 'YouTube Music Desktop App - including custom plugins',
            appUserModelId: appID,
          },
        );
      }
    }
  }

  ipcMain.handle('get-renderer-script', async () => {
    // Inject index.html file as string using insertAdjacentHTML
    // In dev mode, get string from process.env.VITE_DEV_SERVER_URL, else use fs.promises.readFile
    if (is.dev() && process.env.ELECTRON_RENDERER_URL) {
      // HACK: to make vite work with electron renderer (supports hot reload)
      return [
        null,
        `
        console.log('${LoggerPrefix}', 'Loading vite from dev server');
        (async () => {
          await new Promise((resolve) => {
            if (document.readyState === 'loading') {
              console.log('${LoggerPrefix}', 'Waiting for DOM to load');
              document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
            } else {
              resolve();
            }
          });
          const viteScript = document.createElement('script');
          viteScript.type = 'module';
          viteScript.src = '${process.env.ELECTRON_RENDERER_URL}/@vite/client';
          const rendererScript = document.createElement('script');
          rendererScript.type = 'module';
          rendererScript.src = '${process.env.ELECTRON_RENDERER_URL}/renderer.ts';
          document.body.appendChild(viteScript);
          document.body.appendChild(rendererScript);
        })();
        0
      `,
      ];
    } else {
      const rendererPath = path.join(__dirname, '..', 'renderer');
      const { parse } = await import('node-html-parser');
      const indexHTML = parse(
        await fs.promises.readFile(path.join(rendererPath, 'index.html'), 'utf-8'),
      );
      const scriptSrc = indexHTML.querySelector('script')!;
      const scriptPath = path.join(
        rendererPath,
        scriptSrc.getAttribute('src')!,
      );
      const scriptString = await fs.promises.readFile(scriptPath, 'utf-8');
      return [
        url.pathToFileURL(scriptPath).toString(),
        scriptString + ';0',
      ];
    }
  });

  mainWindow = await createMainWindow();
  // Ensure i18n is ready before building menus
  await i18nReady;
  await setApplicationMenu(mainWindow);
  await refreshMenu(mainWindow);
  setUpTray(app, mainWindow);

  setupProtocolHandler(mainWindow);

  app.on('second-instance', (_, commandLine) => {
    const uri = `${APP_PROTOCOL}://`;
    const protocolArgv = commandLine.find((arg) => arg.startsWith(uri));
    if (protocolArgv) {
      const lastIndex = protocolArgv.endsWith('/') ? -1 : undefined;
      const command = protocolArgv.slice(uri.length, lastIndex);
      if (is.dev()) {
        console.debug(
          LoggerPrefix,
          t('main.console.second-instance.receive-command', { command }),
        );
      }

      const splited = decodeURIComponent(command).split(' ');

      handleProtocol(splited.shift()!, ...splited);
      return;
    }

    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();
  });

  // Autostart at login
  app.setLoginItemSettings({
    openAtLogin: config.get('options.startAtLogin'),
  });

  if (!is.dev() && config.get('options.autoUpdates')) {
    // Automatic updates: download the new version in the background, then offer
    // to restart & install it directly in-app — no need to visit GitHub.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    const updateTimeout = setTimeout(() => {
      autoUpdater
        .checkForUpdates()
        .catch((err) =>
          console.error(LoggerPrefix, 'Update check failed:', err),
        );
      clearTimeout(updateTimeout);
    }, 2000);

    let updatePrompted = false;
    autoUpdater.on('update-downloaded', (info) => {
      if (updatePrompted) return;
      updatePrompted = true;

      const dialogOptions: Electron.MessageBoxOptions = {
        type: 'info',
        buttons: [
          t('main.dialog.update-available.buttons.ok'), // Later
          t('main.dialog.update-available.buttons.download'), // Restart now
          t('main.dialog.update-available.buttons.disable'), // Disable updates
        ],
        title: t('main.dialog.update-available.title'),
        message: t('main.dialog.update-available.message'),
        detail: t('main.dialog.update-available.detail', {
          downloadLink: info?.version ? `v${info.version}` : '',
        }),
        defaultId: 1,
        cancelId: 0,
      };

      const dialogPromise = mainWindow
        ? dialog.showMessageBox(mainWindow, dialogOptions)
        : dialog.showMessageBox(dialogOptions);

      dialogPromise
        .then((dialogOutput) => {
          switch (dialogOutput.response) {
            // Restart & install now
            case 1: {
              setImmediate(() => autoUpdater.quitAndInstall());
              break;
            }

            // Disable updates
            case 2: {
              config.set('options.autoUpdates', false);
              break;
            }

            // Later — the update installs automatically on next quit
            case 0:
            default:
              break;
          }
        })
        .catch((err) =>
          console.error(LoggerPrefix, 'Update dialog error:', err),
        );
    });

    autoUpdater.on('error', (err) =>
      console.error(LoggerPrefix, 'Auto-update error:', err),
    );
  }

  if (config.get('options.hideMenu') && !config.get('options.hideMenuWarned')) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('main.dialog.hide-menu-enabled.title'),
      message: t('main.dialog.hide-menu-enabled.message'),
    });
    config.set('options.hideMenuWarned', true);
  }

  // Optimized for Mac OS X
  if (is.macOS() && !config.get('options.appVisible')) {
    app.dock?.hide();
  }

  let forceQuit = false;
  app.on('before-quit', () => {
    forceQuit = true;
    // Stop playback before quitting so audio doesn't linger
    mainWindow?.webContents.send('ytmd:pause');
  });

  if (is.macOS() || config.get('options.tray')) {
    mainWindow.on('close', (event) => {
      // Hide the window instead of quitting (quit is available in tray options)
      if (!forceQuit) {
        event.preventDefault();
        // Pause playback when hiding to tray so music doesn't keep playing
        mainWindow!.webContents.send('ytmd:pause');
        mainWindow!.hide();
      }
    });
  }
});

function showUnresponsiveDialog(
  win: BrowserWindow,
  details: Electron.RenderProcessGoneDetails,
) {
  if (details) {
    console.error(
      LoggerPrefix,
      t('main.console.unresponsive.details', {
        error: JSON.stringify(details, null, '\t'),
      }),
    );
  }

  dialog
    .showMessageBox(win, {
      type: 'error',
      title: t('main.dialog.unresponsive.title'),
      message: t('main.dialog.unresponsive.message'),
      detail: t('main.dialog.unresponsive.detail'),
      buttons: [
        t('main.dialog.unresponsive.buttons.wait'),
        t('main.dialog.unresponsive.buttons.relaunch'),
        t('main.dialog.unresponsive.buttons.quit'),
      ],
      cancelId: 0,
    })
    .then((result) => {
      switch (result.response) {
        case 1: {
          restart();
          break;
        }

        case 2: {
          app.quit();
          break;
        }
      }
    });
}

function removeContentSecurityPolicy(
  betterSession: BetterSession = session.defaultSession as BetterSession,
) {
  // Allows defining multiple "onHeadersReceived" listeners
  // by enhancing the session.
  // Some plugins (e.g. adblocker) also define a "onHeadersReceived" listener
  enhanceWebRequest(betterSession);

  // Custom listener to tweak the content security policy
  betterSession.webRequest.onHeadersReceived((details, callback) => {
    details.responseHeaders ??= {};

    // prettier-ignore
    if (new URL(details.url).protocol === 'https:') {
      // Remove the content security policy
      delete details.responseHeaders['content-security-policy-report-only'];
      delete details.responseHeaders['Content-Security-Policy-Report-Only'];
      delete details.responseHeaders['content-security-policy'];
      delete details.responseHeaders['Content-Security-Policy'];

      if (
        !details.responseHeaders['access-control-allow-origin'] &&
        !details.responseHeaders['Access-Control-Allow-Origin']
      ) {
        details.responseHeaders['access-control-allow-origin'] = ['https://music.youtube.com'];
      }
    }

    callback({ cancel: false, responseHeaders: details.responseHeaders });
  });

  // When multiple listeners are defined, apply them all
  betterSession.webRequest.setResolver(
    'onHeadersReceived',
    async (listeners) => {
      return listeners.reduce(
        async (accumulator, listener) => {
          const acc = await accumulator;
          if (acc.cancel) {
            return acc;
          }

          const result = await listener.apply();
          return { ...accumulator, ...result };
        },
        Promise.resolve({ cancel: false }),
      );
    },
  );
}
