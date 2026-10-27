import { app } from 'electron';

import { registerCallback, SongInfoEvent } from '@/providers/song-info';
import { createBackend } from '@/utils';

import { DiscordService } from './discord-service';
import { TIME_UPDATE_DEBOUNCE_MS } from './constants';

import type { DiscordPluginConfig } from './index';

export let discordService = null as DiscordService | null;
// start() runs again each time the plugin is enabled, and song-info callbacks
// cannot be unregistered, so the callback is registered once per app run.
let callbackRegistered = false;

export const backend = createBackend<
  {
    config?: DiscordPluginConfig;
    lastTimeUpdateSent: number;
  },
  DiscordPluginConfig
>({
  lastTimeUpdateSent: 0,

  async start(ctx) {
    // Get initial configuration from the context
    const config = await ctx.getConfig();
    discordService = new DiscordService(ctx.window, config);

    if (config.enabled) {
      const init = () => {
        discordService?.connect(!config.autoReconnect);

        if (callbackRegistered) return;
        callbackRegistered = true;

        registerCallback((songInfo, event) => {
          if (!discordService?.isConnected()) return;

          if (event !== SongInfoEvent.TimeChanged) {
            discordService?.updateActivity(songInfo);
            this.lastTimeUpdateSent = Date.now();
          } else {
            const now = Date.now();
            if (now - this.lastTimeUpdateSent > TIME_UPDATE_DEBOUNCE_MS) {
              discordService?.updateActivity(songInfo);
              this.lastTimeUpdateSent = now; // Record the time of this debounced update
            }
          }
        });
      };

      // When the plugin is enabled from the menu, ready-to-show has already
      // fired and would never call init.
      if (ctx.window.isVisible()) init();
      else ctx.window.once('ready-to-show', init);
    }

    ctx.ipc.on('ytmd:player-api-loaded', () => {
      ctx.ipc.send('ytmd:setup-time-changed-listener');
    });

    app.on('before-quit', () => {
      discordService?.cleanup();
    });
  },

  stop() {
    discordService?.cleanup();
  },

  onConfigChange(newConfig) {
    discordService?.onConfigChange(newConfig);

    const currentlyConnected = discordService?.isConnected() ?? false;
    if (newConfig.enabled && !currentlyConnected) {
      discordService?.connect(!newConfig.autoReconnect);
    } else if (!newConfig.enabled && currentlyConnected) {
      discordService?.disconnect();
    }
  },
});
