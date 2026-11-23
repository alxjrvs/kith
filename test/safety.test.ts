import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { createApp } from "../src/http/app.ts";
import { SESSION_COOKIE, issueSession } from "../src/console/cookies.ts";
import { forgetOrganisers } from "../src/http/hub.ts";
import { STOP_SIGN_JOB, retryStopSign } from "../src/hub/safety.ts";
import { fakeDiscord } from "./discord.ts";

/**
 * The stop sign and the suggestion box on a game's home base: the stop sign
 * posts an alert naming who pressed it in the game's channel and emails the
 * organiser; the suggestion box keeps words for the console and, when asked,
 * no name at all.
 */
const app = createApp();
const discord = await fakeDiscord();
const realFetch = globalThis.fetch;
const ORGANISER_ROLE = "role-organiser";

let posted: Array<{ channel: string; body: { content: string; allowed_mentions: unknown } }> = [];
let emails: Array<{ to: unknown; subject: string; text: string }> = [];
/** What Discord answers a post with, when it isn't a success. */
let discordAnswer: number | null = null;
let withEmail = true;

function testEnv() {
  return {
    ...discord.env(env),
    CONSOLE_SESSION_SECRET: "a-secret",
    DISCORD_APPLICATION_ID: "app-1",
    DISCORD_CLIENT_SECRET: "shh",
    DISCORD_BOT_TOKEN: "bot-token",
    ...(withEmail
      ? {
          STOP_SIGN_EMAIL_TO: "organiser@example.com",
          EMAIL: {
            send: async (message: { to: unknown; subject: string; text: string }) => {
              emails.push(message);
              return { messageId: `m${emails.length}` };
            },
          } as unknown as SendEmail,
        }
      : {}),
  };
}

async function as(userId: string) {
  return `${SESSION_COOKIE}=${await issueSession(testEnv(), userId, new Date())}`;
}

function call(method: string, path: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.fetch(
    new Request(`https://kith.test${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    testEnv(),
  );
}

async function person(id: string, name: string) {
  await db(env).insert(schema.users).values({ discordId: id, username: name.toLowerCase(), globalName: name, feedToken: `t-${id}` });
  await db(env)
    .insert(schema.discordTokens)
    .values({ userId: id, accessToken: "at", refreshToken: "rt", expiresAt: Math.floor(Date.now() / 1000) + 86_400 });
}

const signs = () => db(env).select().from(schema.stopSigns).all();
const suggestions = () => db(env).select().from(schema.suggestions).all();

beforeEach(async () => {
  posted = [];
  emails = [];
  discordAnswer = null;
  withEmail = true;
  forgetOrganisers();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const member = url.match(/\/members\/(\d+)$/);
    if (member) return Response.json({ roles: member[1] === "1003" ? [ORGANISER_ROLE] : [] });
    const message = url.match(/\/channels\/([^/]+)\/messages$/);
    if (message) {
      if (discordAnswer) return Response.json({ code: 50001, message: "nope" }, { status: discordAnswer });
      posted.push({ channel: message[1]!, body: JSON.parse(String(init?.body)) });
      return Response.json({ id: `msg-${posted.length}`, channel_id: message[1] });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  for (const table of ["stop_signs", "suggestions", "audit_log", "jobs", "campaigns", "games", "discord_tokens", "users", "settings"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await setSetting(env, SETTING_KEYS.guildId, "g1");
  await setSetting(env, SETTING_KEYS.organiserRoleId, ORGANISER_ROLE);
  await setSetting(env, SETTING_KEYS.schedulingChannelId, "sched-1");
  await setSetting(env, SETTING_KEYS.stagingChannelId, "staging-1");

  await person("1001", "Ada");
  await person("1003", "Rowan");

  await db(env).insert(schema.games).values([
    { id: "daggerheart", name: "Daggerheart" },
    { id: "arcs", name: "Arcs", category: "board" },
  ]);
  await db(env).insert(schema.campaigns).values([
    { id: "umbra", name: "The Age of Umbra", kind: "run", state: "RUNNING", visibility: "public", discordChannelId: "umbra-chan" },
    { id: "hidden", name: "Hidden", kind: "run", visibility: "organisers" },
    { id: "test-game", name: "Test game", kind: "run", visibility: "public", staging: 1 },
  ]);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the stop sign", () => {
  it("posts an alert naming who pressed it in the game's channel, and emails the organiser", async () => {
    const res = await call("POST", "/api/hub/homes/umbra/stop", await as("1001"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ posted: true, emailed: true, unconfirmed: false });

    expect(posted).toHaveLength(1);
    expect(posted[0]!.channel).toBe("umbra-chan");
    expect(posted[0]!.body.content).toContain("Ada pressed the stop sign for The Age of Umbra");
    expect(posted[0]!.body.allowed_mentions).toEqual({ parse: [], roles: [] });

    expect(emails).toHaveLength(1);
    expect(emails[0]!.to).toBe("organiser@example.com");
    expect(emails[0]!.subject).toBe("Stop sign pressed: The Age of Umbra");
    expect(emails[0]!.text).toContain("Ada (@ada) pressed the stop sign for The Age of Umbra");

    const [row] = await signs();
    expect(row).toMatchObject({ gameKind: "campaign", gameId: "umbra", userId: "1001", discordMessageId: "msg-1", lastError: null });
    expect(row!.emailedAt).not.toBeNull();
  });

  it("treats a second press straight after as the same press", async () => {
    const cookie = await as("1001");
    await call("POST", "/api/hub/homes/umbra/stop", cookie, {});
    await call("POST", "/api/hub/homes/umbra/stop", cookie, {});
    expect(posted).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(await signs()).toHaveLength(1);
  });

  it("sends a test game's alert to the Staging channel", async () => {
    // A test game is organisers-only on the site, so it's an organiser pressing.
    const res = await call("POST", "/api/hub/homes/test-game/stop", await as("1003"), {});
    expect(res.status).toBe(200);
    expect(posted.map((p) => p.channel)).toEqual(["staging-1"]);
  });

  it("sends a board game's alert to the scheduling channel", async () => {
    await call("POST", "/api/hub/homes/arcs/stop", await as("1001"), {});
    expect(posted.map((p) => p.channel)).toEqual(["sched-1"]);
    expect(posted[0]!.body.content).toContain("for Arcs");
  });

  it("needs somebody signed in, on a game they can see, sending JSON", async () => {
    expect((await call("POST", "/api/hub/homes/umbra/stop", undefined, {})).status).toBe(401);
    expect((await call("POST", "/api/hub/homes/hidden/stop", await as("1001"), {})).status).toBe(404);
    expect((await call("POST", "/api/hub/homes/test-game/stop", await as("1001"), {})).status).toBe(404);
    expect((await call("POST", "/api/hub/homes/umbra/stop", await as("1001"))).status).toBe(415);
    expect(posted).toHaveLength(0);
    expect(await signs()).toHaveLength(0);
  });

  it("still posts in Discord when email isn't set up, and the job keeps trying the email", async () => {
    withEmail = false;
    const res = await call("POST", "/api/hub/homes/umbra/stop", await as("1001"), {});
    expect(await res.json()).toMatchObject({ posted: true, emailed: false });
    const [row] = await signs();
    expect(row!.lastError).toContain("email isn't set up");

    const job = await db(env).select().from(schema.jobs).where(eq(schema.jobs.id, `${STOP_SIGN_JOB}:${row!.id}`)).get();
    expect(job?.kind).toBe(STOP_SIGN_JOB);
    await expect(retryStopSign(testEnv(), row!.id)).rejects.toThrow(/email/);
    expect(posted).toHaveLength(1);

    withEmail = true;
    await retryStopSign(testEnv(), row!.id);
    expect(emails).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it("sends again after Discord refuses, but never twice after Discord goes quiet", async () => {
    discordAnswer = 403;
    let res = await call("POST", "/api/hub/homes/umbra/stop", await as("1001"), {});
    expect(await res.json()).toMatchObject({ posted: false, unconfirmed: false, emailed: true });
    expect(emails[0]!.text).toContain("couldn't post the alert in Discord yet");
    discordAnswer = null;
    const [refused] = await signs();
    await retryStopSign(testEnv(), refused!.id);
    expect(posted).toHaveLength(1);

    // A 5xx may have posted. It is left alone rather than sent twice.
    discordAnswer = 500;
    res = await call("POST", "/api/hub/homes/umbra/stop", await as("1003"), {});
    expect(await res.json()).toMatchObject({ posted: false, unconfirmed: true });
    discordAnswer = null;
    const quiet = (await signs()).find((s) => s.userId === "1003")!;
    await retryStopSign(testEnv(), quiet.id);
    expect(posted).toHaveLength(1);
  });

  it("stops trying to post once the evening has moved on, and stops emailing after a day", async () => {
    discordAnswer = 403;
    withEmail = false;
    await call("POST", "/api/hub/homes/umbra/stop", await as("1001"), {});
    const [row] = await signs();
    discordAnswer = null;

    // Forty minutes on: too late for the channel, still worth an email.
    await env.DB.prepare("UPDATE stop_signs SET created_at = created_at - 2400").run();
    await expect(retryStopSign(testEnv(), row!.id)).rejects.toThrow(/email/);
    expect(posted).toHaveLength(0);

    // A day and more: Kith gives up on both, and the job is done.
    await env.DB.prepare("UPDATE stop_signs SET created_at = created_at - 90000").run();
    await expect(retryStopSign(testEnv(), row!.id)).resolves.toBeUndefined();
    const [after] = await signs();
    expect(after!.lastError).toContain("too late");
  });
});

describe("the suggestion box", () => {
  it("keeps no name and only the day for an anonymous suggestion", async () => {
    const res = await call("POST", "/api/hub/homes/umbra/suggestions", await as("1001"), {
      body: "  More snack breaks, please.  ",
      anonymous: true,
    });
    expect(res.status).toBe(200);
    const [row] = await suggestions();
    expect(row).toMatchObject({ gameKind: "campaign", gameId: "umbra", authorUserId: null, body: "More snack breaks, please." });
    expect(row!.createdAt % 86_400).toBe(0);
    // Nothing anywhere else that could name them.
    expect(JSON.stringify(row)).not.toContain("1001");
    expect(await db(env).select().from(schema.auditLog).all()).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it("keeps the name when it's left with one", async () => {
    await call("POST", "/api/hub/homes/arcs/suggestions", await as("1001"), { body: "Teach the rules first.", anonymous: false });
    const [row] = await suggestions();
    expect(row).toMatchObject({ gameKind: "board", gameId: "arcs", authorUserId: "1001" });
    expect(posted).toHaveLength(0);
  });

  it("refuses an empty one, a very long one, and one for a game you can't see", async () => {
    const cookie = await as("1001");
    expect((await call("POST", "/api/hub/homes/umbra/suggestions", cookie, { body: "   " })).status).toBe(400);
    expect((await call("POST", "/api/hub/homes/umbra/suggestions", cookie, { body: "x".repeat(2001) })).status).toBe(400);
    expect((await call("POST", "/api/hub/homes/hidden/suggestions", cookie, { body: "hi" })).status).toBe(404);
    expect(await suggestions()).toHaveLength(0);
  });

  it("shows them to an organiser in the console, and to nobody else", async () => {
    await call("POST", "/api/hub/homes/umbra/suggestions", await as("1001"), { body: "Anonymous one", anonymous: true });
    await call("POST", "/api/hub/homes/umbra/suggestions", await as("1001"), { body: "Named one", anonymous: false });

    expect((await call("GET", "/api/suggestions", await as("1001"))).status).toBe(403);
    const res = await call("GET", "/api/suggestions", await as("1003"));
    expect(res.status).toBe(200);
    const { suggestions: rows } = (await res.json()) as {
      suggestions: Array<{ id: string; body: string; author: { name: string } | null; dayOnly: boolean; game: { name: string }; readAt: number | null }>;
    };
    const anonymous = rows.find((r) => r.body === "Anonymous one")!;
    const named = rows.find((r) => r.body === "Named one")!;
    expect(anonymous).toMatchObject({ author: null, dayOnly: true, game: { name: "The Age of Umbra" } });
    expect(named).toMatchObject({ author: { name: "Ada" }, dayOnly: false });

    expect((await call("POST", `/api/suggestions/${anonymous.id}/read`, await as("1003"), {})).status).toBe(200);
    const [after] = (await suggestions()).filter((s) => s.id === anonymous.id);
    expect(after!.readAt).not.toBeNull();
    // Logged as the organiser marking it, with nothing about who wrote it.
    const audit = await db(env).select().from(schema.auditLog).all();
    expect(audit).toEqual([expect.objectContaining({ actorUserId: "1003", action: "suggestion.read", targetId: anonymous.id })]);
    expect(JSON.stringify(audit)).not.toContain("1001");
  });

  it("lists stop signs for an organiser", async () => {
    await call("POST", "/api/hub/homes/umbra/stop", await as("1001"), {});
    const res = await call("GET", "/api/stop-signs", await as("1003"));
    const { stopSigns } = (await res.json()) as { stopSigns: Array<{ person: { name: string }; posted: boolean; emailed: boolean }> };
    expect(stopSigns).toEqual([expect.objectContaining({ person: expect.objectContaining({ name: "Ada" }), posted: true, emailed: true })]);
  });
});
