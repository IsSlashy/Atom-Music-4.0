import '@total-typescript/ts-reset';

import type { ipcRenderer as electronIpcRenderer } from 'electron';
import type is from 'electron-is';

import type * as config from './config';
import type { VideoDataChanged } from '@/types/video-data-changed';
import type { t } from '@/i18n';
import type { trustedTypes } from 'trusted-types';

declare global {
  interface Compressor {
    audioSource: MediaElementAudioSourceNode;
    audioContext: AudioContext;
  }

  interface DocumentEventMap {
    'ytmd:audio-can-play': CustomEvent<Compressor>;
    'videodatachange': CustomEvent<VideoDataChanged>;
  }

  declare var electronIs: typeof import('electron-is');

  interface Window {
    trustedTypes?: typeof trustedTypes;
    ipcRenderer: typeof electronIpcRenderer;
    mainConfig: typeof config;
    electronIs: typeof is;
    ELECTRON_RENDERER_URL: string | undefined;
    /**
     * YouTube Music internal variable (Last interaction time)
     */
    _lact: number;
    navigation: Navigation;
    download: () => void;
    togglePictureInPicture: () => void;
    reload: () => void;
    i18n: {
      t: typeof t;
    };
    /**
     * Atom Music internal: plays a downloaded local file in-app, taking over
     * the YTM player bar. Installed by `replaceNavIcons()` in renderer.ts.
     */
    __ytmdPlayLocalFile?: (file: {
      name: string;
      path: string;
      imageSrc?: string;
    }) => Promise<void> | void;
    /**
     * Atom Music internal: tears down the current local-playback session
     * (observers, listeners, video overrides). Null when inactive.
     */
    __ytmdLocalCleanup?: (() => void) | null;
    /**
     * Atom Music internal: guard flag ensuring the 'ytmd-play-local' document
     * listener is only bound once across sidebar re-injections.
     */
    __ytmdLocalPlayBound?: boolean;
  }

  interface DocumentEventMap {
    'ytmd-play-local': CustomEvent<{
      name: string;
      path: string;
      imageSrc?: string;
    }>;
  }
}

// import { Howl as _Howl } from 'howler';
declare module 'howler' {
  interface Howl {
    _sounds: {
      _paused: boolean;
      _ended: boolean;
      _id: string;
      _node: HTMLMediaElement;
    }[];
  }
}
