/** The seat and attendance squares from the Discord posts, in the site's palette. */
export function SeatSquares({ capacity, taken, big = false }: { capacity: number | null; taken: number; big?: boolean }) {
  const total = capacity ?? taken;
  if (total === 0) return null;
  const cells = Array.from({ length: Math.min(total, 24) }, (_, i) => (i < taken ? "in" : ""));
  return (
    <span className={`squares${big ? " big" : ""}`} role="img" aria-label={`${taken} of ${capacity ?? "any"} seats taken`}>
      {cells.map((kind, i) => (
        <span key={i} className={kind} />
      ))}
    </span>
  );
}

export function TallySquares({ tally }: { tally: { in: number; out: number; maybe: number; noReply: number } }) {
  const cells = [
    ...Array<string>(tally.in).fill("in"),
    ...Array<string>(tally.maybe).fill("maybe"),
    ...Array<string>(tally.out).fill("out"),
    ...Array<string>(tally.noReply).fill(""),
  ].slice(0, 24);
  return (
    <span
      className="squares"
      role="img"
      aria-label={`${tally.in} in, ${tally.maybe} maybe, ${tally.out} out, ${tally.noReply} no reply`}
    >
      {cells.map((kind, i) => (
        <span key={i} className={kind} />
      ))}
    </span>
  );
}

export function seatLine(listing: { capacity: number | null; taken: number; waitlist: number }): string {
  const seats = listing.capacity === null ? `${listing.taken} in · room for more` : `${listing.taken} / ${listing.capacity} seats`;
  return listing.waitlist > 0 ? `${seats} · waitlist ${listing.waitlist}` : seats;
}
