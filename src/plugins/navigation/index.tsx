import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import style from './styles';
import { createPlugin } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { t } from '@/i18n';

import { ForwardButton } from './components/forward-button';
import { BackButton } from './components/back-button';

// YTM shows its 72px mini guide in this range, and on the search page the
// widened search box leaves no room for the buttons next to the logo.
const MINI_GUIDE_QUERY = '(min-width: 616px) and (max-width: 935px)';

export default createPlugin({
  name: () => t('plugins.navigation.name'),
  description: () => t('plugins.navigation.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  stylesheets: [style],
  renderer: {
    buttonContainer: null as HTMLDivElement | null,
    cleanup: null as (() => void) | null,
    start() {
      const container = document.createElement('div');
      container.className = 'ytmd-history-group';
      this.buttonContainer = container;

      const [canGoBack, setCanGoBack] = createSignal(false);
      const [canGoForward, setCanGoForward] = createSignal(false);
      const miniGuide = window.matchMedia(MINI_GUIDE_QUERY);

      const update = () => {
        setCanGoBack(window.navigation.canGoBack);
        setCanGoForward(window.navigation.canGoForward);
        container.hidden = miniGuide.matches && location.pathname === '/search';
      };
      update();

      // YTM never dispatches yt-navigate-finish (only yt-navigate-start), and
      // every SPA navigation, back and forward included, changes the current
      // Navigation API entry, so this one event keeps the state in sync.
      window.navigation.addEventListener('currententrychange', update);
      miniGuide.addEventListener('change', update);

      const dispose = render(
        () => (
          <>
            <BackButton
              disabled={!canGoBack()}
              onClick={() => history.back()}
              title={t('plugins.navigation.templates.back.title')}
            />
            <ForwardButton
              disabled={!canGoForward()}
              onClick={() => history.forward()}
              title={t('plugins.navigation.templates.forward.title')}
            />
          </>
        ),
        container,
      );

      this.cleanup = () => {
        window.navigation.removeEventListener('currententrychange', update);
        miniGuide.removeEventListener('change', update);
        dispose();
        container.remove();
      };

      // Gives up after 30 s instead of polling forever
      waitForElement<HTMLElement>('ytmusic-nav-bar #left-content', {
        maxRetry: 300,
      }).then((leftContent) => {
        // Stopped while waiting
        if (this.buttonContainer !== container) return;

        const logo = leftContent.querySelector(':scope > ytmusic-logo');
        if (logo) logo.after(container);
        else leftContent.append(container);
      });
    },
    stop() {
      this.cleanup?.();
      this.cleanup = null;
      this.buttonContainer = null;
    },
  },
});
