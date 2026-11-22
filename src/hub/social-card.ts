import type { Env } from "../env.ts";
import { cmsGame, toMarkdown } from "../cms/content.ts";
import { catalog } from "./catalog.ts";
import { mediaKeyOf } from "./game-app.ts";
import { listingFor } from "./listings.ts";
import { ANONYMOUS } from "./visibility.ts";

/**
 * What a link to a game unfurls as: in Discord, iMessage, Slack, wherever a
 * game's URL is pasted. The title, a line or two about it, and its art.
 *
 * A preview is shown to everybody in the room the link lands in, whoever
 * pasted it, so it is always read as a stranger would see the game: never as
 * the person asking for the page. A test game (staging) or a members-only one
 * has no card at all, and its link unfurls as Kith itself, exactly as one to a
 * game that is not there.
 */
export interface SocialCard {
  slug: string;
  title: string;
  description: string | null;
  /** The art: a media key Kith can cut to size, or an outside URL used as it is. */
  image: { key: string } | { url: string } | null;
}

/** About what Discord shows before it cuts a description off. */
export const DESCRIPTION_MAX = 200;

/** The same two kinds of game that have a home base (src/hub/home-base.ts), and only the public ones. */
export async function socialCard(env: Env, slug: string): Promise<SocialCard | undefined> {
  const campaign = await listingFor(env, "campaign", slug, ANONYMOUS);
  if (campaign) {
    return {
      slug,
      title: campaign.name,
      description: describe(campaign.tagline, campaign.pitch),
      image: imageOf(campaign.heroUrl ?? campaign.logoUrl),
    };
  }
  const game = (await catalog(env, ANONYMOUS)).find((g) => g.id === slug && g.category === "board");
  if (game) {
    const words = await cmsGame(env, slug);
    return {
      slug,
      title: game.name,
      description: describe(game.summary, words ? toMarkdown(words.pitch) : null),
      image: imageOf(words?.heroUrl ?? game.coverUrl),
    };
  }
  return undefined;
}

function imageOf(url: string | null | undefined): SocialCard["image"] {
  if (!url) return null;
  const key = mediaKeyOf(url);
  if (key) return { key };
  return /^https:\/\//.test(url) ? { url } : null;
}

/**
 * The tagline, then as much of the pitch as fits, as plain text: a preview
 * shows Markdown as the characters it is written with.
 */
export function describe(tagline: string | null | undefined, pitch: string | null | undefined): string | null {
  const parts = [tagline, pitch].map((s) => (s ? plain(s) : "")).filter(Boolean);
  // A pitch that opens by repeating the tagline says it once.
  if (parts.length === 2 && parts[1]!.startsWith(parts[0]!)) parts.shift();
  const text = parts.join(" ");
  return text ? clip(text, DESCRIPTION_MAX) : null;
}

function plain(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const atWord = cut.slice(0, cut.lastIndexOf(" "));
  return `${(atWord.length > max * 0.6 ? atWord : cut).replace(/[\s,;:.]+$/, "")}…`;
}
