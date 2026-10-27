import { app } from 'electron';

import type { PictureInPicturePluginConfig } from './index';

import type { BackendContext } from '@/types/contexts';

let config: PictureInPicturePluginConfig;

export const onMainLoad = async ({
  window,
  getConfig,
  setConfig,
  ipc: { send, on },
}: BackendContext<PictureInPicturePluginConfig>) => {
  let isInPiP = false;
  // Raised while togglePiP moves and resizes the window, so those events are
  // not saved as the user's PiP geometry. Lowered on the next tick.
  let isApplyingGeometry = false;
  let originalPosition: number[];
  let originalSize: number[];
  let originalMinimumSize: number[];
  let originalFullScreen: boolean;
  let originalMaximized: boolean;

  const pipPosition = () =>
    (config.savePosition && config['pip-position']) || [10, 10];
  const pipSize = () => (config.saveSize && config['pip-size']) || [450, 275];

  const togglePiP = () => {
    isInPiP = !isInPiP;
    setConfig({ isInPiP });
    isApplyingGeometry = true;

    if (isInPiP) {
      originalFullScreen = window.isFullScreen();
      if (originalFullScreen) {
        window.setFullScreen(false);
      }

      originalMaximized = window.isMaximized();
      if (originalMaximized) {
        window.unmaximize();
      }

      originalPosition = window.getPosition();
      originalSize = window.getSize();
      originalMinimumSize = window.getMinimumSize();

      window.webContents.addListener('before-input-event', blockShortcutsInPiP);

      window.setMaximizable(false);
      window.setFullScreenable(false);

      send('ytmd:pip-toggle', true);

      app.dock?.hide();
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      app.dock?.show();
      if (config.alwaysOnTop) {
        window.setAlwaysOnTop(true, 'screen-saver', 1);
      }

      // The main window's minimum size would clamp the PiP size (450x275 to 450x425)
      window.setMinimumSize(300, 170);
      const [x, y] = pipPosition();
      const [w, h] = pipSize();
      window.setPosition(x, y);
      window.setSize(w, h);
    } else {
      window.webContents.removeListener(
        'before-input-event',
        blockShortcutsInPiP,
      );
      window.setMaximizable(true);
      window.setFullScreenable(true);

      send('ytmd:pip-toggle', false);

      window.setVisibleOnAllWorkspaces(false);
      window.setAlwaysOnTop(false);

      // Restore the normal bounds first, so maximize and full screen return to them
      const [x, y] = originalPosition;
      const [w, h] = originalSize;
      window.setPosition(x, y);
      window.setSize(w, h);
      window.setMinimumSize(originalMinimumSize[0], originalMinimumSize[1]);

      if (originalFullScreen) {
        window.setFullScreen(true);
      }

      if (originalMaximized) {
        window.maximize();
      }
    }

    window.setWindowButtonVisibility?.(!isInPiP);
    setImmediate(() => {
      isApplyingGeometry = false;
    });
  };

  const blockShortcutsInPiP = (
    event: Electron.Event,
    input: Electron.Input,
  ) => {
    const key = input.key.toLowerCase();

    if (key === 'f') {
      event.preventDefault();
    } else if (key === 'escape') {
      togglePiP();
      event.preventDefault();
    }
  };

  // Leave PiP when the window closes, so the window geometry and maximized state
  // saved on close (src/index.ts) are the normal ones and not the PiP ones.
  // Registered before that save, which runs after the plugins are loaded.
  window.on('close', () => {
    if (isInPiP) {
      togglePiP();
    }
  });

  config ??= await getConfig();
  setConfig({ isInPiP });
  on('plugin:toggle-picture-in-picture', () => {
    togglePiP();
  });

  // Read the local state: config.isInPiP is written asynchronously and can be
  // stale, which used to save the normal window geometry as the PiP one.
  window.on('move', () => {
    if (isInPiP && !isApplyingGeometry) {
      const [x, y] = window.getPosition();
      setConfig({ 'pip-position': [x, y] });
    }
  });

  window.on('resize', () => {
    if (isInPiP && !isApplyingGeometry) {
      const [width, height] = window.getSize();
      setConfig({ 'pip-size': [width, height] });
    }
  });
};

export const onConfigChange = (newConfig: PictureInPicturePluginConfig) => {
  config = newConfig;
};
