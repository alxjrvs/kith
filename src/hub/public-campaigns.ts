import type { Env } from "../env.ts";
import { MEDIA_KEY } from "../cms/client.ts";
import { gamesFor } from "./home-base.ts";
import { ANONYMOUS } from "./visibility.ts";

/**
 * `GET /api/hub/campaigns`: the campaigns Kith shows the world, for other
 * sites to list (alxjrvs.com's Campaigns section reads it).
 *
 * It is the hub's own `/homes` list, read as somebody who has not signed in,
 * whatever cookie arrives with the request: so it holds exactly what the site
 * already shows a stranger, and a signed-in organiser's browser cannot widen
 * it. Then it is narrowed again, to what a listing on another site needs:
 *
 * - only campaigns that are running or signing up (FORMING); never one on
 *   hiatus or over, never a game day or a board game;
 * - no people at all, not even the GM a listing names: a name on Kith is a
 *   Discord name, given to Kith, not to whatever site embeds this;
 * - no pitch: a listing elsewhere carries the tagline, and links here for more.
 *
 * Visibility, staging and the next session are decided where they always
 * are (`listingFor`, `siteVisibility`, `agendaFor`); nothing here decides them
 * a second way.
 */
export interface PublicCampaign {
  slug: string;
  name: string;
  state: "RUNNING" | "FORMING";
  /** Takes signups right now. */
  open: boolean;
  /** "Daggerheart" */
  system: string | null;
  tagline: string | null;
  /** The campaign's home base on Kith. */
  url: string;
  /** The hero art cut to 1200x630, or an outside URL as given. Absolute. */
  imageUrl: string | null;
  /** The crest, worn over the art. Absolute. */
  logoUrl: string | null;
  /** Unix seconds of the next session on the calendar. */
  next: number | null;
  players: number;
  capacity: number | null;
}

const SHOWN = new Set(["RUNNING", "FORMING"]);

export async function publicCampaigns(env: Env, origin: string, now = new Date()): Promise<PublicCampaign[]> {
  const games = await gamesFor(env, ANONYMOUS, now);
  return games
    .filter((g) => g.kind === "campaign" && SHOWN.has(g.state))
    .map((g) => ({
      slug: g.slug,
      name: g.name,
      state: g.state as PublicCampaign["state"],
      open: g.open,
      system: g.label,
      tagline: g.tagline,
      url: new URL(`/games/${encodeURIComponent(g.slug)}`, origin).href,
      imageUrl: absolute(g.imageUrl, origin, "/card"),
      logoUrl: absolute(g.logoUrl, origin, ""),
      next: g.next,
      players: g.players,
      capacity: g.capacity,
    }));
}

/** `/media/<key>` made absolute (with a cut, for the art); an https URL as it is; anything else, nothing. */
function absolute(url: string | null, origin: string, cut: string): string | null {
  if (!url) return null;
  if (/^https:\/\//.test(url)) return url;
  const key = url.match(/^\/media\/([^/]+)$/)?.[1];
  return key && MEDIA_KEY.test(key) ? new URL(`/media/${key}${cut}`, origin).href : null;
}
