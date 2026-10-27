import { injectCpuTamerByAnimationFrame } from './cpu-tamer-by-animationframe';
import { injectCpuTamerByDomMutation } from './cpu-tamer-by-dom-mutation';

// Read the app's own hardware acceleration switch rather than probing WebGL:
// the probe created a throwaway GPU context on every page load.
const isGPUAccelerationAvailable = () =>
  !window.mainConfig.get('options.disableHardwareAcceleration');

export const injectCpuTamer = () => {
  if (isGPUAccelerationAvailable()) {
    injectCpuTamerByAnimationFrame(null);
  } else {
    injectCpuTamerByDomMutation(null);
  }
};
