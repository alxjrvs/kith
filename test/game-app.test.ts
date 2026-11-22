import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { createApp } from "../src/http/app.ts";
import { SESSION_COOKIE, issueSession } from "../src/console/cookies.ts";
import { forgetOrganisers } from "../src/http/hub.ts";
import { resetCmsCache } from "../src/cms/client.ts";
import { mediaKeyOf } from "../src/hub/game-app.ts";

/**
 * Each game as its own installable app (src/hub/game-app.ts). What matters:
 * one manifest per game, scoped to that game alone; a game nobody may see has
 * none, test games above all; and a game's pages load with it already linked.
 */
const app = createApp();
const realFetch = globalThis.fetch;
const ORGANISER_ROLE = "role-organiser";
let roles: Record<string, string[]> = {};

/** kith-cms with the one game entry these tests need (src/cms/client.ts). */
let mediaAsked: string[] = [];
const fakeCms = {
  fetch: async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname.startsWith("/_emdash/api/media/file/")) {
      mediaAsked.push(url.pathname);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    }
    const collection = url.pathname.split("/").pop()!;
    const items =
      collection === "games"
        ? [{ id: "e0", status: "published", slug: "umbra", data: { title: "The Age of Umbra", tagline: "Shadows fall.", cover: { id: "m", src: "/_emdash/api/media/file/01AB.01CD.png" } } }]
        : [];
    return Response.json({ success: true, data: { items } });
  },
} as unknown as Fetcher;

/** Without Cloudflare Images unless a test hands it one, as in local dev. */
function appEnv(extra: Record<string, unknown> = {}) {
  const { IMAGES: _images, ...rest } = env as typeof env & { IMAGES?: unknown };
  return {
    ...rest,
    CMS: fakeCms,
    CMS_TOKEN: "ec_pat_test",
    CONSOLE_SESSION_SECRET: "a-secret",
    DISCORD_APPLICATION_ID: "app-1",
    DISCORD_CLIENT_SECRET: "shh",
    DISCORD_BOT_TOKEN: "bot-token",
    ...extra,
  } as unknown as typeof env;
}

async function as(userId: string) {
  return `${SESSION_COOKIE}=${await issueSession(appEnv(), userId, new Date())}`;
}

function get(path: string, cookie?: string, extra?: Record<string, unknown>) {
  const headers: Record<string, string> = { accept: "text/html" };
  if (cookie) headers.cookie = cookie;
  return app.fetch(new Request(`https://kith.test${path}`, { headers }), appEnv(extra));
}

beforeEach(async () => {
  roles = {};
  mediaAsked = [];
  forgetOrganisers();
  resetCmsCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const member = url.match(/\/members\/(\d+)/);
    if (member) return Response.json({ roles: roles[member[1]!] ?? [] });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  for (const table of ["campaign_members", "campaigns", "games", "discord_tokens", "users", "settings"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await setSetting(env, SETTING_KEYS.guildId, "g1");
  await setSetting(env, SETTING_KEYS.organiserRoleId, ORGANISER_ROLE);
  for (const [id, name] of [["1001", "Ada"], ["1003", "Rowan"]] as const) {
    await db(env).insert(schema.users).values({ discordId: id, username: name, globalName: name, feedToken: `t-${id}` });
    await db(env).insert(schema.discordTokens).values({ userId: id, accessToken: "at", refreshToken: "rt", expiresAt: Math.floor(Date.now() / 1000) + 86_400 });
  }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO games (id, name, category, staging) VALUES ('arcs', 'Arcs', 'board', 0)"),
    env.DB.prepare("INSERT INTO games (id, name, category, staging) VALUES ('test-ti', 'Test TI', 'board', 1)"),
    env.DB.prepare("INSERT INTO campaigns (id, name, kind, state, visibility, staging) VALUES ('umbra', 'The Age of Umbra', 'run', 'RUNNING', 'public', 0)"),
    env.DB.prepare("INSERT INTO campaigns (id, name, kind, state, visibility, staging) VALUES ('test-rpg', 'Test RPG', 'run', 'RUNNING', 'public', 1)"),
    env.DB.prepare("INSERT INTO campaigns (id, name, kind, state, visibility, staging) VALUES ('secret', 'Secret table', 'run', 'RUNNING', 'members', 0)"),
  ]);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetCmsCache();
});

describe("a game's manifest", () => {
  it("makes the game its own app, scoped to its own path, with an icon cut from its art", async () => {
    const res = await get("/games/umbra/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(await res.json()).toEqual({
      id: "/games/umbra",
      name: "The Age of Umbra",
      short_name: "The Age of Umbra",
      description: "Shadows fall.",
      start_url: "/games/umbra",
      scope: "/games/umbra",
      display: "standalone",
      background_color: "#211d1b",
      theme_color: "#211d1b",
      icons: [
        { src: "/media/01AB.01CD.png/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/media/01AB.01CD.png/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      ],
    });
  });

  it("gives a board game one too, wearing Kith's icon when it has no art", async () => {
    const manifest = (await (await get("/games/arcs/manifest.webmanifest")).json()) as { scope: string; icons: { src: string }[] };
    expect(manifest.scope).toBe("/games/arcs");
    expect(manifest.icons.map((i) => i.src)).toEqual(["/icon-192.png", "/icon-512.png"]);
  });

  it("has none for a test game, or a hidden one, except for whoever may see it", async () => {
    const missing = await (await get("/games/nope/manifest.webmanifest")).json();
    for (const slug of ["test-rpg", "test-ti", "secret"]) {
      const res = await get(`/games/${slug}/manifest.webmanifest`, await as("1001"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(missing);
    }
    roles["1003"] = [ORGANISER_ROLE];
    for (const slug of ["test-rpg", "test-ti"]) {
      expect((await get(`/games/${slug}/manifest.webmanifest`, await as("1003"))).status).toBe(200);
    }
  });
});

describe("a game's pages", () => {
  it("load with the game's manifest already linked, and its name on the home screen", async () => {
    for (const path of ["/games/umbra", "/games/umbra/house-rules"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<link rel="manifest" href="/games/umbra/manifest.webmanifest" crossorigin="use-credentials" />');
      expect(html).toContain('<meta name="apple-mobile-web-app-title" content="The Age of Umbra" />');
      expect(html).toContain('<link rel="apple-touch-icon" href="/media/01AB.01CD.png/icon/180"');
      expect(html).toContain("<title>The Age of Umbra</title>");
    }
  });

  it("say nothing of a test game to anyone who may not see it", async () => {
    const html = await (await get("/games/test-rpg", await as("1001"))).text();
    expect(html).toContain('<div id="root">');
    expect(html).not.toContain("manifest");
    expect(html).not.toContain("Test RPG");
  });
});

describe("a game's icon", () => {
  it("is cut square from the art by Cloudflare Images", async () => {
    const asked: unknown[] = [];
    const IMAGES = {
      input: () => ({
        transform: (t: unknown) => {
          asked.push(t);
          return { output: async () => ({ response: () => new Response("png") }) };
        },
      }),
    };
    const res = await get("/media/01AB.01CD.png/icon/512", undefined, { IMAGES });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(asked).toEqual([{ width: 512, height: 512, fit: "cover", gravity: "auto" }]);
  });

  it("falls back to Kith's icon without Images, and refuses sizes it doesn't make", async () => {
    const res = await get("/media/01AB.01CE.png/icon/192");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await get("/media/01AB.01CD.png/icon/9999")).status).toBe(404);
  });

  it("reads only Kith's own media keys", () => {
    expect(mediaKeyOf("/media/01AB.01CD.png")).toBe("01AB.01CD.png");
    expect(mediaKeyOf("https://elsewhere.example/a.png")).toBeNull();
    expect(mediaKeyOf(null)).toBeNull();
  });
});
