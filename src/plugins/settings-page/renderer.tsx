import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { SettingsPage } from './renderer/SettingsPage';

import type { RendererContext } from '@/types/contexts';
import type { PluginConfig } from '@/types/plugins';

const [isOpen, setIsOpen] = createSignal(false);

export const onRendererLoad = ({ ipc }: RendererContext<PluginConfig>) => {
  const container = document.createElement('div');
  container.id = 'ytmd-settings-container';
  document.body.appendChild(container);

  render(
    () => <SettingsPage onClose={() => setIsOpen(false)} open={isOpen} />,
    container,
  );

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    }
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      setIsOpen(false);
    }
  });

  ipc.on('open-settings', () => setIsOpen(true));
};
