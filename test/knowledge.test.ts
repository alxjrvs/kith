import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { createApp } from "../src/http/app.ts";
import { SESSION_COOKIE, issueSession } from "../src/console/cookies.ts";

/**
 * Links and knowledge pages. The table's visibility gates the lot, then each
 * row its own: a members-only rules link must never reach a public reader.
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
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const member = url.match(/\/members\/(\d+)/);
    if (member) return Response.json({ roles: roles[member[1]!] ?? [] });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  for (const table of [
    "links",
    "pages",
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

describe("links and pages", () => {
  beforeEach(async () => {
    roles["1003"] = [ORGANISER_ROLE];
    const boss = await as("1003");
    await call("POST", "/api/tables/campaign/hollowmere/links", boss, { label: "Session zero form", url: "https://example.com/form", visibility: "public" });
    await call("POST", "/api/tables/campaign/hollowmere/links", boss, { label: "Foundry VTT", url: "https://vtt.example.com", kind: "vtt" });
    await call("PUT", "/api/tables/campaign/hollowmere/pages/setting", boss, { title: "The setting", body: "# Hollowmere\nA fen town.", visibility: "public" });
    await call("PUT", "/api/tables/campaign/hollowmere/pages/house-rules", boss, { title: "House rules", body: "No PvP." });
  });

  it("shows a public reader only the public rows", async () => {
    const table = (await (await call("GET", "/api/hub/tables/campaign/hollowmere")).json()) as {
      links: { label: string }[];
      pages: { slug: string }[];
      member: boolean;
    };
    expect(table.member).toBe(false);
    expect(table.links.map((l) => l.label)).toEqual(["Session zero form"]);
    expect(table.pages.map((p) => p.slug)).toEqual(["setting"]);
    expect((await call("GET", "/api/hub/tables/campaign/hollowmere/pages/house-rules")).status).toBe(404);
  });

  it("shows the people on the table the members rows", async () => {
    await call("POST", "/api/hub/campaigns/hollowmere/signup", await as("1001"), { action: "seat" });
    const table = (await (await call("GET", "/api/hub/tables/campaign/hollowmere", await as("1001"))).json()) as {
      links: { label: string; kind: string }[];
      pages: { slug: string }[];
      member: boolean;
    };
    expect(table.member).toBe(true);
    expect(table.links.map((l) => l.kind)).toEqual(["other", "vtt"]);
    expect(table.pages.map((p) => p.slug)).toEqual(["house-rules", "setting"]);
    const page = (await (await call("GET", "/api/hub/tables/campaign/hollowmere/pages/house-rules", await as("1001"))).json()) as {
      page: { body: string; updatedBy: { name: string } };
    };
    expect(page.page).toMatchObject({ body: "No PvP.", updatedBy: { name: "Rowan" } });
  });

  it("hides a hidden table's pages, even the public ones", async () => {
    roles["1003"] = [ORGANISER_ROLE];
    await call("PUT", "/api/tables/campaign/secret/pages/notes", await as("1003"), { title: "Notes", visibility: "public" });
    expect((await call("GET", "/api/hub/tables/campaign/secret")).status).toBe(404);
    expect((await call("GET", "/api/hub/tables/campaign/secret/pages/notes")).status).toBe(404);
  });

  it("is written by organisers only, with https links and tidy addresses", async () => {
    expect((await call("PUT", "/api/tables/campaign/hollowmere/pages/x", await as("1001"), { title: "X" })).status).toBe(403);
    roles["1003"] = [ORGANISER_ROLE];
    const boss = await as("1003");
    expect((await call("POST", "/api/tables/campaign/hollowmere/links", boss, { label: "x", url: "javascript:alert(1)" })).status).toBe(400);
    expect((await call("PUT", "/api/tables/campaign/hollowmere/pages/Bad Slug", boss, { title: "X" })).status).toBe(400);

    const { links } = (await (await call("GET", "/api/hub/tables/campaign/hollowmere", boss)).json()) as { links: { id: string }[] };
    expect((await call("DELETE", `/api/links/${links[0]!.id}`, boss)).status).toBe(200);
    expect((await call("DELETE", "/api/tables/campaign/hollowmere/pages/setting", boss)).status).toBe(200);
    const actions = (await db(env).select().from(schema.auditLog).all()).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["link.add", "link.remove", "page.put", "page.remove"]));
  });
});
