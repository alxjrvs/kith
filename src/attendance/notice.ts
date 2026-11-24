import type { Env } from "../env.ts";
import { asDiscordFailure } from "../discord/rest.ts";
import { claim, record, recordFailure, release } from "../projection/publications.ts";
import type { ProjectionTarget } from "../projection/target.ts";
import type { MessagePayload } from "./render.ts";
import { destinationFor, postToSession } from "./thread.ts";
import { requireGuildId } from "../db/settings.ts";
import { throughGovernor } from "../discord/governor.ts";
import { postMessage } from "../discord/rest.ts";

/**
 * A notice: a new message in the session's thread, sent once and never touched.
 *
 * This is the whole of "anything changing from outside posts a new notice rather
 * than mutating an old message". A confirmation, a jeopardy warning, a
 * reschedule — each is a fresh post in the thread, which is why the thread exists
 * and why none of this needs the attendance post to be editable.
 *
 * Once is the hard part, not the posting. Every notice is claimed under its own
 * label before the call and recorded after, exactly like the attendance post —
 * so a crash between Discord accepting it and D1 learning the id leaves a claim
 * that stops a second one rather than an unremembered message that invites it.
 */
export async function postNoticeOnce(
  env: Env,
  target: ProjectionTarget,
  label: string,
  payload: MessagePayload,
  /**
   * In the campaign's own channel rather than the session's thread: for news
   * the whole table needs to see, such as an evening being called off. Never
   * the server-wide scheduling channel; a campaign with no channel of its own
   * gets the thread, as before.
   */
  { inChannel = false }: { inChannel?: boolean } = {},
): Promise<string | undefined> {
  const ref = {
    surface: "discord",
    kind: "message",
    targetId: target.session.id,
    label,
  } as const;

  /**
   * Everything that can fail *locally* happens before the claim, for the reason
   * `postAttendancePost` gives: a claim is expensive to hold — nothing else may
   * post while it stands — so burning one on an unseeded guild id would suppress
   * this notice for good, with no Discord call ever made and nothing to show for
   * it. `recordFailure` keeps the claim on exactly that kind of throw.
   */
  const ownChannel = inChannel ? (target.campaign?.discordChannelId ?? undefined) : undefined;
  const destination = ownChannel ?? (await destinationFor(env, target));
  // No destination at all: nothing can be posted, and taking a claim to say so
  // would block the attempt that comes after somebody makes the thread.
  if (!destination) return undefined;
  const guildId = await requireGuildId(env);

  const { mine, publication } = await claim(env, ref);
  // Somebody already posted it, or tried to. Either way this is not the caller
  // that gets to post it: a notice arriving twice is worse than one arriving
  // late, and under send-only the second cannot be taken back.
  if (!mine) return publication.remoteId ?? undefined;

  let messageId: string | undefined;
  try {
    messageId = ownChannel
      ? (await throughGovernor(env, guildId, () => postMessage(env, ownChannel, payload))).id
      : await postToSession(env, target, payload);
  } catch (error) {
    // A 4xx is Discord refusing, so nothing went up and the claim is in the way
    // of a retry that should be allowed. Anything else — a 5xx, a network error
    // — may have posted, and holding the claim is the safe half of that doubt.
    const failure = asDiscordFailure(error);
    if (failure && failure.status >= 400 && failure.status < 500) await release(env, ref);
    else await recordFailure(env, ref, String(error));
    throw error;
  }

  // Belt and braces: the destination was resolved before the claim, so this is
  // only reachable if it vanished in between. Nothing was posted either way.
  if (!messageId) {
    await release(env, ref);
    return undefined;
  }

  await record(env, ref, messageId);
  return messageId;
}
