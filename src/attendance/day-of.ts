import type { Env } from "../env.ts";
import { db } from "../db/index.ts";
import { SETTING_DEFAULTS, SETTING_KEYS, settingOr } from "../db/settings.ts";
import { instantOf, wallClockOf } from "../campaigns/recurrence.ts";
import { rearm, type ArmedJob } from "../jobs/arm.ts";
import type { ProjectionTarget } from "../projection/target.ts";

/**
 * A running campaign's sessions take no signups.
 *
 * The table is already the table, so asking ten days out who is coming is a
 * question with one answer, posted in the scheduling channel where everybody
 * else has to read past it. What a running game wants instead is a nudge on the
 * day, in its own channel, to its own role: it's tonight, hell yeah or I can't
 * make it. The second one is a veto under the unanimous rule, so the machinery
 * behind it is the attendance machinery exactly as it was — only the timing,
 * the channel and the words change.
 *
 * Game days keep their attendance post at the lead time. A day is still being
 * found, and that is what a post ahead of time is for.
 */
export const DAY_OF_JOB = "session.day-of";

/** Whether this session gets the day-of reminder rather than a post at the lead time. */
export function isDayOf(target: Pick<ProjectionTarget, "session" | "gameDay">): boolean {
  return target.session.kind === "campaign_session" && target.gameDay === null;
}

/**
 * The instant of `hour`:00 on the session's own calendar day, in the guild's
 * zone. A session that starts before that hour is reminded an hour before it
 * starts instead, so a morning game is never reminded after it began.
 */
export function dayOfInstant(startsAt: number, timeZone: string, hour: number): number {
  const wall = wallClockOf(startsAt, timeZone);
  const clamped = Math.min(23, Math.max(0, Math.floor(hour)));
  const morning = instantOf({ ...wall, hour: clamped, minute: 0, second: 0 }, timeZone);
  return morning < startsAt ? morning : startsAt - 3600;
}

export async function dayOfAt(env: Env, startsAt: number): Promise<number> {
  const timeZone = await settingOr<string>(env, SETTING_KEYS.timezone, SETTING_DEFAULTS.timezone);
  const hour = await settingOr<number>(
    env,
    SETTING_KEYS.dayOfHour,
    SETTING_DEFAULTS[SETTING_KEYS.dayOfHour],
  );
  return dayOfInstant(startsAt, timeZone, hour);
}

export async function dayOfJob(env: Env, sessionId: string, startsAt: number): Promise<ArmedJob> {
  return {
    id: `${DAY_OF_JOB}:${sessionId}`,
    kind: DAY_OF_JOB,
    payload: { sessionId },
    runAt: await dayOfAt(env, startsAt),
  };
}

/**
 * Re-armed rather than written once, like every job whose time moves with its
 * session: a reminder for the old day is a reminder on the wrong day.
 */
export async function armDayOf(env: Env, sessionId: string, startsAt: number): Promise<void> {
  await rearm(db(env), [await dayOfJob(env, sessionId, startsAt)]);
}
