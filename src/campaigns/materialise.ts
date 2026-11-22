import { and, count, eq, gt, isNotNull, notInArray, sql } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { SETTING_DEFAULTS, SETTING_KEYS, settingOr } from "../db/settings.ts";
import { armAssume } from "../attendance/assume.ts";
import { armDayOf, dayOfJob } from "../attendance/day-of.ts";
import { enforceEventCap } from "./event-cap.ts";
import { occurrencesFrom } from "./recurrence.ts";
import { remainingSessions } from "./roster.ts";

/**
 * The hourly tick: every RUNNING campaign with a cadence gets sessions out to
 * the horizon, and each new one gets its jobs armed.
 *
 * Three rules, and all three are about what it must *not* do:
 *
 * - **It inserts and never updates.** A session whose `starts_at` has moved was
 *   moved by a person, or by phase 4's date poll. A materialiser that overwrote
 *   it would undo that every hour, which is the worst kind of bug: correct-
 *   looking, and silently reverting somebody's decision.
 * - **Idempotency is the id, not a flag.** `${campaignId}-s${number}` is derived
 *   from the cadence, so the second run of the same tick conflicts on the
 *   primary key and does nothing. There is no "already materialised" column to
 *   get out of step with reality.
 * - **HIATUS and CONCLUDED are simply not selected.** That is the whole of
 *   "HIATUS pauses materialisation, RUNNING resumes it from the anchor" — the
 *   anchor never moved, so resuming needs no memory of when it stopped.
 */
export interface MaterialisedSession {
  campaignId: string;
  sessionId: string;
  number: number;
  startsAt: number;
}

export async function materialiseHorizon(env: Env, now: Date): Promise<MaterialisedSession[]> {
  const horizon = await settingOr(
    env,
    SETTING_KEYS.horizonSessions,
    SETTING_DEFAULTS["horizon.sessions"],
  );
  const timezone = await settingOr(env, SETTING_KEYS.timezone, SETTING_DEFAULTS.timezone);

  const made: MaterialisedSession[] = [];

  for (const row of await runningWithCadence(env)) {
    // One campaign's bad cadence must not stop the others' from being made.
    try {
      made.push(...(await materialiseOne(env, row, { now, horizon, timezone })));
      await healDayOf(env, row.campaign.id, now);
      // Every running campaign, not only the ones that gained a session: the
      // Discord horizon moves when a session *passes*, not only when one is made.
      await enforceEventCap(env, row.campaign.id, now);
    } catch (error) {
      console.error("materialising", row.campaign.id, error);
    }
  }

  return made;
}

interface Settings {
  now: Date;
  horizon: number;
  timezone: string;
}

type CampaignRow = {
  campaign: typeof schema.campaigns.$inferSelect;
  defaultDurationMinutes: number | null;
};

async function materialiseOne(
  env: Env,
  { campaign, defaultDurationMinutes }: CampaignRow,
  { now, horizon, timezone }: Settings,
): Promise<MaterialisedSession[]> {
  // A cadence is both columns or neither. The select guarantees it; this is what
  // makes that guarantee legible to the type checker.
  if (campaign.recurrenceAnchor === null || campaign.intervalWeeks === null) return [];

  const existing = await sessionCount(env, campaign.id);
  const remaining = remainingSessions(campaign, existing);
  if (remaining === 0) return [];

  // A capped campaign is materialised no further than its cap, however far the
  // horizon reaches.
  const wanted = remaining === null ? horizon : Math.min(horizon, remaining);
  if (wanted <= 0) return [];

  const occurrences = occurrencesFrom({
    anchor: campaign.recurrenceAnchor,
    intervalWeeks: campaign.intervalWeeks,
    firstSessionNumber: campaign.firstSessionNumber,
    from: Math.floor(now.getTime() / 1000),
    count: wanted,
    timezone,
    durationMinutes: defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
  });

  const made: MaterialisedSession[] = [];

  for (const occurrence of occurrences) {
    const sessionId = `${campaign.id}-s${occurrence.number}`;

    const inserted = await db(env)
      .insert(schema.sessions)
      .values({
        id: sessionId,
        kind: "campaign_session",
        campaignId: campaign.id,
        number: occurrence.number,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        location: campaign.locationType === "voice" ? null : PLACEHOLDER_LOCATION,
      })
      // Never `do update`. See the note at the top: an existing session was
      // moved by somebody, and this runs every hour.
      .onConflictDoNothing()
      .returning({ id: schema.sessions.id });

    if (inserted.length === 0) continue;

    await armJobs(env, sessionId, occurrence.startsAt, occurrence.endsAt);
    made.push({
      campaignId: campaign.id,
      sessionId,
      number: occurrence.number,
      startsAt: occurrence.startsAt,
    });
  }

  return made;
}

/**
 * Four hours, when the campaign's game does not say. It is a placeholder in the
 * only sense that matters — the Discord event and the Google event both carry an
 * end time, and a wrong one is better than a missing one, which Discord rejects.
 */
const DEFAULT_DURATION_MINUTES = 240;

/** An EXTERNAL Discord event needs somewhere; the console is where it gets a real one. */
const PLACEHOLDER_LOCATION = "To be confirmed";

/**
 * The standing jobs for a new session. The projection goes out now; the post
 * waits for the morning of — a running campaign takes no signups ahead of time,
 * so the only thing it is asked is whether tonight still stands, on the day, in
 * its own channel (`src/attendance/day-of.ts`). It is a job and not a post made
 * here because a post is the one thing that cannot be taken back.
 *
 * No reminder ladder: the day-of post *is* the reminder, and a DM three days out
 * asking somebody to answer a post that does not exist yet would be nonsense.
 */
async function armJobs(env: Env, sessionId: string, startsAt: number, endsAt: number): Promise<void> {
  await db(env)
    .insert(schema.jobs)
    .values({
      id: `session.project:${sessionId}`,
      kind: "session.project",
      payload: { sessionId },
      idempotencyKey: `session.project:${sessionId}`,
      runAt: sql`(unixepoch())`,
    })
    .onConflictDoNothing();

  // Armed separately because these are the jobs whose time moves when the
  // session does, so they upsert their `run_at` rather than being written once
  // and forgotten. A session materialised on its own day posts on the next
  // drain rather than being skipped for having a run_at in the past.
  await armDayOf(env, sessionId, startsAt);
  // No jeopardy check either: a day out, nobody has been asked yet, so there is
  // no tally to be short of. A roster member's `I can't make it` opens the date
  // poll from the click itself (`SessionLock.setIntent`).
  // And the register, when it is over.
  await armAssume(env, sessionId, endsAt);
}

/**
 * Every upcoming session of a running campaign has its day-of job.
 *
 * The sessions materialised before the day-of reminder existed were armed with
 * a signup post and a ladder instead, and some of those posts already went up.
 * Insert-if-missing, never re-arm: a job that exists was armed or moved by
 * somebody, and one that is `done` has posted.
 */
async function healDayOf(env: Env, campaignId: string, now: Date): Promise<void> {
  const upcoming = await db(env)
    .select({ id: schema.sessions.id, startsAt: schema.sessions.startsAt })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.campaignId, campaignId),
        // Not started yet: a reminder for an evening already under way is noise.
        gt(schema.sessions.startsAt, Math.floor(now.getTime() / 1000)),
        notInArray(schema.sessions.state, ["CANCELLED", "PLAYED"]),
      ),
    )
    .all();
  if (upcoming.length === 0) return;

  const jobs = await Promise.all(upcoming.map((row) => dayOfJob(env, row.id, row.startsAt)));
  await db(env)
    .insert(schema.jobs)
    .values(jobs.map((job) => ({ ...job, idempotencyKey: job.id })))
    .onConflictDoNothing();
}

function sessionCount(env: Env, campaignId: string): Promise<number> {
  return db(env)
    .select({ n: count() })
    .from(schema.sessions)
    .where(eq(schema.sessions.campaignId, campaignId))
    .get()
    .then((row) => row?.n ?? 0);
}

/** Only RUNNING, and only with both halves of a cadence. */
function runningWithCadence(env: Env): Promise<CampaignRow[]> {
  return db(env)
    .select({
      campaign: schema.campaigns,
      defaultDurationMinutes: schema.games.defaultDurationMinutes,
    })
    .from(schema.campaigns)
    .leftJoin(schema.games, eq(schema.campaigns.gameId, schema.games.id))
    .where(
      and(
        eq(schema.campaigns.state, "RUNNING"),
        isNotNull(schema.campaigns.recurrenceAnchor),
        isNotNull(schema.campaigns.intervalWeeks),
      ),
    )
    .all();
}
