import { Link } from "@tanstack/react-router";
import type { Listing } from "../api.ts";
import { cadence } from "../format.ts";
import { SeatSquares, seatLine } from "./Squares.tsx";
import { SignupButtons } from "./SignupButtons.tsx";

export function kindLabel(listing: Listing): string {
  const kind = listing.kind === "campaign" ? "Campaign" : "Game day";
  return `${kind} · ${listing.state.toLowerCase()}`;
}

export function ListingCard({ listing }: { listing: Listing }) {
  const when = [...cadence(listing), listing.where === "voice" ? "VOICE" : listing.where]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();
  return (
    <article className="panel" style={{ display: "flex", flexDirection: "column" }}>
      <div className="panel-head label">
        <span>{kindLabel(listing)}</span>
        <span>{listing.game?.name ?? ""}</span>
      </div>
      <div className="panel-body" style={{ flexGrow: 1 }}>
        <h3 style={{ fontSize: 20, fontWeight: 600 }}>
          <Link to="/join/$kind/$id" params={{ kind: listing.kind, id: listing.id }} style={{ color: "var(--text)" }}>
            {listing.name}
          </Link>
        </h3>
        {listing.tagline || listing.pitch ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {listing.tagline ?? listing.pitch}
          </p>
        ) : null}
        {when ? <p className="mono" style={{ fontSize: 12 }}>{when}</p> : null}
        {listing.lead ? (
          <p className="muted" style={{ fontSize: 12 }}>
            {listing.kind === "campaign" ? "GM" : "Host"} {listing.lead.name}
          </p>
        ) : null}
        <div className="row" style={{ marginTop: "auto", gap: 10 }}>
          <SeatSquares capacity={listing.capacity} taken={listing.taken} />
          <span className="mono" style={{ fontSize: 13 }}>
            {seatLine(listing)}
          </span>
        </div>
        <SignupButtons listing={listing} />
      </div>
    </article>
  );
}
