import { createPlugin } from '@/utils';
import { t } from '@/i18n';
import { onRendererLoad } from './renderer';

export default createPlugin({
  name: () => t('plugins.settings-page.name'),
  description: () => t('plugins.settings-page.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  renderer: {
    start: onRendererLoad,
  },
});
