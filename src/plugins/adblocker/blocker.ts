// Used for caching
import path from 'node:path';
import fs, { promises } from 'node:fs';
import { createRequire } from 'node:module';

import { ElectronBlocker } from '@ghostery/adblocker-electron';
import enhanceWebRequest, {
  type BetterSession,
} from '@jellybrick/electron-better-web-request';
import { app, ipcMain, net } from 'electron';

const SOURCES = [
  'https://raw.githubusercontent.com/kbinani/adblock-youtube-ads/master/signed.txt',
  // UBlock Origin
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters.txt',
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/quick-fixes.txt',
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/unbreak.txt',
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2020.txt',
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2021.txt',
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2022.txt',
  'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/filters-2023.txt',
  // Fanboy Annoyances
  'https://secure.fanboy.co.nz/fanboy-annoyance_ubo.txt',
  // AdGuard
  'https://filters.adtidy.org/extension/ublock/filters/122_optimized.txt',
];

// Bumped by every load and unload, so lists that finish downloading after the
// plugin was stopped or reloaded are dropped instead of turning blocking on.
let generation = 0;

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// The preload Ghostery registers for cosmetic filters, resolved the same way
// as its own PRELOAD_PATH.
const PRELOAD_PATH = createRequire(import.meta.url).resolve(
  '@ghostery/adblocker-electron-preload',
);

type BlockedEvent = 'onBeforeRequest' | 'onHeadersReceived';
type WebRequestAction = Parameters<
  BetterSession['webRequest']['addListener']
>[2];

let blocking:
  | {
      session: Electron.Session;
      listenerIds: [BlockedEvent, string][];
      preloadScriptId?: string;
    }
  | undefined;

// The main process wraps the session with electron-better-web-request so that
// several listeners can share one webRequest event (the CSP remover is
// another). Ghostery's enableBlockingInSession and disableBlockingInSession
// use the plain API: unregistering with onXxx(null) throws on the wrapped
// session and would drop the other listeners too. So the listeners are added
// through the wrapper here and removed by id.
const enableBlocking = (session: Electron.Session, engine: ElectronBlocker) => {
  const { webRequest } = enhanceWebRequest(session);
  const listenerIds: [BlockedEvent, string][] = [];
  let preloadScriptId: string | undefined;

  if (engine.config.loadCosmeticFilters) {
    preloadScriptId = session.registerPreloadScript({
      type: 'frame',
      filePath: PRELOAD_PATH,
    });
    ipcMain.handle(
      '@ghostery/adblocker/inject-cosmetic-filters',
      engine.onInjectCosmeticFilters,
    );
    ipcMain.handle(
      '@ghostery/adblocker/is-mutation-observer-enabled',
      engine.onIsMutationObserverEnabled,
    );
  }

  if (engine.config.loadNetworkFilters) {
    const filter = { urls: ['<all_urls>'] };
    for (const [event, action] of [
      ['onHeadersReceived', engine.onHeadersReceived],
      ['onBeforeRequest', engine.onBeforeRequest],
    ] as const) {
      const listener = webRequest.addListener(
        event,
        filter,
        action as WebRequestAction,
      );
      listenerIds.push([event, listener.id]);
    }
  }

  blocking = { session, listenerIds, preloadScriptId };
};

const disableBlocking = () => {
  if (!blocking) return;
  const { session, listenerIds, preloadScriptId } = blocking;
  blocking = undefined;

  const { webRequest } = enhanceWebRequest(session);
  for (const [event, id] of listenerIds) {
    try {
      webRequest.removeListener(event, id);
    } catch {
      // When other listeners remain, the wrapper drops ours from its map and
      // then rebinds the event with an array where Electron expects
      // { urls }, which throws. The hook already bound reads that map on
      // every request, so the listener is removed either way.
    }
  }

  if (preloadScriptId !== undefined) {
    session.unregisterPreloadScript(preloadScriptId);
    ipcMain.removeHandler('@ghostery/adblocker/inject-cosmetic-filters');
    ipcMain.removeHandler('@ghostery/adblocker/is-mutation-observer-enabled');
  }
};

const useEngine = (
  session: Electron.Session | undefined,
  engine: ElectronBlocker,
) => {
  disableBlocking();
  if (session) {
    enableBlocking(session, engine);
  }
};

const fetchEngine = (
  session: Electron.Session | undefined,
  lists: string[],
  cachePath?: string,
) =>
  ElectronBlocker.fromLists(
    (url: string) => net.fetch(url),
    lists,
    {
      enableCompression: true,
      loadNetworkFilters: session !== undefined,
    },
    cachePath
      ? { path: cachePath, read: promises.readFile, write: promises.writeFile }
      : undefined,
  );

export const loadAdBlockerEngine = async (
  session: Electron.Session | undefined = undefined,
  cache: boolean = true,
  additionalBlockLists: string[] = [],
  disableDefaultLists: boolean | unknown[] = false,
) => {
  const current = ++generation;
  const cacheDirectory = path.join(app.getPath('userData'), 'adblock_cache');
  if (!fs.existsSync(cacheDirectory)) {
    fs.mkdirSync(cacheDirectory);
  }

  const cachePath = path.join(cacheDirectory, 'adblocker-engine.bin');
  const useCache = cache && additionalBlockLists.length === 0;
  const lists = [
    ...((disableDefaultLists && !Array.isArray(disableDefaultLists)) ||
    (Array.isArray(disableDefaultLists) && disableDefaultLists.length > 0)
      ? []
      : SOURCES),
    ...additionalBlockLists,
  ];

  // Cache-first: try loading from cached binary immediately
  if (useCache && fs.existsSync(cachePath)) {
    try {
      const engineBytes = await promises.readFile(cachePath);
      if (current !== generation) return;
      useEngine(session, ElectronBlocker.deserialize(engineBytes));

      // Update filter lists in background if cache is stale (>24h)
      const cacheAge = Date.now() - fs.statSync(cachePath).mtimeMs;
      if (cacheAge > CACHE_MAX_AGE_MS) {
        updateFilterListsInBackground(current, session, lists, cachePath).catch(
          (err) => console.error('Background filter list update failed', err),
        );
      }

      return;
    } catch {
      // Cache corrupted, fall through to full load
    }
  }

  // No cache: download the lists in the background. Awaiting the download
  // held the first navigation for about half a second on a cold start.
  fetchEngine(session, lists, useCache ? cachePath : undefined)
    .then((engine) => {
      if (current === generation) useEngine(session, engine);
    })
    .catch((error) => console.error('Error loading adBlocker engine', error));
};

async function updateFilterListsInBackground(
  current: number,
  session: Electron.Session | undefined,
  lists: string[],
  cachePath: string,
) {
  const freshBlocker = await fetchEngine(session, lists);

  // Serialize and save to cache
  const serialized = freshBlocker.serialize();
  await promises.writeFile(cachePath, serialized);

  // Hot-swap the blocker, unless the plugin was stopped or reloaded meanwhile
  if (current === generation) {
    useEngine(session, freshBlocker);
  }
}

export const unloadAdBlockerEngine = (session: Electron.Session) => {
  generation++;
  if (blocking?.session === session) {
    disableBlocking();
  }
};

export const isBlockerEnabled = (session: Electron.Session) =>
  blocking?.session === session;
