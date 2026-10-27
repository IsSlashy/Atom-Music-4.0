import { queryControl } from '@/providers/ytm-selectors';

export const isMusicOrVideoTrack = (menu: ParentNode = document) => {
  for (const menuSelector of menu.querySelectorAll<
    HTMLAnchorElement & {
      data: {
        watchEndpoint: {
          videoId: string;
        };
        addToPlaylistEndpoint: {
          videoId: string;
        };
        clickTrackingParams: string;
      };
    }
  >('tp-yt-paper-listbox #navigation-endpoint')) {
    if (
      menuSelector?.data?.addToPlaylistEndpoint?.videoId ||
      menuSelector?.data?.watchEndpoint?.videoId
    ) {
      return true;
    }
  }
  return false;
};

export const isAlbumOrPlaylist = () => {
  for (const menuSelector of document.querySelectorAll<
    HTMLAnchorElement & {
      data: {
        addToPlaylistEndpoint: {
          playlistId: string;
        };
        clickTrackingParams: string;
      };
    }
  >('tp-yt-paper-listbox #navigation-endpoint')) {
    if (
      menuSelector?.data?.addToPlaylistEndpoint?.playlistId ||
      // Logged out, "Save to playlist" is a sign-in prompt without a
      // playlistId, but the menu still links to the album or playlist
      menuSelector?.getAttribute('href')?.includes('watch?playlist=')
    ) {
      return true;
    }
  }
  return false;
};

export const isPlayerMenu = (menu?: HTMLElement | null) => {
  // The element that opened the menu
  const eventSink = (
    menu?.parentElement as
      | (HTMLElement & {
          ytEventForwardingBehavior: {
            forwarder_: {
              eventSink: HTMLElement;
            };
          };
        })
      | null
  )?.ytEventForwardingBehavior?.forwarder_?.eventSink;

  // The player bar's menu button, in either player bar
  const menuButton = queryControl('menuButton');
  return !!eventSink && !!menuButton && menuButton.contains(eventSink);
};
