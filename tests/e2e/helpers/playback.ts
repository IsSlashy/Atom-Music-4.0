// The player as the page sees it, through YTM's player API (#movie_player),
// which works the same under either bar.

import type { Page } from '@playwright/test';

/** Long enough for a pre-roll ad and a slow start. */
const TRACK_PLAYING_TIMEOUT_MS = 60_000;
/** The track must keep playing this long: YTM can start a second ad right after the first. */
const STABLE_MS = 2000;
const POLL_MS = 500;

interface MoviePlayer extends HTMLElement {
  getVideoData(): { video_id: string };
  isMuted(): boolean;
  playVideo(): void;
}

declare global {
  interface Window {
    /** When the track was last seen playing without interruption (waitForTrackPlaying). */
    __atomE2ePlayingSince?: number;
  }
}

/** YTM's player state, plus the <video>'s. */
export const playerState = (page: Page) =>
  page.evaluate(() => {
    const player = document.querySelector<MoviePlayer>('#movie_player');
    const video = document.querySelector('video');
    return {
      videoId: player?.getVideoData().video_id,
      muted: player?.isMuted(),
      paused: video?.paused ?? true,
      time: video?.currentTime ?? 0,
    };
  });

export const videoId = async (page: Page) => (await playerState(page)).videoId;
export const isPaused = async (page: Page) => (await playerState(page)).paused;
export const currentTime = async (page: Page) => (await playerState(page)).time;

/**
 * Waits until the track itself (not an ad) plays for a couple of seconds. Ads
 * are skipped to their end, and paused media is started as a user would.
 */
export async function waitForTrackPlaying(
  page: Page,
  timeout = TRACK_PLAYING_TIMEOUT_MS,
) {
  await page.evaluate(() => {
    window.__atomE2ePlayingSince = undefined;
  });
  await page.waitForFunction(
    (stableMs) => {
      const player = document.querySelector<MoviePlayer>('#movie_player');
      const video = document.querySelector('video');
      const ad = !!player?.classList.contains('ad-showing');
      if (ad && video?.duration) video.currentTime = video.duration;
      if (video?.paused) player?.playVideo();
      const playing = !ad && !!video && !video.paused && video.currentTime > 0;
      if (!playing) {
        window.__atomE2ePlayingSince = undefined;
        return false;
      }
      window.__atomE2ePlayingSince ??= Date.now();
      return Date.now() - window.__atomE2ePlayingSince > stableMs;
    },
    STABLE_MS,
    { timeout, polling: POLL_MS },
  );
}

/** Waits until YTM has loaded the queue, which shuffle, next and previous act on. */
export const waitForQueue = (page: Page) =>
  page.waitForFunction(
    () => document.querySelectorAll('ytmusic-player-queue-item').length > 0,
    undefined,
    { timeout: TRACK_PLAYING_TIMEOUT_MS },
  );
