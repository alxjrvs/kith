import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { signupsForDay } from "../game-days/signups.ts";
import { agendaFor, type HubAgendaRow } from "./agenda.ts";
import { catalog, type CatalogEntry } from "./catalog.ts";
import { linksFor, pagesFor, type PageSummary, type TableLink } from "./knowledge.ts";
import { listingFor, type Listing } from "./listings.ts";
import { isMemberOf } from "./membership.ts";
import { personFrom, type Person } from "./people.ts";
import type { Viewer } from "./visibility.ts";

/**
 * Every game's home base, at `/games/<slug>`.
 *
 * There are only ever a handful of games, so the site is a hub of them rather
 * than a place to go looking. A "game" is one of two things:
 *
 * - a **campaign**, slugged by its id: the recurring table, its roster of
 *   players and characters, and its next sessions;
 * - a **board game** from the catalog, slugged by the game's id: its game days,
 *   each with who has a seat.
 *
 * A campaign wins a slug both could answer to, because the campaign is the
 * thing people come back to. Visibility is never decided here: every campaign
 * and every day goes through `listingFor`, which goes through `canSee`.
 */

/** How far ahead a home base looks for sessions and days. */
const HORIZON_DAYS = 120;

/** One seat at a table: a person (when the viewer may see who) and who they play. */
export interface Seat {
  /** Null when the viewer is not signed in: a public page shows characters, not people. */
  person: Person | null;
  character: string | null;
  role: "gm" | "player";
  /** `in` is on the table; `waitlisted` is queued behind capacity. */
  state: "in" | "waitlisted";
}

export interface CampaignHome {
  kind: "campaign";
  slug: string;
  listing: Listing;
  member: boolean;
  canEdit: boolean;
  /** The roster once it runs; the signups while it forms. GMs first. */
  roster: Seat[];
  upcoming: HubAgendaRow[];
  links: TableLink[];
  pages: PageSummary[];
}

export interface BoardDay {
  listing: Listing;
  seats: Seat[];
}

export interface BoardHome {
  kind: "board";
  slug: string;
  game: CatalogEntry;
  canEdit: boolean;
  upcoming: BoardDay[];
  /** How many days of it have been played, for a line of history. */
  played: number;
}

export type HomeBase = CampaignHome | BoardHome;

/** A card on the `/games` hub. */
export interface GameSummary {
  kind: "campaign" | "board";
  slug: string;
  name: string;
  /** A campaign's state; for a board game, SEATING when a day is taking seats. */
  state: string;
  /** "Daggerheart", or "Board game". */
  label: string | null;
  tagline: string | null;
  imageUrl: string | null;
  lead: Person | null;
  /** How many players the roster or the next day holds. */
  players: number;
  capacity: number | null;
  /** Unix seconds of the next session or day, if one is on the calendar. */
  next: number | null;
  /** The viewer is on it: roster, signup, seat, or host. */
  mine: boolean;
  /** Takes signups right now: a FORMING campaign, a SEATING day. */
  open: boolean;
}

export async function homeBase(env: Env, slug: string, viewer: Viewer, now = new Date()): Promise<HomeBase | undefined> {
  const campaign = await listingFor(env, "campaign", slug, viewer);
  if (campaign) return campaignHome(env, campaign, viewer, now);
  const game = (await catalog(env)).find((g) => g.id === slug && g.category === "board");
  if (game) return boardHome(env, game, viewer, now);
  return undefined;
}

async function campaignHome(env: Env, listing: Listing, viewer: Viewer, now: Date): Promise<CampaignHome> {
  const member = await isMemberOf(env, "campaign", listing.id, viewer.userId);
  const agenda = await agendaFor(env, viewer, "public", now, HORIZON_DAYS);
  return {
    kind: "campaign",
    slug: listing.id,
    listing,
    member,
    canEdit: viewer.organiser,
    roster: await campaignRoster(env, listing, viewer),
    upcoming: agenda.rows.filter((row) => row.campaignId === listing.id),
    links: await linksFor(env, "campaign", listing.id, viewer, member),
    pages: await pagesFor(env, "campaign", listing.id, viewer, member),
  };
}

async function campaignRoster(env: Env, listing: Listing, viewer: Viewer): Promise<Seat[]> {
  const d = db(env);
  const showPeople = viewer.userId !== undefined;
  const members = await d
    .select({ member: schema.campaignMembers, user: schema.users })
    .from(schema.campaignMembers)
    .innerJoin(schema.users, eq(schema.campaignMembers.userId, schema.users.discordId))
    .where(eq(schema.campaignMembers.campaignId, listing.id))
    .orderBy(asc(schema.campaignMembers.joinedAt))
    .all();
  const seats: Seat[] = members.map(({ member, user }) => ({
    // The GM is already public on the listing as its lead; the players are not.
    person: showPeople || member.role === "gm" ? personFrom(user) : null,
    character: member.characterName,
    role: member.role,
    state: "in",
  }));

  // While it forms, the people who have said they want in are the table so far.
  if (listing.state === "FORMING") {
    const onRoster = new Set(members.map((m) => m.member.userId));
    const claims = await d
      .select({ signup: schema.signups, user: schema.users })
      .from(schema.signups)
      .innerJoin(schema.users, eq(schema.signups.userId, schema.users.discordId))
      .where(
        and(
          eq(schema.signups.targetType, "campaign_forming"),
          eq(schema.signups.targetId, listing.id),
          inArray(schema.signups.state, ["in", "waitlisted"]),
        ),
      )
      .orderBy(asc(schema.signups.createdAt))
      .all();
    for (const { signup, user } of claims) {
      if (onRoster.has(signup.userId)) continue;
      seats.push({
        person: showPeople ? personFrom(user) : null,
        character: signup.characterName,
        role: "player",
        state: signup.state as Seat["state"],
      });
    }
  }

  // GMs first, then the table, then anyone queued.
  const rank = (s: Seat) => (s.role === "gm" ? 0 : s.state === "in" ? 1 : 2);
  return seats.sort((a, b) => rank(a) - rank(b));
}

async function boardHome(env: Env, game: CatalogEntry, viewer: Viewer, now: Date): Promise<BoardHome> {
  const nowUnix = Math.floor(now.getTime() / 1000);
  const horizon = nowUnix + HORIZON_DAYS * 86_400;
  const days = await db(env)
    .select({ id: schema.gameDays.id, state: schema.gameDays.state, endsAt: schema.gameDays.endsAt, startsAt: schema.gameDays.startsAt })
    .from(schema.gameDays)
    .where(and(eq(schema.gameDays.gameId, game.id), ne(schema.gameDays.state, "CANCELLED")))
    .orderBy(asc(schema.gameDays.startsAt))
    .all();

  const upcoming: BoardDay[] = [];
  let played = 0;
  for (const day of days) {
    const listing = await listingFor(env, "game-day", day.id, viewer);
    if (!listing) continue;
    if (day.state === "PLAYED" || day.endsAt <= nowUnix) {
      played += 1;
      continue;
    }
    if (day.startsAt >= horizon) continue;
    upcoming.push({ listing, seats: await daySeats(env, day.id, viewer) });
  }
  return { kind: "board", slug: game.id, game, canEdit: viewer.organiser, upcoming, played };
}

async function daySeats(env: Env, dayId: string, viewer: Viewer): Promise<Seat[]> {
  const showPeople = viewer.userId !== undefined;
  const signups = await signupsForDay(env, dayId);
  const ids = signups.map((s) => s.userId);
  const users = ids.length
    ? await db(env).select().from(schema.users).where(inArray(schema.users.discordId, ids)).all()
    : [];
  const byId = new Map(users.map((u) => [u.discordId, u]));
  return signups
    .filter((s) => s.state === "in" || s.state === "waitlisted")
    .map((s) => {
      const user = byId.get(s.userId);
      return {
        person: showPeople && user ? personFrom(user) : null,
        character: s.characterName ?? null,
        role: "player" as const,
        state: s.state as Seat["state"],
      };
    });
}

/**
 * The hub: every campaign the viewer may see that has not concluded, then every
 * board game with a day the viewer may see. Concluded campaigns come last so
 * their pages are still one click away.
 */
export async function gamesFor(env: Env, viewer: Viewer, now = new Date()): Promise<GameSummary[]> {
  const d = db(env);
  const agenda = await agendaFor(env, viewer, "public", now, HORIZON_DAYS);
  const nextFor = (campaignId: string) => agenda.rows.find((r) => r.campaignId === campaignId)?.startsAt ?? null;

  const out: GameSummary[] = [];
  const campaignIds = await d
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .orderBy(asc(schema.campaigns.name))
    .all();
  for (const { id } of campaignIds) {
    const listing = await listingFor(env, "campaign", id, viewer);
    if (!listing) continue;
    const mine = listing.mine !== null || (await isMemberOf(env, "campaign", id, viewer.userId));
    out.push({
      kind: "campaign",
      slug: id,
      name: listing.name,
      state: listing.state,
      label: listing.game?.name ?? null,
      tagline: listing.tagline,
      imageUrl: listing.heroUrl,
      lead: listing.lead,
      players: listing.taken,
      capacity: listing.capacity,
      next: nextFor(id),
      mine,
      open: listing.open,
    });
  }

  const nowUnix = Math.floor(now.getTime() / 1000);
  for (const game of (await catalog(env)).filter((g) => g.category === "board")) {
    const days = await d
      .select({ id: schema.gameDays.id, endsAt: schema.gameDays.endsAt, state: schema.gameDays.state })
      .from(schema.gameDays)
      .where(and(eq(schema.gameDays.gameId, game.id), ne(schema.gameDays.state, "CANCELLED")))
      .orderBy(asc(schema.gameDays.startsAt))
      .all();
    let seen = false;
    let next: Listing | undefined;
    for (const day of days) {
      const listing = await listingFor(env, "game-day", day.id, viewer);
      if (!listing) continue;
      seen = true;
      if (!next && day.state !== "PLAYED" && day.endsAt > nowUnix) next = listing;
    }
    // A board game nobody can see a day of is a catalog entry, not a game here yet.
    if (!seen) continue;
    out.push({
      kind: "board",
      slug: game.id,
      name: game.name,
      state: next?.state ?? "IDLE",
      label: "Board game",
      tagline: game.summary,
      imageUrl: game.coverUrl,
      lead: next?.lead ?? null,
      players: next?.taken ?? 0,
      capacity: next?.capacity ?? game.maxPlayers,
      next: next?.when.startsAt ?? null,
      mine: next?.mine !== null && next?.mine !== undefined,
      open: next?.open ?? false,
    });
  }

  const rank = (g: GameSummary) => (g.state === "CONCLUDED" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}
