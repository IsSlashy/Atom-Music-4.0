import { createSignal } from 'solid-js';

import { render } from 'solid-js/web';

import { defaultConfig } from '@/config/defaults';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';
import { t } from '@/i18n';
import {
  isAlbumOrPlaylist,
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';

import { DownloadButton } from './templates/download';

import type { RendererContext } from '@/types/contexts';
import type { DownloaderPluginConfig } from './index';

let download: () => void;

const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');

// The label names MP3 only for the preset that writes one (the default).
// Source and Custom keep the codec or follow the user's arguments.
const mp3Preset = 'mp3 (256kbps)';
let selectedPreset = mp3Preset;
const buttonLabel = () =>
  selectedPreset === mp3Preset
    ? t('plugins.downloader.templates.button')
    : t('plugins.downloader.templates.button-audio');
// Progress feedback replaces the label until the downloader clears it
let showingFeedback = false;

let buttonContainer: HTMLDivElement | null = null;

type MenuEndpoint = HTMLElement & {
  data?: {
    addToPlaylistEndpoint?: { videoId?: string };
    watchEndpoint?: { videoId?: string };
  };
};

// The track a menu belongs to, from the endpoints YTM attached to its items.
// Which item has tabindex="0" depends on focus, so it does not identify the track.
const getMenuVideoId = (menu: HTMLElement) => {
  const endpoints = [
    ...menu.querySelectorAll<MenuEndpoint>('#navigation-endpoint'),
  ];
  return (
    endpoints.find((it) => it.data?.addToPlaylistEndpoint?.videoId)?.data
      ?.addToPlaylistEndpoint?.videoId ??
    endpoints.find((it) => it.data?.watchEndpoint?.videoId)?.data?.watchEndpoint
      ?.videoId
  );
};

const menuObserver = new MutationObserver(() => {
  const menu = getSongMenu();

  if (
    !menu ||
    menu.contains(buttonContainer) ||
    !(isMusicOrVideoTrack() || isAlbumOrPlaylist()) ||
    !buttonContainer
  ) {
    return;
  }

  menu.prepend(buttonContainer);
});

export const onRendererLoad = ({
  ipc,
  getConfig,
}: RendererContext<DownloaderPluginConfig>) => {
  Promise.resolve(getConfig())
    .then((config) => {
      selectedPreset = config.selectedPreset;
      if (!showingFeedback) setDownloadButtonText(buttonLabel());
    })
    .catch(console.error);

  download = () => {
    const songMenu = getSongMenu();
    const hrefs = [
      ...(songMenu?.querySelectorAll('#navigation-endpoint') ?? []),
    ].map((it) => it.getAttribute('href') ?? '');

    const playlistHref = hrefs.find((href) => href.includes('?playlist='));
    if (playlistHref) {
      ipc.invoke(
        'download-playlist-request',
        playlistHref.startsWith('watch?')
          ? defaultConfig.url + '/' + playlistHref
          : playlistHref,
      );
      return;
    }

    let videoUrl: string | undefined;
    const videoId = songMenu ? getMenuVideoId(songMenu) : undefined;
    const podcastHref = hrefs.find((href) => href.startsWith('podcast/'));
    if (videoId) {
      videoUrl = defaultConfig.url + '/watch?v=' + videoId;
    } else if (podcastHref) {
      videoUrl =
        defaultConfig.url + '/watch?' + podcastHref.replace('podcast/', 'v=');
    } else if (!songMenu || isPlayerMenu(songMenu)) {
      // Only the player bar menu stands for the track that is playing
      videoUrl = getSongInfo().url || window.location.href;
    } else {
      console.warn('[Downloader] No track found in this menu');
      return;
    }

    ipc.invoke('download-song', videoUrl);
  };

  ipc.on('downloader-feedback', (feedback: string) => {
    showingFeedback = Boolean(feedback);
    const targetHtml = feedback || buttonLabel();
    setDownloadButtonText(targetHtml);
  });
};

export const onConfigChange = (config: DownloaderPluginConfig) => {
  selectedPreset = config.selectedPreset;
  if (!showingFeedback) setDownloadButtonText(buttonLabel());
};

export const onPlayerApiReady = () => {
  setDownloadButtonText(buttonLabel());

  buttonContainer = document.createElement('div');
  buttonContainer.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  buttonContainer.setAttribute('aria-disabled', 'false');
  buttonContainer.setAttribute('aria-selected', 'false');
  buttonContainer.setAttribute('role', 'option');
  buttonContainer.setAttribute('tabindex', '-1');

  render(
    () => <DownloadButton onClick={download} text={downloadButtonText()} />,
    buttonContainer,
  );

  menuObserver.observe(document.querySelector('ytmusic-popup-container')!, {
    childList: true,
    subtree: true,
  });
};
