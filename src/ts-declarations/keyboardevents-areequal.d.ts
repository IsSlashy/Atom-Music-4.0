declare module 'keyboardevents-areequal' {
  /**
   * Returns true when two (possibly partial) KeyboardEvents represent the same
   * key combination.
   */
  export default function keyEventAreEqual(
    a: Partial<KeyboardEvent>,
    b: Partial<KeyboardEvent>,
  ): boolean;
}
