import { and, asc, eq, gte, inArray, isNotNull, ne } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { getSetting, SETTING_KEYS } from "../db/settings.ts";
import { DISCORD_EVENT_HORIZON } from "../campaigns/event-cap.ts";
import { DAY_PUBLISHES } from "../projection/target.ts";
import { enqueueProjection, enqueueUnprojection } from "../projection/outbox.ts";
import { throughGovernor } from "./governor.ts";
import { deleteScheduledEvent, isUnknownEvent, listScheduledEvents } from "./rest.ts";

/**
 * The hourly Discord reconcile: what the server's event list should hold,
 * worked out from D1 alone, and compared with what it does hold.
 *
 * The edit-time paths (a poll moving a session, a cancel, a game day locking)
 * still ask for projections as they happen. This is what makes the result not
 * depend on them: whatever was missed, lost, deleted by hand or left behind,
 * the next hour puts right. It is deterministic — the same D1 and the same
 * guild give the same requests — and idempotent, because every upsert it asks
 * for is skipped by the projector when the fingerprint already matches.
 *
 * Which sessions should have an event:
 * - a RUNNING campaign's next {@link DISCORD_EVENT_HORIZON} sessions that are
 *   not cancelled;
 * - every upcoming session of a game day that is seated, locked or played.
 *
 * Test games are not special here. The queue consumer applies
 * `publishesTo` (src/projection/staging.ts) to every upsert, so a test only
 * ever gets the voice event in its own Staging channel.
 *
 * It never touches an event Kith did not make: the only events it deletes
 * directly are ones carrying Kith's session marker.
 */
export interface ReconcileResult {
  upserts: string[];
  deletes: string[];
  /** Kith-marked events with no session wanting them, deleted directly. */
  strays: string[];
}

const LIVE = new Set([1, 2]); // SCHEDULED, ACTIVE. COMPLETED and CANCELED are terminal.
const MARKER = /\[orrey:session:([^\]]+)\]/;

export async function reconcileDiscordEvents(env: Env, now: Date): Promise<ReconcileResult> {
  const result: ReconcileResult = { upserts: [], deletes: [], strays: [] };
  const guildId = await getSetting<string>(env, SETTING_KEYS.guildId);
  if (!guildId) return result;

  const d = db(env);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const wanted = await wantedSessions(env, nowSeconds);

  // One read of the guild. If Discord cannot be asked, nothing is decided from
  // a guess: the next hour asks again.
  const events = await throughGovernor(env, guildId, () => listScheduledEvents(env, guildId));
  const live = new Map(events.filter((e) => LIVE.has(e.status)).map((e) => [e.id, e]));

  // Upcoming sessions that hold an event id, wanted or not.
  const holding = await d
    .select({ id: schema.sessions.id, discordEventId: schema.sessions.discordEventId })
    .from(schema.sessions)
    .where(and(gte(schema.sessions.startsAt, nowSeconds), isNotNull(schema.sessions.discordEventId)))
    .all();
  const held = new Map(holding.map((row) => [row.id, row.discordEventId as string]));

  // The ones the session remembers but Discord no longer shows as live: deleted
  // by hand, or lapsed. Forget the id so the upsert makes a fresh one instead of
  // skipping on a fingerprint that matches an event nobody can see.
  const vanished = [...wanted].filter((id) => held.has(id) && !live.has(held.get(id)!));
  if (vanished.length > 0) {
    await d
      .update(schema.sessions)
      .set({ discordEventId: null, discordEventFingerprint: null })
      .where(inArray(schema.sessions.id, vanished));
  }

  for (const id of wanted) {
    await enqueueProjection(env, id, ["discord"]);
    result.upserts.push(id);
  }

  for (const [id] of held) {
    if (wanted.has(id)) continue;
    await enqueueUnprojection(env, id, ["discord"]);
    result.deletes.push(id);
  }

  // Events Kith made that no session should have: the session was deleted, or
  // it is upcoming, unwanted and has lost its id. A session that still holds
  // its event is taken down above, through the ledger. An event for a session
  // that has already started is left alone: it is a record of the evening.
  const marked = [...live.values()]
    .map((event) => ({ event, sessionId: MARKER.exec(event.description ?? "")?.[1] }))
    .filter((m): m is { event: (typeof events)[number]; sessionId: string } => Boolean(m.sessionId));
  const known = marked.length
    ? await d
        .select({ id: schema.sessions.id, startsAt: schema.sessions.startsAt })
        .from(schema.sessions)
        .where(inArray(schema.sessions.id, marked.map((m) => m.sessionId)))
        .all()
    : [];
  const startsAt = new Map(known.map((row) => [row.id, row.startsAt]));

  for (const { event, sessionId } of marked) {
    if (wanted.has(sessionId) || held.has(sessionId)) continue;
    const start = startsAt.get(sessionId);
    if (start !== undefined && start < nowSeconds) continue;
    try {
      await throughGovernor(env, guildId, () => deleteScheduledEvent(env, guildId, event.id));
    } catch (error) {
      if (!isUnknownEvent(error)) throw error;
    }
    result.strays.push(event.id);
  }

  return result;
}

async function wantedSessions(env: Env, nowSeconds: number): Promise<Set<string>> {
  const d = db(env);
  const wanted = new Set<string>();

  const running = await d
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.state, "RUNNING"))
    .all();
  for (const { id } of running) {
    const next = await d
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.campaignId, id),
          gte(schema.sessions.startsAt, nowSeconds),
          ne(schema.sessions.state, "CANCELLED"),
        ),
      )
      .orderBy(asc(schema.sessions.startsAt))
      .limit(DISCORD_EVENT_HORIZON)
      .all();
    for (const row of next) wanted.add(row.id);
  }

  const days = await d
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .innerJoin(schema.gameDays, eq(schema.sessions.gameDayId, schema.gameDays.id))
    .where(
      and(
        gte(schema.sessions.startsAt, nowSeconds),
        ne(schema.sessions.state, "CANCELLED"),
        inArray(schema.gameDays.state, [...DAY_PUBLISHES]),
      ),
    )
    .all();
  for (const row of days) wanted.add(row.id);

  return wanted;
}
