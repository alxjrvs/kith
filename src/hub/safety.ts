import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { SETTING_KEYS, getSetting, requireGuildId } from "../db/settings.ts";
import { throughGovernor } from "../discord/governor.ts";
import { asDiscordFailure, postMessage } from "../discord/rest.ts";
import { escapeMarkdown } from "../discord/markdown.ts";
import { schedulingChannel } from "../projection/staging.ts";
import { rearmStatement } from "../jobs/arm.ts";
import { catalog } from "./catalog.ts";
import { listingFor } from "./listings.ts";
import { personFrom, type Person } from "./people.ts";
import type { Viewer } from "./visibility.ts";

/**
 * Two things every game's home base has for the people on it: a stop sign and
 * a suggestion box.
 *
 * Both belong to one game, named the way the home base names it (a campaign by
 * its id, a board game by the game's id), and both are open to anybody signed
 * in who can see that game. Who may see a game is never decided here: it is
 * `listingFor` and `catalog`, as for the home base itself.
 */
export type GameKind = (typeof schema.GAME_KINDS)[number];

export interface GameRef {
  kind: GameKind;
  id: string;
  name: string;
  staging: boolean;
  /** The game's own Discord channel, when it has one. */
  channelId: string | null;
}

/** The game behind a home base slug, if the viewer may see it. A campaign wins, as on the home base. */
export async function gameFor(env: Env, slug: string, viewer: Viewer): Promise<GameRef | undefined> {
  const listing = await listingFor(env, "campaign", slug, viewer);
  if (listing) {
    const row = await db(env)
      .select({ channelId: schema.campaigns.discordChannelId, staging: schema.campaigns.staging })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, slug))
      .get();
    if (!row) return undefined;
    return { kind: "campaign", id: slug, name: listing.name, staging: row.staging === 1, channelId: row.channelId };
  }
  const game = (await catalog(env, viewer)).find((g) => g.id === slug && g.category === "board");
  if (!game) return undefined;
  const row = await db(env)
    .select({ staging: schema.games.staging })
    .from(schema.games)
    .where(eq(schema.games.id, slug))
    .get();
  return { kind: "board", id: slug, name: game.name, staging: row?.staging === 1, channelId: null };
}

// ---------------------------------------------------------------------------
// The stop sign
// ---------------------------------------------------------------------------

export const STOP_SIGN_JOB = "stop-sign.deliver";
/** Two presses this close together are one press: a double tap, or a second try while the first was sending. */
const SAME_PRESS_SECONDS = 120;
/** The address the email comes from. Its domain has to be set up for Cloudflare Email. */
const DEFAULT_FROM = "kith@kith.town";
/**
 * Links in the email point at the site people use. Not PUBLIC_ORIGIN, which is
 * where Google pushes to and is still the workers.dev hostname.
 */
const SITE = "https://kith.town";
/**
 * How long a press is still worth delivering. An alert that turns up in the
 * channel after the evening is over helps nobody and alarms everybody, so the
 * Discord post gives up after half an hour; the organiser still wants to know
 * the next day, so the email keeps trying for one.
 */
const POST_WITHIN_SECONDS = 30 * 60;
const EMAIL_WITHIN_SECONDS = 24 * 3600;

export interface StopSignOutcome {
  id: string;
  /** Whether the alert is up in Discord, and whether the email went. */
  posted: boolean;
  /** Sent, but Discord never said so: it may be up. Never sent twice. */
  unconfirmed: boolean;
  emailed: boolean;
  /** Too old to deliver now, so Kith has stopped trying: the post after half an hour, the email after a day. */
  postGaveUp: boolean;
  emailGaveUp: boolean;
}

/**
 * Somebody pressed the stop sign. The row is written first, so the press is on
 * record whatever Discord and the mail say; then both go out straight away,
 * and a job sends again whatever didn't.
 */
export async function pressStopSign(env: Env, game: GameRef, userId: string): Promise<StopSignOutcome> {
  const d = db(env);
  const now = Math.floor(Date.now() / 1000);
  const recent = await d
    .select()
    .from(schema.stopSigns)
    .where(
      and(
        eq(schema.stopSigns.gameKind, game.kind),
        eq(schema.stopSigns.gameId, game.id),
        eq(schema.stopSigns.userId, userId),
        gt(schema.stopSigns.createdAt, now - SAME_PRESS_SECONDS),
      ),
    )
    .orderBy(desc(schema.stopSigns.createdAt))
    .get();
  if (recent) return deliverStopSign(env, recent.id);

  const id = crypto.randomUUID();
  await d.batch([
    d.insert(schema.stopSigns).values({ id, gameKind: game.kind, gameId: game.id, userId, createdAt: now }),
    // The safety net, a minute out so the send below has the first go.
    rearmStatement(d, [{ id: `${STOP_SIGN_JOB}:${id}`, kind: STOP_SIGN_JOB, payload: { stopSignId: id }, runAt: now + 60 }]),
  ]);
  return deliverStopSign(env, id);
}

/**
 * Send whatever of one press hasn't gone yet. Never throws for a delivery that
 * failed: the failure goes on the row, and the outcome says what is still
 * missing so the job can try again.
 */
export async function deliverStopSign(env: Env, id: string): Promise<StopSignOutcome> {
  const d = db(env);
  const row = await d.select().from(schema.stopSigns).where(eq(schema.stopSigns.id, id)).get();
  if (!row) return { id, posted: false, unconfirmed: false, emailed: false, postGaveUp: true, emailGaveUp: true };
  const now = Math.floor(Date.now() / 1000);
  const age = now - row.createdAt;
  let gaveUpPost = false;
  let gaveUpEmail = false;
  const user = await d.select().from(schema.users).where(eq(schema.users.discordId, row.userId)).get();
  const game = await gameNamed(env, row.gameKind, row.gameId);
  const who = user ? personFrom(user).name : "Someone";
  const handle = user?.username ? ` (@${user.username})` : "";
  const errors: string[] = [];

  let posted = row.discordMessageId !== null;
  // A channel recorded with no message is an attempt whose outcome is unknown
  // (Discord timed out, the isolate died). It may be up, and a second alert is
  // louder than a missing one is quiet, so it is never sent again; the console
  // shows it as unconfirmed.
  let unconfirmed = !posted && row.channelId !== null;
  if (!posted && !unconfirmed && age > POST_WITHIN_SECONDS) {
    gaveUpPost = true;
    errors.push("Discord: too late to post the alert now, so Kith stopped trying");
  } else if (!posted && !unconfirmed) {
    try {
      const channelId = game.channelId ?? (await schedulingChannel(env, game.staging));
      if (!channelId) throw new Error("this game has no Discord channel, and no scheduling channel is set");
      const guildId = await requireGuildId(env);
      // Claimed before the call, the way every post is.
      const claimed = await d
        .update(schema.stopSigns)
        .set({ channelId })
        .where(and(eq(schema.stopSigns.id, id), isNull(schema.stopSigns.channelId)))
        .returning({ id: schema.stopSigns.id });
      if (claimed.length === 0) {
        unconfirmed = true;
      } else {
        try {
          const message = await throughGovernor(env, guildId, () => postMessage(env, channelId, alertPayload(who, game.name)));
          await d.update(schema.stopSigns).set({ discordMessageId: message.id }).where(eq(schema.stopSigns.id, id));
          posted = true;
        } catch (error) {
          // A 4xx is Discord refusing, so nothing went up and the retry may send.
          // Anything else may have posted, and holding the claim is the safe half.
          const failure = asDiscordFailure(error);
          if (failure && failure.status >= 400 && failure.status < 500) {
            await d.update(schema.stopSigns).set({ channelId: null }).where(eq(schema.stopSigns.id, id));
          } else {
            unconfirmed = true;
          }
          throw error;
        }
      }
    } catch (error) {
      errors.push(`Discord: ${String(error)}`);
    }
  }

  let emailed = row.emailedAt !== null;
  if (!emailed && age > EMAIL_WITHIN_SECONDS) {
    gaveUpEmail = true;
    errors.push("Email: too late to send now, so Kith stopped trying");
  } else if (!emailed) {
    try {
      const to = env.STOP_SIGN_EMAIL_TO;
      if (!env.EMAIL || !to) throw new Error("email isn't set up yet (the EMAIL binding and STOP_SIGN_EMAIL_TO)");
      const at = await localTime(env, row.createdAt);
      // Claimed before the send, like the post, so two deliveries at once send one email.
      const claimed = await d
        .update(schema.stopSigns)
        .set({ emailedAt: now })
        .where(and(eq(schema.stopSigns.id, id), isNull(schema.stopSigns.emailedAt)))
        .returning({ id: schema.stopSigns.id });
      if (claimed.length > 0) {
        try {
          await env.EMAIL.send({
            from: { name: "Kith", email: env.EMAIL_FROM ?? DEFAULT_FROM },
            to,
            subject: `Stop sign pressed: ${game.name}`,
            text: [
              `${who}${handle} pressed the stop sign for ${game.name} at ${at}.`,
              "",
              posted
                ? "Kith posted an alert naming them in the game's Discord channel."
                : unconfirmed
                  ? "Kith tried to post the alert in Discord but couldn't confirm it went up. Check the channel."
                  : "Kith couldn't post the alert in Discord yet. It will keep trying for half an hour.",
              "",
              `The game: ${SITE}/games/${encodeURIComponent(row.gameId)}`,
            ].join("\n"),
          });
        } catch (error) {
          await d.update(schema.stopSigns).set({ emailedAt: null }).where(eq(schema.stopSigns.id, id));
          throw error;
        }
      }
      emailed = true;
    } catch (error) {
      errors.push(`Email: ${String(error)}`);
    }
  }

  await d
    .update(schema.stopSigns)
    .set({ lastError: errors.length ? errors.join("\n") : null })
    .where(eq(schema.stopSigns.id, id));
  return { id, posted, unconfirmed, emailed, postGaveUp: gaveUpPost, emailGaveUp: gaveUpEmail };
}

/** The alert itself: who, which game, and nothing about why. */
export function alertPayload(who: string, game: string) {
  return {
    content: `🛑 **Stop sign.** ${escapeMarkdown(who)} pressed the stop sign for ${escapeMarkdown(game)}. Let's pause the game and check in with each other.`,
    allowed_mentions: { parse: [], roles: [] },
  };
}

/**
 * The job: try again, and stay on the books while anything is still missing
 * and still worth sending.
 */
export async function retryStopSign(env: Env, id: string): Promise<void> {
  const outcome = await deliverStopSign(env, id);
  const postSettled = outcome.posted || outcome.unconfirmed || outcome.postGaveUp;
  const emailSettled = outcome.emailed || outcome.emailGaveUp;
  if (!postSettled || !emailSettled) {
    const row = await db(env).select({ lastError: schema.stopSigns.lastError }).from(schema.stopSigns).where(eq(schema.stopSigns.id, id)).get();
    throw new Error(row?.lastError ?? "stop sign not delivered yet");
  }
}

/** A game by kind and id, whatever the viewer: the sender is Kith, not a person looking. */
async function gameNamed(env: Env, kind: GameKind, id: string): Promise<Omit<GameRef, "kind" | "id">> {
  const d = db(env);
  if (kind === "campaign") {
    const row = await d.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
    return { name: row?.name ?? id, staging: row?.staging === 1, channelId: row?.discordChannelId ?? null };
  }
  const row = await d.select().from(schema.games).where(eq(schema.games.id, id)).get();
  return { name: row?.name ?? id, staging: row?.staging === 1, channelId: null };
}

async function localTime(env: Env, seconds: number): Promise<string> {
  const timeZone = (await getSetting<string>(env, SETTING_KEYS.timezone)) ?? "America/New_York";
  return new Date(seconds * 1000).toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// ---------------------------------------------------------------------------
// The suggestion box
// ---------------------------------------------------------------------------

export const SUGGESTION_MAX = 2000;

/**
 * Leave a suggestion. Anonymous means the row has no author and keeps only the
 * day, and nothing else written here or anywhere names them.
 */
export async function leaveSuggestion(
  env: Env,
  game: GameRef,
  userId: string,
  body: string,
  anonymous: boolean,
): Promise<{ id: string }> {
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db(env)
    .insert(schema.suggestions)
    .values({
      id,
      gameKind: game.kind,
      gameId: game.id,
      authorUserId: anonymous ? null : userId,
      body,
      createdAt: anonymous ? now - (now % 86_400) : now,
    });
  return { id };
}

// ---------------------------------------------------------------------------
// The console
// ---------------------------------------------------------------------------

export interface SuggestionRow {
  id: string;
  game: { kind: GameKind; id: string; name: string };
  /** Null when it was left anonymously. */
  author: Person | null;
  body: string;
  createdAt: number;
  /** True when only the day is known: an anonymous one. */
  dayOnly: boolean;
  readAt: number | null;
}

export interface StopSignRow {
  id: string;
  game: { kind: GameKind; id: string; name: string };
  person: Person | null;
  createdAt: number;
  posted: boolean;
  /** Claimed but never confirmed: it may or may not be up. */
  unconfirmed: boolean;
  emailed: boolean;
  lastError: string | null;
}

export async function suggestionRows(env: Env, limit = 200): Promise<SuggestionRow[]> {
  const d = db(env);
  const rows = await d
    .select({ suggestion: schema.suggestions, user: schema.users })
    .from(schema.suggestions)
    .leftJoin(schema.users, eq(schema.suggestions.authorUserId, schema.users.discordId))
    // Ties broken by the random id, so suggestions left the same day come
    // back in no order that says which arrived first.
    .orderBy(desc(schema.suggestions.createdAt), schema.suggestions.id)
    .limit(limit)
    .all();
  const names = await gameNames(env, rows.map((r) => r.suggestion));
  return rows.map(({ suggestion, user }) => ({
    id: suggestion.id,
    game: { kind: suggestion.gameKind, id: suggestion.gameId, name: names.get(`${suggestion.gameKind}:${suggestion.gameId}`) ?? suggestion.gameId },
    author: user ? personFrom(user) : null,
    body: suggestion.body,
    createdAt: suggestion.createdAt,
    dayOnly: suggestion.authorUserId === null,
    readAt: suggestion.readAt,
  }));
}

export async function stopSignRows(env: Env, limit = 50): Promise<StopSignRow[]> {
  const d = db(env);
  const rows = await d
    .select({ sign: schema.stopSigns, user: schema.users })
    .from(schema.stopSigns)
    .leftJoin(schema.users, eq(schema.stopSigns.userId, schema.users.discordId))
    .orderBy(desc(schema.stopSigns.createdAt))
    .limit(limit)
    .all();
  const names = await gameNames(env, rows.map((r) => r.sign));
  return rows.map(({ sign, user }) => ({
    id: sign.id,
    game: { kind: sign.gameKind, id: sign.gameId, name: names.get(`${sign.gameKind}:${sign.gameId}`) ?? sign.gameId },
    person: user ? personFrom(user) : null,
    createdAt: sign.createdAt,
    posted: sign.discordMessageId !== null,
    unconfirmed: sign.discordMessageId === null && sign.channelId !== null,
    emailed: sign.emailedAt !== null,
    lastError: sign.lastError,
  }));
}

/**
 * Mark a suggestion read, or new again. Logged as the organiser who did it,
 * and as the suggestion's id alone: never anything about who wrote it.
 */
export async function markSuggestion(env: Env, id: string, read: boolean, actorId: string): Promise<boolean> {
  const d = db(env);
  const found = await d.select({ id: schema.suggestions.id }).from(schema.suggestions).where(eq(schema.suggestions.id, id)).get();
  if (!found) return false;
  await d.batch([
    d
      .update(schema.suggestions)
      .set({ readAt: read ? Math.floor(Date.now() / 1000) : null })
      .where(eq(schema.suggestions.id, id)),
    d.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: actorId,
      action: read ? "suggestion.read" : "suggestion.unread",
      targetType: "suggestion",
      targetId: id,
      detail: {},
    }),
  ]);
  return true;
}

async function gameNames(env: Env, rows: { gameKind: GameKind; gameId: string }[]): Promise<Map<string, string>> {
  const d = db(env);
  const campaignIds = [...new Set(rows.filter((r) => r.gameKind === "campaign").map((r) => r.gameId))];
  const gameIds = [...new Set(rows.filter((r) => r.gameKind === "board").map((r) => r.gameId))];
  const out = new Map<string, string>();
  if (campaignIds.length) {
    for (const c of await d.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).where(inArray(schema.campaigns.id, campaignIds)).all()) {
      out.set(`campaign:${c.id}`, c.name);
    }
  }
  if (gameIds.length) {
    for (const g of await d.select({ id: schema.games.id, name: schema.games.name }).from(schema.games).where(inArray(schema.games.id, gameIds)).all()) {
      out.set(`board:${g.id}`, g.name);
    }
  }
  return out;
}
