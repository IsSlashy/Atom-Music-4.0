import { LikeType, type GetState } from '@/types/datahost-get-state';

import type { YoutubePlayer } from '@/types/youtube-player';
import type {
  AlbumDetails,
  PlayerOverlays,
  VideoDataChangeValue,
} from '@/types/player-api-events';

import { queryControl } from './ytm-selectors';

import type { SongInfo } from './song-info';
import type { VideoDataChanged } from '@/types/video-data-changed';

const DATAUPDATED_FALLBACK_TIMEOUT_MS = 1500;

let songInfo: SongInfo = {} as SongInfo;
export const getSongInfo = () => songInfo;

// CFG-05: keep references to module-scope listeners / observers so they can be
// torn down (avoids duplicated song-info events and leaked observers on
// re-init after SPA re-render). Semantics of what is sent are unchanged.
const updateSongInfoListener = (_: unknown, extractedSongInfo: SongInfo) => {
  songInfo = extractedSongInfo;
};

// Idempotent registration of the module-scope listener: never register twice.
let updateSongInfoRegistered = false;
const registerUpdateSongInfoListener = () => {
  if (updateSongInfoRegistered) return;
  window.ipcRenderer.on('ytmd:update-song-info', updateSongInfoListener);
  updateSongInfoRegistered = true;
};

registerUpdateSongInfoListener();

// Observers created inside the setup helpers are tracked here so that
// teardownSongInfo() can disconnect them.
const trackedObservers = new Set<MutationObserver>();
const trackObserver = (observer: MutationObserver) => {
  trackedObservers.add(observer);
  return observer;
};

// Same for the DOM event listeners the setup helpers attach.
const trackedListeners: {
  target: EventTarget;
  type: string;
  listener: EventListener;
  capture: boolean;
}[] = [];
const listen = (
  target: EventTarget,
  type: string,
  listener: EventListener,
  capture = false,
) => {
  target.addEventListener(type, listener, capture);
  trackedListeners.push({ target, type, listener, capture });
};

// The main process asks for each setup helper ('ytmd:setup-*-listener'), once
// per plugin that needs it. A helper counts as done only once it has attached:
// one that finds no element (the new player bar lacks most of them) runs again
// on the next request, and teardownSongInfo() resets them all.
const completedSetups = new Set<string>();
const setupOnce =
  <Args extends unknown[]>(name: string, setup: (...args: Args) => boolean) =>
  (...args: Args) => {
    if (completedSetups.has(name)) return;
    if (setup(...args)) completedSetups.add(name);
  };

// Used because 'loadeddata' or 'loadedmetadata' weren't firing on song start for some users (https://github.com/th-ch/youtube-music/issues/473)
const srcChangedEvent = new CustomEvent('ytmd:src-changed');

export const setupSeekedListener = setupOnce('seeked', () => {
  const video = document.querySelector('video');
  if (!video) return false;

  listen(video, 'seeked', (v) => {
    if (v.target instanceof HTMLVideoElement) {
      window.ipcRenderer.send('ytmd:seeked', v.target.currentTime);
    }
  });
  return true;
});

// Sends the position in whole seconds, so about once per second while playing.
// It reads the <video> element, not #progress-bar, which the new player bar
// does not have. 'timeupdate' does not bubble, so the listener catches it on
// document in the capture phase, which also follows YTM replacing the element.
// Local playback plays in an <audio> element and is left out.
export const setupTimeChangedListener = setupOnce('time-changed', () => {
  let lastSecond: number | undefined;
  listen(
    document,
    'timeupdate',
    (e) => {
      if (!(e.target instanceof HTMLVideoElement)) return;
      const seconds = Math.floor(e.target.currentTime);
      if (seconds === lastSecond) return;
      lastSecond = seconds;
      window.ipcRenderer.send('ytmd:time-changed', seconds);
      songInfo.elapsedSeconds = seconds;
    },
    true,
  );
  return true;
});

// YTM's own state, which both player bars show.
const getQueueState = () =>
  document
    .querySelector<HTMLElement & { getState?: () => GetState }>('ytmusic-app')
    ?.getState?.().queue;

export const isShuffleOn = () =>
  getQueueState()?.shuffleEnabled ??
  (queryControl('playerBar')?.hasAttribute('shuffle-on') ||
    queryControl('shuffle')?.getAttribute('aria-pressed') === 'true');

// Both player bars put `player-fullscreened` on the app layout.
const getAppLayout = () => document.querySelector('ytmusic-app-layout');
export const isFullscreen = () =>
  getAppLayout()?.hasAttribute('player-fullscreened') ?? false;

// The new bar recreates its buttons when the window gets narrow and wide
// again, so the observers below watch the whole bar, which stays.
export const setupRepeatChangedListener = setupOnce('repeat-changed', () => {
  const playerBar = queryControl('playerBar');
  if (!playerBar) return false;

  // Emit the initial value as well; as it's persistent between launches.
  let repeatMode = getQueueState()?.repeatMode;
  window.ipcRenderer.send('ytmd:repeat-changed', repeatMode);

  // The repeat button's title names the mode, on both player bars
  const repeatObserver = trackObserver(
    new MutationObserver(() => {
      const newRepeatMode = getQueueState()?.repeatMode;
      if (newRepeatMode === repeatMode) return;
      repeatMode = newRepeatMode;
      window.ipcRenderer.send('ytmd:repeat-changed', repeatMode);
    }),
  );
  repeatObserver.observe(playerBar, {
    attributes: true,
    subtree: true,
    attributeFilter: ['title'],
  });
  return true;
});

const mapLikeStatus = (status: string | null): LikeType =>
  Object.values(LikeType).includes(status as LikeType)
    ? (status as LikeType)
    : LikeType.Indifferent;

const LIKE_STATUS_ATTRIBUTE = 'like-status';

// The classic pair has a like-status attribute. In the new bar, the pressed
// button tells.
const readLikeStatus = (): LikeType => {
  const likeControl = queryControl('like');
  if (likeControl?.hasAttribute(LIKE_STATUS_ATTRIBUTE)) {
    return mapLikeStatus(likeControl.getAttribute(LIKE_STATUS_ATTRIBUTE));
  }
  const isPressed = (key: 'likeButton' | 'dislikeButton') =>
    queryControl(key)?.getAttribute('aria-pressed') === 'true';
  if (isPressed('likeButton')) return LikeType.Like;
  if (isPressed('dislikeButton')) return LikeType.Dislike;
  return LikeType.Indifferent;
};

export const setupLikeChangedListener = setupOnce('like-changed', () => {
  const playerBar = queryControl('playerBar');
  if (!playerBar || !queryControl('like')) return false;

  let likeStatus = readLikeStatus();
  const likeDislikeObserver = trackObserver(
    new MutationObserver(() => {
      const newLikeStatus = readLikeStatus();
      if (newLikeStatus === likeStatus) return;
      likeStatus = newLikeStatus;
      window.ipcRenderer.send('ytmd:like-changed', likeStatus);
    }),
  );
  likeDislikeObserver.observe(playerBar, {
    attributes: true,
    subtree: true,
    attributeFilter: [LIKE_STATUS_ATTRIBUTE, 'aria-pressed'],
  });

  // Emit the initial value as well; as it's persistent between launches.
  window.ipcRenderer.send('ytmd:like-changed', likeStatus);
  return true;
});

export const setupVolumeChangedListener = setupOnce(
  'volume-changed',
  (api: YoutubePlayer) => {
    const video = document.querySelector('video');
    if (video) {
      listen(video, 'volumechange', () => {
        window.ipcRenderer.send('ytmd:volume-changed', {
          state: api.getVolume(),
          isMuted: api.isMuted(),
        });
      });
    }

    // Emit the initial value as well; as it's persistent between launches.
    window.ipcRenderer.send('ytmd:volume-changed', {
      state: api.getVolume(),
      isMuted: api.isMuted(),
    });
    return video !== null;
  },
);

export const setupShuffleChangedListener = setupOnce('shuffle-changed', () => {
  const playerBar = queryControl('playerBar');

  if (!playerBar) {
    window.ipcRenderer.send('ytmd:shuffle-changed-supported', false);
    return false;
  }

  // The classic bar sets shuffle-on on itself, the new one aria-pressed on its
  // shuffle button. Other buttons' aria-pressed land here too, so only a
  // change of the state is sent.
  let shuffleOn = isShuffleOn();
  const observer = trackObserver(
    new MutationObserver(() => {
      const newShuffleOn = isShuffleOn();
      if (newShuffleOn === shuffleOn) return;
      shuffleOn = newShuffleOn;
      window.ipcRenderer.send('ytmd:shuffle-changed', shuffleOn);
    }),
  );
  observer.observe(playerBar, {
    attributes: true,
    subtree: true,
    attributeFilter: ['shuffle-on', 'aria-pressed'],
  });
  return true;
});

export const setupFullScreenChangedListener = setupOnce(
  'fullscreen-changed',
  () => {
    const appLayout = getAppLayout();

    if (!appLayout) {
      window.ipcRenderer.send('ytmd:fullscreen-changed-supported', false);
      return false;
    }

    const observer = trackObserver(
      new MutationObserver(() => {
        window.ipcRenderer.send('ytmd:fullscreen-changed', isFullscreen());
      }),
    );
    observer.observe(appLayout, {
      attributeFilter: ['player-fullscreened'],
    });
    return true;
  },
);

export const setupAutoPlayChangedListener = setupOnce(
  'autoplay-changed',
  () => {
    const autoplaySlider = document.querySelector<HTMLInputElement>(
      '.autoplay > tp-yt-paper-toggle-button',
    );
    if (!autoplaySlider) return false;

    const observer = trackObserver(
      new MutationObserver(() => {
        window.ipcRenderer.send('ytmd:autoplay-changed');
      }),
    );

    observer.observe(autoplaySlider, {
      attributes: true,
      childList: false,
      subtree: false,
    });
    return true;
  },
);

// CFG-05: track the per-channel IPC listeners registered by setupSongInfo so a
// teardown can remove them, and guard against double registration on re-init.
let songInfoInitialized = false;
const setupListeners: {
  channel: string;
  listener: (...args: never[]) => void;
}[] = [];
// Tracks the <video> element and listeners attached so they can be removed.
let trackedVideo: HTMLVideoElement | null = null;
const trackedVideoListeners: { type: string; listener: (e: Event) => void }[] =
  [];

export const setupSongInfo = (api: YoutubePlayer) => {
  // Idempotent: a second call (e.g. after an SPA re-render) must not register
  // duplicate IPC listeners which would emit song-info events twice.
  if (songInfoInitialized) return;
  songInfoInitialized = true;

  const onSetup = (channel: string, listener: () => void) => {
    window.ipcRenderer.on(channel, listener);
    setupListeners.push({ channel, listener });
  };

  onSetup('ytmd:setup-time-changed-listener', () => {
    setupTimeChangedListener();
  });

  onSetup('ytmd:setup-like-changed-listener', () => {
    setupLikeChangedListener();
  });

  onSetup('ytmd:setup-repeat-changed-listener', () => {
    setupRepeatChangedListener();
  });

  onSetup('ytmd:setup-volume-changed-listener', () => {
    setupVolumeChangedListener(api);
  });

  onSetup('ytmd:setup-shuffle-changed-listener', () => {
    setupShuffleChangedListener();
  });

  onSetup('ytmd:setup-fullscreen-changed-listener', () => {
    setupFullScreenChangedListener();
  });

  onSetup('ytmd:setup-autoplay-changed-listener', () => {
    setupAutoPlayChangedListener();
  });

  onSetup('ytmd:setup-seeked-listener', () => {
    setupSeekedListener();
  });

  const playPausedHandler = (e: Event, status: string) => {
    if (
      e.target instanceof HTMLVideoElement &&
      Math.round(e.target.currentTime) > 0
    ) {
      window.ipcRenderer.send('ytmd:play-or-paused', {
        isPaused: status === 'pause',
        elapsedSeconds: Math.floor(e.target.currentTime),
      });
    }
  };

  const playPausedHandlers = {
    playing: (e: Event) => playPausedHandler(e, 'playing'),
    pause: (e: Event) => playPausedHandler(e, 'pause'),
  };

  const videoEventDispatcher = async (
    name: string,
    videoData: VideoDataChangeValue,
    // eslint-disable-next-line @typescript-eslint/require-await
  ) =>
    document.dispatchEvent(
      new CustomEvent<VideoDataChanged>('videodatachange', {
        detail: { name, videoData },
      }),
    );

  const waitingEvent = new Set<string>();
  const waitingTimeouts = new Map<string, NodeJS.Timeout>();

  const clearVideoTimeout = (videoId: string) => {
    const timeoutId = waitingTimeouts.get(videoId);

    if (timeoutId) {
      clearTimeout(timeoutId);
      waitingTimeouts.delete(videoId);
    }
  };

  // Name = "dataloaded" and abit later "dataupdated"
  // Sometimes "dataupdated" is not fired, so we need to fallback to "dataloaded"
  api.addEventListener('videodatachange', (name, videoData) => {
    videoEventDispatcher(name, videoData);

    if (name === 'dataupdated' && waitingEvent.has(videoData.videoId)) {
      waitingEvent.delete(videoData.videoId);
      clearVideoTimeout(videoData.videoId);
      sendSongInfo(videoData);
    } else if (name === 'dataloaded') {
      const video = document.querySelector<HTMLVideoElement>('video');
      video?.dispatchEvent(srcChangedEvent);

      for (const status of ['playing', 'pause'] as const) {
        // for fix issue that pause event not fired
        video?.addEventListener(status, playPausedHandlers[status]);
      }

      clearVideoTimeout(videoData.videoId);
      waitingEvent.add(videoData.videoId);

      const timeoutId = setTimeout(() => {
        if (waitingEvent.has(videoData.videoId)) {
          waitingEvent.delete(videoData.videoId);
          waitingTimeouts.delete(videoData.videoId);
          sendSongInfo(videoData);
        }
      }, DATAUPDATED_FALLBACK_TIMEOUT_MS);

      waitingTimeouts.set(videoData.videoId, timeoutId);
    }
  });

  const video = document.querySelector('video');

  if (video) {
    // CFG-05: capture the video reference and its listeners so teardown can
    // detach them.
    trackedVideo = video;
    for (const status of ['playing', 'pause'] as const) {
      video.addEventListener(status, playPausedHandlers[status]);
      trackedVideoListeners.push({
        type: status,
        listener: playPausedHandlers[status],
      });
    }

    if (!isNaN(video.duration)) {
      const {
        title,
        author,
        video_id: videoId,
        list: playlistId,
      } = api.getVideoData();

      const watchNextResponse = api.getWatchNextResponse();

      sendSongInfo({
        title,
        author,
        videoId,
        playlistId,

        isUpcoming: false,
        lengthSeconds: video.duration,
        loading: true,

        ytmdWatchNextResponse: watchNextResponse,
      } satisfies VideoDataChangeValue);
    }
  }

  function sendSongInfo(videoData: VideoDataChangeValue) {
    const data = api.getPlayerResponse();

    let playerOverlay: PlayerOverlays | undefined;

    if (!videoData.ytmdWatchNextResponse) {
      playerOverlay = (
        Object.entries(videoData).find(
          ([, value]) => value && Object.hasOwn(value, 'playerOverlays'),
        ) as [string, AlbumDetails | undefined]
      )?.[1]?.playerOverlays;
    } else {
      playerOverlay = videoData.ytmdWatchNextResponse?.playerOverlays;
    }
    data.videoDetails.album =
      playerOverlay?.playerOverlayRenderer?.browserMediaSession?.browserMediaSessionRenderer?.album?.runs?.at(
        0,
      )?.text;
    data.videoDetails.elapsedSeconds = 0;
    data.videoDetails.isPaused = false;

    window.ipcRenderer.send('ytmd:video-src-changed', data);
  }
};

/**
 * CFG-05: Tear down every listener / observer registered by this module so a
 * subsequent re-init does not duplicate song-info events nor leak observers.
 * Safe to call even if setup never ran (no-op for what isn't registered).
 */
export const teardownSongInfo = () => {
  // Disconnect all tracked MutationObservers.
  for (const observer of trackedObservers) {
    observer.disconnect();
  }
  trackedObservers.clear();

  // Detach the tracked DOM listeners and let every setup helper attach again.
  for (const { target, type, listener, capture } of trackedListeners) {
    target.removeEventListener(type, listener, capture);
  }
  trackedListeners.length = 0;
  completedSetups.clear();

  // Remove the per-channel IPC listeners registered by setupSongInfo.
  for (const { channel, listener } of setupListeners) {
    window.ipcRenderer.off(channel, listener as never);
  }
  setupListeners.length = 0;

  // Detach the tracked video listeners.
  if (trackedVideo) {
    for (const { type, listener } of trackedVideoListeners) {
      trackedVideo.removeEventListener(type, listener);
    }
  }
  trackedVideoListeners.length = 0;
  trackedVideo = null;

  // Remove the module-scope song-info listener; allow re-registration later.
  if (updateSongInfoRegistered) {
    window.ipcRenderer.off('ytmd:update-song-info', updateSongInfoListener);
    updateSongInfoRegistered = false;
  }

  songInfoInitialized = false;
};
