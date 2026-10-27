import style from './styles';
import { createPlugin } from '@/utils';
import { t } from '@/i18n';

type OpenPopupActionDetail = {
  actionName?: string;
  args?: [
    {
      openPopupAction?: {
        popup?: {
          modalWithTitleAndButtonRenderer?: {
            button?: {
              buttonRenderer?: {
                navigationEndpoint?: { signInEndpoint?: unknown };
              };
            };
          };
        };
      };
    }?,
  ];
};

// Logged out, Like, Dislike and the "Save" actions open a dropdown whose only
// button is "Sign in". YTM opens it through a yt-open-popup-action event, so
// the event is stopped before the app handles it. Other popups, such as the
// player bar menu, still open.
const blockSignInPopup = (event: Event) => {
  const { detail } = event as CustomEvent<OpenPopupActionDetail>;
  if (detail?.actionName !== 'yt-open-popup-action') return;

  const modal =
    detail.args?.[0]?.openPopupAction?.popup?.modalWithTitleAndButtonRenderer;
  if (modal?.button?.buttonRenderer?.navigationEndpoint?.signInEndpoint) {
    event.stopImmediatePropagation();
  }
};

export default createPlugin({
  name: () => t('plugins.no-google-login.name'),
  description: () => t('plugins.no-google-login.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  stylesheets: [style],
  renderer: {
    start() {
      const elementsToRemove = [
        '.sign-in-link.ytmusic-nav-bar',
        '.ytmusic-pivot-bar-renderer[tab-id="FEmusic_liked"]',
      ];

      for (const selector of elementsToRemove) {
        const node = document.querySelector(selector);
        if (node) {
          node.remove();
        }
      }

      // Capture phase on the document runs before ytmusic-app's own listener
      document.addEventListener('yt-action', blockSignInPopup, true);
    },
    stop() {
      document.removeEventListener('yt-action', blockSignInPopup, true);
    },
  },
});
