import { and, eq, inArray } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { SETTING_DEFAULTS, SETTING_KEYS, settingOr } from "../db/settings.ts";
import { agendaBetween, windowAround, type AgendaRow } from "../console/agenda.ts";
import { canSee, type Viewer } from "./visibility.ts";

/**
 * The site's agenda: the console's `agendaBetween`, read as the viewer.
 *
 * The numbers are the console's and the bot's, from the one query; this file
 * only decides which rows a person sees and adds their own answer. `mine` is a
 * roster seat on the campaign or a seat at the game day. `public` adds what is
 * listed for anyone.
 */
export interface HubAgendaRow extends AgendaRow {
  mine: boolean;
  /** Their answer, or null for "has not said" (which is not "out"). */
  myIntent: "in" | "out" | "maybe" | null;
}

export async function agendaFor(
  env: Env,
  viewer: Viewer,
  scope: "mine" | "public",
  asOf: Date,
  days = 42,
): Promise<{ asOf: number; rows: HubAgendaRow[] }> {
  const window = windowAround(asOf, days);
  const timeZone = await settingOr<string>(env, SETTING_KEYS.timezone, SETTING_DEFAULTS[SETTING_KEYS.timezone]);
  const agenda = await agendaBetween(env, window.from, window.to, asOf, timeZone);
  if (agenda.rows.length === 0) return { asOf: agenda.asOf, rows: [] };

  const d = db(env);
  const campaignIds = unique(agenda.rows.map((r) => r.campaignId));
  const dayIds = unique(agenda.rows.map((r) => r.gameDayId));

  const visibility = new Map<string, string>();
  if (campaignIds.length > 0) {
    for (const row of await d
      .select({ id: schema.campaigns.id, visibility: schema.campaigns.visibility })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.id, campaignIds))
      .all()) {
      visibility.set(`c:${row.id}`, row.visibility);
    }
  }
  if (dayIds.length > 0) {
    for (const row of await d
      .select({ id: schema.gameDays.id, visibility: schema.gameDays.visibility })
      .from(schema.gameDays)
      .where(inArray(schema.gameDays.id, dayIds))
      .all()) {
      visibility.set(`d:${row.id}`, row.visibility);
    }
  }

  const myCampaigns = new Set<string>();
  const myDays = new Set<string>();
  const intents = new Map<string, HubAgendaRow["myIntent"]>();
  if (viewer.userId) {
    const userId = viewer.userId;
    for (const row of await d
      .select({ id: schema.campaignMembers.campaignId })
      .from(schema.campaignMembers)
      .where(eq(schema.campaignMembers.userId, userId))
      .all()) {
      myCampaigns.add(row.id);
    }
    for (const row of await d
      .select({ id: schema.signups.targetId })
      .from(schema.signups)
      .where(
        and(
          eq(schema.signups.targetType, "game_day"),
          eq(schema.signups.userId, userId),
          eq(schema.signups.state, "in"),
        ),
      )
      .all()) {
      myDays.add(row.id);
    }
    for (const row of await d
      .select({ sessionId: schema.attendance.sessionId, intent: schema.attendance.intent })
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.userId, userId),
          inArray(schema.attendance.sessionId, agenda.rows.map((r) => r.sessionId)),
        ),
      )
      .all()) {
      intents.set(row.sessionId, row.intent);
    }
  }

  const rows: HubAgendaRow[] = [];
  for (const row of agenda.rows) {
    const mine = row.campaignId ? myCampaigns.has(row.campaignId) : row.gameDayId ? myDays.has(row.gameDayId) : false;
    const key = row.campaignId ? `c:${row.campaignId}` : `d:${row.gameDayId}`;
    const vis = (visibility.get(key) ?? "members") as "public" | "members" | "organisers";
    const wanted = scope === "mine" ? mine : mine || canSee(vis, viewer, mine);
    if (!wanted) continue;
    rows.push({ ...row, mine, myIntent: intents.get(row.sessionId) ?? null });
  }
  return { asOf: agenda.asOf, rows };
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}
