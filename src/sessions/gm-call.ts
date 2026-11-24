import { and, eq } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { SETTING_DEFAULTS, SETTING_KEYS, getSetting, requireGuildId, settingOr } from "../db/settings.ts";
import { throughGovernor } from "../discord/governor.ts";
import { isClosedDm, openDm, postMessage } from "../discord/rest.ts";
import { encodeCustomId } from "../discord/custom-id.ts";
import { escapeMarkdown } from "../discord/markdown.ts";
import { ButtonStyle, ComponentType } from "../discord/types.ts";
import { claim, find, forget, record, release } from "../projection/publications.ts";
import { loadProjectionTarget, sessionTitle, type ProjectionTarget } from "../projection/target.ts";
import { attendanceRows } from "../attendance/rows.ts";
import { quorumOf } from "../attendance/quorum.ts";
import { gmOf } from "../campaigns/roster.ts";
import { adminUser } from "../discord/admin-dm.ts";
import { rearm } from "../jobs/arm.ts";
import { RESCHEDULE_JOB, proposalsFor } from "../polls/reschedule.ts";
import { cancelSession } from "./lifecycle.ts";
import type { MessagePayload } from "../attendance/render.ts";

/**
 * Somebody on the roster can't make it. The GM decides what that means.
 *
 * Under the unanimous rule one `out` is enough to put the evening in doubt, but
 * it is not enough to decide anything. Jrvs, 2026-11-24: "We need the DM to make
 * a decision before anything happens." So the veto marks the session JEOPARDY
 * (on hold, internally) and arms this job, and the job DMs the GM one question
 * with two buttons:
 *
 * - **Call it off**: `cancelSession`, which takes the Discord event and the Kith
 *   calendar entry down and posts the "It's off" note in the campaign's own
 *   scheduling channel.
 * - **Find another date**: arms the reschedule job that used to run straight off
 *   the click, which opens the whole-roster date poll on the next few evenings.
 *
 * Nothing goes into the channel until the GM answers. A GM is the only person
 * the bot DMs about a game.
 *
 * The ask is claimed once per session **and date** (a session that moved and is
 * vetoed again on its new date is a new question), and the claim is dropped
 * when the objection is taken back, so a fresh `out` later asks again.
 */
export const GM_ASK_JOB = "session.gm-ask";

export function gmAskJob(sessionId: string, by: string) {
  return {
    id: `${GM_ASK_JOB}:${sessionId}`,
    kind: GM_ASK_JOB,
    payload: { sessionId, by },
    runAt: Math.floor(Date.now() / 1000),
  };
}

export function gmAskRef(sessionId: string, startsAt: number) {
  return {
    surface: "discord",
    kind: "message",
    targetId: sessionId,
    label: `gm-ask:${startsAt}`,
  } as const;
}

/** Whether the GM has already been asked about this session on this date. */
export async function gmAsked(env: Env, sessionId: string, startsAt: number): Promise<boolean> {
  return (await find(env, gmAskRef(sessionId, startsAt))) !== undefined;
}

/**
 * The objection was taken back before the GM answered. The pending ask is
 * called off, and an ask already sent is forgotten so a later `out` asks again.
 * The DM itself stays where it is (send-only); its buttons re-read D1 and say
 * there is nothing to decide.
 */
export function withdrawGmAsk(env: Env, sessionId: string, startsAt: number) {
  const d = db(env);
  return Promise.all([
    d
      .update(schema.jobs)
      .set({ state: "cancelled", claimedUntil: null, lastError: null })
      .where(
        and(
          eq(schema.jobs.id, `${GM_ASK_JOB}:${sessionId}`),
          eq(schema.jobs.state, "pending"),
        ),
      ),
    forget(env, gmAskRef(sessionId, startsAt)),
  ]);
}

const UNSETTLED = new Set(["SCHEDULED", "CONFIRMED", "JEOPARDY"]);

export type AskOutcome =
  | "asked-by-dm"
  | "asked-in-channel"
  | "already-asked"
  | "no-gm"
  | "no-veto"
  | "settled"
  | "no-session"
  | "nowhere";

/** The drain's half: send the GM the question, once. */
export async function askTheGm(env: Env, sessionId: string, by?: string): Promise<AskOutcome> {
  const target = await loadProjectionTarget(env, sessionId);
  if (!target?.campaign) return "no-session";
  if (!UNSETTLED.has(target.session.state)) return "settled";

  // Re-read, as `openRescheduleFor` does: a minute is long enough for the
  // objection to be taken back, and a DM about a fine evening is noise.
  const rows = await attendanceRows(env, sessionId);
  const verdict = quorumOf(target, rows);
  if (verdict.rule !== "unanimous" || verdict.vetoes.length === 0) return "no-veto";

  const ref = gmAskRef(sessionId, target.session.startsAt);
  const guildId = await requireGuildId(env);
  const { mine } = await claim(env, ref);
  if (!mine) return "already-asked";

  // The GM, or Kith's admin for a campaign with no GM on its roster.
  const gm = (await gmOf(env, target.campaign.id)) ?? (await adminUser(env));
  if (!gm) return pollWithoutAsking(env, ref, sessionId, by ?? verdict.vetoes[0], "no-gm");

  const out = new Set(verdict.vetoes);
  const names = rows.filter((row) => out.has(row.userId)).map((row) => row.name);
  const payload = gmAskPayload(target, names);

  let messageId: string;
  let outcome: AskOutcome = "asked-by-dm";
  try {
    messageId = await throughGovernor(env, guildId, async () => {
      const dm = await openDm(env, gm);
      return (await postMessage(env, dm.id, payload)).id;
    });
  } catch (error) {
    if (!isClosedDm(error)) return failed(env, ref, error);
    // Their DMs are closed to the bot. Ask in the organisers' own channel
    // instead, naming them; never in front of the table. The buttons answer to
    // the GM alone either way.
    const channelId =
      (await getSetting<string>(env, SETTING_KEYS.approvalsChannelId)) ??
      (await getSetting<string>(env, SETTING_KEYS.stagingChannelId));
    if (!channelId) return pollWithoutAsking(env, ref, sessionId, by ?? verdict.vetoes[0], "nowhere");
    try {
      messageId = (
        await throughGovernor(env, guildId, () =>
          postMessage(env, channelId, {
            ...payload,
            content: `<@${gm}> ${payload.content}`,
            allowed_mentions: { parse: [], roles: [], users: [gm] },
          }),
        )
      ).id;
      outcome = "asked-in-channel";
    } catch (second) {
      return failed(env, ref, second);
    }
  }

  // The objection may have been taken back while the DM was going out, and the
  // withdrawal forgot the ask. Recording it now would bring it back and make
  // the next `out` on this date ask nobody. The DM's buttons re-read D1, so
  // the GM is told there is nothing to decide.
  const now = quorumOf(target, await attendanceRows(env, sessionId));
  if (now.vetoes.length === 0) {
    await forget(env, ref);
    return "no-veto";
  }

  await record(env, ref, messageId);
  return outcome;
}

/**
 * Nobody can be asked: there is no GM, or their DMs are closed and there is no
 * organisers' channel. The evening still can't run, so do what Kith did before
 * there was a GM to ask, and look for another date. Never a cancellation.
 * Recorded like an ask, so the clicks after this one don't open a second poll.
 */
async function pollWithoutAsking(
  env: Env,
  ref: ReturnType<typeof gmAskRef>,
  sessionId: string,
  by: string | undefined,
  outcome: "no-gm" | "nowhere",
): Promise<AskOutcome> {
  await rearm(db(env), [
    {
      id: `${RESCHEDULE_JOB}:${sessionId}`,
      kind: RESCHEDULE_JOB,
      payload: { sessionId, by },
      runAt: Math.floor(Date.now() / 1000),
    },
  ]);
  await record(env, ref, outcome);
  return outcome;
}

/**
 * Any failure lets go of the claim so the job's retry can ask again. Unlike a
 * channel notice, a second DM to the GM after a lost response is a small price;
 * a held claim with no DM behind it would leave the evening on hold with nobody
 * told.
 */
async function failed(env: Env, ref: ReturnType<typeof gmAskRef>, error: unknown): Promise<never> {
  await release(env, ref);
  throw error;
}

export function gmAskPayload(target: ProjectionTarget, names: string[]): MessagePayload {
  const { session } = target;
  const who = names.length > 0 ? names.map(escapeMarkdown).join(", ") : "Somebody on the roster";
  return {
    content: [
      `**${escapeMarkdown(sessionTitle(target))}**, <t:${session.startsAt}:F>`,
      `${who} can't make it. Call it off, or find another date?`,
      "",
      "-# Nothing goes out to the table until you choose.",
    ].join("\n"),
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.DANGER,
            label: "Call it off",
            custom_id: gmCallId("cancel", session.id, session.startsAt),
          },
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.PRIMARY,
            label: "Find another date",
            custom_id: gmCallId("move", session.id, session.startsAt),
          },
        ],
      },
    ],
    allowed_mentions: { parse: [], roles: [] },
  };
}

export type GmChoice = "cancel" | "move";

/** `o1:gm:cancel-<startsAt>:<sessionId>`. The date is in it so a stale ask can tell it is stale. */
export function gmCallId(choice: GmChoice, sessionId: string, startsAt: number): string {
  return encodeCustomId({ action: "gm", arg: `${choice}-${startsAt}`, target: sessionId });
}

export function parseGmArg(arg: string | undefined): { choice: GmChoice; startsAt: number } | undefined {
  const match = /^(cancel|move)-(\d+)$/.exec(arg ?? "");
  if (!match) return undefined;
  return { choice: match[1] as GmChoice, startsAt: Number(match[2]) };
}

export type DecisionResult =
  | { outcome: "cancelled" | "moving" }
  | {
      outcome:
        | "not-gm"
        | "gone"
        | "moved"
        | "already-off"
        | "played"
        | "nothing-to-decide"
        | "poll-open"
        | "locked"
        | "no-dates";
    };

/**
 * The GM's answer. Re-reads everything, because the DM is a snapshot of when it
 * was sent and a lot can happen before somebody opens it.
 */
export async function decide(
  env: Env,
  { sessionId, choice, startsAt, actorId }: { sessionId: string; choice: GmChoice; startsAt: number; actorId: string },
): Promise<DecisionResult> {
  const target = await loadProjectionTarget(env, sessionId);
  if (!target?.campaign) return { outcome: "gone" };
  const answers = [await gmOf(env, target.campaign.id), await adminUser(env)];
  if (!answers.includes(actorId)) return { outcome: "not-gm" };

  const { session } = target;
  if (session.state === "CANCELLED") return { outcome: "already-off" };
  if (session.state === "PLAYED") return { outcome: "played" };
  if (session.startsAt !== startsAt) return { outcome: "moved" };

  const verdict = quorumOf(target, await attendanceRows(env, sessionId));
  const vetoed = verdict.rule === "unanimous" && verdict.vetoes.length > 0;

  if (choice === "cancel") {
    // A GM may call off an evening nobody objects to any more, too: it's theirs.
    // The notice goes out on the next drain: a click has three seconds, and
    // they are for rewriting the DM.
    const result = await cancelSession(env, sessionId, actorId, { noticeLater: true });
    return result === "cancelled" ? { outcome: "cancelled" } : { outcome: "already-off" };
  }

  if (!vetoed) return { outcome: "nothing-to-decide" };
  // The same refusals `openRescheduleFor` would give, asked now so the GM is
  // told the truth rather than promised a poll that never comes.
  if (session.state === "LOCKED") return { outcome: "locked" };
  const timezone = await settingOr(env, SETTING_KEYS.timezone, SETTING_DEFAULTS.timezone);
  if (proposalsFor(session, { timezone, now: new Date() }).length === 0) return { outcome: "no-dates" };

  const open = await db(env)
    .select({ id: schema.datePolls.id })
    .from(schema.datePolls)
    .where(and(eq(schema.datePolls.targetSessionId, sessionId), eq(schema.datePolls.status, "open")))
    .get();
  if (open) return { outcome: "poll-open" };

  await rearm(db(env), [
    {
      id: `${RESCHEDULE_JOB}:${sessionId}`,
      kind: RESCHEDULE_JOB,
      payload: { sessionId, by: verdict.vetoes[0] },
      runAt: Math.floor(Date.now() / 1000),
    },
  ]);
  await db(env).insert(schema.auditLog).values({
    id: crypto.randomUUID(),
    actorUserId: actorId,
    action: "session.reschedule-chosen",
    targetType: "session",
    targetId: sessionId,
    detail: { startsAt },
  });
  return { outcome: "moving" };
}

/**
 * What the DM is rewritten to once the GM has tapped a button. It stays the
 * GM's control for this date: unless the evening is off, played, moved or gone,
 * both buttons stay, so a poll that finds nothing can be followed by another,
 * or by calling it off.
 */
export function decisionPayload(target: ProjectionTarget | undefined, result: DecisionResult): MessagePayload {
  const final = ["cancelled", "already-off", "played", "moved", "gone", "not-gm"].includes(result.outcome);
  const buttons = !final && target ? gmAskPayload(target, []).components : [];
  return { content: decisionWords(target, result), components: buttons, allowed_mentions: { parse: [], roles: [] } };
}

/** What the DM is rewritten to once the GM has tapped a button. */
export function decisionWords(target: ProjectionTarget | undefined, result: DecisionResult): string {
  const title = target ? `**${escapeMarkdown(sessionTitle(target))}**` : "That session";
  switch (result.outcome) {
    case "cancelled":
      return `${title} is off. The Discord event is coming down, and the table will be told in their channel within the minute.`;
    case "moving":
      return `Finding another date for ${title}. A poll with the next few evenings is going up in the table's channel within the minute. \`/reschedule\` adds dates of your own.`;
    case "already-off":
      return `${title} was already called off.`;
    case "played":
      return `${title} has already been played.`;
    case "moved":
      return `${title} has moved since this was sent, so this question is out of date. Nothing changed.`;
    case "nothing-to-decide":
      return `Everybody's back in for ${title}, so there's nothing to decide. It's on.`;
    case "poll-open":
      return `A date poll for ${title} is already open in the table's channel.`;
    case "locked":
      return `${title} is locked, so there's no moving it now. You can still call it off.`;
    case "no-dates":
      return `There are no evenings left to offer for ${title}. Use \`/reschedule\` to suggest dates, or call it off.`;
    case "gone":
      return "That session is gone.";
    case "not-gm":
      return "Only the GM can answer this.";
  }
}
