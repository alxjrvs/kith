import { and, eq, inArray, or } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { SETTING_DEFAULTS, SETTING_KEYS, settingOr } from "../db/settings.ts";
import { agendaBetween, windowAround, type AgendaRow } from "../console/agenda.ts";
import { canSee, type Viewer } from "./visibility.ts";
import { siteVisibility } from "../projection/staging.ts";

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
  /** Whether they can say In / Maybe / Out: on the roster, seated, or hosting. Not the waitlist. */
  canAnswer: boolean;
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

  const myCampaigns = new Set<string>();
  const myDays = new Set<string>();
  const answering = new Set<string>();
  const intents = new Map<string, HubAgendaRow["myIntent"]>();

  const visibility = new Map<string, string>();
  for (const ids of chunks(campaignIds)) {
    for (const row of await d
      .select({ id: schema.campaigns.id, visibility: schema.campaigns.visibility, staging: schema.campaigns.staging })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.id, ids))
      .all()) {
      visibility.set(`c:${row.id}`, siteVisibility(row.visibility, row.staging));
    }
  }
  for (const ids of chunks(dayIds)) {
    for (const row of await d
      .select({
        id: schema.gameDays.id,
        visibility: schema.gameDays.visibility,
        host: schema.gameDays.hostUserId,
        staging: schema.games.staging,
      })
      .from(schema.gameDays)
      .leftJoin(schema.games, eq(schema.gameDays.gameId, schema.games.id))
      .where(inArray(schema.gameDays.id, ids))
      .all()) {
      visibility.set(`d:${row.id}`, siteVisibility(row.visibility, row.staging));
      // A host is on their own day, seat or no seat, as `isMemberOf` says.
      if (viewer.userId && row.host === viewer.userId) {
        myDays.add(row.id);
        answering.add(row.id);
      }
    }
  }

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
      .select({ id: schema.signups.targetId, state: schema.signups.state })
      .from(schema.signups)
      .where(
        and(
          eq(schema.signups.targetType, "game_day"),
          eq(schema.signups.userId, userId),
          or(eq(schema.signups.state, "in"), eq(schema.signups.state, "waitlisted")),
        ),
      )
      .all()) {
      myDays.add(row.id);
      if (row.state === "in") answering.add(row.id);
    }
    for (const ids of chunks(agenda.rows.map((r) => r.sessionId))) {
      for (const row of await d
        .select({ sessionId: schema.attendance.sessionId, intent: schema.attendance.intent })
        .from(schema.attendance)
        .where(and(eq(schema.attendance.userId, userId), inArray(schema.attendance.sessionId, ids)))
        .all()) {
        intents.set(row.sessionId, row.intent);
      }
    }
  }

  const rows: HubAgendaRow[] = [];
  for (const row of agenda.rows) {
    const mine = row.campaignId ? myCampaigns.has(row.campaignId) : row.gameDayId ? myDays.has(row.gameDayId) : false;
    const key = row.campaignId ? `c:${row.campaignId}` : `d:${row.gameDayId}`;
    const vis = (visibility.get(key) ?? "members") as "public" | "members" | "organisers";
    const wanted = scope === "mine" ? mine : mine || canSee(vis, viewer, mine);
    if (!wanted) continue;
    const canAnswer = row.campaignId ? myCampaigns.has(row.campaignId) : row.gameDayId ? answering.has(row.gameDayId) : false;
    rows.push({ ...row, mine, canAnswer, myIntent: intents.get(row.sessionId) ?? null });
  }
  return { asOf: agenda.asOf, rows };
}

/** D1 refuses a statement with more than 100 bound parameters; 90 leaves room for the rest. */
function chunks<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}
