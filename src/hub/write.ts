import { eq, sql } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { isVisibility } from "./visibility.ts";

/**
 * The organiser's half of a listing and a catalog entry: words and links the
 * site shows, nothing the scheduler reads. Every write lands in audit_log,
 * like every other organiser write.
 */
export class InvalidListing extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidListing";
  }
}

export interface ListingInput {
  visibility?: unknown;
  tagline?: unknown;
  pitch?: unknown;
  heroUrl?: unknown;
  soundUrl?: unknown;
}

export interface CatalogInput {
  category?: unknown;
  summary?: unknown;
  coverUrl?: unknown;
}

export async function updateListing(
  env: Env,
  kind: "campaign" | "game-day",
  id: string,
  input: ListingInput,
  actor: string,
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  if (input.visibility !== undefined) {
    if (!isVisibility(input.visibility)) throw new InvalidListing("visibility is public, members or organisers");
    set.visibility = input.visibility;
  }
  text(set, "tagline", input.tagline, 140);
  text(set, "pitch", input.pitch, 2000);
  url(set, "heroUrl", input.heroUrl);
  url(set, "soundUrl", input.soundUrl);
  if (Object.keys(set).length === 0) throw new InvalidListing("nothing to change");

  const table = kind === "campaign" ? schema.campaigns : schema.gameDays;
  const d = db(env);
  const before = await d.select().from(table).where(eq(table.id, id)).get();
  if (!before) return false;

  await d.batch([
    d.update(table).set({ ...set, updatedAt: sql`(unixepoch())` }).where(eq(table.id, id)),
    d.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: actor,
      action: `${kind === "campaign" ? "campaign" : "game_day"}.listing`,
      targetType: kind === "campaign" ? "campaign" : "game_day",
      targetId: id,
      detail: { after: set },
    }),
  ]);
  return true;
}

export async function updateCatalogEntry(
  env: Env,
  gameId: string,
  input: CatalogInput,
  actor: string,
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  if (input.category !== undefined) {
    if (input.category !== "ttrpg" && input.category !== "board") {
      throw new InvalidListing("category is ttrpg or board");
    }
    set.category = input.category;
  }
  text(set, "summary", input.summary, 600);
  url(set, "coverUrl", input.coverUrl);
  if (Object.keys(set).length === 0) throw new InvalidListing("nothing to change");

  const d = db(env);
  const before = await d.select().from(schema.games).where(eq(schema.games.id, gameId)).get();
  if (!before) return false;

  await d.batch([
    d.update(schema.games).set({ ...set, updatedAt: sql`(unixepoch())` }).where(eq(schema.games.id, gameId)),
    d.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorUserId: actor,
      action: "game.catalog",
      targetType: "game",
      targetId: gameId,
      detail: { after: set },
    }),
  ]);
  return true;
}

/** A string, trimmed, or null to clear it. */
function text(set: Record<string, unknown>, key: string, value: unknown, max: number) {
  if (value === undefined) return;
  if (value === null || value === "") {
    set[key] = null;
    return;
  }
  if (typeof value !== "string") throw new InvalidListing(`${key} is text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new InvalidListing(`${key} is at most ${max} characters`);
  set[key] = trimmed || null;
}

/** An https URL, or null to clear it. A page that links to http is a mixed-content warning. */
function url(set: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined) return;
  if (value === null || value === "") {
    set[key] = null;
    return;
  }
  if (typeof value !== "string") throw new InvalidListing(`${key} is a URL`);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new InvalidListing(`${key} is not a URL`);
  }
  if (parsed.protocol !== "https:") throw new InvalidListing(`${key} has to start with https://`);
  if (parsed.href.length > 2000) throw new InvalidListing(`${key} is too long`);
  set[key] = parsed.href;
}
