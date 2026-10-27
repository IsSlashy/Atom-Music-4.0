import { app, type BrowserWindow } from 'electron';

import { getSongControls } from './song-controls';

export const APP_PROTOCOL = 'youtubemusic';

let protocolHandler: ((cmd: string, ...args: string[]) => void) | undefined;

export function setupProtocolHandler(win: BrowserWindow) {
  // Only the installed app claims youtubemusic:// for the user. A dev or
  // unpacked run used to point it at the working copy on every launch.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }

  const songControls = getSongControls(win);

  protocolHandler = ((cmd: keyof typeof songControls, ...args) => {
    if (Object.keys(songControls).includes(cmd)) {
      // @ts-expect-error: cmd is a key of songControls
      songControls[cmd](...args);
    }
  }) as (cmd: string, ...args: string[]) => void;
}

export function handleProtocol(cmd: string, ...args: string[]) {
  protocolHandler?.(cmd, ...args);
}

export function changeProtocolHandler(
  f: (cmd: string, ...args: string[]) => void,
) {
  protocolHandler = f;
}
