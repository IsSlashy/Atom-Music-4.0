import { createEffect, createSignal, For, Show } from 'solid-js';
import { css } from 'solid-styled-components';

import { SettingControl } from './SettingControl';
import { cacheNoArgs } from '@/providers/decorators';

import type { PluginMeta } from '../types';

type SettingsSectionProps = {
  plugin: PluginMeta;
};

const sectionStyle = cacheNoArgs(
  () => css`
    margin-bottom: 8px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    overflow: hidden;

    &:hover {
      background: rgba(255, 255, 255, 0.06);
    }
  `,
);

const headerStyle = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
  `,
);

const infoStyle = cacheNoArgs(
  () => css`
    flex: 1;
    min-width: 0;
  `,
);

const nameStyle = cacheNoArgs(
  () => css`
    color: #f1f1f1;
    font-size: 14px;
    font-weight: 500;
  `,
);

const descStyle = cacheNoArgs(
  () => css`
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
);

const toggleStyle = cacheNoArgs(
  () => css`
    position: relative;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
    margin-left: 12px;
    cursor: pointer;

    input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      transition: background 200ms;
    }

    .slider::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      left: 2px;
      bottom: 2px;
      background: white;
      border-radius: 50%;
      transition: transform 200ms;
    }

    input:checked + .slider {
      background: #3ea6ff;
    }

    input:checked + .slider::before {
      transform: translateX(16px);
    }
  `,
);

const configAreaStyle = cacheNoArgs(
  () => css`
    padding: 0 16px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  `,
);

const restartBadgeStyle = cacheNoArgs(
  () => css`
    font-size: 10px;
    padding: 2px 6px;
    background: rgba(255, 165, 0, 0.2);
    color: #ffa500;
    border-radius: 4px;
    margin-left: 8px;
  `,
);

export const SettingsSection = (props: SettingsSectionProps) => {
  const [expanded, setExpanded] = createSignal(false);
  const [config, setConfig] = createSignal<Record<string, unknown>>({});

  createEffect(async () => {
    const currentConfig = (await window.ipcRenderer.invoke(
      'ytmd:get-config',
      props.plugin.id,
    )) as Record<string, unknown>;
    setConfig(currentConfig);
  });

  const isEnabled = () => (config().enabled as boolean) ?? false;

  const toggleEnabled = async () => {
    const newEnabled = !isEnabled();
    await window.ipcRenderer.invoke('ytmd:set-config', props.plugin.id, {
      enabled: newEnabled,
    });
    setConfig((prev) => ({ ...prev, enabled: newEnabled }));
  };

  const updateConfig = async (key: string, value: unknown) => {
    await window.ipcRenderer.invoke('ytmd:set-config', props.plugin.id, {
      [key]: value,
    });
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const configKeys = () =>
    Object.keys(props.plugin.defaultConfig).filter((k) => k !== 'enabled');

  const hasConfig = () => configKeys().length > 0;

  return (
    <div class={sectionStyle()}>
      <div
        class={headerStyle()}
        onClick={() => hasConfig() && setExpanded(!expanded())}
      >
        <div class={infoStyle()}>
          <div style={{ 'display': 'flex', 'align-items': 'center' }}>
            <span class={nameStyle()}>{props.plugin.name}</span>
            <Show when={props.plugin.restartNeeded}>
              <span class={restartBadgeStyle()}>restart</span>
            </Show>
            <Show when={hasConfig()}>
              <svg
                height="16"
                style={{
                  'margin-left': '8px',
                  'color': 'rgba(255,255,255,0.4)',
                  'transform': expanded() ? 'rotate(180deg)' : 'rotate(0deg)',
                  'transition': 'transform 200ms',
                }}
                viewBox="0 0 24 24"
                width="16"
              >
                <path d="M7 10l5 5 5-5z" fill="currentColor" />
              </svg>
            </Show>
          </div>
          <Show when={props.plugin.description}>
            <div class={descStyle()}>{props.plugin.description}</div>
          </Show>
        </div>
        <label class={toggleStyle()} onClick={(e) => e.stopPropagation()}>
          <input
            checked={isEnabled()}
            onChange={toggleEnabled}
            type="checkbox"
          />
          <span class="slider" />
        </label>
      </div>
      <Show when={expanded() && hasConfig()}>
        <div class={configAreaStyle()}>
          <For each={configKeys()}>
            {(key) => (
              <SettingControl
                defaultValue={props.plugin.defaultConfig[key]}
                label={key}
                onChange={(val) => updateConfig(key, val)}
                value={config()[key]}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
