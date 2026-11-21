import { asc } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";

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
  return rows.map((g) => ({
    id: g.id,
    name: g.name,
    category: g.category,
    summary: g.summary,
    coverUrl: g.coverUrl,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    defaultDurationMinutes: g.defaultDurationMinutes,
  }));
}
