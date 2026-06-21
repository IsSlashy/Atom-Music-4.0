declare module 'keyboardevent-from-electron-accelerator' {
  /**
   * Convert an Electron accelerator string (e.g. "Ctrl+P") into a
   * KeyboardEvent-like object that can be compared against real events.
   */
  export function toKeyEvent(accelerator: string): KeyboardEvent;

  const _default: {
    toKeyEvent: typeof toKeyEvent;
  };
  export default _default;
}
