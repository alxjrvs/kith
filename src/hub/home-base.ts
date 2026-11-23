import { and, asc, count, desc, eq, gt, inArray, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { signupsForDay } from "../game-days/signups.ts";
import { agendaFor, type HubAgendaRow } from "./agenda.ts";
import { catalog, type CatalogEntry } from "./catalog.ts";
import { linksFor, pagesFor, type PageSummary, type TableLink } from "./knowledge.ts";
import { listingFor, type Listing } from "./listings.ts";
import { isMemberOf, isPlayingIn } from "./membership.ts";
import { personFrom, type Person } from "./people.ts";
import type { Viewer } from "./visibility.ts";
import { charactersFor, type CmsCharacter } from "../cms/content.ts";
import { isGmOf } from "../sessions/title.ts";

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
  /**
   * Null unless the viewer is on the table or an organiser: anyone else sees the
   * characters, not the people. A campaign's GM is always shown, as the listing's
   * lead already is.
   */
  person: Person | null;
  character: string | null;
  /** The character's sheet: the player's own link, or kith-cms's. */
  sheetUrl: string | null;
  /** A few words about the character, as the player wrote them. */
  description: string | null;
  /** This seat is the viewer's own, and its character theirs to write. */
  mine: boolean;
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
  /**
   * The sessions already played, newest first, each with its episode name if
   * it has one. Empty signed out: the public page says nothing about when.
   * Signed in, it goes wherever the upcoming sessions already go.
   */
  past: PastSession[];
  /** The viewer may name past sessions: the table's GM, or an organiser. */
  canName: boolean;
  /** The viewer's own subscribable feed of this game; null signed out, or when the feed would refuse them. */
  calendarUrl: string | null;
  links: TableLink[];
  pages: PageSummary[];
}

/** One evening already played, as the game page lists it. */
export interface PastSession {
  sessionId: string;
  /** Session number within the campaign, when it has one. Display only. */
  number: number | null;
  startsAt: number;
  /** The episode's name, given afterwards. */
  title: string | null;
}

/** Enough for years of a fortnightly game, without letting one page grow forever. */
const PAST_LIMIT = 200;

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
  /** The viewer's own subscribable feed of this game's days; null signed out. */
  calendarUrl: string | null;
  /** How many days of it have been played, for a line of history. */
  played: number;
}

export type HomeBase = CampaignHome | BoardHome;

/**
 * A card on the `/games` hub. `day` is a game day with no board game to hang
 * off (a multi-table day, a one-shot): it has no home base, so its card goes to
 * the day's own page.
 */
export interface GameSummary {
  kind: "campaign" | "board" | "day";
  slug: string;
  name: string;
  /** A campaign's state; for a board game, SEATING when a day is taking seats. */
  state: string;
  /** "Daggerheart", or "Board game". */
  label: string | null;
  tagline: string | null;
  /** The longer description, in Markdown: what the slideshow shows under the tagline. */
  pitch: string | null;
  imageUrl: string | null;
  /** A campaign's logo, worn on its card over the image. */
  logoUrl: string | null;
  lead: Person | null;
  /** The game's theme: a link or uploaded file, played only when someone asks. */
  soundUrl: string | null;
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

export async function homeBase(
  env: Env,
  slug: string,
  viewer: Viewer,
  origin: string,
  now = new Date(),
): Promise<HomeBase | undefined> {
  const campaign = await listingFor(env, "campaign", slug, viewer);
  if (campaign) return campaignHome(env, campaign, viewer, origin, now);
  const game = (await catalog(env, viewer)).find((g) => g.id === slug && g.category === "board");
  if (game) return boardHome(env, game, viewer, origin, now);
  return undefined;
}

/**
 * The viewer's own feed URL for one game, from their feed token, offered only
 * to the players in it (`isPlayingIn`): a campaign's roster, or somebody In on
 * one of a board game's coming days. Everyone else, organisers included, gets
 * no link.
 */
async function calendarUrlFor(
  env: Env,
  viewer: Viewer,
  origin: string,
  path: "campaign" | "game",
  id: string,
  dayIds: string[] = [],
): Promise<string | null> {
  if (!viewer.userId) return null;
  const userId = viewer.userId;
  const playing =
    path === "campaign"
      ? await isPlayingIn(env, "campaign", id, userId)
      : (await Promise.all(dayIds.map((day) => isPlayingIn(env, "game-day", day, userId)))).some(Boolean);
  if (!playing) return null;
  const holder = await db(env)
    .select({ feedToken: schema.users.feedToken })
    .from(schema.users)
    .where(eq(schema.users.discordId, viewer.userId))
    .get();
  if (!holder) return null;
  return `${origin}/ics/${encodeURIComponent(holder.feedToken)}/${path}/${encodeURIComponent(id)}.ics`;
}

async function campaignHome(env: Env, listing: Listing, viewer: Viewer, origin: string, now: Date): Promise<CampaignHome> {
  const member = await isMemberOf(env, "campaign", listing.id, viewer.userId);
  const agenda = await agendaFor(env, viewer, "public", now, HORIZON_DAYS);
  return {
    kind: "campaign",
    slug: listing.id,
    listing,
    member,
    canEdit: viewer.organiser,
    roster: await campaignRoster(env, listing, viewer.organiser || member, viewer.userId),
    upcoming: agenda.rows.filter((row) => row.campaignId === listing.id),
    past: viewer.userId ? await pastSessions(env, listing.id, now) : [],
    canName: viewer.organiser || (await isGmOf(env, listing.id, viewer.userId)),
    calendarUrl: await calendarUrlFor(env, viewer, origin, "campaign", listing.id),
    links: await linksFor(env, "campaign", listing.id, viewer, member),
    pages: await pagesFor(env, "campaign", listing.id, viewer, member),
  };
}

/**
 * Every session of the campaign that has started and was not called off or
 * left in JEOPARDY (`wasPlayed` in src/sessions/title.ts), newest first. A session the clock
 * has not yet marked PLAYED still counts once it has begun: the evening happened, and its GM may want to name it that night.
 */
async function pastSessions(env: Env, campaignId: string, now: Date): Promise<PastSession[]> {
  const nowUnix = Math.floor(now.getTime() / 1000);
  return db(env)
    .select({
      sessionId: schema.sessions.id,
      number: schema.sessions.number,
      startsAt: schema.sessions.startsAt,
      title: schema.sessions.title,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.campaignId, campaignId),
        notInArray(schema.sessions.state, ["CANCELLED", "JEOPARDY"]),
        lte(schema.sessions.startsAt, nowUnix),
      ),
    )
    .orderBy(desc(schema.sessions.startsAt))
    .limit(PAST_LIMIT)
    .all();
}

async function campaignRoster(
  env: Env,
  listing: Listing,
  showPeople: boolean,
  viewerId: string | undefined,
): Promise<Seat[]> {
  const d = db(env);
  const members = await d
    .select({ member: schema.campaignMembers, user: schema.users })
    .from(schema.campaignMembers)
    .innerJoin(schema.users, eq(schema.campaignMembers.userId, schema.users.discordId))
    .where(eq(schema.campaignMembers.campaignId, listing.id))
    .orderBy(asc(schema.campaignMembers.joinedAt))
    .all();
  // A character is written in kith-cms, per game and player (docs/CMS.md),
  // or by the player themselves on this page. Theirs wins once they've
  // written it; until then the CMS's wins over the name given at signup.
  const characters = await charactersFor(env, listing.id);
  const characterOf = (user: { discordId: string; username: string | null }, fallback: string | null) => {
    const c: CmsCharacter | undefined =
      characters.get(user.discordId) ?? (user.username ? characters.get(user.username.toLowerCase()) : undefined);
    return { character: c?.name ?? fallback, sheetUrl: c?.sheetUrl ?? null, description: null };
  };
  const seats: Seat[] = members.map(({ member, user }) => ({
    person: showPeople || member.role === "gm" ? personFrom(user) : null,
    ...(member.characterSetAt !== null
      ? {
          character: member.characterName,
          sheetUrl: member.characterSheetUrl,
          description: member.characterDescription,
        }
      : characterOf(user, member.characterName)),
    mine: viewerId !== undefined && member.userId === viewerId && member.role === "player",
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
        ...characterOf(user, signup.characterName),
        mine: false,
        role: "player",
        state: signup.state as Seat["state"],
      });
    }
  }

  // GMs first, then the table, then anyone queued.
  const rank = (s: Seat) => (s.role === "gm" ? 0 : s.state === "in" ? 1 : 2);
  return seats.sort((a, b) => rank(a) - rank(b));
}

/**
 * The days still to come for one game (or, with `null`, for no board game at
 * all), oldest first, as the viewer may see them. Past days are never loaded:
 * history only grows, and this runs on every hub load.
 */
async function upcomingDays(env: Env, gameId: string | null, viewer: Viewer, now: Date): Promise<Listing[]> {
  const nowUnix = Math.floor(now.getTime() / 1000);
  const days = await db(env)
    .select({ id: schema.gameDays.id })
    .from(schema.gameDays)
    .where(
      and(
        gameId === null ? isNull(schema.gameDays.gameId) : eq(schema.gameDays.gameId, gameId),
        inArray(schema.gameDays.state, ["PROPOSED", "SEATING", "LOCKED"]),
        gt(schema.gameDays.endsAt, nowUnix),
        lte(schema.gameDays.startsAt, nowUnix + HORIZON_DAYS * 86_400),
      ),
    )
    .orderBy(asc(schema.gameDays.startsAt))
    .all();
  const out: Listing[] = [];
  for (const day of days) {
    const listing = await listingFor(env, "game-day", day.id, viewer);
    if (listing) out.push(listing);
  }
  return out;
}

/** How many days of a game have been played: a line of history, so a count, not rows. */
async function playedCount(env: Env, gameId: string, now: Date): Promise<number> {
  const nowUnix = Math.floor(now.getTime() / 1000);
  const row = await db(env)
    .select({ n: count() })
    .from(schema.gameDays)
    .where(
      and(
        eq(schema.gameDays.gameId, gameId),
        ne(schema.gameDays.state, "CANCELLED"),
        or(eq(schema.gameDays.state, "PLAYED"), lte(schema.gameDays.endsAt, nowUnix)),
      ),
    )
    .get();
  return row?.n ?? 0;
}

async function boardHome(env: Env, game: CatalogEntry, viewer: Viewer, origin: string, now: Date): Promise<BoardHome> {
  const upcoming: BoardDay[] = [];
  for (const listing of await upcomingDays(env, game.id, viewer, now)) {
    upcoming.push({ listing, seats: await daySeats(env, listing, viewer) });
  }
  return {
    kind: "board",
    slug: game.id,
    game,
    canEdit: viewer.organiser,
    upcoming,
    calendarUrl: await calendarUrlFor(env, viewer, origin, "game", game.id, upcoming.map((day) => day.listing.id)),
    played: await playedCount(env, game.id, now),
  };
}

async function daySeats(env: Env, listing: Listing, viewer: Viewer): Promise<Seat[]> {
  const signups = (await signupsForDay(env, listing.id)).filter((s) => s.state === "in" || s.state === "waitlisted");
  // On the table is a live claim or hosting, as `isMemberOf` says; a listing's
  // `mine` is the first, and the host is its lead.
  const showPeople = viewer.organiser || listing.mine !== null || (viewer.userId !== undefined && listing.lead?.id === viewer.userId);
  const ids = signups.map((s) => s.userId);
  const users = showPeople && ids.length
    ? await db(env).select().from(schema.users).where(inArray(schema.users.discordId, ids)).all()
    : [];
  const byId = new Map(users.map((u) => [u.discordId, u]));
  return signups.map((s) => {
    const user = byId.get(s.userId);
    return {
      person: user ? personFrom(user) : null,
      character: s.characterName ?? null,
      sheetUrl: null,
      description: null,
      mine: false,
      role: "player" as const,
      state: s.state as Seat["state"],
    };
  });
}

/**
 * The hub: every campaign the viewer may see, then every board game with a day
 * coming up the viewer may see or a day already played, then any day with no
 * board game to hang off. Concluded campaigns come last so their pages are
 * still one click away.
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
      label: listing.system ?? listing.game?.name ?? null,
      tagline: listing.tagline,
      pitch: listing.pitch,
      imageUrl: listing.heroUrl ?? listing.logoUrl,
      logoUrl: listing.heroUrl ? listing.logoUrl : null,
      lead: listing.lead,
      soundUrl: listing.soundUrl,
      players: listing.taken,
      capacity: listing.capacity,
      next: nextFor(id),
      mine,
      open: listing.open,
    });
  }

  const games = await catalog(env, viewer);
  for (const game of games.filter((g) => g.category === "board")) {
    const days = await upcomingDays(env, game.id, viewer, now);
    // A board game with nothing coming and nothing played is a catalog entry, not a game here yet.
    if (days.length === 0 && (await playedCount(env, game.id, now)) === 0) continue;
    const next = days[0];
    const isMine = (l: Listing) => l.mine !== null || (viewer.userId !== undefined && l.lead?.id === viewer.userId);
    out.push({
      kind: "board",
      slug: game.id,
      name: game.name,
      state: days.some((l) => l.open) ? "SEATING" : (next?.state ?? "IDLE"),
      label: "Board game",
      tagline: game.summary,
      pitch: null,
      imageUrl: game.coverUrl,
      logoUrl: null,
      lead: next?.lead ?? null,
      soundUrl: next?.soundUrl ?? null,
      players: next?.taken ?? 0,
      capacity: next?.capacity ?? game.maxPlayers,
      next: next?.when.startsAt ?? null,
      mine: days.some(isMine),
      open: days.some((l) => l.open),
    });
  }

  // Days with no home base of their own: a multi-table day, or a single day of
  // a game that is not a board game. They still need to be findable.
  const boards = new Set(games.filter((g) => g.category === "board").map((g) => g.id));
  const loose = [
    ...(await upcomingDays(env, null, viewer, now)),
    ...(
      await Promise.all(games.filter((g) => !boards.has(g.id)).map((g) => upcomingDays(env, g.id, viewer, now)))
    ).flat(),
  ].sort((a, b) => (a.when.startsAt ?? 0) - (b.when.startsAt ?? 0));
  for (const day of loose) {
    out.push({
      kind: "day",
      slug: day.id,
      name: day.name,
      state: day.state,
      label: day.game?.name ?? "Game day",
      tagline: day.tagline,
      pitch: day.pitch,
      imageUrl: day.heroUrl,
      logoUrl: null,
      lead: day.lead,
      soundUrl: day.soundUrl,
      players: day.taken,
      capacity: day.capacity,
      next: day.when.startsAt,
      mine: day.mine !== null || (viewer.userId !== undefined && day.lead?.id === viewer.userId),
      open: day.open,
    });
  }

  const rank = (g: GameSummary) => (g.state === "CONCLUDED" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}
