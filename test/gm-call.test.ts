import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { seedStatements } from "../src/db/seed-sql.ts";
import { drainJobs } from "../src/jobs/drain.ts";
import { handleInteraction } from "../src/discord/interactions.ts";
import { InteractionResponseType, InteractionType, MessageFlags } from "../src/discord/types.ts";
import { RESCHEDULE_JOB } from "../src/polls/reschedule.ts";
import { GM_ASK_JOB, gmCallId } from "../src/sessions/gm-call.ts";
import type { OutboxMessage } from "../src/env.ts";

/**
 * Somebody can't make it, and the GM decides (Jrvs, 2026-11-24): the GM is asked
 * by DM to call it off or find another date, and nothing reaches the table
 * until they answer.
 */
const realFetch = globalThis.fetch;
const SESSION_ID = "age-of-umbra-s12";
const STARTS_AT = Math.floor(Date.now() / 1000) + 10 * 86_400;

let posted: { path: string; method: string; body: Record<string, unknown> }[] = [];
let sent: OutboxMessage[] = [];
let dmsClosed = false;

const testEnv = {
  ...env,
  OUTBOX: {
    send: async (body: OutboxMessage) => void sent.push(body),
    sendBatch: async (batch: Iterable<{ body: OutboxMessage }>) => {
      for (const { body } of batch) sent.push(body);
    },
  } as unknown as Env["OUTBOX"],
} as Env;

function lock() {
  return env.SESSION_LOCK.get(env.SESSION_LOCK.idFromName(SESSION_ID));
}

const actor = (id: string) => ({ id, username: `u${id}`, global_name: null });

function stateOf() {
  return db(env)
    .select({ state: schema.sessions.state })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, SESSION_ID))
    .get()
    .then((row) => row?.state);
}

async function tap(choice: "cancel" | "move", by = "gm-1", startsAt = STARTS_AT) {
  const res = await handleInteraction(
    {
      type: InteractionType.MESSAGE_COMPONENT,
      data: { custom_id: gmCallId(choice, SESSION_ID, startsAt), component_type: 2 },
      // A DM: no member, no guild.
      user: actor(by),
      message: { id: "dm-msg", channel_id: "dm-chan" },
    } as never,
    testEnv,
    { origin: "https://kith.test" },
  );
  return res as { type: number; data: { content: string; components?: unknown[]; flags?: number } };
}

async function vetoAndAsk(by = "p-1") {
  await lock().setIntent({ sessionId: SESSION_ID, actor: actor(by), intent: "out" });
  await drainJobs(testEnv);
}

beforeEach(async () => {
  posted = [];
  sent = [];
  dmsClosed = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const path = url.pathname.replace("/api/v10", "");
    posted.push({
      path,
      method: init?.method ?? "GET",
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    if (path === "/users/@me/channels") return Response.json({ id: "dm-chan" });
    if (dmsClosed && path === "/channels/dm-chan/messages") {
      return Response.json({ code: 50007, message: "Cannot send messages to this user" }, { status: 403 });
    }
    return Response.json({ id: `msg-${posted.length}`, channel_id: "chan-1" });
  }) as typeof fetch;

  for (const table of [
    "publications",
    "poll_responses",
    "poll_dates",
    "date_polls",
    "attendance",
    "audit_log",
    "jobs",
    "sessions",
    "campaign_members",
    "campaigns",
    "users",
    "settings",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await setSetting(env, SETTING_KEYS.guildId, "g1");
  await setSetting(env, SETTING_KEYS.timezone, "America/New_York");
  const statements = seedStatements(
    { name: "Age of Umbra", kind: "run", discordChannelId: "chan-1", discordRoleId: "role-1" },
    { number: 12, startsAt: STARTS_AT, endsAt: STARTS_AT + 3 * 3600, location: "The Wreck" },
  );
  for (const statement of statements) await env.DB.prepare(statement).run();
  await env.DB.prepare("DELETE FROM jobs").run();
  // The day-of reminder's thread, so a notice that went there would show.
  await db(env).update(schema.sessions).set({ threadId: "thread-1" }).where(eq(schema.sessions.id, SESSION_ID));

  for (const id of ["gm-1", "p-1", "p-2"]) {
    await db(env).insert(schema.users).values({ discordId: id, username: `u${id}`, feedToken: `tok${id}` });
  }
  await db(env)
    .insert(schema.campaignMembers)
    .values([
      { campaignId: "age-of-umbra", userId: "gm-1", role: "gm" as const, joinedAt: 1 },
      { campaignId: "age-of-umbra", userId: "p-1", role: "player" as const, joinedAt: 2 },
      { campaignId: "age-of-umbra", userId: "p-2", role: "player" as const, joinedAt: 3 },
    ]);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("asking the GM", () => {
  it("DMs the GM and nobody else, and posts nothing to the table", async () => {
    await vetoAndAsk();

    expect(posted.map((call) => call.path)).toEqual(["/users/@me/channels", "/channels/dm-chan/messages"]);
    expect(posted[0]?.body).toEqual({ recipient_id: "gm-1" });
    const dm = posted[1]!.body as { content: string; components: { components: { label: string }[] }[] };
    expect(dm.content).toContain("Age of Umbra — Session 12");
    expect(dm.content).toContain("up-1 can't make it");
    expect(dm.components[0]?.components.map((b) => b.label)).toEqual(["Call it off", "Find another date"]);
    expect(await stateOf()).toBe("JEOPARDY");
    expect(await db(env).select().from(schema.datePolls).all()).toEqual([]);
  });

  it("asks once, however often the post is clicked", async () => {
    await vetoAndAsk();
    await lock().readIntents(SESSION_ID);
    await lock().setIntent({ sessionId: SESSION_ID, actor: actor("p-2"), intent: "out" });
    await drainJobs(testEnv);

    expect(posted.filter((call) => call.path === "/users/@me/channels")).toHaveLength(1);
  });

  it("asks nothing when the objection is taken back before the drain runs", async () => {
    await lock().setIntent({ sessionId: SESSION_ID, actor: actor("p-1"), intent: "out" });
    await lock().setIntent({ sessionId: SESSION_ID, actor: actor("p-1"), intent: "in" });
    await drainJobs(testEnv);

    expect(posted).toEqual([]);
    expect(await stateOf()).toBe("SCHEDULED");
  });

  it("asks again after an objection is withdrawn and made a second time", async () => {
    await vetoAndAsk();
    await lock().setIntent({ sessionId: SESSION_ID, actor: actor("p-1"), intent: "in" });
    await vetoAndAsk();

    expect(posted.filter((call) => call.path === "/users/@me/channels")).toHaveLength(2);
  });

  it("asks in the organisers' channel, naming the GM, when their DMs are closed", async () => {
    dmsClosed = true;
    await setSetting(env, SETTING_KEYS.approvalsChannelId, "approvals-1");
    await vetoAndAsk();

    const fallback = posted.find((call) => call.path === "/channels/approvals-1/messages");
    expect(fallback?.body.content).toMatch(/^<@gm-1> /);
    expect(fallback?.body.allowed_mentions).toEqual({ parse: [], roles: [], users: ["gm-1"] });
    // Never in front of the table.
    expect(posted.some((call) => call.path === "/channels/chan-1/messages")).toBe(false);
  });

  it("asks again on the retry after Discord fails, rather than holding the claim", async () => {
    let fail = true;
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
      if (fail && path.endsWith("/channels/dm-chan/messages")) {
        fail = false;
        return new Response("bad gateway", { status: 502 });
      }
      return inner(input, init);
    }) as typeof fetch;

    await lock().setIntent({ sessionId: SESSION_ID, actor: actor("p-1"), intent: "out" });
    await drainJobs(testEnv);
    await db(env)
      .update(schema.jobs)
      .set({ state: "pending", runAt: 0, claimedUntil: null })
      .where(eq(schema.jobs.id, `${GM_ASK_JOB}:${SESSION_ID}`));
    await drainJobs(testEnv);

    expect(posted.filter((call) => call.path === "/channels/dm-chan/messages")).toHaveLength(1);
  });

  it("asks Kith's admin for a campaign with no GM", async () => {
    await db(env).delete(schema.campaignMembers).where(eq(schema.campaignMembers.userId, "gm-1"));
    await setSetting(env, SETTING_KEYS.adminUserId, "p-2");
    await vetoAndAsk();

    expect(posted[0]?.body).toEqual({ recipient_id: "p-2" });
    expect((await tap("move", "p-2")).data.content).toContain("Finding another date");
  });

  it("falls back to a date poll for a campaign with no GM", async () => {
    await db(env).delete(schema.campaignMembers).where(eq(schema.campaignMembers.userId, "gm-1"));
    await vetoAndAsk();

    const job = await db(env)
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, `${RESCHEDULE_JOB}:${SESSION_ID}`))
      .get();
    expect(job).toBeDefined();
    expect(posted.filter((call) => call.path === "/users/@me/channels")).toEqual([]);
  });
});

describe("the GM calls it off", () => {
  it("cancels it, tells the table in its channel, and takes the event down", async () => {
    await vetoAndAsk();
    posted = [];

    const res = await tap("cancel");

    expect(res.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
    expect(res.data.content).toContain("is off");
    expect(res.data.components).toEqual([]);
    expect(await stateOf()).toBe("CANCELLED");
    // The click only rewrites the DM; the note goes out on the next drain.
    expect(posted).toEqual([]);
    await drainJobs(testEnv);

    // In the scheduling channel itself, not down in the reminder's thread.
    const notices = posted.filter((call) => call.path === "/channels/chan-1/messages");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body.content).toContain("It's off.");
    expect(posted.some((call) => call.path === "/channels/thread-1/messages")).toBe(false);

    // The Discord event (and the Kith calendar entry) go via the outbox.
    expect(sent.map((m) => m.kind)).toContain("discord.event.delete");

    const [audit] = await db(env)
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "session.cancel"))
      .all();
    expect(audit).toMatchObject({ actorUserId: "gm-1" });
  });

  it("only listens to the GM", async () => {
    await vetoAndAsk();

    const res = await tap("cancel", "p-2");

    expect(res.data.flags! & MessageFlags.EPHEMERAL).toBeTruthy();
    expect(await stateOf()).toBe("JEOPARDY");
  });

  it("says so, and cancels nothing twice, on a second tap", async () => {
    await vetoAndAsk();
    await tap("cancel");
    await drainJobs(testEnv);
    posted = [];

    const res = await tap("cancel");

    expect(res.data.content).toContain("already called off");
    expect(posted).toEqual([]);
  });
});

describe("the GM looks for another date", () => {
  it("opens the date poll, and the notice follows", async () => {
    await vetoAndAsk();

    const res = await tap("move");
    expect(res.data.content).toContain("Finding another date");
    // The DM stays the GM's control for this date.
    expect(res.data.components).toHaveLength(1);
    await drainJobs(testEnv);

    expect(await db(env).select().from(schema.datePolls).all()).toMatchObject([
      { targetSessionId: SESSION_ID, status: "open" },
    ]);
    expect(await stateOf()).toBe("JEOPARDY");
  });

  it("has nothing to decide once everybody is back in", async () => {
    await vetoAndAsk();
    await lock().setIntent({ sessionId: SESSION_ID, actor: actor("p-1"), intent: "in" });

    const res = await tap("move");

    expect(res.data.content).toContain("nothing to decide");
    expect(
      await db(env).select().from(schema.jobs).where(eq(schema.jobs.id, `${RESCHEDULE_JOB}:${SESSION_ID}`)).get(),
    ).toBeUndefined();
  });

  it("says so rather than promising a poll for a locked evening", async () => {
    await vetoAndAsk();
    await db(env).update(schema.sessions).set({ state: "LOCKED" }).where(eq(schema.sessions.id, SESSION_ID));

    const res = await tap("move");

    expect(res.data.content).toContain("locked");
    expect(
      await db(env).select().from(schema.jobs).where(eq(schema.jobs.id, `${RESCHEDULE_JOB}:${SESSION_ID}`)).get(),
    ).toBeUndefined();
  });

  it("refuses a question about a date the session has moved off", async () => {
    await vetoAndAsk();

    const res = await tap("move", "gm-1", STARTS_AT - 86_400);

    expect(res.data.content).toContain("out of date");
  });
});

it("names the job it arms", async () => {
  await lock().setIntent({ sessionId: SESSION_ID, actor: actor("p-1"), intent: "out" });
  const job = await db(env).select().from(schema.jobs).where(eq(schema.jobs.id, `${GM_ASK_JOB}:${SESSION_ID}`)).get();
  expect(job?.kind).toBe(GM_ASK_JOB);
});
