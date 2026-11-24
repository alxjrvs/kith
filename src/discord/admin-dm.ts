import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { SETTING_KEYS, getSetting, requireGuildId } from "../db/settings.ts";
import { throughGovernor } from "./governor.ts";
import { isClosedDm, openDm, postMessage } from "./rest.ts";
import { claim, record, release } from "../projection/publications.ts";
import { gmOf } from "../campaigns/roster.ts";
import type { MessagePayload } from "../attendance/render.ts";

/**
 * DM is how Kith talks to whoever runs a game (Jrvs, 2026-11-24: "DM the main
 * way to communicate with me"). The bot DMs only the person who answers for a
 * game, never players: a campaign's GM, a game day's host, and for anything with
 * neither, the admin named in Settings.
 */
export async function runnerOf(
  env: Env,
  { campaignId, gameDayId }: { campaignId?: string | null; gameDayId?: string | null },
): Promise<string | undefined> {
  if (campaignId) return gmOf(env, campaignId);
  if (gameDayId) {
    const day = await db(env)
      .select({ host: schema.gameDays.hostUserId })
      .from(schema.gameDays)
      .where(eq(schema.gameDays.id, gameDayId))
      .get();
    return day?.host ?? undefined;
  }
  return undefined;
}

/** Whoever runs Kith, from Settings. */
export async function adminUser(env: Env): Promise<string | undefined> {
  return (await getSetting<string>(env, SETTING_KEYS.adminUserId)) ?? undefined;
}

export type DmOnce = { outcome: "sent"; messageId: string } | { outcome: "already" } | { outcome: "closed" };

/**
 * One DM, once: claimed in the publications ledger under `targetId`/`label`
 * before the call and recorded after it. Closed DMs (50007) let the claim go
 * and answer `closed`, so the caller can fall back. Anything else lets the
 * claim go and throws, so the job's retry asks again: a second DM after a lost
 * response is a small price next to a claim with nothing behind it.
 */
export async function dmOnce(
  env: Env,
  { to, targetId, label, payload }: { to: string; targetId: string; label: string; payload: MessagePayload },
): Promise<DmOnce> {
  const guildId = await requireGuildId(env);
  const ref = { surface: "discord", kind: "message", targetId, label } as const;
  const { mine } = await claim(env, ref);
  if (!mine) return { outcome: "already" };
  try {
    const messageId = await throughGovernor(env, guildId, async () => {
      const dm = await openDm(env, to);
      return (await postMessage(env, dm.id, payload)).id;
    });
    await record(env, ref, messageId);
    return { outcome: "sent", messageId };
  } catch (error) {
    await release(env, ref);
    if (isClosedDm(error)) return { outcome: "closed" };
    throw error;
  }
}
