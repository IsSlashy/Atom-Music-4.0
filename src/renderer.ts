import i18next from 'i18next';

import { startingPages } from './providers/extracted-data';
import { setupSongInfo } from './providers/song-info-front';
import {
  createContext,
  forceLoadRendererPlugin,
  forceUnloadRendererPlugin,
  getAllLoadedRendererPlugins,
  getLoadedRendererPlugin,
  loadAllRendererPlugins,
} from './loader/renderer';

import { loadI18n, setLanguage, t as i18t } from '@/i18n';

import {
  defaultTrustedTypePolicy,
  registerWindowDefaultTrustedTypePolicy,
} from '@/utils/trusted-types';

import type { PluginConfig } from '@/types/plugins';
import type { YoutubePlayer } from '@/types/youtube-player';
import type { QueueElement } from '@/types/queue';
import type { QueueResponse } from '@/types/youtube-music-desktop-internal';
import type { YouTubeMusicAppElement } from '@/types/youtube-music-app-element';
import type { SearchBoxElement } from '@/types/search-box-element';

let api: (Element & YoutubePlayer) | null = null;
let isPluginLoaded = false;
let isApiLoaded = false;
let firstDataLoaded = false;

registerWindowDefaultTrustedTypePolicy();

async function listenForApiLoad() {
  // `initObserver` is the authoritative entry point: it watches the DOM for
  // `#movie_player` and calls `onApiLoaded()` exactly once (guarded by
  // `isApiLoaded`). This is only a fast path for the case where the player is
  // already present by the time plugins finish loading; it must mirror the same
  // guard so the two paths never run `onApiLoaded()` twice.
  if (!isApiLoaded) {
    const playerApi = document.querySelector<Element & YoutubePlayer>(
      '#movie_player',
    );
    if (playerApi) {
      api = playerApi;
      isApiLoaded = true;
      await onApiLoaded();

      return;
    }
  }
}

/**
 * Resolves once a node matching `selector` exists in the DOM. Uses a
 * MutationObserver on `document.documentElement` (so it survives slow boots and
 * SPA re-renders) with a bounded timeout to avoid a perpetual observer. Resolves
 * `null` if the element never appears within `timeoutMs`.
 */
function waitForElement<T extends Element = Element>(
  selector: string,
  timeoutMs = 20000,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const existing = document.querySelector<T>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    let settled = false;
    const finish = (el: T | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(el);
    };

    const observer = new MutationObserver(() => {
      const found = document.querySelector<T>(selector);
      if (found) finish(found);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

// Modern Apple-inspired SVG icons for navigation tabs
const modernIcons: Record<string, { outline: string; filled: string }> = {
  home: {
    outline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.25L12 3l9 7.25V20.5A1.5 1.5 0 0 1 19.5 22h-4a1 1 0 0 1-1-1v-5a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v5a1 1 0 0 1-1 1h-4A1.5 1.5 0 0 1 3 20.5z"/></svg>`,
    filled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12.97 2.59a1.5 1.5 0 0 0-1.94 0l-7.5 6.36A1.5 1.5 0 0 0 3 10.23V19.5A1.5 1.5 0 0 0 4.5 21H9a1 1 0 0 0 1-1v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5a1 1 0 0 0 1 1h4.5a1.5 1.5 0 0 0 1.5-1.5v-9.27a1.5 1.5 0 0 0-.53-1.14l-7.5-6.5z"/></svg>`,
  },
  explore: {
    outline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
    filled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.6 6.4l-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1zM12 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>`,
  },
  library: {
    outline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="6" width="12" height="12" rx="1.5"/><path d="M6 4h10" stroke-width="1.5"/><circle cx="14" cy="12" r="3"/><circle cx="14" cy="12" r="0.75" fill="currentColor" stroke="none"/><path d="M4 8v10a2 2 0 0 0 2 2h10"/></svg>`,
    filled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-6 12.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`,
  },
  playlists: {
    outline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="15" y2="6"/><line x1="3" y1="10" x2="13" y2="10"/><line x1="3" y1="14" x2="11" y2="14"/><circle cx="18" cy="15" r="3"/><line x1="18" y1="12" x2="18" y2="9"/></svg>`,
    filled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3 5h12a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm0 4h10a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm0 4h8a1 1 0 1 1 0 2H3a1 1 0 0 1 0-2zm15-4v3.17A3 3 0 1 0 20 15V11h2a1 1 0 1 0 0-2h-3a1 1 0 0 0-1 1zm0 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>`,
  },
  downloads: {
    outline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>`,
    filled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 3a1 1 0 1 0-2 0v9.59l-2.3-2.3a1 1 0 0 0-1.4 1.42l4 4a1 1 0 0 0 1.4 0l4-4a1 1 0 0 0-1.4-1.42L13 12.59V3zM5 17a1 1 0 1 0-2 0v2a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-2a1 1 0 1 0-2 0v2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-2z"/></svg>`,
  },
};

function replaceNavIcons() {
  const applyIcons = () => {
    const entries = document.querySelectorAll('ytmusic-guide-entry-renderer');
    if (entries.length === 0) return false;

    let replaced = 0;
    entries.forEach((entry) => {
      // Skip if already has our icon
      const existing = entry.querySelector('.ytmd-nav-icon');
      if (existing) {
        const origIcon = entry.querySelector('yt-icon:not(.ytmd-nav-icon yt-icon), iron-icon') as HTMLElement | null;
        if (origIcon) origIcon.style.display = 'none';
        return;
      }

      // Match by href
      const link = entry.querySelector('a');
      const href = link?.getAttribute('href') || '';
      let iconKey: string | null = null;
      if (href.includes('FEmusic_home')) iconKey = 'home';
      else if (href.includes('FEmusic_explore')) iconKey = 'explore';
      else if (href.includes('FEmusic_library')) iconKey = 'library';

      // Fallback: match by text
      if (!iconKey) {
        const text = entry.textContent?.trim().toLowerCase() || '';
        if (/^(accueil|home)$/i.test(text)) iconKey = 'home';
        else if (/^(explorer|explore)$/i.test(text)) iconKey = 'explore';
        else if (/^(biblioth[eè]que|library)$/i.test(text)) iconKey = 'library';
      }
      if (!iconKey) return;

      const icons = modernIcons[iconKey];
      const toHide = (entry.querySelector('yt-icon') || entry.querySelector('iron-icon, svg')) as HTMLElement | null;
      if (!toHide) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'ytmd-nav-icon';
      wrapper.setAttribute('data-icon-key', iconKey);
      wrapper.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;color:inherit;transition:transform 200ms cubic-bezier(0.16,1,0.3,1);flex-shrink:0;';

      const isSelected = entry.hasAttribute('active') || entry.classList.contains('iron-selected');
      wrapper.innerHTML = isSelected ? icons.filled : icons.outline;

      toHide.style.display = 'none';
      toHide.parentElement?.insertBefore(wrapper, toHide);
      replaced++;

      // Watch for selection changes
      const selObserver = new MutationObserver(() => {
        const sel = entry.hasAttribute('active') || entry.classList.contains('iron-selected');
        wrapper.innerHTML = sel ? icons.filled : icons.outline;
      });
      selObserver.observe(entry, { attributes: true, attributeFilter: ['active', 'class'] });
    });

    return replaced > 0;
  };

  // Add custom sidebar entries into the MINI GUIDE (the actually visible sidebar)
  const addCustomEntries = () => {
    if (document.querySelector('#mini-guide .ytmd-custom-entry')) return;

    // Target the MINI GUIDE's #items container (not the hidden full guide)
    const miniGuideItems = document.querySelector('#mini-guide ytmusic-guide-section-renderer #items');
    if (!miniGuideItems) return;

    const createEntry = (iconKey: string, label: string, onClick: () => void) => {
      const entry = document.createElement('div');
      entry.className = 'ytmd-custom-entry';
      entry.setAttribute('data-icon-key', iconKey);
      entry.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; margin: 2px auto;
        border-radius: 12px; cursor: pointer; color: rgba(255,255,255,0.7);
        transition: background 400ms cubic-bezier(0.16,1,0.3,1), transform 400ms cubic-bezier(0.16,1,0.3,1);
        position: relative; box-sizing: border-box;
      `;

      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'ytmd-nav-icon';
      iconWrapper.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;color:inherit;';
      iconWrapper.innerHTML = modernIcons[iconKey].outline;
      entry.appendChild(iconWrapper);

      entry.addEventListener('mousedown', () => { entry.style.transform = 'scale(0.92)'; });
      entry.addEventListener('mouseup', () => { entry.style.transform = ''; });
      entry.addEventListener('click', onClick);
      entry.title = label;
      return entry;
    };

    // --- Page helpers (solid page covering the content area) ---
    const deselectAllCustomEntries = () => {
      document.querySelectorAll('.ytmd-custom-entry.active').forEach(e => {
        e.classList.remove('active');
        const iw = e.querySelector('.ytmd-nav-icon');
        const key = e.getAttribute('data-icon-key');
        if (iw && key && modernIcons[key]) iw.innerHTML = modernIcons[key].outline;
      });
    };

    const closePage = (id: string) => {
      document.getElementById(id)?.remove();
    };

    const buildPage = (id: string, titleText: string, entry: HTMLElement) => {
      // If page already showing, toggle off
      const existing = document.getElementById(id);
      if (existing) {
        existing.remove();
        entry.classList.remove('active');
        const iw = entry.querySelector('.ytmd-nav-icon');
        const key = entry.getAttribute('data-icon-key');
        if (iw && key && modernIcons[key]) iw.innerHTML = modernIcons[key].outline;
        return null;
      }

      // Close any other custom page
      closePage('ytmd-downloads-page');
      closePage('ytmd-playlists-page');
      deselectAllCustomEntries();

      // Deselect native YTM entries
      document.querySelectorAll('ytmusic-guide-entry-renderer[active]').forEach(e => e.removeAttribute('active'));
      document.querySelectorAll('ytmusic-guide-entry-renderer.iron-selected').forEach(e => e.classList.remove('iron-selected'));

      // Mark this entry as active + filled icon
      entry.classList.add('active');
      const iconWrapper = entry.querySelector('.ytmd-nav-icon');
      const iconKey = entry.getAttribute('data-icon-key');
      if (iconWrapper && iconKey && modernIcons[iconKey]) iconWrapper.innerHTML = modernIcons[iconKey].filled;

      // Create page div — covers content area with solid background
      const page = document.createElement('div');
      page.id = id;
      page.style.cssText = `
        position: fixed; top: 122px; left: 72px; right: 12px; bottom: 72px;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(30px) saturate(180%);
        -webkit-backdrop-filter: blur(30px) saturate(180%);
        color: #fff; font-family: 'Satoshi', sans-serif;
        z-index: 9999; display: flex; flex-direction: column;
      `;

      // Header
      const header = document.createElement('div');
      header.style.cssText = 'padding: 24px 40px 16px; flex-shrink: 0;';
      const title = document.createElement('h2');
      title.textContent = titleText;
      title.style.cssText = 'margin:0; font-size:28px; font-weight:600; letter-spacing:-0.02em;';
      header.appendChild(title);
      page.appendChild(header);

      document.body.appendChild(page);
      return page;
    };

    // Watch for YTM native navigation to cleanup custom pages
    const navEntries = document.querySelectorAll('ytmusic-guide-entry-renderer');
    navEntries.forEach(navEntry => {
      navEntry.addEventListener('click', () => {
        // Small delay to let YTM process the navigation
        setTimeout(() => {
          const hasCustomPage = document.getElementById('ytmd-downloads-page') || document.getElementById('ytmd-playlists-page');
          if (hasCustomPage) {
            closePage('ytmd-downloads-page');
            closePage('ytmd-playlists-page');
            deselectAllCustomEntries();
          }
        }, 50);
      });
    });

    // ===== PLAYLISTS PAGE =====
    let playlistsEntryRef: HTMLElement | null = null;
    const playlistsEntry = createEntry('playlists', 'Playlists', async () => {
      const page = buildPage('ytmd-playlists-page', 'Playlists', playlistsEntryRef!);
      if (!page) return;

      const content = document.createElement('div');
      content.style.cssText = 'flex:1;overflow-y:auto;padding:0 40px 24px;';
      page.appendChild(content);

      // Fetch playlists from the hidden full guide's secondary section
      const plEntries = document.querySelectorAll('tp-yt-app-drawer #contentContainer ytmusic-guide-section-renderer:not([is-primary]) ytmusic-guide-entry-renderer');
      if (plEntries.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Aucune playlist trouvée';
        empty.style.cssText = 'color:rgba(255,255,255,0.5);font-size:16px;padding:40px 0;text-align:center;';
        content.appendChild(empty);
      } else {
        plEntries.forEach((plEntry) => {
          const entryData = (plEntry as any)?.data;
          const browseId = entryData?.navigationEndpoint?.browseEndpoint?.browseId || '';
          const plTitle = entryData?.formattedTitle?.runs?.[0]?.text
            || plEntry.querySelector('yt-formatted-string')?.textContent?.trim()
            || 'Playlist';
          const thumb = plEntry.querySelector('img');
          const thumbSrc = thumb?.src || '';

          const row = document.createElement('div');
          row.style.cssText = `
            display:flex;align-items:center;padding:12px 16px;border-radius:12px;
            cursor:pointer;transition:background 200ms;margin-bottom:2px;
          `;
          row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.06)'; });
          row.addEventListener('mouseleave', () => { row.style.background = ''; });

          if (thumbSrc) {
            const img = document.createElement('img');
            img.src = thumbSrc;
            img.style.cssText = 'width:48px;height:48px;border-radius:8px;object-fit:cover;margin-right:16px;flex-shrink:0;';
            row.appendChild(img);
          } else {
            const iconEl = document.createElement('div');
            iconEl.innerHTML = modernIcons.playlists.outline;
            iconEl.style.cssText = 'width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:rgba(255,255,255,0.06);margin-right:16px;flex-shrink:0;color:rgba(255,255,255,0.5);';
            row.appendChild(iconEl);
          }

          const nameEl = document.createElement('div');
          nameEl.textContent = plTitle;
          nameEl.style.cssText = 'font-size:15px;font-weight:500;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
          row.appendChild(nameEl);

          row.addEventListener('click', () => {
            closePage('ytmd-playlists-page');
            deselectAllCustomEntries();
            if (browseId) {
              document.querySelector<any>('ytmusic-app')?.navigate(browseId);
            }
          });

          content.appendChild(row);
        });
      }
    });
    playlistsEntryRef = playlistsEntry;

    // ===== DOWNLOADS PAGE =====
    let downloadsEntryRef: HTMLElement | null = null;
    const downloadsEntry = createEntry('downloads', 'Téléchargements', async () => {
      const page = buildPage('ytmd-downloads-page', 'Téléchargements', downloadsEntryRef!);
      if (!page) return;

      const result = await window.ipcRenderer.invoke('ytmd:list-downloads') as {
        folder: string;
        files: Array<{ name: string; path: string; size: number; modified: number; imageSrc?: string }>;
      };

      // Folder path subtitle
      const sub = document.createElement('div');
      sub.textContent = result.folder;
      sub.style.cssText = 'color:rgba(255,255,255,0.35);font-size:12px;padding:0 40px 12px;flex-shrink:0;';
      page.appendChild(sub);

      // File count
      const countEl = document.createElement('div');
      countEl.textContent = `${result.files.length} titre${result.files.length !== 1 ? 's' : ''}`;
      countEl.style.cssText = 'color:rgba(255,255,255,0.5);font-size:13px;padding:0 40px 16px;flex-shrink:0;';
      page.appendChild(countEl);

      // Scrollable song list
      const list = document.createElement('div');
      list.style.cssText = 'flex:1;overflow-y:auto;padding:0 24px 24px;';
      page.appendChild(list);

      if (result.files.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Aucun fichier téléchargé';
        empty.style.cssText = 'color:rgba(255,255,255,0.5);font-size:16px;padding:60px 0;text-align:center;';
        list.appendChild(empty);
      } else {
        result.files.forEach((file) => {
          const row = document.createElement('div');
          row.style.cssText = `
            display:flex;align-items:center;padding:10px 16px;border-radius:10px;
            cursor:pointer;transition:background 200ms;margin-bottom:1px;
          `;
          row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
          row.addEventListener('mouseleave', () => { row.style.background = ''; });

          const iconEl = document.createElement('div');
          iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="rgba(255,255,255,0.4)"><polygon points="5,3 19,12 5,21"/></svg>';
          iconEl.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;margin-right:12px;flex-shrink:0;';

          const info = document.createElement('div');
          info.style.cssText = 'flex:1;min-width:0;';
          const nameEl = document.createElement('div');
          const cleanName = file.name.replace(/\.[^.]+$/, '');
          const parts = cleanName.split(' - ');
          nameEl.textContent = parts.length > 1 ? parts.slice(1).join(' - ') : cleanName;
          nameEl.style.cssText = 'font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

          const metaLine = document.createElement('div');
          metaLine.style.cssText = 'display:flex;gap:8px;margin-top:2px;';
          if (parts.length > 1) {
            const artist = document.createElement('span');
            artist.textContent = parts[0];
            artist.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.45);';
            metaLine.appendChild(artist);
          }
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          const sizeEl = document.createElement('span');
          sizeEl.textContent = sizeMB + ' MB';
          sizeEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.3);';
          metaLine.appendChild(sizeEl);
          info.appendChild(nameEl);
          info.appendChild(metaLine);

          const deleteBtn = document.createElement('div');
          deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(255,255,255,0.35)"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
          deleteBtn.style.cssText = 'width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;cursor:pointer;flex-shrink:0;transition:background 200ms;margin-left:8px;';
          deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'rgba(255,80,80,0.15)'; });
          deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = ''; });
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await window.ipcRenderer.invoke('ytmd:delete-download', file.path);
            row.remove();
          });

          row.appendChild(iconEl);
          row.appendChild(info);
          row.appendChild(deleteBtn);
          // Play local file in-app with custom audio + full player bar takeover
          row.addEventListener('click', () => {
            closePage('ytmd-downloads-page');
            deselectAllCustomEntries();
            (window as any).__ytmdPlayLocalFile(file);
          });
          list.appendChild(row);
        });
      }
    });
    downloadsEntryRef = downloadsEntry;

    // ===== SHARED LOCAL PLAYBACK FUNCTION =====
    (window as any).__ytmdPlayLocalFile = async (file: { name: string; path: string; imageSrc?: string }) => {
            // Cleanup any previous local playback session
            const prevCleanup = (window as any).__ytmdLocalCleanup;
            if (prevCleanup) prevCleanup();

            // Block YTM's video player to prevent auto-play/radio
            const ytVideo = document.querySelector('video');
            if (ytVideo) {
              ytVideo.pause();
              // Load silent audio so YTM thinks video is ready (fixes loading spinner)
              ytVideo.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
              ytVideo.muted = true;
              ytVideo.load();
              // Override play() - but allow cleanup when YTM sets a new real src
              const origPlay = ytVideo.play.bind(ytVideo);
              let localBlocked = true;
              (ytVideo as any).play = function() {
                // If YTM loaded a new real source (not our silent data URI), restore and let it play
                if (localBlocked && ytVideo.src && !ytVideo.src.startsWith('data:')) {
                  localBlocked = false;
                  (ytVideo as any).play = origPlay;
                  const cl = (window as any).__ytmdLocalCleanup;
                  if (cl) cl();
                  const la = document.getElementById('ytmd-local-audio') as HTMLAudioElement | null;
                  if (la) { la.pause(); la.src = ''; }
                  return origPlay();
                }
                return Promise.resolve();
              };
              // Also watch for src changes via setter override
              const origSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src') ||
                                        Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'src');
              if (origSrcDescriptor?.set) {
                const origSrcSet = origSrcDescriptor.set;
                Object.defineProperty(ytVideo, 'src', {
                  get: origSrcDescriptor.get ? origSrcDescriptor.get.bind(ytVideo) : () => ytVideo.getAttribute('src') || '',
                  set(val: string) {
                    origSrcSet.call(ytVideo, val);
                    // If YTM sets a real source, restore everything
                    if (localBlocked && val && !val.startsWith('data:')) {
                      localBlocked = false;
                      (ytVideo as any).play = origPlay;
                      delete (ytVideo as any).src; // remove override, restore prototype
                      const cl = (window as any).__ytmdLocalCleanup;
                      if (cl) cl();
                      const la = document.getElementById('ytmd-local-audio') as HTMLAudioElement | null;
                      if (la) { la.pause(); la.src = ''; }
                    }
                  },
                  configurable: true,
                });
              }
            }

            // Create or reuse hidden audio element
            let localAudio = document.getElementById('ytmd-local-audio') as HTMLAudioElement | null;
            if (!localAudio) {
              localAudio = document.createElement('audio');
              localAudio.id = 'ytmd-local-audio';
              localAudio.style.display = 'none';
              document.body.appendChild(localAudio);
            }
            localAudio.src = 'ytmd-local://file?path=' + encodeURIComponent(file.path);

            // Sync volume from YTM's player bar
            const playerBar = document.querySelector<any>('ytmusic-player-bar');
            const ytmVolume = playerBar?.playerApi?.getVolume?.() ?? api?.getVolume?.() ?? 100;
            localAudio.volume = Math.max(0, Math.min(1, ytmVolume / 100));

            // Watch for volume slider changes
            const volumeSlider = document.querySelector<HTMLElement>('#volume-slider, #expand-volume-slider');
            const onVolumeChange = () => {
              const vol = playerBar?.playerApi?.getVolume?.() ?? api?.getVolume?.() ?? 100;
              if (localAudio) localAudio.volume = Math.max(0, Math.min(1, vol / 100));
            };
            if (volumeSlider) volumeSlider.addEventListener('value-change', onVolumeChange);

            // Also listen for IPC volume updates
            const onIpcVolume = (_: any, vol: number) => {
              if (localAudio) localAudio.volume = Math.max(0, Math.min(1, vol / 100));
            };
            window.ipcRenderer.on('ytmd:update-volume', onIpcVolume);

            localAudio.play().catch((err) => console.error('[YTMusic] Playback error:', err));

            // Fetch cover art if not already available
            let coverSrc = file.imageSrc;
            if (!coverSrc) {
              try {
                const coverResult = await window.ipcRenderer.invoke('ytmd:get-cover', file.path) as { imageSrc: string | null };
                if (coverResult?.imageSrc) coverSrc = coverResult.imageSrc;
              } catch { /* ignore */ }
            }

            // Extract title/artist from filename
            const cleanName = file.name.replace(/\.[^.]+$/, '');
            const fileParts = cleanName.split(' - ');
            const songTitle = fileParts.length > 1 ? fileParts.slice(1).join(' - ') : cleanName;
            const songArtist = fileParts.length > 1 ? fileParts[0] : '';

            const formatTime = (s: number) => {
              if (!isFinite(s)) return '0:00';
              const m = Math.floor(s / 60);
              const sec = Math.floor(s % 60);
              return m + ':' + (sec < 10 ? '0' : '') + sec;
            };

            // Elements
            const titleEl = document.querySelector('yt-formatted-string.title.style-scope.ytmusic-player-bar');
            const subtitleEl = document.querySelector('ytmusic-player-bar .content-info-wrapper .subtitle');
            const thumbImg = document.querySelector<HTMLImageElement>('ytmusic-player-bar img.image.style-scope.ytmusic-player-bar');
            const origTimeInfo = document.querySelector<HTMLElement>('span.time-info.style-scope.ytmusic-player-bar');
            const progressBar = document.querySelector<HTMLElement>('#progress-bar');
            const playPauseBtn = document.querySelector<HTMLElement>('ytmusic-player-bar #play-pause-button');

            // ---- TITLE / ARTIST: use MutationObserver with guard flag ----
            let guardFlag = false;
            const forceUI = () => {
              if (guardFlag) return;
              guardFlag = true;
              if (titleEl && titleEl.textContent !== songTitle) titleEl.textContent = songTitle;
              if (subtitleEl && subtitleEl.textContent !== songArtist) subtitleEl.textContent = songArtist;
              guardFlag = false;
            };
            forceUI();
            const uiObserver = new MutationObserver(() => forceUI());
            if (titleEl) uiObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
            if (subtitleEl) uiObserver.observe(subtitleEl, { childList: true, characterData: true, subtree: true });

            // ---- IMAGE: overlay our own image on top of the thumbnail container ----
            const thumbContainer = document.querySelector<HTMLElement>('ytmusic-player-bar .thumbnail-image-wrapper') ||
              document.querySelector<HTMLElement>('ytmusic-player-bar .player-bar-image') ||
              thumbImg?.parentElement;
            let customThumb = document.getElementById('ytmd-local-thumb') as HTMLImageElement | null;
            if (coverSrc && thumbContainer) {
              if (!customThumb) {
                customThumb = document.createElement('img');
                customThumb.id = 'ytmd-local-thumb';
                customThumb.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:10;border-radius:inherit;';
                thumbContainer.style.position = 'relative';
                thumbContainer.appendChild(customThumb);
              }
              customThumb.src = coverSrc;
              customThumb.style.display = '';
            }

            // ---- MAIN PLAYER IMAGE: inject cover art into ytmusic-player ----
            const ytPlayer = document.querySelector<HTMLElement>('ytmusic-player');
            let mainCover = document.getElementById('ytmd-local-main-cover') as HTMLImageElement | null;
            if (coverSrc && ytPlayer) {
              if (!mainCover) {
                mainCover = document.createElement('img');
                mainCover.id = 'ytmd-local-main-cover';
                mainCover.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;z-index:20;background:#000;pointer-events:none;';
                ytPlayer.style.position = 'relative';
                ytPlayer.appendChild(mainCover);
              }
              mainCover.src = coverSrc;
              mainCover.style.display = '';
            }

            // ---- SIDE PANEL: replace queue with local downloads list ----
            const sidePanel = document.querySelector<HTMLElement>('#side-panel.side-panel.ytmusic-player-page') ||
              document.querySelector<HTMLElement>('.side-panel.ytmusic-player-page');
            const sidePanelOrigChildren: { el: HTMLElement; display: string }[] = [];
            let localSidePanel = document.getElementById('ytmd-local-side-panel') as HTMLElement | null;
            if (sidePanel) {
              // Hide original side panel children
              Array.from(sidePanel.children).forEach(child => {
                const el = child as HTMLElement;
                if (el.id !== 'ytmd-local-side-panel') {
                  sidePanelOrigChildren.push({ el, display: el.style.display });
                  el.style.display = 'none';
                }
              });
              if (!localSidePanel) {
                localSidePanel = document.createElement('div');
                localSidePanel.id = 'ytmd-local-side-panel';
                localSidePanel.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
                sidePanel.appendChild(localSidePanel);
              }
              localSidePanel.style.display = '';
              localSidePanel.innerHTML = '';
              // Header
              const header = document.createElement('div');
              header.style.cssText = 'padding:16px 20px 8px;font-size:16px;font-weight:600;color:#fff;flex-shrink:0;';
              header.textContent = 'Téléchargements';
              localSidePanel.appendChild(header);
              // Scrollable list
              const sideList = document.createElement('div');
              sideList.style.cssText = 'flex:1;overflow-y:auto;padding:4px 8px;';
              localSidePanel.appendChild(sideList);
              // Fetch downloads list
              window.ipcRenderer.invoke('ytmd:list-downloads').then((res: any) => {
                const dlFiles = res?.files || [];
                dlFiles.forEach((f: any) => {
                  const item = document.createElement('div');
                  const isPlaying = f.path === file.path;
                  item.style.cssText = `display:flex;align-items:center;padding:8px 12px;border-radius:8px;cursor:pointer;gap:10px;${isPlaying ? 'background:rgba(255,255,255,0.12);' : ''}`;
                  item.addEventListener('mouseenter', () => { if (!isPlaying) item.style.background = 'rgba(255,255,255,0.08)'; });
                  item.addEventListener('mouseleave', () => { if (!isPlaying) item.style.background = ''; });
                  // Thumbnail
                  const thumb = document.createElement('div');
                  thumb.style.cssText = 'width:40px;height:40px;border-radius:4px;background:#333;flex-shrink:0;overflow:hidden;';
                  if (f.imageSrc) {
                    thumb.innerHTML = `<img src="${f.imageSrc}" style="width:100%;height:100%;object-fit:cover;">`;
                  }
                  item.appendChild(thumb);
                  // Title/artist
                  const info = document.createElement('div');
                  info.style.cssText = 'flex:1;min-width:0;';
                  const cn = f.name.replace(/\.[^.]+$/, '');
                  const parts = cn.split(' - ');
                  const t = parts.length > 1 ? parts.slice(1).join(' - ') : cn;
                  const a = parts.length > 1 ? parts[0] : '';
                  info.innerHTML = `<div style="color:${isPlaying ? '#fff' : 'rgba(255,255,255,0.9)'};font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t}</div><div style="color:rgba(255,255,255,0.5);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a}</div>`;
                  item.appendChild(info);
                  // Now playing indicator
                  if (isPlaying) {
                    const indicator = document.createElement('div');
                    indicator.style.cssText = 'color:#f00;font-size:18px;flex-shrink:0;';
                    indicator.textContent = '\u266B';
                    item.appendChild(indicator);
                  }
                  // Click to play another downloaded song
                  if (!isPlaying) {
                    item.addEventListener('click', () => {
                      // Trigger cleanup, then start new local playback
                      const cl = (window as any).__ytmdLocalCleanup;
                      if (cl) cl();
                      // Simulate clicking on this file - dispatch custom event
                      const ev = new CustomEvent('ytmd-play-local', { detail: f });
                      document.dispatchEvent(ev);
                    });
                  }
                  sideList.appendChild(item);
                });
                // Also fetch covers for items missing imageSrc
                dlFiles.forEach(async (f: any, i: number) => {
                  if (!f.imageSrc) {
                    try {
                      const cr = await window.ipcRenderer.invoke('ytmd:get-cover', f.path) as { imageSrc: string | null };
                      if (cr?.imageSrc) {
                        const thumbEl = sideList.children[i]?.querySelector('div > img') as HTMLImageElement;
                        if (thumbEl) thumbEl.src = cr.imageSrc;
                        else {
                          const thumbContainer = sideList.children[i]?.querySelector('div') as HTMLElement;
                          if (thumbContainer) thumbContainer.innerHTML = `<img src="${cr.imageSrc}" style="width:100%;height:100%;object-fit:cover;">`;
                        }
                      }
                    } catch { /* ignore */ }
                  }
                });
              });
            }

            // ---- TIME: hide original, inject our own overlay span ----
            let customTime = document.getElementById('ytmd-local-time') as HTMLElement | null;
            if (!customTime) {
              customTime = document.createElement('span');
              customTime.id = 'ytmd-local-time';
              customTime.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.7);white-space:nowrap;';
              origTimeInfo?.parentElement?.insertBefore(customTime, origTimeInfo);
            }
            customTime.style.display = '';
            customTime.textContent = '0:00 / 0:00';
            if (origTimeInfo) origTimeInfo.style.display = 'none';

            // ---- PROGRESS BAR: inject a custom overlay bar into #sliderContainer ----
            const sliderContainer = progressBar?.querySelector<HTMLElement>('#sliderContainer');
            let customProgress = document.getElementById('ytmd-local-progress') as HTMLElement | null;
            if (!customProgress) {
              customProgress = document.createElement('div');
              customProgress.id = 'ytmd-local-progress';
              customProgress.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;cursor:pointer;';
              customProgress.innerHTML = '<div id="ytmd-local-trail" style="position:absolute;top:50%;left:0;height:3px;transform:translateY(-50%);background:#f00;border-radius:2px;pointer-events:none;width:0%;"></div><div id="ytmd-local-dot" style="position:absolute;top:50%;width:12px;height:12px;background:#f00;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;left:0%;"></div>';
              if (sliderContainer) {
                sliderContainer.style.position = 'relative';
                sliderContainer.appendChild(customProgress);
              }
            }
            customProgress.style.display = '';
            const trail = document.getElementById('ytmd-local-trail')!;
            const dot = document.getElementById('ytmd-local-dot')!;

            // Hide original slider visuals
            const origSliderBar = progressBar?.querySelector<HTMLElement>('#sliderBar');
            const origKnobContainer = progressBar?.querySelector<HTMLElement>('#sliderKnobContainer');
            if (origSliderBar) origSliderBar.style.opacity = '0';
            if (origKnobContainer) origKnobContainer.style.opacity = '0';

            let localActive = true;
            let rafId = 0;

            // ---- UPDATE LOOP ----
            const updateLoop = () => {
              if (!localActive) return;
              if (localAudio && isFinite(localAudio.duration)) {
                const cur = localAudio.currentTime;
                const dur = localAudio.duration;
                const pct = dur > 0 ? (cur / dur) * 100 : 0;
                if (customTime) customTime.textContent = formatTime(cur) + ' / ' + formatTime(dur);
                if (trail) trail.style.width = pct + '%';
                if (dot) dot.style.left = pct + '%';
              }
              rafId = requestAnimationFrame(updateLoop);
            };
            rafId = requestAnimationFrame(updateLoop);

            // ---- SEEK on custom progress bar click ----
            const onProgressClick = (e: MouseEvent) => {
              if (!localActive || !localAudio || !isFinite(localAudio.duration) || !customProgress) return;
              const rect = customProgress.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              localAudio.currentTime = pct * localAudio.duration;
            };
            customProgress.addEventListener('click', onProgressClick);

            // ---- PLAY/PAUSE: button, player area click, and spacebar ----
            const updatePlayPauseIcon = () => {
              if (!playPauseBtn || !localAudio) return;
              const icon = playPauseBtn.querySelector('yt-icon');
              if (icon) {
                icon.setAttribute('icon', localAudio.paused ? 'yt-sys-icons:play_arrow' : 'yt-sys-icons:pause');
              }
              playPauseBtn.setAttribute('aria-label', localAudio.paused ? 'Lecture' : 'Pause');
              // Also try setting title
              playPauseBtn.setAttribute('title', localAudio.paused ? 'Lecture' : 'Pause');
            };
            const togglePlayPause = () => {
              if (!localActive || !localAudio) return;
              if (localAudio.paused) {
                localAudio.play().catch(() => {});
              } else {
                localAudio.pause();
              }
              updatePlayPauseIcon();
            };
            // Set initial icon state (playing)
            updatePlayPauseIcon();
            const onPlayPause = (e: Event) => {
              if (!localActive) return;
              e.stopPropagation();
              e.preventDefault();
              togglePlayPause();
            };
            if (playPauseBtn) playPauseBtn.addEventListener('click', onPlayPause, true);
            // Intercept clicks on the main player area
            const songMediaEl = document.querySelector<HTMLElement>('#song-media-window');
            if (songMediaEl) songMediaEl.addEventListener('click', onPlayPause, true);
            // Intercept spacebar and media keys (but NOT when typing in inputs)
            const onKeyDown = (e: KeyboardEvent) => {
              if (!localActive) return;
              // Don't intercept when user is typing in an input, textarea, or contentEditable
              const tag = (e.target as HTMLElement)?.tagName;
              if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
              if (e.code === 'Space' || e.key === ' ' || e.key === 'MediaPlayPause') {
                e.stopPropagation();
                e.preventDefault();
                togglePlayPause();
              }
            };
            document.addEventListener('keydown', onKeyDown, true);

            // ---- REPLAY: when local audio ends, check repeat mode ----
            const onEnded = async () => {
              if (!localActive || !localAudio) return;
              let repeatMode = 'NONE';
              try {
                const bar = document.querySelector<any>('ytmusic-player-bar');
                repeatMode = bar?.getState?.()?.queue?.repeatMode || 'NONE';
              } catch { /* ignore */ }

              if (repeatMode === 'ONE') {
                // Repeat ONE: replay the same track
                localAudio.currentTime = 0;
                localAudio.play().catch(() => {});
              } else if (repeatMode === 'ALL') {
                // Repeat ALL: play next downloaded file in the list
                try {
                  const res = await window.ipcRenderer.invoke('ytmd:list-downloads') as {
                    files: Array<{ name: string; path: string; size: number; modified: number; imageSrc?: string }>;
                  };
                  const dlFiles = res?.files || [];
                  if (dlFiles.length > 0) {
                    const currentIdx = dlFiles.findIndex((f) => f.path === file.path);
                    const nextIdx = (currentIdx + 1) % dlFiles.length;
                    const nextFile = dlFiles[nextIdx];
                    if (nextFile && (window as any).__ytmdPlayLocalFile) {
                      (window as any).__ytmdPlayLocalFile(nextFile);
                    }
                  }
                } catch { /* ignore */ }
              } else {
                // No repeat: stop playback, keep UI idle, block YTM from auto-playing
                localAudio.pause();
                localAudio.currentTime = 0;
                if (localActive) updatePlayPauseIcon();
              }
            };
            localAudio.addEventListener('ended', onEnded);

            // ---- CLEANUP function ----
            const cleanup = () => {
              localActive = false;
              if (rafId) cancelAnimationFrame(rafId);
              rafId = 0;
              uiObserver.disconnect();
              customProgress?.removeEventListener('click', onProgressClick);
              if (playPauseBtn) playPauseBtn.removeEventListener('click', onPlayPause, true);
              if (songMediaEl) songMediaEl.removeEventListener('click', onPlayPause, true);
              document.removeEventListener('keydown', onKeyDown, true);
              if (localAudio) localAudio.removeEventListener('ended', onEnded);
              if (volumeSlider) volumeSlider.removeEventListener('value-change', onVolumeChange);
              window.ipcRenderer.removeListener('ytmd:update-volume', onIpcVolume);
              // Restore YTM video - remove our play/src overrides. Use the captured
              // `ytVideo` reference from patch time (never re-query, the element may
              // have been re-rendered) and defer the prototype restoration via
              // queueMicrotask so any in-flight assignment on the overridden setter
              // settles before we delete the instance properties.
              if (ytVideo) {
                const v = ytVideo;
                queueMicrotask(() => {
                  delete (v as any).play; // remove instance override, restore prototype
                  delete (v as any).src;  // remove src override
                  v.muted = false;
                });
              }
              // Restore original elements
              if (origTimeInfo) origTimeInfo.style.display = '';
              if (customTime) customTime.style.display = 'none';
              if (customProgress) customProgress.style.display = 'none';
              if (origSliderBar) origSliderBar.style.opacity = '';
              if (origKnobContainer) origKnobContainer.style.opacity = '';
              const ct = document.getElementById('ytmd-local-thumb');
              if (ct) ct.style.display = 'none';
              const mc = document.getElementById('ytmd-local-main-cover');
              if (mc) mc.style.display = 'none';
              // Restore side panel
              sidePanelOrigChildren.forEach(({ el, display }) => el.style.display = display);
              const lsp = document.getElementById('ytmd-local-side-panel');
              if (lsp) lsp.style.display = 'none';
              (window as any).__ytmdLocalCleanup = null;
            };
            (window as any).__ytmdLocalCleanup = cleanup;
    };

    miniGuideItems.appendChild(playlistsEntry);
    miniGuideItems.appendChild(downloadsEntry);
  };

  // Re-inject if Polymer removes them
  const ensureCustomEntries = () => {
    if (!document.querySelector('#mini-guide .ytmd-custom-entry')) {
      addCustomEntries();
    }
  };

  // Force sidebar permanently collapsed
  const forceCollapse = () => {
    // Always add the collapsed class
    document.body.classList.add('ytmd-sidebar-collapsed');

    // Force collapse attributes on the layout
    const appLayout = document.querySelector('ytmusic-app-layout');
    if (appLayout) {
      appLayout.setAttribute('is-bauhaus-sidenav-collapsed', '');
      appLayout.setAttribute('guide-collapsed', '');
    }

    const guide = document.querySelector('ytmusic-guide-renderer') as HTMLElement | null;
    if (guide) {
      guide.setAttribute('collapsed', '');
    }

    // Add or re-inject custom entries (only when sidebar is on-screen)
    ensureCustomEntries();
  };

  // Hide "Téléchargés" and "Ajouts" tabs from the library page
  const hideLibraryTabs = () => {
    const tabs = document.querySelectorAll<HTMLElement>('ytmusic-tabs yt-formatted-string.tab');
    tabs.forEach((tab) => {
      const text = tab.textContent?.trim().toLowerCase() || '';
      if (/^(t[ée]l[ée]charg[ée]s|downloads|offline)$/i.test(text) ||
          /^(ajouts|uploads)$/i.test(text)) {
        tab.style.display = 'none';
      }
    });
  };

  const tryApply = () => {
    applyIcons();
    forceCollapse();
    hideLibraryTabs();
    // Keep original icons hidden
    document.querySelectorAll('ytmusic-guide-entry-renderer').forEach((entry) => {
      if (entry.querySelector('.ytmd-nav-icon')) {
        const origIcon = entry.querySelector('yt-icon:not(.ytmd-nav-icon yt-icon), iron-icon') as HTMLElement | null;
        if (origIcon) origIcon.style.display = 'none';
      }
    });
  };

  // Initial application
  let attempts = 0;
  const initialApply = () => {
    attempts++;
    if (!applyIcons() && attempts < 10) {
      setTimeout(initialApply, 1000);
    } else {
      forceCollapse();

      // Watch for sidebar mutations and re-apply (debounced)
      let guideDebounce: ReturnType<typeof setTimeout> | null = null;
      const guide = document.querySelector('ytmusic-guide-renderer, ytmusic-app-layout');
      if (guide) {
        const guideObserver = new MutationObserver(() => {
          if (guideDebounce) clearTimeout(guideDebounce);
          guideDebounce = setTimeout(tryApply, 150);
        });
        guideObserver.observe(guide, { childList: true, subtree: true, attributes: true });
      }

      // Watch for page content changes to hide library chips on navigation.
      // Debounced + gated on addedNodes so large libraries don't trigger
      // hideLibraryTabs() (a full querySelectorAll) on every micro-mutation.
      const contentPage = document.querySelector('#content-page, ytmusic-browse-response, ytmusic-app');
      if (contentPage) {
        let contentDebounce: ReturnType<typeof setTimeout> | null = null;
        const contentObserver = new MutationObserver((mutations) => {
          if (!mutations.some((m) => m.addedNodes.length > 0)) return;
          if (contentDebounce) clearTimeout(contentDebounce);
          contentDebounce = setTimeout(hideLibraryTabs, 150);
        });
        contentObserver.observe(contentPage, { childList: true, subtree: true });
      }

      // Safety net only: the guideObserver above already re-collapses on every
      // mutation. This low-frequency interval just catches anything it misses,
      // and does nothing while the sidebar is already collapsed (no per-tick
      // DOM thrashing like the previous unconditional 250ms loop).
      setInterval(() => {
        const layout = document.querySelector('ytmusic-app-layout');
        const collapsed =
          document.body.classList.contains('ytmd-sidebar-collapsed') &&
          (!layout || layout.hasAttribute('guide-collapsed'));
        if (!collapsed) forceCollapse();
      }, 1000);

    }
  };

  // Bind the local-file play handler exactly once. addCustomEntries() can run
  // repeatedly when Polymer re-creates the sidebar, which previously stacked a
  // duplicate 'ytmd-play-local' listener on each re-injection.
  if (!(window as any).__ytmdLocalPlayBound) {
    (window as any).__ytmdLocalPlayBound = true;
    document.addEventListener('ytmd-play-local', (e: Event) => {
      const f = (e as CustomEvent).detail;
      if (!f?.path) return;
      if ((window as any).__ytmdPlayLocalFile) {
        (window as any).__ytmdPlayLocalFile(f);
      }
    });
  }

  // Kick off the icon/sidebar setup as soon as the guide exists, rather than
  // betting on a fixed 1s delay (which fails on slow boots). `initialApply`
  // keeps its own bounded retry for the icon DOM.
  void waitForElement('ytmusic-guide-renderer, ytmusic-app-layout').then(() => {
    initialApply();
  });

  // Fix ghost song-media-window: collapse when player enters mini mode.
  // PiP-aware: never collapse while the video is in Picture-in-Picture, otherwise
  // the collapsed (height:0 / visibility:hidden) container would break/blacken the
  // PiP source, since the <video> lives inside #song-media-window. The manual PiP
  // toggle is owned by the dedicated `picture-in-picture` plugin.
  //
  // The observers are installed on the player elements present at setup time.
  // Because YTM can re-render the player subtree on SPA navigation (detaching
  // those nodes), we keep the install logic in a function and re-run it whenever
  // a stable ancestor reports the player nodes (re)appearing.
  const playerStateObservers: MutationObserver[] = [];
  let ghostVideoRef: HTMLVideoElement | null = null;
  let ghostRefresh: (() => void) | null = null;

  const installGhostFix = () => {
    const smw = document.querySelector<HTMLElement>('#song-media-window');
    if (!smw) return false;

    // Watch both ytmusic-player and ytmusic-player-page for state changes
    const targets = [
      document.querySelector('ytmusic-player'),
      document.querySelector('ytmusic-player-page'),
    ].filter(Boolean) as Element[];
    if (targets.length === 0) return false;

    // Tear down any previously installed observers/listeners before re-attaching
    // to the fresh nodes (avoids stacking duplicates after a re-render).
    for (const obs of playerStateObservers.splice(0)) obs.disconnect();
    if (ghostVideoRef && ghostRefresh) {
      ghostVideoRef.removeEventListener('enterpictureinpicture', ghostRefresh);
      ghostVideoRef.removeEventListener('leavepictureinpicture', ghostRefresh);
    }

    const isMiniplayer = () =>
      targets.some((el) => {
        const state =
          el.getAttribute('player-ui-state') ||
          el.getAttribute('player-ui-state_') ||
          '';
        return state === 'MINIPLAYER';
      });

    const refresh = () => {
      if (isMiniplayer() && !document.pictureInPictureElement) {
        smw.classList.add('ytmd-ghost-collapsed');
      } else {
        smw.classList.remove('ytmd-ghost-collapsed');
      }
    };
    ghostRefresh = refresh;

    refresh(); // initial check
    for (const el of targets) {
      const obs = new MutationObserver(refresh);
      obs.observe(el, {
        attributeFilter: ['player-ui-state', 'player-ui-state_'],
      });
      playerStateObservers.push(obs);
    }

    // Re-evaluate when entering/leaving Picture-in-Picture so the collapse never
    // hides a video that is currently floating in a PiP window.
    ghostVideoRef = document.querySelector<HTMLVideoElement>('video');
    ghostVideoRef?.addEventListener('enterpictureinpicture', refresh);
    ghostVideoRef?.addEventListener('leavepictureinpicture', refresh);
    return true;
  };

  void waitForElement('#song-media-window').then(() => {
    installGhostFix();

    // Re-install after SPA re-renders that swap the player subtree. Observe a
    // stable ancestor (ytmusic-app / app-layout) and, debounced, re-run the
    // installer if our observed targets were detached.
    const stableRoot =
      document.querySelector('ytmusic-app') ||
      document.querySelector('ytmusic-app-layout') ||
      document.documentElement;
    let reinstallDebounce: ReturnType<typeof setTimeout> | null = null;
    const reinstallObserver = new MutationObserver(() => {
      if (reinstallDebounce) clearTimeout(reinstallDebounce);
      reinstallDebounce = setTimeout(() => {
        // Only re-install if a current player node is no longer being observed
        // (cheap check: re-run install which tears down + re-attaches).
        if (document.querySelector('#song-media-window')) installGhostFix();
      }, 250);
    });
    reinstallObserver.observe(stableRoot, { childList: true, subtree: true });
  });

}

async function onApiLoaded() {
  // Workaround for macOS traffic lights
  {
    let osType = 'Unknown';
    if (window.electronIs.osx()) {
      osType = 'Macintosh';
    } else if (window.electronIs.windows()) {
      osType = 'Windows';
    } else if (window.electronIs.linux()) {
      osType = 'Linux';
    }
    document.documentElement.setAttribute('data-os', osType);
  }

  // Workaround for #2459
  document
    .querySelector('button.video-button.ytmusic-av-toggle')
    ?.addEventListener('click', () =>
      window.dispatchEvent(new Event('resize')),
    );

  window.ipcRenderer.on('ytmd:previous-video', () => {
    document
      .querySelector<HTMLElement>('.previous-button.ytmusic-player-bar')
      ?.click();
  });
  window.ipcRenderer.on('ytmd:next-video', () => {
    document
      .querySelector<HTMLElement>('.next-button.ytmusic-player-bar')
      ?.click();
  });
  window.ipcRenderer.on('ytmd:play', (_) => {
    api?.playVideo();
  });
  window.ipcRenderer.on('ytmd:pause', (_) => {
    api?.pauseVideo();
  });
  window.ipcRenderer.on('ytmd:toggle-play', (_) => {
    if (api?.getPlayerState() === 2) api?.playVideo();
    else api?.pauseVideo();
  });
  window.ipcRenderer.on('ytmd:seek-to', (_, t: number) => api!.seekTo(t));
  window.ipcRenderer.on('ytmd:seek-by', (_, t: number) => api!.seekBy(t));
  window.ipcRenderer.on('ytmd:shuffle', () => {
    document
      .querySelector<
        HTMLElement & { queue: { shuffle: () => void } }
      >('ytmusic-player-bar')
      ?.queue.shuffle();
  });

  const isShuffled = () => {
    const isShuffled =
      document
        .querySelector<HTMLElement>('ytmusic-player-bar')
        ?.attributes.getNamedItem('shuffle-on') ?? null;

    return isShuffled !== null;
  };

  window.ipcRenderer.on('ytmd:get-shuffle', () => {
    window.ipcRenderer.send('ytmd:get-shuffle-response', isShuffled());
  });

  window.ipcRenderer.on(
    'ytmd:update-like',
    (_, status: 'LIKE' | 'DISLIKE' = 'LIKE') => {
      document
        .querySelector<
          HTMLElement & { updateLikeStatus: (status: string) => void }
        >('#like-button-renderer')
        ?.updateLikeStatus(status);
    },
  );
  window.ipcRenderer.on('ytmd:switch-repeat', (_, repeat = 1) => {
    for (let i = 0; i < repeat; i++) {
      document
        .querySelector<
          HTMLElement & { onRepeatButtonClick: () => void }
        >('ytmusic-player-bar')
        ?.onRepeatButtonClick();
    }
  });
  window.ipcRenderer.on('ytmd:update-volume', (_, volume: number) => {
    document
      .querySelector<
        HTMLElement & { updateVolume: (volume: number) => void }
      >('ytmusic-player-bar')
      ?.updateVolume(volume);
  });

  const isFullscreen = () => {
    const isFullscreen =
      document
        .querySelector<HTMLElement>('ytmusic-player-bar')
        ?.attributes.getNamedItem('player-fullscreened') ?? null;

    return isFullscreen !== null;
  };

  const clickFullscreenButton = (isFullscreenValue: boolean) => {
    const fullscreen = isFullscreen();
    if (isFullscreenValue === fullscreen) {
      return;
    }

    if (fullscreen) {
      document.querySelector<HTMLElement>('.exit-fullscreen-button')?.click();
    } else {
      document.querySelector<HTMLElement>('.fullscreen-button')?.click();
    }
  };

  window.ipcRenderer.on('ytmd:get-fullscreen', () => {
    window.ipcRenderer.send('ytmd:set-fullscreen', isFullscreen());
  });

  window.ipcRenderer.on(
    'ytmd:click-fullscreen-button',
    (_, fullscreen: boolean | undefined) => {
      clickFullscreenButton(fullscreen ?? false);
    },
  );

  window.ipcRenderer.on('ytmd:toggle-mute', (_) => {
    document
      .querySelector<
        HTMLElement & { onVolumeClick: () => void }
      >('ytmusic-player-bar')
      ?.onVolumeClick();
  });

  window.ipcRenderer.on('ytmd:get-queue', () => {
    try {
      const queue = document.querySelector<QueueElement>('#queue');
      window.ipcRenderer.send('ytmd:get-queue-response', {
        items: queue?.queue?.getItems?.(),
        autoPlaying: queue?.queue?.autoPlaying,
        continuation: queue?.queue?.continuation,
      } satisfies QueueResponse);
    } catch (err) {
      console.error('[Atom] ytmd:get-queue failed:', err);
    }
  });

  window.ipcRenderer.on(
    'ytmd:add-to-queue',
    (_, videoId: string, queueInsertPosition: string) => {
      try {
      const queue = document.querySelector<QueueElement>('#queue');
      const app = document.querySelector<YouTubeMusicAppElement>('ytmusic-app');
      if (!app?.networkManager) return;

      const store = queue?.queue?.store?.store;
      if (!store) return;

      app.networkManager
        .fetch('/music/get_queue', {
          queueContextParams: store.getState().queue.queueContextParams,
          queueInsertPosition,
          videoIds: [videoId],
        })
        .then((result) => {
          if (
            result &&
            typeof result === 'object' &&
            'queueDatas' in result &&
            Array.isArray(result.queueDatas)
          ) {
            const queueItems = store.getState().queue.items;
            const queueItemsLength = queueItems.length ?? 0;
            queue?.dispatch({
              type: 'ADD_ITEMS',
              payload: {
                nextQueueItemId: store.getState().queue.nextQueueItemId,
                index:
                  queueInsertPosition === 'INSERT_AFTER_CURRENT_VIDEO'
                    ? queueItems.findIndex(
                        (it) =>
                          (
                            it.playlistPanelVideoRenderer ||
                            it.playlistPanelVideoWrapperRenderer
                              ?.primaryRenderer.playlistPanelVideoRenderer
                          )?.selected,
                      ) + 1 || queueItemsLength
                    : queueItemsLength,
                items: result.queueDatas
                  .map((it) =>
                    typeof it === 'object' && it && 'content' in it
                      ? it.content
                      : null,
                  )
                  .filter(Boolean),
                shuffleEnabled: false,
                shouldAssignIds: true,
              },
            });
          }
        })
        .catch((err) => {
          console.error('[Atom] ytmd:add-to-queue fetch failed:', err);
        });
      } catch (err) {
        console.error('[Atom] ytmd:add-to-queue failed:', err);
      }
    },
  );
  window.ipcRenderer.on(
    'ytmd:move-in-queue',
    (_, fromIndex: number, toIndex: number) => {
      const queue = document.querySelector<QueueElement>('#queue');
      queue?.dispatch({
        type: 'MOVE_ITEM',
        payload: {
          fromIndex,
          toIndex,
        },
      });
    },
  );
  window.ipcRenderer.on('ytmd:remove-from-queue', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'REMOVE_ITEM',
      payload: index,
    });
  });
  window.ipcRenderer.on('ytmd:set-queue-index', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'SET_INDEX',
      payload: index,
    });
  });
  window.ipcRenderer.on('ytmd:clear-queue', () => {
    try {
      const queue = document.querySelector<QueueElement>('#queue');
      queue?.queue?.store?.store?.dispatch({
        type: 'SET_PLAYER_PAGE_INFO',
        payload: { open: false },
      });
      queue?.dispatch({
        type: 'CLEAR',
      });
    } catch (err) {
      console.error('[Atom] ytmd:clear-queue failed:', err);
    }
  });

  window.ipcRenderer.on(
    'ytmd:search',
    async (_, query: string, params?: string, continuation?: string) => {
      try {
        const app = document.querySelector<YouTubeMusicAppElement>('ytmusic-app');
        const searchBox =
          document.querySelector<SearchBoxElement>('ytmusic-search-box');

        if (!app?.networkManager || !searchBox) return;

        const result = await app.networkManager.fetch<
          unknown,
          {
            query: string;
            params?: string;
            continuation?: string;
            suggestStats?: unknown;
          }
        >('/search', {
          query,
          params,
          continuation,
          suggestStats: searchBox.getSearchboxStats?.(),
        });

        window.ipcRenderer.send('ytmd:search-results', result);
      } catch (err) {
        console.error('[Atom] ytmd:search failed:', err);
      }
    },
  );

  const video = document.querySelector('video')!;
  const audioContext = new AudioContext();
  const audioSource = audioContext.createMediaElementSource(video);
  audioSource.connect(audioContext.destination);

  for (const [id, plugin] of Object.entries(getAllLoadedRendererPlugins())) {
    if (typeof plugin.renderer !== 'function') {
      await plugin.renderer?.onPlayerApiReady?.call(
        plugin.renderer,
        api!,
        createContext(id),
      );
    }
  }

  if (firstDataLoaded) {
    document.dispatchEvent(
      new CustomEvent('videodatachange', { detail: { name: 'dataloaded' } }),
    );
  }

  const audioCanPlayEventDispatcher = () => {
    document.dispatchEvent(
      new CustomEvent('ytmd:audio-can-play', {
        detail: {
          audioContext,
          audioSource,
        },
      }),
    );
  };

  const loadstartListener = () => {
    // Emit "audioCanPlay" for each video
    video.addEventListener('canplaythrough', audioCanPlayEventDispatcher, {
      once: true,
    });
  };

  if (video.readyState === 4 /* HAVE_ENOUGH_DATA (loaded) */) {
    audioCanPlayEventDispatcher();
  }

  video.addEventListener('loadstart', loadstartListener, { passive: true });

  window.ipcRenderer.send('ytmd:player-api-loaded');

  // Navigate to "Starting page"
  const startingPage: string = window.mainConfig.get('options.startingPage');
  if (startingPage && startingPages[startingPage]) {
    document
      .querySelector<YouTubeMusicAppElement>('ytmusic-app')
      ?.navigate(startingPages[startingPage]);
  }

  // Remove upgrade button
  if (window.mainConfig.get('options.removeUpgradeButton')) {
    const itemsSelector = 'ytmusic-guide-section-renderer #items';
    let selector = 'ytmusic-guide-entry-renderer:last-child';

    const upgradeBtnIcon = document.querySelector<SVGGElement>(
      'iron-iconset-svg[name="yt-sys-icons"] #youtube_music_monochrome',
    );
    if (upgradeBtnIcon) {
      const path = upgradeBtnIcon.firstChild as SVGPathElement;
      const data = path.getAttribute('d')!.substring(0, 15);
      selector = `ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="${data}"])`;
    }

    const styles = document.createElement('style');
    styles.textContent = `${itemsSelector} ${selector} { display: none; }`;

    document.head.appendChild(styles);
  }

  // Replace navigation tab icons with modern Apple-inspired designs
  replaceNavIcons();

  // Smooth page transitions: re-trigger fade-in animation on navigation
  (() => {
    const contentPage = document.querySelector('#content-page, #contents-wrapper, ytmusic-app #content');
    if (!contentPage) return;

    const replayAnimations = () => {
      const targets = contentPage.querySelectorAll<HTMLElement>(
        'ytmusic-browse-response, ytmusic-section-list-renderer, ytmusic-shelf-renderer, ' +
        'ytmusic-item-section-renderer, ytmusic-tab-renderer, ytmusic-library-landing-page, ' +
        'ytmusic-grid-renderer, ytmusic-immersive-carousel-renderer'
      );
      targets.forEach((el) => {
        el.style.animation = 'none';
        // Force reflow then re-apply
        void el.offsetHeight;
        el.style.animation = '';
      });
    };

    // All three observers funnel through a single debounced scheduler so a burst
    // of mutations (common on large libraries) collapses into one rAF-driven
    // replay instead of forcing a reflow-per-element on every micro-mutation.
    let replayDebounce: ReturnType<typeof setTimeout> | null = null;
    const scheduleReplay = () => {
      if (replayDebounce) clearTimeout(replayDebounce);
      replayDebounce = setTimeout(() => {
        requestAnimationFrame(replayAnimations);
      }, 120);
    };
    const onMutations = (mutations: MutationRecord[]) => {
      if (mutations.some((m) => m.addedNodes.length > 0)) scheduleReplay();
    };

    // Refs kept so the observers can be disconnected if ever needed.
    const animObservers: MutationObserver[] = [];

    const pageObserver = new MutationObserver(onMutations);
    pageObserver.observe(contentPage, { childList: true, subtree: false });
    animObservers.push(pageObserver);

    // Also watch the app element for page-type changes
    const app = document.querySelector('ytmusic-app');
    if (app) {
      const appObserver = new MutationObserver(onMutations);
      appObserver.observe(app, { childList: true, subtree: false });
      animObservers.push(appObserver);
    }

    // Watch browse-response swap (deeper)
    const browseWrapper = document.querySelector('#content-page') || contentPage;
    const deepObserver = new MutationObserver(onMutations);
    deepObserver.observe(browseWrapper, { childList: true, subtree: true });
    animObservers.push(deepObserver);
  })();

  // Hide / Force show like buttons
  const likeButtonsOptions: string = window.mainConfig.get(
    'options.likeButtons',
  );
  if (likeButtonsOptions) {
    const style = document.createElement('style');
    style.textContent = `
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls-buttons.ytmusic-player-bar, #like-button-renderer {
        display: ${likeButtonsOptions === 'hide' ? 'none' : 'inherit'} !important;
      }
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls.ytmusic-player-bar {
        justify-content: ${likeButtonsOptions === 'hide' ? 'flex-start' : 'space-between'} !important;
      }`;

    document.head.appendChild(style);
  }
}

/**
 * YouTube Music still using ES5, so we need to define custom elements using ES5 style
 */
const defineYTMDTransElements = () => {
  const YTMDTrans = function () {};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  YTMDTrans.prototype = Object.create(HTMLElement.prototype);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  YTMDTrans.prototype.connectedCallback = function () {
    const that = this as HTMLElement;
    const key = that.getAttribute('key');
    if (key) {
      const targetHtml = i18t(key);
      (that.innerHTML as string | TrustedHTML) = defaultTrustedTypePolicy
        ? defaultTrustedTypePolicy.createHTML(targetHtml)
        : targetHtml;
    }
  };
  customElements.define(
    'ytmd-trans',
    YTMDTrans as unknown as CustomElementConstructor,
  );
};

const preload = async () => {
  await loadI18n();
  await setLanguage(window.mainConfig.get('options.language') ?? 'en');
  window.i18n = {
    t: i18t.bind(i18next),
  };
  defineYTMDTransElements();
  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap';
  document.head.appendChild(fontLink);
  if (document.body?.dataset?.os) {
    document.body.dataset.os = navigator.userAgent;
  }
};

const main = async () => {
  await loadAllRendererPlugins();
  isPluginLoaded = true;

  window.ipcRenderer.on('plugin:unload', async (_event, id: string) => {
    await forceUnloadRendererPlugin(id);
  });
  window.ipcRenderer.on('plugin:enable', async (_event, id: string) => {
    await forceLoadRendererPlugin(id);
    if (api) {
      const plugin = getLoadedRendererPlugin(id);
      if (plugin && typeof plugin.renderer !== 'function') {
        await plugin.renderer?.onPlayerApiReady?.call(
          plugin.renderer,
          api,
          createContext(id),
        );
      }
    }
  });

  window.ipcRenderer.on(
    'config-changed',
    (_event, id: string, newConfig: PluginConfig) => {
      const plugin = getAllLoadedRendererPlugins()[id];
      if (plugin && typeof plugin.renderer !== 'function') {
        plugin.renderer?.onConfigChange?.call(plugin.renderer, newConfig);
      }
    },
  );

  // Wait for complete load of YouTube api
  await listenForApiLoad();

  // Blocks the "Are You Still There?" popup by setting the last active time to Date.now every 15min
  if (window.mainConfig.get('options.disableIdlePopup') !== false) {
    setInterval(() => (window._lact = Date.now()), 900_000);
  }

  // Setup back to front logger
  if (window.electronIs.dev()) {
    window.ipcRenderer.on('log', (_event, log: string) => {
      console.log(JSON.parse(log));
    });
  }
};

const initObserver = async () => {
  // check document.documentElement is ready
  await new Promise<void>((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => resolve(), {
        once: true,
      });
    } else {
      resolve();
    }
  });

  // Watches document root for #movie_player to appear, then disconnects immediately.
  // Broad scope is necessary since YouTube Music dynamically injects the player.
  const observer = new MutationObserver(() => {
    const playerApi = document.querySelector<Element & YoutubePlayer>(
      '#movie_player',
    );
    if (playerApi) {
      observer.disconnect();

      // Inject song-info provider
      setupSongInfo(playerApi);
      const dataLoadedListener = (name: string) => {
        if (!firstDataLoaded && name === 'dataloaded') {
          firstDataLoaded = true;
          playerApi.removeEventListener('videodatachange', dataLoadedListener);
        }
      };
      playerApi.addEventListener('videodatachange', dataLoadedListener);

      if (isPluginLoaded && !isApiLoaded) {
        api = playerApi;
        isApiLoaded = true;

        onApiLoaded();
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};

// ===== ABOUT POPUP — Liquid Glass =====
window.ipcRenderer.on('ytmd:show-about', () => {
  if (document.getElementById('ytmd-about-overlay')) return;

  // Inject animations
  if (!document.getElementById('ytmd-about-style')) {
    const style = document.createElement('style');
    style.id = 'ytmd-about-style';
    style.textContent = '@keyframes ytmd-about-fade-in{from{opacity:0}to{opacity:1}}@keyframes ytmd-about-scale-in{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}';
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.id = 'ytmd-about-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;animation:ytmd-about-fade-in 300ms cubic-bezier(0.16,1,0.3,1) both;';

  const card = document.createElement('div');
  card.style.cssText = 'background:rgba(30,30,30,0.55);backdrop-filter:blur(40px) saturate(180%);-webkit-backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:40px 48px;min-width:360px;max-width:420px;color:#fff;font-family:Satoshi,sans-serif;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,0.5),0 0 1px rgba(255,255,255,0.1) inset;animation:ytmd-about-scale-in 350ms cubic-bezier(0.34,1.56,0.64,1) both;';

  // Title
  const titleBlock = document.createElement('div');
  titleBlock.style.cssText = 'margin-bottom:24px;';
  const h = document.createElement('div');
  h.textContent = 'YouTube Music';
  h.style.cssText = 'font-size:28px;font-weight:700;letter-spacing:-0.03em;margin-bottom:4px;';
  const sub = document.createElement('div');
  sub.textContent = 'Revamp Edition \u2022 v4.0.2';
  sub.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.4);font-weight:500;';
  titleBlock.appendChild(h);
  titleBlock.appendChild(sub);
  card.appendChild(titleBlock);

  // Info block
  const infoBlock = document.createElement('div');
  infoBlock.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 20px;margin-bottom:20px;text-align:left;';
  const byLine = document.createElement('div');
  byLine.textContent = 'Revamp by @IsSlashy';
  byLine.style.cssText = 'font-size:15px;font-weight:600;color:#49f3f7;margin-bottom:8px;';
  infoBlock.appendChild(byLine);
  const details = document.createElement('div');
  details.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.6);line-height:1.6;';
  const lines: Array<[string, string, string?]> = [
    ['X:', ' @Slashy_fx', 'https://x.com/Slashy_fx'],
    ['Derni\u00e8re mise \u00e0 jour:', ' 21/06/2026'],
  ];
  lines.forEach(([label, val, href], i) => {
    const sp1 = document.createElement('span');
    sp1.textContent = label;
    sp1.style.color = 'rgba(255,255,255,0.35)';
    details.appendChild(sp1);
    if (href) {
      const a = document.createElement('a');
      a.textContent = val;
      a.style.cssText =
        'color:#49f3f7;text-decoration:none;cursor:pointer;transition:opacity 200ms;';
      a.addEventListener('click', () => {
        window.ipcRenderer.send('ytmd:open-url', href);
      });
      a.addEventListener('mouseenter', () => { a.style.opacity = '0.7'; });
      a.addEventListener('mouseleave', () => { a.style.opacity = '1'; });
      details.appendChild(a);
    } else {
      details.appendChild(document.createTextNode(val));
    }
    if (i < lines.length - 1) details.appendChild(document.createElement('br'));
  });
  infoBlock.appendChild(details);
  card.appendChild(infoBlock);

  // Credits block
  const creditsBlock = document.createElement('div');
  creditsBlock.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:14px 20px;margin-bottom:24px;text-align:left;';
  const credLabel = document.createElement('div');
  credLabel.textContent = 'Credits';
  credLabel.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.4);margin-bottom:4px;';
  creditsBlock.appendChild(credLabel);
  const link = document.createElement('a');
  link.textContent = 'Pear Desktop \u2014 GitHub';
  link.style.cssText = 'font-size:14px;font-weight:500;color:#49f3f7;text-decoration:none;cursor:pointer;transition:opacity 200ms;';
  link.addEventListener('click', () => { window.ipcRenderer.send('ytmd:open-url', 'https://github.com/pear-devs/pear-desktop'); });
  link.addEventListener('mouseenter', () => { link.style.opacity = '0.7'; });
  link.addEventListener('mouseleave', () => { link.style.opacity = '1'; });
  creditsBlock.appendChild(link);
  card.appendChild(creditsBlock);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Fermer';
  closeBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-family:Satoshi,sans-serif;font-size:14px;font-weight:500;padding:10px 32px;cursor:pointer;transition:background 200ms,transform 150ms;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(255,255,255,0.14)'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'rgba(255,255,255,0.08)'; });
  closeBtn.addEventListener('mousedown', () => { closeBtn.style.transform = 'scale(0.95)'; });
  closeBtn.addEventListener('mouseup', () => { closeBtn.style.transform = ''; });
  closeBtn.addEventListener('click', () => overlay.remove());
  card.appendChild(closeBtn);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);
});

initObserver().then(preload).then(main);
