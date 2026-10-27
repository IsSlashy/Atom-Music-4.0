import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  on,
  Show,
} from 'solid-js';
import { css } from 'solid-styled-components';

import { SettingsSection } from './SettingsSection';
import { cacheNoArgs } from '@/providers/decorators';
import { ErrorDisplay } from '@/plugins/utils/renderer';
import { t } from '@/i18n';

import type { PluginMeta } from '../types';

type SettingsPageProps = {
  open: () => boolean;
  onClose: () => void;
};

const overlayStyle = cacheNoArgs(
  () => css`
    position: fixed;
    inset: 0;
    z-index: 10000001;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 40px;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    /* Hide only once the fade-out has finished */
    transition:
      opacity 200ms ease,
      visibility 0s linear 200ms;

    &[data-open='true'] {
      opacity: 1;
      visibility: visible;
      pointer-events: all;
      transition:
        opacity 200ms ease,
        visibility 0s linear 0s;
    }

    @media (max-width: 600px) {
      padding-top: 0;
    }
  `,
);

const panelStyle = cacheNoArgs(
  () => css`
    width: 600px;
    max-width: 90vw;
    max-height: calc(100vh - 80px);
    background: #1e1e1e;
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    transform: scale(0.95) translateY(-10px);
    transition:
      transform 200ms ease,
      opacity 200ms ease;

    &:focus {
      outline: none;
    }

    [data-open='true'] > & {
      transform: scale(1) translateY(0);
    }

    @media (max-width: 600px) {
      width: 100vw;
      max-width: 100vw;
      max-height: 100vh;
      border-radius: 0;
      margin: 0;
    }
  `,
);

const headerStyle = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  `,
);

const titleStyle = cacheNoArgs(
  () => css`
    margin: 0;
    color: #f1f1f1;
    font-size: 18px;
    font-weight: 600;
  `,
);

const closeButtonStyle = cacheNoArgs(
  () => css`
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font-size: 20px;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;

    &:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #f1f1f1;
    }
  `,
);

const searchStyle = cacheNoArgs(
  () => css`
    width: calc(100% - 40px);
    padding: 8px 12px;
    margin: 12px 20px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #f1f1f1;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;

    &:focus {
      border-color: rgba(255, 255, 255, 0.3);
    }

    &:focus-visible {
      outline: 2px solid #3ea6ff;
      outline-offset: 1px;
    }

    &::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }
  `,
);

const contentStyle = cacheNoArgs(
  () => css`
    flex: 1;
    overflow-y: auto;
    padding: 4px 20px 20px;

    &::-webkit-scrollbar {
      width: 6px;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }
  `,
);

const emptyStyle = cacheNoArgs(
  () => css`
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    padding: 20px;
    font-size: 14px;
  `,
);

const shortcutHintStyle = cacheNoArgs(
  () => css`
    color: rgba(255, 255, 255, 0.3);
    font-size: 11px;
  `,
);

const titleId = 'ytmd-settings-title';

const focusableSelector =
  'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])';

export const SettingsPage = (props: SettingsPageProps) => {
  const [search, setSearch] = createSignal('');
  const [panel, setPanel] = createSignal<HTMLDivElement>();
  const [searchInput, setSearchInput] = createSignal<HTMLInputElement>();
  // Focused again when the dialog closes
  let returnFocusTo: HTMLElement | null = null;

  const [plugins] = createResource(
    () => props.open(),
    async (open) => {
      if (!open) return [];
      return window.ipcRenderer.invoke('ytmd:get-all-plugin-meta') as Promise<
        PluginMeta[]
      >;
    },
  );

  const filteredPlugins = createMemo(() => {
    const query = search().toLowerCase();
    const all = plugins() ?? [];
    const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
    if (!query) return sorted;
    return sorted.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.id.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query),
    );
  });

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  // Move focus into the dialog on open and back to where it was on close.
  // Runs after the render effects, so `inert` is already up to date.
  createEffect(
    on(
      () => props.open(),
      (open) => {
        const active = document.activeElement;
        if (open) {
          returnFocusTo =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
          searchInput()?.focus();
          return;
        }

        if (
          returnFocusTo?.isConnected &&
          (!active || active === document.body || panel()?.contains(active))
        ) {
          returnFocusTo.focus();
        }
        returnFocusTo = null;
      },
      { defer: true },
    ),
  );

  // Keep Tab and Shift+Tab inside the dialog
  const trapFocus = (e: KeyboardEvent) => {
    const dialog = panel();
    if (e.key !== 'Tab' || !dialog) return;

    const focusable = [
      ...dialog.querySelectorAll<HTMLElement>(focusableSelector),
    ].filter((el) => !el.matches(':disabled') && el.checkVisibility());
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      class={overlayStyle()}
      data-open={props.open()}
      inert={!props.open()}
      onClick={handleOverlayClick}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        class={panelStyle()}
        on:keydown={trapFocus}
        ref={setPanel}
        role="dialog"
        tabindex="-1"
      >
        <div class={headerStyle()}>
          <h2 class={titleStyle()} id={titleId}>
            {t('plugins.settings-page.templates.title')}
          </h2>
          <div
            style={{
              'display': 'flex',
              'align-items': 'center',
              'gap': '12px',
            }}
          >
            <span class={shortcutHintStyle()}>Ctrl+,</span>
            <button
              aria-label={t('plugins.settings-page.templates.close')}
              class={closeButtonStyle()}
              onClick={() => props.onClose()}
            >
              {'✕'}
            </button>
          </div>
        </div>
        <input
          aria-label={t('plugins.settings-page.templates.search')}
          class={searchStyle()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          placeholder={t('plugins.settings-page.templates.search-placeholder')}
          ref={setSearchInput}
          type="search"
          value={search()}
        />
        <div class={contentStyle()}>
          <ErrorBoundary
            fallback={(err: unknown) => (
              <ErrorDisplay
                message={
                  err instanceof Error
                    ? err.message
                    : t('plugins.settings-page.templates.error')
                }
              />
            )}
          >
            <For each={filteredPlugins()}>
              {(plugin) => <SettingsSection plugin={plugin} />}
            </For>
            <Show when={filteredPlugins()?.length === 0 && !plugins.loading}>
              <p class={emptyStyle()}>
                {t('plugins.settings-page.templates.empty')}
              </p>
            </Show>
            <Show when={plugins.loading}>
              <p class={emptyStyle()}>
                {t('plugins.settings-page.templates.loading')}
              </p>
            </Show>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};
