import { and, eq, sql } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { isOrganiser } from "../console/roles.ts";

/** Long enough for "This One Also Has a Thing That Kills You in One Hit (This Shouldn't Happen)". */
export const SESSION_TITLE_MAX = 200;

export type NameOutcome = "named" | "not-found" | "not-yours" | "not-yet" | "not-text" | "too-long";

/**
 * Name an episode after it has been played: the table's GM, or an organiser.
 *
 * Only a campaign session that has started and was not called off takes a
 * name, because a name is a record of what happened that evening. An empty
 * title clears it. The title is words for the site and nothing else: no
 * projection reads it, so naming never touches Discord or Google.
 */
export async function nameSession(
  env: Env,
  sessionId: string,
  raw: unknown,
  actor: string,
  now = new Date(),
): Promise<NameOutcome> {
  if (raw !== null && typeof raw !== "string") return "not-text";
  const title = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() || null : null;
  if (title && title.length > SESSION_TITLE_MAX) return "too-long";

  const d = db(env);
  const session = await d
    .select({ id: schema.sessions.id, campaignId: schema.sessions.campaignId, startsAt: schema.sessions.startsAt, state: schema.sessions.state, title: schema.sessions.title })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.kind, "campaign_session")))
    .get();
  if (!session?.campaignId) return "not-found";
  if (!(await canNameSessionsOf(env, session.campaignId, actor))) return "not-yours";
  if (!wasPlayed(session.state) || session.startsAt > Math.floor(now.getTime() / 1000)) return "not-yet";

  await d.batch([
    d.update(schema.sessions).set({ title, updatedAt: sql`(unixepoch())` }).where(eq(schema.sessions.id, sessionId)),
    d.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: actor,
      action: "session.title",
      targetType: "session",
      targetId: sessionId,
      detail: { before: session.title, after: title },
    }),
  ]);
  return "named";
}

/**
 * The table's GM, from D1, or an organiser, read fresh with the bot token: a
 * write never trusts the site's minute-long organiser cache.
 */
export async function canNameSessionsOf(env: Env, campaignId: string, userId: string): Promise<boolean> {
  if (await isGmOf(env, campaignId, userId)) return true;
  // A Discord failure or an unseeded role is an error, not "not yours".
  return isOrganiser(env, userId);
}

export async function isGmOf(env: Env, campaignId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const row = await db(env)
    .select({ role: schema.campaignMembers.role })
    .from(schema.campaignMembers)
    .where(and(eq(schema.campaignMembers.campaignId, campaignId), eq(schema.campaignMembers.userId, userId)))
    .get();
  return row?.role === "gm";
}

/**
 * Whether a session that has started counts as an evening that happened. A
 * cancelled one did not, and neither did one still in JEOPARDY: somebody on
 * the roster was out and its date poll never moved it.
 */
export function wasPlayed(state: string): boolean {
  return state !== "CANCELLED" && state !== "JEOPARDY";
}
