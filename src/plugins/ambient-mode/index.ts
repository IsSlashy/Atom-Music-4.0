import { styles as style } from './styles';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { menu } from './menu';
import { type AmbientModePluginConfig } from './types';
import { waitForElement } from '@/utils/wait-for-element';

const defaultConfig: AmbientModePluginConfig = {
  enabled: false,
  quality: 50,
  buffer: 30,
  interpolationTime: 1500,
  blur: 100,
  size: 100,
  opacity: 1,
  fullscreen: false,
};

export default createPlugin({
  name: () => t('plugins.ambient-mode.name'),
  description: () => t('plugins.ambient-mode.description'),
  restartNeeded: false,
  config: defaultConfig,
  stylesheets: [style],
  menu: menu,

  renderer: {
    interpolationTime: defaultConfig.interpolationTime,
    buffer: defaultConfig.buffer,
    qualityRatio: defaultConfig.quality,
    size: defaultConfig.size,
    blur: defaultConfig.blur,
    opacity: defaultConfig.opacity,
    isFullscreen: defaultConfig.fullscreen,

    unregister: null as (() => void) | null,
    update: null as (() => void) | null,
    interval: null as NodeJS.Timeout | null,
    observer: null as MutationObserver | null,
    isStarted: false,
    lastMediaType: null as 'video' | 'image' | null,
    lastVideoSource: null as string | null,
    lastImageSource: null as string | null,

    async start({ getConfig }) {
      this.isStarted = true;
      const config = await getConfig();
      this.interpolationTime = config.interpolationTime;
      this.buffer = config.buffer;
      this.qualityRatio = config.quality;
      this.size = config.size;
      this.blur = config.blur;
      this.opacity = config.opacity;
      this.isFullscreen = config.fullscreen;

      const songImage = document.querySelector<HTMLImageElement>('#song-image');
      const songVideo = document.querySelector<HTMLDivElement>('#song-video');
      const image = songImage?.querySelector<HTMLImageElement>(
        'yt-img-shadow > img',
      );
      const video = await waitForElement<HTMLVideoElement>(
        '.html5-video-container > video',
      );
      // The plugin may have been disabled while waiting for the video
      if (!this.isStarted) return;

      const videoWrapper = document.querySelector(
        '#song-video > .player-wrapper',
      );

      const injectBlurImage = () => {
        if (!songImage || !image) return null;

        this.lastImageSource = image.src;

        const blurImage = document.createElement('img');
        blurImage.classList.add('html5-blur-image');
        blurImage.src = image.src;

        this.update = () => {
          if (this.isFullscreen) blurImage.classList.add('fullscreen');
          else blurImage.classList.remove('fullscreen');

          blurImage.style.setProperty('--width', `${this.size}%`);
          blurImage.style.setProperty('--height', `${this.size}%`);
          blurImage.style.setProperty('--blur', `${this.blur}px`);
          blurImage.style.setProperty('--opacity', `${this.opacity}`);
        };
        this.update();

        /* injecting */
        songImage.prepend(blurImage);

        /* cleanup */
        return () => {
          if (blurImage.isConnected) blurImage.remove();
        };
      };

      const injectBlurVideo = () => {
        if (!songVideo || !video || !videoWrapper) return null;

        this.lastVideoSource = video.src;

        const blurCanvas = document.createElement('canvas');
        blurCanvas.classList.add('html5-blur-canvas');

        const context = blurCanvas.getContext('2d');

        /* effect — pure GPU path, no getImageData/putImageData readbacks */
        const onSync = () => {
          if (!context) return;

          const width = this.qualityRatio;
          let height = Math.max(
            Math.floor((blurCanvas.height / blurCanvas.width) * width),
            1,
          );
          if (!Number.isFinite(height)) height = width;
          if (!height) return;

          // Blend previous frame with new frame using globalAlpha (GPU-only path)
          const frameOffset =
            (1 / this.buffer) * (1000 / this.interpolationTime);
          // Draw current canvas content at reduced opacity for blending
          context.globalAlpha = Math.min(1, 1 - frameOffset * 2);
          context.drawImage(blurCanvas, 0, 0, width, height);
          // Overlay new video frame
          context.globalAlpha = Math.min(1, frameOffset);
          context.drawImage(video, 0, 0, width, height);
          context.globalAlpha = 1;
        };

        this.update = () => {
          const rect = video.getBoundingClientRect();

          const newWidth = Math.floor(video.width || rect.width);
          const newHeight = Math.floor(video.height || rect.height);

          if (newWidth === 0 || newHeight === 0) return;

          blurCanvas.width = this.qualityRatio;
          blurCanvas.height = Math.floor(
            (newHeight / newWidth) * this.qualityRatio,
          );

          if (this.isFullscreen) blurCanvas.classList.add('fullscreen');
          else blurCanvas.classList.remove('fullscreen');

          blurCanvas.style.setProperty('--width', `${this.size}%`);
          blurCanvas.style.setProperty('--height', `${this.size}%`);
          blurCanvas.style.setProperty('--blur', `${this.blur}px`);
          blurCanvas.style.setProperty('--opacity', `${this.opacity}`);
        };
        this.update();

        /* hooking — use rAF with frame-rate throttling */
        let rafId: number | null = null;
        let lastFrameTime = 0;
        let isRunning = true;

        const frameInterval = Math.max(1, Math.ceil(1000 / this.buffer));
        const rafLoop = (timestamp: number) => {
          if (!isRunning) return;
          if (timestamp - lastFrameTime >= frameInterval) {
            lastFrameTime = timestamp;
            onSync();
          }
          rafId = requestAnimationFrame(rafLoop);
        };

        const startLoop = () => {
          if (rafId !== null) return;
          isRunning = true;
          rafId = requestAnimationFrame(rafLoop);
        };
        const stopLoop = () => {
          isRunning = false;
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
        };

        const onPause = () => stopLoop();
        const onPlay = () => startLoop();

        // Media events do not bubble, so listen on the video itself
        video.addEventListener('pause', onPause);
        video.addEventListener('play', onPlay);
        if (!video.paused) startLoop();

        /* injecting */
        videoWrapper.prepend(blurCanvas);

        /* cleanup */
        return () => {
          stopLoop();

          video.removeEventListener('pause', onPause);
          video.removeEventListener('play', onPlay);

          if (blurCanvas.isConnected) blurCanvas.remove();
        };
      };

      const isVideoMode = () => {
        const songVideo = document.querySelector<HTMLDivElement>('#song-video');
        if (!songVideo) {
          this.lastMediaType = 'image';
          return false;
        }

        const isVideo = getComputedStyle(songVideo).display !== 'none';
        this.lastMediaType = isVideo ? 'video' : 'image';
        return isVideo;
      };

      const playerPage = document.querySelector<HTMLElement>('#player-page');
      const ytmusicAppLayout = document.querySelector<HTMLElement>('#layout');

      const injectBlurElement = (force?: boolean): boolean | void => {
        const isPageOpen = ytmusicAppLayout?.hasAttribute('player-page-open');
        if (isPageOpen) {
          // isVideoMode() overwrites lastMediaType, so read it first
          const previousMediaType = this.lastMediaType;
          const isVideo = isVideoMode();
          if (!force) {
            if (
              previousMediaType === 'video' &&
              isVideo &&
              this.lastVideoSource === video?.src
            )
              return false;
            if (
              previousMediaType === 'image' &&
              !isVideo &&
              this.lastImageSource === image?.src
            )
              return false;
          }
          this.unregister?.();
          this.unregister =
            (isVideo ? injectBlurVideo() : injectBlurImage()) ?? null;
        } else {
          this.unregister?.();
          this.unregister = null;
          // Nothing is injected anymore, so reopening must inject again
          this.lastMediaType = null;
        }
      };

      /* needed for switching between different views (e.g. miniplayer) */
      this.observer?.disconnect();
      this.observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
          if (mutation.type === 'attributes') {
            injectBlurElement(true);
            break;
          }
        }
      });

      if (playerPage) {
        this.observer.observe(playerPage, { attributes: true });

        /* fallback ticker for when the observer isn't triggered */
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(injectBlurElement, 1000);
      }

      injectBlurElement();
    },
    onConfigChange(newConfig) {
      this.interpolationTime = newConfig.interpolationTime;
      this.buffer = newConfig.buffer;
      this.qualityRatio = newConfig.quality;
      this.size = newConfig.size;
      this.blur = newConfig.blur;
      this.opacity = newConfig.opacity;
      this.isFullscreen = newConfig.fullscreen;

      this.update?.();
    },
    stop() {
      this.isStarted = false;
      this.update = null;
      this.unregister?.();
      this.unregister = null;
      this.observer?.disconnect();
      this.observer = null;
      if (this.interval) clearInterval(this.interval);
      this.interval = null;
      // Forget what was injected, so a later start() injects again
      this.lastMediaType = null;
      this.lastVideoSource = null;
      this.lastImageSource = null;
    },
  },
});
