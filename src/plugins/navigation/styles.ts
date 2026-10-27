export const styles = `
.ytmd-history-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  -webkit-app-region: no-drag;
}

/* Hidden on the search page at mini guide widths (see index.tsx), and in
   YTM's mobile web layout, which leaves no room next to the logo */
.ytmd-history-group[hidden],
ytmusic-app-layout[is-mweb-modernization-enabled] .ytmd-history-group {
  display: none;
}

.ytmd-history-button {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 50%;
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  -webkit-app-region: no-drag;
  transition: color 200ms cubic-bezier(0.16, 1, 0.3, 1),
              background 200ms cubic-bezier(0.16, 1, 0.3, 1),
              border-color 200ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}

.ytmd-history-button:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.12);
}

.ytmd-history-button:active:not(:disabled) {
  transform: scale(0.90);
}

.ytmd-history-button:focus-visible {
  outline: 2px solid #3ea6ff;
  outline-offset: 2px;
}

.ytmd-history-button:disabled {
  cursor: default;
  opacity: 0.35;
}

.ytmd-history-icon {
  display: block;
  width: 16px;
  height: 16px;
  fill: currentcolor;
  pointer-events: none;
}
`;

export default styles;
