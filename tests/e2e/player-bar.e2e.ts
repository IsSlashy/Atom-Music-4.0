// YTM's player bar pinned both ways by options.playerBar, and the app working
// on it: its startup, its sidebar entries, the plugins' menu entries, and the
// controls that the tray, the shortcuts, the youtubemusic:// links and SMTC go
// through. Ported from upstream pear-desktop's site-features.test.ts (`rewrite`
// branch, apps/desktop/e2e).

import { expect, test } from './fixtures.ts';
import {
  barLayout,
  CONTROLS,
  liveFlags,
  missingControls,
  NEW_PLAYER_BAR_FLAGS,
  shuffleShown,
  sliderVolume,
} from './helpers/player-bar.ts';
import {
  currentTime,
  isPaused,
  playerState,
  videoId,
  waitForQueue,
  waitForTrackPlaying,
} from './helpers/playback.ts';
import {
  type AtomApp,
  ipcMessages,
  mainNow,
  protocol,
  sendToPage,
  TEST_VIDEO_ID,
} from './launch.ts';

/** How long YTM gets to act on a control. */
const CONTROL_TIMEOUT_MS = 15_000;
const VOLUME = 37;

/** What the page answers to the protocol's requestShuffleInformation. */
async function askShuffle(app: AtomApp) {
  const since = await mainNow(app);
  await protocol(app, 'requestShuffleInformation');
  const answers = () => ipcMessages(app, 'ytmd:get-shuffle-response', since);
  await expect.poll(async () => (await answers()).length).toBe(1);
  return (await answers())[0].args[0];
}

test('the pinned bar, with every control the app uses', async ({
  mainPage: page,
  playerBar,
}) => {
  await expect.poll(() => barLayout(page)).toBe(playerBar);
  expect(await liveFlags(page)).toEqual(
    NEW_PLAYER_BAR_FLAGS.map(() => playerBar === 'new'),
  );
  await expect.poll(() => missingControls(page, playerBar)).toEqual([]);
});

test('the track plays, and the page reports to the main process', async ({
  app,
  mainPage: page,
}) => {
  await waitForTrackPlaying(page);
  expect(await videoId(page)).toBe(TEST_VIDEO_ID);
  // The renderer's startup ran to its end: a plugin's onPlayerApiReady
  // throwing used to stop it before this.
  expect(await ipcMessages(app, 'ytmd:player-api-loaded')).not.toHaveLength(0);
  // The playback time reaches the main process's song info.
  const since = await mainNow(app);
  await expect
    .poll(
      async () => (await ipcMessages(app, 'ytmd:time-changed', since)).length,
    )
    .toBeGreaterThanOrEqual(2);
});

test("the app's sidebar entries and local playback, and the plugins' entries", async ({
  mainPage: page,
  playerBar,
}) => {
  await expect(page.locator('#mini-guide .ytmd-custom-entry')).toHaveCount(2);
  expect(
    await page.evaluate(
      () =>
        typeof (window as unknown as Record<string, unknown>)
          .__ytmdPlayLocalFile,
    ),
  ).toBe('function');
  // video-toggle's switch, on by default. Empty on song-only tracks like this one.
  await expect(
    page.locator('#ytmd-video-toggle-switch-button-container'),
  ).toBeAttached();

  // The bar's track menu holds the picture-in-picture and downloader entries.
  await page.locator(CONTROLS[playerBar].menuButton).click();
  const menu = page
    .locator('ytmusic-menu-popup-renderer tp-yt-paper-listbox')
    .filter({ has: page.locator('.ytmd-pip-menu-item') });
  await expect(menu.locator('.ytmd-pip-menu-item')).toBeVisible();
  await expect(menu.locator('.ytmd-menu-item')).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test('play, pause and seek from outside the page', async ({
  app,
  mainPage: page,
}) => {
  await waitForTrackPlaying(page);
  await protocol(app, 'pause');
  await expect.poll(() => isPaused(page)).toBe(true);
  await protocol(app, 'playPause');
  await expect.poll(() => isPaused(page)).toBe(false);
  await protocol(app, 'playPause');
  await expect.poll(() => isPaused(page)).toBe(true);
  await protocol(app, 'play');
  await expect.poll(() => isPaused(page)).toBe(false);
  // A link's arguments arrive as text, which the song controls drop: send the
  // number as the shortcuts and the other integrations do.
  await sendToPage(app, 'ytmd:seek-to', 30);
  await expect.poll(() => currentTime(page)).toBeGreaterThanOrEqual(29);
});

test('shuffle, and get-shuffle answers what the bar shows', async ({
  app,
  mainPage: page,
  playerBar,
}) => {
  await waitForQueue(page);
  const before = await shuffleShown(page, playerBar);
  expect(await askShuffle(app)).toBe(before);
  for (const shown of [!before, before]) {
    await protocol(app, 'shuffle');
    await expect
      .poll(() => shuffleShown(page, playerBar), {
        timeout: CONTROL_TIMEOUT_MS,
      })
      .toBe(shown);
    expect(await askShuffle(app)).toBe(shown);
  }
});

test('mute and volume from outside the page, and the bar follows', async ({
  app,
  mainPage: page,
  playerBar,
}) => {
  const { muted } = await playerState(page);
  await protocol(app, 'muteUnmute');
  await expect.poll(async () => (await playerState(page)).muted).toBe(!muted);
  await protocol(app, 'muteUnmute');
  await expect.poll(async () => (await playerState(page)).muted).toBe(muted);

  // The value is the slider's: YTM maps it to the player's volume on a curve.
  await sendToPage(app, 'ytmd:update-volume', VOLUME);
  await expect.poll(() => sliderVolume(page, playerBar)).toBe(VOLUME);
});

test('next and previous change the track', async ({ app, mainPage: page }) => {
  await waitForTrackPlaying(page);
  await waitForQueue(page);
  const first = await videoId(page);
  await protocol(app, 'next');
  await expect
    .poll(() => videoId(page), { timeout: CONTROL_TIMEOUT_MS })
    .not.toBe(first);
  // Right after a track starts, previous goes back instead of restarting it.
  await protocol(app, 'previous');
  await expect
    .poll(() => videoId(page), { timeout: CONTROL_TIMEOUT_MS })
    .toBe(first);
});
