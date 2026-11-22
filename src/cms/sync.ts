import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { cmsConfigured } from "./client.ts";
import { cmsGames, type CmsGame } from "./content.ts";

/**
 * A game is born in EmDash (docs/CMS.md). This is the step that gives a newly
 * published entry in kith-cms's Games its row in D1, so Kith can schedule it:
 *
 * - a campaign becomes a FORMING campaign, run by the organisers (`kind: run`),
 *   with no cadence, quorum or Discord wiring. Those are set in Organise.
 * - a board game becomes a board game in the catalog.
 *
 * The entry's slug is the row's id. This only ever inserts: the new row takes
 * the entry's name and visibility, and from then on those are Organise's, like
 * the rest of the row (D1 keeps them because Discord messages and `canSee`
 * read them there, and two writers would undo each other). Unpublishing an
 * entry takes its words off the site, not its schedule.
 *
 * It runs on the minute tick and is idempotent, so a missed run catches up.
 */
export async function syncGamesFromCms(env: Env): Promise<{ created: string[] }> {
  if (!cmsConfigured(env)) return { created: [] };
  const games = await cmsGames(env);
  if (games.length === 0) return { created: [] };

  // Kith has a handful of games: reading every id is cheaper than a long IN list.
  const d = db(env);
  const [campaigns, boardGames] = await Promise.all([
    d.select({ id: schema.campaigns.id }).from(schema.campaigns).all(),
    d.select({ id: schema.games.id }).from(schema.games).all(),
  ]);
  const known = new Set([...campaigns, ...boardGames].map((r) => r.id));
  const fresh = games.filter((g) => !known.has(g.slug));
  if (fresh.length === 0) return { created: [] };

  const writes = fresh.flatMap((g) => [insertFor(env, g), audit(env, g)]);
  await d.batch(writes as unknown as Parameters<typeof d.batch>[0]);
  return { created: fresh.map((g) => g.slug) };
}

function insertFor(env: Env, g: CmsGame) {
  const d = db(env);
  return g.category === "board_game"
    ? d.insert(schema.games).values({ id: g.slug, name: g.name, category: "board" }).onConflictDoNothing()
    : d
        .insert(schema.campaigns)
        .values({ id: g.slug, name: g.name, kind: "run", visibility: g.visibility })
        .onConflictDoNothing();
}

function audit(env: Env, g: CmsGame) {
  return db(env)
    .insert(schema.auditLog)
    .values({
      id: crypto.randomUUID(),
      // Null is the clock: nobody in Kith did this; it followed EmDash.
      actorUserId: null,
      action: g.category === "board_game" ? "game.create" : "campaign.create",
      targetType: g.category === "board_game" ? "game" : "campaign",
      targetId: g.slug,
      detail: { from: "kith-cms", name: g.name, visibility: g.visibility },
    });
}
