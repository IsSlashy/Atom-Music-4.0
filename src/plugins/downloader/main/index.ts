import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';

import {
  app,
  type BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
} from 'electron';
import {
  Innertube,
  UniversalCache,
  Utils,
  YTNodes,
  Platform,
} from 'youtubei.js';
import is from 'electron-is';
import filenamify from 'filenamify';
import { Mutex } from 'async-mutex';
import * as NodeID3 from 'node-id3';
import { BG, type BgConfig } from 'bgutils-js';

import {
  cropMaxWidth,
  getFolder,
  sendFeedback as sendFeedback_,
  setBadge,
} from './utils';
import {
  registerCallback,
  cleanupName,
  MediaType,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { getNetFetchAsFetch } from '@/plugins/utils/main';
import { t } from '@/i18n';

import { DefaultPresetList, type Preset, YoutubeFormatList } from '../types';

import type { DownloaderPluginConfig } from '../index';
import type { FFmpeg } from '@ffmpeg.wasm/main';
import type { BackendContext } from '@/types/contexts';
import type { GetPlayerResponse } from '@/types/get-player-response';
import type { FormatOptions } from 'node_modules/youtubei.js/dist/src/types';
import type { VideoInfo } from 'node_modules/youtubei.js/dist/src/parser/youtube';
import type { PlayerErrorMessage } from 'node_modules/youtubei.js/dist/src/parser/nodes';
import type {
  TrackInfo,
  Playlist,
} from 'node_modules/youtubei.js/dist/src/parser/ytmusic';

type CustomSongInfo = SongInfo & { trackId?: string };

// The wasm heap only grows, so an instance left idle this long is unloaded
const FFMPEG_IDLE_UNLOAD_MS = 60_000;
// Progress goes to the renderer over IPC: about 4 messages per second is enough
const FEEDBACK_INTERVAL_MS = 250;

class FFmpegTimeoutError extends Error {}

let ffmpegInstance: FFmpeg | null = null;
let ffmpegIdleTimer: ReturnType<typeof setTimeout> | undefined;
const ffmpegMutex = new Mutex();

const getFFmpeg = async () => {
  clearTimeout(ffmpegIdleTimer);
  if (!ffmpegInstance) {
    const { createFFmpeg } = await import('@ffmpeg.wasm/main');
    const instance = createFFmpeg({
      log: false,
      logger() {}, // Console.log,
      progress() {}, // Console.log,
    });
    await instance.load();
    ffmpegInstance = instance;
  }
  return ffmpegInstance;
};

// A command that timed out may be stuck inside the wasm, where exit() could
// block the main process, so that instance is only dropped
const disposeFFmpeg = (exit: boolean) => {
  clearTimeout(ffmpegIdleTimer);
  const instance = ffmpegInstance;
  ffmpegInstance = null;
  if (exit) {
    try {
      instance?.exit();
    } catch {
      // Already exited
    }
  }
};

const scheduleFFmpegUnload = () => {
  clearTimeout(ffmpegIdleTimer);
  ffmpegIdleTimer = setTimeout(
    () => disposeFFmpeg(true),
    FFMPEG_IDLE_UNLOAD_MS,
  );
};

const runFFmpeg = async (
  instance: FFmpeg,
  timeoutMs: number,
  args: string[],
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      instance.run(...args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new FFmpegTimeoutError(
                `ffmpeg did not finish within ${Math.round(timeoutMs / 1000)} s`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

// Returns true at most once per FEEDBACK_INTERVAL_MS
const createFeedbackThrottle = () => {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < FEEDBACK_INTERVAL_MS) return false;
    last = now;
    return true;
  };
};

let yt: Innertube;
let win: BrowserWindow;
let playingUrl: string;

const isYouTubeMusicPremium = async () => {
  // If signed out, it is understood as non-premium
  const isSignedIn = (await win.webContents.executeJavaScript(
    '!!yt.config_.LOGGED_IN',
  )) as boolean;

  if (!isSignedIn) return false;

  // Check for premium in a single self-contained call to avoid template injection
  return (await win.webContents.executeJavaScript(`
    (() => {
      const iconPath = document.querySelector('iron-iconset-svg[name="yt-sys-icons"] #youtube_music_monochrome')?.firstChild?.getAttribute("d")?.substring(0, 15);
      if (!iconPath) return false;
      const selector = 'ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="' + CSS.escape(iconPath) + '"])';
      return !document.querySelector(selector);
    })()
  `)) as boolean;
};

const sendError = (error: Error, source?: string) => {
  win.setProgressBar(-1); // Close progress bar
  setBadge(0); // Close badge
  sendFeedback_(win); // Reset feedback

  const songNameMessage = source ? `\nin ${source}` : '';
  const cause = error.cause
    ? `\n\n${
        // eslint-disable-next-line @typescript-eslint/no-base-to-string,@typescript-eslint/restrict-template-expressions
        error.cause instanceof Error ? error.cause.toString() : error.cause
      }`
    : '';
  const message = `${error.toString()}${songNameMessage}${cause}`;

  console.error(message);
  console.trace(error);
  dialog.showMessageBox(win, {
    type: 'info',
    buttons: [t('plugins.downloader.backend.dialog.error.buttons.ok')],
    title: t('plugins.downloader.backend.dialog.error.title'),
    message: t('plugins.downloader.backend.dialog.error.message'),
    detail: message,
  });
};

let decipherChecked = false;

// Deciphering breaks whenever YouTube ships a player the extractor cannot read.
// Try it once on a dummy stream URL, so a broken player gives one clear error
// before anything is downloaded, instead of one error per track.
const checkDecipher = async () => {
  if (decipherChecked) return;

  try {
    const player = yt.session.player;
    if (!player) throw new Error('No player script');

    const n = 'kXpRs3QeVbTz8LwN';
    const streamUrl = `https://rr1---sn-check.googlevideo.com/videoplayback?expire=1&n=${n}`;
    const signatureCipher = new URLSearchParams({
      s: 'AOq0QJ8wRQIhAKmB3vYq7XcUuNdLr5sW2pEoGhTzF1aJ9kVbCyMe4fD6AiBxQ',
      sp: 'sig',
      url: streamUrl,
    }).toString();

    const deciphered = new URL(
      await player.decipher(undefined, signatureCipher),
    ).searchParams;
    const nResult = deciphered.get('n');
    if (
      !deciphered.get('sig') ||
      !nResult ||
      nResult === n ||
      nResult.startsWith('enhanced_except_')
    ) {
      throw new Error(`Player ${player.player_id} returned n=${nResult}`);
    }
  } catch (error: unknown) {
    throw new Error(
      t('plugins.downloader.backend.feedback.decipher-failed', {
        defaultValue:
          'Downloads cannot decipher the current YouTube player. The downloader needs an update.',
      }),
      { cause: error },
    );
  }

  decipherChecked = true;
};

export const getCookieFromWindow = async (win: BrowserWindow) => {
  return (
    await win.webContents.session.cookies.get({
      url: 'https://music.youtube.com',
    })
  )
    .map((it) => it.name + '=' + it.value)
    .join(';');
};

// youtubei.js sends stream requests with an Origin header, which makes net.fetch
// run a CORS check that googlevideo fails (net::ERR_FAILED), so it is dropped there
const getStreamSafeFetch = (): typeof fetch => {
  const netFetch = getNetFetchAsFetch();
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (init?.headers && url.hostname.endsWith('.googlevideo.com')) {
      const headers = new Headers(init.headers);
      headers.delete('origin');
      init = { ...init, headers };
    }
    return netFetch(input, init);
  }) as typeof fetch;
};

let config: DownloaderPluginConfig;

export const onMainLoad = async ({
  window: _win,
  getConfig,
  ipc,
}: BackendContext<DownloaderPluginConfig>) => {
  win = _win;
  config = await getConfig();

  yt = await Innertube.create({
    cache: new UniversalCache(false),
    cookie: await getCookieFromWindow(win),
    generate_session_locally: true,
    fetch: getStreamSafeFetch(),
  });

  // Provide JavaScript evaluator for URL deciphering (required since youtubei.js v16).
  // The extracted player code ends with a `return`, so it runs wrapped in a function.
  // This is not an isolation: the host URL constructor gives access to the host Function.
  Platform.shim.eval = (data) =>
    vm.runInNewContext(
      '(function(){\n' + data.output + '\n})()',
      { URL, URLSearchParams },
      { timeout: 5000 },
    ) as Record<string, unknown>;

  const requestKey = 'O43z0dpjhgX20SCx4KAo';
  const visitorData = yt.session.context.client.visitorData;

  if (visitorData) {
    const cleanUp = (context: Partial<typeof globalThis>) => {
      delete context.window;
      delete context.document;
    };

    try {
      const [width, height] = win.getSize();
      // emulate jsdom using linkedom
      const window = new (await import('happy-dom')).Window({
        width,
        height,
        console,
      });
      const document = window.document;

      Object.assign(globalThis, {
        window,
        document,
      });

      const bgConfig: BgConfig = {
        fetch: getNetFetchAsFetch(),
        globalObj: globalThis,
        identifier: visitorData,
        requestKey,
      };

      const bgChallenge = await BG.Challenge.create(bgConfig);
      const interpreterJavascript =
        bgChallenge?.interpreterJavascript
          .privateDoNotAccessOrElseSafeScriptWrappedValue;

      if (interpreterJavascript) {
        // Run in sandboxed context instead of unsafe new Function()
        vm.runInNewContext(interpreterJavascript, globalThis);

        const poTokenResult = await BG.PoToken.generate({
          program: bgChallenge.program,
          globalName: bgChallenge.globalName,
          bgConfig,
        }).finally(() => {
          cleanUp(globalThis);
        });

        yt.session.po_token = poTokenResult.poToken;
      } else {
        cleanUp(globalThis);
      }
    } catch {
      cleanUp(globalThis);
    }
  }

  ipc.handle('download-song', (url: string) => downloadSong(url));
  ipc.on('ytmd:video-src-changed', (data: GetPlayerResponse) => {
    playingUrl = data.microformat.microformatDataRenderer.urlCanonical;
  });
  ipc.handle('download-playlist-request', async (url: string) =>
    downloadPlaylist(url),
  );

  downloadSongOnFinishSetup({ ipc, getConfig });
};

export const onConfigChange = (newConfig: DownloaderPluginConfig) => {
  config = newConfig;
};

export async function downloadSong(
  url: string,
  playlistFolder: string | undefined = undefined,
  trackId: string | undefined = undefined,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  let resolvedName;
  try {
    await downloadSongUnsafe(
      false,
      url,
      (name: string) => (resolvedName = name),
      playlistFolder,
      trackId,
      increasePlaylistProgress,
    );
  } catch (error: unknown) {
    sendError(error as Error, resolvedName || url);
  }
}

export async function downloadSongFromId(
  id: string,
  playlistFolder: string | undefined = undefined,
  trackId: string | undefined = undefined,
  increasePlaylistProgress: (value: number) => void = () => {},
  skipExisting = false,
) {
  let resolvedName;
  try {
    await downloadSongUnsafe(
      true,
      id,
      (name: string) => (resolvedName = name),
      playlistFolder,
      trackId,
      increasePlaylistProgress,
      skipExisting,
    );
  } catch (error: unknown) {
    sendError(error as Error, resolvedName || id);
  }
}

function downloadSongOnFinishSetup({
  ipc,
}: Pick<BackendContext<DownloaderPluginConfig>, 'ipc' | 'getConfig'>) {
  let currentUrl: string | undefined;
  let duration: number | undefined;
  let time = 0;

  const defaultDownloadFolder = app.getPath('downloads');

  registerCallback((songInfo: SongInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) {
      const elapsedSeconds = songInfo.elapsedSeconds ?? 0;
      if (elapsedSeconds > time) time = elapsedSeconds;
      return;
    }
    if (
      !songInfo.isPaused &&
      songInfo.url !== currentUrl &&
      config.downloadOnFinish?.enabled
    ) {
      if (typeof currentUrl === 'string' && duration && duration > 0) {
        if (
          config.downloadOnFinish.mode === 'seconds' &&
          duration - time <= config.downloadOnFinish.seconds
        ) {
          downloadSong(
            currentUrl,
            config.downloadOnFinish.folder ||
              config.downloadFolder ||
              defaultDownloadFolder,
          );
        } else if (
          config.downloadOnFinish.mode === 'percent' &&
          time >= duration * (config.downloadOnFinish.percent / 100)
        ) {
          downloadSong(
            currentUrl,
            config.downloadOnFinish.folder ||
              config.downloadFolder ||
              defaultDownloadFolder,
          );
        }
      }

      currentUrl = songInfo.url;
      duration = songInfo.songDuration;
      time = 0;
    }
  });

  ipcMain.on('ytmd:player-api-loaded', () => {
    ipc.send('ytmd:setup-time-changed-listener');
  });
}

async function downloadSongUnsafe(
  isId: boolean,
  idOrUrl: string,
  setName: (name: string) => void,
  playlistFolder: string | undefined = undefined,
  trackId: string | undefined = undefined,
  increasePlaylistProgress: (value: number) => void = () => {},
  skipExisting = false,
) {
  const sendFeedback = (message: unknown, progress?: number) => {
    if (!playlistFolder) {
      sendFeedback_(win, message);
      if (progress && !isNaN(progress)) {
        win.setProgressBar(progress);
      }
    }
  };

  sendFeedback(t('plugins.downloader.backend.feedback.downloading'), 2);

  let id: string | null;
  if (isId) {
    id = idOrUrl;
  } else {
    id = getVideoId(idOrUrl);
    if (typeof id !== 'string')
      throw new Error(
        t('plugins.downloader.backend.feedback.video-id-not-found'),
      );
  }

  let info: TrackInfo | VideoInfo = await yt.music.getInfo(id);

  if (!info) {
    throw new Error(
      t('plugins.downloader.backend.feedback.video-id-not-found'),
    );
  }

  const metadata = getMetadata(info);
  if (metadata.album === 'N/A') {
    metadata.album = '';
  }

  metadata.trackId = trackId;

  const dir =
    playlistFolder || config.downloadFolder || app.getPath('downloads');
  const name = `${metadata.artist ? `${metadata.artist} - ` : ''}${
    metadata.title
  }`;
  setName(name);

  let playabilityStatus = info.playability_status;
  if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
    // Try to bypass the age restriction
    const bypassedResult = await getAndroidTvInfo(id);
    playabilityStatus = bypassedResult.playability_status;

    if (playabilityStatus?.status === 'LOGIN_REQUIRED') {
      throw new Error(
        `[${playabilityStatus.status}] ${playabilityStatus.reason}`,
      );
    }

    info = bypassedResult;
  }

  if (playabilityStatus?.status === 'UNPLAYABLE') {
    const errorScreen =
      playabilityStatus.error_screen as PlayerErrorMessage | null;
    throw new Error(
      `[${playabilityStatus.status}] ${errorScreen?.reason.text}: ${errorScreen?.subreason.text}`,
    );
  }

  const selectedPreset = config.selectedPreset ?? 'mp3 (256kbps)';
  let presetSetting: Preset;
  if (selectedPreset === 'Custom') {
    presetSetting = config.customPresetSetting ?? DefaultPresetList['Custom'];
  } else if (selectedPreset === 'Source') {
    presetSetting = DefaultPresetList['Source'];
  } else {
    presetSetting = DefaultPresetList['mp3 (256kbps)'];
  }

  const downloadOptions: FormatOptions = {
    type: (await isYouTubeMusicPremium()) ? 'audio' : 'video+audio', // Audio, video or video+audio
    quality: 'best', // Best, bestefficiency, 144p, 240p, 480p, 720p and so on.
    format: 'any', // Media container format
  };

  const format = info.chooseFormat(downloadOptions);

  let targetFileExtension: string;
  if (selectedPreset === 'Source') {
    targetFileExtension = getSourceExtension(format);
  } else if (!presetSetting?.extension) {
    targetFileExtension =
      YoutubeFormatList.find((it) => it.itag === format.itag)?.container ??
      'mp3';
  } else {
    targetFileExtension = presetSetting?.extension ?? 'mp3';
  }

  let filename = filenamify(`${name}.${targetFileExtension}`, {
    replacement: '_',
    maxLength: 255,
  });
  if (!is.macOS()) {
    filename = filename.normalize('NFC');
  }
  const filePath = join(dir, filename);

  if ((config.skipExisting || skipExisting) && existsSync(filePath)) {
    sendFeedback(null, -1);
    return;
  }

  await checkDecipher();

  const stream = await info.download(downloadOptions);

  console.info(
    t('plugins.downloader.backend.feedback.download-info', {
      artist: metadata.artist,
      title: metadata.title,
      videoId: metadata.videoId,
    }),
  );

  const iterableStream = Utils.streamToIterable(stream);

  let fileBuffer: Uint8Array | null = await iterableStreamToProcessedUint8Array(
    iterableStream,
    targetFileExtension,
    metadata,
    presetSetting?.ffmpegArgs ?? [],
    format.content_length ?? 0,
    sendFeedback,
    increasePlaylistProgress,
  );

  // The cover is optional: a failed fetch must not cost the track
  const coverBuffer = await getCoverJpeg(metadata.imageSrc ?? '').catch(
    (error: unknown) => {
      console.warn('[Downloader] Could not fetch the cover:', error);
      return null;
    },
  );

  if (targetFileExtension === 'mp3') {
    fileBuffer = writeID3(
      Buffer.from(fileBuffer),
      metadata,
      coverBuffer,
      sendFeedback,
    );
  }

  if (fileBuffer) {
    // Created at the first write, so a failed download leaves no folder behind
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, fileBuffer);
    // The library shows this cover without the network, whatever the format
    if (coverBuffer) {
      try {
        writeFileSync(join(dir, `${parse(filename).name}.jpg`), coverBuffer);
      } catch {
        /* ignore cover write errors */
      }
    }
    // Save metadata JSON for the in-app player (thumbnail, duration, etc.)
    try {
      const metaPath = filePath + '.meta.json';
      writeFileSync(
        metaPath,
        JSON.stringify({
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          imageSrc: metadata.imageSrc,
          videoId: metadata.videoId,
        }),
      );
    } catch {
      /* ignore metadata write errors */
    }
  }

  sendFeedback(null, -1);
  console.info(
    t('plugins.downloader.backend.feedback.done', {
      filePath,
    }),
  );
}

async function downloadChunks(
  stream: AsyncGenerator<Uint8Array, void>,
  contentLength: number,
  sendFeedback: (str: string, value?: number) => void,
  increasePlaylistProgress: (value: number) => void = () => {},
) {
  const chunks = [];
  let downloaded = 0;
  const shouldSendFeedback = createFeedbackThrottle();
  for await (const chunk of stream) {
    downloaded += chunk.length;
    chunks.push(chunk);
    if (!shouldSendFeedback()) continue;

    if (contentLength > 0) {
      const ratio = Math.min(downloaded / contentLength, 1);
      const progress = Math.floor(ratio * 100);
      sendFeedback(
        t('plugins.downloader.backend.feedback.download-progress', {
          percent: progress,
        }),
        ratio,
      );
      // 15% for download, 85% for conversion
      // This is a very rough estimate, trying to make the progress bar look nice
      increasePlaylistProgress(ratio * 0.15);
    } else {
      // Unknown size: keep the progress bar indeterminate
      sendFeedback(t('plugins.downloader.backend.feedback.downloading'), 2);
    }
  }
  increasePlaylistProgress(0.15);
  return chunks;
}

async function iterableStreamToProcessedUint8Array(
  stream: AsyncGenerator<Uint8Array, void>,
  extension: string,
  metadata: CustomSongInfo,
  presetFfmpegArgs: string[],
  contentLength: number,
  sendFeedback: (str: string, value?: number) => void,
  increasePlaylistProgress: (value: number) => void = () => {},
): Promise<Uint8Array> {
  sendFeedback(t('plugins.downloader.backend.feedback.loading'), 2); // Indefinite progress bar after download

  const safeVideoName = randomBytes(32).toString('hex');

  return await ffmpegMutex.runExclusive(async () => {
    sendFeedback(t('plugins.downloader.backend.feedback.preparing-file'));
    const input = Buffer.concat(
      await downloadChunks(
        stream,
        contentLength,
        sendFeedback,
        increasePlaylistProgress,
      ),
    );

    const ffmpegInstance = await getFFmpeg();
    try {
      ffmpegInstance.FS('writeFile', safeVideoName, input);

      sendFeedback(t('plugins.downloader.backend.feedback.converting'));

      const shouldSendFeedback = createFeedbackThrottle();
      ffmpegInstance.setProgress((progress) => {
        // The duration line still carries the ratio of the previous command
        if ('duration' in progress) return;
        const { ratio } = progress;
        if (!Number.isFinite(ratio) || !shouldSendFeedback()) return;
        const clampedRatio = Math.min(Math.max(ratio, 0), 1);
        sendFeedback(
          t('plugins.downloader.backend.feedback.conversion-progress', {
            percent: Math.floor(clampedRatio * 100),
          }),
          clampedRatio,
        );
        increasePlaylistProgress(0.15 + clampedRatio * 0.85);
      });

      const safeVideoNameWithExtension = `${safeVideoName}.${extension}`;
      // Far above the real conversion time, which is a few seconds per minute of audio
      const timeoutMs = 60_000 + (metadata.songDuration ?? 0) * 1000;
      await runFFmpeg(ffmpegInstance, timeoutMs, [
        '-i',
        safeVideoName,
        ...presetFfmpegArgs,
        ...getFFmpegMetadataArgs(metadata),
        safeVideoNameWithExtension,
      ]);

      sendFeedback(t('plugins.downloader.backend.feedback.saving'));

      // ffmpeg ends normally on a failed conversion: the missing output is the error
      const output = ffmpegInstance.FS('readFile', safeVideoNameWithExtension);
      ffmpegInstance.FS('unlink', safeVideoName);
      ffmpegInstance.FS('unlink', safeVideoNameWithExtension);
      return output;
    } catch (error: unknown) {
      // Start the next conversion from a fresh instance
      disposeFFmpeg(!(error instanceof FFmpegTimeoutError));
      throw error;
    } finally {
      ffmpegInstance.setProgress(() => {});
      scheduleFFmpegUnload();
    }
  });
}

// Source keeps the original audio stream, so the extension follows its codec
const getSourceExtension = (format: { itag: number; mime_type: string }) => {
  const codecs = /codecs="([^"]*)"/.exec(format.mime_type)?.[1] ?? '';
  if (codecs.includes('mp4a')) return 'm4a';
  if (codecs.includes('opus')) return 'opus';
  return (
    YoutubeFormatList.find((it) => it.itag === format.itag)?.container ?? 'mp3'
  );
};

const isJpeg = (buffer: Buffer) =>
  buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

// The cover as JPEG: the original bytes when YouTube serves a square JPEG,
// re-encoded only when a 16:9 video thumbnail has to be cropped
const getCoverJpeg = async (url: string): Promise<Buffer | null> => {
  if (!url) return null;

  const response = await net.fetch(url);
  if (!response.ok) return null;

  const original = Buffer.from(await response.arrayBuffer());
  const image = nativeImage.createFromBuffer(original);
  if (image.isEmpty()) {
    // Fix hidden webp files (https://github.com/th-ch/youtube-music/issues/315)
    if (!url.endsWith('.jpg') && url.includes('.jpg')) {
      return getCoverJpeg(url.slice(0, url.lastIndexOf('.jpg') + 4));
    }
    return null;
  }

  const cropped = cropMaxWidth(image);
  return cropped === image && isJpeg(original) ? original : cropped.toJPEG(90);
};

function writeID3(
  buffer: Buffer,
  metadata: CustomSongInfo,
  coverBuffer: Buffer | null,
  sendFeedback: (str: string, value?: number) => void,
) {
  try {
    sendFeedback(t('plugins.downloader.backend.feedback.writing-id3'));
    const tags: NodeID3.Tags = {};

    // Create the metadata tags
    tags.title = metadata.title;
    tags.artist = metadata.artist;

    if (metadata.album) {
      tags.album = metadata.album;
    }

    if (coverBuffer) {
      tags.image = {
        mime: 'image/jpeg',
        type: {
          id: NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER,
        },
        description: 'thumbnail',
        imageBuffer: coverBuffer,
      };
    }

    if (metadata.trackId) {
      tags.trackNumber = metadata.trackId;
    }

    return NodeID3.write(tags, buffer);
  } catch (error: unknown) {
    sendError(error as Error, `${metadata.artist} - ${metadata.title}`);
    return null;
  }
}

export async function downloadPlaylist(givenUrl?: string | URL) {
  try {
    givenUrl = new URL(givenUrl ?? '');
  } catch {
    givenUrl = new URL(win.webContents.getURL());
  }

  const playlistId =
    getPlaylistID(givenUrl) || getPlaylistID(new URL(playingUrl));

  if (!playlistId) {
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-id-not-found')),
    );
    return;
  }

  const sendFeedback = (message?: unknown) => sendFeedback_(win, message);

  if (is.dev()) {
    console.log(
      t('plugins.downloader.backend.feedback.trying-to-get-playlist-id', {
        playlistId,
      }),
    );
  }
  sendFeedback(t('plugins.downloader.backend.feedback.getting-playlist-info'));
  let playlist: Playlist;
  const items: YTNodes.MusicResponsiveListItem[] = [];
  try {
    playlist = await yt.music.getPlaylist(playlistId);
    if (playlist?.items) {
      const filteredItems = playlist.items.filter(
        (item): item is YTNodes.MusicResponsiveListItem =>
          item instanceof YTNodes.MusicResponsiveListItem,
      );

      items.push(...filteredItems);
    }
  } catch (error: unknown) {
    sendError(
      Error(
        t('plugins.downloader.backend.feedback.playlist-is-mix-or-private', {
          error: String(error),
        }),
      ),
    );
    return;
  }

  if (!playlist || !playlist.items || playlist.items.length === 0) {
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-is-empty')),
    );
    return;
  }

  const normalPlaylistTitle =
    playlist.header && 'title' in playlist.header
      ? playlist.header?.title?.text
      : undefined;
  const playlistTitle =
    normalPlaylistTitle ??
    playlist.page.contents_memo
      ?.get('MusicResponsiveListItemFlexColumn')
      ?.at(2)
      ?.as(YTNodes.MusicResponsiveListItemFlexColumn)?.title?.text ??
    'NO_TITLE';
  const isAlbum = !normalPlaylistTitle;

  while (playlist.has_continuation) {
    playlist = await playlist.getContinuation();

    const filteredItems = playlist.items.filter(
      (item): item is YTNodes.MusicResponsiveListItem =>
        item instanceof YTNodes.MusicResponsiveListItem,
    );

    items.push(...filteredItems);
  }

  // Every item may have been filtered out
  if (items.length === 0) {
    sendError(
      new Error(t('plugins.downloader.backend.feedback.playlist-is-empty')),
    );
    return;
  }

  if (items.length === 1) {
    sendFeedback(
      t('plugins.downloader.backend.feedback.playlist-has-only-one-song'),
    );
    await downloadSongFromId(items.at(0)!.id!);
    return;
  }

  let safePlaylistTitle = filenamify(playlistTitle, { replacement: ' ' });
  if (!is.macOS()) {
    safePlaylistTitle = safePlaylistTitle.normalize('NFC');
  }

  const folder = getFolder(config.downloadFolder ?? '');
  const playlistFolder = join(folder, safePlaylistTitle);
  // The folder is only created by the first saved track, so an existing one
  // means an earlier attempt: resume it and skip the tracks already saved
  const resume = existsSync(playlistFolder);

  try {
    await checkDecipher();
  } catch (error: unknown) {
    sendError(error as Error);
    return;
  }

  dialog.showMessageBox(win, {
    type: 'info',
    buttons: [
      t('plugins.downloader.backend.dialog.start-download-playlist.buttons.ok'),
    ],
    title: t('plugins.downloader.backend.dialog.start-download-playlist.title'),
    message: t(
      'plugins.downloader.backend.dialog.start-download-playlist.message',
      {
        playlistTitle,
      },
    ),
    detail: t(
      'plugins.downloader.backend.dialog.start-download-playlist.detail',
      {
        playlistSize: items.length,
      },
    ),
  });

  if (is.dev()) {
    console.log(
      t('plugins.downloader.backend.feedback.downloading-playlist', {
        playlistTitle,
        playlistSize: items.length,
        playlistId,
      }),
    );
  }

  win.setProgressBar(2); // Starts with indefinite bar

  setBadge(items.length);

  let counter = 1;

  const progressStep = 1 / items.length;

  const increaseProgress = (itemPercentage: number) => {
    const currentProgress = (counter - 1) / (items.length ?? 1);
    const newProgress = currentProgress + progressStep * itemPercentage;
    win.setProgressBar(newProgress);
  };

  try {
    for (const song of items) {
      sendFeedback(
        t('plugins.downloader.backend.feedback.downloading-counter', {
          current: counter,
          total: items.length,
        }),
      );
      const trackId = isAlbum ? counter : undefined;
      await downloadSongFromId(
        song.id!,
        playlistFolder,
        trackId?.toString(),
        increaseProgress,
        resume,
      ).catch((error) =>
        sendError(
          new Error(
            t('plugins.downloader.backend.feedback.error-while-downloading', {
              author: song.author!.name,
              title: song.title!,
              error: String(error),
            }),
          ),
        ),
      );

      win.setProgressBar(counter / items.length);
      setBadge(items.length - counter);
      counter++;
    }
  } catch (error: unknown) {
    sendError(error as Error);
  } finally {
    win.setProgressBar(-1); // Close progress bar
    setBadge(0); // Close badge counter
    sendFeedback(); // Clear feedback
  }
}

function getFFmpegMetadataArgs(metadata: CustomSongInfo) {
  if (!metadata) {
    return [];
  }

  return [
    ...(metadata.title ? ['-metadata', `title=${metadata.title}`] : []),
    ...(metadata.artist ? ['-metadata', `artist=${metadata.artist}`] : []),
    ...(metadata.album ? ['-metadata', `album=${metadata.album}`] : []),
    ...(metadata.trackId ? ['-metadata', `track=${metadata.trackId}`] : []),
  ];
}

// Playlist radio modifier needs to be cut from playlist ID
const INVALID_PLAYLIST_MODIFIER = 'RDAMPL';

const getPlaylistID = (aURL?: URL): string | null | undefined => {
  const result =
    aURL?.searchParams.get('list') || aURL?.searchParams.get('playlist');
  if (result?.startsWith(INVALID_PLAYLIST_MODIFIER)) {
    return result.slice(INVALID_PLAYLIST_MODIFIER.length);
  }

  return result;
};

const getVideoId = (url: URL | string): string | null => {
  return new URL(url).searchParams.get('v');
};

const getMetadata = (info: TrackInfo): CustomSongInfo => ({
  videoId: info.basic_info.id!,
  title: cleanupName(info.basic_info.title!),
  artist: cleanupName(info.basic_info.author!),
  album: info.player_overlays?.browser_media_session?.as(
    YTNodes.BrowserMediaSession,
  ).album?.text,
  imageSrc: info.basic_info.thumbnail?.find((t) => !t.url.endsWith('.webp'))
    ?.url,
  views: info.basic_info.view_count!,
  songDuration: info.basic_info.duration!,
  mediaType: MediaType.Audio,
});

// This is used to bypass age restrictions
const getAndroidTvInfo = async (id: string): Promise<VideoInfo> => {
  // GetInfo 404s with the bypass, so we use getBasicInfo instead
  // that's fine as we only need the streaming data
  return await yt.getBasicInfo(id, {
    client: 'TV_EMBEDDED',
  });
};
