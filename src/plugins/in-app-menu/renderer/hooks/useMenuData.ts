import type { Menu, MenuItem } from 'electron';
import type { Accessor } from 'solid-js';

const refreshMenuItem = async (originalMenu: Menu, commandId: number) => {
  const menuItem = (await window.ipcRenderer.invoke(
    'get-menu-by-id',
    commandId,
  )) as MenuItem | null;

  const newMenu = structuredClone(originalMenu);
  const stack = [...(newMenu?.items ?? [])];
  let now: MenuItem | undefined = stack.pop();
  while (now) {
    const index =
      now?.submenu?.items?.findIndex((it) => it.commandId === commandId) ?? -1;

    if (index >= 0) {
      if (menuItem) now?.submenu?.items?.splice(index, 1, menuItem);
      else now?.submenu?.items?.splice(index, 1);
    }
    if (now?.submenu) {
      stack.push(...now.submenu.items);
    }

    now = stack.pop();
  }

  return newMenu;
};

export function useMenuData(
  menu: Accessor<Menu | null>,
  setMenu: (m: Menu | null) => void,
) {
  const handleItemClick = async (
    commandId: number,
    radioGroup?: MenuItem[],
  ) => {
    const menuData = menu();
    if (!menuData) return;

    if (Array.isArray(radioGroup)) {
      let newMenu = menuData;
      for (const item of radioGroup) {
        newMenu = await refreshMenuItem(newMenu, item.commandId);
      }

      setMenu(newMenu);
      return;
    }

    setMenu(await refreshMenuItem(menuData, commandId));
  };

  return { handleItemClick };
}
