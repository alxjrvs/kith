import { Hono, type Context } from "hono";
import type { Env } from "../env.ts";
import { media } from "../cms/client.ts";
import { ICON_SIZES, gameApp, iconUrl, manifestFor, scopeOf, type GameApp, type IconSize } from "../hub/game-app.ts";
import { viewerOf } from "./hub.ts";

/**
 * The Worker's part in each game being its own installable app
 * (src/hub/game-app.ts): the manifest, the page a game's URLs load with its
 * manifest already linked, and the square icons cut from the game's art.
 *
 * What each of these says depends on who is asking, as the home base does, so
 * none of it is cached anywhere but the asker's own browser.
 */
const PRIVATE = { "Cache-Control": "private, no-cache", Vary: "Cookie" };

export function gameAppRoutes() {
  const games = new Hono<{ Bindings: Env }>();

  games.get("/:slug/manifest.webmanifest", async (c) => {
    const app = await gameApp(c.env, c.req.param("slug"), await viewerOf(c.env, c.req.header("cookie")));
    if (!app) return c.json({ error: "Kith has no game here, or it is not yours to see." }, 404, PRIVATE);
    return c.body(JSON.stringify(manifestFor(app)), 200, { ...PRIVATE, "Content-Type": "application/manifest+json" });
  });

  /**
   * A page load anywhere in a game: the site, as for any other path, with the
   * game's manifest linked from the first byte. Linking it from the app once it
   * has booted works in Chrome, but iOS only reads what the page arrived with.
   * A game the viewer may not see gets the site untouched, and the site says
   * "Nothing here" exactly as it does for a game that is not there.
   */
  const page = async (c: Context<{ Bindings: Env }>) => {
    // Unconditional: a 304 would let the browser keep a copy without this game's manifest.
    const headers = new Headers(c.req.raw.headers);
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    const site = await c.env.ASSETS.fetch(new Request(new URL("/", c.req.raw.url), { headers }));
    if (!site.ok || !site.headers.get("content-type")?.includes("text/html")) return site;
    const app = await gameApp(c.env, c.req.param("slug") ?? "", await viewerOf(c.env, c.req.header("cookie")));
    const out = app ? withManifest(site, app) : new Response(site.body, site);
    for (const [k, v] of Object.entries(PRIVATE)) out.headers.set(k, v);
    return out;
  };
  games.get("/:slug", page);
  games.get("/:slug/*", page);

  return games;
}

/**
 * A square icon cut from an uploaded image, for a game's manifest. Media keys
 * are fresh per upload and the file at one never changes, so neither does its
 * icon: each is cut once and then answered from the edge cache.
 *
 * Without the Images binding (local dev, tests) or when the cut fails, the
 * answer is Kith's own icon, briefly cached, so a later deploy that can cut
 * them is picked up rather than the fallback being kept for a year.
 */
export async function squareIcon(env: Env, request: Request, key: string, rawSize: string): Promise<Response> {
  const size = ICON_SIZES.find((s) => String(s) === rawSize);
  if (!size) return new Response("Not found", { status: 404 });

  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const cacheKey = new Request(new URL(`/media/${key}/icon/${size}`, request.url));
  const hit = await cache?.match(cacheKey);
  if (hit) return hit;

  const file = await media(env, key);
  if (!file?.body) return new Response("Not found", { status: 404 });

  if (env.IMAGES) {
    try {
      const cut = await env.IMAGES.input(file.body)
        .transform({ width: size, height: size, fit: "cover", gravity: "auto" })
        .output({ format: "image/png" });
      const out = new Response(cut.response().body, {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
      });
      await cache?.put(cacheKey, out.clone());
      return out;
    } catch (error) {
      console.error("game icon: the cut failed", key, error);
    }
  } else {
    await file.body.cancel();
  }
  const fallback = await env.ASSETS.fetch(new Request(new URL(kithIcon(size), request.url)));
  const out = new Response(fallback.body, fallback);
  out.headers.set("Cache-Control", "public, max-age=3600");
  return out;
}

function kithIcon(size: IconSize): string {
  return iconUrl({ slug: "", name: "", description: null, iconKey: null }, size);
}

function withManifest(site: Response, app: GameApp): Response {
  const name = escapeHtml(app.name);
  const scope = scopeOf(app.slug);
  return new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(app.name) })
    .on('link[rel="apple-touch-icon"]', { element: (el) => void el.setAttribute("href", iconUrl(app, 180)) })
    .on("head", {
      element: (el) => {
        el.append(
          // Same origin, but a manifest is fetched without cookies unless told
          // otherwise, and which games exist depends on who is signed in.
          `<link rel="manifest" href="${scope}/manifest.webmanifest" crossorigin="use-credentials" />` +
            `<meta name="apple-mobile-web-app-capable" content="yes" />` +
            `<meta name="mobile-web-app-capable" content="yes" />` +
            `<meta name="apple-mobile-web-app-title" content="${name}" />`,
          { html: true },
        );
      },
    })
    .transform(new Response(site.body, site));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
