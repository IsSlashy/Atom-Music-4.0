// YTM's two player bars: the classic <ytmusic-player-bar>, and the new one YTM
// serves part of its visitors behind four site flags, which options.playerBar
// pins (src/preload.ts). Ported from upstream pear-desktop's e2e helper of the
// same name (`rewrite` branch, apps/desktop/e2e/helpers/player-bar.ts).

import type { Page } from '@playwright/test';

import type { PlayerBar } from '../launch.ts';

/** The flags behind the new bar; options.playerBar sets all four. */
export const NEW_PLAYER_BAR_FLAGS = [
  'music_web_enable_wiz_miniplayer',
  'music_web_enable_action_bar_view_model_in_player_overlay',
  'music_web_enable_like_count_in_player_overlay',
  'music_web_enable_contained_content_layout',
];

/**
 * Each bar's root. The new bar's player page has a second bar of its own,
 * hence `ytmusic-app-layout >`.
 */
export const BAR_ROOT: Record<PlayerBar, string> = {
  'classic': 'ytmusic-player-bar',
  'new': 'ytmusic-app-layout > .ytMusicMiniPlayerHost',
};

export type ControlName =
  | 'next'
  | 'previous'
  | 'playPause'
  | 'shuffle'
  | 'repeat'
  | 'mute'
  | 'volumeSlider'
  | 'progress'
  | 'menuButton'
  | 'title';

/**
 * The controls the app clicks or reads, on each bar, as YTM served them on
 * 2026-10-27 to a visitor who is not signed in. When YTM changes its markup,
 * this is what breaks first: the app's own selectors need the same fix. The
 * like buttons are left out: logged out, YTM leaves them empty for some
 * visitors.
 */
export const CONTROLS: Record<PlayerBar, Record<ControlName, string>> = {
  'classic': {
    next: 'ytmusic-player-bar .next-button',
    previous: 'ytmusic-player-bar .previous-button',
    playPause: 'ytmusic-player-bar #play-pause-button',
    shuffle: 'ytmusic-player-bar .shuffle',
    repeat: 'ytmusic-player-bar #right-controls .repeat',
    mute: 'ytmusic-player-bar .volume',
    volumeSlider: 'ytmusic-player-bar #volume-slider',
    progress: 'ytmusic-player-bar #progress-bar',
    menuButton: 'ytmusic-player-bar ytmusic-menu-renderer.menu',
    title: 'ytmusic-player-bar .title',
  },
  'new': {
    next: '.ytmusicPlayerControlsNextButton button',
    previous: '.ytmusicPlayerControlsPreviousButton button',
    playPause: '.ytmusicPlayerControlsPlayPauseButton button',
    shuffle: '.ytmusicPlayerControlsShuffleButton button',
    repeat: '.ytmusicPlayerControlsRepeatButton button',
    mute: '.ytMusicMiniPlayerMuteButton button',
    volumeSlider: '.ytMusicMiniPlayerVolumePopup input',
    progress: 'input.ytMusicMiniPlayerProgressBar',
    menuButton: '.ytMusicMiniPlayerMenuButton button',
    title: '.ytmusicTrackInfoTitle',
  },
};

/** Which bar the page shows: 'none' before YTM builds one, 'both' should not happen. */
export const barLayout = (page: Page) =>
  page.evaluate(({ classic, new: newBar }) => {
    const hasClassic = !!document.querySelector(classic);
    const hasNew = !!document.querySelector(newBar);
    if (hasClassic && hasNew) return 'both';
    if (hasClassic) return 'classic';
    return hasNew ? 'new' : 'none';
  }, BAR_ROOT);

/** The flags as YTM's code reads them, in NEW_PLAYER_BAR_FLAGS order. */
export const liveFlags = (page: Page) =>
  page.evaluate((names) => {
    const page = window as unknown as {
      yt?: { config_?: { EXPERIMENT_FLAGS?: Record<string, unknown> } };
    };
    const flags = page.yt?.config_?.EXPERIMENT_FLAGS ?? {};
    return names.map((name) => flags[name]);
  }, NEW_PLAYER_BAR_FLAGS);

/** The controls of `layout` that the page lacks. */
export const missingControls = (page: Page, layout: PlayerBar) =>
  page.evaluate(
    (controls) =>
      Object.entries(controls)
        .filter(([, selector]) => !document.querySelector(selector))
        .map(([name]) => name),
    CONTROLS[layout],
  );

/** Whether the bar shows shuffle as on. */
export const shuffleShown = (page: Page, layout: PlayerBar) =>
  page.evaluate(
    ({ layout, button }) =>
      layout === 'classic'
        ? !!document.querySelector('ytmusic-player-bar[shuffle-on]')
        : document.querySelector(button)?.getAttribute('aria-pressed') ===
          'true',
    { layout, button: CONTROLS.new.shuffle },
  );

/** The bar's volume slider value, 0 to 100. */
export const sliderVolume = (page: Page, layout: PlayerBar) =>
  page.evaluate(
    (selector) =>
      Number(
        document.querySelector<HTMLElement & { value: number | string }>(
          selector,
        )?.value,
      ),
    CONTROLS[layout].volumeSlider,
  );
