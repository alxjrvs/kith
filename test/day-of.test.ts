import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { seedStatements } from "../src/db/seed-sql.ts";
import { decodeCustomId } from "../src/discord/custom-id.ts";
import { dayOfInstant, isDayOf } from "../src/attendance/day-of.ts";
import { renderAttendancePost, type AttendanceRow } from "../src/attendance/render.ts";
import { drainJobs } from "../src/jobs/drain.ts";
import { materialiseHorizon } from "../src/campaigns/materialise.ts";
import { loadProjectionTarget } from "../src/projection/target.ts";

/**
 * A running campaign's sessions take no signups: the morning of, its channel
 * gets a reminder with two buttons. Game days keep their signup post.
 */
const realFetch = globalThis.fetch;
let posts: { path: string; body: Record<string, unknown> }[] = [];

const SESSION_ID = "age-of-umbra-s12";
const HOUR = 3600;
const DAY = 86_400;

const campaign = {
  name: "Age of Umbra",
  kind: "run",
  discordChannelId: "umbra-chan",
  discordRoleId: "umbra-role",
} as const;

async function seed(startsAt: number): Promise<void> {
  const session = { number: 12, startsAt, endsAt: startsAt + 4 * HOUR, location: "The Wreck" };
  for (const statement of seedStatements(campaign, session)) {
    await env.DB.prepare(statement).run();
  }
}

function job(id: string) {
  return db(env).select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
}

beforeEach(async () => {
  posts = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    posts.push({
      path: url.pathname.replace("/api/v10", ""),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return Response.json({ id: `msg-${posts.length}`, channel_id: "umbra-chan" });
  }) as typeof fetch;

  for (const table of ["publications", "attendance", "jobs", "sessions", "campaigns", "users", "settings"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await setSetting(env, SETTING_KEYS.guildId, "g1");
  await setSetting(env, SETTING_KEYS.timezone, "America/New_York");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("when the reminder goes up", () => {
  const NY = "America/New_York";

  it("is 09:00 on the session's own day, guild time", () => {
    // 20:30 Eastern on a Monday in November (UTC-5).
    const startsAt = Date.parse("2026-11-23T01:30:00Z") / 1000;
    expect(dayOfInstant(startsAt, NY, 9)).toBe(Date.parse("2026-11-22T14:00:00Z") / 1000);
  });

  it("keeps 09:00 at 09:00 across the clocks changing", () => {
    // 20:30 Eastern in July (UTC-4).
    const startsAt = Date.parse("2026-07-14T00:30:00Z") / 1000;
    expect(dayOfInstant(startsAt, NY, 9)).toBe(Date.parse("2026-07-13T13:00:00Z") / 1000);
  });

  it("is an hour ahead for a game that starts before the reminder hour", () => {
    // 08:00 Eastern.
    const startsAt = Date.parse("2026-11-22T13:00:00Z") / 1000;
    expect(dayOfInstant(startsAt, NY, 9)).toBe(startsAt - HOUR);
  });
});

describe("the reminder itself", () => {
  it("says it's today and offers Hell yeah or I can't make it", async () => {
    await seed(Date.parse("2026-11-23T01:30:00Z") / 1000);
    const target = (await loadProjectionTarget(env, SESSION_ID))!;
    expect(isDayOf(target)).toBe(true);

    const rows: AttendanceRow[] = [
      { userId: "1", name: "Ada", intent: "in", note: null, onRoster: true },
      { userId: "2", name: "Bob", intent: "out", note: null, onRoster: true },
    ];
    const payload = renderAttendancePost({ target, rows, asOf: new Date("2026-11-22T14:00:00Z") });

    expect(payload.content).toContain("<@&umbra-role> **Age of Umbra — Session 12** starts <t:");
    expect(payload.content).toContain("**Hell yeah (1)** — Ada");
    expect(payload.content).toContain("**Can't make it (1)** — Bob");
    expect(payload.allowed_mentions.roles).toEqual(["umbra-role"]);

    const buttons = (payload.components[0] as { components: { label: string; custom_id: string }[] })
      .components;
    expect(buttons.map((b) => b.label)).toEqual(["Hell yeah", "I can't make it"]);
    // The same ids as In and Out, so a click is an answer like any other.
    expect(buttons.map((b) => decodeCustomId(b.custom_id))).toMatchObject([
      { action: "attend", arg: "in", target: SESSION_ID },
      { action: "attend", arg: "out", target: SESSION_ID },
    ]);
    expect(payload.components).toHaveLength(1);
  });
});

describe("an older signup post", () => {
  it("keeps its five buttons when clicked more than a day out", async () => {
    const startsAt = Date.parse("2026-11-30T01:30:00Z") / 1000;
    await seed(startsAt);
    const target = (await loadProjectionTarget(env, SESSION_ID))!;

    const payload = renderAttendancePost({ target, rows: [], asOf: new Date((startsAt - 3 * DAY) * 1000) });
    const labels = (payload.components[0] as { components: { label: string }[] }).components.map((b) => b.label);
    expect(labels).toEqual(["In", "Out", "Maybe", "Note", "Refresh"]);
  });
});

describe("the clock", () => {
  it("reminds a session whose signup post already went up, beside it", async () => {
    const startsAt = Math.floor(Date.now() / 1000) + 6 * HOUR;
    await seed(startsAt);
    await env.DB.prepare("DELETE FROM jobs").run();
    await db(env).update(schema.sessions).set({ discordMessageId: "old-signup" }).where(eq(schema.sessions.id, SESSION_ID));
    await db(env).insert(schema.jobs).values({
      id: `session.day-of:${SESSION_ID}`,
      kind: "session.day-of",
      payload: { sessionId: SESSION_ID },
      idempotencyKey: `session.day-of:${SESSION_ID}`,
      runAt: Math.floor(Date.now() / 1000) - 1,
    });

    await drainJobs(env);
    // Twice, as a retried job would: still one reminder.
    await db(env).update(schema.jobs).set({ state: "pending" }).where(eq(schema.jobs.id, `session.day-of:${SESSION_ID}`));
    await drainJobs(env);

    expect(posts.filter((post) => post.path === "/channels/umbra-chan/messages")).toHaveLength(1);
  });

  it("arms the reminder for sessions materialised before it existed", async () => {
    await setSetting(env, SETTING_KEYS.horizonSessions, 1);
    const startsAt = Math.floor(Date.now() / 1000) + 3 * DAY;
    await seed(startsAt);
    await db(env)
      .update(schema.campaigns)
      .set({ state: "RUNNING", recurrenceAnchor: startsAt, intervalWeeks: 2 })
      .where(eq(schema.campaigns.id, "age-of-umbra"));
    await env.DB.prepare("DELETE FROM jobs").run();

    await materialiseHorizon(env, new Date());

    expect(await job(`session.day-of:${SESSION_ID}`)).toMatchObject({ state: "pending" });
  });

  it("moves a pending reminder to a new reminder hour, and leaves a sent one alone", async () => {
    await setSetting(env, SETTING_KEYS.horizonSessions, 1);
    const startsAt = Math.floor(Date.now() / 1000) + 3 * DAY;
    await seed(startsAt);
    await db(env)
      .update(schema.campaigns)
      .set({ state: "RUNNING", recurrenceAnchor: startsAt, intervalWeeks: 2 })
      .where(eq(schema.campaigns.id, "age-of-umbra"));
    const id = `session.day-of:${SESSION_ID}`;

    await setSetting(env, SETTING_KEYS.dayOfHour, 9);
    await materialiseHorizon(env, new Date());
    const atNine = (await job(id))!.runAt;

    await setSetting(env, SETTING_KEYS.dayOfHour, 8);
    await materialiseHorizon(env, new Date());
    const moved = (await job(id))!.runAt;
    expect(atNine).toBe(dayOfInstant(startsAt, "America/New_York", 9));
    expect(moved).toBe(dayOfInstant(startsAt, "America/New_York", 8));

    await db(env).update(schema.jobs).set({ state: "done" }).where(eq(schema.jobs.id, id));
    await setSetting(env, SETTING_KEYS.dayOfHour, 10);
    await materialiseHorizon(env, new Date());
    expect(await job(id)).toMatchObject({ state: "done", runAt: moved });
  });

  it("holds an early signup post back and hands it to the morning of", async () => {
    const startsAt = Math.floor(Date.now() / 1000) + 3 * DAY;
    await seed(startsAt);

    // The seed arms `session.post-attendance` for now, as the rows armed before
    // this change were.
    await drainJobs(env);

    expect(posts.filter((post) => post.path.endsWith("/messages"))).toEqual([]);
    expect(await job(`session.post-attendance:${SESSION_ID}`)).toMatchObject({ state: "done" });
    const dayOf = await job(`session.day-of:${SESSION_ID}`);
    expect(dayOf).toMatchObject({ state: "pending", kind: "session.day-of" });
    expect(dayOf!.runAt).toBeGreaterThan(startsAt - DAY);
    expect(dayOf!.runAt).toBeLessThan(startsAt);
  });

  it("posts the reminder in the campaign's own channel on the morning", async () => {
    const startsAt = Math.floor(Date.now() / 1000) + 6 * HOUR;
    await seed(startsAt);
    await env.DB.prepare("DELETE FROM jobs").run();
    await db(env).insert(schema.jobs).values({
      id: `session.day-of:${SESSION_ID}`,
      kind: "session.day-of",
      payload: { sessionId: SESSION_ID },
      idempotencyKey: `session.day-of:${SESSION_ID}`,
      runAt: Math.floor(Date.now() / 1000) - 1,
    });

    await drainJobs(env);

    const sent = posts.filter((post) => post.path === "/channels/umbra-chan/messages");
    expect(sent).toHaveLength(1);
    expect(String(sent[0]!.body.content)).toContain("starts <t:");
  });

  it("says nothing about a session that was called off", async () => {
    const startsAt = Math.floor(Date.now() / 1000) + 6 * HOUR;
    await seed(startsAt);
    await env.DB.prepare("DELETE FROM jobs").run();
    await db(env).update(schema.sessions).set({ state: "CANCELLED" }).where(eq(schema.sessions.id, SESSION_ID));
    await db(env).insert(schema.jobs).values({
      id: `session.day-of:${SESSION_ID}`,
      kind: "session.day-of",
      payload: { sessionId: SESSION_ID },
      idempotencyKey: `session.day-of:${SESSION_ID}`,
      runAt: Math.floor(Date.now() / 1000) - 1,
    });

    await drainJobs(env);

    expect(posts.filter((post) => post.path.endsWith("/messages"))).toEqual([]);
  });
});
