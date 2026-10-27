// The e2e tests' `test`: each worker launches the app once, with the player bar
// its project pins (playwright.config.ts), and the file's tests share it as
// `app` and `mainPage`. A failed test ends the worker, so the tests after it
// get a fresh app.

import { test as base, type Page } from '@playwright/test';

import {
  type AtomApp,
  closeApp,
  launchApp,
  mainWindow,
  type PlayerBar,
} from './launch.ts';

export { expect } from '@playwright/test';

/** Launch, the consent screen and YTM's first load. */
const APP_SETUP_TIMEOUT_MS = 120_000;

interface WorkerFixtures {
  /** The player bar the app pins; set per project. */
  playerBar: PlayerBar;
  app: AtomApp;
  /** The app's window, on music.youtube.com with the player loaded. */
  mainPage: Page;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}, WorkerFixtures>({
  playerBar: ['classic', { option: true, scope: 'worker' }],
  app: [
    async ({ playerBar }, use) => {
      const app = await launchApp({
        playerBar,
        // Off by default; on here to check that its menu entry finds either bar.
        plugins: { downloader: { enabled: true } },
      });
      try {
        await use(app);
      } finally {
        await closeApp(app);
      }
    },
    { scope: 'worker', timeout: APP_SETUP_TIMEOUT_MS },
  ],
  mainPage: [
    async ({ app }, use) => {
      await use(await mainWindow(app));
    },
    { scope: 'worker', timeout: APP_SETUP_TIMEOUT_MS },
  ],
});
