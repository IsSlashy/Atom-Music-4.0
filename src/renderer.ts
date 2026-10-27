import i18next from 'i18next';

import { startingPages } from './providers/extracted-data';
import {
  isFullscreen,
  isShuffleOn,
  setupSongInfo,
} from './providers/song-info-front';
import { queryControl } from './providers/ytm-selectors';
import {
  createContext,
  forceLoadRendererPlugin,
  forceUnloadRendererPlugin,
  getAllLoadedRendererPlugins,
  getLoadedRendererPlugin,
  loadAllRendererPlugins,
} from './loader/renderer';

import { loadI18n, setLanguage, t as i18t } from '@/i18n';
import { colors, typography } from '@/theme/tokens';

import {
  defaultTrustedTypePolicy,
  registerWindowDefaultTrustedTypePolicy,
} from '@/utils/trusted-types';

import type { GetState, RepeatMode } from '@/types/datahost-get-state';
import type { PluginConfig, PluginDef } from '@/types/plugins';
import type { YoutubePlayer } from '@/types/youtube-player';
import type { QueueElement } from '@/types/queue';
import type { QueueResponse } from '@/types/youtube-music-desktop-internal';
import type { YouTubeMusicAppElement } from '@/types/youtube-music-app-element';
import type { SearchBoxElement } from '@/types/search-box-element';

let api: (Element & YoutubePlayer) | null = null;
let isPluginLoaded = false;
let isApiLoaded = false;
let firstDataLoaded = false;

registerWindowDefaultTrustedTypePolicy();

async function listenForApiLoad() {
  // `initObserver` is the authoritative entry point: it watches the DOM for
  // `#movie_player` and calls `onApiLoaded()` exactly once (guarded by
  // `isApiLoaded`). This is only a fast path for the case where the player is
  // already present by the time plugins finish loading; it must mirror the same
  // guard so the two paths never run `onApiLoaded()` twice.
  if (!isApiLoaded) {
    const playerApi = document.querySelector<Element & YoutubePlayer>(
      '#movie_player',
    );
    if (playerApi) {
      api = playerApi;
      isApiLoaded = true;
      // Keep going on failure: main() still has to install the idle popup
      // blocker after this.
      try {
        await onApiLoaded();
      } catch (err) {
        console.error('[Atom] onApiLoaded failed:', err);
      }

      return;
    }
  }
}

/**
 * Resolves once a node matching `selector` exists in the DOM. Uses a
 * MutationObserver on `document.documentElement` (so it survives slow boots and
 * SPA re-renders) with a bounded timeout to avoid a perpetual observer. Resolves
 * `null` if the element never appears within `timeoutMs`.
 */
function waitForElement<T extends Element = Element>(
  selector: string,
  timeoutMs = 20000,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const existing = document.querySelector<T>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    let settled = false;
    const finish = (el: T | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    };

    const observer = new MutationObserver(() => {
      const found = document.querySelector<T>(selector);
      if (found) finish(found);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

// Modern Apple-inspired SVG icons for navigation tabs
const modernIcons: Record<string, { outline: string; filled: string }> = {
  home: {
    outline:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.25L12 3l9 7.25V20.5A1.5 1.5 0 0 1 19.5 22h-4a1 1 0 0 1-1-1v-5a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v5a1 1 0 0 1-1 1h-4A1.5 1.5 0 0 1 3 20.5z"/></svg>',
    filled:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12.97 2.59a1.5 1.5 0 0 0-1.94 0l-7.5 6.36A1.5 1.5 0 0 0 3 10.23V19.5A1.5 1.5 0 0 0 4.5 21H9a1 1 0 0 0 1-1v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5a1 1 0 0 0 1 1h4.5a1.5 1.5 0 0 0 1.5-1.5v-9.27a1.5 1.5 0 0 0-.53-1.14l-7.5-6.5z"/></svg>',
  },
  explore: {
    outline:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    filled:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.6 6.4l-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1zM12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>',
  },
  library: {
    outline:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="12" height="12" rx="1.5"/><path d="M6 4h10" stroke-width="1.5"/><circle cx="14" cy="12" r="3"/><circle cx="14" cy="12" r="0.75" fill="currentColor" stroke="none"/><path d="M4 8v10a2 2 0 0 0 2 2h10"/></svg>',
    filled:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-6 12.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>',
  },
  playlists: {
    outline:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="15" y2="6"/><line x1="3" y1="10" x2="13" y2="10"/><line x1="3" y1="14" x2="11" y2="14"/><circle cx="18" cy="15" r="3"/><line x1="18" y1="12" x2="18" y2="9"/></svg>',
    filled:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 5h12a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm0 4h10a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm0 4h8a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm15-4v3.17A3 3 0 1 0 20 15V11h2a1 1 0 1 0 0-2h-3a1 1 0 0 0-1 1zm0 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  },
  downloads: {
    outline:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    filled:
      '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 3a1 1 0 1 0-2 0v9.59l-2.3-2.3a1 1 0 0 0-1.4 1.42l4 4a1 1 0 0 0 1.4 0l4-4a1 1 0 0 0-1.4-1.42L13 12.59V3zM5 17a1 1 0 1 0-2 0v2a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-2a1 1 0 1 0-2 0v2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-2z"/></svg>',
  },
};

// ===== LOCAL PLAYER =====
// A downloaded file plays in an <audio> element of its own, under a bar of its
// own laid over YTM's player bar (classic or new), while YTM's video is held
// paused on a silent source.

type LocalFile = { name: string; path: string; imageSrc?: string };
type LibraryFile = LocalFile & { size: number; modified: number };

const listDownloads = async () =>
  (await window.ipcRenderer.invoke('ytmd:list-downloads')) as
    | { folder: string; files: LibraryFile[] }
    | undefined;

// 'data' asks for a local cover inline, for the media session
const getCover = async (filePath: string, format?: 'data') => {
  try {
    const result = (await window.ipcRenderer.invoke(
      'ytmd:get-cover',
      filePath,
      format,
    )) as { imageSrc: string | null } | undefined;
    return result?.imageSrc ?? null;
  } catch {
    return null;
  }
};

// "Artist - Title.mp3" gives the artist and the title
const parseFileName = (name: string) => {
  const cleanName = name.replace(/\.[^.]+$/, '');
  const parts = cleanName.split(' - ');
  return parts.length > 1
    ? { title: parts.slice(1).join(' - '), artist: parts[0] }
    : { title: cleanName, artist: '' };
};

const formatTime = (s: number) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
};

type LocalPlayback = {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (seconds: number) => void;
  /** From 0 to 100, like YTM's volume. */
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  switchRepeat: () => void;
  getRepeatMode: () => RepeatMode;
};

/**
 * The local playback in progress, or null. While it is set, the playback IPC
 * handlers in onApiLoaded() (tray, shortcuts, protocol, MPRIS) and the media
 * session (Windows SMTC, media keys) drive it instead of YTM's player.
 */
let localPlayback: LocalPlayback | null = null;

// YTM writes the media session (SMTC, media keys) on every track and play
// state change. While local playback runs, those writes are kept here instead
// of applied, and they are applied again when it stops.
const mediaSession = navigator.mediaSession;
const applyActionHandler = mediaSession.setActionHandler.bind(mediaSession);
const applyPositionState = mediaSession.setPositionState.bind(mediaSession);
const metadataAccessor = Object.getOwnPropertyDescriptor(
  MediaSession.prototype,
  'metadata',
);
const playbackStateAccessor = Object.getOwnPropertyDescriptor(
  MediaSession.prototype,
  'playbackState',
);
const pageMediaSession: {
  handlers: Map<MediaSessionAction, MediaSessionActionHandler | null>;
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  position?: MediaPositionState;
} = { handlers: new Map(), metadata: null, playbackState: 'none' };

const getMetadata = () =>
  (metadataAccessor?.get?.call(mediaSession) ?? null) as MediaMetadata | null;
const applyMetadata = (metadata: MediaMetadata | null) =>
  metadataAccessor?.set?.call(mediaSession, metadata);
const getPlaybackState = () =>
  (playbackStateAccessor?.get?.call(mediaSession) ??
    'none') as MediaSessionPlaybackState;
const applyPlaybackState = (state: MediaSessionPlaybackState) =>
  playbackStateAccessor?.set?.call(mediaSession, state);

mediaSession.setActionHandler = (action, handler) => {
  pageMediaSession.handlers.set(action, handler);
  if (!localPlayback) applyActionHandler(action, handler);
};
mediaSession.setPositionState = (state) => {
  pageMediaSession.position = state;
  if (!localPlayback) applyPositionState(state);
};
Object.defineProperties(mediaSession, {
  metadata: {
    configurable: true,
    get: getMetadata,
    set(metadata: MediaMetadata | null) {
      pageMediaSession.metadata = metadata;
      if (!localPlayback) applyMetadata(metadata);
    },
  },
  playbackState: {
    configurable: true,
    get: getPlaybackState,
    set(state: MediaSessionPlaybackState) {
      pageMediaSession.playbackState = state;
      if (!localPlayback) applyPlaybackState(state);
    },
  },
});

const localMediaActions: MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'seekto',
  'seekbackward',
  'seekforward',
];

const restorePageMediaSession = () => {
  for (const action of localMediaActions) {
    try {
      applyActionHandler(action, pageMediaSession.handlers.get(action) ?? null);
    } catch {
      // Action not supported
    }
  }
  applyMetadata(pageMediaSession.metadata);
  applyPlaybackState(pageMediaSession.playbackState);
  try {
    // No argument clears it, and the position comes from the media again
    applyPositionState(pageMediaSession.position);
  } catch {
    applyPositionState();
  }
};

const localIcons = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
  previous:
    '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
  repeat:
    '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
  repeatOne:
    '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>',
  volume:
    '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>',
};

const repeatLabels: Record<RepeatMode, string> = {
  NONE: 'Répétition désactivée',
  ALL: 'Tout répéter',
  ONE: 'Répéter le titre',
};
const nextRepeatMode: Record<RepeatMode, RepeatMode> = {
  NONE: 'ALL',
  ALL: 'ONE',
  ONE: 'NONE',
};

// Above YTM's bars (z-index 5), below its menus and dialogs. Opaque, since
// YTM's bar stays under it.
const localBarStyle = `
#ytmd-local-bar {
  position: fixed; z-index: 10; box-sizing: border-box;
  display: flex; align-items: center; gap: 12px; padding: 0 16px;
  background: ${colors.black3}; border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: ${colors.textPrimary}; font-family: ${typography.fontFamily};
  color-scheme: dark;
}
#ytmd-local-bar button {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
  width: 36px; height: 36px; padding: 0; border-radius: 50%; cursor: pointer;
  border: 1px solid ${colors.sidebarItemHover}; background: rgba(255, 255, 255, 0.04);
  color: ${colors.textSecondary};
}
#ytmd-local-bar button:hover { background: ${colors.sidebarItemActive}; color: ${colors.white}; }
#ytmd-local-bar button svg { width: 22px; height: 22px; fill: currentColor; }
#ytmd-local-bar [data-role="play-pause"] {
  width: 44px; height: 44px; background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.12); color: ${colors.white};
}
#ytmd-local-bar [data-role="play-pause"] svg { width: 28px; height: 28px; }
#ytmd-local-bar [data-role="repeat"], #ytmd-local-bar [data-role="mute"] {
  border-color: transparent; background: transparent;
}
#ytmd-local-bar [data-role="repeat"][aria-pressed="true"] { color: ${colors.accent}; }
#ytmd-local-bar [data-role="progress"] {
  position: absolute; left: 0; top: -8px; width: 100%; height: 16px; margin: 0;
  accent-color: #f00; cursor: pointer;
}
#ytmd-local-bar [data-role="time"] {
  font-size: 12px; color: ${colors.textSecondary}; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
#ytmd-local-bar [data-role="info"] { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
#ytmd-local-bar [data-role="cover"] {
  width: 40px; height: 40px; border-radius: 4px; object-fit: cover; flex-shrink: 0; background: #333;
}
#ytmd-local-bar [data-role="text"] { min-width: 0; }
#ytmd-local-bar [data-role="title"], #ytmd-local-bar [data-role="artist"] {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#ytmd-local-bar [data-role="title"] { font-size: 14px; font-weight: 600; color: ${colors.white}; }
#ytmd-local-bar [data-role="artist"] { font-size: 12px; color: ${colors.textSecondary}; }
#ytmd-local-bar [data-role="volume"] { width: 96px; margin: 0; accent-color: ${colors.white}; cursor: pointer; }
@media (max-width: 615px) {
  #ytmd-local-bar [data-role="time"], #ytmd-local-bar [data-role="repeat"],
  #ytmd-local-bar [data-role="volume"] { display: none; }
}
`;

const createLocalButton = (role: string, label: string, icon: string) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.role = role;
  button.innerHTML = icon;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
};

const playLocalFile = (file: LocalFile) => {
  // Moving to another file from the local player keeps its repeat mode and
  // volume. A first file takes YTM's.
  const previousPlayback = localPlayback;
  window.__ytmdLocalCleanup?.();
  // What YTM shows in the media session, applied again on cleanup
  pageMediaSession.metadata = getMetadata();
  pageMediaSession.playbackState = getPlaybackState();

  // Block YTM's video player to prevent auto-play/radio
  const ytVideo = document.querySelector('video');
  const stopForYtm = () => {
    window.__ytmdLocalCleanup?.();
  };
  // Kept to tell this playback's overrides from those of the next one
  let blockedPlay: (() => Promise<void>) | null = null;
  let srcOverride: ((val: string) => void) | null = null;
  // YTM does not always go through the overrides below to start a track: the
  // video playing anything but our silent source ends local playback too
  const onYtmPlay = () => {
    if (ytVideo && !ytVideo.currentSrc.startsWith('data:')) stopForYtm();
  };
  if (ytVideo) {
    ytVideo.pause();
    // Load silent audio so YTM thinks video is ready (fixes loading spinner)
    ytVideo.src =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    ytVideo.muted = true;
    ytVideo.load();
    // Override play() - but allow cleanup when YTM sets a new real src. The
    // prototype's, since a previous file's override may still be in place.
    const origPlay = HTMLMediaElement.prototype.play.bind(ytVideo);
    let localBlocked = true;
    blockedPlay = () => {
      // If YTM loaded a new real source (not our silent data URI), restore and let it play
      if (localBlocked && ytVideo.src && !ytVideo.src.startsWith('data:')) {
        localBlocked = false;
        Reflect.deleteProperty(ytVideo, 'play'); // restore the prototype's
        stopForYtm();
        return origPlay();
      }
      return Promise.resolve();
    };
    ytVideo.play = blockedPlay;
    // Also watch for src changes via setter override
    const srcAccessor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'src',
    );
    if (srcAccessor?.get && srcAccessor.set) {
      srcOverride = (val: string) => {
        srcAccessor.set!.call(ytVideo, val);
        // If YTM sets a real source, restore everything
        if (localBlocked && val && !val.startsWith('data:')) {
          localBlocked = false;
          Reflect.deleteProperty(ytVideo, 'play');
          Reflect.deleteProperty(ytVideo, 'src');
          stopForYtm();
        }
      };
      Object.defineProperty(ytVideo, 'src', {
        get: () => srcAccessor.get!.call(ytVideo) as string,
        set: srcOverride,
        configurable: true,
      });
    }
    ytVideo.addEventListener('play', onYtmPlay);
  }

  // Create or reuse hidden audio element
  let localAudio = document.getElementById(
    'ytmd-local-audio',
  ) as HTMLAudioElement | null;
  if (!localAudio) {
    localAudio = document.createElement('audio');
    localAudio.id = 'ytmd-local-audio';
    localAudio.style.display = 'none';
    document.body.appendChild(localAudio);
  }
  const audio = localAudio;
  audio.src = 'ytmd-local://file?path=' + encodeURIComponent(file.path);
  if (!previousPlayback) {
    audio.volume = Math.max(0, Math.min(1, (api?.getVolume() ?? 100) / 100));
    audio.muted = api?.isMuted() ?? false;
  }
  audio.play().catch((err) => console.error('[YTMusic] Playback error:', err));

  let repeatMode: RepeatMode =
    previousPlayback?.getRepeatMode() ??
    document
      .querySelector<HTMLElement & { getState?: () => GetState }>('ytmusic-app')
      ?.getState?.()?.queue?.repeatMode ??
    'NONE';

  const { title: songTitle, artist: songArtist } = parseFileName(file.name);
  let coverSrc = file.imageSrc;
  let localActive = true;

  // ---- LOCAL BAR, over whichever player bar YTM shows ----
  if (!document.getElementById('ytmd-local-bar-style')) {
    const style = document.createElement('style');
    style.id = 'ytmd-local-bar-style';
    style.textContent = localBarStyle;
    document.head.appendChild(style);
  }
  const bar = document.createElement('div');
  bar.id = 'ytmd-local-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Lecteur local');

  const progress = document.createElement('input');
  progress.type = 'range';
  progress.dataset.role = 'progress';
  progress.min = '0';
  progress.max = '0';
  progress.step = 'any';
  progress.value = '0';
  progress.setAttribute('aria-label', 'Position dans le titre');

  const previousButton = createLocalButton(
    'previous',
    'Précédent',
    localIcons.previous,
  );
  const playPauseButton = createLocalButton(
    'play-pause',
    'Pause',
    localIcons.pause,
  );
  const nextButton = createLocalButton('next', 'Suivant', localIcons.next);

  const time = document.createElement('span');
  time.dataset.role = 'time';
  time.textContent = '0:00 / 0:00';

  const info = document.createElement('div');
  info.dataset.role = 'info';
  const cover = document.createElement('img');
  cover.dataset.role = 'cover';
  cover.alt = '';
  const text = document.createElement('div');
  text.dataset.role = 'text';
  const titleLine = document.createElement('div');
  titleLine.dataset.role = 'title';
  titleLine.textContent = songTitle;
  titleLine.title = songTitle;
  const artistLine = document.createElement('div');
  artistLine.dataset.role = 'artist';
  artistLine.textContent = songArtist;
  text.append(titleLine, artistLine);
  info.append(cover, text);

  const repeatButton = createLocalButton(
    'repeat',
    repeatLabels[repeatMode],
    localIcons.repeat,
  );
  const muteButton = createLocalButton('mute', 'Couper le son', '');
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.dataset.role = 'volume';
  volume.min = '0';
  volume.max = '100';
  volume.step = '1';
  volume.setAttribute('aria-label', 'Volume');

  bar.append(
    progress,
    previousButton,
    playPauseButton,
    nextButton,
    time,
    info,
    repeatButton,
    muteButton,
    volume,
  );
  document.body.appendChild(bar);

  // YTM's bar stays under ours: keep focus and clicks off it
  const ytmBar = queryControl('playerBar');
  const ytmBarWasInert = ytmBar?.inert ?? false;
  if (ytmBar) ytmBar.inert = true;

  const placeBar = () => {
    const rect = queryControl('playerBar')?.getBoundingClientRect();
    if (rect && rect.height > 0) {
      bar.style.left = `${rect.left}px`;
      bar.style.top = `${rect.top}px`;
      bar.style.width = `${rect.width}px`;
      bar.style.height = `${rect.height}px`;
    } else {
      bar.style.left = '0px';
      bar.style.top = `${window.innerHeight - 72}px`;
      bar.style.width = '100%';
      bar.style.height = '72px';
    }
  };
  placeBar();
  const barResizeObserver = new ResizeObserver(placeBar);
  if (ytmBar) barResizeObserver.observe(ytmBar);
  window.addEventListener('resize', placeBar);

  // ---- MAIN PLAYER IMAGE: inject cover art into ytmusic-player ----
  const ytPlayer = document.querySelector<HTMLElement>('ytmusic-player');
  let mainCover = document.getElementById(
    'ytmd-local-main-cover',
  ) as HTMLImageElement | null;
  if (ytPlayer && !mainCover) {
    mainCover = document.createElement('img');
    mainCover.id = 'ytmd-local-main-cover';
    mainCover.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;z-index:20;background:#000;pointer-events:none;';
    // No inline position on the player: YTM positions it (relative on the
    // player page, fixed as the mini player), and an inline one left the mini
    // player stuck over the page content after local playback.
    ytPlayer.appendChild(mainCover);
  }

  const showCover = () => {
    cover.hidden = !coverSrc;
    if (coverSrc) cover.src = coverSrc;
    if (mainCover) {
      mainCover.style.display = coverSrc ? '' : 'none';
      if (coverSrc) mainCover.src = coverSrc;
    }
    // The media session refuses ytmd-local images, and the page cannot read
    // them: the main process sends a local cover inline instead
    const isMediaImage = (src: string | null | undefined): src is string =>
      !!src && /^(https?|data|blob):/.test(src);
    const applyArtwork = (src: string | null | undefined) =>
      applyMetadata(
        new MediaMetadata({
          title: songTitle,
          artist: songArtist,
          artwork: isMediaImage(src) ? [{ src }] : [],
        }),
      );
    applyArtwork(coverSrc);
    if (coverSrc && !isMediaImage(coverSrc)) {
      const shownSrc = coverSrc;
      getCover(file.path, 'data').then((src) => {
        if (localActive && coverSrc === shownSrc && isMediaImage(src)) {
          applyArtwork(src);
        }
      });
    }
  };
  // Fetch cover art if not already available
  if (!coverSrc) {
    getCover(file.path).then((src) => {
      if (!localActive || !src) return;
      coverSrc = src;
      showCover();
    });
  }

  // ---- SIDE PANEL: replace queue with local downloads list ----
  const sidePanel =
    document.querySelector<HTMLElement>(
      '#side-panel.side-panel.ytmusic-player-page',
    ) || document.querySelector<HTMLElement>('.side-panel.ytmusic-player-page');
  const sidePanelOrigChildren: { el: HTMLElement; display: string }[] = [];
  let localSidePanel = document.getElementById('ytmd-local-side-panel');
  if (sidePanel) {
    // Hide original side panel children
    Array.from(sidePanel.children).forEach((child) => {
      const el = child as HTMLElement;
      if (el.id !== 'ytmd-local-side-panel') {
        sidePanelOrigChildren.push({ el, display: el.style.display });
        el.style.display = 'none';
      }
    });
    if (!localSidePanel) {
      localSidePanel = document.createElement('div');
      localSidePanel.id = 'ytmd-local-side-panel';
      localSidePanel.style.cssText =
        'display:flex;flex-direction:column;height:100%;overflow:hidden;';
      sidePanel.appendChild(localSidePanel);
    }
    localSidePanel.style.display = '';
    localSidePanel.innerHTML = '';
    // Header
    const header = document.createElement('div');
    header.style.cssText =
      'padding:16px 20px 8px;font-size:16px;font-weight:600;color:#fff;flex-shrink:0;';
    header.textContent = 'Téléchargements';
    localSidePanel.appendChild(header);
    // Scrollable list
    const sideList = document.createElement('div');
    sideList.style.cssText = 'flex:1;overflow-y:auto;padding:4px 8px;';
    localSidePanel.appendChild(sideList);
    // Covers and labels come from file names, .meta.json files and ID3 tags:
    // build them as nodes (img.src, textContent), never as HTML.
    const createCover = (src: string) => {
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      return img;
    };
    // Fetch downloads list
    listDownloads().then((res) => {
      const dlFiles = res?.files ?? [];
      dlFiles.forEach((f) => {
        const item = document.createElement('div');
        const isPlaying = f.path === file.path;
        item.style.cssText = `display:flex;align-items:center;padding:8px 12px;border-radius:8px;cursor:pointer;gap:10px;${isPlaying ? 'background:rgba(255,255,255,0.12);' : ''}`;
        item.addEventListener('mouseenter', () => {
          if (!isPlaying) item.style.background = 'rgba(255,255,255,0.08)';
        });
        item.addEventListener('mouseleave', () => {
          if (!isPlaying) item.style.background = '';
        });
        // Thumbnail
        const thumb = document.createElement('div');
        thumb.style.cssText =
          'width:40px;height:40px;border-radius:4px;background:#333;flex-shrink:0;overflow:hidden;';
        if (f.imageSrc) {
          thumb.appendChild(createCover(String(f.imageSrc)));
        } else {
          getCover(f.path).then((src) => {
            if (src) thumb.appendChild(createCover(src));
          });
        }
        item.appendChild(thumb);
        // Title/artist
        const itemInfo = document.createElement('div');
        itemInfo.style.cssText = 'flex:1;min-width:0;';
        const { title: t, artist: a } = parseFileName(f.name);
        const itemTitle = document.createElement('div');
        itemTitle.style.cssText = `color:${isPlaying ? '#fff' : 'rgba(255,255,255,0.9)'};font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
        itemTitle.textContent = t;
        const itemArtist = document.createElement('div');
        itemArtist.style.cssText =
          'color:rgba(255,255,255,0.5);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        itemArtist.textContent = a;
        itemInfo.append(itemTitle, itemArtist);
        item.appendChild(itemInfo);
        // Now playing indicator
        if (isPlaying) {
          const indicator = document.createElement('div');
          indicator.style.cssText = 'color:#f00;font-size:18px;flex-shrink:0;';
          indicator.textContent = '♫';
          item.appendChild(indicator);
        }
        // Click to play another downloaded song. playLocalFile() ends this
        // playback itself, which keeps the repeat mode and volume.
        if (!isPlaying) {
          item.addEventListener('click', () => {
            document.dispatchEvent(
              new CustomEvent('ytmd-play-local', { detail: f }),
            );
          });
        }
        sideList.appendChild(item);
      });
    });
  }

  // ---- STATE: the audio element's events update the bar and the media
  // session (timeupdate fires about 4 times a second while playing) ----
  let userSeeking = false;
  const updateTime = () => {
    const duration = isFinite(audio.duration) ? audio.duration : 0;
    if (!userSeeking) {
      progress.max = String(duration);
      progress.value = String(audio.currentTime);
    }
    time.textContent = `${formatTime(Number(progress.value))} / ${formatTime(duration)}`;
  };
  const updatePositionState = () => {
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      applyPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch {
      // Invalid position while the source changes
    }
  };
  const updatePlayState = () => {
    const label = audio.paused ? 'Lecture' : 'Pause';
    playPauseButton.innerHTML = audio.paused
      ? localIcons.play
      : localIcons.pause;
    playPauseButton.setAttribute('aria-label', label);
    playPauseButton.title = label;
    applyPlaybackState(audio.paused ? 'paused' : 'playing');
    updatePositionState();
  };
  const updateVolume = () => {
    volume.value = String(Math.round(audio.volume * 100));
    const label = audio.muted ? 'Réactiver le son' : 'Couper le son';
    muteButton.innerHTML = audio.muted ? localIcons.muted : localIcons.volume;
    muteButton.setAttribute('aria-label', label);
    muteButton.title = label;
  };
  const updateRepeat = () => {
    repeatButton.innerHTML =
      repeatMode === 'ONE' ? localIcons.repeatOne : localIcons.repeat;
    repeatButton.setAttribute('aria-pressed', String(repeatMode !== 'NONE'));
    repeatButton.setAttribute('aria-label', repeatLabels[repeatMode]);
    repeatButton.title = repeatLabels[repeatMode];
  };
  const onTimeChange = () => {
    updateTime();
    updatePositionState();
  };

  // ---- CONTROLS ----
  const play = () => {
    if (localActive) audio.play().catch(() => {});
  };
  const pause = () => {
    if (localActive) audio.pause();
  };
  const togglePlay = () => {
    if (audio.paused) play();
    else pause();
  };
  const seekTo = (seconds: number) => {
    if (!localActive || !isFinite(audio.duration) || !isFinite(seconds)) {
      return;
    }
    audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
  };
  // The files of the downloads list, in its order, one after the other
  const playAdjacent = async (step: 1 | -1) => {
    const files = (await listDownloads())?.files ?? [];
    if (!localActive || files.length === 0) return;
    const index = files.findIndex((f) => f.path === file.path);
    const target =
      index === -1
        ? files[0]
        : files[(index + step + files.length) % files.length];
    playLocalFile(target);
  };
  const playback: LocalPlayback = {
    play,
    pause,
    togglePlay,
    next: () => {
      playAdjacent(1);
    },
    previous: () => {
      // Like YTM: back to the start first, then to the previous file
      if (audio.currentTime > 3) seekTo(0);
      else playAdjacent(-1);
    },
    seekTo,
    seekBy: (seconds) => seekTo(audio.currentTime + seconds),
    setVolume: (value) => {
      if (!isFinite(value)) return;
      const level = Math.max(0, Math.min(100, value));
      audio.volume = level / 100;
      // YTM picks up at the same level afterwards
      api?.setVolume(level);
    },
    toggleMute: () => {
      audio.muted = !audio.muted;
    },
    switchRepeat: () => {
      repeatMode = nextRepeatMode[repeatMode];
      updateRepeat();
    },
    getRepeatMode: () => repeatMode,
  };

  previousButton.addEventListener('click', playback.previous);
  playPauseButton.addEventListener('click', togglePlay);
  nextButton.addEventListener('click', playback.next);
  repeatButton.addEventListener('click', playback.switchRepeat);
  muteButton.addEventListener('click', playback.toggleMute);
  volume.addEventListener('input', () =>
    playback.setVolume(Number(volume.value)),
  );
  // Dragging only moves the thumb and the time; the file seeks on release
  progress.addEventListener('input', () => {
    userSeeking = true;
    updateTime();
  });
  progress.addEventListener('change', () => {
    userSeeking = false;
    seekTo(Number(progress.value));
  });

  // ---- PLAY/PAUSE: player area click and spacebar ----
  const onPlayPause = (e: Event) => {
    if (!localActive) return;
    e.stopPropagation();
    e.preventDefault();
    togglePlay();
  };
  // Intercept clicks on the main player area
  const songMediaEl = document.querySelector<HTMLElement>('#song-media-window');
  if (songMediaEl) songMediaEl.addEventListener('click', onPlayPause, true);
  // Intercept spacebar and media keys (but NOT when typing in inputs, nor on
  // the local bar, whose buttons take Space themselves)
  const onKeyDown = (e: KeyboardEvent) => {
    if (!localActive || !(e.target instanceof HTMLElement)) return;
    const tag = e.target.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      e.target.isContentEditable ||
      bar.contains(e.target)
    )
      return;
    if (e.code === 'Space' || e.key === ' ' || e.key === 'MediaPlayPause') {
      e.stopPropagation();
      e.preventDefault();
      togglePlay();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);

  // ---- REPLAY: when local audio ends, the local repeat mode decides ----
  const onEnded = () => {
    if (!localActive) return;
    if (repeatMode === 'ONE') {
      // Repeat ONE: replay the same track
      audio.currentTime = 0;
      play();
    } else if (repeatMode === 'ALL') {
      // Repeat ALL: play next downloaded file in the list
      playAdjacent(1);
    } else {
      // No repeat: stop playback, keep UI idle, block YTM from auto-playing
      audio.currentTime = 0;
    }
  };

  const audioListeners: [string, () => void][] = [
    ['timeupdate', updateTime],
    ['durationchange', onTimeChange],
    ['seeked', onTimeChange],
    ['ratechange', updatePositionState],
    ['play', updatePlayState],
    ['pause', updatePlayState],
    ['volumechange', updateVolume],
    ['ended', onEnded],
  ];
  for (const [type, listener] of audioListeners) {
    audio.addEventListener(type, listener);
  }

  // ---- MEDIA SESSION: SMTC and media keys drive the local file ----
  localPlayback = playback;
  const localActionHandlers: Record<string, MediaSessionActionHandler> = {
    play,
    pause,
    previoustrack: playback.previous,
    nexttrack: playback.next,
    seekto: (details) => {
      if (details.seekTime !== undefined) seekTo(details.seekTime);
    },
    seekbackward: (details) => playback.seekBy(-(details.seekOffset ?? 10)),
    seekforward: (details) => playback.seekBy(details.seekOffset ?? 10),
  };
  for (const action of localMediaActions) {
    try {
      applyActionHandler(action, localActionHandlers[action]);
    } catch {
      // Action not supported
    }
  }
  showCover();
  updateTime();
  updatePlayState();
  updateVolume();
  updateRepeat();

  // ---- CLEANUP function ----
  const cleanup = () => {
    localActive = false;
    if (localPlayback === playback) localPlayback = null;
    for (const [type, listener] of audioListeners) {
      audio.removeEventListener(type, listener);
    }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    restorePageMediaSession();
    if (songMediaEl)
      songMediaEl.removeEventListener('click', onPlayPause, true);
    document.removeEventListener('keydown', onKeyDown, true);
    barResizeObserver.disconnect();
    window.removeEventListener('resize', placeBar);
    bar.remove();
    if (ytmBar) ytmBar.inert = ytmBarWasInert;
    // Restore YTM video - remove our play/src overrides. Use the captured
    // `ytVideo` reference from patch time (never re-query, the element may
    // have been re-rendered) and defer the prototype restoration via
    // queueMicrotask so any in-flight assignment on the overridden setter
    // settles before we delete the instance properties. A local file started
    // right after this one has put its own overrides by then: keep those.
    if (ytVideo) {
      const v = ytVideo;
      v.removeEventListener('play', onYtmPlay);
      queueMicrotask(() => {
        if (v.play === blockedPlay) Reflect.deleteProperty(v, 'play'); // restore the prototype's
        if (Object.getOwnPropertyDescriptor(v, 'src')?.set === srcOverride) {
          Reflect.deleteProperty(v, 'src');
        }
        if (!localPlayback) v.muted = false;
      });
    }
    // Restore original elements
    const mc = document.getElementById('ytmd-local-main-cover');
    if (mc) mc.style.display = 'none';
    // Restore side panel
    sidePanelOrigChildren.forEach(
      ({ el, display }) => (el.style.display = display),
    );
    const lsp = document.getElementById('ytmd-local-side-panel');
    if (lsp) lsp.style.display = 'none';
    window.__ytmdLocalCleanup = null;
  };
  window.__ytmdLocalCleanup = cleanup;
};

// Local playback is installed at module load: it must not depend on the
// sidebar, which YTM may build late or not at all.
window.__ytmdPlayLocalFile = playLocalFile;

// Bind the local-file play handler exactly once, even if this bundle is
// evaluated again in the same document.
if (!window.__ytmdLocalPlayBound) {
  window.__ytmdLocalPlayBound = true;
  document.addEventListener('ytmd-play-local', (e) => {
    const f = e.detail;
    if (!f?.path) return;
    window.__ytmdPlayLocalFile?.(f);
  });
}

function replaceNavIcons() {
  const applyIcons = () => {
    const entries = document.querySelectorAll('ytmusic-guide-entry-renderer');
    if (entries.length === 0) return false;

    let replaced = 0;
    entries.forEach((entry) => {
      // Skip if already has our icon
      const existing = entry.querySelector('.ytmd-nav-icon');
      if (existing) {
        const origIcon = entry.querySelector<HTMLElement>(
          'yt-icon:not(.ytmd-nav-icon yt-icon), iron-icon',
        );
        if (origIcon) origIcon.style.display = 'none';
        return;
      }

      // Match by href
      const link = entry.querySelector('a');
      const href = link?.getAttribute('href') || '';
      let iconKey: string | null = null;
      if (href.includes('FEmusic_home')) iconKey = 'home';
      else if (href.includes('FEmusic_explore')) iconKey = 'explore';
      else if (href.includes('FEmusic_library')) iconKey = 'library';

      // Fallback: match by text
      if (!iconKey) {
        const text = entry.textContent?.trim().toLowerCase() || '';
        if (/^(accueil|home)$/i.test(text)) iconKey = 'home';
        else if (/^(explorer|explore)$/i.test(text)) iconKey = 'explore';
        else if (/^(biblioth[eè]que|library)$/i.test(text)) iconKey = 'library';
      }
      if (!iconKey) return;

      const icons = modernIcons[iconKey];
      const toHide =
        entry.querySelector<HTMLElement>('yt-icon') ||
        entry.querySelector<HTMLElement>('iron-icon, svg');
      if (!toHide) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'ytmd-nav-icon';
      wrapper.setAttribute('data-icon-key', iconKey);
      wrapper.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;color:inherit;transition:transform 200ms cubic-bezier(0.16,1,0.3,1);flex-shrink:0;';

      const isSelected =
        entry.hasAttribute('active') ||
        entry.classList.contains('iron-selected');
      wrapper.innerHTML = isSelected ? icons.filled : icons.outline;

      toHide.style.display = 'none';
      toHide.parentElement?.insertBefore(wrapper, toHide);
      replaced++;

      // Watch for selection changes
      const selObserver = new MutationObserver(() => {
        const sel =
          entry.hasAttribute('active') ||
          entry.classList.contains('iron-selected');
        wrapper.innerHTML = sel ? icons.filled : icons.outline;
      });
      selObserver.observe(entry, {
        attributes: true,
        attributeFilter: ['active', 'class'],
      });
    });

    return replaced > 0;
  };

  // Target the MINI GUIDE's #items container (not the hidden full guide). YTM
  // only creates #mini-guide once ytmusic-app.guideCollapsed is set.
  const miniGuideItemsSelector =
    '#mini-guide ytmusic-guide-section-renderer #items';

  // ===== CUSTOM PAGES (Playlists, Downloads) =====
  // A page lies over the content area, between the nav bar, the mini guide and
  // the player bar. Opening it adds a history entry, a hash on the current URL,
  // so it behaves like a route: Back closes it, Forward opens it again, and
  // Back from a page YTM opened on top of it comes back to it. Escape, a guide
  // entry, the logo and any navigation YTM starts close it.
  type PageKey = 'playlists' | 'downloads';
  const pageLabels: Record<PageKey, string> = {
    playlists: 'Playlists',
    downloads: 'Téléchargements',
  };

  let openPage: {
    key: PageKey;
    element: HTMLElement;
    resizeObserver: ResizeObserver;
    // Native guide entries whose highlight the page took
    deselected: [entry: Element, how: 'attribute' | 'class'][];
  } | null = null;
  // History entries the pages opened, by Navigation API key. YTM's own
  // replaceState can drop our hash, but not the key.
  const pageEntries = new Map<string, PageKey>();
  let pushingPageEntry = false;

  const getCustomEntry = (key: PageKey) =>
    document.querySelector<HTMLElement>(
      `.ytmd-custom-entry[data-icon-key="${key}"]`,
    );

  const setEntryActive = (key: PageKey, active: boolean) => {
    const entry = getCustomEntry(key);
    if (!entry) return;
    entry.classList.toggle('active', active);
    if (active) entry.setAttribute('aria-current', 'page');
    else entry.removeAttribute('aria-current');
    const iconWrapper = entry.querySelector('.ytmd-nav-icon');
    if (iconWrapper) {
      iconWrapper.innerHTML = active
        ? modernIcons[key].filled
        : modernIcons[key].outline;
    }
  };

  // The page's box comes from the real layout: CSS variables set on YTM's
  // layout do not reach an element added to body
  const placePage = () => {
    if (!openPage) return;
    const navBar = document
      .querySelector('ytmusic-nav-bar')
      ?.getBoundingClientRect();
    const miniGuide = document
      .querySelector('#mini-guide')
      ?.getBoundingClientRect();
    const playerBar = queryControl('playerBar')?.getBoundingClientRect();
    const { style } = openPage.element;
    style.top = `${navBar?.height ? navBar.bottom : 0}px`;
    style.left = `${miniGuide?.width ? miniGuide.right : 0}px`;
    style.bottom = `${playerBar?.height ? Math.max(0, window.innerHeight - playerBar.top) : 0}px`;
  };

  // Removes the page from the screen. Its history entry stays.
  const hidePage = () => {
    if (!openPage) return;
    const { key, element, resizeObserver, deselected } = openPage;
    openPage = null;
    element.remove();
    resizeObserver.disconnect();
    setEntryActive(key, false);
    // Give the native entry its highlight back. When YTM moves to another
    // page, it updates the highlight itself afterwards.
    for (const [entry, how] of deselected) {
      if (!entry.isConnected) continue;
      if (how === 'attribute') entry.setAttribute('active', '');
      else entry.classList.add('iron-selected');
    }
  };

  // Goes back from the page's history entry when it is the current one
  const leavePageEntry = () => {
    const current = window.navigation.currentEntry?.key;
    if (current && pageEntries.has(current)) history.back();
  };

  const closePage = () => {
    hidePage();
    leavePageEntry();
  };

  const fillPlaylistsPage = (page: HTMLElement) => {
    const content = document.createElement('div');
    content.style.cssText = 'flex:1;overflow-y:auto;padding:0 40px 24px;';
    page.appendChild(content);

    // Fetch playlists from the hidden full guide's secondary section
    const plEntries = document.querySelectorAll<
      Element & {
        data?: {
          navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
          formattedTitle?: { runs?: { text?: string }[] };
        };
      }
    >(
      'tp-yt-app-drawer #contentContainer ytmusic-guide-section-renderer:not([is-primary]) ytmusic-guide-entry-renderer',
    );
    if (plEntries.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Aucune playlist trouvée';
      empty.style.cssText =
        'color:rgba(255,255,255,0.5);font-size:16px;padding:40px 0;text-align:center;';
      content.appendChild(empty);
      return;
    }
    plEntries.forEach((plEntry) => {
      const entryData = plEntry.data;
      const browseId =
        entryData?.navigationEndpoint?.browseEndpoint?.browseId || '';
      const plTitle =
        entryData?.formattedTitle?.runs?.[0]?.text ||
        plEntry.querySelector('yt-formatted-string')?.textContent?.trim() ||
        'Playlist';
      const thumb = plEntry.querySelector('img');
      const thumbSrc = thumb?.src || '';

      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = `
        display:flex;align-items:center;width:100%;padding:12px 16px;border-radius:12px;
        border:none;background:none;color:inherit;font:inherit;text-align:left;
        cursor:pointer;transition:background 200ms;margin-bottom:2px;
      `;
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255,255,255,0.06)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
      });

      if (thumbSrc) {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = '';
        img.style.cssText =
          'width:48px;height:48px;border-radius:8px;object-fit:cover;margin-right:16px;flex-shrink:0;';
        row.appendChild(img);
      } else {
        const iconEl = document.createElement('div');
        iconEl.innerHTML = modernIcons.playlists.outline;
        iconEl.style.cssText =
          'width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(255,255,255,0.06);margin-right:16px;flex-shrink:0;color:rgba(255,255,255,0.5);';
        row.appendChild(iconEl);
      }

      const nameEl = document.createElement('div');
      nameEl.textContent = plTitle;
      nameEl.style.cssText =
        'font-size:15px;font-weight:500;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      row.appendChild(nameEl);

      // The page's history entry stays, so Back from the playlist comes back here
      row.addEventListener('click', () => {
        hidePage();
        if (browseId) {
          document
            .querySelector<YouTubeMusicAppElement>('ytmusic-app')
            ?.navigate(browseId);
        }
      });

      content.appendChild(row);
    });
  };

  const fillDownloadsPage = async (page: HTMLElement) => {
    const result = await listDownloads();
    const files = result?.files ?? [];

    // Folder path subtitle
    const sub = document.createElement('div');
    sub.textContent = result?.folder ?? '';
    sub.style.cssText =
      'color:rgba(255,255,255,0.35);font-size:12px;padding:0 40px 12px;flex-shrink:0;';
    page.appendChild(sub);

    // File count
    const countEl = document.createElement('div');
    let fileCount = files.length;
    const showCount = () => {
      countEl.textContent = `${fileCount} titre${fileCount !== 1 ? 's' : ''}`;
    };
    showCount();
    countEl.style.cssText =
      'color:rgba(255,255,255,0.5);font-size:13px;padding:0 40px 16px;flex-shrink:0;';
    page.appendChild(countEl);

    // Scrollable song list
    const list = document.createElement('div');
    list.style.cssText = 'flex:1;overflow-y:auto;padding:0 24px 24px;';
    page.appendChild(list);

    if (files.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Aucun fichier téléchargé';
      empty.style.cssText =
        'color:rgba(255,255,255,0.5);font-size:16px;padding:60px 0;text-align:center;';
      list.appendChild(empty);
      return;
    }
    files.forEach((file) => {
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;padding:10px 16px;border-radius:10px;
        cursor:pointer;transition:background 200ms;margin-bottom:1px;
      `;
      row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255,255,255,0.04)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
      });

      // The row's click plays the file; this button lets the keyboard reach it
      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.style.cssText =
        'display:flex;align-items:center;flex:1;min-width:0;padding:0;border:none;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;';

      const iconEl = document.createElement('div');
      iconEl.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)"><polygon points="5,3 19,12 5,21"/></svg>';
      iconEl.style.cssText =
        'width:32px;height:32px;display:flex;align-items:center;justify-content:center;margin-right:12px;flex-shrink:0;';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      const nameEl = document.createElement('div');
      const { title, artist } = parseFileName(file.name);
      nameEl.textContent = title;
      nameEl.style.cssText =
        'font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

      const metaLine = document.createElement('div');
      metaLine.style.cssText = 'display:flex;gap:8px;margin-top:2px;';
      if (artist) {
        const artistEl = document.createElement('span');
        artistEl.textContent = artist;
        artistEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.45);';
        metaLine.appendChild(artistEl);
      }
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      const sizeEl = document.createElement('span');
      sizeEl.textContent = sizeMB + ' MB';
      sizeEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.3);';
      metaLine.appendChild(sizeEl);
      info.appendChild(nameEl);
      info.appendChild(metaLine);
      playButton.append(iconEl, info);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', `Supprimer ${file.name}`);
      deleteBtn.title = 'Supprimer';
      deleteBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,255,255,0.35)"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      deleteBtn.style.cssText =
        'width:32px;height:32px;display:flex;align-items:center;justify-content:center;padding:0;border:none;background:none;border-radius:50%;cursor:pointer;flex-shrink:0;transition:background 200ms;margin-left:8px;';
      deleteBtn.addEventListener('mouseenter', () => {
        deleteBtn.style.background = 'rgba(255,80,80,0.15)';
      });
      deleteBtn.addEventListener('mouseleave', () => {
        deleteBtn.style.background = '';
      });
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // The main process moves the track, its .meta.json and its own
        // cover to the recycle bin, and says whether that worked
        const question = `Placer « ${file.name} » dans la corbeille ?`;
        if (!window.confirm(question)) return;
        const deleted = (await window.ipcRenderer.invoke(
          'ytmd:delete-download',
          file.path,
        )) as { success?: boolean } | undefined;
        if (deleted?.success) {
          row.remove();
          fileCount--;
          showCount();
        } else {
          window.alert(
            `« ${file.name} » n'a pas pu être placé dans la corbeille.`,
          );
        }
      });

      row.appendChild(playButton);
      row.appendChild(deleteBtn);
      // Play local file in-app with its own audio and player bar
      row.addEventListener('click', () => {
        closePage();
        playLocalFile(file);
      });
      list.appendChild(row);
    });
  };

  const showPage = (key: PageKey) => {
    hidePage();

    // Deselect native YTM entries
    const deselected: [Element, 'attribute' | 'class'][] = [];
    document
      .querySelectorAll('ytmusic-guide-entry-renderer[active]')
      .forEach((e) => {
        e.removeAttribute('active');
        deselected.push([e, 'attribute']);
      });
    document
      .querySelectorAll('ytmusic-guide-entry-renderer.iron-selected')
      .forEach((e) => {
        e.classList.remove('iron-selected');
        deselected.push([e, 'class']);
      });

    // Create page div — covers content area with solid background
    const page = document.createElement('div');
    page.id = `ytmd-${key}-page`;
    page.setAttribute('role', 'region');
    page.setAttribute('aria-label', pageLabels[key]);
    page.tabIndex = -1;
    page.style.cssText = `
      position: fixed; right: 12px;
      background: rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(30px) saturate(180%);
      -webkit-backdrop-filter: blur(30px) saturate(180%);
      color: #fff; font-family: 'Satoshi', sans-serif;
      z-index: 9999; display: flex; flex-direction: column; outline: none;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'padding: 24px 40px 16px; flex-shrink: 0;';
    const title = document.createElement('h2');
    title.textContent = pageLabels[key];
    title.style.cssText =
      'margin:0; font-size:28px; font-weight:600; letter-spacing:-0.02em;';
    header.appendChild(title);
    page.appendChild(header);

    document.body.appendChild(page);
    const resizeObserver = new ResizeObserver(placePage);
    for (const element of [
      document.querySelector('ytmusic-nav-bar'),
      document.querySelector('#mini-guide'),
      queryControl('playerBar'),
    ]) {
      if (element) resizeObserver.observe(element);
    }
    openPage = { key, element: page, resizeObserver, deselected };
    placePage();
    setEntryActive(key, true);

    if (key === 'playlists') fillPlaylistsPage(page);
    else fillDownloadsPage(page);
    page.focus({ preventScroll: true });
  };

  const togglePage = (key: PageKey) => {
    if (openPage?.key === key) {
      closePage();
      return;
    }
    showPage(key);
    const url = `${location.pathname}${location.search}#ytmd-${key}`;
    const current = window.navigation.currentEntry?.key;
    // One history entry for the pages: switching pages replaces it
    if (current && pageEntries.has(current)) {
      history.replaceState(history.state as unknown, '', url);
      pageEntries.set(current, key);
      return;
    }
    pushingPageEntry = true;
    try {
      history.pushState(history.state as unknown, '', url);
    } finally {
      pushingPageEntry = false;
    }
    const entryKey = window.navigation.currentEntry?.key;
    if (entryKey) pageEntries.set(entryKey, key);
  };

  // Back and Forward onto a page's entry open that page, onto any other entry
  // close it. A new entry YTM pushes means it is going to another page.
  window.navigation.addEventListener('navigate', (event) => {
    if (event.navigationType === 'traverse') {
      const key = pageEntries.get(event.destination.key);
      if (!key) hidePage();
      else if (openPage?.key !== key) showPage(key);
    } else if (event.navigationType === 'push' && !pushingPageEntry) {
      hidePage();
    }
  });

  // Escape closes the page before YTM sees the key
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !openPage) return;
      e.stopPropagation();
      e.preventDefault();
      const { key } = openPage;
      closePage();
      getCustomEntry(key)?.focus();
    },
    true,
  );

  // A guide entry or the logo closes the page. Any other entry or the logo
  // navigates, and the page's history entry stays for Back. The entry of the
  // page YTM already shows does not navigate, so the page's entry is left.
  document.addEventListener(
    'click',
    (e) => {
      if (!openPage || !(e.target instanceof Element)) return;
      const guideEntry = e.target.closest('ytmusic-guide-entry-renderer');
      if (guideEntry) {
        const isCurrent = openPage.deselected.some(
          ([entry]) => entry === guideEntry,
        );
        hidePage();
        if (isCurrent) leavePageEntry();
      } else if (e.target.closest('ytmusic-logo')) {
        hidePage();
      }
    },
    true,
  );

  // Add custom sidebar entries into the MINI GUIDE (the actually visible sidebar)
  const addCustomEntries = () => {
    const miniGuideItems = document.querySelector(miniGuideItemsSelector);
    if (!miniGuideItems || miniGuideItems.querySelector('.ytmd-custom-entry')) {
      return;
    }

    const createEntry = (key: PageKey) => {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'ytmd-custom-entry';
      entry.setAttribute('data-icon-key', key);
      entry.setAttribute('aria-label', pageLabels[key]);
      entry.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; margin: 2px auto; padding: 0;
        border: none; background: none; font: inherit;
        border-radius: 12px; cursor: pointer; color: rgba(255,255,255,0.7);
        transition: background 400ms cubic-bezier(0.16,1,0.3,1), transform 400ms cubic-bezier(0.16,1,0.3,1);
        position: relative; box-sizing: border-box;
      `;

      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'ytmd-nav-icon';
      iconWrapper.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;color:inherit;';
      iconWrapper.innerHTML = modernIcons[key].outline;
      entry.appendChild(iconWrapper);

      entry.addEventListener('mousedown', () => {
        entry.style.transform = 'scale(0.92)';
      });
      entry.addEventListener('mouseup', () => {
        entry.style.transform = '';
      });
      entry.addEventListener('click', () => togglePage(key));
      entry.title = pageLabels[key];
      return entry;
    };

    miniGuideItems.appendChild(createEntry('playlists'));
    miniGuideItems.appendChild(createEntry('downloads'));
    // Entries put back after a re-render show the open page
    if (openPage) setEntryActive(openPage.key, true);
  };

  // Re-inject if Polymer removes them
  const ensureCustomEntries = () => {
    if (
      !document.querySelector(`${miniGuideItemsSelector} .ytmd-custom-entry`)
    ) {
      addCustomEntries();
    }
  };

  // Keep the sidebar collapsed to the mini guide. YTM no longer reads the
  // collapse attributes this used to write on the layout: only the
  // `guideCollapsed` property of ytmusic-app creates #mini-guide. Collapse only
  // while the guide is persistent (wider than 935 px). Narrower, YTM shows the
  // mini guide or the hamburger drawer on its own, and forcing the collapse
  // there would fight the drawer.
  const collapseGuide = () => {
    const app = document.querySelector<
      HTMLElement & { guideCollapsed?: boolean; isGuidePersistent?: boolean }
    >('ytmusic-app');
    if (app?.isGuidePersistent && !app.guideCollapsed) {
      app.guideCollapsed = true;
    }
  };

  // Hide "Téléchargés" and "Ajouts" tabs from the library page
  const hideLibraryTabs = () => {
    const tabs = document.querySelectorAll<HTMLElement>(
      'ytmusic-tabs yt-formatted-string.tab',
    );
    tabs.forEach((tab) => {
      const text = tab.textContent?.trim().toLowerCase() || '';
      if (
        /^(t[ée]l[ée]charg[ée]s|downloads|offline)$/i.test(text) ||
        /^(ajouts|uploads)$/i.test(text)
      ) {
        tab.style.display = 'none';
      }
    });
  };

  const tryApply = () => {
    applyIcons();
    ensureCustomEntries();
  };

  // Watch the mini guide for re-renders and re-apply (debounced). childList
  // only: attribute writes, ours included, must not re-trigger it. The previous
  // observer on the whole layout re-ran itself about 7 times per second.
  let miniGuide: Element | null = null;
  let miniGuideObserver: MutationObserver | null = null;
  let guideDebounce: ReturnType<typeof setTimeout> | null = null;
  const watchMiniGuide = () => {
    const current = document.querySelector('#mini-guide');
    if (!current || current === miniGuide) return;
    miniGuide = current;
    miniGuideObserver?.disconnect();
    miniGuideObserver = new MutationObserver(() => {
      if (guideDebounce) clearTimeout(guideDebounce);
      guideDebounce = setTimeout(tryApply, 150);
    });
    miniGuideObserver.observe(current, { childList: true, subtree: true });
    tryApply();
  };

  const syncGuide = () => {
    collapseGuide();
    watchMiniGuide();
  };

  // ytmusic-app reflects both properties as attributes: follow YTM flipping
  // them (resize across 935 px, guide button) instead of polling.
  const appElement = document.querySelector('ytmusic-app');
  if (appElement) {
    new MutationObserver(syncGuide).observe(appElement, {
      attributeFilter: ['guide-collapsed', 'is-guide-persistent'],
    });
  }

  // Deferred fallback for layout changes that flip neither attribute, such as
  // YTM creating #mini-guide when the window grows past 615 px.
  let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(syncGuide, 250);
  });

  collapseGuide();
  // YTM creates #mini-guide one task after guideCollapsed is set.
  waitForElement('#mini-guide').then(watchMiniGuide);

  // Watch for page content changes to hide library chips on navigation.
  // Debounced + gated on addedNodes so large libraries don't trigger
  // hideLibraryTabs() (a full querySelectorAll) on every micro-mutation.
  const contentPage = document.querySelector('ytmusic-app #content');
  if (contentPage) {
    let contentDebounce: ReturnType<typeof setTimeout> | null = null;
    const contentObserver = new MutationObserver((mutations) => {
      if (!mutations.some((m) => m.addedNodes.length > 0)) return;
      if (contentDebounce) clearTimeout(contentDebounce);
      contentDebounce = setTimeout(hideLibraryTabs, 150);
    });
    contentObserver.observe(contentPage, { childList: true, subtree: true });
  }

  // Initial application: bounded retry until the guide entries exist
  let attempts = 0;
  const initialApply = () => {
    attempts++;
    if (!applyIcons() && attempts < 10) {
      setTimeout(initialApply, 1000);
    }
  };

  // Kick off the icon/sidebar setup as soon as the guide exists, rather than
  // betting on a fixed 1s delay (which fails on slow boots). `initialApply`
  // keeps its own bounded retry for the icon DOM.
  waitForElement('ytmusic-guide-renderer, ytmusic-app-layout').then(() => {
    initialApply();
  });

  // Fix ghost song-media-window: collapse when player enters mini mode.
  // PiP-aware: never collapse while the video is in Picture-in-Picture, otherwise
  // the collapsed (height:0 / visibility:hidden) container would break/blacken the
  // PiP source, since the <video> lives inside #song-media-window. The manual PiP
  // toggle is owned by the dedicated `picture-in-picture` plugin.
  //
  // The observers are installed on the player elements present at setup time.
  // Because YTM can re-render the player subtree (detaching those nodes), we
  // keep the install logic in a function and re-run it whenever the player's
  // parent reports the player nodes (re)appearing.
  const playerStateObservers: MutationObserver[] = [];
  let ghostSmwRef: HTMLElement | null = null;
  let ghostVideoRef: HTMLVideoElement | null = null;
  let ghostRefresh: (() => void) | null = null;

  const installGhostFix = () => {
    const smw = document.querySelector<HTMLElement>('#song-media-window');
    if (!smw) return false;

    // Watch both ytmusic-player and ytmusic-player-page for state changes
    const targets = [
      document.querySelector('ytmusic-player'),
      document.querySelector('ytmusic-player-page'),
    ].filter(Boolean);
    if (targets.length === 0) return false;

    // Tear down any previously installed observers/listeners before re-attaching
    // to the fresh nodes (avoids stacking duplicates after a re-render).
    for (const obs of playerStateObservers.splice(0)) obs.disconnect();
    if (ghostVideoRef && ghostRefresh) {
      ghostVideoRef.removeEventListener('enterpictureinpicture', ghostRefresh);
      ghostVideoRef.removeEventListener('leavepictureinpicture', ghostRefresh);
    }

    const isMiniplayer = () =>
      targets.some((el) => {
        const state =
          el.getAttribute('player-ui-state') ||
          el.getAttribute('player-ui-state_') ||
          '';
        return state === 'MINIPLAYER';
      });

    const refresh = () => {
      if (isMiniplayer() && !document.pictureInPictureElement) {
        smw.classList.add('ytmd-ghost-collapsed');
      } else {
        smw.classList.remove('ytmd-ghost-collapsed');
      }
    };
    ghostRefresh = refresh;
    ghostSmwRef = smw;

    refresh(); // initial check
    for (const el of targets) {
      const obs = new MutationObserver(refresh);
      obs.observe(el, {
        attributeFilter: ['player-ui-state', 'player-ui-state_'],
      });
      playerStateObservers.push(obs);
    }

    // Re-evaluate when entering/leaving Picture-in-Picture so the collapse never
    // hides a video that is currently floating in a PiP window.
    ghostVideoRef = document.querySelector<HTMLVideoElement>('video');
    ghostVideoRef?.addEventListener('enterpictureinpicture', refresh);
    ghostVideoRef?.addEventListener('leavepictureinpicture', refresh);
    return true;
  };

  waitForElement('#song-media-window').then(() => {
    installGhostFix();

    // Re-install when YTM re-creates ytmusic-player, and #song-media-window
    // with it (for example when the window gets small). Only the player's
    // parent (#main-panel) changes then: watch its direct children and,
    // debounced, re-run the installer only if the observed nodes were replaced.
    const playerParent =
      document.querySelector('ytmusic-player')?.parentElement;
    if (!playerParent) return;
    let reinstallDebounce: ReturnType<typeof setTimeout> | null = null;
    const reinstallObserver = new MutationObserver(() => {
      if (reinstallDebounce) clearTimeout(reinstallDebounce);
      reinstallDebounce = setTimeout(() => {
        const smw = document.querySelector('#song-media-window');
        if (smw && smw !== ghostSmwRef) installGhostFix();
      }, 250);
    });
    reinstallObserver.observe(playerParent, { childList: true });
  });
}

// Runs one plugin's onPlayerApiReady hook. A hook that throws must not stop the
// other plugins nor the shell setup that follows, so log it with the plugin id.
async function callOnPlayerApiReady(
  id: string,
  plugin: PluginDef<unknown, unknown, unknown>,
  playerApi: YoutubePlayer,
) {
  if (typeof plugin.renderer === 'function') return;
  try {
    await plugin.renderer?.onPlayerApiReady?.call(
      plugin.renderer,
      playerApi,
      createContext(id),
    );
  } catch (err) {
    console.error(`[Atom] onPlayerApiReady failed for plugin "${id}":`, err);
  }
}

async function onApiLoaded() {
  // Workaround for macOS traffic lights
  {
    let osType = 'Unknown';
    if (window.electronIs.osx()) {
      osType = 'Macintosh';
    } else if (window.electronIs.windows()) {
      osType = 'Windows';
    } else if (window.electronIs.linux()) {
      osType = 'Linux';
    }
    document.documentElement.setAttribute('data-os', osType);
  }

  // Workaround for #2459
  document
    .querySelector('button.video-button.ytmusic-av-toggle')
    ?.addEventListener('click', () =>
      window.dispatchEvent(new Event('resize')),
    );

  // During local playback, the playback commands drive the local file.
  // Otherwise a click on the bar's own button does what YTM does on a click.
  window.ipcRenderer.on('ytmd:previous-video', () => {
    if (localPlayback) return localPlayback.previous();
    const button = queryControl('previous');
    if (button) button.click();
    else api?.previousVideo();
  });
  window.ipcRenderer.on('ytmd:next-video', () => {
    if (localPlayback) return localPlayback.next();
    const button = queryControl('next');
    if (button) button.click();
    else api?.nextVideo();
  });
  window.ipcRenderer.on('ytmd:play', (_) => {
    if (localPlayback) localPlayback.play();
    else api?.playVideo();
  });
  window.ipcRenderer.on('ytmd:pause', (_) => {
    if (localPlayback) localPlayback.pause();
    else api?.pauseVideo();
  });
  window.ipcRenderer.on('ytmd:toggle-play', (_) => {
    if (localPlayback) localPlayback.togglePlay();
    else if (api?.getPlayerState() === 2) api?.playVideo();
    else api?.pauseVideo();
  });
  window.ipcRenderer.on('ytmd:seek-to', (_, t: number) => {
    if (localPlayback) localPlayback.seekTo(t);
    else api?.seekTo(t);
  });
  window.ipcRenderer.on('ytmd:seek-by', (_, t: number) => {
    if (localPlayback) localPlayback.seekBy(t);
    else api?.seekBy(t);
  });
  window.ipcRenderer.on('ytmd:shuffle', () => {
    const playerBar = queryControl<
      HTMLElement & { queue?: { shuffle: () => void } }
    >('playerBar');
    if (playerBar?.queue) playerBar.queue.shuffle();
    else queryControl('shuffle')?.click();
  });

  window.ipcRenderer.on('ytmd:get-shuffle', () => {
    window.ipcRenderer.send('ytmd:get-shuffle-response', isShuffleOn());
  });

  window.ipcRenderer.on(
    'ytmd:update-like',
    (_, status: 'LIKE' | 'DISLIKE' = 'LIKE') => {
      const likeControl = queryControl<
        HTMLElement & { updateLikeStatus?: (status: string) => void }
      >('like');
      if (likeControl?.updateLikeStatus) {
        likeControl.updateLikeStatus(status);
        return;
      }
      // The new bar's buttons toggle, so only press the one that is off
      const button = queryControl(
        status === 'DISLIKE' ? 'dislikeButton' : 'likeButton',
      );
      if (button?.getAttribute('aria-pressed') !== 'true') button?.click();
    },
  );
  window.ipcRenderer.on('ytmd:switch-repeat', async (_, repeat = 1) => {
    for (let i = 0; i < Number(repeat); i++) {
      if (localPlayback) {
        localPlayback.switchRepeat();
        continue;
      }
      const playerBar = queryControl<
        HTMLElement & { onRepeatButtonClick?: () => void }
      >('playerBar');
      if (playerBar?.onRepeatButtonClick) {
        playerBar.onRepeatButtonClick();
      } else {
        // The new bar's button ignores a second click in the same task
        queryControl('repeat')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  });
  window.ipcRenderer.on('ytmd:update-volume', (_, volume: number) => {
    if (localPlayback) return localPlayback.setVolume(volume);
    const playerBar = queryControl<
      HTMLElement & { updateVolume?: (volume: number) => void }
    >('playerBar');
    const slider = queryControl('volumeSlider');
    if (playerBar?.updateVolume) {
      playerBar.updateVolume(volume);
    } else if (slider instanceof HTMLInputElement) {
      // The new bar's slider applies what the user sets on it
      slider.value = String(volume);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      api?.setVolume(volume);
    }
  });

  const clickFullscreenButton = (isFullscreenValue: boolean) => {
    const fullscreen = isFullscreen();
    if (isFullscreenValue === fullscreen) {
      return;
    }

    if (fullscreen) {
      // The new bar has no exit button: it leaves fullscreen like Escape does
      const exitButton = document.querySelector<HTMLElement>(
        '.exit-fullscreen-button',
      );
      if (exitButton) exitButton.click();
      else document.exitFullscreen().catch(() => {});
    } else {
      document.querySelector<HTMLElement>('.fullscreen-button')?.click();
    }
  };

  window.ipcRenderer.on('ytmd:get-fullscreen', () => {
    window.ipcRenderer.send('ytmd:set-fullscreen', isFullscreen());
  });

  window.ipcRenderer.on(
    'ytmd:click-fullscreen-button',
    (_, fullscreen: boolean | undefined) => {
      clickFullscreenButton(fullscreen ?? false);
    },
  );

  window.ipcRenderer.on('ytmd:toggle-mute', (_) => {
    if (localPlayback) return localPlayback.toggleMute();
    // The classic bar's own handler also moves its slider to 0 and back. The
    // new bar has none, so the player API toggles it.
    const playerBar = queryControl<
      HTMLElement & { onVolumeClick?: () => void }
    >('playerBar');
    if (playerBar?.onVolumeClick) playerBar.onVolumeClick();
    else if (api?.isMuted()) api.unMute();
    else api?.mute();
  });

  window.ipcRenderer.on('ytmd:get-queue', () => {
    try {
      const queue = document.querySelector<QueueElement>('#queue');
      window.ipcRenderer.send('ytmd:get-queue-response', {
        items: queue?.queue?.getItems?.(),
        autoPlaying: queue?.queue?.autoPlaying,
        continuation: queue?.queue?.continuation,
      } satisfies QueueResponse);
    } catch (err) {
      console.error('[Atom] ytmd:get-queue failed:', err);
    }
  });

  window.ipcRenderer.on(
    'ytmd:add-to-queue',
    (_, videoId: string, queueInsertPosition: string) => {
      try {
        const queue = document.querySelector<QueueElement>('#queue');
        const app =
          document.querySelector<YouTubeMusicAppElement>('ytmusic-app');
        if (!app?.networkManager) return;

        const store = queue?.queue?.store?.store;
        if (!store) return;

        app.networkManager
          .fetch('/music/get_queue', {
            queueContextParams: store.getState().queue.queueContextParams,
            queueInsertPosition,
            videoIds: [videoId],
          })
          .then((result) => {
            if (
              result &&
              typeof result === 'object' &&
              'queueDatas' in result &&
              Array.isArray(result.queueDatas)
            ) {
              const queueItems = store.getState().queue.items;
              const queueItemsLength = queueItems.length ?? 0;
              queue?.dispatch({
                type: 'ADD_ITEMS',
                payload: {
                  nextQueueItemId: store.getState().queue.nextQueueItemId,
                  index:
                    queueInsertPosition === 'INSERT_AFTER_CURRENT_VIDEO'
                      ? queueItems.findIndex(
                          (it) =>
                            (
                              it.playlistPanelVideoRenderer ||
                              it.playlistPanelVideoWrapperRenderer
                                ?.primaryRenderer.playlistPanelVideoRenderer
                            )?.selected,
                        ) + 1 || queueItemsLength
                      : queueItemsLength,
                  items: result.queueDatas
                    .map((it) =>
                      typeof it === 'object' && it && 'content' in it
                        ? it.content
                        : null,
                    )
                    .filter(Boolean),
                  shuffleEnabled: false,
                  shouldAssignIds: true,
                },
              });
            }
          })
          .catch((err) => {
            console.error('[Atom] ytmd:add-to-queue fetch failed:', err);
          });
      } catch (err) {
        console.error('[Atom] ytmd:add-to-queue failed:', err);
      }
    },
  );
  window.ipcRenderer.on(
    'ytmd:move-in-queue',
    (_, fromIndex: number, toIndex: number) => {
      const queue = document.querySelector<QueueElement>('#queue');
      queue?.dispatch({
        type: 'MOVE_ITEM',
        payload: {
          fromIndex,
          toIndex,
        },
      });
    },
  );
  window.ipcRenderer.on('ytmd:remove-from-queue', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'REMOVE_ITEM',
      payload: index,
    });
  });
  window.ipcRenderer.on('ytmd:set-queue-index', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'SET_INDEX',
      payload: index,
    });
  });
  window.ipcRenderer.on('ytmd:clear-queue', () => {
    try {
      const queue = document.querySelector<QueueElement>('#queue');
      queue?.queue?.store?.store?.dispatch({
        type: 'SET_PLAYER_PAGE_INFO',
        payload: { open: false },
      });
      queue?.dispatch({
        type: 'CLEAR',
      });
    } catch (err) {
      console.error('[Atom] ytmd:clear-queue failed:', err);
    }
  });

  window.ipcRenderer.on(
    'ytmd:search',
    async (_, query: string, params?: string, continuation?: string) => {
      try {
        const app =
          document.querySelector<YouTubeMusicAppElement>('ytmusic-app');
        const searchBox =
          document.querySelector<SearchBoxElement>('ytmusic-search-box');

        if (!app?.networkManager || !searchBox) return;

        const result = await app.networkManager.fetch<
          unknown,
          {
            query: string;
            params?: string;
            continuation?: string;
            suggestStats?: unknown;
          }
        >('/search', {
          query,
          params,
          continuation,
          suggestStats: searchBox.getSearchboxStats?.(),
        });

        window.ipcRenderer.send('ytmd:search-results', result);
      } catch (err) {
        console.error('[Atom] ytmd:search failed:', err);
      }
    },
  );

  // Nothing in the audio graph or the plugin hooks may stop the shell setup
  // below, nor the `ytmd:player-api-loaded` signal main-process plugins wait for.
  try {
    const video = document.querySelector('video')!;
    const audioContext = new AudioContext();
    const audioSource = audioContext.createMediaElementSource(video);
    audioSource.connect(audioContext.destination);

    for (const [id, plugin] of Object.entries(getAllLoadedRendererPlugins())) {
      await callOnPlayerApiReady(id, plugin, api!);
    }

    if (firstDataLoaded) {
      document.dispatchEvent(
        new CustomEvent('videodatachange', { detail: { name: 'dataloaded' } }),
      );
    }

    const audioCanPlayEventDispatcher = () => {
      document.dispatchEvent(
        new CustomEvent('ytmd:audio-can-play', {
          detail: {
            audioContext,
            audioSource,
          },
        }),
      );
    };

    const loadstartListener = () => {
      // Emit "audioCanPlay" for each video
      video.addEventListener('canplaythrough', audioCanPlayEventDispatcher, {
        once: true,
      });
    };

    if (video.readyState === 4 /* HAVE_ENOUGH_DATA (loaded) */) {
      audioCanPlayEventDispatcher();
    }

    video.addEventListener('loadstart', loadstartListener, { passive: true });
  } catch (err) {
    console.error('[Atom] Player API setup failed:', err);
  }

  window.ipcRenderer.send('ytmd:player-api-loaded');

  // Navigate to "Starting page"
  const startingPage: string = window.mainConfig.get('options.startingPage');
  if (startingPage && startingPages[startingPage]) {
    document
      .querySelector<YouTubeMusicAppElement>('ytmusic-app')
      ?.navigate(startingPages[startingPage]);
  }

  // Remove upgrade button
  if (window.mainConfig.get('options.removeUpgradeButton')) {
    const itemsSelector = 'ytmusic-guide-section-renderer #items';
    let selector = 'ytmusic-guide-entry-renderer:last-child';

    const upgradeBtnIcon = document.querySelector<SVGGElement>(
      'iron-iconset-svg[name="yt-sys-icons"] #youtube_music_monochrome',
    );
    if (upgradeBtnIcon) {
      const path = upgradeBtnIcon.firstChild as SVGPathElement;
      const data = path.getAttribute('d')!.substring(0, 15);
      selector = `ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="${data}"])`;
    }

    const styles = document.createElement('style');
    styles.textContent = `${itemsSelector} ${selector} { display: none; }`;

    document.head.appendChild(styles);
  }

  // Replace navigation tab icons with modern Apple-inspired designs
  replaceNavIcons();

  // Smooth page transitions: re-trigger fade-in animation on navigation
  (() => {
    const contentPage = document.querySelector('ytmusic-app #content');
    if (!contentPage) return;

    const replayAnimations = () => {
      const targets = new Set<Element>(
        contentPage.querySelectorAll(
          'ytmusic-browse-response, ytmusic-section-list-renderer, ytmusic-shelf-renderer, ' +
            'ytmusic-item-section-renderer, ytmusic-tab-renderer, ytmusic-library-landing-page, ' +
            'ytmusic-grid-renderer, ytmusic-immersive-carousel-renderer',
        ),
      );
      // Restart the theme's fade-in through the Web Animations API, without
      // the forced reflow per element that resetting the style needed. YTM's
      // Web Animations polyfill replaces Element.getAnimations with one that
      // misses CSS animations, so the list comes from the document. The
      // fade-in fills both ways, so a finished one is still listed.
      for (const animation of document.getAnimations()) {
        if (
          !(animation instanceof CSSAnimation) ||
          animation.animationName !== 'ytmd-page-fade-in'
        ) {
          continue;
        }
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (target && targets.has(target)) {
          animation.cancel();
          animation.play();
        }
      }
    };

    // Both observers funnel through a single debounced scheduler so a burst
    // of mutations (common on large libraries) collapses into one rAF-driven
    // replay instead of forcing a reflow-per-element on every micro-mutation.
    let replayDebounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleReplay = () => {
      if (replayDebounce) clearTimeout(replayDebounce);
      replayDebounce = setTimeout(() => {
        requestAnimationFrame(replayAnimations);
      }, 120);
    };
    const onMutations = (mutations: MutationRecord[]) => {
      if (mutations.some((m) => m.addedNodes.length > 0)) scheduleReplay();
    };

    // Refs kept so the observers can be disconnected if ever needed.
    const animObservers: MutationObserver[] = [];

    // Also watch the app element for page-type changes
    const app = document.querySelector('ytmusic-app');
    if (app) {
      const appObserver = new MutationObserver(onMutations);
      appObserver.observe(app, { childList: true, subtree: false });
      animObservers.push(appObserver);
    }

    // Watch browse-response swap (deeper). This also covers the direct
    // children of the content page, so no separate shallow observer is needed.
    const deepObserver = new MutationObserver(onMutations);
    deepObserver.observe(contentPage, { childList: true, subtree: true });
    animObservers.push(deepObserver);
  })();

  // Hide / Force show like buttons
  const likeButtonsOptions: string = window.mainConfig.get(
    'options.likeButtons',
  );
  if (likeButtonsOptions) {
    const style = document.createElement('style');
    style.textContent = `
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls-buttons.ytmusic-player-bar, #like-button-renderer {
        display: ${likeButtonsOptions === 'hide' ? 'none' : 'inherit'} !important;
      }
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls.ytmusic-player-bar {
        justify-content: ${likeButtonsOptions === 'hide' ? 'flex-start' : 'space-between'} !important;
      }`;

    document.head.appendChild(style);
  }
}

/**
 * YouTube Music still using ES5, so we need to define custom elements using ES5 style
 */
const defineYTMDTransElements = () => {
  const YTMDTrans = function () {};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  YTMDTrans.prototype = Object.create(HTMLElement.prototype);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  YTMDTrans.prototype.connectedCallback = function () {
    const that = this as HTMLElement;
    const key = that.getAttribute('key');
    if (key) {
      const targetHtml = i18t(key);
      (that.innerHTML as string | TrustedHTML) = defaultTrustedTypePolicy
        ? defaultTrustedTypePolicy.createHTML(targetHtml)
        : targetHtml;
    }
  };
  customElements.define(
    'ytmd-trans',
    YTMDTrans as unknown as CustomElementConstructor,
  );
};

const preload = async () => {
  await loadI18n();
  await setLanguage(window.mainConfig.get('options.language') ?? 'en');
  window.i18n = {
    t: i18t.bind(i18next),
  };
  defineYTMDTransElements();
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href =
    'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap';
  document.head.appendChild(fontLink);
  if (document.body?.dataset?.os) {
    document.body.dataset.os = navigator.userAgent;
  }
};

const main = async () => {
  await loadAllRendererPlugins();
  isPluginLoaded = true;

  window.ipcRenderer.on('plugin:unload', async (_event, id: string) => {
    await forceUnloadRendererPlugin(id);
  });
  window.ipcRenderer.on('plugin:enable', async (_event, id: string) => {
    // Starting an already running plugin again duplicates its buttons,
    // listeners and stylesheets.
    if (getLoadedRendererPlugin(id)) return;
    await forceLoadRendererPlugin(id);
    if (api) {
      const plugin = getLoadedRendererPlugin(id);
      if (plugin) await callOnPlayerApiReady(id, plugin, api);
    }
  });

  window.ipcRenderer.on(
    'config-changed',
    (_event, id: string, newConfig: PluginConfig) => {
      const plugin = getAllLoadedRendererPlugins()[id];
      if (plugin && typeof plugin.renderer !== 'function') {
        plugin.renderer?.onConfigChange?.call(plugin.renderer, newConfig);
      }
    },
  );

  // Wait for complete load of YouTube api
  await listenForApiLoad();

  // Blocks the "Are You Still There?" popup by setting the last active time to Date.now every 15min
  if (window.mainConfig.get('options.disableIdlePopup') !== false) {
    setInterval(() => (window._lact = Date.now()), 900_000);
  }

  // Setup back to front logger
  if (window.electronIs.dev()) {
    window.ipcRenderer.on('log', (_event, log: string) => {
      console.log(JSON.parse(log));
    });
  }
};

const initObserver = async () => {
  // check document.documentElement is ready
  await new Promise<void>((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => resolve(), {
        once: true,
      });
    } else {
      resolve();
    }
  });

  // Watches document root for #movie_player to appear, then disconnects immediately.
  // Broad scope is necessary since YouTube Music dynamically injects the player.
  const observer = new MutationObserver(() => {
    const playerApi = document.querySelector<Element & YoutubePlayer>(
      '#movie_player',
    );
    if (playerApi) {
      observer.disconnect();

      // Inject song-info provider
      setupSongInfo(playerApi);
      const dataLoadedListener = (name: string) => {
        if (!firstDataLoaded && name === 'dataloaded') {
          firstDataLoaded = true;
          playerApi.removeEventListener('videodatachange', dataLoadedListener);
        }
      };
      playerApi.addEventListener('videodatachange', dataLoadedListener);

      if (isPluginLoaded && !isApiLoaded) {
        api = playerApi;
        isApiLoaded = true;

        onApiLoaded().catch((err) =>
          console.error('[Atom] onApiLoaded failed:', err),
        );
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};

// ===== ABOUT POPUP — Liquid Glass =====
window.ipcRenderer.on('ytmd:show-about', () => {
  if (document.getElementById('ytmd-about-overlay')) return;

  // Inject animations
  if (!document.getElementById('ytmd-about-style')) {
    const style = document.createElement('style');
    style.id = 'ytmd-about-style';
    style.textContent =
      '@keyframes ytmd-about-fade-in{from{opacity:0}to{opacity:1}}@keyframes ytmd-about-scale-in{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}';
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = 'ytmd-about-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:ytmd-about-fade-in 300ms cubic-bezier(0.16,1,0.3,1) both;';

  const card = document.createElement('div');
  card.style.cssText =
    'background:rgba(30,30,30,0.55);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:40px 48px;min-width:360px;max-width:420px;color:#fff;font-family:Satoshi,sans-serif;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,0.5),0 0 1px rgba(255,255,255,0.1) inset;animation:ytmd-about-scale-in 350ms cubic-bezier(0.34,1.56,0.64,1) both;';

  // Title
  const titleBlock = document.createElement('div');
  titleBlock.style.cssText = 'margin-bottom:24px;';
  const h = document.createElement('div');
  h.textContent = 'YouTube Music';
  h.style.cssText =
    'font-size:28px;font-weight:700;letter-spacing:-0.03em;margin-bottom:4px;';
  const sub = document.createElement('div');
  sub.textContent = 'Revamp Edition \u2022 v4.0.2';
  sub.style.cssText =
    'font-size:13px;color:rgba(255,255,255,0.4);font-weight:500;';
  titleBlock.appendChild(h);
  titleBlock.appendChild(sub);
  card.appendChild(titleBlock);

  // Info block
  const infoBlock = document.createElement('div');
  infoBlock.style.cssText =
    'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left;';
  const byLine = document.createElement('div');
  byLine.textContent = 'Revamp by @IsSlashy';
  byLine.style.cssText =
    'font-size:15px;font-weight:600;color:#49f3f7;margin-bottom:8px;';
  infoBlock.appendChild(byLine);
  const details = document.createElement('div');
  details.style.cssText =
    'font-size:13px;color:rgba(255,255,255,0.6);line-height:1.6;';
  const lines: Array<[string, string, string?]> = [
    ['X:', ' @Slashy_fx', 'https://x.com/Slashy_fx'],
    ['Derni\u00e8re mise \u00e0 jour:', ' 21/06/2026'],
  ];
  lines.forEach(([label, val, href], i) => {
    const sp1 = document.createElement('span');
    sp1.textContent = label;
    sp1.style.color = 'rgba(255,255,255,0.35)';
    details.appendChild(sp1);
    if (href) {
      const a = document.createElement('a');
      a.textContent = val;
      a.style.cssText =
        'color:#49f3f7;text-decoration:none;cursor:pointer;transition:opacity 200ms;';
      a.addEventListener('click', () => {
        window.ipcRenderer.send('ytmd:open-url', href);
      });
      a.addEventListener('mouseenter', () => {
        a.style.opacity = '0.7';
      });
      a.addEventListener('mouseleave', () => {
        a.style.opacity = '1';
      });
      details.appendChild(a);
    } else {
      details.appendChild(document.createTextNode(val));
    }
    if (i < lines.length - 1) details.appendChild(document.createElement('br'));
  });
  infoBlock.appendChild(details);
  card.appendChild(infoBlock);

  // Credits block
  const creditsBlock = document.createElement('div');
  creditsBlock.style.cssText =
    'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px 20px;margin-bottom:24px;text-align:left;';
  const credLabel = document.createElement('div');
  credLabel.textContent = 'Credits';
  credLabel.style.cssText =
    'font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:4px;';
  creditsBlock.appendChild(credLabel);
  const link = document.createElement('a');
  link.textContent = 'Pear Desktop \u2014 GitHub';
  link.style.cssText =
    'font-size:14px;font-weight:500;color:#49f3f7;text-decoration:none;cursor:pointer;transition:opacity 200ms;';
  link.addEventListener('click', () => {
    window.ipcRenderer.send(
      'ytmd:open-url',
      'https://github.com/pear-devs/pear-desktop',
    );
  });
  link.addEventListener('mouseenter', () => {
    link.style.opacity = '0.7';
  });
  link.addEventListener('mouseleave', () => {
    link.style.opacity = '1';
  });
  creditsBlock.appendChild(link);
  card.appendChild(creditsBlock);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Fermer';
  closeBtn.style.cssText =
    'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-family:Satoshi,sans-serif;font-size:14px;font-weight:500;padding:10px 32px;cursor:pointer;transition:background 200ms,transform 150ms;';
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(255,255,255,0.14)';
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'rgba(255,255,255,0.08)';
  });
  closeBtn.addEventListener('mousedown', () => {
    closeBtn.style.transform = 'scale(0.95)';
  });
  closeBtn.addEventListener('mouseup', () => {
    closeBtn.style.transform = '';
  });
  closeBtn.addEventListener('click', () => overlay.remove());
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);
});

initObserver().then(preload).then(main).catch(console.error);
