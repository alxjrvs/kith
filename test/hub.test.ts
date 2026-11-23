import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { createApp } from "../src/http/app.ts";
import { SESSION_COOKIE, issueSession } from "../src/console/cookies.ts";
import { canSee } from "../src/hub/visibility.ts";
import { forgetOrganisers } from "../src/http/hub.ts";
import { resetCmsCache } from "../src/cms/client.ts";
import { plain } from "../src/hub/public-campaigns.ts";

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

/** kith-cms's published entries, by collection, when a test sets them (src/cms/client.ts). */
let cmsEntries: Record<string, Array<{ slug: string; data: Record<string, unknown> }>> | null = null;
const fakeCms = {
  fetch: async (input: RequestInfo | URL) => {
    const collection = new URL(String(input instanceof Request ? input.url : input)).pathname.split("/").pop()!;
    const items = (cmsEntries?.[collection] ?? []).map((e, i) => ({ id: `e${i}`, status: "published", ...e }));
    return Response.json({ success: true, data: { items } });
  },
} as unknown as Fetcher;

function hubEnv() {
  return {
    ...env,
    ...(cmsEntries ? { CMS: fakeCms, CMS_TOKEN: "ec_pat_test" } : {}),
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
    new Request(`https://kith.test${path}`, {
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
      new Request("https://kith.test/api/hub/campaigns/hollowmere/signup", {
        method: "POST",
        headers: { cookie: await as("1001"), "content-type": "application/x-www-form-urlencoded" },
        body: "action=seat",
      }),
      hubEnv(),
    );
    expect(form.status).toBe(415);

    // A media type that merely mentions JSON is a simple request a page can send cross-origin.
    const sneaky = await app.fetch(
      new Request("https://kith.test/api/hub/campaigns/hollowmere/signup", {
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
        new Request("https://kith.test/api/hub/campaigns/hollowmere/signup", {
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

describe("each game's home base", () => {
  async function runHollowmere() {
    await env.DB.prepare(`UPDATE campaigns SET state = 'RUNNING' WHERE id = 'hollowmere'`).run();
    await db(env).insert(schema.campaignMembers).values([
      { campaignId: "hollowmere", userId: "1003", role: "gm" },
      { campaignId: "hollowmere", userId: "1001", role: "player", characterName: "Wren Ashdown" },
    ]);
    await db(env).insert(schema.sessions).values({
      id: "s1",
      kind: "campaign_session",
      campaignId: "hollowmere",
      startsAt: later,
      endsAt: later + 3600,
    });
  }

  type Home = {
    kind: string;
    roster?: {
      person: { name: string } | null;
      character: string | null;
      sheetUrl?: string | null;
      description?: string | null;
      mine?: boolean;
      role: string;
      state: string;
    }[];
    listing?: { tagline: string | null; pitch: string | null };
    links?: { label: string }[];
    pages?: { slug: string }[];
    upcoming: { sessionId?: string; listing?: { id: string }; seats?: { person: { name: string } | null }[] }[];
  };

  it("maps players to characters, GM first, and lists the next sessions", async () => {
    await runHollowmere();
    const res = await call("GET", "/api/hub/homes/hollowmere", await as("1001"));
    expect(res.status).toBe(200);
    const { home } = (await res.json()) as { home: Home };
    expect(home.kind).toBe("campaign");
    expect(home.roster).toEqual([
      { person: expect.objectContaining({ name: "Rowan" }), character: null, sheetUrl: null, description: null, mine: false, role: "gm", state: "in" },
      { person: expect.objectContaining({ name: "Ada" }), character: "Wren Ashdown", sheetUrl: null, description: null, mine: true, role: "player", state: "in" },
    ]);
    expect(home.upcoming.map((r) => r.sessionId)).toEqual(["s1"]);
  });

  it("takes a game's words, characters, sheets and pages from kith-cms", async () => {
    await runHollowmere();
    cmsEntries = {
      games: [{ slug: "hollowmere", data: { title: "Hollowmere", tagline: "From the CMS", system: "Daggerheart", cover: { id: "m", src: "/_emdash/api/media/file/01AB.01CD.png" }, pitch: [{ _type: "block", style: "normal", children: [{ text: "Fog on the moor." }] }] } }],
      characters: [{ slug: "c", data: { name: "Vess", game: "hollowmere", player: "ada", sheet: "https://sheets.example/vess" } }],
      pages: [{ slug: "house-rules", data: { title: "House rules", game: "hollowmere", visibility: "members", content: [{ _type: "block", style: "h2", children: [{ text: "Dice" }] }] } }],
      links: [{ slug: "l", data: { label: "Foundry", url: "https://vtt.example", game: "hollowmere", kind: "vtt", visibility: "public" } }],
    };
    resetCmsCache();
    try {
      const { home } = (await (await call("GET", "/api/hub/homes/hollowmere", await as("1001"))).json()) as { home: Home };
      expect(home.listing?.tagline).toBe("From the CMS");
      expect(home.listing).toMatchObject({ system: "Daggerheart", logoUrl: "/media/01AB.01CD.png" });
      expect(home.listing?.pitch).toBe("Fog on the moor.");
      // The slideshow's list carries the description too.
      const { games } = (await (await call("GET", "/api/hub/homes")).json()) as { games: { slug: string; pitch: string | null }[] };
      expect(games.find((g) => g.slug === "hollowmere")?.pitch).toBe("Fog on the moor.");
      expect(home.roster?.[1]).toMatchObject({ character: "Vess", sheetUrl: "https://sheets.example/vess" });
      expect(home.links?.map((l) => l.label)).toContain("Foundry");
      expect(home.pages?.map((p) => p.slug)).toContain("house-rules");
      // Off the table: the members-only page is not listed.
      const outside = (await (await call("GET", "/api/hub/homes/hollowmere")).json()) as { home: Home };
      expect(outside.home.pages?.map((p) => p.slug) ?? []).not.toContain("house-rules");
    } finally {
      cmsEntries = null;
      resetCmsCache();
    }
  });

  it("serves the site's own copy from kith-cms, and nothing when it is not there", async () => {
    expect(await (await call("GET", "/api/hub/copy")).json()).toEqual({ copy: {} });
    cmsEntries = {
      sections: [{ slug: "home", data: { title: "Every game we run", kicker: "Kith", body: [{ _type: "block", style: "normal", children: [{ text: "Pull up a chair." }] }] } }],
    };
    resetCmsCache();
    try {
      const { copy } = (await (await call("GET", "/api/hub/copy")).json()) as { copy: Record<string, unknown> };
      expect(copy.home).toEqual({ title: "Every game we run", kicker: "Kith", body: "Pull up a chair." });
    } finally {
      cmsEntries = null;
      resetCmsCache();
    }
  });

  it("shows anyone off the table the characters but not the people", async () => {
    await runHollowmere();
    for (const cookie of [undefined, await as("1002")]) {
      const { home } = (await (await call("GET", "/api/hub/homes/hollowmere", cookie)).json()) as { home: Home };
      // The GM is public already, as the listing's lead; the players are not.
      expect(home.roster?.map((s) => [s.person?.name ?? null, s.character])).toEqual([
        ["Rowan", null],
        [null, "Wren Ashdown"],
      ]);
    }
  });

  it("answers a hidden game exactly like a missing one", async () => {
    const hidden = await call("GET", "/api/hub/homes/secret");
    const missing = await call("GET", "/api/hub/homes/nope");
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
    // A TTRPG system is a label on a campaign, not a game with a home of its own.
    expect((await call("GET", "/api/hub/homes/daggerheart")).status).toBe(404);
  });

  it("gives a board game its upcoming days and who has a seat", async () => {
    await db(env).insert(schema.signups).values({ targetType: "game_day", targetId: "arcs-afternoon", userId: "1002", state: "in", position: 1 });
    const seated = (await (await call("GET", "/api/hub/homes/arcs", await as("1002"))).json()) as { home: Home };
    expect(seated.home.kind).toBe("board");
    expect(seated.home.upcoming.map((d) => d.listing?.id)).toEqual(["arcs-afternoon"]);
    expect(seated.home.upcoming[0]!.seats?.map((s) => s.person?.name)).toEqual(["Grace"]);
    const stranger = (await (await call("GET", "/api/hub/homes/arcs", await as("1001"))).json()) as { home: Home };
    expect(stranger.home.upcoming[0]!.seats?.map((s) => s.person)).toEqual([null]);
  });

  it("lists every game the viewer may see on the hub, and nothing else", async () => {
    const anon = (await (await call("GET", "/api/hub/homes")).json()) as { games: { slug: string; kind: string }[] };
    expect(anon.games.map((g) => [g.kind, g.slug])).toEqual([
      ["campaign", "hollowmere"],
      ["board", "arcs"],
    ]);

    roles["1003"] = [ORGANISER_ROLE];
    const boss = (await (await call("GET", "/api/hub/homes", await as("1003"))).json()) as { games: { slug: string }[] };
    expect(boss.games.map((g) => g.slug)).toEqual(["hollowmere", "secret", "arcs"]);
  });
});

describe("naming past sessions", () => {
  const earlier = Math.floor(Date.now() / 1000) - 14 * 86_400;

  async function playedHollowmere() {
    await env.DB.prepare(`UPDATE campaigns SET state = 'RUNNING' WHERE id = 'hollowmere'`).run();
    await db(env).insert(schema.campaignMembers).values([
      { campaignId: "hollowmere", userId: "1003", role: "gm" },
      { campaignId: "hollowmere", userId: "1001", role: "player" },
    ]);
    await db(env).insert(schema.sessions).values([
      { id: "old", kind: "campaign_session", campaignId: "hollowmere", startsAt: earlier - 14 * 86_400, endsAt: earlier - 14 * 86_400 + 3600, state: "PLAYED", title: "He Who Is Transplanted" },
      { id: "last", kind: "campaign_session", campaignId: "hollowmere", startsAt: earlier, endsAt: earlier + 3600, state: "PLAYED" },
      { id: "off", kind: "campaign_session", campaignId: "hollowmere", startsAt: earlier - 7 * 86_400, endsAt: earlier - 7 * 86_400 + 3600, state: "CANCELLED" },
      { id: "vetoed", kind: "campaign_session", campaignId: "hollowmere", startsAt: earlier - 3 * 86_400, endsAt: earlier - 3 * 86_400 + 3600, state: "JEOPARDY" },
      { id: "next", kind: "campaign_session", campaignId: "hollowmere", startsAt: later, endsAt: later + 3600 },
    ]);
  }

  type Past = { home: { past: { sessionId: string; title: string | null }[]; canName: boolean } };

  it("lists played sessions newest first with their names, and nothing signed out", async () => {
    await playedHollowmere();
    const member = (await (await call("GET", "/api/hub/homes/hollowmere", await as("1001"))).json()) as Past;
    expect(member.home.past).toEqual([
      expect.objectContaining({ sessionId: "last", title: null }),
      expect.objectContaining({ sessionId: "old", title: "He Who Is Transplanted" }),
    ]);
    expect(member.home.canName).toBe(false);
    const gm = (await (await call("GET", "/api/hub/homes/hollowmere", await as("1003"))).json()) as Past;
    expect(gm.home.canName).toBe(true);
    const outside = (await (await call("GET", "/api/hub/homes/hollowmere")).json()) as Past;
    expect(outside.home.past).toEqual([]);
  });

  it("lets the GM name, rename and clear one, audited", async () => {
    await playedHollowmere();
    const gm = await as("1003");
    expect((await call("PATCH", "/api/hub/sessions/last/title", gm, { title: "  Where There's   Smoke " })).status).toBe(200);
    let row = await db(env).select().from(schema.sessions).where(eq(schema.sessions.id, "last")).get();
    expect(row?.title).toBe("Where There's Smoke");
    expect((await call("PATCH", "/api/hub/sessions/last/title", gm, { title: "" })).status).toBe(200);
    row = await db(env).select().from(schema.sessions).where(eq(schema.sessions.id, "last")).get();
    expect(row?.title).toBeNull();
    const audit = await db(env).select().from(schema.auditLog).where(eq(schema.auditLog.action, "session.title")).all();
    expect(audit.map((a) => a.detail)).toEqual([
      { before: null, after: "Where There's Smoke" },
      { before: "Where There's Smoke", after: null },
    ]);
  });

  it("lets an organiser off the table name one, and nobody else", async () => {
    await playedHollowmere();
    expect((await call("PATCH", "/api/hub/sessions/last/title", await as("1001"), { title: "Mine now" })).status).toBe(403);
    expect((await call("PATCH", "/api/hub/sessions/last/title", undefined, { title: "Anyone" })).status).toBe(401);
    roles["1002"] = [ORGANISER_ROLE];
    expect((await call("PATCH", "/api/hub/sessions/last/title", await as("1002"), { title: "Dust in the Wind" })).status).toBe(200);
  });

  it("refuses a session not yet played, a cancelled one, and a name too long", async () => {
    await playedHollowmere();
    const gm = await as("1003");
    expect((await call("PATCH", "/api/hub/sessions/next/title", gm, { title: "Too soon" })).status).toBe(409);
    expect((await call("PATCH", "/api/hub/sessions/off/title", gm, { title: "Never was" })).status).toBe(409);
    expect((await call("PATCH", "/api/hub/sessions/vetoed/title", gm, { title: "Never moved" })).status).toBe(409);
    expect((await call("PATCH", "/api/hub/sessions/last/title", gm, { title: "x".repeat(201) })).status).toBe(400);
    expect((await call("PATCH", "/api/hub/sessions/last/title", gm, { title: 7 })).status).toBe(400);
    expect((await call("PATCH", "/api/hub/sessions/nope/title", gm, { title: "Who" })).status).toBe(404);
    // A body with no title is refused rather than read as "clear it".
    await call("PATCH", "/api/hub/sessions/old/title", gm, { title: "Kept" });
    expect((await call("PATCH", "/api/hub/sessions/old/title", gm, { name: "Oops" })).status).toBe(400);
    const row = await db(env).select().from(schema.sessions).where(eq(schema.sessions.id, "old")).get();
    expect(row?.title).toBe("Kept");
  });
});

describe("a player writing their own character", () => {
  async function runHollowmere() {
    await env.DB.prepare(`UPDATE campaigns SET state = 'RUNNING' WHERE id = 'hollowmere'`).run();
    await db(env).insert(schema.campaignMembers).values([
      { campaignId: "hollowmere", userId: "1003", role: "gm" },
      { campaignId: "hollowmere", userId: "1001", role: "player", characterName: "Wren Ashdown" },
    ]);
  }
  type Seat = { person: { name: string } | null; character: string | null; sheetUrl: string | null; description: string | null; mine: boolean };
  const roster = async (cookie?: string) =>
    ((await (await call("GET", "/api/hub/homes/hollowmere", cookie)).json()) as { home: { roster: Seat[] } }).home.roster;
  const put = (cookie: string | undefined, body: unknown) => call("PUT", "/api/hub/homes/hollowmere/character", cookie, body);

  it("saves a name, a sheet and a few words, shown to everyone who sees the roster", async () => {
    await runHollowmere();
    const ada = await as("1001");
    const res = await put(ada, { name: "  Vess Moorlight ", sheetUrl: "https://sheets.example/vess", description: "A lamplighter." });
    expect(res.status).toBe(200);
    expect((await roster(ada))[1]).toMatchObject({
      character: "Vess Moorlight",
      sheetUrl: "https://sheets.example/vess",
      description: "A lamplighter.",
      mine: true,
    });
    // Off the table: the character, not the person, and not theirs to edit.
    expect((await roster())[1]).toMatchObject({ person: null, character: "Vess Moorlight", description: "A lamplighter.", mine: false });

    const audit = await db(env).select().from(schema.auditLog).all();
    expect(audit.find((a) => a.action === "member.character")).toMatchObject({ actorUserId: "1001", targetId: "hollowmere" });
  });

  it("wins over a character written in kith-cms once the player has written theirs", async () => {
    await runHollowmere();
    cmsEntries = { characters: [{ slug: "c", data: { name: "From the CMS", game: "hollowmere", player: "ada", sheet: "https://cms.example/sheet" } }] };
    resetCmsCache();
    try {
      const ada = await as("1001");
      expect((await roster(ada))[1]).toMatchObject({ character: "From the CMS", sheetUrl: "https://cms.example/sheet" });
      // The sheet is optional, and an empty one clears the CMS's link too.
      expect((await put(ada, { name: "Vess", sheetUrl: "", description: "" })).status).toBe(200);
      expect((await roster(ada))[1]).toMatchObject({ character: "Vess", sheetUrl: null, description: null });
    } finally {
      cmsEntries = null;
      resetCmsCache();
    }
  });

  it("needs a name and a real link", async () => {
    await runHollowmere();
    const ada = await as("1001");
    expect((await put(ada, { name: "  " })).status).toBe(400);
    const bad = await put(ada, { name: "Vess", sheetUrl: "javascript:alert(1)" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/https/);
    expect((await put(ada, { name: "x".repeat(81) })).status).toBe(400);
    expect((await roster(ada))[1]?.character).toBe("Wren Ashdown");
  });

  it("is only for players on the roster, signed in", async () => {
    await runHollowmere();
    expect((await put(undefined, { name: "Vess" })).status).toBe(401);
    // The GM runs the table; somebody off it has no seat to describe.
    expect((await put(await as("1003"), { name: "Vess" })).status).toBe(403);
    expect((await put(await as("1002"), { name: "Vess" })).status).toBe(403);
    expect((await call("PUT", "/api/hub/homes/nope/character", await as("1001"), { name: "Vess" })).status).toBe(404);
    expect((await roster(await as("1003"))).some((s) => s.mine)).toBe(false);
  });
});

describe("the hub's loose ends", () => {
  it("keeps a day with no board game findable, and marks a board game open when any day is", async () => {
    await db(env).insert(schema.gameDays).values([
      { id: "big-day", kind: "multi", title: "Big day", state: "SEATING", startsAt: later, endsAt: later + 3600, visibility: "public" },
      { id: "arcs-locked", kind: "single", gameId: "arcs", state: "LOCKED", startsAt: later - 3600 * 24, endsAt: later - 3600 * 20, visibility: "public" },
    ]);
    await env.DB.prepare(`UPDATE game_days SET state = 'SEATING' WHERE id = 'arcs-afternoon'`).run();
    await db(env).insert(schema.signups).values({ targetType: "game_day", targetId: "arcs-afternoon", userId: "1002", state: "in", position: 1 });
    const { games } = (await (await call("GET", "/api/hub/homes", await as("1002"))).json()) as {
      games: { kind: string; slug: string; open: boolean; mine: boolean; state: string }[];
    };
    expect(games.find((g) => g.slug === "big-day")).toMatchObject({ kind: "day", open: true });
    expect(games.find((g) => g.slug === "arcs")).toMatchObject({ kind: "board", open: true, mine: true, state: "SEATING" });
  });
});

describe("each game's calendar", () => {
  it("hands a player in one of the game's days their own feed of it, and nobody else one", async () => {
    await db(env).insert(schema.sessions).values({ id: "d1", kind: "one_off", gameDayId: "arcs-afternoon", startsAt: later, endsAt: later + 3600 });
    await env.DB.prepare(`UPDATE game_days SET state = 'SEATING' WHERE id = 'arcs-afternoon'`).run();
    await db(env).insert(schema.signups).values([
      { targetType: "game_day", targetId: "arcs-afternoon", userId: "1001", state: "in", position: 1 },
      { targetType: "game_day", targetId: "arcs-afternoon", userId: "1002", state: "interested", position: 2 },
    ]);
    const urlFor = async (who?: string) =>
      ((await (await call("GET", "/api/hub/homes/arcs", who ? await as(who) : undefined)).json()) as { home: { calendarUrl: string | null } }).home.calendarUrl;

    // Signed out, only interested, or an organiser off the table: no calendar.
    expect(await urlFor()).toBeNull();
    expect(await urlFor("1002")).toBeNull();
    expect(await urlFor("1003")).toBeNull();

    const { home } = (await (await call("GET", "/api/hub/homes/arcs", await as("1001"))).json()) as { home: { calendarUrl: string } };
    expect(home.calendarUrl).toBe("https://kith.test/ics/t-1001/game/arcs.ics");
    const feed = await call("GET", "/ics/t-1001/game/arcs.ics");
    expect(feed.status).toBe(200);
    expect(await feed.text()).toContain("BEGIN:VEVENT");

    // A TTRPG system is not a board game, and a wrong token is nobody.
    expect((await call("GET", "/ics/t-1001/game/daggerheart.ics")).status).toBe(404);
    expect((await call("GET", "/ics/nope/game/arcs.ics")).status).toBe(404);
  });

  it("gives a public campaign's feed to anyone signed in, and a members-only one to its roster only", async () => {
    expect((await call("GET", "/ics/t-1002/campaign/hollowmere.ics")).status).toBe(200);
    expect((await call("GET", "/ics/t-1002/campaign/secret.ics")).status).toBe(404);
    await db(env).insert(schema.campaignMembers).values({ campaignId: "secret", userId: "1002" });
    expect((await call("GET", "/ics/t-1002/campaign/secret.ics")).status).toBe(200);
  });

  it("offers a campaign's calendar to its roster only", async () => {
    const urlFor = async (who?: string) =>
      ((await (await call("GET", "/api/hub/homes/hollowmere", who ? await as(who) : undefined)).json()) as { home: { calendarUrl: string | null } }).home
        .calendarUrl;
    expect(await urlFor()).toBeNull();
    expect(await urlFor("1002")).toBeNull();
    await db(env).insert(schema.signups).values({ targetType: "campaign_forming", targetId: "hollowmere", userId: "1002", state: "interested", position: 1 });
    expect(await urlFor("1002")).toBeNull();
    await db(env).insert(schema.campaignMembers).values({ campaignId: "hollowmere", userId: "1002" });
    expect(await urlFor("1002")).toBe("https://kith.test/ics/t-1002/campaign/hollowmere.ics");
  });
});

describe("the public campaigns feed", () => {
  type Feed = { campaigns: Array<Record<string, unknown>> };
  const feed = async (cookie?: string) => (await (await call("GET", "/api/hub/campaigns", cookie)).json()) as Feed;

  it("lists public campaigns that are running or signing up, with no people in them", async () => {
    await db(env).insert(schema.campaigns).values([
      { id: "ember", name: "Ember", kind: "run", gameId: "daggerheart", state: "RUNNING", visibility: "public", heroUrl: "https://art.example/ember.jpg" },
      { id: "done", name: "Done", kind: "run", gameId: "daggerheart", state: "CONCLUDED", visibility: "public" },
      { id: "resting", name: "Resting", kind: "run", gameId: "daggerheart", state: "HIATUS", visibility: "public" },
      { id: "test-run", name: "Test run", kind: "run", gameId: "daggerheart", state: "RUNNING", visibility: "public", staging: 1 },
    ]);
    await db(env).insert(schema.campaignMembers).values([
      { campaignId: "ember", userId: "1003", role: "gm" },
      { campaignId: "ember", userId: "1001", role: "player" },
    ]);
    await db(env).insert(schema.sessions).values({ id: "e1", kind: "campaign_session", campaignId: "ember", startsAt: later, endsAt: later + 3600 });

    const res = await call("GET", "/api/hub/campaigns");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const { campaigns } = (await res.json()) as Feed;
    expect(campaigns).toEqual([
      {
        slug: "ember",
        name: "Ember",
        state: "RUNNING",
        open: false,
        system: "Daggerheart",
        tagline: null,
        description: null,
        url: "https://kith.test/games/ember",
        imageUrl: "https://art.example/ember.jpg",
        logoUrl: null,
        next: later,
        players: 1,
        capacity: null,
      },
      expect.objectContaining({ slug: "hollowmere", state: "FORMING", open: true, tagline: "Fog on the water." }),
    ]);
    // Nobody's name or face, the GM's included.
    expect(JSON.stringify(campaigns)).not.toMatch(/Rowan|Ada|lead|avatar/);
  });

  it("is the stranger's list whoever asks, an organiser included", async () => {
    roles["1003"] = [ORGANISER_ROLE];
    await env.DB.prepare(`UPDATE campaigns SET state = 'RUNNING' WHERE id = 'secret'`).run();
    expect(await feed(await as("1003"))).toEqual(await feed());
    expect((await feed()).campaigns.map((c) => c.slug)).toEqual(["hollowmere"]);
  });
});

describe("a pitch made plain for other sites", () => {
  it("keeps the words and drops the Markdown", () => {
    expect(plain("## The drylands\n\nA **colossus** walks. [Join us](https://kith.town/x)!\n\n- _bring_ a hat")).toBe(
      "The drylands A colossus walks. Join us! bring a hat",
    );
    expect(plain("Ask my_handle: is 5 * 3 __really__ ~~fifteen~~ `15`?")).toBe("Ask my_handle: is 5 * 3 really fifteen 15?");
    expect(plain(null)).toBeNull();
    expect(plain("  \n ")).toBeNull();
  });
});
