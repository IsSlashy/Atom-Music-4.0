import { type Menu } from 'electron';
import {
  createEffect,
  createResource,
  createSignal,
  Index,
  on,
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
import {
  focusMenuItem,
  MenuPanelContext,
  type MenuPanelContextValue,
} from './keyboard';

import { cacheNoArgs } from '@/providers/decorators';
import { waitForElement } from '@/utils/wait-for-element';
import { t } from '@/i18n';

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
    /* keep the menus clear of the window controls overlay */
    padding-right: calc(
      100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 4px
    );
    overflow: hidden;
    background-color: var(--titlebar-background-color, #030303);
    user-select: none;

    transition:
      opacity 200ms ease 0s,
      transform 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s,
      background-color 300ms cubic-bezier(0.2, 0, 0.6, 1) 0s;

    &[data-macos='true'] {
      padding: 4px 4px 4px 74px;
    }

    ytmusic-app.ytmd-fullscreen ~ &:not([data-show='true']) {
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

// extra width the title bar needs before auto-collapsed menus come back, so
// they do not flicker while the window is resized around the limit
const AUTO_COLLAPSE_HYSTERESIS = 24;

// Window Controls Overlay API, missing from lib.dom
const windowControlsOverlay = (
  navigator as Navigator & { windowControlsOverlay?: EventTarget }
).windowControlsOverlay;

// right edge of the last title bar item, from layout boxes so the enter
// transition (translate and scale) does not skew it
const getItemsRight = (titleBar: HTMLElement) =>
  Math.max(
    0,
    ...Array.from(
      titleBar.querySelectorAll<HTMLElement>(
        ':scope > *, :scope > [role="menubar"] > *',
      ),
    )
      .filter((it) => getComputedStyle(it).position !== 'absolute')
      .map((it) => it.offsetLeft + it.offsetWidth),
  );

export type TitleBarProps = {
  ipc: RendererContext<InAppMenuConfig>['ipc'];
  isMacOS?: boolean;
  enableController?: boolean;
  initialCollapsed?: boolean;
};
export const TitleBar = (props: TitleBarProps) => {
  const [collapsed, setCollapsed] = createSignal(props.initialCollapsed);
  // set when the menus do not fit next to the window controls, independent
  // of the user's choice (options.hideMenu, hamburger button)
  const [autoCollapsed, setAutoCollapsed] = createSignal(false);
  const [ignoreTransition, setIgnoreTransition] = createSignal(false);
  const [openTarget, setOpenTarget] = createSignal<HTMLElement | null>(null);
  const [menu, setMenu] = createSignal<Menu | null>(null);
  const [mouseY, setMouseY] = createSignal(0);
  // roving tabindex: only one menu bar button is a tab stop
  const [focusIndex, setFocusIndex] = createSignal(0);
  const [menuToggle, setMenuToggle] = createSignal<HTMLElement | null>(null);
  const [overflowPanel, setOverflowPanel] = createSignal<HTMLElement | null>(
    null,
  );

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

  // keyboard context of a top-level panel: closing it gives the focus back to
  // the button that opened it
  const createPanelContext = (
    anchor: () => HTMLElement | null,
  ): MenuPanelContextValue => {
    const close = () => {
      setOpenTarget(null);
      anchor()?.focus();
    };
    return { isSubmenu: false, close, closeAll: close };
  };

  let titleBar: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  // right edge of the items when the menus were last shown. The right padding
  // is read again each time: it follows the window controls overlay, whose
  // size can lag behind a window resize and leave the padding far too wide
  // for a moment
  let requiredItemsRight = 0;
  let autoCollapseFrame = 0;
  let observeItemsPending = false;

  const updateAutoCollapse = () => {
    if (!titleBar) return;

    const room =
      titleBar.clientWidth -
      (parseFloat(getComputedStyle(titleBar).paddingRight) || 0);

    if (autoCollapsed()) {
      if (room >= requiredItemsRight + AUTO_COLLAPSE_HYSTERESIS) {
        setOpenTarget(null);
        setAutoCollapsed(false);
      }
      return;
    }

    // the menus are hidden by the user, there is nothing to measure
    if (collapsed()) return;

    const itemsRight = getItemsRight(titleBar);
    if (itemsRight > room) {
      requiredItemsRight = itemsRight;
      setOpenTarget(null);
      setAutoCollapsed(true);
    }
  };

  const scheduleAutoCollapse = (observeItems = false) => {
    observeItemsPending ||= observeItems;
    cancelAnimationFrame(autoCollapseFrame);
    autoCollapseFrame = requestAnimationFrame(() => {
      if (observeItemsPending && titleBar && resizeObserver) {
        // a label can change width (language, font loading) while the title
        // bar keeps its size
        resizeObserver.disconnect();
        resizeObserver.observe(titleBar);
        titleBar
          .querySelectorAll('li[data-index]')
          .forEach((it) => resizeObserver?.observe(it));
      }
      observeItemsPending = false;
      updateAutoCollapse();
    });
  };
  const handleGeometryChange = () => scheduleAutoCollapse();

  // with the menus collapsed, the hamburger button lists them in a panel
  const toggleOverflowMenu = (focusFirstItem: boolean) => {
    const toggle = menuToggle();
    if (openTarget() === toggle) {
      setOpenTarget(null);
      return;
    }

    setOpenTarget(toggle);
    if (focusFirstItem) {
      requestAnimationFrame(() => focusMenuItem(overflowPanel(), 'first'));
    }
  };

  const handleMenuToggle = (fromKeyboard: boolean) => {
    if (autoCollapsed()) {
      toggleOverflowMenu(fromKeyboard);
      return;
    }

    setCollapsed(!collapsed());
    // shown again in a title bar too narrow for them: use the panel instead
    if (!collapsed()) {
      updateAutoCollapse();
      if (autoCollapsed()) toggleOverflowMenu(fromKeyboard);
    }
  };

  // ytmusic-app gets the ytmd-fullscreen class while the player is
  // fullscreen, so the title bar hides without a :has() rule that every style
  // recalculation of the app has to match.
  // player-ui-state is read from ytmusic-app-layout, which mirrors the one of
  // ytmusic-player: YTM replaces ytmusic-player (and its parents) whenever the
  // layout switches to or from mweb, the layout itself stays
  let appLayout: Element | null = null;
  const syncFullscreen = () => {
    document
      .querySelector('ytmusic-app')
      ?.classList.toggle(
        'ytmd-fullscreen',
        appLayout?.getAttribute('player-ui-state') === 'FULLSCREEN',
      );
  };
  const fullscreenObserver = new MutationObserver(syncFullscreen);
  const layoutParentObserver = new MutationObserver(() => attachLayout());
  // observes the layout, and its parent to reattach if YTM ever replaces it
  const attachLayout = () => {
    const current = document.querySelector('ytmusic-app-layout');
    if (current !== appLayout) {
      fullscreenObserver.disconnect();
      layoutParentObserver.disconnect();
      appLayout = current;
      if (appLayout) {
        fullscreenObserver.observe(appLayout, {
          attributes: true,
          attributeFilter: ['player-ui-state'],
        });
      }
      if (appLayout?.parentElement) {
        layoutParentObserver.observe(appLayout.parentElement, {
          childList: true,
        });
      }
    }
    syncFullscreen();
  };

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

    resizeObserver = new ResizeObserver(() => scheduleAutoCollapse());
    scheduleAutoCollapse(true);
    windowControlsOverlay?.addEventListener(
      'geometrychange',
      handleGeometryChange,
    );

    waitForElement('ytmusic-app-layout').then(attachLayout);
  });

  createEffect(() => {
    if (!menu() && data()) {
      setMenu(data() ?? null);
    }
  });

  // measure again whenever the menu bar buttons are rendered or removed
  createEffect(
    on([menu, collapsed, autoCollapsed], () => scheduleAutoCollapse(true)),
  );

  onCleanup(() => {
    window.removeEventListener('mousemove', listener);
    document.body.removeEventListener('click', clickListener);
    ytmusicAppLayout?.removeEventListener('scroll', scrollListener);
    cancelAnimationFrame(autoCollapseFrame);
    resizeObserver?.disconnect();
    windowControlsOverlay?.removeEventListener(
      'geometrychange',
      handleGeometryChange,
    );
    fullscreenObserver.disconnect();
    layoutParentObserver.disconnect();
  });

  return (
    <nav
      class={titleStyle()}
      data-macos={props.isMacOS}
      data-show={mouseY() < 32}
      data-ytmd-main-panel={true}
      id={'ytmd-title-bar-main-panel'}
      onDblClick={(e) => {
        // double-clicking the empty (drag) area of the titlebar toggles maximize
        if (props.enableController && e.target === e.currentTarget) {
          handleToggleMaximize();
        }
      }}
      onKeyDown={(e: KeyboardEvent) => {
        // with the menus collapsed, Escape and Tab still close the panel
        // opened from the hamburger button
        const items = menu()?.items;
        if (!items) return;

        if (e.key === 'Escape') {
          e.preventDefault();
          setOpenTarget(null);
          return;
        }

        // Tab closes the open menu, the focus moves on as usual
        if (e.key === 'Tab') {
          setOpenTarget(null);
          return;
        }

        if (
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'Home' ||
          e.key === 'End'
        ) {
          const nav = e.currentTarget as HTMLElement;
          const buttons = Array.from(
            nav.querySelectorAll<HTMLElement>('li[data-index]'),
          );
          const currentIndex = buttons.indexOf(e.target as HTMLElement);
          if (currentIndex === -1) return;

          e.preventDefault();
          let nextIndex: number;
          if (e.key === 'Home') {
            nextIndex = 0;
          } else if (e.key === 'End') {
            nextIndex = buttons.length - 1;
          } else if (e.key === 'ArrowLeft') {
            nextIndex =
              currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
          } else {
            nextIndex =
              currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
          }

          const nextButton = buttons[nextIndex];
          if (nextButton) {
            // an open menu follows the focus
            if (openTarget()) setOpenTarget(nextButton);
            nextButton.focus();
          }
        }
      }}
      ref={(el) => (titleBar = el)}
    >
      <IconButton
        aria-expanded={
          autoCollapsed() ? openTarget() === menuToggle() : undefined
        }
        aria-haspopup={autoCollapsed() ? 'menu' : undefined}
        aria-label={t('plugins.in-app-menu.templates.menu-button')}
        onClick={(e) => handleMenuToggle(e.detail === 0)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && autoCollapsed()) {
            e.preventDefault();
            if (openTarget() !== menuToggle()) toggleOverflowMenu(true);
            else focusMenuItem(overflowPanel(), 'first');
          }
        }}
        ref={setMenuToggle}
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
      <Panel
        anchor={menuToggle()}
        offset={{ mainAxis: 8 }}
        open={autoCollapsed() && openTarget() === menuToggle()}
        placement={'bottom-start'}
        ref={setOverflowPanel}
      >
        <MenuPanelContext.Provider value={createPanelContext(menuToggle)}>
          <PanelRenderer
            items={menu()?.items ?? []}
            onClick={handleItemClick}
          />
        </MenuPanelContext.Provider>
      </Panel>
      <div role={'menubar'} style={{ display: 'contents' }}>
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
          <Show when={!collapsed() && !autoCollapsed()}>
            <Index each={menu()?.items}>
              {(item, index) => {
                const [anchor, setAnchor] = createSignal<HTMLElement | null>(
                  null,
                );
                const [panel, setPanel] = createSignal<HTMLElement | null>(
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
                      onFocus={() => setFocusIndex(index)}
                      onKeyDown={(e: KeyboardEvent) => {
                        // ArrowDown and ArrowUp open the menu and move the
                        // focus to its first or last item
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          setOpenTarget(anchor());
                          const position =
                            e.key === 'ArrowDown' ? 'first' : 'last';
                          requestAnimationFrame(() =>
                            focusMenuItem(panel(), position),
                          );
                        }
                      }}
                      ref={setAnchor}
                      selected={openTarget() === anchor()}
                      tabIndex={focusIndex() === index ? 0 : -1}
                      text={item().label}
                    />
                    <Panel
                      anchor={anchor()}
                      aria-label={item().label}
                      offset={{ mainAxis: 8 }}
                      open={openTarget() === anchor()}
                      placement={'bottom-start'}
                      ref={setPanel}
                    >
                      <MenuPanelContext.Provider
                        value={createPanelContext(anchor)}
                      >
                        <PanelRenderer
                          items={item().submenu?.items ?? []}
                          onClick={handleItemClick}
                        />
                      </MenuPanelContext.Provider>
                    </Panel>
                  </>
                );
              }}
            </Index>
          </Show>
        </TransitionGroup>
      </div>
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
