import { type MenuItem } from 'electron';
import { Index, Match, Show, Switch } from 'solid-js';
import { css } from 'solid-styled-components';

import { PanelItem } from './PanelItem';

import { cacheNoArgs } from '@/providers/decorators';

const separatorStyle = cacheNoArgs(
  () => css`
    min-height: 1px;
    height: 1px;
    margin: 4px 0;

    background-color: rgba(255, 255, 255, 0.2);
  `,
);

export type PanelRendererProps = {
  items: Electron.Menu['items'];
  level?: number[];
  onClick?: (commandId: number, radioGroup?: MenuItem[]) => void;
};
export const PanelRenderer = (props: PanelRendererProps) => {
  const radioGroup = () => props.items.filter((it) => it.type === 'radio');

  return (
    <Index each={props.items}>
      {(subItem) => (
        <Show when={subItem().visible}>
          <Switch>
            <Match when={subItem().type === 'normal'}>
              <PanelItem
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                enabled={subItem().enabled}
                name={subItem().label}
                onClick={() => props.onClick?.(subItem().commandId)}
                toolTip={subItem().toolTip}
                type={'normal'}
              />
            </Match>
            <Match when={subItem().type === 'submenu'}>
              <PanelItem
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                enabled={subItem().enabled}
                level={[...(props.level ?? []), subItem().commandId]}
                name={subItem().label}
                toolTip={subItem().toolTip}
                type={'submenu'}
              >
                <PanelRenderer
                  items={subItem().submenu?.items ?? []}
                  level={[...(props.level ?? []), subItem().commandId]}
                  onClick={props.onClick}
                />
              </PanelItem>
            </Match>
            <Match when={subItem().type === 'checkbox'}>
              <PanelItem
                checked={subItem().checked}
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                enabled={subItem().enabled}
                name={subItem().label}
                onChange={() => props.onClick?.(subItem().commandId)}
                toolTip={subItem().toolTip}
                type={'checkbox'}
              />
            </Match>
            <Match when={subItem().type === 'radio'}>
              <PanelItem
                checked={subItem().checked}
                chip={subItem().sublabel}
                commandId={subItem().commandId}
                enabled={subItem().enabled}
                name={subItem().label}
                onChange={() =>
                  props.onClick?.(subItem().commandId, radioGroup())
                }
                toolTip={subItem().toolTip}
                type={'radio'}
              />
            </Match>
            <Match when={subItem().type === 'separator'}>
              <hr class={separatorStyle()} />
            </Match>
          </Switch>
        </Show>
      )}
    </Index>
  );
};
