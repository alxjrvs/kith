import { asc } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { cmsGames } from "../cms/content.ts";

/** The game catalog is public: it says what the group plays, not who or when. */
export interface CatalogEntry {
  id: string;
  name: string;
  category: "ttrpg" | "board";
  summary: string | null;
  coverUrl: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  defaultDurationMinutes: number | null;
}

export async function catalog(env: Env): Promise<CatalogEntry[]> {
  const rows = await db(env).select().from(schema.games).orderBy(asc(schema.games.name)).all();
  // A game's summary and cover are written in kith-cms when it has an entry.
  const words = new Map((await cmsGames(env)).map((w) => [w.slug, w]));
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    category: g.category,
    summary: words.get(g.id)?.summary ?? g.summary,
    coverUrl: words.get(g.id)?.coverUrl ?? g.coverUrl,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    defaultDurationMinutes: g.defaultDurationMinutes,
  }));
}
