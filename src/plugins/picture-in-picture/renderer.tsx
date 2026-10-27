import { toKeyEvent } from 'keyboardevent-from-electron-accelerator';
import keyEventAreEqual from 'keyboardevents-areequal';
import { render } from 'solid-js/web';

import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';

import { t } from '@/i18n';

import { PictureInPictureButton } from './templates/picture-in-picture-button';

import type { YoutubePlayer } from '@/types/youtube-player';
import type { PictureInPicturePluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

export const onPlayerApiReady = async (
  playerApi: YoutubePlayer,
  { ipc, getConfig }: RendererContext<PictureInPicturePluginConfig>,
) => {
  const config = await getConfig();

  // ATV tracks are audio only: their video element has no frames, so native
  // PiP refuses them, or turns black when the track changes while it is open.
  // Show the cover art through a canvas stream instead.
  const artworkCanvas = document.createElement('canvas');
  const artworkVideo = document.createElement('video');
  artworkVideo.muted = true;

  const showArtworkPiP = async () => {
    const url = playerApi
      .getPlayerResponse()
      ?.videoDetails?.thumbnail?.thumbnails?.at(-1)?.url;
    if (!url) {
      throw new Error('No artwork for the current track');
    }

    const image = new Image();
    // A CORS image keeps the canvas origin-clean, which captureStream() requires
    image.crossOrigin = 'anonymous';
    image.src = url;
    await image.decode();

    artworkCanvas.width = image.naturalWidth;
    artworkCanvas.height = image.naturalHeight;
    artworkCanvas.getContext('2d')?.drawImage(image, 0, 0);
    artworkVideo.srcObject ??= artworkCanvas.captureStream();

    if (document.pictureInPictureElement !== artworkVideo) {
      await artworkVideo.play();
      await artworkVideo.requestPictureInPicture();
    }
    if (document.querySelector('video')?.paused) {
      artworkVideo.pause();
    }
  };

  // Mirror play and pause both ways, so the PiP window's button drives the music
  artworkVideo.addEventListener('play', () => {
    if (document.pictureInPictureElement === artworkVideo) {
      playerApi.playVideo();
    }
  });
  artworkVideo.addEventListener('pause', () => {
    if (document.pictureInPictureElement === artworkVideo) {
      playerApi.pauseVideo();
    }
  });
  artworkVideo.addEventListener('leavepictureinpicture', () =>
    artworkVideo.pause(),
  );
  for (const type of ['play', 'pause']) {
    // Media events do not bubble: listen in the capture phase
    document.addEventListener(
      type,
      (event) => {
        if (
          document.pictureInPictureElement !== artworkVideo ||
          event.target !== document.querySelector('video')
        ) {
          return;
        }

        if (type === 'play') {
          artworkVideo.play().catch(() => {});
        } else {
          artworkVideo.pause();
        }
      },
      true,
    );
  }

  // Keep native PiP on whatever has frames when the track changes under it
  const followTrackInPiP = () => {
    const video = document.querySelector<HTMLVideoElement>('video');
    const pipElement = document.pictureInPictureElement;
    if (!video || !pipElement) {
      return;
    }

    if (!video.videoWidth) {
      showArtworkPiP().catch(() => {});
    } else if (pipElement !== video) {
      video.requestPictureInPicture().catch(() => {});
    }
  };
  document.addEventListener(
    'resize',
    (event) => {
      if (event.target === document.querySelector('video')) {
        followTrackInPiP();
      }
    },
    true,
  );
  document.addEventListener('videodatachange', ({ detail }) => {
    if (detail.name === 'dataloaded') {
      followTrackInPiP();
    }
  });

  const pipButtonContainer = document.createElement('div');

  const togglePictureInPicture = async () => {
    if ((await getConfig()).useNativePiP) {
      const isInPiP = document.pictureInPictureElement !== null;
      const video = document.querySelector<HTMLVideoElement>('video');
      const togglePiP = () =>
        isInPiP
          ? document.exitPictureInPicture()
          : video && !video.videoWidth
            ? showArtworkPiP()
            : video?.requestPictureInPicture();

      try {
        await togglePiP();
        // Close the menu if the toggle came from it
        pipButtonContainer
          .closest<HTMLElement & { close?: () => void }>('tp-yt-iron-dropdown')
          ?.close?.();
        return true;
      } catch {}
    }

    ipc.send('plugin:toggle-picture-in-picture');
    return false;
  };

  if (config.hotkey) {
    const hotkeyEvent = toKeyEvent(config.hotkey);
    window.addEventListener('keydown', (event) => {
      if (
        keyEventAreEqual(event, hotkeyEvent) &&
        !document.querySelector<HTMLElement & { opened: boolean }>(
          'ytmusic-search-box',
        )?.opened
      ) {
        togglePictureInPicture();
      }
    });
  }

  const getPlayMinimizeButton = () =>
    document.querySelector('.player-minimize-button');
  const mouseLeaveEventListener = () =>
    document.querySelector<HTMLButtonElement>('.middle-controls')?.click();

  const pipClickEventListener = async (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    await togglePictureInPicture();
  };

  // Set on entering PiP, restored on leaving it
  let exitFullScreenButton: HTMLButtonElement | null = null;
  let onPlayerDblClick: (() => void) | undefined;

  ipc.on('ytmd:pip-toggle', (isPip: boolean) => {
    // Look the controls up now: YTM renders some of them only at some window
    // sizes or in one of its two player bars, so they can be missing at startup
    const appLayout = document.querySelector<HTMLElement>('ytmusic-app-layout');
    const expandMenu = document.querySelector<HTMLElement>('#expanding-menu');
    const player = document.querySelector<
      HTMLElement & { onDoubleClick_: (() => void) | undefined }
    >('#player');
    const titleBar = document.querySelector<HTMLElement>(
      'nav[data-ytmd-main-panel]',
    );

    if (isPip) {
      exitFullScreenButton = document.querySelector<HTMLButtonElement>(
        '.exit-fullscreen-button',
      );
      exitFullScreenButton?.addEventListener('click', pipClickEventListener);
      getPlayMinimizeButton()?.removeEventListener(
        'click',
        pipClickEventListener,
      );
      if (player) {
        onPlayerDblClick = player.onDoubleClick_;
        player.onDoubleClick_ = () => {};
      }

      expandMenu?.addEventListener('mouseleave', mouseLeaveEventListener);
      if (
        !document
          .querySelector('ytmusic-player-page')
          ?.hasAttribute('player-page-open')
      ) {
        // The full screen layout shows the player only on the player page.
        // The classic bar has a button for it, the new bar opens it on a click
        // on the bar itself.
        (
          document.querySelector<HTMLElement>('.toggle-player-page-button') ??
          document.querySelector<HTMLElement>(
            'ytmusic-app-layout > ytmusic-miniplayer',
          )
        )?.click();
      }

      // YTM's full screen layout makes the player fill the page. The window
      // stays small: the main process made it non-full-screenable first.
      if (!document.fullscreenElement) {
        document
          .querySelector<HTMLButtonElement>('.fullscreen-button')
          ?.click();
      }
      appLayout?.classList.add('pip');
      if (titleBar) {
        titleBar.style.display = 'none';
      }
    } else {
      exitFullScreenButton?.removeEventListener('click', pipClickEventListener);
      exitFullScreenButton = null;
      getPlayMinimizeButton()?.addEventListener('click', pipClickEventListener);
      if (player) {
        player.onDoubleClick_ = onPlayerDblClick;
      }
      expandMenu?.removeEventListener('mouseleave', mouseLeaveEventListener);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      appLayout?.classList.remove('pip');
      if (titleBar) {
        titleBar.style.display = 'flex';
      }
    }
  });

  getPlayMinimizeButton()?.addEventListener('click', pipClickEventListener);

  pipButtonContainer.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
    'ytmd-pip-menu-item',
  );
  pipButtonContainer.setAttribute('aria-disabled', 'false');
  pipButtonContainer.setAttribute('aria-selected', 'false');
  pipButtonContainer.setAttribute('role', 'option');
  pipButtonContainer.setAttribute('tabindex', '-1');

  render(
    () => (
      <PictureInPictureButton
        onClick={togglePictureInPicture}
        text={t('plugins.picture-in-picture.templates.button')}
      />
    ),
    pipButtonContainer,
  );

  const observer = new MutationObserver(() => {
    // YTM keeps one menu per kind of opener, and the first one in the DOM can
    // be a hidden one: look for the menu that the player bar opened
    const menu = [
      ...document.querySelectorAll<HTMLElement>(
        'ytmusic-menu-popup-renderer tp-yt-paper-listbox',
      ),
    ].find((listbox) => isPlayerMenu(listbox));

    if (!menu) {
      // A shared menu now opened by something else: drop the entry
      pipButtonContainer.remove();
      return;
    }

    if (menu.contains(pipButtonContainer) || !isMusicOrVideoTrack(menu)) {
      return;
    }

    menu.prepend(pipButtonContainer);
  });

  observer.observe(document.querySelector('ytmusic-popup-container')!, {
    childList: true,
    subtree: true,
  });
};
