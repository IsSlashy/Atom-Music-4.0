import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
  webFrame,
} from 'electron';
import is from 'electron-is';

import * as config from './config';

import {
  forceLoadPreloadPlugin,
  forceUnloadPreloadPlugin,
  loadAllPreloadPlugins,
} from './loader/preload';
import { loadI18n, setLanguage } from '@/i18n';
import { LoggerPrefix } from '@/utils';

/**
 * Port of `overrideSiteFlags` from upstream pear-desktop (`rewrite` branch,
 * packages/page/src/site-flags.ts, commit 5bf11283). YTM's inline config script
 * hands its feature flags to `ytcfg.set({ EXPERIMENT_FLAGS })`, and YTM's code
 * reads them from `yt.config_` afterwards. This wraps `ytcfg.set` as soon as the
 * page defines `ytcfg`, so the overrides land before anything reads them.
 *
 * It runs in the main world through `contextBridge.executeInMainWorld`, which
 * serializes the function: it must not use anything outside its own body.
 */
function overrideSiteFlags(overrides: Record<string, boolean>) {
  type Flags = Record<string, unknown>;
  interface Ytcfg {
    set(...args: unknown[]): unknown;
  }

  const isRecord = (value: unknown): value is Flags =>
    typeof value === 'object' && value !== null;
  const apply = (flags: Flags) => {
    Object.assign(flags, overrides);
  };
  const wrap = (ytcfg: Ytcfg) => {
    // Called below with the page's own `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const set = ytcfg.set;
    ytcfg.set = function (this: unknown, ...args: unknown[]) {
      if (
        args.length > 1 &&
        args[0] === 'EXPERIMENT_FLAGS' &&
        isRecord(args[1])
      ) {
        apply(args[1]);
      } else if (isRecord(args[0]) && isRecord(args[0].EXPERIMENT_FLAGS)) {
        apply(args[0].EXPERIMENT_FLAGS);
      }
      return set.apply(this, args);
    };
  };

  const page = window as unknown as {
    ytcfg?: Ytcfg;
    yt?: { config_?: { EXPERIMENT_FLAGS?: Flags } };
  };
  if (page.ytcfg) {
    // Too late to catch the first set (not expected: the preload runs first);
    // patch what is there.
    const current = page.yt?.config_?.EXPERIMENT_FLAGS;
    if (current) apply(current);
    if (typeof page.ytcfg.set === 'function') wrap(page.ytcfg);
  } else {
    // The page's `var ytcfg = {...}` assigns through this accessor instead of
    // replacing it.
    let ytcfg: Ytcfg | undefined;
    Object.defineProperty(window, 'ytcfg', {
      configurable: true,
      enumerable: true,
      get: () => ytcfg,
      set(value: Ytcfg) {
        ytcfg = value;
        if (value && typeof value.set === 'function') wrap(value);
      },
    });
  }
}

/**
 * The flags behind YTM's new player bar. YTM hands them out together: without
 * the action bar flag the new bar has no like buttons.
 */
const NEW_PLAYER_BAR_FLAGS = [
  'music_web_enable_wiz_miniplayer',
  'music_web_enable_action_bar_view_model_in_player_overlay',
  'music_web_enable_like_count_in_player_overlay',
  'music_web_enable_contained_content_layout',
];

// Pin the player bar before YTM's scripts run, so before any await. 'auto', a
// missing key or any other value leaves YTM's own choice alone.
if (window.location.origin === 'https://music.youtube.com') {
  const playerBar = config.get('options.playerBar');
  if (playerBar === 'classic' || playerBar === 'new') {
    try {
      contextBridge.executeInMainWorld({
        func: overrideSiteFlags,
        args: [
          Object.fromEntries(
            NEW_PLAYER_BAR_FLAGS.map((name) => [name, playerBar === 'new']),
          ),
        ],
      });
    } catch (error) {
      console.error(LoggerPrefix, 'Could not pin the player bar:', error);
    }
  }
}

loadI18n().then(async () => {
  await setLanguage(config.get('options.language') ?? 'en');
  await loadAllPreloadPlugins();
});

ipcRenderer.on('plugin:unload', async (_, id: string) => {
  await forceUnloadPreloadPlugin(id);
});
ipcRenderer.on('plugin:enable', async (_, id: string) => {
  await forceLoadPreloadPlugin(id);
});

// Channels the page sends or invokes: src/renderer.ts, the song-info provider
// and the plugins' renderer code (calls through `window.ipcRenderer` and the
// plugin context's `ipc`). The bridge refuses any other channel, so a script
// injected into the page cannot reach the other main-process handlers. A new
// channel the page needs must be added here.
const sendChannels = new Set([
  'plugin:toggle-picture-in-picture',
  'ytmd:autoplay-changed',
  'ytmd:fullscreen-changed',
  'ytmd:fullscreen-changed-supported',
  'ytmd:get-queue-response',
  'ytmd:get-shuffle-response',
  'ytmd:like-changed',
  'ytmd:open-url',
  'ytmd:play-or-paused',
  'ytmd:player-api-loaded',
  'ytmd:repeat-changed',
  'ytmd:search-results',
  'ytmd:seeked',
  'ytmd:set-fullscreen',
  'ytmd:shuffle-changed',
  'ytmd:shuffle-changed-supported',
  'ytmd:time-changed',
  'ytmd:video-src-changed',
  'ytmd:volume-changed',
]);
const invokeChannels = new Set([
  'download-playlist-request',
  'download-song',
  'get-menu',
  'get-menu-by-id',
  'window-close',
  'window-is-maximized',
  'window-maximize',
  'window-minimize',
  'window-unmaximize',
  'ytmd:delete-download',
  'ytmd:get-all-plugin-meta',
  'ytmd:get-config',
  'ytmd:get-cover',
  'ytmd:list-downloads',
  'ytmd:menu-event',
  'ytmd:set-config',
]);
// Channels the page listens to (on, once) or stops listening to (off,
// removeListener, removeAllListeners): what the main process sends to
// src/renderer.ts, the song-info provider and the plugins' renderer code. A
// script injected into the page cannot listen to the other channels nor drop
// listeners on them. A new channel the page listens to must be added here.
const listenChannels = new Set([
  'changeVolume',
  'close-all-in-app-menu-panel',
  'config-changed',
  'downloader-feedback',
  'log',
  'open-settings',
  'plugin:enable',
  'plugin:unload',
  'refresh-in-app-menu',
  'setVolume',
  'toggle-in-app-menu',
  'window-maximize',
  'window-unmaximize',
  'ytmd:add-to-queue',
  'ytmd:clear-queue',
  'ytmd:click-fullscreen-button',
  'ytmd:get-fullscreen',
  'ytmd:get-queue',
  'ytmd:get-shuffle',
  'ytmd:move-in-queue',
  'ytmd:next-video',
  'ytmd:pause',
  'ytmd:pip-toggle',
  'ytmd:play',
  'ytmd:previous-video',
  'ytmd:remove-from-queue',
  'ytmd:search',
  'ytmd:seek-by',
  'ytmd:seek-to',
  'ytmd:set-queue-index',
  'ytmd:setup-autoplay-changed-listener',
  'ytmd:setup-fullscreen-changed-listener',
  'ytmd:setup-like-changed-listener',
  'ytmd:setup-repeat-changed-listener',
  'ytmd:setup-seeked-listener',
  'ytmd:setup-shuffle-changed-listener',
  'ytmd:setup-time-changed-listener',
  'ytmd:setup-volume-changed-listener',
  'ytmd:show-about',
  'ytmd:shuffle',
  'ytmd:switch-repeat',
  'ytmd:toggle-mute',
  'ytmd:toggle-play',
  'ytmd:update-like',
  'ytmd:update-song-info',
  'ytmd:update-volume',
]);
// The page never needs a synchronous reply, and a sync send to a channel the
// main process only handles with `handle()` never returns: it freezes the page.
const sendSyncChannels = new Set<string>();

const assertChannel = (allowed: Set<string>, channel: string) => {
  if (!allowed.has(channel)) {
    throw new Error(`IPC channel "${channel}" is not allowed from the page`);
  }
};

// The download folders are where the downloader writes and what ytmd-local
// serves from, so the page must not move them. They are set from the menu,
// through the native folder picker, in the main process.
const writesDownloadFolder = (id: unknown, value: unknown) => {
  if (id !== 'downloader' || typeof value !== 'object' || value === null) {
    return false;
  }
  const { downloadOnFinish } = value as { downloadOnFinish?: unknown };
  return (
    'downloadFolder' in value ||
    (typeof downloadOnFinish === 'object' &&
      downloadOnFinish !== null &&
      'folder' in downloadOnFinish)
  );
};

// Plugin options the page may write through `mainConfig.plugins.setOptions`.
// The page can read the whole config, but nothing else of it is writable here:
// not `url`, not the download folders.
const pageWritablePluginOptions: Record<string, string[]> = {
  'video-toggle': ['hideVideo'],
};

contextBridge.exposeInMainWorld('mainConfig', {
  get: config.get,
  plugins: {
    isEnabled: config.plugins.isEnabled,
    setOptions: (plugin: string, options: Record<string, unknown>) => {
      const writable = Object.hasOwn(pageWritablePluginOptions, plugin)
        ? pageWritablePluginOptions[plugin]
        : [];
      const refused = Object.keys(options).filter(
        (key) => !writable.includes(key),
      );
      if (refused.length > 0) {
        throw new Error(
          `Config ${plugin}.${refused.join(', ')} is not writable from the page`,
        );
      }
      config.plugins.setOptions(plugin, options);
    },
  },
});
contextBridge.exposeInMainWorld('electronIs', is);
contextBridge.exposeInMainWorld('ipcRenderer', {
  on: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ) => {
    assertChannel(listenChannels, channel);
    return ipcRenderer.on(channel, listener);
  },
  off: (channel: string, listener: (...args: unknown[]) => void) => {
    assertChannel(listenChannels, channel);
    return ipcRenderer.off(channel, listener);
  },
  once: (
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ) => {
    assertChannel(listenChannels, channel);
    return ipcRenderer.once(channel, listener);
  },
  send: (channel: string, ...args: unknown[]) => {
    assertChannel(sendChannels, channel);
    ipcRenderer.send(channel, ...args);
  },
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
    assertChannel(listenChannels, channel);
    return ipcRenderer.removeListener(channel, listener);
  },
  removeAllListeners: (channel: string) => {
    assertChannel(listenChannels, channel);
    return ipcRenderer.removeAllListeners(channel);
  },
  invoke: async (channel: string, ...args: unknown[]): Promise<unknown> => {
    assertChannel(invokeChannels, channel);
    if (
      channel === 'ytmd:set-config' &&
      writesDownloadFolder(args[0], args[1])
    ) {
      throw new Error('The download folders are not writable from the page');
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  sendSync: (channel: string, ...args: unknown[]): unknown => {
    assertChannel(sendSyncChannels, channel);
    return ipcRenderer.sendSync(channel, ...args);
  },
});
contextBridge.exposeInMainWorld('reload', () =>
  ipcRenderer.send('ytmd:reload'),
);
contextBridge.exposeInMainWorld(
  'ELECTRON_RENDERER_URL',
  process.env.ELECTRON_RENDERER_URL,
);

(async () => {
  const [scriptPath, script] = (await ipcRenderer.invoke(
    'get-renderer-script',
  )) as [string | null, string];

  await new Promise<void>((resolve) => {
    if (scriptPath) {
      webFrame.executeJavaScriptInIsolatedWorld(
        0,
        [{ code: script, url: scriptPath }],
        true,
        () => resolve(),
      );
    } else {
      webFrame.executeJavaScript(script, true, () => resolve());
    }
  });
})().catch((error: unknown) => {
  console.error(LoggerPrefix, 'Could not load the renderer script:', error);
});
