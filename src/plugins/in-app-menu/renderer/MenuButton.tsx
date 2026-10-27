import { type JSX, splitProps } from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

const menuStyle = cacheNoArgs(
  () => css`
    -webkit-app-region: no-drag;

    display: flex;
    justify-content: center;
    align-items: center;
    align-self: stretch;
    /* the title bar collapses the menus when they do not fit, they never shrink */
    flex-shrink: 0;

    padding: 2px 8px;
    border-radius: 4px;

    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }
    &:active {
      scale: 0.9;
    }

    &[data-selected='true'] {
      background-color: rgba(255, 255, 255, 0.2);
    }

    &:focus-visible {
      outline: 2px solid #3ea6ff;
      outline-offset: -2px;
    }
  `,
);

export type MenuButtonProps = JSX.HTMLAttributes<HTMLLIElement> & {
  text?: string;
  selected?: boolean;
};
export const MenuButton = (props: MenuButtonProps) => {
  const [local, leftProps] = splitProps(props, ['text', 'onKeyDown']);

  const handleKeyDown = (
    event: KeyboardEvent & { currentTarget: HTMLLIElement; target: Element },
  ) => {
    // Enter and Space toggle the menu, ArrowDown is handled by the title bar
    // since it also moves the focus into the opened panel
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.currentTarget.click();
    }

    if (typeof local.onKeyDown === 'function') {
      local.onKeyDown(event);
    } else if (Array.isArray(local.onKeyDown)) {
      const [handler, data] = local.onKeyDown;
      handler(data, event);
    }
  };

  return (
    <li
      {...leftProps}
      aria-expanded={props.selected ?? false}
      aria-haspopup={'menu'}
      class={menuStyle()}
      data-selected={props.selected}
      onKeyDown={handleKeyDown}
      role={'menuitem'}
      tabIndex={props.tabIndex ?? 0}
    >
      {local.text}
    </li>
  );
};
