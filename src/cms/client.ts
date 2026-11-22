import type { Env } from "../env.ts";

/**
 * Reading kith-cms (cms/, EmDash): the only door from this Worker into it.
 *
 * Every word a visitor reads is written there (docs/CMS.md). This Worker asks
 * EmDash's content API for published entries over the `CMS` service binding,
 * with a read-only API token, and never reads EmDash's tables directly. A
 * service binding never leaves Cloudflare, so the request skips Access; the
 * token is what EmDash checks instead.
 *
 * Without the binding or the token (before kith-cms is set up, in tests, in
 * `wrangler dev`), every collection reads as empty, and the site falls back to
 * what D1 has. The CMS being down is the same: the site keeps working, with
 * less to say.
 */

/** The hostname kith-cms's gateway (cms/src/gateway.ts) lets binding requests in on. */
export const CMS_ORIGIN = "https://cms.internal";

export interface CmsEntry {
  /** EmDash's own id: a ULID. */
  id: string;
  /** The entry's slug: for a game, its address in Kith. */
  slug: string;
  data: Record<string, unknown>;
  /** Unix seconds of the entry's last change. */
  updatedAt: number;
}

interface ListBody {
  success?: boolean;
  data?: {
    items?: Array<{
      id: string;
      slug: string | null;
      status: string;
      data: Record<string, unknown>;
      liveData?: Record<string, unknown>;
      updatedAt?: string;
      publishedAt?: string | null;
    }>;
    nextCursor?: string;
  };
}

/** How long an isolate keeps a collection before asking again. Publishing shows up within this. */
export const CMS_TTL_MS = 30_000;
const cache = new Map<string, { at: number; entries: Promise<CmsEntry[]> }>();

/** For tests: forget every cached collection. */
export function resetCmsCache(): void {
  cache.clear();
}

export function cmsConfigured(env: Env): boolean {
  return Boolean(env.CMS && env.CMS_TOKEN);
}

/**
 * Every published entry of a collection, in EmDash's order. Never throws: a
 * CMS that is missing, slow or broken reads as an empty collection, and says
 * so in the log.
 */
export function published(env: Env, collection: string, now = Date.now()): Promise<CmsEntry[]> {
  if (!cmsConfigured(env)) return Promise.resolve([]);
  const hit = cache.get(collection);
  if (hit && now - hit.at < CMS_TTL_MS) return hit.entries;
  const entries: Promise<CmsEntry[]> = fetchAll(env, collection).catch((error: unknown) => {
    console.error(`kith-cms: reading ${collection} failed`, error);
    // Don't keep a failure for the whole TTL: the next request tries again.
    if (cache.get(collection)?.entries === entries) cache.delete(collection);
    return [] as CmsEntry[];
  });
  cache.set(collection, { at: now, entries });
  return entries;
}

async function fetchAll(env: Env, collection: string): Promise<CmsEntry[]> {
  const out: CmsEntry[] = [];
  let cursor: string | undefined;
  // A hundred is EmDash's page size cap; ten pages is far more than Kith has.
  for (let page = 0; page < 10; page++) {
    const url = new URL(`/_emdash/api/content/${encodeURIComponent(collection)}`, CMS_ORIGIN);
    url.searchParams.set("status", "published");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await env.CMS!.fetch(url, {
      headers: { Authorization: `Bearer ${env.CMS_TOKEN}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GET ${url.pathname} -> ${response.status}`);
    const body = (await response.json()) as ListBody;
    for (const item of body.data?.items ?? []) {
      if (item.status !== "published" || !item.slug) continue;
      // With a draft open, `data` is the draft and `liveData` what is published.
      const stamp = Date.parse(item.publishedAt ?? item.updatedAt ?? "");
      out.push({
        id: item.id,
        slug: item.slug,
        data: item.liveData ?? item.data,
        updatedAt: Number.isFinite(stamp) ? Math.floor(stamp / 1000) : 0,
      });
    }
    cursor = body.data?.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/** A media storage key: one path segment, a name and an optional extension. */
export const MEDIA_KEY = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/;

/**
 * Uploaded media (a hero, a cover, a sound), fetched from kith-cms for the
 * `/media/:id` route. Media ids are fresh per upload, so a copy never changes.
 */
export async function media(env: Env, id: string): Promise<Response | null> {
  if (!cmsConfigured(env) || !MEDIA_KEY.test(id)) return null;
  try {
    const response = await env.CMS!.fetch(new URL(`/_emdash/api/media/file/${id}`, CMS_ORIGIN), {
      headers: { Authorization: `Bearer ${env.CMS_TOKEN}` },
    });
    return response.ok ? response : null;
  } catch (error) {
    console.error("kith-cms: media failed", error);
    return null;
  }
}
