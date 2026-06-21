import { borderRadius, colors, typography, transitions, glass, zIndex } from './tokens';

/**
 * Global styles overriding YouTube Music defaults.
 * Imported as a CSS string and injected via injectCSS.
 */
export const globalStyles = `
/**
 * Overriding YouTube Music style
 */

/* Allow window dragging */
ytmusic-nav-bar {
  position: relative;
}
ytmusic-nav-bar::before {
  content: '';
  position: absolute;
  inset: 0;

  -webkit-user-select: none;
  -webkit-app-region: drag;
}

ytmusic-nav-bar > .left-content > *,
ytmusic-nav-bar > .center-content > *,
ytmusic-nav-bar > .right-content > * {
  -webkit-app-region: no-drag;
}

iron-icon,
ytmusic-pivot-bar-item-renderer,
.tab-title,
a {
  -webkit-app-region: no-drag;
}

/* custom style for navbar */
ytmusic-app-layout {
  --ytmusic-nav-bar-height: 90px;
}

/* Disable Image Selection */
img {
  -webkit-user-select: none;
  user-select: none;
}

/* Hide cast button which doesn't work */
ytmusic-cast-button {
  display: none !important;
}

/* Remove useless inaccessible button on top-right corner of the video player */
.ytp-chrome-top-buttons {
  display: none !important;
}

/* Make youtube-music logo un-draggable */
ytmusic-nav-bar > div.left-content > a,
ytmusic-nav-bar > div.left-content > a > picture > img {
  -webkit-user-drag: none;
}

/* yt-music bugs */
tp-yt-paper-item.ytmusic-guide-entry-renderer::before {
  border-radius: ${borderRadius.md} !important;
}

/* fix video player align */
#av-id {
  padding-bottom: 0;
}

#av-id ~ #player.ytmusic-player-page:not([player-ui-state='FULLSCREEN']) {
  margin-top: auto !important;
  margin-bottom: auto !important;
  margin-left: var(--ytmusic-player-page-vertical-padding);
  margin-right: var(--ytmusic-player-page-vertical-padding);
  max-height: calc(100% - (var(--ytmusic-player-page-vertical-padding) * 2));
  max-width: calc(100% - var(--ytmusic-player-page-vertical-padding) * 2);
}

/* macos traffic lights fix */
:where([data-os*='Macintosh']) ytmusic-app-layout#layout ytmusic-nav-bar {
  padding-top: var(--ytmusic-nav-bar-offset, 0);
}
:where([data-os*='Macintosh']) ytmusic-app-layout#layout {
  --ytmusic-nav-bar-offset: 24px;
  --ytmusic-nav-bar-height: calc(90px + var(--ytmusic-nav-bar-offset, 0));
}

tp-yt-iron-dropdown,
tp-yt-paper-dialog {
  -webkit-app-region: no-drag;
}

/* Liquid glass player bar */
ytmusic-player-bar {
  background: rgba(0, 0, 0, 0.45) !important;
  backdrop-filter: blur(30px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(30px) saturate(180%) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
}

ytmusic-player-bar #player-bar-background {
  background: transparent !important;
}

/* ---- Play/Pause button — prominent glass circle ---- */
ytmusic-player-bar #play-pause-button {
  background: rgba(255, 255, 255, 0.1) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: ${borderRadius.round} !important;
  backdrop-filter: blur(12px) saturate(140%) !important;
  -webkit-backdrop-filter: blur(12px) saturate(140%) !important;
  color: ${colors.white} !important;
  transition: background ${transitions.normal} ${transitions.smoothOut},
              border-color ${transitions.normal} ${transitions.smoothOut},
              transform ${transitions.fast} ${transitions.smoothOut} !important;
}

ytmusic-player-bar #play-pause-button:hover {
  background: rgba(255, 255, 255, 0.18) !important;
  border-color: ${colors.glassBorderHover} !important;
  transform: scale(1.08) !important;
}

ytmusic-player-bar #play-pause-button:active {
  transform: scale(0.95) !important;
}

/* ---- Previous / Next buttons — subtle glass circles ---- */
ytmusic-player-bar .previous-button,
ytmusic-player-bar .next-button {
  background: rgba(255, 255, 255, 0.04) !important;
  border: 1px solid ${colors.sidebarItemHover} !important;
  border-radius: ${borderRadius.round} !important;
  backdrop-filter: blur(12px) saturate(140%) !important;
  -webkit-backdrop-filter: blur(12px) saturate(140%) !important;
  color: ${colors.textSecondary} !important;
  transition: background ${transitions.normal} ${transitions.smoothOut},
              border-color ${transitions.normal} ${transitions.smoothOut},
              color ${transitions.normal} ${transitions.smoothOut},
              transform ${transitions.fast} ${transitions.smoothOut} !important;
}

ytmusic-player-bar .previous-button:hover,
ytmusic-player-bar .next-button:hover {
  background: ${colors.sidebarItemActive} !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  color: ${colors.white} !important;
}

ytmusic-player-bar .previous-button:active,
ytmusic-player-bar .next-button:active {
  transform: scale(0.90) !important;
}

/* ---- Like / Dislike buttons — soft glass circles ---- */
ytmusic-player-bar ytmusic-like-button-renderer tp-yt-paper-icon-button {
  background: rgba(255, 255, 255, 0.04) !important;
  border: 1px solid ${colors.sidebarItemHover} !important;
  border-radius: ${borderRadius.round} !important;
  color: ${colors.textTertiary} !important;
  transition: background ${transitions.normal} ${transitions.smoothOut},
              border-color ${transitions.normal} ${transitions.smoothOut},
              color ${transitions.normal} ${transitions.smoothOut},
              transform ${transitions.fast} ${transitions.smoothOut} !important;
}

ytmusic-player-bar ytmusic-like-button-renderer tp-yt-paper-icon-button:hover {
  background: ${colors.sidebarItemActive} !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  color: rgba(255, 255, 255, 0.9) !important;
}

ytmusic-player-bar ytmusic-like-button-renderer tp-yt-paper-icon-button:active {
  transform: scale(0.88) !important;
}

/* Like/Dislike active state — accent glow */
ytmusic-player-bar ytmusic-like-button-renderer tp-yt-paper-icon-button[aria-pressed="true"] {
  color: ${colors.accent} !important;
  border-color: rgba(73, 243, 247, 0.25) !important;
  background: rgba(73, 243, 247, 0.08) !important;
}

/* ---- Icon sizing inside player buttons ---- */
ytmusic-player-bar tp-yt-paper-icon-button yt-icon {
  width: 24px !important;
  height: 24px !important;
}

ytmusic-player-bar #play-pause-button yt-icon {
  width: 28px !important;
  height: 28px !important;
}

/* Responsive: narrow window adjustments */
@media (max-width: 600px) {
  ytmusic-app-layout {
    --ytmusic-nav-bar-height: 64px;
  }

  ytmusic-player-bar .middle-controls .content-info-wrapper {
    max-width: 120px;
  }

  ytmusic-player-bar .right-controls-buttons {
    gap: 0;
  }
}

@media (max-width: 400px) {
  ytmusic-player-bar .right-controls-buttons ytmusic-like-button-renderer {
    display: none;
  }
}

/* ========================================
   Modern Typography (Satoshi)
   ======================================== */

body,
ytmusic-app,
ytmusic-nav-bar,
ytmusic-pivot-bar-renderer,
ytmusic-pivot-bar-item-renderer,
ytmusic-guide-entry-renderer,
ytmusic-guide-section-renderer,
yt-formatted-string,
ytmusic-player-bar,
ytmusic-player-bar .title,
ytmusic-player-bar .byline,
.tab-title,
.guide-entry-title,
ytmusic-search-box #input,
tp-yt-paper-item {
  font-family: ${typography.fontFamily} !important;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

yt-formatted-string.title,
.title.ytmusic-player-bar,
ytmusic-responsive-list-item-renderer .title,
ytmusic-two-row-item-renderer .title {
  font-weight: ${typography.fontWeightSemibold} !important;
  letter-spacing: ${typography.letterSpacingTight};
}

yt-formatted-string.subtitle,
.byline.ytmusic-player-bar,
.subtitle {
  letter-spacing: ${typography.letterSpacingNormal};
}

/* ========================================
   Navigation Tabs (pill-shaped, glass)
   ======================================== */

/* Target both old element name and class-based selector */
ytmusic-pivot-bar-item-renderer,
.ytmusic-pivot-bar-renderer[tab-id] {
  border-radius: ${borderRadius.pill} !important;
  padding: 8px 16px !important;
  transition: color ${transitions.normal} ${transitions.smoothOut},
              background ${transitions.normal} ${transitions.smoothOut},
              transform ${transitions.fast} ${transitions.smoothOut} !important;
  text-transform: none !important;
  margin: 0 4px !important;
}

ytmusic-pivot-bar-item-renderer:hover,
.ytmusic-pivot-bar-renderer[tab-id]:hover {
  background: ${colors.sidebarItemHover} !important;
}

ytmusic-pivot-bar-item-renderer[selected],
ytmusic-pivot-bar-item-renderer.iron-selected,
.ytmusic-pivot-bar-renderer[tab-id][selected],
.ytmusic-pivot-bar-renderer[tab-id][aria-selected="true"] {
  background: ${colors.sidebarItemActive} !important;
  color: ${colors.white} !important;
  font-weight: ${typography.fontWeightSemibold} !important;
}

ytmusic-pivot-bar-item-renderer .tab-title,
.ytmusic-pivot-bar-renderer[tab-id] .tab-title {
  color: inherit !important;
}

ytmusic-pivot-bar-item-renderer[selected] .tab-title,
ytmusic-pivot-bar-item-renderer.iron-selected .tab-title,
.ytmusic-pivot-bar-renderer[tab-id][selected] .tab-title,
.ytmusic-pivot-bar-renderer[tab-id][aria-selected="true"] .tab-title {
  color: ${colors.white} !important;
}

/* Hide default tab underline indicator */
ytmusic-pivot-bar-item-renderer .tab-indicator,
ytmusic-pivot-bar-renderer #indicator {
  display: none !important;
}

/* Nav bar glass effect */
ytmusic-pivot-bar-renderer {
  backdrop-filter: ${glass.blurLight} !important;
  -webkit-backdrop-filter: ${glass.blurLight} !important;
}

/* ========================================
   Sidebar Modernization
   ======================================== */

ytmusic-guide-renderer {
  background: ${colors.glassBg} !important;
  backdrop-filter: ${glass.blurLight} !important;
  -webkit-backdrop-filter: ${glass.blurLight} !important;
  border-right: none !important;
  border: none !important;
  box-shadow: none !important;
}

ytmusic-guide-section-renderer > .header {
  text-transform: uppercase !important;
  font-size: ${typography.fontSizeXs} !important;
  font-weight: ${typography.fontWeightSemibold} !important;
  color: ${colors.textTertiary} !important;
  letter-spacing: ${typography.letterSpacingWide} !important;
  padding: 16px 16px 8px !important;
}

ytmusic-guide-entry-renderer tp-yt-paper-item {
  border-radius: ${borderRadius.lg} !important;
  margin: 2px 8px !important;
  padding: 8px 12px !important;
  transition: background ${transitions.slow} ${transitions.smoothOut},
              transform ${transitions.slow} ${transitions.smoothOut},
              width ${transitions.xslow} ${transitions.smoothOut},
              height ${transitions.xslow} ${transitions.smoothOut},
              padding ${transitions.xslow} ${transitions.smoothOut},
              margin ${transitions.xslow} ${transitions.smoothOut} !important;
}

ytmusic-guide-entry-renderer tp-yt-paper-item:hover {
  background: ${colors.sidebarItemHover} !important;
}

ytmusic-guide-entry-renderer tp-yt-paper-item:active {
  transform: scale(0.97) !important;
  transition: transform ${transitions.fast} ${transitions.easeOut} !important;
}

ytmusic-guide-entry-renderer[active] tp-yt-paper-item,
ytmusic-guide-entry-renderer.iron-selected tp-yt-paper-item {
  background: ${colors.sidebarItemActive} !important;
  color: ${colors.white} !important;
}

/* Thin scrollbar */
ytmusic-guide-renderer::-webkit-scrollbar {
  width: 4px;
}

ytmusic-guide-renderer::-webkit-scrollbar-thumb {
  background: ${colors.scrollbarThumb};
  border-radius: ${borderRadius.pill};
}

/* Rounded sidebar thumbnails */
ytmusic-guide-entry-renderer img {
  border-radius: ${borderRadius.md} !important;
}

/* Custom nav icon styling */
.ytmd-nav-icon {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  color: inherit;
  transition: transform ${transitions.slow} ${transitions.smoothOut};
}

.ytmd-nav-icon svg {
  width: 100%;
  height: 100%;
  transition: transform ${transitions.slow} ${transitions.smoothOut};
}

ytmusic-guide-entry-renderer tp-yt-paper-item:hover .ytmd-nav-icon svg {
  transform: scale(1.08);
}

/* ========================================
   Sidebar — Permanently Collapsed (Icon-only)
   ======================================== */

/* Hide the sidebar toggle/expand button */
ytmusic-guide-renderer #guide-header,
ytmusic-guide-renderer .toggle-button,
ytmusic-app-layout [data-toggle-guide],
#guide-button,
tp-yt-paper-icon-button.guide-icon {
  display: none !important;
}

/* Sidebar container: always narrow, clip horizontal only */
ytmusic-guide-renderer {
  overflow-x: hidden !important;
  overflow-y: visible !important;
  width: 56px !important;
  min-width: 56px !important;
  max-width: 56px !important;
}

/* Allow scroller to show all items including custom entries */
ytmusic-guide-section-renderer #items.scroller,
#mini-guide ytmusic-guide-section-renderer #items {
  max-height: none !important;
  height: auto !important;
  overflow: visible !important;
}

/* Ensure sections div doesn't clip */
ytmusic-guide-renderer #sections,
#mini-guide ytmusic-guide-renderer #sections {
  overflow: visible !important;
  height: auto !important;
}

/* Mini guide renderer: allow overflow for custom entries */
#mini-guide ytmusic-guide-renderer {
  overflow: visible !important;
}

/* Custom sidebar entries styling */
.ytmd-custom-entry {
  visibility: visible !important;
  opacity: 1 !important;
}
.ytmd-custom-entry.active {
  background: ${colors.sidebarItemActive} !important;
  color: ${colors.white} !important;
}
.ytmd-custom-entry:hover:not(.active) {
  background: ${colors.sidebarItemHover} !important;
}

#guide-wrapper,
ytmusic-app-layout #guide-wrapper {
  width: 56px !important;
  min-width: 56px !important;
  max-width: 56px !important;
  border: none !important;
  border-right: none !important;
  box-shadow: none !important;
  overflow: visible !important;
}

/* Items: icon-only centered squares */
ytmusic-guide-entry-renderer tp-yt-paper-item {
  justify-content: center !important;
  padding: 8px !important;
  margin: 2px auto !important;
  border-radius: ${borderRadius.lg} !important;
  width: 40px !important;
  height: 40px !important;
  min-height: unset !important;
  box-sizing: border-box !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  transition: background ${transitions.slow} ${transitions.smoothOut},
              transform ${transitions.slow} ${transitions.smoothOut} !important;
}

/* Hide all text in sidebar */
ytmusic-guide-entry-renderer yt-formatted-string,
ytmusic-guide-entry-renderer .guide-entry-title,
ytmusic-guide-entry-renderer .title,
ytmusic-guide-entry-renderer a > span,
ytmusic-guide-entry-renderer tp-yt-paper-item > :not(.ytmd-nav-icon):not(yt-icon):not(iron-icon):not(a) {
  display: none !important;
}

/* Section headers hidden */
ytmusic-guide-section-renderer > .header {
  display: none !important;
}

/* Sidebar hover */
ytmusic-guide-entry-renderer tp-yt-paper-item:hover {
  background: ${colors.sidebarItemHover} !important;
}

/* Sidebar selected item */
ytmusic-guide-entry-renderer[active] tp-yt-paper-item,
ytmusic-guide-entry-renderer.iron-selected tp-yt-paper-item {
  background: ${colors.sidebarItemActive} !important;
  border-radius: ${borderRadius.lg} !important;
}

/* Hide secondary sections (playlists list) — we use our own icons */
ytmusic-guide-section-renderer + ytmusic-guide-section-renderer {
  display: none !important;
}

/* Hide dividers inside sections */
ytmusic-guide-section-renderer #divider {
  display: none !important;
}

/* Custom sidebar entries (playlists, downloads) */
.ytmd-custom-entry {
  position: relative;
}
.ytmd-custom-entry::after {
  content: attr(title);
  position: absolute;
  left: 52px;
  top: 50%;
  transform: translateY(-50%);
  background: ${colors.glassBg};
  backdrop-filter: ${glass.blur};
  -webkit-backdrop-filter: ${glass.blur};
  border: 1px solid ${colors.glassBorder};
  border-radius: ${borderRadius.md};
  padding: 4px 10px;
  font-size: ${typography.fontSizeSm};
  font-family: ${typography.fontFamily};
  color: ${colors.white};
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity ${transitions.fast} ${transitions.easeOut};
  z-index: ${zIndex.dropdown};
}
.ytmd-custom-entry:hover::after {
  opacity: 1;
}

/* ========================================
   Content Area Polish
   ======================================== */

/* Smooth transitions for interactive elements */
a, button, tp-yt-paper-icon-button, yt-icon {
  transition: color ${transitions.normal} ${transitions.easeOut},
              background ${transitions.normal} ${transitions.easeOut},
              opacity ${transitions.normal} ${transitions.easeOut},
              transform ${transitions.fast} ${transitions.easeOut};
}

/* Card hover lift — gentle and smooth both ways */
ytmusic-two-row-item-renderer,
ytmusic-responsive-list-item-renderer {
  transition: transform ${transitions.xslow} ${transitions.smoothOut},
              box-shadow ${transitions.xslow} ${transitions.smoothOut} !important;
}

ytmusic-two-row-item-renderer:hover,
ytmusic-responsive-list-item-renderer:hover {
  transform: translateY(-2px);
}

/* Rounded album art */
ytmusic-two-row-item-renderer #thumbnail-container img,
ytmusic-responsive-list-item-renderer .image-wrapper img,
#song-image img {
  border-radius: ${borderRadius.lg} !important;
}

/* Context menus: glass effect */
tp-yt-paper-listbox,
tp-yt-iron-dropdown .dropdown-content {
  background: ${colors.glassBg} !important;
  backdrop-filter: ${glass.blur} !important;
  -webkit-backdrop-filter: ${glass.blur} !important;
  border-radius: ${borderRadius.lg} !important;
  border: 1px solid ${colors.glassBorder} !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4) !important;
}

/* ========================================
   Profile / Account Menu — Liquid Glass
   ======================================== */

/* Main popup container */
tp-yt-iron-dropdown.ytmusic-popup-container,
ytmusic-popup-container tp-yt-iron-dropdown {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* ==========================================
   Account / Profile dropdown — liquid glass
   ========================================== */

/* Dropdown container — transparent */
tp-yt-iron-dropdown #contentWrapper {
  background: transparent !important;
  box-shadow: none !important;
  border: none !important;
}

/* The multi-page-menu wrapper */
ytmusic-multi-page-menu {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* Main menu renderer — glass panel */
ytmusic-multi-page-menu-renderer {
  background: rgba(20, 20, 20, 0.65) !important;
  backdrop-filter: blur(40px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(40px) saturate(180%) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: ${borderRadius.xl} !important;
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.08) inset !important;
  overflow: hidden !important;
}

/* Header (avatar, name, handle) */
ytmusic-multi-page-menu-renderer .ytmusicMultiPageMenuRendererHeader,
ytmusic-multi-page-menu-renderer #header {
  background: rgba(255, 255, 255, 0.03) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
  padding: 16px 20px !important;
}

/* Account name */
ytd-active-account-header-renderer #account-name {
  color: ${colors.white} !important;
  font-weight: ${typography.fontWeightSemibold} !important;
}

/* Handle (@username) */
ytd-active-account-header-renderer #channel-handle {
  color: ${colors.textTertiary} !important;
}

/* "Manage Google Account" link */
ytd-active-account-header-renderer #manage-account a {
  border-radius: ${borderRadius.pill} !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: ${colors.textSecondary} !important;
  transition: background ${transitions.normal} ${transitions.smoothOut},
              border-color ${transitions.normal} ${transitions.smoothOut} !important;
}

ytd-active-account-header-renderer #manage-account a:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: ${colors.glassBorderHover} !important;
}

/* Inner containers — transparent */
ytmusic-multi-page-menu-renderer #container,
ytmusic-multi-page-menu-renderer #sections,
yt-multi-page-menu-section-renderer,
yt-multi-page-menu-section-renderer #items {
  background: transparent !important;
}

/* Menu items (compact links) */
ytd-compact-link-renderer {
  background: transparent !important;
}

ytd-compact-link-renderer tp-yt-paper-item {
  color: ${colors.textSecondary} !important;
  transition: background ${transitions.normal} ${transitions.smoothOut},
              color ${transitions.normal} ${transitions.smoothOut} !important;
  margin: 0 8px !important;
  border-radius: ${borderRadius.md} !important;
  background: transparent !important;
}

ytd-compact-link-renderer tp-yt-paper-item:hover {
  background: rgba(255, 255, 255, 0.06) !important;
  color: ${colors.white} !important;
}

/* Menu icons */
ytd-compact-link-renderer yt-icon {
  color: rgba(255, 255, 255, 0.4) !important;
}

ytd-compact-link-renderer tp-yt-paper-item:hover yt-icon {
  color: rgba(255, 255, 255, 0.7) !important;
}

/* Avatar image */
ytd-active-account-header-renderer yt-img-shadow img {
  border-radius: ${borderRadius.round} !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}

/* Footer */
ytmusic-multi-page-menu-renderer .ytmusicMultiPageMenuRendererFooter,
ytmusic-multi-page-menu-renderer #footer {
  background: rgba(255, 255, 255, 0.02) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.06) !important;
}


/* Hide YouTube watermark / origin text on the video */
.ytp-watermark,
.ytp-chrome-top-buttons .ytp-watermark,
a.ytp-watermark,
.html5-watermark,
.ytp-title,
.ytp-title-text,
.ytp-chrome-top .ytp-title {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

/* Ghost block collapse class — applied via JS when mini player is active */
#song-media-window.ytmd-ghost-collapsed {
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  visibility: hidden !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* Player bar shadow */
ytmusic-player-bar {
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3) !important;
}

/* ========================================
   Search Box — Glass Pill
   ======================================== */

ytmusic-search-box {
  border-radius: ${borderRadius.pill} !important;
  overflow: hidden !important;
}

ytmusic-search-box #input {
  background: rgba(255, 255, 255, 0.06) !important;
  backdrop-filter: ${glass.blurLight} !important;
  -webkit-backdrop-filter: ${glass.blurLight} !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: ${borderRadius.pill} !important;
  padding-left: 16px !important;
  transition: background ${transitions.normal} ${transitions.easeOut},
              border-color ${transitions.normal} ${transitions.easeOut},
              box-shadow ${transitions.normal} ${transitions.easeOut} !important;
}

ytmusic-search-box #input:focus-within {
  background: ${colors.sidebarItemActive} !important;
  border-color: ${colors.glassBorderHover} !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 4px 16px rgba(0, 0, 0, 0.3) !important;
}

ytmusic-search-box #input input {
  font-family: ${typography.fontFamily} !important;
  padding-left: 8px !important;
}

ytmusic-search-box .search-icon {
  color: ${colors.textTertiary} !important;
  transition: color ${transitions.normal} ${transitions.easeOut} !important;
}

ytmusic-search-box #input:focus-within .search-icon {
  color: rgba(255, 255, 255, 0.8) !important;
}

/* ========================================
   Page Transition Animations
   ======================================== */

@keyframes ytmd-page-fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes ytmd-page-fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

/* Browse responses (main page content) — smooth fade-in on load */
ytmusic-browse-response,
ytmusic-section-list-renderer,
ytmusic-tabbed-search-results-renderer,
ytmusic-search-page,
ytmusic-library-page,
ytmusic-library-landing-page,
ytmusic-tab-renderer,
ytmusic-shelf-renderer,
ytmusic-item-section-renderer,
[page-type="MUSIC_PAGE_TYPE_LIBRARY_LANDING"],
[page-type="MUSIC_PAGE_TYPE_LIBRARY"],
ytmusic-immersive-carousel-renderer {
  animation: ytmd-page-fade-in 500ms ${transitions.smoothOut} both !important;
}

/* Page container smooth opacity */
#content-page,
ytmusic-browse-response,
#contents.ytmusic-section-list-renderer,
#contents.ytmusic-shelf-renderer,
#contents.ytmusic-item-section-renderer {
  transition: opacity 350ms ${transitions.smoothOut} !important;
}

/* Loading skeleton/spinner — smooth in and out */
ytmusic-detail-header-renderer,
ytmusic-immersive-header-renderer {
  animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both !important;
  animation-delay: 80ms !important;
}

/* Stagger items appearing for a cascading effect */
ytmusic-section-list-renderer > #contents > *:nth-child(1) {
  animation: ytmd-page-fade-in 450ms ${transitions.smoothOut} both !important;
  animation-delay: 0ms !important;
}
ytmusic-section-list-renderer > #contents > *:nth-child(2) {
  animation: ytmd-page-fade-in 450ms ${transitions.smoothOut} both !important;
  animation-delay: 60ms !important;
}
ytmusic-section-list-renderer > #contents > *:nth-child(3) {
  animation: ytmd-page-fade-in 450ms ${transitions.smoothOut} both !important;
  animation-delay: 120ms !important;
}
ytmusic-section-list-renderer > #contents > *:nth-child(4) {
  animation: ytmd-page-fade-in 450ms ${transitions.smoothOut} both !important;
  animation-delay: 180ms !important;
}
ytmusic-section-list-renderer > #contents > *:nth-child(5) {
  animation: ytmd-page-fade-in 450ms ${transitions.smoothOut} both !important;
  animation-delay: 240ms !important;
}
ytmusic-section-list-renderer > #contents > *:nth-child(n+6) {
  animation: ytmd-page-fade-in 450ms ${transitions.smoothOut} both !important;
  animation-delay: 300ms !important;
}

/* Shelf / Library items cascade */
ytmusic-shelf-renderer #contents > *:nth-child(1),
ytmusic-item-section-renderer #contents > *:nth-child(1) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both !important; animation-delay: 0ms !important; }
ytmusic-shelf-renderer #contents > *:nth-child(2),
ytmusic-item-section-renderer #contents > *:nth-child(2) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both !important; animation-delay: 50ms !important; }
ytmusic-shelf-renderer #contents > *:nth-child(3),
ytmusic-item-section-renderer #contents > *:nth-child(3) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both !important; animation-delay: 100ms !important; }
ytmusic-shelf-renderer #contents > *:nth-child(4),
ytmusic-item-section-renderer #contents > *:nth-child(4) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both !important; animation-delay: 150ms !important; }
ytmusic-shelf-renderer #contents > *:nth-child(n+5),
ytmusic-item-section-renderer #contents > *:nth-child(n+5) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both !important; animation-delay: 200ms !important; }

/* Grid items cascade */
ytmusic-grid-renderer #contents > *:nth-child(1) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both; animation-delay: 0ms; }
ytmusic-grid-renderer #contents > *:nth-child(2) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both; animation-delay: 40ms; }
ytmusic-grid-renderer #contents > *:nth-child(3) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both; animation-delay: 80ms; }
ytmusic-grid-renderer #contents > *:nth-child(4) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both; animation-delay: 120ms; }
ytmusic-grid-renderer #contents > *:nth-child(5) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both; animation-delay: 160ms; }
ytmusic-grid-renderer #contents > *:nth-child(n+6) { animation: ytmd-page-fade-in 400ms ${transitions.smoothOut} both; animation-delay: 200ms; }
`;

export default globalStyles;
