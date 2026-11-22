import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { createApp } from "../src/http/app.ts";
import { SESSION_COOKIE, issueSession } from "../src/console/cookies.ts";
import { forgetOrganisers } from "../src/http/hub.ts";
import { ASK_JOB, postAsk } from "../src/hub/server-door.ts";
import { isMemberOf } from "../src/hub/membership.ts";
import { InteractionResponseType, InteractionType, MessageFlags } from "../src/discord/types.ts";
import { fakeDiscord } from "./discord.ts";

/**
 * Signing up from the site without being in the Kith server: the signup is
 * written and held, an organiser is asked once, and their answer either makes
 * an invite or gives the places back. Plus In and Interested.
 */
const app = createApp();
const discord = await fakeDiscord();
const realFetch = globalThis.fetch;
const ORGANISER_ROLE = "role-organiser";
const later = Math.floor(Date.now() / 1000) + 7 * 86_400;

/** People Discord says are not in the guild. */
let outsiders = new Set<string>();
let posted: Array<{ channel: string; body: { content: string; components: unknown[] } }> = [];
let invites: string[] = [];
let inviteRefusal: number | null = null;

function testEnv() {
  return {
    ...discord.env(env),
    CONSOLE_SESSION_SECRET: "a-secret",
    DISCORD_APPLICATION_ID: "app-1",
    DISCORD_CLIENT_SECRET: "shh",
    DISCORD_BOT_TOKEN: "bot-token",
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

function signupOf(targetType: "campaign_forming" | "game_day", targetId: string, userId: string) {
  return db(env)
    .select()
    .from(schema.signups)
    .where(
      and(eq(schema.signups.targetType, targetType), eq(schema.signups.targetId, targetId), eq(schema.signups.userId, userId)),
    )
    .get();
}

function requestOf(userId: string) {
  return db(env).select().from(schema.serverRequests).where(eq(schema.serverRequests.userId, userId)).get();
}

beforeEach(async () => {
  outsiders = new Set(["2001"]);
  posted = [];
  invites = [];
  inviteRefusal = null;
  forgetOrganisers();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const member = url.match(/\/members\/(\d+)$/);
    if (member) {
      if (outsiders.has(member[1]!)) return Response.json({ code: 10007, message: "Unknown Member" }, { status: 404 });
      return Response.json({ roles: member[1] === "1003" ? [ORGANISER_ROLE] : [] });
    }
    const invite = url.match(/\/channels\/([^/]+)\/invites$/);
    if (invite) {
      if (inviteRefusal) return Response.json({ code: 50013, message: "Missing Permissions" }, { status: inviteRefusal });
      const code = `inv${invites.length + 1}`;
      invites.push(invite[1]!);
      return Response.json({ code, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    }
    const message = url.match(/\/channels\/([^/]+)\/messages$/);
    if (message) {
      posted.push({ channel: message[1]!, body: JSON.parse(String(init?.body)) });
      return Response.json({ id: `msg-${posted.length}`, channel_id: message[1] });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  for (const table of [
    "server_requests",
    "attendance",
    "signups",
    "campaign_members",
    "sessions",
    "game_days",
    "campaigns",
    "games",
    "audit_log",
    "jobs",
    "publications",
    "discord_tokens",
    "users",
    "settings",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await setSetting(env, SETTING_KEYS.guildId, "g1");
  await setSetting(env, SETTING_KEYS.organiserRoleId, ORGANISER_ROLE);
  await setSetting(env, SETTING_KEYS.schedulingChannelId, "sched-1");
  await setSetting(env, SETTING_KEYS.stagingChannelId, "staging-1");

  await person("1001", "Ada");
  await person("1003", "Rowan");
  await person("2001", "Newcomer");

  await db(env).insert(schema.games).values([
    { id: "daggerheart", name: "Daggerheart", maxPlayers: 5 },
    { id: "arcs", name: "Arcs", category: "board", maxPlayers: 4 },
  ]);
  await db(env).insert(schema.campaigns).values({
    id: "colossus",
    name: "Colossus of the Drylands",
    kind: "run",
    gameId: "daggerheart",
    capacity: 1,
    visibility: "public",
  });
  await db(env).insert(schema.gameDays).values({
    id: "arcs-afternoon",
    kind: "single",
    gameId: "arcs",
    title: "Arcs afternoon",
    state: "SEATING",
    startsAt: later,
    endsAt: later + 4 * 3600,
    capacity: 2,
    visibility: "public",
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("In and Interested", () => {
  it("takes a seat for In and none for Interested", async () => {
    const res = await call("POST", "/api/hub/campaigns/colossus/signup", await as("1001"), { action: "interested" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listing: { mine: string; taken: number; interested: number } };
    expect(body.listing).toMatchObject({ mine: "interested", taken: 0, interested: 1 });
    expect((await signupOf("campaign_forming", "colossus", "1001"))?.state).toBe("interested");
  });

  it("changes only by un-signing up and signing up again", async () => {
    const cookie = await as("1001");
    await call("POST", "/api/hub/game-days/arcs-afternoon/seat", cookie, { action: "interested" });
    await call("POST", "/api/hub/game-days/arcs-afternoon/seat", cookie, { action: "in" });
    expect((await signupOf("game_day", "arcs-afternoon", "1001"))?.state).toBe("interested");

    await call("POST", "/api/hub/game-days/arcs-afternoon/seat", cookie, { action: "out" });
    await call("POST", "/api/hub/game-days/arcs-afternoon/seat", cookie, { action: "in" });
    expect((await signupOf("game_day", "arcs-afternoon", "1001"))?.state).toBe("in");
  });

  it("asks nobody about somebody already in the server", async () => {
    await call("POST", "/api/hub/campaigns/colossus/signup", await as("1001"), { action: "in" });
    expect(await requestOf("1001")).toBeUndefined();
  });

  it("refuses an action it doesn't know", async () => {
    const res = await call("POST", "/api/hub/campaigns/colossus/signup", await as("1001"), { action: "maybe" });
    expect(res.status).toBe(400);
  });
});

describe("somebody not in the server", () => {
  it("is signed up, held, and asked about once", async () => {
    const cookie = await as("2001");
    const res = await call("POST", "/api/hub/campaigns/colossus/signup", cookie, { action: "in" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listing: { mine: string; held: boolean; taken: number } };
    expect(body.listing).toMatchObject({ mine: "in", held: true, taken: 1 });

    await call("POST", "/api/hub/game-days/arcs-afternoon/seat", cookie, { action: "interested" });
    expect((await requestOf("2001"))?.state).toBe("pending");
    const jobs = await db(env).select().from(schema.jobs).where(eq(schema.jobs.kind, ASK_JOB)).all();
    expect(jobs).toHaveLength(1);

    const me = (await (await call("GET", "/api/hub/me", cookie)).json()) as { server: string; invite: string | null };
    expect(me).toMatchObject({ server: "pending", invite: null });
    // A held place is a place, not membership of the table.
    expect(await isMemberOf(env, "campaign", "colossus", "2001")).toBe(false);
  });

  it("posts the ask in the Staging channel, with both buttons", async () => {
    await call("POST", "/api/hub/campaigns/colossus/signup", await as("2001"), { action: "in" });
    await postAsk(env, "2001");
    await postAsk(env, "2001");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.channel).toBe("staging-1");
    expect(posted[0]!.body.content).toContain("Newcomer");
    expect(posted[0]!.body.content).toContain("Colossus of the Drylands: In");
    expect(JSON.stringify(posted[0]!.body.components)).toContain("o1:door:in:2001");
    expect((await requestOf("2001"))?.discordMessageId).toBe("msg-1");
  });

  it("uses the approvals channel when one is set", async () => {
    await setSetting(env, SETTING_KEYS.approvalsChannelId, "approvals-1");
    await call("POST", "/api/hub/campaigns/colossus/signup", await as("2001"), { action: "in" });
    await postAsk(env, "2001");
    expect(posted[0]!.channel).toBe("approvals-1");
  });

  it("gets an invite once an organiser lets them in from the console", async () => {
    const cookie = await as("2001");
    await call("POST", "/api/hub/campaigns/colossus/signup", cookie, { action: "in" });

    const door = (await (await call("GET", "/api/door", await as("1003"))).json()) as {
      rows: Array<{ person: { id: string }; state: string; signups: unknown[] }>;
    };
    expect(door.rows).toHaveLength(1);
    expect(door.rows[0]).toMatchObject({ person: { id: "2001" }, state: "pending" });

    const res = await call("POST", "/api/door/2001/let-in", await as("1003"), {});
    expect(res.status).toBe(200);
    expect(invites).toEqual(["sched-1"]);
    expect((await requestOf("2001"))?.state).toBe("approved");

    const me = (await (await call("GET", "/api/hub/me", cookie)).json()) as { server: string; invite: string | null };
    expect(me).toEqual(expect.objectContaining({ server: "approved", invite: "https://discord.gg/inv1" }));
    const listing = (await (await call("GET", "/api/hub/listings/campaign/colossus", cookie)).json()) as {
      listing: { held: boolean; mine: string };
    };
    expect(listing.listing).toMatchObject({ mine: "in", held: false });

    // Once Discord sees them in the server, the invite goes away.
    outsiders.delete("2001");
    const after = (await (await call("GET", "/api/hub/me", cookie)).json()) as { server: string; invite: string | null };
    expect(after).toEqual(expect.objectContaining({ server: "member", invite: null }));
    expect((await requestOf("2001"))?.joinedAt).not.toBeNull();
  });

  it("stays waiting, and says why, when the bot can't make invites", async () => {
    await call("POST", "/api/hub/campaigns/colossus/signup", await as("2001"), { action: "in" });
    inviteRefusal = 403;
    const res = await call("POST", "/api/door/2001/let-in", await as("1003"), {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Create Invite/);
    expect((await requestOf("2001"))?.state).toBe("pending");
  });

  it("gives every place back when turned away, and can't sign up again", async () => {
    const cookie = await as("2001");
    await call("POST", "/api/hub/campaigns/colossus/signup", cookie, { action: "in" });
    await call("POST", "/api/hub/game-days/arcs-afternoon/seat", cookie, { action: "in" });

    const res = await call("POST", "/api/door/2001/turn-away", await as("1003"), {});
    expect(res.status).toBe(200);
    expect((await signupOf("campaign_forming", "colossus", "2001"))?.state).toBe("out");
    expect((await signupOf("game_day", "arcs-afternoon", "2001"))?.state).toBe("out");

    const again = await call("POST", "/api/hub/campaigns/colossus/signup", cookie, { action: "in" });
    expect(again.status).toBe(403);
  });

  it("is a member, request closed, if they turn up in the server another way", async () => {
    const cookie = await as("2001");
    await call("POST", "/api/hub/campaigns/colossus/signup", cookie, { action: "interested" });
    outsiders.delete("2001");
    await call("POST", "/api/hub/game-days/arcs-afternoon/seat", cookie, { action: "in" });
    const request = await requestOf("2001");
    expect(request?.state).toBe("approved");
    expect(request?.joinedAt).not.toBeNull();
  });
});

describe("the approvals post's buttons", () => {
  async function click(customId: string, roles: string[]) {
    return app.fetch(
      await discord.request({
        type: InteractionType.MESSAGE_COMPONENT,
        data: { custom_id: customId, component_type: 2 },
        member: { user: { id: "1003", username: "rowan", global_name: "Rowan" }, roles },
        guild_id: "g1",
        message: { id: "msg-1", channel_id: "staging-1" },
      }),
      testEnv(),
    );
  }

  it("lets them in for an organiser and rewrites the post without buttons", async () => {
    await call("POST", "/api/hub/campaigns/colossus/signup", await as("2001"), { action: "in" });
    const res = await click("o1:door:in:2001", [ORGANISER_ROLE]);
    const json = (await res.json()) as { type: number; data: { content: string; components: unknown[] } };
    expect(json.type).toBe(InteractionResponseType.UPDATE_MESSAGE);
    expect(json.data.content).toContain("Let in by <@1003>");
    expect(json.data.content).toContain("https://discord.gg/inv1");
    expect(json.data.components).toEqual([]);
    expect((await requestOf("2001"))?.decidedBy).toBe("1003");
  });

  it("refuses anybody else, ephemerally, and changes nothing", async () => {
    await call("POST", "/api/hub/campaigns/colossus/signup", await as("2001"), { action: "in" });
    const res = await click("o1:door:no:2001", []);
    const json = (await res.json()) as { type: number; data: { flags: number } };
    expect(json.type).toBe(InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    expect(json.data.flags & MessageFlags.EPHEMERAL).toBeTruthy();
    expect((await requestOf("2001"))?.state).toBe("pending");
  });

  it("degrades a malformed id to the retired-post response", async () => {
    const res = await click("o1:door:maybe:2001", [ORGANISER_ROLE]);
    const json = (await res.json()) as { data: { content: string } };
    expect(json.data.content).toMatch(/retired/);
  });
});
