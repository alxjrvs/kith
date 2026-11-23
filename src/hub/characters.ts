import { and, eq, sql } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";

/**
 * A player's own character on a campaign, written by them on the game's home base.
 *
 * Only somebody on the roster as a player has one: a GM runs the table, and
 * somebody who isn't on it has no seat to describe. Whether they are on the
 * roster is D1's answer, as everywhere else, so the character is kept on the
 * roster row itself (`campaign_members`). A character written in kith-cms
 * still shows for anyone who hasn't written their own; once they have, theirs
 * wins (`character_set_at`).
 */
export const CHARACTER_LIMITS = { name: 80, sheetUrl: 500, description: 500 } as const;

export interface CharacterInput {
  name: string;
  sheetUrl: string | null;
  description: string | null;
}

export class InvalidCharacter extends Error {}

/** The request body as a character, or the reason it isn't one. */
export function characterFrom(input: Record<string, unknown>): CharacterInput {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = text(input.name);
  if (!name) throw new InvalidCharacter("Your character needs a name.");
  if (name.length > CHARACTER_LIMITS.name) {
    throw new InvalidCharacter(`Keep the name under ${CHARACTER_LIMITS.name} characters.`);
  }
  const sheetUrl = text(input.sheetUrl);
  if (sheetUrl) {
    if (sheetUrl.length > CHARACTER_LIMITS.sheetUrl) throw new InvalidCharacter("That sheet link is too long.");
    let ok = false;
    try {
      const url = new URL(sheetUrl);
      ok = url.protocol === "https:" || url.protocol === "http:";
    } catch {
      ok = false;
    }
    if (!ok) throw new InvalidCharacter("The sheet link should start with https://");
  }
  const description = text(input.description);
  if (description.length > CHARACTER_LIMITS.description) {
    throw new InvalidCharacter(`Keep the description under ${CHARACTER_LIMITS.description} characters.`);
  }
  return { name, sheetUrl: sheetUrl || null, description: description || null };
}

/**
 * Save the viewer's character on a campaign. "not-a-player" when they aren't
 * on its roster as a player; the caller has already decided they may see it.
 */
export async function putOwnCharacter(
  env: Env,
  campaignId: string,
  userId: string,
  input: CharacterInput,
): Promise<"saved" | "not-a-player"> {
  const d = db(env);
  const where = and(eq(schema.campaignMembers.campaignId, campaignId), eq(schema.campaignMembers.userId, userId));
  const before = await d.select().from(schema.campaignMembers).where(where).get();
  if (!before || before.role !== "player") return "not-a-player";

  const after = {
    characterName: input.name,
    characterSheetUrl: input.sheetUrl,
    characterDescription: input.description,
  };
  await d.batch([
    d
      .update(schema.campaignMembers)
      .set({ ...after, characterSetAt: sql`(unixepoch())` })
      .where(where),
    d.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: userId,
      action: "member.character",
      targetType: "campaign",
      targetId: campaignId,
      detail: {
        userId,
        before: {
          characterName: before.characterName,
          characterSheetUrl: before.characterSheetUrl,
          characterDescription: before.characterDescription,
        },
        after,
      },
    }),
  ]);
  return "saved";
}
