import type { Env } from "../env.ts";
import { media } from "../cms/client.ts";

/**
 * An uploaded image cut to a size. Media keys are fresh per upload and the file
 * at one never changes, so neither does a cut of it: each is made once and then
 * answered from the edge cache.
 *
 * Without the Images binding or when the cut fails, the answer is the fallback
 * (one of Kith's own images), briefly cached, so a later deploy that can cut
 * them is picked up rather than the fallback being kept for a year.
 */
export async function cutMedia(
  env: Env,
  request: Request,
  key: string,
  cut: { cachePath: string; width: number; height: number; format: "image/png" | "image/jpeg"; overlay?: string; fallback: string },
): Promise<Response> {
  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const cacheKey = new Request(new URL(cut.cachePath, request.url));
  const hit = await cache?.match(cacheKey);
  if (hit) return hit;

  const file = await media(env, key);
  if (!file?.body) return new Response("Not found", { status: 404 });

  if (env.IMAGES) {
    try {
      let image = env.IMAGES.input(file.body).transform({ width: cut.width, height: cut.height, fit: "cover", gravity: "auto" });
      if (cut.overlay) {
        // One of Kith's own images, drawn over the whole cut at its size.
        const over = await env.ASSETS.fetch(new Request(new URL(cut.overlay, request.url)));
        if (!over.ok || !over.body) throw new Error(`no overlay at ${cut.overlay}`);
        image = image.draw(env.IMAGES.input(over.body).transform({ width: cut.width, height: cut.height }), { top: 0, left: 0 });
      }
      const out = await image.output({ format: cut.format, ...(cut.format === "image/jpeg" ? { quality: 85 } : {}) });
      const res = new Response(out.response().body, {
        headers: { "Content-Type": cut.format, "Cache-Control": "public, max-age=31536000, immutable" },
      });
      await cache?.put(cacheKey, res.clone());
      return res;
    } catch (error) {
      console.error("media cut failed", cut.cachePath, error);
    }
  } else {
    await file.body.cancel();
  }
  const fallback = await env.ASSETS.fetch(new Request(new URL(cut.fallback, request.url)));
  const out = new Response(fallback.body, fallback);
  out.headers.set("Cache-Control", "public, max-age=3600");
  return out;
}
