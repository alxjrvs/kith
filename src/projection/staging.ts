import { eq } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import type { Visibility } from "../db/schema.ts";
import { getSetting, SETTING_KEYS } from "../db/settings.ts";
import type { ProjectionTarget } from "./target.ts";

/**
 * Test games, and the one rule for where they may show up.
 *
 * A campaign or a board game marked `staging` is a test: it exists so an
 * organiser can watch Kith work without anybody else seeing it. So:
 *
 * - anything that would post in the **scheduling channel** posts in the
 *   Staging copy of it instead (`discord.staging_channel_id`). With that unset
 *   it has nowhere to post, and its jobs retry: a test never falls back to the
 *   real channel.
 * - a test game's **own** channel is used as it is. It is the organiser who
 *   points it at a channel under Staging, the same way a real game is pointed
 *   at its own.
 * - nothing goes on the **Google calendar**, which people subscribe to.
 * - a **Discord scheduled event** goes up only as a voice event in the test
 *   campaign's own voice channel. Discord shows an event only to people who
 *   can see its channel, so one in a Staging voice channel stays there; an
 *   external event is shown to the whole server, so a test never makes one.
 * - on the **site**, only organisers see it.
 *
 * A game day is a test when the game it plays is. Nothing else decides it a
 * second way. A test is chosen before anything is scheduled and then stays
 * what it is (`stagingIsSettled`), so nothing already posted is left behind in
 * the wrong place.
 */
export function isStaging(target: Pick<ProjectionTarget, "campaign" | "game">): boolean {
  return target.campaign?.staging === 1 || target.game?.staging === 1;
}

/** The same question, for a caller holding ids rather than a target. */
export async function isStagingParent(
  env: Env,
  parent: { campaignId?: string | null | undefined; gameId?: string | null | undefined },
): Promise<boolean> {
  const d = db(env);
  // A campaign decides for itself, as in `isStaging`: its sessions never ask
  // its game, so neither does anything else of the campaign's.
  if (parent.campaignId) {
    const row = await d
      .select({ staging: schema.campaigns.staging })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, parent.campaignId))
      .get();
    return row?.staging === 1;
  }
  if (parent.gameId) {
    const row = await d
      .select({ staging: schema.games.staging })
      .from(schema.games)
      .where(eq(schema.games.id, parent.gameId))
      .get();
    if (row?.staging === 1) return true;
  }
  return false;
}

/**
 * The scheduling channel, or its Staging copy for a test.
 *
 * Every read of the scheduling channel goes through here. Undefined for a test
 * with no Staging channel set, which every caller already treats as "nowhere
 * to post".
 */
export async function schedulingChannel(env: Env, staging: boolean): Promise<string | undefined> {
  return getSetting<string>(
    env,
    staging ? SETTING_KEYS.stagingChannelId : SETTING_KEYS.schedulingChannelId,
  );
}

/** Whether a test may be published to this surface at all. Real games always may. */
export function publishesTo(target: ProjectionTarget, surface: "discord" | "google"): boolean {
  if (!isStaging(target)) return true;
  if (surface === "google") return false;
  return target.campaign?.locationType === "voice" && Boolean(target.campaign.discordVoiceChannelId);
}

/**
 * Who may see it on the site: a test is organisers-only whatever its listing
 * says, so a test game born public in the CMS still stays out of sight.
 */
export function siteVisibility(visibility: Visibility, staging: number | null | undefined): Visibility {
  return staging === 1 ? "organisers" : visibility;
}

/**
 * Whether a campaign or game may still be turned into a test, or back.
 *
 * Only before it has anything scheduled. Once it has sessions, game days or a
 * poll, Kith has already posted in channels, threads and calendars chosen by
 * what it was, and flipping the flag would leave those behind: a test's
 * reminders landing in a real thread, a real game's events gone stale. A test
 * stays a test; make a new one instead.
 */
export async function stagingIsSettled(
  env: Env,
  parent: { campaignId: string } | { gameId: string },
): Promise<boolean> {
  const d = db(env);
  if ("campaignId" in parent) {
    const [session, poll] = await Promise.all([
      d.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.campaignId, parent.campaignId)).get(),
      d.select({ id: schema.datePolls.id }).from(schema.datePolls).where(eq(schema.datePolls.campaignId, parent.campaignId)).get(),
    ]);
    return session !== undefined || poll !== undefined;
  }
  const [day, poll] = await Promise.all([
    d.select({ id: schema.gameDays.id }).from(schema.gameDays).where(eq(schema.gameDays.gameId, parent.gameId)).get(),
    d.select({ id: schema.datePolls.id }).from(schema.datePolls).where(eq(schema.datePolls.gameId, parent.gameId)).get(),
  ]);
  return day !== undefined || poll !== undefined;
}
