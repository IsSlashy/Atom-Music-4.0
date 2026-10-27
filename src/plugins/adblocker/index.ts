import { webFrame } from 'electron';

import { blockers } from './types';
import { createPlugin } from '@/utils';
import {
  isBlockerEnabled,
  loadAdBlockerEngine,
  unloadAdBlockerEngine,
} from './blocker';

import { inject, isInjected } from './injectors/inject';
import { loadAdSpeedup, unloadAdSpeedup } from './adSpeedup';

import { t } from '@/i18n';

import type { BrowserWindow } from 'electron';

interface AdblockerConfig {
  /**
   * Whether to enable the adblocker.
   * @default true
   */
  enabled: boolean;
  /**
   * When enabled, the adblocker will cache the blocklists.
   * @default true
   */
  cache: boolean;
  /**
   * Which adblocker to use.
   * @default blockers.InPlayer
   */
  blocker: (typeof blockers)[keyof typeof blockers];
  /**
   * Additional list of filters to use.
   * @example ["https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"]
   * @default []
   */
  additionalBlockLists: string[];
  /**
   * Disable the default blocklists.
   * @default false
   */
  disableDefaultLists: boolean;
}

export default createPlugin({
  name: () => t('plugins.adblocker.name'),
  description: () => t('plugins.adblocker.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    cache: true,
    blocker: blockers.InPlayer,
    additionalBlockLists: [],
    disableDefaultLists: false,
  } as AdblockerConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.adblocker.menu.blocker'),
        submenu: Object.values(blockers).map((blocker) => ({
          label: blocker,
          type: 'radio',
          checked: (config.blocker || blockers.WithBlocklists) === blocker,
          click() {
            setConfig({ blocker });
          },
        })),
      },
    ];
  },
  renderer: {
    async onPlayerApiReady(_, { getConfig }) {
      const config = await getConfig();
      if (config.blocker === blockers.AdSpeedup) {
        loadAdSpeedup();
      }
    },
    onConfigChange(newConfig) {
      if (newConfig.blocker === blockers.AdSpeedup) {
        loadAdSpeedup();
      } else {
        unloadAdSpeedup();
      }
    },
    stop() {
      unloadAdSpeedup();
    },
  },
  backend: {
    mainWindow: null as BrowserWindow | null,
    async start({ getConfig, window }) {
      const config = await getConfig();
      this.mainWindow = window;

      if (config.blocker === blockers.WithBlocklists) {
        await loadAdBlockerEngine(
          window.webContents.session,
          config.cache,
          config.additionalBlockLists,
          config.disableDefaultLists,
        );
      }
    },
    stop({ window }) {
      // Also cancels lists still downloading from a cold start
      unloadAdBlockerEngine(window.webContents.session);
    },
    async onConfigChange(newConfig) {
      if (this.mainWindow) {
        if (
          newConfig.blocker === blockers.WithBlocklists &&
          !isBlockerEnabled(this.mainWindow.webContents.session)
        ) {
          await loadAdBlockerEngine(
            this.mainWindow.webContents.session,
            newConfig.cache,
            newConfig.additionalBlockLists,
            newConfig.disableDefaultLists,
          );
        } else if (newConfig.blocker !== blockers.WithBlocklists) {
          unloadAdBlockerEngine(this.mainWindow.webContents.session);
        }
      }
    },
  },
  preload: {
    // see #1478
    // Runs in the main world: the pruner is defined here rather than exposed
    // through contextBridge, which cloned every parsed object across worlds.
    // JSON.parse('null') and primitives pass through untouched.
    script: `{
    const prune = (o) => {
      if (o && typeof o === 'object') {
        delete o.playerAds;
        delete o.adPlacements;
        delete o.adSlots;
        for (const key of ['playerResponse', 'ytInitialPlayerResponse']) {
          const response = o[key];
          if (response && typeof response === 'object') {
            delete response.playerAds;
            delete response.adPlacements;
            delete response.adSlots;
          }
        }
      }
      return o;
    };
    JSON.parse = new Proxy(JSON.parse, {
      apply() {
        return prune(Reflect.apply(...arguments));
      },
    });
    Response.prototype.json = new Proxy(Response.prototype.json, {
      apply() {
        return Reflect.apply(...arguments).then((o) => prune(o));
      },
    });
    } 0`,
    async start({ getConfig }) {
      const config = await getConfig();

      if (config.blocker === blockers.InPlayer && !isInjected()) {
        inject();
        await webFrame.executeJavaScript(this.script);
      }
    },
    async onConfigChange(newConfig) {
      if (newConfig.blocker === blockers.InPlayer && !isInjected()) {
        inject();
        await webFrame.executeJavaScript(this.script);
      }
    },
  },
});
