import { Switch, Match } from 'solid-js';
import { css } from 'solid-styled-components';

import { cacheNoArgs } from '@/providers/decorators';

type SettingControlProps = {
  label: string;
  value: unknown;
  defaultValue: unknown;
  onChange: (value: unknown) => void;
};

const controlStyle = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    min-height: 32px;

    &:not(:last-child) {
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
  `,
);

const labelStyle = cacheNoArgs(
  () => css`
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
  `,
);

const inputStyle = cacheNoArgs(
  () => css`
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #f1f1f1;
    font-size: 13px;
    padding: 4px 8px;
    outline: none;
    max-width: 200px;

    &:focus {
      border-color: rgba(255, 255, 255, 0.3);
    }

    &:focus-visible {
      outline: 2px solid #3ea6ff;
      outline-offset: 1px;
    }
  `,
);

const sliderContainerStyle = cacheNoArgs(
  () => css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
);

const sliderStyle = cacheNoArgs(
  () => css`
    -webkit-appearance: none;
    width: 120px;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    outline: none;

    &:focus-visible {
      outline: 2px solid #3ea6ff;
      outline-offset: 2px;
    }

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      background: #3ea6ff;
      border-radius: 50%;
      cursor: pointer;
    }
  `,
);

const sliderValueStyle = cacheNoArgs(
  () => css`
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    min-width: 32px;
    text-align: right;
  `,
);

const toggleStyle = cacheNoArgs(
  () => css`
    position: relative;
    width: 36px;
    height: 20px;
    flex-shrink: 0;
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

const formatLabel = (key: string) =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();

export const SettingControl = (props: SettingControlProps) => {
  const valueType = () => typeof props.value;

  return (
    <div class={controlStyle()}>
      <span class={labelStyle()}>{formatLabel(props.label)}</span>
      <Switch>
        <Match when={valueType() === 'boolean'}>
          <label class={toggleStyle()}>
            <input
              type="checkbox"
              checked={props.value as boolean}
              onChange={(e) => props.onChange(e.currentTarget.checked)}
            />
            <span class="slider" />
          </label>
        </Match>
        <Match when={valueType() === 'number'}>
          <div class={sliderContainerStyle()}>
            <input
              class={sliderStyle()}
              type="range"
              min={0}
              max={
                typeof props.defaultValue === 'number'
                  ? Math.max(props.defaultValue * 2, 100)
                  : 100
              }
              step={Number.isInteger(props.value as number) ? 1 : 0.1}
              value={props.value as number}
              onInput={(e) => props.onChange(Number(e.currentTarget.value))}
            />
            <span class={sliderValueStyle()}>{String(props.value)}</span>
          </div>
        </Match>
        <Match when={valueType() === 'string'}>
          <input
            class={inputStyle()}
            type="text"
            value={props.value as string}
            onChange={(e) => props.onChange(e.currentTarget.value)}
          />
        </Match>
        <Match when={valueType() === 'object' || valueType() === 'undefined'}>
          <span
            style={{
              'color': 'rgba(255,255,255,0.3)',
              'font-size': '12px',
            }}
          >
            {props.value === null || props.value === undefined
              ? 'null'
              : JSON.stringify(props.value).slice(0, 50)}
          </span>
        </Match>
      </Switch>
    </div>
  );
};
