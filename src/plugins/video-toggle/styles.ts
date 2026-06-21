export const buttonSwitcherStyles = `
.video-toggle-custom-mode #main-panel.ytmusic-player-page {
  align-items: unset !important;
}

.video-toggle-custom-mode #main-panel {
  position: relative;
}

/* Force center the toggle container.
   The container itself is non-interactive (pointer-events: none) so the empty
   area never swallows player clicks/drags — only the inner button is clickable.
   Width is constrained so the absolutely-positioned overlay doesn't span the
   whole player on top of #song-video. */
#ytmd-video-toggle-switch-button-container {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: auto !important;
  display: flex !important;
  justify-content: center !important;
  z-index: var(--ytmd-video-toggle-z, 10);
  pointer-events: none;
}

/* Hide the switch while the player is minimized (MINIPLAYER) so it doesn't sit
   on top of the video and intercept the drag/move zone. */
ytmusic-player[player-ui-state='MINIPLAYER'] #ytmd-video-toggle-switch-button-container,
ytmusic-player[player-ui-state_='MINIPLAYER'] #ytmd-video-toggle-switch-button-container {
  display: none !important;
}

.video-toggle-custom-mode .video-switch-button {
  z-index: var(--ytmd-video-toggle-z, 10);
  box-sizing: border-box;
  padding: 0;
  margin-top: 16px;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 200px;
  overflow: hidden;
  width: 18rem;
  text-align: center;
  font-size: 14px;
  font-family: Satoshi, Avenir, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: rgba(255, 255, 255, 0.6);
  padding-right: 9rem;
  position: relative;
  pointer-events: all;
  transition: border-color 300ms cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.video-toggle-custom-mode .video-switch-button:hover {
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

.video-toggle-custom-mode .video-switch-button:before {
  content: attr(data-video-button-text);
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  pointer-events: none;
  transition: color 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.video-toggle-custom-mode .video-switch-button-checkbox {
  cursor: pointer;
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  z-index: 2;
}

.video-toggle-custom-mode .video-switch-button-label-span {
  position: relative;
  z-index: 3;
  transition: color 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.video-toggle-custom-mode
  .video-switch-button-checkbox:checked
  + .video-switch-button-label:before {
  transform: translateX(9rem);
  transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.video-toggle-custom-mode
  .video-switch-button-checkbox:not(:checked)
  ~ .video-switch-button-label .video-switch-button-label-span {
  color: #fff;
}

.video-toggle-custom-mode
  .video-switch-button-checkbox:checked
  ~ .video-switch-button-label .video-switch-button-label-span {
  color: rgba(255, 255, 255, 0.6);
}

.video-toggle-custom-mode
  .video-switch-button-checkbox:checked
  ~ .video-switch-button:before,
.video-toggle-custom-mode
  .video-switch-button-checkbox:checked
  + .video-switch-button-label
  ~ [data-video-button-text] {
  color: #fff;
}

.video-toggle-custom-mode
  .video-switch-button-checkbox
  + .video-switch-button-label {
  position: relative;
  padding: 12px 0;
  display: block;
  user-select: none;
  pointer-events: none;
}

.video-toggle-custom-mode
  .video-switch-button-checkbox
  + .video-switch-button-label:before {
  content: '';
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  height: 100%;
  width: 100%;
  position: absolute;
  left: 0;
  top: 0;
  border-radius: 200px;
  transform: translateX(0);
  transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* Ensure song-image fills the player area when in song mode */
.video-toggle-custom-mode #song-image {
  width: 100% !important;
  height: 100% !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: transparent !important;
}

.video-toggle-custom-mode #song-image yt-img-shadow {
  max-width: 100% !important;
  max-height: 100% !important;
}

.video-toggle-custom-mode #song-image yt-img-shadow img,
.video-toggle-custom-mode #song-image #img {
  object-fit: contain !important;
  max-width: 100% !important;
  max-height: 100% !important;
}

/* disable the native toggler */
.video-toggle-custom-mode #av-id {
  display: none;
}
`;

export const forceHideStyles = `
/* Hide the video player */
.video-toggle-force-hide #main-panel {
  display: none !important;
}

/* Make the side-panel full width */
.video-toggle-force-hide .side-panel.ytmusic-player-page {
  max-width: 100% !important;
  width: 100% !important;
  margin: 0 !important;
}
`;

export const pipButtonStyles = `
/* PiP toggle button in player bar */
#ytmd-pip-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
  padding: 4px;
  transition: background 0.2s;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 4px;
}

#ytmd-pip-button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

#ytmd-pip-button.active {
  color: #ff4e45;
}

#ytmd-pip-button svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
}
`;

export const styles = `${buttonSwitcherStyles}\n${forceHideStyles}\n${pipButtonStyles}`;

export default styles;
