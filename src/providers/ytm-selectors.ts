/**
 * Where YTM's player bar controls are, for both of its player bars.
 *
 * YTM serves part of its visitors a new player bar (`ytmusic-miniplayer`, behind
 * the music_web_enable_wiz_miniplayer flag) instead of `<ytmusic-player-bar>`,
 * and `options.playerBar` can pin one of them (see preload.ts). Each entry
 * lists the classic bar's selector first, then the new bar's, as read on
 * 2026-10-27. When YTM changes its markup, fix the selector here once.
 *
 * In windows narrower than about 616 px the new bar switches to a small layout
 * with only play/pause and next, so the other controls are missing there.
 *
 * Adapted from upstream pear-desktop's selector registry (`rewrite` branch,
 * packages/sdk/src/selectors.ts). Both bars' selectors start from the bar
 * that is a child of the app layout because in narrow windows the player page
 * shows a second one (`.top-player-bar` for the new bar, a hidden
 * `ytmusic-player-bar` for the classic one), which stays in the page, first in
 * document order, after the window is widened again.
 */
const CLASSIC_BAR = 'ytmusic-app-layout > ytmusic-player-bar';
const NEW_BAR = 'ytmusic-app-layout > .ytMusicMiniPlayerHost';

const playerControls = {
  /** The bar itself. */
  playerBar: [CLASSIC_BAR, NEW_BAR],
  next: [
    `${CLASSIC_BAR} .next-button`,
    `${NEW_BAR} .ytmusicPlayerControlsNextButton button, ${NEW_BAR} .ytMusicSmallViewportMiniplayerNextButton button`,
  ],
  previous: [
    `${CLASSIC_BAR} .previous-button`,
    `${NEW_BAR} .ytmusicPlayerControlsPreviousButton button`,
  ],
  playPause: [
    `${CLASSIC_BAR} #play-pause-button`,
    `${NEW_BAR} .ytmusicPlayerControlsPlayPauseButton button, ${NEW_BAR} .ytMusicSmallViewportMiniplayerPlayPauseButton button`,
  ],
  shuffle: [
    `${CLASSIC_BAR} .shuffle`,
    `${NEW_BAR} .ytmusicPlayerControlsShuffleButton button`,
  ],
  repeat: [
    `${CLASSIC_BAR} #right-controls .repeat`,
    `${NEW_BAR} .ytmusicPlayerControlsRepeatButton button`,
  ],
  /** The volume button. In the new bar, hovering it shows the volume slider. */
  mute: [`${CLASSIC_BAR} .volume`, `${NEW_BAR} .ytMusicMiniPlayerMuteButton`],
  /**
   * A tp-yt-paper-slider in the classic bar, a range input in the new one.
   * Both have a `value` from 0 to 100.
   */
  volumeSlider: [
    `${CLASSIC_BAR} #volume-slider`,
    `${NEW_BAR} .ytMusicMiniPlayerVolumePopup input`,
  ],
  progress: [
    `${CLASSIC_BAR} #progress-bar`,
    `${NEW_BAR} input.ytMusicMiniPlayerProgressBar`,
  ],
  /** The element a player bar menu is opened from. */
  menuButton: [
    `${CLASSIC_BAR} ytmusic-menu-renderer`,
    `${NEW_BAR} .ytMusicMiniPlayerMenuButton`,
  ],
  title: [`${CLASSIC_BAR} .title`, `${NEW_BAR} .ytmusicTrackInfoTitle`],
  /**
   * The like and dislike pair. The classic one has a `like-status` attribute
   * and `updateLikeStatus()`. YTM sends the pair only with the bar it chose
   * for the visitor, and logged out the new bar has none.
   */
  like: [
    `${CLASSIC_BAR} #like-button-renderer`,
    `${NEW_BAR} segmented-like-dislike-button-view-model`,
  ],
  /** The pair's buttons; `aria-pressed` tells which one is on. */
  likeButton: [
    `${CLASSIC_BAR} #like-button-renderer #button-shape-like button`,
    `${NEW_BAR} like-button-view-model button`,
  ],
  dislikeButton: [
    `${CLASSIC_BAR} #like-button-renderer #button-shape-dislike button`,
    `${NEW_BAR} dislike-button-view-model button`,
  ],
} as const satisfies Record<string, readonly [classic: string, new: string]>;

export type PlayerControl = keyof typeof playerControls;

/** The control in whichever player bar the page has, or null. */
export function queryControl<E extends Element = HTMLElement>(
  key: PlayerControl,
): E | null {
  for (const selector of playerControls[key]) {
    const element = document.querySelector<E>(selector);
    if (element) return element;
  }
  return null;
}
