import { createMemo, createResource, createSignal, ErrorBoundary, For, Show } from 'solid-js';
import { css } from 'solid-styled-components';

import { SettingsSection } from './SettingsSection';
import { cacheNoArgs } from '@/providers/decorators';
import { ErrorDisplay } from '@/plugins/utils/renderer';

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
    pointer-events: none;
    transition: opacity 200ms ease;

    &[data-open='true'] {
      opacity: 1;
      pointer-events: all;
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

export const SettingsPage = (props: SettingsPageProps) => {
  const [search, setSearch] = createSignal('');

  const [plugins] = createResource(
    () => props.open(),
    async (open) => {
      if (!open) return [];
      return window.ipcRenderer.invoke(
        'ytmd:get-all-plugin-meta',
      ) as Promise<PluginMeta[]>;
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

  return (
    <div
      class={overlayStyle()}
      data-open={props.open()}
      onClick={handleOverlayClick}
    >
      <div class={panelStyle()}>
        <div class={headerStyle()}>
          <h2 class={titleStyle()}>Settings</h2>
          <div
            style={{ display: 'flex', 'align-items': 'center', gap: '12px' }}
          >
            <span class={shortcutHintStyle()}>Ctrl+,</span>
            <button class={closeButtonStyle()} onClick={props.onClose}>
              {'✕'}
            </button>
          </div>
        </div>
        <input
          class={searchStyle()}
          placeholder="Search plugins..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <div class={contentStyle()}>
          <ErrorBoundary fallback={(err) => (
            <ErrorDisplay message={err?.message ?? 'Failed to load settings'} />
          )}>
            <For each={filteredPlugins()}>
              {(plugin) => <SettingsSection plugin={plugin} />}
            </For>
            <Show when={filteredPlugins()?.length === 0 && !plugins.loading}>
              <p class={emptyStyle()}>No plugins match your search.</p>
            </Show>
            <Show when={plugins.loading}>
              <p class={emptyStyle()}>Loading plugins...</p>
            </Show>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};
