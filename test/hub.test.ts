import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { createApp } from "../src/http/app.ts";
import { SESSION_COOKIE, issueSession } from "../src/console/cookies.ts";
import { canSee } from "../src/hub/visibility.ts";
import { forgetOrganisers } from "../src/http/hub.ts";

/**
 * The site's API. What matters: anybody can read what is public and nothing
 * else, a signed-in person acts only as themselves, and the writes go through
 * the same paths the Discord buttons do.
 */
const app = createApp();
const realFetch = globalThis.fetch;
const ORGANISER_ROLE = "role-organiser";
const later = Math.floor(Date.now() / 1000) + 7 * 86_400;

let roles: Record<string, string[]> = {};

function hubEnv() {
  return {
    ...env,
    CONSOLE_SESSION_SECRET: "a-secret",
    DISCORD_APPLICATION_ID: "app-1",
    DISCORD_CLIENT_SECRET: "shh",
    DISCORD_BOT_TOKEN: "bot-token",
  };
}

async function as(userId: string) {
  return `${SESSION_COOKIE}=${await issueSession(hubEnv(), userId, new Date())}`;
}

function call(method: string, path: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.fetch(
    new Request(`https://orrey.test${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    hubEnv(),
  );
}

async function person(id: string, name: string) {
  await db(env).insert(schema.users).values({ discordId: id, username: name, globalName: name, feedToken: `t-${id}` });
  await db(env)
    .insert(schema.discordTokens)
    .values({ userId: id, accessToken: "at", refreshToken: "rt", expiresAt: Math.floor(Date.now() / 1000) + 86_400 });
}

beforeEach(async () => {
  roles = {};
  forgetOrganisers();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const member = url.match(/\/members\/(\d+)/);
    if (member) return Response.json({ roles: roles[member[1]!] ?? [] });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  for (const table of [
    "attendance",
    "signups",
    "campaign_members",
    "sessions",
    "game_days",
    "campaigns",
    "games",
    "audit_log",
    "discord_tokens",
    "users",
    "settings",
  ]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await setSetting(env, SETTING_KEYS.guildId, "g1");
  await setSetting(env, SETTING_KEYS.organiserRoleId, ORGANISER_ROLE);

  await person("1001", "Ada");
  await person("1002", "Grace");
  await person("1003", "Rowan");

  await db(env).insert(schema.games).values([
    { id: "daggerheart", name: "Daggerheart", maxPlayers: 5 },
    { id: "arcs", name: "Arcs", category: "board", maxPlayers: 4 },
  ]);
  await db(env).insert(schema.campaigns).values([
    { id: "hollowmere", name: "Hollowmere", kind: "run", gameId: "daggerheart", capacity: 1, visibility: "public", tagline: "Fog on the water." },
    { id: "secret", name: "Secret table", kind: "run", gameId: "daggerheart" },
  ]);
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

describe("the visibility rule", () => {
  it("is public for anybody, members for the table, organisers for organisers", () => {
    const anon = { userId: undefined, organiser: false };
    const ada = { userId: "1001", organiser: false };
    const boss = { userId: "1003", organiser: true };
    expect(canSee("public", anon, false)).toBe(true);
    expect(canSee("members", anon, true)).toBe(false);
    expect(canSee("members", ada, false)).toBe(false);
    expect(canSee("members", ada, true)).toBe(true);
    expect(canSee("organisers", ada, true)).toBe(false);
    expect(canSee("organisers", boss, false)).toBe(true);
  });
});

describe("reading the hub", () => {
  it("answers who you are, or that you are nobody yet", async () => {
    expect(await (await call("GET", "/api/hub/me")).json()).toEqual({ signedIn: false });

    roles["1003"] = [ORGANISER_ROLE];
    const me = (await (await call("GET", "/api/hub/me", await as("1003"))).json()) as Record<string, unknown>;
    expect(me).toMatchObject({ signedIn: true, organiser: true, user: { id: "1003", name: "Rowan" } });
  });

  it("lists public open tables to anybody and hides the rest", async () => {
    const { listings } = (await (await call("GET", "/api/hub/listings")).json()) as {
      listings: { id: string; kind: string }[];
    };
    expect(listings.map((l) => l.id)).toEqual(["hollowmere", "arcs-afternoon"]);
  });

  it("shows organisers everything", async () => {
    roles["1003"] = [ORGANISER_ROLE];
    const { listings } = (await (await call("GET", "/api/hub/listings", await as("1003"))).json()) as {
      listings: { id: string }[];
    };
    expect(listings.map((l) => l.id)).toContain("secret");
  });

  it("answers a hidden splash page exactly like a missing one", async () => {
    const hidden = await call("GET", "/api/hub/listings/campaign/secret");
    const missing = await call("GET", "/api/hub/listings/campaign/nope");
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());

    const open = (await (await call("GET", "/api/hub/listings/campaign/hollowmere")).json()) as {
      listing: Record<string, unknown>;
    };
    expect(open.listing).toMatchObject({ name: "Hollowmere", tagline: "Fog on the water.", capacity: 1, taken: 0, open: true });
  });

  it("serves the catalog to anybody", async () => {
    const { games } = (await (await call("GET", "/api/hub/games")).json()) as { games: { id: string; category: string }[] };
    expect(games).toMatchObject([
      { id: "arcs", category: "board" },
      { id: "daggerheart", category: "ttrpg" },
    ]);
  });
});

describe("signing up from the site", () => {
  it("needs a signed-in person and a JSON body", async () => {
    expect((await call("POST", "/api/hub/campaigns/hollowmere/signup", undefined, { action: "seat" })).status).toBe(401);
    const form = await app.fetch(
      new Request("https://orrey.test/api/hub/campaigns/hollowmere/signup", {
        method: "POST",
        headers: { cookie: await as("1001"), "content-type": "application/x-www-form-urlencoded" },
        body: "action=seat",
      }),
      hubEnv(),
    );
    expect(form.status).toBe(415);

    // A media type that merely mentions JSON is a simple request a page can send cross-origin.
    const sneaky = await app.fetch(
      new Request("https://orrey.test/api/hub/campaigns/hollowmere/signup", {
        method: "POST",
        headers: { cookie: await as("1001"), "content-type": "text/plain; x=application/json" },
        body: JSON.stringify({ action: "seat" }),
      }),
      hubEnv(),
    );
    expect(sneaky.status).toBe(415);
  });

  it("refuses a write that says it came from somewhere else", async () => {
    for (const headers of [{ origin: "https://other.alxjrvs.com" }, { "sec-fetch-site": "same-site" }]) {
      const response = await app.fetch(
        new Request("https://orrey.test/api/hub/campaigns/hollowmere/signup", {
          method: "POST",
          headers: { cookie: await as("1001"), "content-type": "application/json", ...headers },
          body: JSON.stringify({ action: "seat" }),
        }),
        hubEnv(),
      );
      expect(response.status).toBe(403);
    }
    expect(await db(env).select().from(schema.signups).all()).toEqual([]);
  });

  it("seats the first, queues the next, and moves the queue up when a seat frees", async () => {
    const first = await call("POST", "/api/hub/campaigns/hollowmere/signup", await as("1001"), { action: "seat" });
    expect(await first.json()).toMatchObject({ outcome: "seated", listing: { taken: 1, mine: "in" } });

    const second = await call("POST", "/api/hub/campaigns/hollowmere/signup", await as("1002"), { action: "seat" });
    expect(await second.json()).toMatchObject({ outcome: "waitlisted", listing: { taken: 1, waitlist: 1, mine: "waitlisted" } });

    await call("POST", "/api/hub/campaigns/hollowmere/signup", await as("1001"), { action: "out" });
    const grace = await db(env).select().from(schema.signups).all();
    expect(grace.find((s) => s.userId === "1002")?.state).toBe("in");
    expect(grace.find((s) => s.userId === "1001")?.state).toBe("out");
  });

  it("will not sign anybody up to a campaign they cannot see", async () => {
    const response = await call("POST", "/api/hub/campaigns/secret/signup", await as("1001"), { action: "seat" });
    expect(response.status).toBe(404);
    expect(await db(env).select().from(schema.signups).all()).toEqual([]);
  });

  it("takes a game-day seat through the same lock the buttons use", async () => {
    const response = await call("POST", "/api/hub/game-days/arcs-afternoon/seat", await as("1001"), { action: "seat" });
    expect(await response.json()).toMatchObject({ listing: { taken: 1, mine: "in", capacity: 2 } });

    const out = await call("POST", "/api/hub/game-days/arcs-afternoon/seat", await as("1001"), { action: "out" });
    expect(await out.json()).toMatchObject({ listing: { taken: 0, mine: null } });
  });
});

describe("saying in or out from the site", () => {
  beforeEach(async () => {
    await db(env).update(schema.campaigns).set({ state: "RUNNING", recurrenceAnchor: later, intervalWeeks: 2 });
    await db(env).insert(schema.campaignMembers).values({ campaignId: "hollowmere", userId: "1001" });
    await db(env).insert(schema.sessions).values({
      id: "s1",
      kind: "campaign_session",
      campaignId: "hollowmere",
      startsAt: later,
      endsAt: later + 3600,
    });
  });

  it("is for the people at that table", async () => {
    const stranger = await call("POST", "/api/hub/sessions/s1/intent", await as("1002"), { intent: "in" });
    expect(stranger.status).toBe(403);
  });

  it("writes the answer and shows it on the agenda", async () => {
    const response = await call("POST", "/api/hub/sessions/s1/intent", await as("1001"), { intent: "maybe" });
    expect(response.status).toBe(200);

    const agenda = (await (await call("GET", "/api/hub/agenda", await as("1001"))).json()) as {
      rows: { sessionId: string; mine: boolean; myIntent: string }[];
    };
    expect(agenda.rows).toMatchObject([{ sessionId: "s1", mine: true, myIntent: "maybe" }]);

    const theirs = (await (await call("GET", "/api/hub/agenda", await as("1002"))).json()) as { rows: unknown[] };
    expect(theirs.rows).toEqual([]);
  });
});

describe("a game day on the agenda", () => {
  beforeEach(async () => {
    await db(env).update(schema.gameDays).set({ visibility: "members", hostUserId: "1003" });
    await db(env).insert(schema.sessions).values({
      id: "d1",
      kind: "one_off",
      gameDayId: "arcs-afternoon",
      startsAt: later,
      endsAt: later + 3600,
    });
  });

  it("is on the host's agenda and theirs to answer, seat or no seat", async () => {
    const agenda = (await (await call("GET", "/api/hub/agenda", await as("1003"))).json()) as {
      rows: { sessionId: string; mine: boolean; canAnswer: boolean }[];
    };
    expect(agenda.rows).toMatchObject([{ sessionId: "d1", mine: true, canAnswer: true }]);
  });

  it("shows the waitlist the day without letting them answer for it", async () => {
    await db(env).insert(schema.signups).values({ targetType: "game_day", targetId: "arcs-afternoon", userId: "1002", state: "waitlisted", position: 1 });
    const agenda = (await (await call("GET", "/api/hub/agenda", await as("1002"))).json()) as {
      rows: { sessionId: string; mine: boolean; canAnswer: boolean }[];
    };
    expect(agenda.rows).toMatchObject([{ sessionId: "d1", mine: true, canAnswer: false }]);
    expect((await call("POST", "/api/hub/sessions/d1/intent", await as("1002"), { intent: "in" })).status).toBe(403);
  });
});

describe("organisers writing a listing", () => {
  it("is organisers only, takes https links only, and is audited", async () => {
    const refused = await call("PATCH", "/api/campaigns/hollowmere/listing", await as("1001"), { pitch: "x" });
    expect(refused.status).toBe(403);

    roles["1003"] = [ORGANISER_ROLE];
    const plain = await call("PATCH", "/api/campaigns/hollowmere/listing", await as("1003"), { heroUrl: "http://example.com/a.jpg" });
    expect(plain.status).toBe(400);

    const ok = await call("PATCH", "/api/campaigns/hollowmere/listing", await as("1003"), {
      heroUrl: "https://example.com/a.jpg",
      soundUrl: "https://example.com/a.mp3",
      pitch: "  A drowned town.  ",
    });
    expect(ok.status).toBe(200);
    const row = await db(env).select().from(schema.campaigns).all();
    expect(row.find((c) => c.id === "hollowmere")).toMatchObject({ pitch: "A drowned town.", heroUrl: "https://example.com/a.jpg" });
    const audit = await db(env).select().from(schema.auditLog).all();
    expect(audit.map((a) => a.action)).toContain("campaign.listing");
  });

  it("edits the catalog entry", async () => {
    roles["1003"] = [ORGANISER_ROLE];
    const ok = await call("PATCH", "/api/games/arcs/catalog", await as("1003"), { summary: "Space knives.", category: "board" });
    expect(ok.status).toBe(200);
    const bad = await call("PATCH", "/api/games/arcs/catalog", await as("1003"), { category: "card" });
    expect(bad.status).toBe(400);
  });
});
