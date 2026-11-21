import { and, eq, sql } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";

/**
 * Taking a seat at a campaign that is still forming, from the site.
 *
 * The same shape as a game day's claim (`src/game-days/signups.ts`): the seat
 * or the queue is decided by SQLite inside the INSERT, so two people pressing
 * for the last seat cannot both get it. A campaign with no capacity seats
 * everyone. `accepted()` in `lifecycle.ts` takes only `in` when the campaign
 * starts, so the waitlist stays a queue.
 */
const TARGET = "campaign_forming";

export type FormingOutcome = "seated" | "waitlisted" | "unchanged" | "withdrawn" | "not-claimed" | "not-forming" | "no-such-campaign";

export async function joinForming(
  env: Env,
  campaignId: string,
  userId: string,
  prefer: "seat" | "waitlist" = "seat",
): Promise<FormingOutcome> {
  const campaign = await formingCampaign(env, campaignId);
  if (!campaign) return "no-such-campaign";
  if (campaign.state !== "FORMING") return "not-forming";

  const existing = await claimOf(env, campaignId, userId);
  if (existing && existing.state !== "out") return "unchanged";

  const state =
    prefer === "waitlist" && campaign.capacity !== null
      ? sql`'waitlisted'`
      : seatOrQueue(campaignId, campaign.capacity);

  await db(env)
    .insert(schema.signups)
    .values({ targetType: TARGET, targetId: campaignId, userId, state, position: nextPosition(campaignId) })
    .onConflictDoUpdate({
      target: [schema.signups.targetType, schema.signups.targetId, schema.signups.userId],
      // Only a withdrawal is moved; coming back joins the back of the queue.
      set: {
        state: sql`CASE WHEN ${schema.signups.state} = 'out' THEN excluded.state ELSE ${schema.signups.state} END`,
        position: sql`CASE WHEN ${schema.signups.state} = 'out' THEN excluded.position ELSE ${schema.signups.position} END`,
        updatedAt: sql`(unixepoch())`,
      },
    });

  const row = await claimOf(env, campaignId, userId);
  return row?.state === "in" ? "seated" : "waitlisted";
}

/**
 * Giving the seat back. The row stays, holding `out`, so a re-claim lands
 * behind everyone who has arrived since. The first in the queue moves up.
 */
export async function leaveForming(env: Env, campaignId: string, userId: string): Promise<FormingOutcome> {
  const campaign = await formingCampaign(env, campaignId);
  if (!campaign) return "no-such-campaign";
  if (campaign.state !== "FORMING") return "not-forming";

  const existing = await claimOf(env, campaignId, userId);
  if (!existing || existing.state === "out") return "not-claimed";

  const d = db(env);
  await d
    .update(schema.signups)
    .set({ state: "out", updatedAt: sql`(unixepoch())` })
    .where(claimant(campaignId, userId));

  if (existing.state === "in" && campaign.capacity !== null) {
    // One seat came free, so one person comes off the queue, in arrival order,
    // and only if a seat is still free once this runs.
    await d.run(sql`UPDATE ${schema.signups} SET state = 'in', updated_at = unixepoch()
      WHERE target_type = ${TARGET} AND target_id = ${campaignId} AND user_id = (
        SELECT user_id FROM ${schema.signups}
         WHERE target_type = ${TARGET} AND target_id = ${campaignId} AND state = 'waitlisted'
         ORDER BY position ASC, created_at ASC LIMIT 1)
      AND ${seatedCount(campaignId)} < ${campaign.capacity}`);
  }
  return "withdrawn";
}

function formingCampaign(env: Env, campaignId: string) {
  return db(env)
    .select({ state: schema.campaigns.state, capacity: schema.campaigns.capacity })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .get();
}

function claimant(campaignId: string, userId: string) {
  return and(
    eq(schema.signups.targetType, TARGET),
    eq(schema.signups.targetId, campaignId),
    eq(schema.signups.userId, userId),
  );
}

function claimOf(env: Env, campaignId: string, userId: string) {
  return db(env).select().from(schema.signups).where(claimant(campaignId, userId)).get();
}

function seatedCount(campaignId: string) {
  return sql`(SELECT COUNT(*) FROM ${schema.signups}
     WHERE ${schema.signups.targetType} = ${TARGET}
       AND ${schema.signups.targetId} = ${campaignId}
       AND ${schema.signups.state} = 'in')`;
}

function seatOrQueue(campaignId: string, capacity: number | null) {
  if (capacity === null) return sql`'in'`;
  return sql`(CASE WHEN ${seatedCount(campaignId)} < ${capacity} THEN 'in' ELSE 'waitlisted' END)`;
}

function nextPosition(campaignId: string) {
  return sql`(SELECT COALESCE(MAX(${schema.signups.position}), 0) + 1 FROM ${schema.signups}
     WHERE ${schema.signups.targetType} = ${TARGET}
       AND ${schema.signups.targetId} = ${campaignId})`;
}
