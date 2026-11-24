import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { SETTING_KEYS, getSetting, requireGuildId } from "../db/settings.ts";
import { throughGovernor } from "../discord/governor.ts";
import { encodeCustomId } from "../discord/custom-id.ts";
import { escapeMarkdown } from "../discord/markdown.ts";
import { ButtonStyle, ComponentType } from "../discord/types.ts";
import {
  asDiscordFailure,
  createInvite,
  getGuildMember,
  isMissingPermission,
  isClosedDm,
  isUnknownMember,
  openDm,
  postMessage,
} from "../discord/rest.ts";
import { gmOf } from "../campaigns/roster.ts";
import { claim, record, recordFailure, release } from "../projection/publications.ts";
import { leaveForming } from "../campaigns/forming-signup.ts";
import { schedulingChannel } from "../projection/staging.ts";
import { rearm } from "../jobs/arm.ts";
import type { MessagePayload } from "../attendance/render.ts";
import { personFrom, type Person } from "./people.ts";

/**
 * The door: somebody signing up from the site who is not in the Kith Discord
 * server yet.
 *
 * Signing up never waits on it. Their signup is written straight away and
 * holds their place, but while their request is `pending` it is provisional.
 * An organiser answers once per person, in the console or with the buttons on
 * the post in the approvals channel, and the answer covers every signup they
 * hold:
 *
 * - **Let them in** mints a single-use invite with the bot token and shows it
 *   to them on the site. Kith's OAuth scope is `identify`, so it holds no token
 *   that could add somebody to the server, and it never asks for one.
 * - **Not this time** gives their places back, the same way they could have.
 *
 * Membership itself is always read from Discord with the bot token, never
 * stored as a fact Kith decided.
 */
export type Standing = "member" | "pending" | "approved" | "declined";

export const ASK_JOB = "server-request.ask";
/** How long an invite works for. A new one is made on the site if it runs out. */
export const INVITE_SECONDS = 7 * 86_400;

type Request = typeof schema.serverRequests.$inferSelect;

export function requestOf(env: Env, userId: string): Promise<Request | undefined> {
  return db(env).select().from(schema.serverRequests).where(eq(schema.serverRequests.userId, userId)).get();
}

/** Asked as the bot. Throws when Discord can't answer, which is not a "no". */
export async function inServer(env: Env, userId: string): Promise<boolean> {
  const guildId = await requireGuildId(env);
  try {
    await throughGovernor(env, guildId, () => getGuildMember(env, guildId, userId));
    return true;
  } catch (error) {
    if (isUnknownMember(error)) return false;
    throw error;
  }
}

/**
 * Where somebody stands at the moment they sign up. Somebody in the server is
 * a member whatever their request said, and the request is closed as joined;
 * somebody who isn't, and has never asked, is asked for now.
 */
export async function atTheDoor(env: Env, userId: string): Promise<Standing> {
  const request = await requestOf(env, userId);
  if (await inServer(env, userId)) {
    if (request && request.joinedAt === null) await markJoined(env, request);
    return "member";
  }
  if (request && request.state !== "pending") return request.state;

  if (!request) await db(env).insert(schema.serverRequests).values({ userId }).onConflictDoNothing();
  // Armed on every signup until the ask is posted: the job skips anybody with
  // nothing signed up, so the signup that does land is the one that posts it.
  if (!request?.discordMessageId) {
    await rearm(db(env), [
      { id: `${ASK_JOB}:${userId}`, kind: ASK_JOB, payload: { userId }, runAt: Math.floor(Date.now() / 1000) },
    ]);
  }
  return "pending";
}

/**
 * Discord couldn't say whether they're in the server, so the signup went
 * ahead without asking. This job asks again later, and opens a request if
 * they turn out not to be.
 */
export const CHECK_JOB = "server-request.check";

export async function checkLater(env: Env, userId: string): Promise<void> {
  await rearm(db(env), [
    { id: `${CHECK_JOB}:${userId}`, kind: CHECK_JOB, payload: { userId }, runAt: Math.floor(Date.now() / 1000) + 60 },
  ]);
}

/** A signup is provisional while its person waits to be let into the server. */
export async function isProvisional(env: Env, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  return (await requestOf(env, userId))?.state === "pending";
}

async function markJoined(env: Env, request: Request): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db(env)
    .update(schema.serverRequests)
    .set({
      // Being in the server is the answer, however they got there.
      state: "approved",
      decidedAt: request.decidedAt ?? now,
      joinedAt: now,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(schema.serverRequests.userId, request.userId));
}

export type Decision =
  | { outcome: "let-in"; inviteUrl: string }
  /** `kept` is any place a table that has stopped moving would not give back. */
  | { outcome: "turned-away"; kept: string[] }
  | { outcome: "unchanged"; inviteUrl: string | null }
  | { outcome: "already-joined" }
  | { outcome: "no-such-request" }
  | { outcome: "no-invite"; reason: string };

export function inviteUrl(code: string): string {
  return `https://discord.gg/${code}`;
}

/**
 * Let them in: an invite, then the row. The invite comes first so a refusal
 * from Discord leaves them waiting rather than approved with no way in.
 */
export async function letIn(env: Env, userId: string, deciderId: string): Promise<Decision> {
  const request = await requestOf(env, userId);
  if (!request) return { outcome: "no-such-request" };
  if (request.joinedAt !== null) return { outcome: "already-joined" };
  const now = Math.floor(Date.now() / 1000);
  if (request.state === "approved" && request.inviteCode && (request.inviteExpiresAt ?? 0) > now) {
    return { outcome: "unchanged", inviteUrl: inviteUrl(request.inviteCode) };
  }

  const invite = await mintInvite(env);
  if ("reason" in invite) return { outcome: "no-invite", reason: invite.reason };

  const d = db(env);
  await d.batch([
    d
      .update(schema.serverRequests)
      .set({
        state: "approved",
        inviteCode: invite.code,
        inviteExpiresAt: invite.expiresAt,
        decidedBy: deciderId,
        decidedAt: now,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(schema.serverRequests.userId, userId)),
    d.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: deciderId,
      action: "server.let-in",
      targetType: "user",
      targetId: userId,
      detail: { before: request.state, after: "approved" },
    }),
  ]);
  return { outcome: "let-in", inviteUrl: inviteUrl(invite.code) };
}

/** Not this time: the row says so, and every place they held is given back. */
export async function turnAway(env: Env, userId: string, deciderId: string): Promise<Decision> {
  const request = await requestOf(env, userId);
  if (!request) return { outcome: "no-such-request" };
  if (request.joinedAt !== null) return { outcome: "already-joined" };

  // Places first, so a failure partway leaves them waiting and a second click
  // finishes the job, rather than declined with places still held.
  const kept = await giveBackPlaces(env, userId);
  if (request.state === "declined") return { outcome: "turned-away", kept };

  const d = db(env);
  await d.batch([
    d
      .update(schema.serverRequests)
      .set({
        state: "declined",
        inviteCode: null,
        inviteExpiresAt: null,
        decidedBy: deciderId,
        decidedAt: Math.floor(Date.now() / 1000),
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(schema.serverRequests.userId, userId)),
    d.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: deciderId,
      action: "server.turn-away",
      targetType: "user",
      targetId: userId,
      detail: { before: request.state, after: "declined" },
    }),
  ]);
  return { outcome: "turned-away", kept };
}

/**
 * The same withdrawals they could have made themselves, so a freed seat lets
 * the waitlist in exactly as it would have. A game day's goes through its lock,
 * like every other click on that day.
 */
async function giveBackPlaces(env: Env, userId: string): Promise<string[]> {
  const held = await signupsOf(env, userId);
  if (held.length === 0) return [];
  const user = await db(env).select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  const actor = { id: userId, username: user?.username ?? userId, global_name: user?.globalName ?? null };
  for (const signup of held) {
    if (signup.kind === "campaign") {
      await leaveForming(env, signup.id, userId);
    } else {
      const lock = env.SESSION_LOCK.get(env.SESSION_LOCK.idFromName(signup.id));
      await lock.leaveSeat({ gameDayId: signup.id, actor });
    }
  }
  // A started campaign or a locked day refuses a withdrawal, as it would
  // refuse theirs. Say which, rather than claim they were all given back.
  return (await signupsOf(env, userId)).map((signup) => signup.name);
}

async function mintInvite(env: Env): Promise<{ code: string; expiresAt: number } | { reason: string }> {
  const channelId =
    (await getSetting<string>(env, SETTING_KEYS.inviteChannelId)) ?? (await schedulingChannel(env, false));
  if (!channelId) return { reason: "Kith has no channel to make an invite on. Set the invite channel in Settings." };
  const guildId = await requireGuildId(env);
  try {
    const invite = await throughGovernor(env, guildId, () => createInvite(env, channelId, INVITE_SECONDS));
    const expiresAt = invite.expires_at
      ? Math.floor(Date.parse(invite.expires_at) / 1000)
      : Math.floor(Date.now() / 1000) + INVITE_SECONDS;
    return { code: invite.code, expiresAt };
  } catch (error) {
    if (isMissingPermission(error) || asDiscordFailure(error)?.status === 403) {
      return { reason: "The Kith bot can't make invites on that channel. Give it Create Invite there and try again." };
    }
    throw error;
  }
}

/**
 * What the site tells the person about the server. Only somebody approved and
 * not yet seen in the server costs a Discord call, and only they get an
 * invite: a fresh one if theirs ran out.
 */
export interface ServerStatus {
  server: Standing;
  invite: string | null;
}

export async function serverStatusFor(env: Env, userId: string): Promise<ServerStatus> {
  const request = await requestOf(env, userId);
  if (!request || request.joinedAt !== null) return { server: "member", invite: null };
  if (request.state === "declined") return { server: "declined", invite: null };

  // Somebody may have joined another way, waiting or not.
  try {
    if (await inServer(env, userId)) {
      await markJoined(env, request);
      return { server: "member", invite: null };
    }
  } catch (error) {
    // Discord being slow is no reason to hide the invite they already have.
    console.warn("server membership check failed", error);
  }
  if (request.state === "pending") return { server: "pending", invite: null };

  const now = Math.floor(Date.now() / 1000);
  if (request.inviteCode && (request.inviteExpiresAt ?? 0) > now) {
    return { server: "approved", invite: inviteUrl(request.inviteCode) };
  }
  try {
    const invite = await mintInvite(env);
    if ("reason" in invite) return { server: "approved", invite: null };
    await db(env)
      .update(schema.serverRequests)
      .set({ inviteCode: invite.code, inviteExpiresAt: invite.expiresAt, updatedAt: sql`(unixepoch())` })
      .where(eq(schema.serverRequests.userId, userId));
    return { server: "approved", invite: inviteUrl(invite.code) };
  } catch (error) {
    console.warn("could not make a fresh invite", error);
    return { server: "approved", invite: null };
  }
}

export interface HeldSignup {
  kind: "campaign" | "game-day";
  id: string;
  name: string;
  state: "in" | "waitlisted" | "interested";
}

/** What somebody has signed up for, live, named the way the site names it. */
export async function signupsOf(env: Env, userId: string): Promise<HeldSignup[]> {
  const d = db(env);
  const rows = await d
    .select({
      targetType: schema.signups.targetType,
      targetId: schema.signups.targetId,
      state: schema.signups.state,
      campaignName: schema.campaigns.name,
      dayTitle: schema.gameDays.title,
      gameName: schema.games.name,
    })
    .from(schema.signups)
    .leftJoin(
      schema.campaigns,
      and(eq(schema.signups.targetType, "campaign_forming"), eq(schema.signups.targetId, schema.campaigns.id)),
    )
    .leftJoin(
      schema.gameDays,
      and(eq(schema.signups.targetType, "game_day"), eq(schema.signups.targetId, schema.gameDays.id)),
    )
    .leftJoin(schema.games, eq(schema.gameDays.gameId, schema.games.id))
    .where(and(eq(schema.signups.userId, userId), ne(schema.signups.state, "out")))
    .orderBy(schema.signups.createdAt)
    .all();
  return rows.map((row) => ({
    kind: row.targetType === "campaign_forming" ? "campaign" : "game-day",
    id: row.targetId,
    name: (row.targetType === "campaign_forming" ? row.campaignName : (row.dayTitle ?? row.gameName)) ?? "Game day",
    state: row.state as HeldSignup["state"],
  }));
}

export interface DoorRow {
  person: Person;
  state: Exclude<Standing, "member">;
  askedAt: number;
  decidedAt: number | null;
  /** Shown while approved and not yet in the server, so it can be passed on by hand. */
  invite: string | null;
  signups: HeldSignup[];
}

/** The console's list: everybody who has asked and isn't in the server yet. */
export async function doorRows(env: Env): Promise<DoorRow[]> {
  const rows = await db(env)
    .select({ request: schema.serverRequests, user: schema.users })
    .from(schema.serverRequests)
    .innerJoin(schema.users, eq(schema.serverRequests.userId, schema.users.discordId))
    .where(isNull(schema.serverRequests.joinedAt))
    .orderBy(desc(schema.serverRequests.createdAt))
    .all();
  const now = Math.floor(Date.now() / 1000);
  const out: DoorRow[] = [];
  for (const { request, user } of rows) {
    out.push({
      person: personFrom(user),
      state: request.state,
      askedAt: request.createdAt,
      decidedAt: request.decidedAt,
      invite:
        request.state === "approved" && request.inviteCode && (request.inviteExpiresAt ?? 0) > now
          ? inviteUrl(request.inviteCode)
          : null,
      signups: await signupsOf(env, request.userId),
    });
  }
  return out;
}

/** Which of these people are waiting at the door, in one read. */
export async function waitingAmong(env: Env, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db(env)
    .select({ userId: schema.serverRequests.userId })
    .from(schema.serverRequests)
    .where(and(inArray(schema.serverRequests.userId, userIds), eq(schema.serverRequests.state, "pending")))
    .all();
  return new Set(rows.map((row) => row.userId));
}

const STATE_WORDS: Record<HeldSignup["state"], string> = {
  in: "In",
  waitlisted: "In, on the waitlist",
  interested: "Interested",
};

/**
 * The approvals post, rendered from D1. The same render answers the buttons,
 * so a click rewrites the post into what was decided and takes the buttons off.
 */
export async function askPayload(env: Env, userId: string): Promise<MessagePayload | undefined> {
  const request = await requestOf(env, userId);
  const user = await db(env).select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!request || !user) return undefined;

  const name = escapeMarkdown(user.globalName ?? user.username ?? userId);
  const handle = user.username ? ` (@${escapeMarkdown(user.username)})` : "";
  const signups = await signupsOf(env, userId);
  const lines = [`**${name}**${handle} signed up on Kith and isn't in the server yet.`];
  if (signups.length > 0) {
    lines.push("", ...signups.map((s) => `- ${escapeMarkdown(s.name)}: ${STATE_WORDS[s.state]}`));
  }

  const decider = request.decidedBy ? `<@${request.decidedBy}>` : "Kith";
  const components: Record<string, unknown>[] = [];
  if (request.joinedAt !== null) {
    lines.push("", "They're in the server now.");
  } else if (request.state === "pending") {
    lines.push("", "Their places are held until you decide.");
    components.push({
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SUCCESS,
          label: "Let them in",
          custom_id: encodeCustomId({ action: "door", arg: "in", target: userId }),
        },
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.DANGER,
          label: "Not this time",
          custom_id: encodeCustomId({ action: "door", arg: "no", target: userId }),
        },
      ],
    });
  } else if (request.state === "approved") {
    const invite = request.inviteCode ? ` Their invite: ${inviteUrl(request.inviteCode)}` : "";
    lines.push("", `Let in by ${decider}. Kith shows them the invite when they next visit.${invite}`);
  } else if (signups.length > 0) {
    lines.push(
      "",
      `Not this time, said ${decider}. The places above have stopped taking changes, so they're still on them. Everything else was given back.`,
    );
  } else {
    lines.push("", `Not this time, said ${decider}. Their places were given back.`);
  }

  return {
    content: lines.join("\n"),
    components,
    allowed_mentions: { parse: [], roles: [] },
  };
}

/**
 * Who answers for this person: the GM of each campaign they signed up for, and
 * the host of each game day. Jrvs, 2026-11-24: admin asks such as letting
 * somebody into the server go to the GM by DM, and the bot DMs nobody else.
 */
export async function decidersFor(env: Env, userId: string): Promise<string[]> {
  const signups = await signupsOf(env, userId);
  const ids = new Set<string>();
  for (const signup of signups) {
    if (signup.kind === "campaign") {
      const gm = await gmOf(env, signup.id);
      if (gm) ids.add(gm);
    } else {
      const day = await db(env)
        .select({ host: schema.gameDays.hostUserId })
        .from(schema.gameDays)
        .where(eq(schema.gameDays.id, signup.id))
        .get();
      if (day?.host) ids.add(day.host);
    }
  }
  ids.delete(userId);
  return [...ids];
}

/**
 * DM the ask to each decider, once each. Returns the first message id that
 * went out, or undefined when nobody could be reached by DM (no GM, or their
 * DMs are closed to the bot), in which case the approvals channel is asked.
 */
async function askByDm(
  env: Env,
  guildId: string,
  userId: string,
  payload: MessagePayload,
): Promise<string | undefined> {
  let first: string | undefined;
  for (const decider of await decidersFor(env, userId)) {
    const ref = {
      surface: "discord",
      kind: "message",
      targetId: `server-request:${userId}`,
      label: `ask:dm:${decider}`,
    } as const;
    const { mine, publication } = await claim(env, ref);
    if (!mine) {
      first ??= publication.remoteId ?? undefined;
      continue;
    }
    try {
      const id = await throughGovernor(env, guildId, async () => {
        const dm = await openDm(env, decider);
        return (await postMessage(env, dm.id, payload)).id;
      });
      await record(env, ref, id);
      first ??= id;
    } catch (error) {
      // Closed DMs are an answer, not a blip: forget this one and let the
      // channel ask stand in. Anything else lets go so the retry can try again.
      await release(env, ref);
      if (!isClosedDm(error)) throw error;
    }
  }
  return first;
}

/**
 * The job: post the ask once. Somebody let in or turned away from the console
 * before it ran needs no post.
 */
export async function postAsk(env: Env, userId: string): Promise<void> {
  const request = await requestOf(env, userId);
  if (!request || request.state !== "pending") return;
  // A signup that didn't land (the table closed mid-click) leaves nothing to ask about.
  if ((await signupsOf(env, userId)).length === 0) return;
  const payload = await askPayload(env, userId);
  if (!payload) return;
  const guildId = await requireGuildId(env);

  // The GM, by DM, first. The approvals channel only when no GM can be reached.
  const dmId = await askByDm(env, guildId, userId, payload);
  if (dmId) {
    await db(env)
      .update(schema.serverRequests)
      .set({ discordMessageId: dmId, updatedAt: sql`(unixepoch())` })
      .where(eq(schema.serverRequests.userId, userId));
    return;
  }

  const channelId =
    (await getSetting<string>(env, SETTING_KEYS.approvalsChannelId)) ??
    (await getSetting<string>(env, SETTING_KEYS.stagingChannelId));
  if (!channelId) throw new Error("no approvals channel or Staging channel is set");
  const ref = { surface: "discord", kind: "message", targetId: `server-request:${userId}`, label: "ask" } as const;
  const { mine } = await claim(env, ref, channelId);
  if (!mine) return;

  let messageId: string;
  try {
    messageId = (await throughGovernor(env, guildId, () => postMessage(env, channelId, payload))).id;
  } catch (error) {
    const failure = asDiscordFailure(error);
    if (failure && failure.status >= 400 && failure.status < 500) await release(env, ref);
    else await recordFailure(env, ref, String(error));
    throw error;
  }
  await record(env, ref, messageId);
  await db(env)
    .update(schema.serverRequests)
    .set({ discordMessageId: messageId, updatedAt: sql`(unixepoch())` })
    .where(eq(schema.serverRequests.userId, userId));
}
