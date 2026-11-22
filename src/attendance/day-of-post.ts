import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db/index.ts";
import type { Env } from "../env.ts";
import { requireGuildId } from "../db/settings.ts";
import { throughGovernor } from "../discord/governor.ts";
import { asDiscordFailure, postMessage } from "../discord/rest.ts";
import { claim, record, recordFailure, release } from "../projection/publications.ts";
import type { ProjectionTarget } from "../projection/target.ts";
import { attendanceRows } from "./rows.ts";
import { renderDayOfPost } from "./render.ts";
import { channelOf } from "./thread.ts";

/**
 * The day-of reminder, posted once, in the campaign's own channel.
 *
 * Its own message under its own label rather than the session's attendance post,
 * for two reasons. A session can already have a signup post from before running
 * campaigns stopped taking signups, and the reminder still has to go up beside
 * it. And the label is the *date*, not the session — the same reasoning as
 * `jeopardyLabel` — so a session moved to another day is reminded again on that
 * day rather than finding the old claim standing.
 *
 * Send-only like everything else: claimed before the call, recorded after, and
 * never touched again except by a click on it rewriting it with UPDATE_MESSAGE.
 */
export function dayOfLabel(startsAt: number): string {
  return `day-of:${startsAt}`;
}

export async function postDayOfOnce(env: Env, target: ProjectionTarget): Promise<string | undefined> {
  const { session } = target;
  const channelId = await channelOf(env, target);
  if (!channelId) {
    throw new Error(`no channel to remind ${session.id} in — its campaign has none and neither does settings`);
  }

  // Everything that can fail locally, before the claim — see `postAttendancePost`.
  const payload = renderDayOfPost({
    target,
    rows: await attendanceRows(env, session.id),
    asOf: new Date(),
  });
  const guildId = await requireGuildId(env);

  const ref = {
    surface: "discord",
    kind: "message",
    targetId: session.id,
    label: dayOfLabel(session.startsAt),
  } as const;
  const { mine, publication } = await claim(env, ref, channelId);
  // Already up, or an attempt whose outcome is unknown. A second reminder with
  // live buttons is worse than none. One that is up heals the session's column,
  // in case only that write was lost.
  if (!mine) {
    if (publication.remoteId) await adopt(env, target, publication.remoteId);
    return publication.remoteId ?? undefined;
  }

  let message;
  try {
    message = await throughGovernor(env, guildId, () => postMessage(env, channelId, payload));
  } catch (error) {
    // A 4xx is Discord refusing, so nothing went up and a retry should be
    // allowed. Anything else may have posted, and holding the claim is the safe
    // half of that doubt.
    const failure = asDiscordFailure(error);
    if (failure && failure.status >= 400 && failure.status < 500) await release(env, ref);
    else await recordFailure(env, ref, String(error));
    throw error;
  }

  await record(env, ref, message.id);
  await adopt(env, target, message.id);
  return message.id;
}

/**
 * The reminder becomes the session's post when it has none, so the session's
 * thread hangs off it and every later notice — a move, a date poll, the recap —
 * goes into that thread rather than the campaign channel. A session that kept
 * an older signup post keeps that one as its anchor.
 */
async function adopt(env: Env, target: ProjectionTarget, messageId: string): Promise<void> {
  if (target.session.discordMessageId) return;
  await db(env)
    .update(schema.sessions)
    .set({ discordMessageId: messageId, updatedAt: sql`(unixepoch())` })
    .where(and(eq(schema.sessions.id, target.session.id), isNull(schema.sessions.discordMessageId)));
}
