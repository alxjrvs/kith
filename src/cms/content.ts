import type { Env } from "../env.ts";
import { MEDIA_KEY, published, type CmsEntry } from "./client.ts";

/**
 * kith-cms's collections, as Kith reads them (the model is cms/seed/seed.json).
 * Each reader turns EmDash's loose `data` into a typed shape and drops what it
 * can't use, so an entry with a missing field is shown with less, never a 500.
 */

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
type Vis = "public" | "members" | "organisers";
/** Anything unrecognised reads as `members`: never wider than meant. */
const vis = (v: unknown): Vis => (v === "public" || v === "organisers" ? v : "members");

/** EmDash's media prefix; Kith serves the same files at `/media/<key>`. */
const MEDIA_PREFIX = "/_emdash/api/media/file/";

/** An image or file field, as a URL on Kith (`/media/<key>`), or an external URL as it is. */
export function mediaUrl(v: unknown): string | undefined {
  if (typeof v === "string") return /^https:\/\//.test(v) ? v : undefined;
  if (!v || typeof v !== "object") return undefined;
  const m = v as { src?: unknown; meta?: { storageKey?: unknown } };
  const src = str(m.src);
  if (src) {
    const path = src.startsWith("http") ? safePath(src) : src;
    if (path?.startsWith(MEDIA_PREFIX)) {
      const key = path.slice(MEDIA_PREFIX.length);
      return MEDIA_KEY.test(key) ? `/media/${key}` : undefined;
    }
    if (/^https:\/\//.test(src)) return src;
  }
  const key = str(m.meta?.storageKey);
  return key && MEDIA_KEY.test(key) ? `/media/${key}` : undefined;
}

function safePath(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/** Portable Text, as EmDash stores it. Kith renders it on the client. */
export type PortableText = unknown[];
const pt = (v: unknown): PortableText => (Array.isArray(v) ? v : []);

/** Plain text from Portable Text: for a summary or a search, never for a page. */
export function plainText(blocks: PortableText): string {
  const out: string[] = [];
  for (const block of blocks) {
    const children = (block as { children?: Array<{ text?: unknown }> })?.children;
    if (Array.isArray(children)) out.push(children.map((c) => (typeof c?.text === "string" ? c.text : "")).join(""));
  }
  return out.join("\n\n").trim();
}

// --- Games -------------------------------------------------------------------

export interface CmsGame {
  /** The entry's slug: the game's id in Kith and its address, /games/<slug>. */
  slug: string;
  name: string;
  category: "campaign" | "board_game";
  system?: string | undefined;
  tagline?: string | undefined;
  summary?: string | undefined;
  pitch: PortableText;
  heroUrl?: string | undefined;
  coverUrl?: string | undefined;
  soundUrl?: string | undefined;
  visibility: Vis;
}

/** A slug Kith can use as an id: what `slugify` makes (src/db/seed-sql.ts). */
export const GAME_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function toGame(e: CmsEntry): CmsGame | null {
  const name = str(e.data.title);
  if (!name || !GAME_SLUG.test(e.slug)) return null;
  return {
    slug: e.slug,
    name,
    category: e.data.category === "board_game" ? "board_game" : "campaign",
    system: str(e.data.system),
    tagline: str(e.data.tagline),
    summary: str(e.data.summary),
    pitch: pt(e.data.pitch),
    heroUrl: mediaUrl(e.data.hero),
    coverUrl: mediaUrl(e.data.cover),
    // An uploaded file wins; otherwise a link, such as a SoundCloud track or a YouTube video.
    soundUrl: mediaUrl(e.data.sound) ?? mediaUrl(str(e.data.sound_link)),
    visibility: vis(e.data.visibility),
  };
}

export async function cmsGames(env: Env): Promise<CmsGame[]> {
  return (await published(env, "games")).map(toGame).filter((g): g is CmsGame => g !== null);
}

export async function cmsGame(env: Env, slug: string): Promise<CmsGame | undefined> {
  return (await cmsGames(env)).find((g) => g.slug === slug);
}

// --- Characters --------------------------------------------------------------

export interface CmsCharacter {
  name: string;
  /** The game's slug. */
  game: string;
  /** The player's Discord username (lower-cased) or user id: how Kith matches a roster row. */
  player: string;
  sheetUrl?: string | undefined;
}

export function toCharacter(e: CmsEntry): CmsCharacter | null {
  const name = str(e.data.name);
  const game = str(e.data.game);
  const player = str(e.data.player)?.replace(/^@/, "").toLowerCase();
  if (!name || !game || !player) return null;
  const sheet = str(e.data.sheet);
  return { name, game, player, sheetUrl: sheet && /^https?:\/\//.test(sheet) ? sheet : undefined };
}

/**
 * A game's characters, by their player: a Discord username (lower-cased) or a
 * Discord user id. An id survives the player renaming themselves; a username
 * is what's easy to type.
 */
export async function charactersFor(env: Env, game: string): Promise<Map<string, CmsCharacter>> {
  const out = new Map<string, CmsCharacter>();
  for (const e of await published(env, "characters")) {
    const c = toCharacter(e);
    if (c && c.game === game) out.set(c.player, c);
  }
  return out;
}

// --- Knowledge pages ---------------------------------------------------------

export interface CmsPage {
  slug: string;
  game: string;
  title: string;
  order: number;
  content: PortableText;
  visibility: Vis;
  updatedAt: number;
}

export function toPage(e: CmsEntry): CmsPage | null {
  const title = str(e.data.title);
  const game = str(e.data.game);
  if (!title || !game) return null;
  return {
    slug: e.slug,
    game,
    title,
    order: int(e.data.order) ?? Number.MAX_SAFE_INTEGER,
    content: pt(e.data.content),
    visibility: vis(e.data.visibility),
    updatedAt: e.updatedAt,
  };
}

export async function pagesForGame(env: Env, game: string): Promise<CmsPage[]> {
  return (await published(env, "pages"))
    .map(toPage)
    .filter((p): p is CmsPage => p !== null && p.game === game)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

// --- Links -------------------------------------------------------------------

export const LINK_KINDS = ["vtt", "sheet", "rules", "doc", "discord", "other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface CmsLink {
  id: string;
  game: string;
  label: string;
  url: string;
  kind: LinkKind;
  order: number;
  visibility: Vis;
}

export function toLink(e: CmsEntry): CmsLink | null {
  const label = str(e.data.label);
  const url = str(e.data.url);
  const game = str(e.data.game);
  if (!label || !url || !game || !/^https?:\/\//.test(url)) return null;
  const kind = LINK_KINDS.includes(e.data.kind as LinkKind) ? (e.data.kind as LinkKind) : "other";
  return { id: e.id, game, label, url, kind, order: int(e.data.order) ?? Number.MAX_SAFE_INTEGER, visibility: vis(e.data.visibility) };
}

export async function linksForGame(env: Env, game: string): Promise<CmsLink[]> {
  return (await published(env, "links"))
    .map(toLink)
    .filter((l): l is CmsLink => l !== null && l.game === game)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

// --- Site copy ---------------------------------------------------------------

export interface CmsSection {
  slug: string;
  title?: string | undefined;
  kicker?: string | undefined;
  body: PortableText;
}

export async function cmsSections(env: Env): Promise<Record<string, CmsSection>> {
  const out: Record<string, CmsSection> = {};
  for (const e of await published(env, "sections")) {
    // Each field stands alone: the site falls back to its own wording field by field.
    out[e.slug] = { slug: e.slug, title: str(e.data.title), kicker: str(e.data.kicker), body: pt(e.data.body) };
  }
  return out;
}

// --- Portable Text as Markdown -------------------------------------------------

type Span = { _type?: string; text?: unknown; marks?: unknown };
type MarkDef = { _key?: string; _type?: string; href?: unknown };
type Block = { _type?: string; style?: unknown; listItem?: unknown; children?: Span[]; markDefs?: MarkDef[] };

/**
 * Portable Text as the Markdown the site already renders (web/src/markdown.tsx):
 * headings, paragraphs, lists, bold, italics, code and links. Anything else
 * (an image block, a custom block) is left out rather than shown wrong.
 */
export function toMarkdown(blocks: PortableText): string {
  const out: string[] = [];
  let listKind: string | null = null;
  for (const raw of blocks) {
    const block = raw as Block;
    if (block?._type !== "block" || !Array.isArray(block.children)) continue;
    const defs = new Map((block.markDefs ?? []).map((d) => [d._key, d]));
    const text = block.children
      .map((span) => {
        let t = typeof span.text === "string" ? span.text : "";
        if (!t) return "";
        const marks = Array.isArray(span.marks) ? (span.marks as string[]) : [];
        if (marks.includes("code")) t = `\`${t}\``;
        if (marks.includes("em")) t = `*${t}*`;
        if (marks.includes("strong")) t = `**${t}**`;
        for (const m of marks) {
          const def = defs.get(m);
          const href = def?._type === "link" && typeof def.href === "string" ? def.href : undefined;
          if (href && /^(https?:|mailto:|\/)/.test(href)) t = `[${t}](${href})`;
        }
        return t;
      })
      .join("");
    const item = block.listItem === "bullet" || block.listItem === "number" ? block.listItem : null;
    if (item) {
      if (listKind !== item && out.length) out.push("");
      out.push(`${item === "number" ? "1." : "-"} ${text}`);
      listKind = item;
      continue;
    }
    if (listKind) out.push("");
    listKind = null;
    const style = typeof block.style === "string" ? block.style : "normal";
    const heading = /^h([1-6])$/.exec(style);
    // The site's renderer (web/src/markdown.tsx) knows # to ###.
    if (heading) out.push(`${"#".repeat(Math.min(Number(heading[1]), 3))} ${text}`, "");
    else if (style === "blockquote") out.push(`> ${text}`, "");
    else out.push(text, "");
  }
  return out.join("\n").trim();
}
