import { render } from 'solid-js/web';

import { createSignal, Show, untrack } from 'solid-js';

import {
  buttonSwitcherStyles as buttonSwitcherStyle,
  forceHideStyles as forceHideStyle,
  pipButtonStyles as pipButtonStyle,
} from './styles';

import { createPlugin } from '@/utils';
import { moveVolumeHud as preciseVolumeMoveVolumeHud } from '@/plugins/precise-volume/renderer';
import { type ThumbnailElement } from '@/types/get-player-response';
import { t } from '@/i18n';
import { type MenuTemplate } from '@/menu';

import { VideoSwitchButton } from './templates/video-switch-button';

export type VideoTogglePluginConfig = {
  enabled: boolean;
  hideVideo: boolean;
  mode: 'custom' | 'native' | 'disabled';
  forceHide: boolean;
  align: 'left' | 'middle' | 'right';
};

export default createPlugin({
  name: () => t('plugins.video-toggle.name'),
  description: () => t('plugins.video-toggle.description'),
  restartNeeded: true,
  config: {
    enabled: true,
    hideVideo: false,
    mode: 'custom',
    forceHide: false,
    align: 'middle',
  } as VideoTogglePluginConfig,
  stylesheets: [buttonSwitcherStyle, forceHideStyle, pipButtonStyle],
  menu: async ({ getConfig, setConfig }): Promise<MenuTemplate> => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.video-toggle.menu.mode.label'),
        submenu: [
          {
            label: t('plugins.video-toggle.menu.mode.submenu.custom'),
            type: 'radio',
            checked: config.mode === 'custom',
            click() {
              setConfig({ mode: 'custom' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.mode.submenu.native'),
            type: 'radio',
            checked: config.mode === 'native',
            click() {
              setConfig({ mode: 'native' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.mode.submenu.disabled'),
            type: 'radio',
            checked: config.mode === 'disabled',
            click() {
              setConfig({ mode: 'disabled' });
            },
          },
        ],
      },
      {
        label: t('plugins.video-toggle.menu.align.label'),
        submenu: [
          {
            label: t('plugins.video-toggle.menu.align.submenu.left'),
            type: 'radio',
            checked: config.align === 'left',
            click() {
              setConfig({ align: 'left' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.align.submenu.middle'),
            type: 'radio',
            checked: config.align === 'middle',
            click() {
              setConfig({ align: 'middle' });
            },
          },
          {
            label: t('plugins.video-toggle.menu.align.submenu.right'),
            type: 'radio',
            checked: config.align === 'right',
            click() {
              setConfig({ align: 'right' });
            },
          },
        ],
      },
      {
        label: t('plugins.video-toggle.menu.force-hide'),
        type: 'checkbox',
        checked: config.forceHide,
        click(item) {
          setConfig({ forceHide: item.checked });
        },
      },
    ];
  },

  renderer: {
    config: null as VideoTogglePluginConfig | null,
    // Set by onPlayerApiReady: applyMode switches modes live, teardown undoes
    // everything the plugin added to the player.
    applyMode: null as ((config: VideoTogglePluginConfig) => void) | null,
    teardown: null as (() => void) | null,
    applyStyleClass: (config: VideoTogglePluginConfig) => {
      if (config.forceHide) {
        document.body.classList.add('video-toggle-force-hide');
        document.body.classList.remove('video-toggle-custom-mode');
      } else if (!config.mode || config.mode === 'custom') {
        document.body.classList.add('video-toggle-custom-mode');
        document.body.classList.remove('video-toggle-force-hide');
      } else {
        // native / disabled mode: clean up our custom classes
        document.body.classList.remove(
          'video-toggle-custom-mode',
          'video-toggle-force-hide',
        );
      }
    },
    applyModeAttributes: (config: VideoTogglePluginConfig) => {
      if (config.forceHide) {
        return;
      }

      switch (config.mode) {
        case 'native': {
          document
            .querySelector('ytmusic-player-page')
            ?.setAttribute('has-av-switcher', '');
          document
            .querySelector('ytmusic-player')
            ?.setAttribute('has-av-switcher', '');
          document
            .querySelector('ytmusic-av-toggle')
            ?.removeAttribute('toggle-disabled');
          return;
        }

        case 'disabled': {
          document
            .querySelector('ytmusic-player-page')
            ?.removeAttribute('has-av-switcher');
          document
            .querySelector('ytmusic-player')
            ?.removeAttribute('has-av-switcher');
          document
            .querySelector('ytmusic-av-toggle')
            ?.setAttribute('toggle-disabled', '');
          return;
        }
      }
    },
    async start({ getConfig }) {
      const config = await getConfig();
      this.applyStyleClass(config);
      this.applyModeAttributes(config);
    },
    async onPlayerApiReady(api, { getConfig, setConfig }) {
      const [showButton, setShowButton] = createSignal(true);

      const config = await getConfig();
      this.config = config;

      const moveVolumeHud = (await window.mainConfig.plugins.isEnabled(
        'precise-volume',
      ))
        ? (preciseVolumeMoveVolumeHud as (_: boolean) => void)
        : () => {};

      // YTM replaces <ytmusic-player> when the window crosses a layout
      // breakpoint, so attachToPlayer() refreshes these.
      let player: (HTMLElement & { videoMode_: boolean }) | null = null;
      let video: HTMLVideoElement | null = null;

      // A signal, so a switch re-mounted by <Show> (after a song-only track)
      // starts in the real state instead of "video".
      const [showingVideo, setShowingVideo] = createSignal(!config.hideVideo);

      const switchButtonContainer = document.createElement('div');
      switchButtonContainer.id = 'ytmd-video-toggle-switch-button-container';
      switchButtonContainer.style.display = 'flex';
      const disposeSwitchButton = render(
        () => (
          <Show when={showButton()}>
            <VideoSwitchButton
              checked={showingVideo()}
              onChange={(e) => {
                const target = e.target as HTMLInputElement;

                setVideoState(target.checked, true);
              }}
              onClick={(e) => e.stopPropagation()}
              songButtonText={t('plugins.video-toggle.templates.button-song')}
              videoButtonText={t('plugins.video-toggle.templates.button-video')}
            />
          </Show>
        ),
        switchButtonContainer,
      );

      // NOTE: Picture-in-Picture is now handled by the dedicated
      // `picture-in-picture` plugin (manual toggle via hotkey, song menu and the
      // player minimize button). The previous homemade auto-PiP called
      // requestPictureInPicture() from a MutationObserver (no user gesture ->
      // NotAllowedError, silently swallowed) and fought renderer.ts's
      // ghost-collapse of #song-media-window, which made the mini-player /
      // detach-to-desktop feature unreliable. Removed on purpose.

      const forceThumbnail = (img: HTMLImageElement) => {
        const thumbnails: ThumbnailElement[] =
          api?.getPlayerResponse()?.videoDetails?.thumbnail?.thumbnails ?? [];
        if (thumbnails && thumbnails.length > 0) {
          const thumbnail = thumbnails.at(-1)?.url.split('?')[0];
          if (thumbnail) img.src = thumbnail;
        }
      };

      // youtube-player.ts types this with one argument, but YTM takes a
      // (min, max) range.
      const setQualityRange = (quality: string) =>
        (
          api as unknown as {
            setPlaybackQualityRange: (min: string, max: string) => void;
          }
        ).setPlaybackQualityRange(quality, quality);

      // Song mode only hides the video, so it caps the stream at 240p instead
      // of letting YTM fetch and decode a stream nobody sees. Not 144p: there
      // YTM also drops the audio from opus 251 to opus 250.
      const songQuality = 'small';
      let qualityCapped = false;
      // What YTM played before the cap, 480p until one is seen.
      let videoQuality = 'large';
      let qualityTimer: ReturnType<typeof setTimeout> | undefined;

      const capQuality = () => {
        clearTimeout(qualityTimer);
        if (!qualityCapped) {
          const current = api.getPlaybackQuality();
          if (
            current &&
            !['tiny', songQuality, 'auto', 'unknown'].includes(current)
          ) {
            videoQuality = current;
          }
        }
        qualityCapped = true;
        setQualityRange(songQuality);
      };

      // 'auto' alone keeps playing the capped video already buffered, about a
      // minute ahead. Pinning a real quality for a moment makes YTM fetch
      // again, then 'auto' hands the choice back to it.
      const liftQuality = () => {
        clearTimeout(qualityTimer);
        if (!qualityCapped) {
          setQualityRange('auto');
          return;
        }
        qualityCapped = false;
        setQualityRange(videoQuality);
        qualityTimer = setTimeout(() => setQualityRange('auto'), 3000);
      };

      // Left alone in picture-in-picture, where the video stays on screen. A
      // song-only track streams no video, and capping there would only start
      // the next music video capped.
      const applyQuality = (showVideo: boolean) => {
        if (document.pictureInPictureElement) {
          return;
        }

        if (showVideo) {
          liftQuality();
        } else if (
          api.getPlayerResponse()?.videoDetails?.musicVideoType !==
          'MUSIC_VIDEO_TYPE_ATV'
        ) {
          capQuality();
        }
      };

      // `persist` is true only for a user click on the switch. Automatic
      // switches (song-only tracks, initial sync) must not overwrite the saved
      // preference, otherwise one song-only track turns video mode off for good.
      const setVideoState = (showVideo: boolean, persist = false) => {
        // Don't hide the video while it's playing in PiP — that would cause a black screen.
        // Re-sync the checkbox so it doesn't stay in an inconsistent (song) state.
        if (!showVideo && document.pictureInPictureElement) {
          const checkbox = document.querySelector<HTMLInputElement>(
            '.video-switch-button-checkbox',
          ); // custom mode
          if (checkbox) checkbox.checked = untrack(showingVideo);
          return;
        }

        setShowingVideo(showVideo);

        if (persist) {
          if (this.config) {
            this.config.hideVideo = !showVideo;
          }
          // Through ytmd:set-config, so the main process stores only this
          // field and sends 'config-changed' right away. A write from the
          // preload store reached the main process watcher late.
          setConfig({ hideVideo: !showVideo });
        }

        applyQuality(showVideo);

        if (player) {
          player.style.margin = showVideo ? '' : 'auto 0px';
          player.setAttribute(
            'playback-mode',
            showVideo ? 'OMV_PREFERRED' : 'ATV_PREFERRED',
          );

          const songVideo = document.querySelector<HTMLElement>(
            '#song-video.ytmusic-player',
          );
          if (songVideo) songVideo.style.display = showVideo ? 'block' : 'none';
          const songImageContainer =
            document.querySelector<HTMLElement>('#song-image');
          if (songImageContainer) {
            songImageContainer.style.display = showVideo ? 'none' : 'block';
          }

          // Force thumbnail when switching to song mode to avoid grey background
          if (!showVideo) {
            const restoreImage = () => {
              const songImage = document.querySelector<HTMLImageElement>(
                '#song-image #img.style-scope.yt-img-shadow',
              );
              if (songImage) {
                forceThumbnail(songImage);
                // Ensure the image is actually visible
                songImage.style.display = '';
                songImage.style.visibility = 'visible';
                songImage.style.opacity = '1';
              }
              // Also ensure the yt-img-shadow container is visible
              const ytImgShadow = document.querySelector<HTMLElement>(
                '#song-image yt-img-shadow',
              );
              if (ytImgShadow) {
                ytImgShadow.style.display = '';
                ytImgShadow.style.visibility = 'visible';
              }
            };
            // Run immediately and retry after YouTube Music's async updates
            restoreImage();
            setTimeout(restoreImage, 200);
            setTimeout(restoreImage, 600);
          }

          if (showVideo && video && !video.style.top) {
            video.style.top = `${
              (player.clientHeight - video.clientHeight) / 2
            }px`;
          }

          moveVolumeHud(showVideo);
        }

        // Workaround (th-ch/youtube-music#2459): force YouTube Music to
        // recompute the player geometry after toggling song<->video, otherwise
        // the video can end up with a wrong size / a black area.
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('resize'));
        });
      };

      const videoStarted = () => {
        const type = api.getPlayerResponse()?.videoDetails?.musicVideoType;
        // No track yet (e.g. startup on the home page): the player response is
        // still null. The next ytmd:src-changed calls this again.
        if (!type) {
          return;
        }

        if (type === 'MUSIC_VIDEO_TYPE_ATV') {
          // Video doesn't exist -> switch to song mode
          setVideoState(false);
          // Hide toggle button
          setShowButton(false);
        } else {
          const songImage = document.querySelector<HTMLImageElement>(
            '#song-image #img.style-scope.yt-img-shadow',
          );
          if (!songImage) {
            return;
          }
          // Switch to high-res thumbnail
          forceThumbnail(songImage);
          // Show toggle button
          setShowButton(true);
          // Change display to video mode if video exist & video is hidden & option.hideVideo = false
          if (
            !this.config?.hideVideo &&
            document.querySelector<HTMLElement>('#song-video.ytmusic-player')
              ?.style.display === 'none'
          ) {
            setVideoState(true);
          } else {
            moveVolumeHud(!this.config?.hideVideo);
            // YTM picks the quality again for each track.
            applyQuality(untrack(showingVideo));
          }
        }
      };

      // Observers bound to the current player nodes, replaced on re-attach.
      let modeObserver: MutationObserver | null = null;
      let thumbnailObserver: MutationObserver | null = null;

      /**
       * On load, after a delay, the page overrides the playback-mode to 'OMV_PREFERRED' which causes weird aspect ratio in the image container
       * this function fix the problem by overriding that override :)
       */
      const forcePlaybackMode = () => {
        modeObserver?.disconnect();
        modeObserver = null;
        if (player) {
          const playbackModeObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (mutation.target instanceof HTMLElement) {
                const target = mutation.target;
                if (target.getAttribute('playback-mode') !== 'ATV_PREFERRED') {
                  playbackModeObserver.disconnect();
                  target.setAttribute('playback-mode', 'ATV_PREFERRED');
                }
              }
            }
          });
          playbackModeObserver.observe(player, {
            attributeFilter: ['playback-mode'],
          });
          modeObserver = playbackModeObserver;
        }
      };

      const observeThumbnail = () => {
        thumbnailObserver?.disconnect();
        thumbnailObserver = null;
        const songImage = document.querySelector(
          '#song-image #img.style-scope.yt-img-shadow',
        );
        if (!songImage) {
          return;
        }

        const playbackModeObserver = new MutationObserver((mutations) => {
          if (!player?.videoMode_) {
            return;
          }

          for (const mutation of mutations) {
            if (mutation.target instanceof HTMLImageElement) {
              const target = mutation.target;
              if (!target.src.startsWith('data:')) {
                continue;
              }

              forceThumbnail(target);
            }
          }
        });
        playbackModeObserver.observe(songImage, { attributeFilter: ['src'] });
        thumbnailObserver = playbackModeObserver;
      };

      // A PiP window shows the video even in song mode, so lift the cap there.
      const onEnterPictureInPicture = () => liftQuality();
      const onLeavePictureInPicture = () => applyQuality(untrack(showingVideo));

      const bindVideo = (newVideo: HTMLVideoElement | null) => {
        video?.removeEventListener('ytmd:src-changed', videoStarted);
        video?.removeEventListener(
          'enterpictureinpicture',
          onEnterPictureInPicture,
        );
        video?.removeEventListener(
          'leavepictureinpicture',
          onLeavePictureInPicture,
        );

        video = newVideo;
        if (video) {
          // Fix black video
          video.style.height = 'auto';
          video.addEventListener('ytmd:src-changed', videoStarted);
          video.addEventListener(
            'enterpictureinpicture',
            onEnterPictureInPicture,
          );
          video.addEventListener(
            'leavepictureinpicture',
            onLeavePictureInPicture,
          );
        }
      };

      const isAttached = () =>
        switchButtonContainer.isConnected &&
        document.querySelector('ytmusic-player') === player &&
        document.querySelector('video') === video;

      // Puts the switch into the current player and re-binds everything that
      // lives on the player nodes.
      const attachToPlayer = () => {
        const target = document.querySelector<HTMLElement>('#player');
        const currentPlayer = document.querySelector<
          HTMLElement & { videoMode_: boolean }
        >('ytmusic-player');
        if (!target || !currentPlayer) {
          return;
        }

        if (switchButtonContainer.parentElement !== target) {
          target.prepend(switchButtonContainer);
        }
        player = currentPlayer;
        const currentVideo = document.querySelector<HTMLVideoElement>('video');
        if (currentVideo !== video) {
          bindVideo(currentVideo);
        }

        setVideoState(untrack(showingVideo));
        forcePlaybackMode();
        observeThumbnail();
        videoStarted();
      };

      const applyAlign = (align: VideoTogglePluginConfig['align']) => {
        switch (align) {
          case 'right': {
            switchButtonContainer.style.justifyContent = 'flex-end';
            return;
          }

          case 'middle': {
            switchButtonContainer.style.justifyContent = 'center';
            return;
          }

          default:
          case 'left': {
            switchButtonContainer.style.justifyContent = 'flex-start';
          }
        }
      };

      let customModeActive = false;
      let attachTimer: ReturnType<typeof setTimeout> | undefined;
      let playerPageObserver: MutationObserver | null = null;

      const startCustomMode = (align: VideoTogglePluginConfig['align']) => {
        customModeActive = true;
        applyAlign(align);

        // Deferred like upstream 01161886: #player can be missing this early.
        attachTimer = setTimeout(() => {
          attachTimer = undefined;
          attachToPlayer();
        }, 0);

        // YTM rebuilds <ytmusic-player> at some window sizes, which dropped
        // the switch for good. At most one cheap check every 250 ms.
        const playerPage = document.querySelector('ytmusic-player-page');
        if (playerPage) {
          playerPageObserver = new MutationObserver(() => {
            if (attachTimer) {
              return;
            }

            attachTimer = setTimeout(() => {
              attachTimer = undefined;
              if (!isAttached()) {
                attachToPlayer();
              }
            }, 250);
          });
          playerPageObserver.observe(playerPage, {
            childList: true,
            subtree: true,
          });
        }
      };

      // Hands the player back to YTM: removes the switch, the observers, the
      // listeners, our inline styles and the quality cap.
      const stopCustomMode = () => {
        if (!customModeActive) {
          return;
        }
        customModeActive = false;

        clearTimeout(attachTimer);
        attachTimer = undefined;
        playerPageObserver?.disconnect();
        playerPageObserver = null;
        modeObserver?.disconnect();
        modeObserver = null;
        thumbnailObserver?.disconnect();
        thumbnailObserver = null;

        switchButtonContainer.remove();

        if (player) {
          player.style.margin = '';
        }
        const songVideo = document.querySelector<HTMLElement>(
          '#song-video.ytmusic-player',
        );
        if (songVideo) songVideo.style.display = '';
        const songImage = document.querySelector<HTMLElement>('#song-image');
        if (songImage) songImage.style.display = '';
        if (video) {
          video.style.top = '';
          video.style.height = '';
        }

        bindVideo(null);
        player = null;
        liftQuality();
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('resize'));
        });
      };

      const isCustomMode = (mode: VideoTogglePluginConfig['mode']) =>
        mode !== 'native' && mode !== 'disabled';

      this.applyMode = (newConfig) => {
        stopCustomMode();
        this.applyModeAttributes(newConfig);
        if (isCustomMode(newConfig.mode)) {
          startCustomMode(newConfig.align);
        }
      };
      this.teardown = () => {
        stopCustomMode();
        disposeSwitchButton();
      };

      if (isCustomMode(config.mode)) {
        startCustomMode(config.align);
      }
    },
    stop() {
      this.teardown?.();
      this.teardown = null;
      this.applyMode = null;
      document.body.classList.remove(
        'video-toggle-custom-mode',
        'video-toggle-force-hide',
      );
    },
    onConfigChange(newConfig) {
      const oldConfig = this.config;
      this.config = newConfig;
      this.applyStyleClass(newConfig);

      // Changing the mode live used to leave the custom switch behind as a
      // raw checkbox, with the video still offset.
      if (
        oldConfig &&
        (oldConfig.mode !== newConfig.mode ||
          oldConfig.forceHide !== newConfig.forceHide ||
          oldConfig.align !== newConfig.align)
      ) {
        this.applyMode?.(newConfig);
      }
    },
  },
});
