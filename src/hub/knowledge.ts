import { and, asc, eq, sql } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import type { Visibility } from "../db/schema.ts";
import { personFrom, type Person } from "./people.ts";
import { canSee, isVisibility, type Viewer } from "./visibility.ts";
import { targetType } from "./membership.ts";
import { linksForGame, pagesForGame, toMarkdown } from "../cms/content.ts";

/**
 * A table's links and knowledge pages: reads for the site, writes for
 * organisers. Each row is checked against its own visibility on the way out,
 * so a members-only rules link never reaches somebody reading a public table.
 */
type Kind = "campaign" | "game-day";

export interface TableLink {
  id: string;
  label: string;
  url: string;
  kind: string;
  visibility: Visibility;
}

export interface PageSummary {
  slug: string;
  title: string;
  visibility: Visibility;
  updatedAt: number;
}

export interface Page extends PageSummary {
  body: string;
  updatedBy: Person | null;
  /** Where it is written: kith-cms, or Kith's own editor (a game day, or a campaign page not moved over yet). */
  source: "cms" | "kith";
}

export class InvalidKnowledge extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKnowledge";
  }
}

/**
 * A campaign's links and pages are written in kith-cms (docs/CMS.md), under the
 * campaign's id as their `game`. Ones still in D1 from before are shown after
 * them, until they are moved over; a D1 page whose slug EmDash also has is
 * hidden by EmDash's. A game day's stay in D1.
 */
async function cmsLinks(env: Env, kind: Kind, id: string): Promise<TableLink[]> {
  if (kind !== "campaign") return [];
  return (await linksForGame(env, id)).map(({ id: linkId, label, url, kind: linkKind, visibility }) => ({
    id: `cms:${linkId}`,
    label,
    url,
    kind: linkKind,
    visibility,
  }));
}

export async function linksFor(env: Env, kind: Kind, id: string, viewer: Viewer, member: boolean): Promise<TableLink[]> {
  const fromCms = await cmsLinks(env, kind, id);
  const rows = await db(env)
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.targetType, targetType(kind)), eq(schema.links.targetId, id)))
    .orderBy(asc(schema.links.position), asc(schema.links.createdAt))
    .all();
  const fromD1 = rows.map(({ id: linkId, label, url, kind: linkKind, visibility }) => ({ id: linkId, label, url, kind: linkKind, visibility }));
  return [...fromCms, ...fromD1].filter((link) => canSee(link.visibility, viewer, member));
}

export async function pagesFor(env: Env, kind: Kind, id: string, viewer: Viewer, member: boolean): Promise<PageSummary[]> {
  const rows = await db(env)
    .select({
      slug: schema.pages.slug,
      title: schema.pages.title,
      visibility: schema.pages.visibility,
      updatedAt: schema.pages.updatedAt,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.targetType, targetType(kind)), eq(schema.pages.targetId, id)))
    .orderBy(asc(schema.pages.title))
    .all();
  const fromCms: PageSummary[] =
    kind === "campaign"
      ? (await pagesForGame(env, id)).map(({ slug, title, visibility, updatedAt }) => ({ slug, title, visibility, updatedAt }))
      : [];
  const taken = new Set(fromCms.map((p) => p.slug));
  return [...fromCms, ...rows.filter((row) => !taken.has(row.slug))].filter((row) => canSee(row.visibility, viewer, member));
}

export async function pageFor(
  env: Env,
  kind: Kind,
  id: string,
  slug: string,
  viewer: Viewer,
  member: boolean,
): Promise<Page | undefined> {
  if (kind === "campaign") {
    const cms = (await pagesForGame(env, id)).find((p) => p.slug === slug);
    if (cms) {
      if (!canSee(cms.visibility, viewer, member)) return undefined;
      return {
        slug: cms.slug,
        title: cms.title,
        visibility: cms.visibility,
        updatedAt: cms.updatedAt,
        body: toMarkdown(cms.content),
        updatedBy: null,
        source: "cms",
      };
    }
  }
  const row = await db(env)
    .select({ page: schema.pages, user: schema.users })
    .from(schema.pages)
    .leftJoin(schema.users, eq(schema.pages.updatedBy, schema.users.discordId))
    .where(and(eq(schema.pages.targetType, targetType(kind)), eq(schema.pages.targetId, id), eq(schema.pages.slug, slug)))
    .get();
  if (!row || !canSee(row.page.visibility, viewer, member)) return undefined;
  return {
    slug: row.page.slug,
    title: row.page.title,
    visibility: row.page.visibility,
    updatedAt: row.page.updatedAt,
    body: row.page.body,
    updatedBy: row.user ? personFrom(row.user) : null,
    source: "kith",
  };
}

const LINK_KINDS = ["vtt", "sheet", "rules", "doc", "discord", "other"] as const;

/** Whether the campaign or game day a link or page would hang off exists. */
export async function tableExists(env: Env, kind: Kind, id: string): Promise<boolean> {
  const table = kind === "campaign" ? schema.campaigns : schema.gameDays;
  const row = await db(env).select({ id: table.id }).from(table).where(eq(table.id, id)).get();
  return row !== undefined;
}

export async function addLink(env: Env, kind: Kind, id: string, input: Record<string, unknown>, actor: string): Promise<string> {
  const label = requiredText(input.label, "label", 80);
  const url = httpsUrl(input.url);
  const linkKind = input.kind === undefined ? "other" : input.kind;
  if (!LINK_KINDS.includes(linkKind as (typeof LINK_KINDS)[number])) {
    throw new InvalidKnowledge(`kind is one of ${LINK_KINDS.join(", ")}`);
  }
  const visibility = input.visibility === undefined ? "members" : input.visibility;
  if (!isVisibility(visibility)) throw new InvalidKnowledge("visibility is public, members or organisers");

  const linkId = crypto.randomUUID();
  const d = db(env);
  await d.batch([
    d.insert(schema.links).values({
      id: linkId,
      targetType: targetType(kind),
      targetId: id,
      label,
      url,
      kind: linkKind as (typeof LINK_KINDS)[number],
      visibility,
      position: sql`(SELECT COALESCE(MAX(position), 0) + 1 FROM links WHERE target_type = ${targetType(kind)} AND target_id = ${id})`,
    }),
    audit(d, actor, "link.add", "link", linkId, { targetType: targetType(kind), targetId: id, label, url, visibility }),
  ]);
  return linkId;
}

export async function removeLink(env: Env, linkId: string, actor: string): Promise<boolean> {
  if (linkId.startsWith("cms:")) throw new InvalidKnowledge("this link is written in kith-cms: remove it at cms.kith.town");
  const d = db(env);
  const before = await d.select().from(schema.links).where(eq(schema.links.id, linkId)).get();
  if (!before) return false;
  await d.batch([
    d.delete(schema.links).where(eq(schema.links.id, linkId)),
    audit(d, actor, "link.remove", "link", linkId, { before }),
  ]);
  return true;
}

export async function putPage(
  env: Env,
  kind: Kind,
  id: string,
  slug: string,
  input: Record<string, unknown>,
  actor: string,
): Promise<void> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    throw new InvalidKnowledge("the page's address is lowercase words joined by hyphens");
  }
  const title = requiredText(input.title, "title", 120);
  const body = typeof input.body === "string" ? input.body : "";
  if (body.length > 50_000) throw new InvalidKnowledge("a page is at most 50,000 characters");
  const visibility = input.visibility === undefined ? "members" : input.visibility;
  if (!isVisibility(visibility)) throw new InvalidKnowledge("visibility is public, members or organisers");

  const row = { title, body, visibility, updatedBy: actor };
  const d = db(env);
  await d.batch([
    d
      .insert(schema.pages)
      .values({ targetType: targetType(kind), targetId: id, slug, ...row })
      .onConflictDoUpdate({
        target: [schema.pages.targetType, schema.pages.targetId, schema.pages.slug],
        set: { ...row, updatedAt: sql`(unixepoch())` },
      }),
    audit(d, actor, "page.put", "page", `${targetType(kind)}:${id}:${slug}`, { title, visibility, length: body.length }),
  ]);
}

export async function removePage(env: Env, kind: Kind, id: string, slug: string, actor: string): Promise<boolean> {
  const d = db(env);
  const where = and(eq(schema.pages.targetType, targetType(kind)), eq(schema.pages.targetId, id), eq(schema.pages.slug, slug));
  const before = await d.select().from(schema.pages).where(where).get();
  if (!before) return false;
  await d.batch([
    d.delete(schema.pages).where(where),
    audit(d, actor, "page.remove", "page", `${targetType(kind)}:${id}:${slug}`, { title: before.title }),
  ]);
  return true;
}

function audit(
  d: ReturnType<typeof db>,
  actor: string,
  action: string,
  type: string,
  targetId: string,
  detail: Record<string, unknown>,
) {
  return d.insert(schema.auditLog).values({ id: crypto.randomUUID(), actorUserId: actor, action, targetType: type, targetId, detail });
}

function requiredText(value: unknown, key: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new InvalidKnowledge(`${key} is required`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new InvalidKnowledge(`${key} is at most ${max} characters`);
  return trimmed;
}

function httpsUrl(value: unknown): string {
  if (typeof value !== "string") throw new InvalidKnowledge("url is required");
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new InvalidKnowledge("url is not a URL");
  }
  if (parsed.protocol !== "https:") throw new InvalidKnowledge("url has to start with https://");
  if (parsed.href.length > 2000) throw new InvalidKnowledge("url is too long");
  return parsed.href;
}
