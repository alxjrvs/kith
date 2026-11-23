import type { GameSummary } from "./api.ts";
/**
 * Times on the site are the reader's local clock, because the server's agenda
 * already groups by the guild's day; within a day, 19:30 is 19:30.
 */
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });

export function stamp(unix: number): string {
  const d = new Date(unix * 1000);
  return `${weekday.format(d)} ${dayMonth.format(d)} at ${clock.format(d)}`;
}

export function time(unix: number): string {
  return clock.format(new Date(unix * 1000));
}

export function asOf(unix: number): string {
  return `as of ${time(unix)}`;
}

export function inDays(unix: number, now = Date.now()): string {
  const days = Math.round((unix * 1000 - now) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function cadence(listing: { when: { startsAt: number | null; endsAt: number | null; intervalWeeks: number | null } }): string[] {
  const { startsAt, endsAt, intervalWeeks } = listing.when;
  const chips: string[] = [];
  if (intervalWeeks && startsAt) {
    const day = weekdayLong.format(new Date(startsAt * 1000));
    chips.push(intervalWeeks === 1 ? `Every ${day}` : intervalWeeks === 2 ? `Every other ${day}` : `Every ${intervalWeeks} weeks on ${day}`);
    chips.push(time(startsAt));
  } else if (startsAt) {
    chips.push(stamp(startsAt));
    if (endsAt) chips.push(`to ${time(endsAt)}`);
  }
  return chips;
}

/** Who runs it, worded as a game's own page words it. */
export function leadLine(game: Pick<GameSummary, "kind" | "lead">): string {
  if (!game.lead) return "";
  return game.kind === "campaign" ? `Campaign run by ${game.lead.name}` : `${game.kind === "board" ? "Board game" : "Game day"} hosted by ${game.lead.name}`;
}

/** What kind of game it is, as the first of its chips. */
export function kindWord(kind: GameSummary["kind"]): string {
  return kind === "campaign" ? "Campaign" : kind === "board" ? "Board game" : "Game day";
}

/** Who runs it, as its own chip: a campaign's GM, or a game day's host. */
export function leadChip(game: Pick<GameSummary, "kind" | "lead">): string | null {
  if (!game.lead) return null;
  return `${game.kind === "campaign" ? "GM" : "Host"}: ${game.lead.name}`;
}
