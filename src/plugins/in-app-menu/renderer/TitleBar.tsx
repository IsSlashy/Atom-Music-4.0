import { type Menu } from 'electron';
import {
  createEffect,
  createResource,
  createSignal,
  Index,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { css } from 'solid-styled-components';
import { TransitionGroup } from 'solid-transition-group';

import { MenuButton } from './MenuButton';
import { Panel } from './Panel';
import { PanelRenderer } from './PanelRenderer';
import { IconButton } from './IconButton';
import { WindowController } from './WindowController';
import { useMenuData } from './hooks/useMenuData';

import { cacheNoArgs } from '@/providers/decorators';

import type { RendererContext } from '@/types/contexts';
import type { InAppMenuConfig } from '../constants';

const titleStyle = cacheNoArgs(
  () => css`
    -webkit-app-region: drag;
    box-sizing: border-box;

    position: fixed;
    top: 0;
    z-index: 10000000;

    width: 100%;
    height: var(--menu-bar-height, 32px);

    display: flex;
    flex-flow: row;
    justify-content: flex-start;
    align-items: center;
    gap: 4px;

    color: #f1f1f1;
    font-size: 12px;
    padding: 4px 4px 4px var(--offset-left, 4px);
    background-color: var(--titlebar-background-color, #030303);
    user-select: none;

    transition:
      opacity 200ms ease 0s,
      transform 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s,
      background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s;

    &[data-macos='true'] {
      padding: 4px 4px 4px 74px;
    }

    ytmusic-app:has(ytmusic-player[player-ui-state='FULLSCREEN'])
      ~ &:not([data-show='true']) {
      transform: translateY(calc(-1 * var(--menu-bar-height, 32px)));
    }

    @media (max-width: 500px) {
      font-size: 11px;
      gap: 2px;
    }
  `,
);

const animationStyle = cacheNoArgs(() => ({
  enter: css`
    opacity: 0;
    transform: translateX(-50%) scale(0.8);
  `,
  enterActive: css`
    transition:
      opacity 0.1s cubic-bezier(0.33, 1, 0.68, 1),
      transform 0.1s cubic-bezier(0.33, 1, 0.68, 1);
  `,
  exitTo: css`
    opacity: 0;
    transform: translateX(-50%) scale(0.8);
  `,
  exitActive: css`
    transition:
      opacity 0.1s cubic-bezier(0.32, 0, 0.67, 0),
      transform 0.1s cubic-bezier(0.32, 0, 0.67, 0);
  `,
  move: css`
    transition: all 0.1s cubic-bezier(0.65, 0, 0.35, 1);
  `,
  fakeTarget: css`
    position: absolute;
    opacity: 0;
  `,
  fake: css`
    transition: all 0.00000000001s;
  `,
}));

export type TitleBarProps = {
  ipc: RendererContext<InAppMenuConfig>['ipc'];
  isMacOS?: boolean;
  enableController?: boolean;
  initialCollapsed?: boolean;
};
export const TitleBar = (props: TitleBarProps) => {
  const [collapsed, setCollapsed] = createSignal(props.initialCollapsed);
  const [ignoreTransition, setIgnoreTransition] = createSignal(false);
  const [openTarget, setOpenTarget] = createSignal<HTMLElement | null>(null);
  const [menu, setMenu] = createSignal<Menu | null>(null);
  const [mouseY, setMouseY] = createSignal(0);

  const [data, { refetch }] = createResource(
    async () => (await props.ipc.invoke('get-menu')) as Promise<Menu | null>,
  );
  const [isMaximized, { refetch: refetchMaximize }] = createResource(
    async () =>
      (await props.ipc.invoke('window-is-maximized')) as Promise<boolean>,
  );

  const handleToggleMaximize = async () => {
    if (isMaximized()) {
      await props.ipc.invoke('window-unmaximize');
    } else {
      await props.ipc.invoke('window-maximize');
    }
    await refetchMaximize();
  };
  const handleMinimize = async () => {
    await props.ipc.invoke('window-minimize');
  };
  const handleClose = async () => {
    await props.ipc.invoke('window-close');
  };

  const { handleItemClick } = useMenuData(menu, setMenu);

  const listener = (e: MouseEvent) => {
    setMouseY(e.clientY);
  };

  const clickListener = (e: MouseEvent) => {
    if (
      e.target instanceof HTMLElement &&
      !(
        e.target.closest('nav[data-ytmd-main-panel]') ||
        e.target.closest('ul[data-ytmd-sub-panel]')
      )
    ) {
      setOpenTarget(null);
    }
  };

  let ytmusicAppLayout: HTMLElement | null = null;
  const scrollListener = () => {
    if (!ytmusicAppLayout) return;
    const scrollValue = ytmusicAppLayout.scrollTop;
    if (scrollValue > 20) {
      ytmusicAppLayout.classList.add('content-scrolled');
    } else {
      ytmusicAppLayout.classList.remove('content-scrolled');
    }
  };

  onMount(() => {
    props.ipc.on('close-all-in-app-menu-panel', async () => {
      setIgnoreTransition(true);
      setMenu(null);
      await refetch();
      setMenu(data() ?? null);
      setIgnoreTransition(false);
    });
    props.ipc.on('refresh-in-app-menu', async () => {
      setIgnoreTransition(true);
      await refetch();
      setMenu(data() ?? null);
      setIgnoreTransition(false);
    });
    props.ipc.on('toggle-in-app-menu', () => {
      setCollapsed(!collapsed());
    });

    props.ipc.on('window-maximize', refetchMaximize);
    props.ipc.on('window-unmaximize', refetchMaximize);

    // close menu when the outside of the panel or sub-panel is clicked
    document.body.addEventListener('click', clickListener);

    // tracking mouse position
    window.addEventListener('mousemove', listener);
    ytmusicAppLayout = document.querySelector<HTMLElement>('#layout');
    ytmusicAppLayout?.addEventListener('scroll', scrollListener);
  });

  createEffect(() => {
    if (!menu() && data()) {
      setMenu(data() ?? null);
    }
  });

  onCleanup(() => {
    window.removeEventListener('mousemove', listener);
    document.body.removeEventListener('click', clickListener);
    ytmusicAppLayout?.removeEventListener('scroll', scrollListener);
  });

  return (
    <nav
      class={titleStyle()}
      data-macos={props.isMacOS}
      data-show={mouseY() < 32}
      data-ytmd-main-panel={true}
      id={'ytmd-title-bar-main-panel'}
      tabIndex={0}
      onDblClick={(e) => {
        // double-clicking the empty (drag) area of the titlebar toggles maximize
        if (props.enableController && e.target === e.currentTarget) {
          void handleToggleMaximize();
        }
      }}
      onKeyDown={(e: KeyboardEvent) => {
        const items = menu()?.items;
        if (!items || collapsed()) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          setOpenTarget(null);
          return;
        }

        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const currentTarget = openTarget();
          if (!currentTarget) return;

          e.preventDefault();
          const nav = e.currentTarget as HTMLElement;
          const buttons = Array.from(
            nav.querySelectorAll<HTMLElement>('li[data-index]'),
          );
          const currentIndex = buttons.indexOf(currentTarget);
          if (currentIndex === -1) return;

          let nextIndex: number;
          if (e.key === 'ArrowLeft') {
            nextIndex =
              currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
          } else {
            nextIndex =
              currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
          }

          const nextButton = buttons[nextIndex];
          if (nextButton) {
            setOpenTarget(nextButton);
            nextButton.focus();
          }
        }
      }}
    >
      <IconButton
        onClick={() => setCollapsed(!collapsed())}
        style={{
          'border-top-left-radius': '4px',
        }}
      >
        <svg height={16} viewBox={'0 0 24 24'} width={16}>
          <path
            d="M3 17h12a1 1 0 0 1 .117 1.993L15 19H3a1 1 0 0 1-.117-1.993L3 17h12H3Zm0-6h18a1 1 0 0 1 .117 1.993L21 13H3a1 1 0 0 1-.117-1.993L3 11h18H3Zm0-6h15a1 1 0 0 1 .117 1.993L18 7H3a1 1 0 0 1-.117-1.993L3 5h15H3Z"
            fill="currentColor"
          />
        </svg>
      </IconButton>
      <TransitionGroup
        enterActiveClass={
          ignoreTransition()
            ? animationStyle().fake
            : animationStyle().enterActive
        }
        enterClass={
          ignoreTransition()
            ? animationStyle().fakeTarget
            : animationStyle().enter
        }
        exitActiveClass={
          ignoreTransition()
            ? animationStyle().fake
            : animationStyle().exitActive
        }
        exitToClass={
          ignoreTransition()
            ? animationStyle().fakeTarget
            : animationStyle().exitTo
        }
        onAfterEnter={(element) => {
          (element as HTMLElement).style.removeProperty('transition-delay');
        }}
        onBeforeEnter={(element) => {
          if (ignoreTransition()) return;
          const index = Number(element.getAttribute('data-index') ?? 0);

          (element as HTMLElement).style.setProperty(
            'transition-delay',
            `${index * 0.025}s`,
          );
        }}
        onBeforeExit={(element) => {
          if (ignoreTransition()) return;
          const index = Number(element.getAttribute('data-index') ?? 0);
          const length = Number(element.getAttribute('data-length') ?? 1);

          (element as HTMLElement).style.setProperty(
            'transition-delay',
            `${length * 0.025 - index * 0.025}s`,
          );
        }}
      >
        <Show when={!collapsed()}>
          <Index each={menu()?.items}>
            {(item, index) => {
              const [anchor, setAnchor] = createSignal<HTMLElement | null>(
                null,
              );

              const handleClick = () => {
                if (openTarget() === anchor()) {
                  setOpenTarget(null);
                } else {
                  setOpenTarget(anchor());
                }
              };

              return (
                <>
                  <MenuButton
                    data-index={index}
                    data-length={menu()?.items.length}
                    onClick={handleClick}
                    ref={setAnchor}
                    selected={openTarget() === anchor()}
                    text={item().label}
                  />
                  <Panel
                    anchor={anchor()}
                    offset={{ mainAxis: 8 }}
                    open={openTarget() === anchor()}
                    placement={'bottom-start'}
                  >
                    <PanelRenderer
                      items={item().submenu?.items ?? []}
                      onClick={handleItemClick}
                    />
                  </Panel>
                </>
              );
            }}
          </Index>
        </Show>
      </TransitionGroup>
      <Show when={props.enableController}>
        <div style={{ flex: 1 }} />
        <WindowController
          isMaximize={isMaximized()}
          onClose={handleClose}
          onMinimize={handleMinimize}
          onToggleMaximize={handleToggleMaximize}
        />
      </Show>
    </nav>
  );
};
