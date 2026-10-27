import { createContext } from 'solid-js';

export type MenuPanelContextValue = {
  // true inside a nested submenu, false inside a top-level menu panel
  isSubmenu: boolean;
  // closes this panel and gives the focus back to the item that opened it
  close: () => void;
  // closes every open panel, the focus goes back to the menu bar button
  closeAll: () => void;
};
export const MenuPanelContext = createContext<MenuPanelContextValue>();

// enabled items of a menu panel, separators excluded
const getMenuItems = (panel: Element | null | undefined) =>
  Array.from(panel?.children ?? []).filter(
    (it): it is HTMLElement =>
      it instanceof HTMLElement &&
      !!it.getAttribute('role')?.startsWith('menuitem') &&
      it.getAttribute('aria-disabled') !== 'true',
  );

export const focusMenuItem = (
  panel: Element | null | undefined,
  position: 'first' | 'last',
) => {
  const items = getMenuItems(panel);
  (position === 'first' ? items[0] : items[items.length - 1])?.focus();
};

// moves the focus to the next or previous enabled item, wrapping around
export const focusSiblingMenuItem = (item: HTMLElement, step: 1 | -1) => {
  const items = getMenuItems(item.parentElement);
  if (items.length === 0) return;

  const index = items.indexOf(item);
  const next =
    index === -1
      ? step === 1
        ? 0
        : items.length - 1
      : (index + step + items.length) % items.length;
  items[next].focus();
};
