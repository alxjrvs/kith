import type { Env } from "../env.ts";
import { socialCard, type SocialCard } from "../hub/social-card.ts";
import { cutMedia } from "./media-cut.ts";

/**
 * A game's link preview (src/hub/social-card.ts), written into the page its
 * URLs load. web/index.html carries Kith's own card; a public game's pages
 * swap in the game's, and every other page keeps Kith's.
 *
 * Crawlers (Discordbot, Slackbot, iMessage, Twitterbot) read only the HTML the
 * page arrives with, so this has to be there from the first byte: the app
 * setting tags once it boots is never seen.
 */

/** The size every preview image is cut to: what Discord and the rest show large. */
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Kith's own card (public/og.png), for a game with no art Kith can use. */
export const KITH_CARD = "/og.png";

export async function withSocialCard(env: Env, site: Response, slug: string, url: URL): Promise<Response> {
  let card: SocialCard | undefined;
  try {
    card = await socialCard(env, slug);
  } catch (error) {
    // A preview is never worth a broken page: Kith's own card stands.
    console.error("social card failed", slug, error);
  }
  return card ? rewrite(site, card, url) : site;
}

export function cardImageUrl(card: SocialCard, origin: string): string {
  if (!card.image) return new URL(KITH_CARD, origin).href;
  if ("url" in card.image) return card.image.url;
  return new URL(`/media/${card.image.key}/card`, origin).href;
}

function rewrite(site: Response, card: SocialCard, url: URL): Response {
  const page = new URL(url.pathname, url.origin).href;
  const image = cardImageUrl(card, url.origin);
  const description = card.description ?? "";
  const sized = card.image === null || "key" in card.image;
  const set = (content: string) => ({ element: (el: Element) => void el.setAttribute("content", content) });
  const drop = { element: (el: Element) => void el.remove() };

  let r = new HTMLRewriter()
    .on('meta[property="og:type"]', set("article"))
    .on('meta[property="og:url"]', set(page))
    .on('meta[property="og:title"]', set(card.title))
    .on('meta[name="twitter:title"]', set(card.title))
    .on('meta[property="og:image"]', set(image))
    .on('meta[name="twitter:image"]', set(image))
    .on('meta[property="og:image:alt"]', set(card.title));
  // An outside image is whatever size it is.
  if (!sized) r = r.on('meta[property="og:image:width"]', drop).on('meta[property="og:image:height"]', drop);
  // No description of its own: say nothing rather than Kith's.
  for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    r = r.on(sel, description ? set(description) : drop);
  }
  return r.transform(site);
}

/** `/media/<key>/card`: an uploaded image cut to a preview's size. */
export function cardImage(env: Env, request: Request, key: string): Promise<Response> {
  return cutMedia(env, request, key, {
    cachePath: `/media/${key}/card`,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    format: "image/jpeg",
    fallback: KITH_CARD,
  });
}
