// End-to-end tests of the built app against the live YouTube Music, once with
// each player bar pinned. Run with `pnpm test:e2e` after `pnpm build`;
// `--project=classic` or `--project=new` runs one bar.

import { defineConfig } from '@playwright/test';

import type { PlayerBar } from './launch.ts';

export default defineConfig<{ playerBar: PlayerBar }>({
  testDir: '.',
  // Not `.test.ts`: the plain `playwright test` that CI runs must not pick
  // these up, they need YTM to answer and play.
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  reporter: 'list',
  // The tests drive the real YTM: ads and network hiccups are outside our
  // control, so one retry separates flakes from real failures.
  retries: 1,
  // One app per bar, side by side.
  workers: 2,
  projects: [
    { name: 'classic', use: { playerBar: 'classic' } },
    { name: 'new', use: { playerBar: 'new' } },
  ],
});
