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
    if (menuSelector?.data?.addToPlaylistEndpoint?.playlistId) {
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

  return (
    !!eventSink &&
    // Classic player bar, or the new one's "more" button
    (eventSink.matches('ytmusic-menu-renderer.ytmusic-player-bar') ||
      !!eventSink.closest('.ytMusicMiniPlayerMenuButton'))
  );
};
