import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import {
  BrowserWindow,
  app,
  screen,
  globalShortcut,
  session,
  shell,
  dialog,
  ipcMain,
  protocol,
  type BrowserWindowConstructorOptions,
} from 'electron';
import {
  enhanceWebRequest,
  type BetterSession,
} from '@jellybrick/electron-better-web-request';
import is from 'electron-is';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';
import { deepEqual } from 'fast-equals';

import { allPlugins, mainPlugins } from 'virtual:plugins';

import { languageResources } from 'virtual:i18n';

import * as config from '@/config';
import { mergePluginConfig } from '@/config/plugins';

import { refreshMenu, setApplicationMenu } from '@/menu';
import { fileExists, injectCSS, injectCSSAsFile } from '@/plugins/utils/main';
import { isTesting } from '@/utils/testing';
import { setUpTray } from '@/tray';
import { setupSongInfo } from '@/providers/song-info';
import { restart, setupAppControls } from '@/providers/app-controls';
import {
  APP_PROTOCOL,
  handleProtocol,
  setupProtocolHandler,
} from '@/providers/protocol-handler';

import { globalStyles as youtubeMusicCSS } from '@/theme/global-styles';

import {
  forceLoadMainPlugin,
  forceUnloadMainPlugin,
  getAllLoadedMainPlugins,
  loadAllMainPlugins,
} from '@/loader/main';

import { LoggerPrefix } from '@/utils';
import { loadI18n, setLanguage, t } from '@/i18n';

import ErrorHtmlAsset from '@assets/error.html?asset';

import type { PluginConfig } from '@/types/plugins';

// Catch errors and log them
unhandled({
  logger: console.error,
  showDialog: false,
});

// Prevent window being garbage collected
let mainWindow: Electron.BrowserWindow | null;
autoUpdater.autoDownload = false;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'http',
    privileges: {
      standard: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  {
    scheme: 'https',
    privileges: {
      standard: true,
      bypassCSP: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
  { scheme: 'mailto', privileges: { standard: true } },
  // No fetch or CORS privileges: Electron answers a custom scheme as
  // same-origin to every frame, so an ACAO header would not stop an ad iframe
  // from fetching the library. <audio> and <img> loads, with seeking, still work.
  {
    scheme: 'ytmd-local',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
    },
  },
]);

// Ozone platform hint: Required for Wayland support
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// SharedArrayBuffer: Required for downloader (@ffmpeg/core-mt)
// OverlayScrollbar: Required for overlay scrollbars
// UseOzonePlatform: Required for Wayland support
// WaylandWindowDecorations: Required for Wayland decorations
app.commandLine.appendSwitch(
  'enable-features',
  'OverlayScrollbar,SharedArrayBuffer,UseOzonePlatform,WaylandWindowDecorations',
);
// Disable Fluent Scrollbar (for OverlayScrollbar)
const disabledFeatures = ['FluentScrollbar'];
if (config.get('options.disableHardwareAcceleration')) {
  if (is.dev()) {
    console.log('Disabling hardware acceleration');
  }

  app.disableHardwareAcceleration();
}

if (is.linux()) {
  // Overrides WM_CLASS for X11 to correspond to icon filename
  app.setName('com.github.th_ch.youtube_music');

  // Stops chromium from launching its own MPRIS service
  if (await config.plugins.isEnabled('shortcuts')) {
    disabledFeatures.push('MediaSessionService');
  }
}

// A second disable-features switch would replace the first one, so append it once
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

if (config.get('options.proxy')) {
  const proxyToUse = config.get('options.proxy');
  console.log(LoggerPrefix, `Using proxy: ${proxyToUse}`);
  app.commandLine.appendSwitch('proxy-server', proxyToUse);
}

// Adds debug features like hotkeys for triggering dev tools and reload
if (is.dev()) {
  const { default: electronDebug } = await import('electron-debug');
  electronDebug({
    showDevTools: false, // Disable automatic devTools on new window
  });
}

// Resolve an asset path that works both in dev (cwd = project root) and in the
// packaged app (assets are asar-unpacked under resources/). Returns the first
// candidate that actually exists, so the window/taskbar icon never silently
// falls back to a missing file on Windows.
const resolveAsset = (relativePath: string): string => {
  const candidates = [
    process.resourcesPath
      ? path.join(process.resourcesPath, 'app.asar.unpacked', relativePath)
      : '',
    process.resourcesPath ? path.join(process.resourcesPath, relativePath) : '',
    path.join(app.getAppPath(), relativePath),
    path.join(process.cwd(), relativePath),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return relativePath;
};

let icon = resolveAsset('assets/youtube-music.png');
if (process.platform === 'win32') {
  icon = resolveAsset('assets/generated/icons/win/icon.ico');
} else if (process.platform === 'darwin') {
  icon = resolveAsset('assets/generated/icons/mac/icon.icns');
}

function onClosed() {
  // Dereference the window
  // For multiple Windows store them in an array
  mainWindow = null;
}

ipcMain.handle('ytmd:get-main-plugin-names', async () =>
  Object.keys(await mainPlugins()),
);

const YTM_ORIGIN = 'https://music.youtube.com';

// Privileged handlers answer only the YouTube Music page in the top frame. The
// preload also runs on consent, sign-in and error pages and in popups, and none
// of those may touch the disk or open an external app.
const isTrustedSender = (
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
) => {
  try {
    const frame = event.senderFrame;
    return (
      !!frame &&
      frame.parent === null &&
      URL.parse(frame.url)?.origin === YTM_ORIGIN
    );
  } catch {
    // The frame was destroyed or navigated away
    return false;
  }
};

// Local library: downloads view, local playback and the ytmd-local protocol.
// The page is a remote origin, so every path it sends is resolved to its real
// location and must be a file with a known extension inside a library root.
const audioMimeTypes: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};
const coverMimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};
const localMimeTypes: Record<string, string> = {
  ...audioMimeTypes,
  ...coverMimeTypes,
};
const coverMimePattern = /^image\/(jpeg|png|webp|gif)$/;
const coverDataUriPattern =
  /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
// Hosts YouTube Music serves artwork from
const coverHostSuffixes = [
  '.ytimg.com',
  '.ggpht.com',
  '.googleusercontent.com',
];
// Playlist and album downloads add one folder level; never crawl a whole
// Downloads tree
const MAX_LIBRARY_DEPTH = 3;
// Bigger ID3 tags are not read for their cover
const MAX_ID3_TAG_SIZE = 16 * 1024 * 1024;
// Bigger cover files are not sent inline to the page
const MAX_INLINE_COVER_SIZE = 4 * 1024 * 1024;

type LibraryFile = {
  name: string;
  path: string;
  size: number;
  modified: number;
  imageSrc?: string;
};

const comparablePath = (filePath: string) =>
  is.windows() ? filePath.toLowerCase() : filePath;

const isInsideRoot = (root: string, target: string) => {
  const relative = path.relative(comparablePath(root), comparablePath(target));
  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative.split(path.sep)[0] !== '..'
  );
};

const isFile = (filePath: string) =>
  fs.promises.stat(filePath).then(
    (stat) => stat.isFile(),
    () => false,
  );

// Read on every request, so a folder change applies at once: the download
// folder (or the system Downloads folder) and the "download on finish" folder.
const getLibraryRoots = async () => {
  const dlConfig = config.get('plugins.downloader') as
    | { downloadFolder?: string; downloadOnFinish?: { folder?: string } }
    | undefined;
  const roots: string[] = [];
  for (const folder of [
    dlConfig?.downloadFolder || app.getPath('downloads'),
    dlConfig?.downloadOnFinish?.folder,
  ]) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) continue;
    try {
      roots.push(await fs.promises.realpath(folder));
    } catch {
      // Missing folder
    }
  }
  return roots;
};

// Returns the real path and stats of a library file, or null if the path is
// not a file with one of `extensions` inside a library root.
const resolveLibraryFile = async (
  rawPath: unknown,
  extensions: Record<string, string>,
) => {
  if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) return null;
  try {
    const realPath = await fs.promises.realpath(rawPath);
    if (!Object.hasOwn(extensions, path.extname(realPath).toLowerCase())) {
      return null;
    }
    const roots = await getLibraryRoots();
    if (!roots.some((root) => isInsideRoot(root, realPath))) return null;
    const stat = await fs.promises.stat(realPath);
    return stat.isFile() ? { path: realPath, stat } : null;
  } catch {
    return null;
  }
};

const toLocalUrl = (host: 'file' | 'cover', filePath: string) =>
  `ytmd-local://${host}?path=${encodeURIComponent(filePath)}`;

const audioBaseName = (name: string) =>
  name.slice(0, name.length - path.extname(name).length);

// Cover files the downloader writes next to a track
const coverFileNames = (audioName: string) => {
  const base = audioBaseName(audioName);
  return [`${base}.jpg`, `${base}.png`, `${audioName}.jpg`, `${audioName}.png`];
};

const readSynchsafe = (buffer: Buffer, offset: number) =>
  ((buffer[offset] & 0x7f) << 21) |
  ((buffer[offset + 1] & 0x7f) << 14) |
  ((buffer[offset + 2] & 0x7f) << 7) |
  (buffer[offset + 3] & 0x7f);

// Returns the mime type of the ID3v2.3/2.4 picture frame. Only the tag header
// and the frame headers are read, never the picture itself.
const findEmbeddedCoverMime = async (filePath: string) => {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await handle.read(header, 0, 10, 0);
    const version = header[3];
    if (
      bytesRead < 10 ||
      header.toString('latin1', 0, 3) !== 'ID3' ||
      (version !== 3 && version !== 4)
    ) {
      return null;
    }

    const tagEnd = 10 + readSynchsafe(header, 6);
    // readEmbeddedCover will not serve a bigger tag
    if (tagEnd > MAX_ID3_TAG_SIZE) return null;
    let offset = 10;
    if (header[5] & 0x40) {
      // Skip the extended header
      const extended = Buffer.alloc(4);
      await handle.read(extended, 0, 4, 10);
      offset +=
        version === 4
          ? readSynchsafe(extended, 0)
          : 4 + extended.readUInt32BE(0);
    }

    const frameHeader = Buffer.alloc(10);
    const frameStart = Buffer.alloc(64);
    for (let frames = 0; frames < 64 && offset + 10 <= tagEnd; frames++) {
      await handle.read(frameHeader, 0, 10, offset);
      const id = frameHeader.toString('latin1', 0, 4);
      // Padding, or a broken tag
      if (!/^[A-Z0-9]{4}$/.test(id)) return null;

      const frameSize =
        version === 4
          ? readSynchsafe(frameHeader, 4)
          : frameHeader.readUInt32BE(4);
      if (id === 'APIC') {
        const read = await handle.read(
          frameStart,
          0,
          Math.min(frameStart.length, frameSize),
          offset + 10,
        );
        // ID3v2.4 frames may start with a 4-byte data length indicator. The
        // body is the text encoding byte, then the null-terminated mime type.
        const mimeStart = (version === 4 && frameHeader[9] & 0x01 ? 4 : 0) + 1;
        const mimeEnd = frameStart.indexOf(0, mimeStart);
        return mimeEnd > mimeStart && mimeEnd < read.bytesRead
          ? frameStart.toString('latin1', mimeStart, mimeEnd).toLowerCase()
          : null;
      }
      offset += 10 + frameSize;
    }
    return null;
  } finally {
    await handle.close();
  }
};

// Listing a library checks every track, so the answer is kept per file version
const embeddedCoverCache = new Map<
  string,
  { mtimeMs: number; size: number; hasCover: boolean }
>();

const hasEmbeddedCover = async (filePath: string, stat: fs.Stats) => {
  const key = comparablePath(filePath);
  const cached = embeddedCoverCache.get(key);
  if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.hasCover;
  }

  const mime = await findEmbeddedCoverMime(filePath).catch(() => null);
  const hasCover = !!mime && coverMimePattern.test(mime);
  embeddedCoverCache.set(key, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    hasCover,
  });
  return hasCover;
};

// Reads only the ID3 tag, not the whole audio file, and returns its picture
const readEmbeddedCover = async (filePath: string) => {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await handle.read(header, 0, 10, 0);
    if (bytesRead < 10 || header.toString('latin1', 0, 3) !== 'ID3') {
      return null;
    }
    const tagSize = 10 + readSynchsafe(header, 6);
    if (tagSize > MAX_ID3_TAG_SIZE) return null;

    const tag = Buffer.alloc(tagSize);
    await handle.read(tag, 0, tagSize, 0);
    const NodeID3 = await import('node-id3');
    const image = NodeID3.read(tag, { include: ['APIC'] }).image;
    const mime =
      image && typeof image === 'object' ? image.mime?.toLowerCase() : null;
    if (
      image &&
      typeof image === 'object' &&
      image.imageBuffer &&
      mime &&
      coverMimePattern.test(mime)
    ) {
      return { mime, data: new Uint8Array(image.imageBuffer) };
    }
    return null;
  } finally {
    await handle.close();
  }
};

// Remote artwork is accepted only over https from YouTube's image hosts, or as
// an inline image. Returning the parsed href keeps quotes out of the string.
const validateCoverUrl = (imageSrc: unknown) => {
  if (typeof imageSrc !== 'string') return null;
  if (coverDataUriPattern.test(imageSrc)) return imageSrc;

  const coverUrl = URL.parse(imageSrc);
  if (coverUrl?.protocol !== 'https:') return null;
  return coverHostSuffixes.some((suffix) => coverUrl.hostname.endsWith(suffix))
    ? coverUrl.href
    : null;
};

const readRemoteCover = async (audioPath: string) => {
  try {
    const meta: unknown = JSON.parse(
      await fs.promises.readFile(`${audioPath}.meta.json`, 'utf-8'),
    );
    return meta && typeof meta === 'object'
      ? validateCoverUrl((meta as { imageSrc?: unknown }).imageSrc)
      : null;
  } catch {
    return null;
  }
};

// Cover priority: a cover file next to the track, then the cover embedded in
// its tags, then the remote artwork recorded at download time. `siblings`
// holds the file names of the track's folder when the caller listed it.
const resolveCoverSrc = async (
  audioPath: string,
  stat: fs.Stats,
  siblings?: Set<string>,
) => {
  const folder = path.dirname(audioPath);
  const name = path.basename(audioPath);
  for (const coverName of coverFileNames(name)) {
    const coverPath = path.join(folder, coverName);
    if (siblings ? siblings.has(coverName) : await isFile(coverPath)) {
      return toLocalUrl('file', coverPath);
    }
  }

  if (await hasEmbeddedCover(audioPath, stat)) {
    return toLocalUrl('cover', audioPath);
  }

  if (siblings && !siblings.has(`${name}.meta.json`)) return null;
  return readRemoteCover(audioPath);
};

const listLibraryFolder = async (
  folder: string,
  depth: number,
  files: Map<string, LibraryFile>,
) => {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }

  // Symbolic links and junctions are skipped, so every listed path is real
  const siblings = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  );
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_LIBRARY_DEPTH && !entry.name.startsWith('.')) {
          await listLibraryFolder(entryPath, depth + 1, files);
        }
        return;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !Object.hasOwn(audioMimeTypes, extension)) return;
      try {
        const stat = await fs.promises.stat(entryPath);
        const imageSrc = await resolveCoverSrc(entryPath, stat, siblings);
        // Keyed by path, so overlapping roots do not list a track twice
        files.set(comparablePath(entryPath), {
          name: entry.name,
          path: entryPath,
          size: stat.size,
          modified: stat.mtimeMs,
          imageSrc: imageSrc ?? undefined,
        });
      } catch {
        // The file went away while listing
      }
    }),
  );
};

// Parses a single "bytes=" range against the file size. Returns null to serve
// the whole file (no range, or a form we do not support, which a server may
// ignore) and 'unsatisfiable' for a 416.
const parseByteRange = (header: string | null, size: number) => {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === '' && match[2] === '')) return null;

  let start: number;
  let end = size - 1;
  if (match[1] === '') {
    // Suffix range: the last N bytes
    const length = Number(match[2]);
    if (length === 0) return 'unsatisfiable';
    start = Math.max(0, size - length);
  } else {
    start = Number(match[1]);
    if (match[2] !== '') end = Math.min(Number(match[2]), size - 1);
  }

  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
};

// List downloaded music files for the in-app downloads view, across every
// library root and its subfolders
ipcMain.handle('ytmd:list-downloads', async (event) => {
  if (!isTrustedSender(event)) return { folder: '', files: [] };

  const dlConfig = config.get('plugins.downloader') as
    | Record<string, unknown>
    | undefined;
  const folder =
    (dlConfig?.downloadFolder as string) || app.getPath('downloads');
  const files = new Map<string, LibraryFile>();
  for (const root of await getLibraryRoots()) {
    await listLibraryFolder(root, 0, files);
  }
  return {
    folder,
    files: [...files.values()].sort((a, b) => b.modified - a.modified), // newest first
  };
});

// A local cover as a data: URI. The media session (SMTC) takes only http(s),
// data and blob images, and the page cannot read ytmd-local to make one.
const readCoverDataUri = async (coverSrc: string, audioPath: string) => {
  const coverUrl = URL.parse(coverSrc);
  let cover: { mime: string; data: Uint8Array } | null = null;
  if (coverUrl?.hostname === 'cover') {
    cover = await readEmbeddedCover(audioPath).catch(() => null);
  } else if (coverUrl?.hostname === 'file') {
    const file = await resolveLibraryFile(
      coverUrl.searchParams.get('path'),
      coverMimeTypes,
    );
    if (file && file.stat.size <= MAX_INLINE_COVER_SIZE) {
      cover = {
        mime: coverMimeTypes[path.extname(file.path).toLowerCase()],
        data: await fs.promises.readFile(file.path),
      };
    }
  }
  return cover && cover.data.length <= MAX_INLINE_COVER_SIZE
    ? `data:${cover.mime};base64,${Buffer.from(cover.data).toString('base64')}`
    : null;
};

// Cover of a library track, as a ytmd-local URL when it is stored locally, or
// inline with format 'data'
ipcMain.handle(
  'ytmd:get-cover',
  async (event, filePath: unknown, format?: unknown) => {
    if (!isTrustedSender(event)) return { imageSrc: null };

    const file = await resolveLibraryFile(filePath, audioMimeTypes);
    if (!file) return { imageSrc: null };
    const imageSrc = await resolveCoverSrc(file.path, file.stat);
    if (format !== 'data' || !imageSrc?.startsWith('ytmd-local:')) {
      return { imageSrc };
    }
    return { imageSrc: await readCoverDataUri(imageSrc, file.path) };
  },
);

// Only web links leave the app: file:, ms-settings: and other schemes would
// open local programs
ipcMain.on('ytmd:open-url', (event, rawUrl: unknown) => {
  if (!isTrustedSender(event) || typeof rawUrl !== 'string') return;

  const target = URL.parse(rawUrl);
  if (target?.protocol !== 'https:') return;
  shell.openExternal(target.href).catch(() => {});
});

// Move a downloaded track to the trash, with its metadata and cover files
ipcMain.handle('ytmd:delete-download', async (event, filePath: unknown) => {
  if (!isTrustedSender(event)) return { success: false };

  const file = await resolveLibraryFile(filePath, audioMimeTypes);
  if (!file) return { success: false };
  try {
    await shell.trashItem(file.path);
  } catch {
    return { success: false };
  }
  embeddedCoverCache.delete(comparablePath(file.path));

  const folder = path.dirname(file.path);
  const name = path.basename(file.path);
  const base = audioBaseName(name);
  // "<base>.jpg" also belongs to another track with the same base name
  const remaining = await fs.promises.readdir(folder).catch(() => []);
  const sharesBaseName = remaining.some(
    (other) =>
      Object.hasOwn(audioMimeTypes, path.extname(other).toLowerCase()) &&
      audioBaseName(other) === base,
  );
  const companions = [`${name}.meta.json`, `${name}.jpg`, `${name}.png`];
  if (!sharesBaseName) companions.push(`${base}.jpg`, `${base}.png`);
  for (const companion of companions) {
    const companionPath = path.join(folder, companion);
    if (await isFile(companionPath)) {
      await shell.trashItem(companionPath).catch(() => {});
    }
  }
  return { success: true };
});

const writesDownloadFolder = (id: string, value: unknown) => {
  if (id !== 'downloader' || typeof value !== 'object' || value === null) {
    return false;
  }
  const { downloadOnFinish } = value as { downloadOnFinish?: unknown };
  return (
    'downloadFolder' in value ||
    (typeof downloadOnFinish === 'object' &&
      downloadOnFinish !== null &&
      'folder' in downloadOnFinish)
  );
};

let hooksInstalled = false;

const initHook = async (_win: BrowserWindow) => {
  // These registrations are process-global (IPC handlers + a single config
  // watcher), so they must run only once. createMainWindow() is called again on
  // macOS `activate`; re-running this previously threw ("second handler for
  // 'ytmd:set-config'") and leaked a config.watch listener every time.
  if (hooksInstalled) return;
  hooksInstalled = true;

  const allPluginStubs = await allPlugins();

  ipcMain.handle('ytmd:get-config', (_, id: string) => {
    const stored = config.get(`plugins.${id}`);
    const def = allPluginStubs[id]?.config ?? { enabled: false };
    const merged = mergePluginConfig(def, stored ?? {}) as PluginConfig;
    return merged;
  });
  ipcMain.handle('ytmd:set-config', (event, name: string, obj: object) => {
    // Plugin settings decide what gets enabled and where downloads are written
    if (!isTrustedSender(event)) return;
    if (!Object.hasOwn(allPluginStubs, name)) return;
    // The download folders are what ytmd-local serves from. The menu sets them
    // through the native folder picker, in this process, never over IPC.
    if (writesDownloadFolder(name, obj)) {
      throw new Error('The download folders are not writable from the page');
    }
    config.setPartial(`plugins.${name}`, obj, allPluginStubs[name].config);
  });

  ipcMain.handle('ytmd:get-all-plugin-meta', () =>
    Object.entries(allPluginStubs).map(([id, stub]) => ({
      id,
      name: stub.name?.() ?? id,
      description: stub.description?.() ?? '',
      restartNeeded: stub.restartNeeded ?? false,
      defaultConfig: stub.config ?? { enabled: false },
    })),
  );

  config.watch((newValue, oldValue) => {
    const newPluginConfigList = (newValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;
    const oldPluginConfigList = (oldValue?.plugins ?? {}) as Record<
      string,
      unknown
    >;

    // Fast-path: skip deep comparison if plugins object reference is the same
    if (newPluginConfigList === oldPluginConfigList) return;

    Object.entries(newPluginConfigList).forEach(([id, newPluginConfig]) => {
      // Stored config can still hold plugins that no longer exist in this build.
      if (!allPluginStubs[id]) return;

      const isEqual = deepEqual(oldPluginConfigList[id], newPluginConfig);

      if (!isEqual) {
        // Merge defaults on both sides: a partial write (e.g. { hideVideo })
        // stores no `enabled` key, and comparing that raw `undefined` with the
        // merged default used to look like an enable event, which reloaded the
        // plugin and popped the "restart required" dialog on every track change.
        const defaults = allPluginStubs[id].config ?? { enabled: false };
        const oldConfig = mergePluginConfig(
          defaults,
          oldPluginConfigList[id] ?? {},
        ) as PluginConfig;
        const config = mergePluginConfig(
          defaults,
          newPluginConfig ?? {},
        ) as PluginConfig;

        // Always target the current live window (it may have been recreated).
        const targetWindow = mainWindow;

        if (config.enabled !== oldConfig.enabled) {
          if (config.enabled) {
            targetWindow?.webContents.send('plugin:enable', id);
            ipcMain.emit('plugin:enable', id);
            if (targetWindow) forceLoadMainPlugin(id, targetWindow);
          } else {
            targetWindow?.webContents.send('plugin:unload', id);
            ipcMain.emit('plugin:unload', id);
            if (targetWindow) forceUnloadMainPlugin(id, targetWindow);
          }

          if (allPluginStubs[id]?.restartNeeded) {
            showNeedToRestartDialog(id);
          }
        }

        const mainPlugin = getAllLoadedMainPlugins()[id];
        if (mainPlugin) {
          if (config.enabled && typeof mainPlugin.backend !== 'function') {
            mainPlugin.backend?.onConfigChange?.call(
              mainPlugin.backend,
              config,
            );
          }
        }

        targetWindow?.webContents.send('config-changed', id, config);
      }
    });
  });
};

const showNeedToRestartDialog = async (id: string) => {
  const plugin = (await allPlugins())[id];

  const dialogOptions: Electron.MessageBoxOptions = {
    type: 'info',
    buttons: [
      t('main.dialog.need-to-restart.buttons.restart-now'),
      t('main.dialog.need-to-restart.buttons.later'),
    ],
    title: t('main.dialog.need-to-restart.title'),
    message: t('main.dialog.need-to-restart.message', {
      pluginName: plugin?.name?.() ?? id,
    }),
    detail: t('main.dialog.need-to-restart.detail', {
      pluginName: plugin?.name?.() ?? id,
    }),
    defaultId: 0,
    cancelId: 1,
  };

  let dialogPromise: Promise<Electron.MessageBoxReturnValue>;
  if (mainWindow) {
    dialogPromise = dialog.showMessageBox(mainWindow, dialogOptions);
  } else {
    dialogPromise = dialog.showMessageBox(dialogOptions);
  }

  dialogPromise
    .then((dialogOutput) => {
      switch (dialogOutput.response) {
        case 0: {
          restart();
          break;
        }

        // Ignore
        default: {
          break;
        }
      }
    })
    .catch((err) => console.error(LoggerPrefix, 'Restart dialog error:', err));
};

function initTheme(win: BrowserWindow) {
  injectCSS(win.webContents, youtubeMusicCSS);
  // Load user CSS
  const themes: string[] = config.get('options.themes');
  if (Array.isArray(themes)) {
    for (const cssFile of themes) {
      fileExists(
        cssFile,
        () => {
          injectCSSAsFile(win.webContents, cssFile);
        },
        () => {
          console.warn(
            LoggerPrefix,
            t('main.console.theme.css-file-not-found', { cssFile }),
          );
        },
      );
    }
  }

  win.webContents.once('did-finish-load', () => {
    if (is.dev()) {
      console.debug(LoggerPrefix, t('main.console.did-finish-load.dev-tools'));
    }
  });
}

async function createMainWindow() {
  const windowSize = config.get('window-size');
  const windowMaximized = config.get('window-maximized');
  const windowPosition: Electron.Point = config.get('window-position');
  const useInlineMenu = await config.plugins.isEnabled('in-app-menu');

  const defaultTitleBarOverlayOptions: Electron.TitleBarOverlay = {
    color: '#00000000',
    symbolColor: '#ffffff',
    height: 32,
  };

  const decorations: Partial<BrowserWindowConstructorOptions> = {
    frame: !is.macOS() && !useInlineMenu,
    titleBarOverlay: defaultTitleBarOverlayOptions,
    titleBarStyle: useInlineMenu
      ? 'hidden'
      : is.macOS()
        ? 'hiddenInset'
        : 'default',
    autoHideMenuBar: config.get('options.hideMenu'),
  };

  // Note: on linux, for some weird reason, having these extra properties with 'frame: false' does not work
  if (is.linux() && useInlineMenu) {
    delete decorations.titleBarOverlay;
    delete decorations.titleBarStyle;
  }

  const electronWindowSettings: Electron.BrowserWindowConstructorOptions = {
    icon,
    width: windowSize.width,
    height: windowSize.height,
    minWidth: 325,
    minHeight: 425,
    backgroundColor: '#000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      ...(isTesting()
        ? undefined
        : {
            // Sandbox is only enabled in tests for now
            // See https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts
            sandbox: false,
          }),
    },
    ...decorations,
  };

  const win = new BrowserWindow(electronWindowSettings);

  await initHook(win);
  initTheme(win);

  await loadAllMainPlugins(win);

  if (windowPosition) {
    const { x: windowX, y: windowY } = windowPosition;
    const winSize = win.getSize();
    const display = screen.getDisplayNearestPoint(windowPosition);
    const primaryDisplay = screen.getPrimaryDisplay();

    const scaleFactor = is.windows()
      ? primaryDisplay.scaleFactor / display.scaleFactor
      : 1;
    const scaledWidth = Math.floor(windowSize.width * scaleFactor);
    const scaledHeight = Math.floor(windowSize.height * scaleFactor);

    const scaledX = windowX;
    const scaledY = windowY;

    // Use the display workArea (excludes taskbar/dock) and a coherent margin
    // on every edge so the visibility check is symmetric. We require at least
    // half of the window (in each axis) to overlap the usable area.
    const area = display.workArea;
    const margin = 8;

    if (
      scaledX + scaledWidth / 2 < area.x - margin || // Left
      scaledX + scaledWidth / 2 > area.x + area.width + margin || // Right
      scaledY + scaledHeight / 2 < area.y - margin || // Top
      scaledY + scaledHeight / 2 > area.y + area.height + margin // Bottom
    ) {
      // Window is offscreen
      if (is.dev()) {
        console.warn(
          LoggerPrefix,
          t('main.console.window.tried-to-render-offscreen', {
            windowSize: String(winSize),
            displaySize: JSON.stringify(display.bounds),
            position: JSON.stringify(windowPosition),
          }),
        );
      }
    } else {
      win.setSize(scaledWidth, scaledHeight);
      win.setPosition(scaledX, scaledY);
    }
  }

  if (windowMaximized) {
    win.maximize();
  }

  if (config.get('options.alwaysOnTop')) {
    win.setAlwaysOnTop(true);
  }

  // The saved url resumes the last track at its position (`t`, see the
  // song-info provider). It comes from the page, so only a YouTube Music page
  // is loaded from it.
  const savedUrl = URL.parse(config.get('url'));
  const urlToLoad =
    config.get('options.resumeOnStart') &&
    savedUrl?.protocol === 'https:' &&
    savedUrl.hostname === 'music.youtube.com'
      ? savedUrl.toString()
      : config.defaultConfig.url;
  win.on('closed', onClosed);

  // Detached picture-in-picture moves and resizes this window, and the plugin
  // keeps that geometry in its own pip-position and pip-size. Checked when the
  // save runs, since the plugin writes isInPiP asynchronously. A loaded plugin
  // resets a stale isInPiP at start, so a disabled one cannot block the saves.
  const saveWindowGeometry = (key: string, value: unknown) => {
    const inDetachedPiP =
      Boolean(getAllLoadedMainPlugins()['picture-in-picture']) &&
      config.plugins.getOptions<{ isInPiP?: boolean }>('picture-in-picture')
        ?.isInPiP === true;
    if (!inDetachedPiP) config.set(key, value);
  };

  win.on('move', () => {
    if (win.isMaximized() || win.isFullScreen()) {
      return;
    }

    const [x, y] = win.getPosition();
    lateSaveDeferred('window-position', { x, y }, saveWindowGeometry);
  });

  let winWasMaximized: boolean;

  win.on('resize', () => {
    const [width, height] = win.getSize();
    const isMaximized = win.isMaximized();

    if (winWasMaximized !== isMaximized) {
      winWasMaximized = isMaximized;
      config.set('window-maximized', isMaximized);
    }

    if (isMaximized || win.isFullScreen()) {
      return;
    }

    lateSaveDeferred('window-size', { width, height }, saveWindowGeometry);
  });

  const savedTimeouts: Record<string, NodeJS.Timeout | undefined> = {};

  function lateSave(
    key: string,
    value: unknown,
    fn: (key: string, value: unknown) => void = config.set,
  ) {
    if (savedTimeouts[key]) {
      clearTimeout(savedTimeouts[key]);
    }

    savedTimeouts[key] = setTimeout(() => {
      fn(key, value);
      savedTimeouts[key] = undefined;
    }, 600);
  }

  const pendingSaves: Record<
    string,
    { value: unknown; fn: (key: string, value: unknown) => void }
  > = {};

  function lateSaveDeferred(
    key: string,
    value: unknown,
    fn: (key: string, value: unknown) => void = config.set,
  ) {
    pendingSaves[key] = { value, fn };
    lateSave(key, value, (k, v) => {
      delete pendingSaves[k];
      fn(k, v);
    });
  }

  // Flush any debounced saves immediately so we don't lose the latest
  // window-position/window-size when the app is closing.
  function flushSavedTimeouts() {
    for (const key of Object.keys(savedTimeouts)) {
      const timeout = savedTimeouts[key];
      if (timeout) {
        clearTimeout(timeout);
        savedTimeouts[key] = undefined;
      }
    }

    for (const key of Object.keys(pendingSaves)) {
      const pending = pendingSaves[key];
      if (pending) {
        pending.fn(key, pending.value);
        delete pendingSaves[key];
      }
    }
  }

  app.on('before-quit', flushSavedTimeouts);
  win.on('close', flushSavedTimeouts);

  app.on('render-process-gone', (_event, _webContents, details) => {
    showUnresponsiveDialog(win, details);
  });

  win.once('ready-to-show', () => {
    if (config.get('options.appVisible')) {
      win.show();
    }
  });

  removeContentSecurityPolicy();

  // Pipe renderer console messages to main process stdout for debugging
  win.webContents.on('console-message', (event) => {
    const { level, message } = event;
    console.log(`[RENDERER:${level}] ${message}`);
  });

  win.webContents.on('dom-ready', () => {
    if (useInlineMenu && is.windows()) {
      win.setTitleBarOverlay({
        ...defaultTitleBarOverlayOptions,
        height: Math.floor(
          defaultTitleBarOverlayOptions.height! *
            win.webContents.getZoomFactor(),
        ),
      });
    }
  });
  // Hostnames that are allowed to be navigated to within the app window.
  // Anything else (external links, ads, third-party redirects) is opened in
  // the user's default browser instead. This is intentionally permissive so
  // we never block legitimate YouTube Music / Google sign-in flows.
  const isInternalNavigation = (rawUrl: string): boolean => {
    let host: string;
    try {
      const parsed = new URL(rawUrl);
      // Allow non-http(s) schemes (e.g. blob:, data:, devtools:) to pass
      // through untouched.
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return true;
      }
      host = parsed.hostname;
    } catch {
      return true;
    }

    return (
      host === 'music.youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube.com' ||
      host.endsWith('.google.com') ||
      host === 'google.com' ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.gstatic.com') ||
      host.endsWith('.ggpht.com') ||
      host === 'accounts.google.com'
    );
  };

  // window.open / target=_blank: allow internal (YouTube/Google, including the
  // OAuth sign-in popup) windows to open normally, send external destinations to
  // the default browser, and deny anything else.
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (isInternalNavigation(openUrl)) {
      return { action: 'allow' };
    }
    if (/^https?:\/\//.test(openUrl)) {
      shell.openExternal(openUrl).catch(() => {});
    }
    return { action: 'deny' };
  });

  // Keep top-level navigations inside trusted domains; send external ones to
  // the default browser instead of navigating away from the app.
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isInternalNavigation(navigationUrl)) {
      event.preventDefault();
      if (/^https?:\/\//.test(navigationUrl)) {
        shell.openExternal(navigationUrl).catch(() => {});
      }
    }
  });

  win.webContents.on('will-redirect', (event) => {
    const url = URL.parse(event.url);

    // Workarounds for regions where YTM is restricted
    if (
      url &&
      url.hostname.endsWith('youtube.com') &&
      url.pathname === '/premium'
    ) {
      event.preventDefault();

      win.webContents.loadURL(
        'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F',
      );
    }
  });

  win.webContents.loadURL(urlToLoad);

  return win;
}

app.once('browser-window-created', (_event, win) => {
  if (config.get('options.overrideUserAgent')) {
    // User agents are from https://developers.whatismybrowser.com/useragents/explore/
    const originalUserAgent = win.webContents.userAgent;
    const userAgents = {
      mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
      windows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
      linux:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.152 Safari/537.36',
    };

    const updatedUserAgent = is.macOS()
      ? userAgents.mac
      : is.windows()
        ? userAgents.windows
        : userAgents.linux;

    win.webContents.userAgent = updatedUserAgent;
    app.userAgentFallback = updatedUserAgent;

    win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
      // This will only happen if login failed, and "retry" was pressed
      if (
        win.webContents.getURL().startsWith('https://accounts.google.com') &&
        details.url.startsWith('https://accounts.google.com')
      ) {
        details.requestHeaders['User-Agent'] = originalUserAgent;
      }

      cb({ requestHeaders: details.requestHeaders });
    });
  }

  setupSongInfo(win);
  setupAppControls();

  win.webContents.on(
    'did-fail-load',
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    ) => {
      const log = JSON.stringify(
        {
          error: 'did-fail-load',
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame,
          frameProcessId,
          frameRoutingId,
        },
        null,
        '\t',
      );
      if (is.dev()) {
        console.log(log);
      }

      if (
        errorCode !== -3 &&
        // Workaround for #2435
        !URL.parse(validatedURL)?.hostname?.includes('doubleclick.net')
      ) {
        // -3 is a false positive
        win.webContents.send('log', log);
        win.webContents.loadFile(ErrorHtmlAsset);
      }
    },
  );

  win.webContents.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  const customWindowTitle = config.get('options.customWindowTitle');

  if (customWindowTitle) {
    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle(customWindowTitle);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }

  // Unregister all shortcuts.
  globalShortcut.unregisterAll();
});

app.on('activate', async () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    mainWindow = await createMainWindow();
  } else if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
});

const getDefaultLocale = async (locale: string) =>
  Object.keys(await languageResources()).includes(locale) ? locale : null;

app.whenReady().then(async () => {
  // About panel — Revamp credits
  app.setAboutPanelOptions({
    applicationName: 'YouTube Music — Revamp by @IsSlashy',
    applicationVersion: '4.0.2',
    copyright: [
      'Revamp by @IsSlashy',
      'X: https://x.com/Slashy_fx',
      'Dernière mise à jour: 21/06/2026',
      '',
      'Credits: Pear Desktop',
      'https://github.com/pear-devs/pear-desktop',
    ].join('\n'),
    version: 'Revamp Edition',
  });

  // Serve library files to the page: audio and cover files by path, and the
  // picture embedded in a track's tags. Anything else is refused.
  protocol.handle('ytmd-local', async (request) => {
    const requestUrl = URL.parse(request.url);
    const requestedPath = requestUrl?.searchParams.get('path');
    const baseHeaders = { 'X-Content-Type-Options': 'nosniff' };

    if (requestUrl?.hostname === 'cover') {
      const file = await resolveLibraryFile(requestedPath, audioMimeTypes);
      const cover =
        file && (await readEmbeddedCover(file.path).catch(() => null));
      if (!cover) {
        return new Response('Not Found', { status: 404, headers: baseHeaders });
      }
      return new Response(cover.data, {
        headers: {
          ...baseHeaders,
          'Content-Type': cover.mime,
          'Content-Length': String(cover.data.length),
        },
      });
    }

    const file =
      requestUrl?.hostname === 'file'
        ? await resolveLibraryFile(requestedPath, localMimeTypes)
        : null;
    if (!file) {
      return new Response('Forbidden', { status: 403, headers: baseHeaders });
    }

    const fileSize = file.stat.size;
    const headers: Record<string, string> = {
      ...baseHeaders,
      'Content-Type': localMimeTypes[path.extname(file.path).toLowerCase()],
      'Accept-Ranges': 'bytes',
    };
    const range = parseByteRange(request.headers.get('range'), fileSize);
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${fileSize}` },
      });
    }
    if (range) {
      headers['Content-Range'] =
        `bytes ${range.start}-${range.end}/${fileSize}`;
    }

    // Stream from the real path, so only the requested bytes are ever read
    const { start, end } = range ?? { start: 0, end: fileSize - 1 };
    headers['Content-Length'] = String(fileSize === 0 ? 0 : end - start + 1);
    const body =
      fileSize === 0
        ? null
        : (Readable.toWeb(
            fs.createReadStream(file.path, { start, end }),
          ) as ReadableStream<Uint8Array>);
    return new Response(body, { status: range ? 206 : 200, headers });
  });

  // Only the English and French Chromium locales ship, so Chromium falls back
  // to one of them on other systems. Send the system languages instead, so
  // that YouTube Music keeps the user's language.
  const systemLanguages = app.getPreferredSystemLanguages();
  if (systemLanguages.length > 0) {
    session.defaultSession.setUserAgent(
      session.defaultSession.getUserAgent(),
      systemLanguages.join(','),
    );
  }

  if (!config.get('options.language')) {
    const locale = await getDefaultLocale(app.getLocale());
    if (locale) {
      config.set('options.language', locale);
    }
  }

  // Start i18n loading in background — don't block window creation
  const i18nReady = loadI18n().then(async () => {
    await setLanguage(config.get('options.language') ?? 'en');
    console.log(LoggerPrefix, t('main.console.i18n.loaded'));
  });

  if (config.get('options.autoResetAppCache')) {
    // Clear cache after 20s
    const clearCacheTimeout = setTimeout(() => {
      if (is.dev()) {
        console.log(
          LoggerPrefix,
          t('main.console.when-ready.clearing-cache-after-20s'),
        );
      }

      session.defaultSession.clearCache();
      clearTimeout(clearCacheTimeout);
    }, 20_000);
  }

  // Register appID on windows
  if (is.windows()) {
    const appID = 'com.github.th-ch.youtube-music';
    app.setAppUserModelId(appID);
    const appLocation = process.execPath;
    const appData = app.getPath('appData');
    // Check shortcut validity if not in dev mode / running portable app
    if (
      !is.dev() &&
      !appLocation.startsWith(path.join(appData, '..', 'Local', 'Temp'))
    ) {
      const shortcutPath = path.join(
        appData,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'YouTube Music.lnk',
      );
      try {
        // Check if shortcut is registered and valid
        const shortcutDetails = shell.readShortcutLink(shortcutPath); // Throw error if it doesn't exist yet
        if (
          shortcutDetails.target !== appLocation ||
          shortcutDetails.appUserModelId !== appID
        ) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'needUpdate';
        }
      } catch (error) {
        // If not valid -> Register shortcut
        shell.writeShortcutLink(
          shortcutPath,
          error === 'needUpdate' ? 'update' : 'create',
          {
            target: appLocation,
            cwd: path.dirname(appLocation),
            description: 'YouTube Music Desktop App - including custom plugins',
            appUserModelId: appID,
          },
        );
      }
    }
  }

  ipcMain.handle('get-renderer-script', async () => {
    // Inject index.html file as string using insertAdjacentHTML
    // In dev mode, get string from process.env.VITE_DEV_SERVER_URL, else use fs.promises.readFile
    if (is.dev() && process.env.ELECTRON_RENDERER_URL) {
      // HACK: to make vite work with electron renderer (supports hot reload)
      return [
        null,
        `
        console.log('${LoggerPrefix}', 'Loading vite from dev server');
        (async () => {
          await new Promise((resolve) => {
            if (document.readyState === 'loading') {
              console.log('${LoggerPrefix}', 'Waiting for DOM to load');
              document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
            } else {
              resolve();
            }
          });
          const viteScript = document.createElement('script');
          viteScript.type = 'module';
          viteScript.src = '${process.env.ELECTRON_RENDERER_URL}/@vite/client';
          const rendererScript = document.createElement('script');
          rendererScript.type = 'module';
          rendererScript.src = '${process.env.ELECTRON_RENDERER_URL}/renderer.ts';
          document.body.appendChild(viteScript);
          document.body.appendChild(rendererScript);
        })();
        0
      `,
      ];
    } else {
      const rendererPath = path.join(__dirname, '..', 'renderer');
      const { parse } = await import('node-html-parser');
      const indexHTML = parse(
        await fs.promises.readFile(
          path.join(rendererPath, 'index.html'),
          'utf-8',
        ),
      );
      const scriptSrc = indexHTML.querySelector('script')!;
      const scriptPath = path.join(
        rendererPath,
        scriptSrc.getAttribute('src')!,
      );
      const scriptString = await fs.promises.readFile(scriptPath, 'utf-8');
      return [url.pathToFileURL(scriptPath).toString(), scriptString + ';0'];
    }
  });

  mainWindow = await createMainWindow();
  // Ensure i18n is ready before building menus
  await i18nReady;
  await setApplicationMenu(mainWindow);
  await refreshMenu(mainWindow);
  setUpTray(app, mainWindow);

  setupProtocolHandler(mainWindow);

  app.on('second-instance', (_, commandLine) => {
    const uri = `${APP_PROTOCOL}://`;
    const protocolArgv = commandLine.find((arg) => arg.startsWith(uri));
    if (protocolArgv) {
      const lastIndex = protocolArgv.endsWith('/') ? -1 : undefined;
      const command = protocolArgv.slice(uri.length, lastIndex);
      if (is.dev()) {
        console.debug(
          LoggerPrefix,
          t('main.console.second-instance.receive-command', { command }),
        );
      }

      const splited = decodeURIComponent(command).split(' ');

      handleProtocol(splited.shift()!, ...splited);
      return;
    }

    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();
  });

  // Autostart at login
  app.setLoginItemSettings({
    openAtLogin: config.get('options.startAtLogin'),
  });

  if (!is.dev() && config.get('options.autoUpdates')) {
    // Automatic updates: download the new version in the background, then offer
    // to restart & install it directly in-app — no need to visit GitHub.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    const updateTimeout = setTimeout(() => {
      autoUpdater
        .checkForUpdates()
        .catch((err) =>
          console.error(LoggerPrefix, 'Update check failed:', err),
        );
      clearTimeout(updateTimeout);
    }, 2000);

    let updatePrompted = false;
    autoUpdater.on('update-downloaded', (info) => {
      if (updatePrompted) return;
      updatePrompted = true;

      const dialogOptions: Electron.MessageBoxOptions = {
        type: 'info',
        buttons: [
          t('main.dialog.update-available.buttons.ok'), // Later
          t('main.dialog.update-available.buttons.download'), // Restart now
          t('main.dialog.update-available.buttons.disable'), // Disable updates
        ],
        title: t('main.dialog.update-available.title'),
        message: t('main.dialog.update-available.message'),
        detail: t('main.dialog.update-available.detail', {
          downloadLink: info?.version ? `v${info.version}` : '',
        }),
        defaultId: 1,
        cancelId: 0,
      };

      const dialogPromise = mainWindow
        ? dialog.showMessageBox(mainWindow, dialogOptions)
        : dialog.showMessageBox(dialogOptions);

      dialogPromise
        .then((dialogOutput) => {
          switch (dialogOutput.response) {
            // Restart & install now
            case 1: {
              setImmediate(() => autoUpdater.quitAndInstall());
              break;
            }

            // Disable updates
            case 2: {
              config.set('options.autoUpdates', false);
              break;
            }

            // Later — the update installs automatically on next quit
            case 0:
            default:
              break;
          }
        })
        .catch((err) =>
          console.error(LoggerPrefix, 'Update dialog error:', err),
        );
    });

    autoUpdater.on('error', (err) =>
      console.error(LoggerPrefix, 'Auto-update error:', err),
    );
  }

  if (config.get('options.hideMenu') && !config.get('options.hideMenuWarned')) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: t('main.dialog.hide-menu-enabled.title'),
      message: t('main.dialog.hide-menu-enabled.message'),
    });
    config.set('options.hideMenuWarned', true);
  }

  // Optimized for Mac OS X
  if (is.macOS() && !config.get('options.appVisible')) {
    app.dock?.hide();
  }

  let forceQuit = false;
  app.on('before-quit', () => {
    forceQuit = true;
    // Stop playback before quitting so audio doesn't linger
    mainWindow?.webContents.send('ytmd:pause');
  });

  if (is.macOS() || config.get('options.tray')) {
    mainWindow.on('close', (event) => {
      // Hide the window instead of quitting (quit is available in tray options)
      if (!forceQuit) {
        event.preventDefault();
        // Playback goes on while the window sits in the tray
        mainWindow!.hide();
      }
    });
  }
});

function showUnresponsiveDialog(
  win: BrowserWindow,
  details: Electron.RenderProcessGoneDetails,
) {
  if (details) {
    console.error(
      LoggerPrefix,
      t('main.console.unresponsive.details', {
        error: JSON.stringify(details, null, '\t'),
      }),
    );
  }

  dialog
    .showMessageBox(win, {
      type: 'error',
      title: t('main.dialog.unresponsive.title'),
      message: t('main.dialog.unresponsive.message'),
      detail: t('main.dialog.unresponsive.detail'),
      buttons: [
        t('main.dialog.unresponsive.buttons.wait'),
        t('main.dialog.unresponsive.buttons.relaunch'),
        t('main.dialog.unresponsive.buttons.quit'),
      ],
      cancelId: 0,
    })
    .then((result) => {
      switch (result.response) {
        case 1: {
          restart();
          break;
        }

        case 2: {
          app.quit();
          break;
        }
      }
    });
}

function removeContentSecurityPolicy(
  betterSession: BetterSession = session.defaultSession as BetterSession,
) {
  // Allows defining multiple "onHeadersReceived" listeners
  // by enhancing the session.
  // Some plugins (e.g. adblocker) also define a "onHeadersReceived" listener
  enhanceWebRequest(betterSession);

  // Custom listener to tweak the content security policy
  betterSession.webRequest.onHeadersReceived((details, callback) => {
    details.responseHeaders ??= {};

    // prettier-ignore
    if (URL.parse(details.url)?.protocol === 'https:') {
      // Remove the content security policy
      delete details.responseHeaders['content-security-policy-report-only'];
      delete details.responseHeaders['Content-Security-Policy-Report-Only'];
      delete details.responseHeaders['content-security-policy'];
      delete details.responseHeaders['Content-Security-Policy'];

      if (
        !details.responseHeaders['access-control-allow-origin'] &&
        !details.responseHeaders['Access-Control-Allow-Origin']
      ) {
        details.responseHeaders['access-control-allow-origin'] = ['https://music.youtube.com'];
      }
    }

    callback({ cancel: false, responseHeaders: details.responseHeaders });
  });

  // When multiple listeners are defined, apply them all
  betterSession.webRequest.setResolver(
    'onHeadersReceived',
    async (listeners) => {
      return listeners.reduce(
        async (accumulator, listener) => {
          const acc = await accumulator;
          if (acc.cancel) {
            return acc;
          }

          const result = await listener.apply();
          return { ...acc, ...result };
        },
        Promise.resolve({ cancel: false }),
      );
    },
  );
}
