import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import { injectRm3 } from './scripts/rm3';
import { injectCpuTamer } from './scripts/cpu-tamer';

export type PerformanceImprovementPluginConfig = {
  enabled: boolean;
  /**
   * Align page timers to animation frames with cpu-tamer while media plays.
   * Off by default: on a 240 Hz display the app used more CPU during playback
   * with it than without it.
   * @default false
   */
  cpuTamer: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  unknown,
  PerformanceImprovementPluginConfig
>({
  name: () => t('plugins.performance-improvement.name'),
  description: () => t('plugins.performance-improvement.description'),
  restartNeeded: true,
  addedVersion: '3.9.X',
  config: {
    enabled: true,
    cpuTamer: false,
  },
  async renderer({ getConfig }) {
    injectRm3();

    const config = await getConfig();
    if (config.cpuTamer) {
      injectCpuTamer();
    }
  },
});
