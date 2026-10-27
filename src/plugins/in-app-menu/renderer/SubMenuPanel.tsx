import { type Accessor } from 'solid-js';
import { type JSX } from 'solid-js/jsx-runtime';
import { css } from 'solid-styled-components';

import { Panel } from './Panel';
import { cacheNoArgs } from '@/providers/decorators';

const itemIconStyle = cacheNoArgs(
  () => css`
    height: 32px;
    padding: 4px;
    color: white;
  `,
);

export type SubMenuPanelProps = {
  anchor: Accessor<HTMLElement | null>;
  open: boolean;
  level: number[];
  name?: string;
  ref: (el: HTMLElement | null) => void;
  children: JSX.Element;
};

export const SubMenuPanel = (props: SubMenuPanelProps) => {
  return (
    <>
      <svg
        class={itemIconStyle()}
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M0 0h24v24H0z" fill="none" stroke="none" />
        <polyline points="9 6 15 12 9 18" />
      </svg>
      <Panel
        anchor={props.anchor()}
        aria-label={props.name}
        data-level={props.level.join('/')}
        offset={{ mainAxis: 8 }}
        open={props.open}
        placement={'right-start'}
        ref={props.ref}
      >
        {props.children}
      </Panel>
    </>
  );
};
