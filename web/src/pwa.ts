import { useEffect } from "react";

/**
 * Makes the page a game's own installable app (src/hub/game-app.ts): links the
 * game's manifest and registers its service worker (public/game-sw.js), scoped
 * to `/games/<slug>` so each game installs, caches and updates on its own.
 *
 * A page load in a game already arrives with the manifest linked by the
 * Worker; this covers arriving by a link inside the site, and takes the link
 * away again on leaving, so the hub never offers to install the last game seen.
 * Pass the slug only once the game has loaded: a game the viewer cannot see
 * gets no manifest and no worker.
 */
export function useGameApp(slug: string | undefined): void {
  useEffect(() => {
    if (!slug) return;
    const scope = `/games/${encodeURIComponent(slug)}`;
    const href = `${scope}/manifest.webmanifest`;
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      link.crossOrigin = "use-credentials";
      document.head.append(link);
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/game-sw.js", { scope }).catch((error: unknown) => {
        console.warn("this game could not be made installable", error);
      });
    }
    return () => link.remove();
  }, [slug]);
}
