let observers: MutationObserver[] = [];
// The user's own mute and speed, saved when an ad starts and given back when
// it ends. Outside ads the video is left alone.
let adActive = false;
let savedMuted = false;
let savedRate = 1;

function skipAd(target: Element) {
  const skipButton = target.querySelector<HTMLButtonElement>(
    'button.ytp-ad-skip-button-modern',
  );
  if (skipButton) {
    skipButton.click();
  }
}

function speedUpAndMute(player: Element, isAdShowing: boolean) {
  const video = player.querySelector<HTMLVideoElement>('video');
  if (!video) return;
  if (isAdShowing) {
    if (!adActive) {
      adActive = true;
      savedMuted = video.muted;
      savedRate = video.playbackRate;
    }
    video.playbackRate = 16;
    video.muted = true;
  } else if (adActive) {
    adActive = false;
    video.playbackRate = savedRate;
    video.muted = savedMuted;
  }
}

const isAdShowing = (player: Element) =>
  player.classList.contains('ad-showing') ||
  player.classList.contains('ad-interrupting');

export const unloadAdSpeedup = () => {
  for (const observer of observers) observer.disconnect();
  observers = [];

  const player = document.querySelector('#movie_player');
  if (player) speedUpAndMute(player, false);
};

export const loadAdSpeedup = () => {
  const player = document.querySelector<HTMLElement>('#movie_player');
  if (!player) return;

  unloadAdSpeedup();

  // Ads toggle classes on #movie_player itself. Watching attributes on its
  // whole subtree fired on every progress bar update and reset the user's
  // mute and speed each time.
  const adObserver = new MutationObserver(() => {
    speedUpAndMute(player, isAdShowing(player));
  });
  adObserver.observe(player, { attributes: true, attributeFilter: ['class'] });

  const skipObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.addedNodes.length &&
        mutation.target instanceof HTMLElement
      ) {
        skipAd(mutation.target);
      }
    }
  });
  skipObserver.observe(player, { childList: true, subtree: true });

  observers = [adObserver, skipObserver];

  if (isAdShowing(player)) {
    speedUpAndMute(player, true);
    skipAd(player);
  }
};
