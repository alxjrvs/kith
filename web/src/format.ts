/**
 * Times on the site are the reader's local clock, because the server's agenda
 * already groups by the guild's day; within a day, 19:30 is 19:30.
 */
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

export function stamp(unix: number): string {
  const d = new Date(unix * 1000);
  return `${weekday.format(d)} ${dayMonth.format(d)} · ${clock.format(d)}`;
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
    chips.push(`${weekday.format(new Date(startsAt * 1000))} · ${intervalWeeks === 1 ? "weekly" : `every ${intervalWeeks} weeks`}`);
    chips.push(time(startsAt));
  } else if (startsAt) {
    chips.push(stamp(startsAt));
    if (endsAt) chips.push(`to ${time(endsAt)}`);
  }
  return chips;
}
