// A packaged build claims youtubemusic:// for the user as it starts
// (src/providers/protocol-handler.ts), so a test run of one (ATOM_E2E_EXECUTABLE)
// would leave the links opening the build under test. On Windows, the
// registration it replaced is put back once the tests are done.

import { execFileSync } from 'node:child_process';

const KEY = 'HKCU:\\Software\\Classes\\youtubemusic';
const COMMAND_KEY = `${KEY}\\shell\\open\\command`;

/** Runs a PowerShell script with `env`, and returns what it printed (UTF-8). */
const powershell = (script: string, env: Record<string, string> = {}) =>
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8; ${script}`,
    ],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  ).replace(/\r?\n$/, '');

export default function globalSetup() {
  if (!process.env.ATOM_E2E_EXECUTABLE || process.platform !== 'win32') return;

  const hadKey = powershell(`Test-Path '${KEY}'`) === 'True';
  const hadCommand = powershell(`Test-Path '${COMMAND_KEY}'`) === 'True';
  const command = hadCommand
    ? powershell(`(Get-Item '${COMMAND_KEY}').GetValue('')`)
    : '';

  return () => {
    if (!hadKey) {
      powershell(`Remove-Item '${KEY}' -Recurse -Force -ErrorAction Ignore`);
    } else if (!hadCommand) {
      powershell(
        `Remove-Item '${KEY}\\shell' -Recurse -Force -ErrorAction Ignore`,
      );
    } else {
      powershell(
        `Set-ItemProperty '${COMMAND_KEY}' -Name '(default)' -Value $env:ATOM_E2E_PROTOCOL_COMMAND`,
        { ATOM_E2E_PROTOCOL_COMMAND: command },
      );
    }
  };
}
