import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright';
import { test, expect } from '@playwright/test';

const appPath = path.resolve(import.meta.dirname, '..');
const LOAD_TIMEOUT_MS = 45_000;

test('YouTube Music App - With default settings, app is launched and visible', async () => {
  // A profile of its own, removed afterwards: never the user's real one
  const userData = mkdtempSync(path.join(tmpdir(), 'atom-test-'));
  // NODE_ENV=test turns the renderer sandbox on (src/index.ts), which the
  // preload does not run under: start the app as users do
  const env = { ...process.env };
  if (env.NODE_ENV === 'test') delete env.NODE_ENV;

  const app = await electron.launch({
    cwd: appPath,
    args: [
      appPath,
      `--user-data-dir=${userData}`,
      '--no-sandbox',
      '--disable-gpu',
      '--whitelisted-ips=',
      '--disable-dev-shm-usage',
    ],
    env,
  });

  try {
    const window = await app.firstWindow();
    await window.waitForURL(/^https:\/\/(consent|music)\.youtube\.com\//, {
      timeout: LOAD_TIMEOUT_MS,
    });

    // In the EU a new profile first gets Google's consent screen: answer it
    // with "Reject all", the form with set_eom=true, whatever the language
    if (window.url().startsWith('https://consent.youtube.com/')) {
      await window
        .locator(
          'form[action="https://consent.youtube.com/save"]:has(input[name="set_eom"][value="true"]) button',
        )
        .first()
        .click({ timeout: LOAD_TIMEOUT_MS });
      await window.waitForURL(/^https:\/\/music\.youtube\.com\//, {
        timeout: LOAD_TIMEOUT_MS,
      });
    }

    const url = window.url();
    expect(url.startsWith('https://music.youtube.com')).toBe(true);
  } finally {
    await app.close();
    rmSync(userData, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
  }
});
