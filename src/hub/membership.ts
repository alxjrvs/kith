import { and, eq, inArray } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { isProvisional } from "./server-door.ts";

/**
 * Who counts as "the people on it" for `members` visibility: a campaign's
 * roster or live forming signups; a game day's live seats, its queue, and its
 * host. The listing reads the same rows; this is the same answer for links
 * and pages.
 */
export async function isMemberOf(
  env: Env,
  kind: "campaign" | "game-day",
  id: string,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const d = db(env);
  const claim = await d
    .select({ userId: schema.signups.userId })
    .from(schema.signups)
    .where(
      and(
        eq(schema.signups.targetType, kind === "campaign" ? "campaign_forming" : "game_day"),
        eq(schema.signups.targetId, id),
        eq(schema.signups.userId, userId),
        inArray(schema.signups.state, ["in", "waitlisted"]),
      ),
    )
    .get();
  // A signup held for somebody still waiting to be let into the server is a
  // place, not membership: members-only pages wait until they're in.
  if (claim && !(await isProvisional(env, userId))) return true;

  if (kind === "campaign") {
    const member = await d
      .select({ userId: schema.campaignMembers.userId })
      .from(schema.campaignMembers)
      .where(and(eq(schema.campaignMembers.campaignId, id), eq(schema.campaignMembers.userId, userId)))
      .get();
    return member !== undefined;
  }
  const day = await d
    .select({ host: schema.gameDays.hostUserId })
    .from(schema.gameDays)
    .where(eq(schema.gameDays.id, id))
    .get();
  return day?.host === userId;
}

/** The URL kind ("game-day") and the table kind ("game_day") for one target. */
export function targetType(kind: "campaign" | "game-day"): "campaign" | "game_day" {
  return kind === "campaign" ? "campaign" : "game_day";
}
