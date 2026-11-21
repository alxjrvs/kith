import { and, asc, eq, inArray } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import type { Visibility } from "../db/schema.ts";
import { capacityOf, signupsForDay } from "../game-days/signups.ts";
import { personFrom, type Person } from "./people.ts";
import { canSee, type Viewer } from "./visibility.ts";

/**
 * What the site says about a table people can join: a campaign that is still
 * forming, or a game day. One shape for both, so Find a game, the front page
 * and the splash page render either without asking which.
 */
export interface Listing {
  kind: "campaign" | "game-day";
  id: string;
  name: string;
  state: string;
  visibility: Visibility;
  /** True while it takes signups: a FORMING campaign, a SEATING day. */
  open: boolean;
  game: { id: string; name: string; category: "ttrpg" | "board" } | null;
  tagline: string | null;
  pitch: string | null;
  heroUrl: string | null;
  soundUrl: string | null;
  /** The GM of a campaign, the host of a day. */
  lead: Person | null;
  capacity: number | null;
  taken: number;
  waitlist: number;
  /** A campaign's cadence, or a day's start and end. Unix seconds. */
  when: {
    startsAt: number | null;
    endsAt: number | null;
    intervalWeeks: number | null;
  };
  /** "voice", a venue, or nothing said. */
  where: string | null;
  /** Where the viewer stands: null is "not signed up", or not signed in. */
  mine: "in" | "waitlisted" | null;
}

type CampaignRow = typeof schema.campaigns.$inferSelect;
type GameDayRow = typeof schema.gameDays.$inferSelect;
type GameRow = typeof schema.games.$inferSelect;

/** Every open table the viewer may see, campaigns first. */
export async function openListings(env: Env, viewer: Viewer): Promise<Listing[]> {
  const d = db(env);
  const campaigns = await d
    .select({ campaign: schema.campaigns, game: schema.games })
    .from(schema.campaigns)
    .leftJoin(schema.games, eq(schema.campaigns.gameId, schema.games.id))
    .where(eq(schema.campaigns.state, "FORMING"))
    .orderBy(asc(schema.campaigns.name))
    .all();

  const days = await d
    .select({ day: schema.gameDays, game: schema.games })
    .from(schema.gameDays)
    .leftJoin(schema.games, eq(schema.gameDays.gameId, schema.games.id))
    .where(eq(schema.gameDays.state, "SEATING"))
    .orderBy(asc(schema.gameDays.startsAt))
    .all();

  const out: Listing[] = [];
  for (const row of campaigns) {
    const listing = await campaignListing(env, row.campaign, row.game, viewer);
    if (listing) out.push(listing);
  }
  for (const row of days) {
    const listing = await gameDayListing(env, row.day, row.game, viewer);
    if (listing) out.push(listing);
  }
  return out;
}

/** One listing, for its splash page. Undefined is both "no such thing" and "not yours to see". */
export async function listingFor(
  env: Env,
  kind: Listing["kind"],
  id: string,
  viewer: Viewer,
): Promise<Listing | undefined> {
  const d = db(env);
  if (kind === "campaign") {
    const row = await d
      .select({ campaign: schema.campaigns, game: schema.games })
      .from(schema.campaigns)
      .leftJoin(schema.games, eq(schema.campaigns.gameId, schema.games.id))
      .where(eq(schema.campaigns.id, id))
      .get();
    return row ? campaignListing(env, row.campaign, row.game, viewer) : undefined;
  }
  const row = await d
    .select({ day: schema.gameDays, game: schema.games })
    .from(schema.gameDays)
    .leftJoin(schema.games, eq(schema.gameDays.gameId, schema.games.id))
    .where(eq(schema.gameDays.id, id))
    .get();
  return row ? gameDayListing(env, row.day, row.game, viewer) : undefined;
}

async function campaignListing(
  env: Env,
  campaign: CampaignRow,
  game: GameRow | null,
  viewer: Viewer,
): Promise<Listing | undefined> {
  const d = db(env);
  const claims = await d
    .select({ userId: schema.signups.userId, state: schema.signups.state })
    .from(schema.signups)
    .where(
      and(
        eq(schema.signups.targetType, "campaign_forming"),
        eq(schema.signups.targetId, campaign.id),
        inArray(schema.signups.state, ["in", "waitlisted"]),
      ),
    )
    .all();
  const members = await d
    .select({ member: schema.campaignMembers, user: schema.users })
    .from(schema.campaignMembers)
    .innerJoin(schema.users, eq(schema.campaignMembers.userId, schema.users.discordId))
    .where(eq(schema.campaignMembers.campaignId, campaign.id))
    .all();

  const mineClaim = claims.find((c) => c.userId === viewer.userId);
  const isMember =
    mineClaim !== undefined || members.some((m) => m.member.userId === viewer.userId);
  if (!canSee(campaign.visibility, viewer, isMember)) return undefined;

  const gm = members.find((m) => m.member.role === "gm");
  return {
    kind: "campaign",
    id: campaign.id,
    name: campaign.name,
    state: campaign.state,
    visibility: campaign.visibility,
    open: campaign.state === "FORMING",
    game: gameOf(game),
    tagline: campaign.tagline,
    pitch: campaign.pitch,
    heroUrl: campaign.heroUrl,
    soundUrl: campaign.soundUrl,
    lead: gm ? personFrom(gm.user) : null,
    capacity: campaign.capacity,
    // While forming, the seats are the signups; once it runs, the roster.
    taken:
      campaign.state === "FORMING"
        ? claims.filter((c) => c.state === "in").length
        : members.filter((m) => m.member.role === "player").length,
    waitlist: claims.filter((c) => c.state === "waitlisted").length,
    when: {
      startsAt: campaign.recurrenceAnchor,
      endsAt: null,
      intervalWeeks: campaign.intervalWeeks,
    },
    where: campaign.locationType === "voice" ? "voice" : null,
    mine: mineClaim ? (mineClaim.state as "in" | "waitlisted") : null,
  };
}

async function gameDayListing(
  env: Env,
  day: GameDayRow,
  game: GameRow | null,
  viewer: Viewer,
): Promise<Listing | undefined> {
  const signups = await signupsForDay(env, day.id);
  const mine = signups.find((s) => s.userId === viewer.userId);
  const isMember = mine !== undefined || (viewer.userId !== undefined && day.hostUserId === viewer.userId);
  if (!canSee(day.visibility, viewer, isMember)) return undefined;

  const host = day.hostUserId
    ? await db(env).select().from(schema.users).where(eq(schema.users.discordId, day.hostUserId)).get()
    : undefined;

  return {
    kind: "game-day",
    id: day.id,
    name: day.title ?? game?.name ?? "Game day",
    state: day.state,
    visibility: day.visibility,
    open: day.state === "SEATING",
    game: gameOf(game),
    tagline: day.tagline,
    pitch: day.pitch,
    heroUrl: day.heroUrl,
    soundUrl: day.soundUrl,
    lead: host ? personFrom(host) : null,
    capacity: await capacityOf(env, day.id),
    taken: signups.filter((s) => s.state === "in").length,
    waitlist: signups.filter((s) => s.state === "waitlisted").length,
    when: { startsAt: day.startsAt, endsAt: day.endsAt, intervalWeeks: null },
    where: day.venue,
    mine: mine && mine.state !== "out" ? (mine.state as "in" | "waitlisted") : null,
  };
}

function gameOf(game: GameRow | null): Listing["game"] {
  return game ? { id: game.id, name: game.name, category: game.category } : null;
}
