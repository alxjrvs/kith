import type { Env } from "../env.ts";
import { MEDIA_KEY } from "../cms/client.ts";
import { cmsGame } from "../cms/content.ts";
import { catalog } from "./catalog.ts";
import { listingFor } from "./listings.ts";
import type { Viewer } from "./visibility.ts";

/**
 * Each game's home base installs as an app of its own.
 *
 * Games are standalone: a person who plays in The Age of Umbra and Beast Feast
 * gets two icons, each opening straight onto its own game. So every game has its
 * own web app manifest and its own service worker registration, both scoped to
 * the game's path, and nothing about one game's app reaches into another's.
 * Leaving the scope (the hub, another game, the agenda) is still a link away,
 * which is all the cross-game coordination there needs to be.
 *
 * The scope is `/games/<slug>`, with no trailing slash, because that is the URL
 * every link and every Discord post already uses: a scope of `/games/<slug>/`
 * would leave the home base itself outside its own app. A slug that is a
 * prefix of another slug would share part of that scope; the service worker
 * (public/game-sw.js) only acts on its exact game, so all that can happen is a
 * link between the two staying inside the app.
 *
 * Visibility is decided where it always is, in `listingFor` and `catalog`. A
 * test game (staging) or a members-only one has no manifest for anyone who
 * cannot see it, and the answer is the same 404 as a game that is not there.
 */
export interface GameApp {
  slug: string;
  name: string;
  description: string | null;
  /**
   * The media key of the game's hero image, which its icon is cut from. Null
   * when it has none, or when it is an outside URL Kith cannot crop, and the
   * app wears Kith's own icon.
   */
  iconKey: string | null;
}

/** Ember Table's page colour (web/src/styles.css `--page`), which the splash also wears. */
export const APP_BACKGROUND = "#211d1b";

export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export function scopeOf(slug: string): string {
  return `/games/${encodeURIComponent(slug)}`;
}

/** The same two kinds of game that have a home base (src/hub/home-base.ts), and only as the viewer may see them. */
export async function gameApp(env: Env, slug: string, viewer: Viewer): Promise<GameApp | undefined> {
  const campaign = await listingFor(env, "campaign", slug, viewer);
  if (campaign) {
    return {
      slug,
      name: campaign.name,
      description: campaign.tagline,
      iconKey: mediaKeyOf(campaign.heroUrl),
    };
  }
  const game = (await catalog(env, viewer)).find((g) => g.id === slug && g.category === "board");
  if (game) {
    const hero = (await cmsGame(env, slug))?.heroUrl;
    return { slug, name: game.name, description: game.summary, iconKey: mediaKeyOf(hero) };
  }
  return undefined;
}

/** `/media/<key>` back to its key; anything else (an outside URL) has none. */
export function mediaKeyOf(url: string | null | undefined): string | null {
  const key = url?.startsWith("/media/") ? url.slice("/media/".length) : null;
  return key && MEDIA_KEY.test(key) ? key : null;
}

export function iconUrl(app: GameApp, size: IconSize): string {
  return app.iconKey ? `/media/${app.iconKey}/icon/${size}` : size === 180 ? "/apple-touch-icon.png" : `/icon-${size}.png`;
}

/**
 * The manifest. Every URL in it is a path on this origin, so it reads the same
 * on kith.alxjrvs.com, on the domain Kith moves to, and on workers.dev.
 */
export function manifestFor(app: GameApp) {
  const scope = scopeOf(app.slug);
  return {
    id: scope,
    name: app.name,
    short_name: app.name,
    ...(app.description ? { description: app.description } : {}),
    start_url: scope,
    scope,
    display: "standalone",
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    icons: [
      { src: iconUrl(app, 192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconUrl(app, 512), sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
