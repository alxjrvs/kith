import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.ts";
import { published, resetCmsCache } from "../src/cms/client.ts";
import { charactersFor, cmsGames, linksForGame, mediaUrl, pagesForGame, plainText } from "../src/cms/content.ts";
import { syncGamesFromCms } from "../src/cms/sync.ts";
import { createApp } from "../src/http/app.ts";
import type { Env } from "../src/env.ts";

/**
 * Reading kith-cms. EmDash is faked at its content API: the binding is a
 * fetcher that answers like `/_emdash/api/content/{collection}` does.
 */
type Item = { id?: string; slug: string; status?: string; data: Record<string, unknown>; liveData?: Record<string, unknown> };

let collections: Record<string, Item[]> = {};
let requests: Request[] = [];

function cmsEnv(): Env {
  const CMS = {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      const media = url.pathname.match(/^\/_emdash\/api\/media\/file\/(.+)$/);
      if (media) return new Response(`file ${media[1]}`, { headers: { "Content-Type": "image/png" } });
      const m = url.pathname.match(/^\/_emdash\/api\/content\/([^/]+)$/);
      if (!m) return new Response("nope", { status: 404 });
      const items = (collections[m[1]!] ?? []).map((i, n) => ({ id: i.id ?? `id-${n}`, status: "published", ...i }));
      return Response.json({ success: true, data: { items } });
    },
  } as unknown as Fetcher;
  return { ...env, CMS, CMS_TOKEN: "ec_pat_test" } as Env;
}

beforeEach(async () => {
  collections = {};
  requests = [];
  resetCmsCache();
  await db(env as Env).delete(schema.auditLog);
  await db(env as Env).delete(schema.campaigns);
  await db(env as Env).delete(schema.games);
});

describe("reading kith-cms", () => {
  it("reads as empty, and asks nothing, until it is set up", async () => {
    expect(await published(env as Env, "games")).toEqual([]);
  });

  it("asks for published entries with the token, and keeps them briefly", async () => {
    collections.games = [{ slug: "hollowmere", data: { title: "Hollowmere" } }];
    const e = cmsEnv();
    expect((await cmsGames(e)).map((g) => g.slug)).toEqual(["hollowmere"]);
    await cmsGames(e);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0]!.url);
    expect(url.searchParams.get("status")).toBe("published");
    expect(requests[0]!.headers.get("Authorization")).toBe("Bearer ec_pat_test");
  });

  it("shows what is published while a draft is open, and skips anything unpublished", async () => {
    collections.games = [
      { slug: "a", data: { title: "Draft name" }, liveData: { title: "Live name" } },
      { slug: "b", status: "draft", data: { title: "Not yet" } },
    ];
    expect((await cmsGames(cmsEnv())).map((g) => g.name)).toEqual(["Live name"]);
  });

  it("plays a game's sound from a link, such as a SoundCloud track, when no file is uploaded", async () => {
    const track = "https://soundcloud.com/someone/a-track#t=0:09";
    collections.games = [
      { slug: "linked", data: { title: "Linked", sound_link: track } },
      { slug: "both", data: { title: "Both", sound_link: track, sound: { id: "x", src: "/_emdash/api/media/file/01ABC.mp3" } } },
      { slug: "insecure", data: { title: "Insecure", sound_link: "http://soundcloud.com/someone/a-track" } },
    ];
    expect((await cmsGames(cmsEnv())).map((g) => g.soundUrl)).toEqual([track, "/media/01ABC.mp3", undefined]);
  });

  it("reads a broken CMS as empty rather than failing the page", async () => {
    const broken = { ...env, CMS: { fetch: async () => new Response("down", { status: 503 }) }, CMS_TOKEN: "t" } as unknown as Env;
    expect(await cmsGames(broken)).toEqual([]);
  });

  it("drops a game whose slug can't be a Kith id", async () => {
    collections.games = [{ slug: "Bad Slug!", data: { title: "Bad" } }];
    expect(await cmsGames(cmsEnv())).toEqual([]);
  });

  it("matches characters to players by Discord username, in any case, with or without the @", async () => {
    collections.characters = [
      { slug: "c1", data: { name: "Vess", game: "hollowmere", player: "@Jrvs", sheet: "https://example.com/vess" } },
      { slug: "c2", data: { name: "Other", game: "elsewhere", player: "jrvs" } },
      { slug: "c3", data: { name: "Bad link", game: "hollowmere", player: "kay", sheet: "javascript:alert(1)" } },
    ];
    const chars = await charactersFor(cmsEnv(), "hollowmere");
    expect(chars.get("jrvs")).toEqual({ name: "Vess", game: "hollowmere", player: "jrvs", sheetUrl: "https://example.com/vess" });
    expect(chars.get("kay")?.sheetUrl).toBeUndefined();
    expect(chars.size).toBe(2);
  });

  it("orders a game's pages and links, and reads an unknown visibility as members", async () => {
    collections.pages = [
      { slug: "two", data: { title: "Two", game: "g", order: 2, visibility: "everyone" } },
      { slug: "one", data: { title: "One", game: "g", order: 1, visibility: "public" } },
    ];
    collections.links = [
      { slug: "l", data: { label: "VTT", url: "https://vtt.example", game: "g", kind: "vtt" } },
      { slug: "m", data: { label: "Bad", url: "ftp://x", game: "g" } },
    ];
    const e = cmsEnv();
    expect((await pagesForGame(e, "g")).map((p) => [p.slug, p.visibility])).toEqual([["one", "public"], ["two", "members"]]);
    expect((await linksForGame(e, "g")).map((l) => l.label)).toEqual(["VTT"]);
  });

  it("serves uploaded media from Kith's own origin", () => {
    expect(mediaUrl({ id: "x", src: "/_emdash/api/media/file/01ABC.png" })).toBe("/media/01ABC.png");
    expect(mediaUrl({ id: "x", meta: { storageKey: "01DEF.mp3" } })).toBe("/media/01DEF.mp3");
    // The shape EmDash really writes: two ULIDs and the extension.
    expect(mediaUrl({ id: "x", src: "/_emdash/api/media/file/01M81KC774.01M81KC7RE.png" })).toBe("/media/01M81KC774.01M81KC7RE.png");
    expect(mediaUrl({ id: "x", meta: { storageKey: "a..png" } })).toBeUndefined();
    expect(mediaUrl({ id: "x", src: "https://cdn.example/x.png" })).toBe("https://cdn.example/x.png");
    expect(mediaUrl("http://insecure.example/x.png")).toBeUndefined();
    expect(mediaUrl(undefined)).toBeUndefined();
  });

  it("turns Portable Text into plain text", () => {
    expect(plainText([{ children: [{ text: "Hello " }, { text: "there" }] }, { children: [{ text: "Bye" }] }])).toBe("Hello there\n\nBye");
  });

  it("proxies media at /media/:key", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("https://kith.town/media/01ABC.png"), cmsEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("file 01ABC.png");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    const bad = await app.fetch(new Request("https://kith.town/media/..%2f..%2fadmin"), cmsEnv());
    expect(bad.status).toBe(404);
  });
});

describe("games are born in kith-cms", () => {
  it("gives a new campaign and a new board game their D1 rows, once", async () => {
    collections.games = [
      { slug: "hollowmere", data: { title: "Hollowmere", category: "campaign", visibility: "public" } },
      { slug: "twilight-imperium", data: { title: "Twilight Imperium", category: "board_game" } },
    ];
    const e = cmsEnv();
    expect(await syncGamesFromCms(e)).toEqual({ created: ["hollowmere", "twilight-imperium"] });
    const campaign = await db(e).select().from(schema.campaigns).where(eq(schema.campaigns.id, "hollowmere")).get();
    expect(campaign).toMatchObject({ name: "Hollowmere", kind: "run", state: "FORMING", visibility: "public" });
    const game = await db(e).select().from(schema.games).where(eq(schema.games.id, "twilight-imperium")).get();
    expect(game).toMatchObject({ name: "Twilight Imperium", category: "board" });
    const audit = await db(e).select().from(schema.auditLog).all();
    expect(audit.map((a) => a.action).sort()).toEqual(["campaign.create", "game.create"]);

    resetCmsCache();
    expect(await syncGamesFromCms(e)).toEqual({ created: [] });
  });

  it("leaves a game Kith already has to Organise", async () => {
    const e = cmsEnv();
    await db(e).insert(schema.campaigns).values({ id: "hollowmere", name: "Old", kind: "play", quorum: 3, visibility: "members" });
    collections.games = [{ slug: "hollowmere", data: { title: "Hollowmere", category: "campaign", visibility: "public" } }];
    expect(await syncGamesFromCms(e)).toEqual({ created: [] });
    const campaign = await db(e).select().from(schema.campaigns).where(eq(schema.campaigns.id, "hollowmere")).get();
    expect(campaign).toMatchObject({ name: "Old", visibility: "members", kind: "play", quorum: 3 });
  });

  it("matches a character by Discord user id as well as username", async () => {
    collections.characters = [{ slug: "c", data: { name: "Vess", game: "g", player: "1234567890" } }];
    expect((await charactersFor(cmsEnv(), "g")).get("1234567890")?.name).toBe("Vess");
  });

  it("refuses a media key that isn't one path segment", () => {
    expect(mediaUrl({ id: "x", src: "/_emdash/api/media/file/uploads/abc.png" })).toBeUndefined();
  });

  it("does nothing without a CMS", async () => {
    expect(await syncGamesFromCms(env as Env)).toEqual({ created: [] });
  });
});
