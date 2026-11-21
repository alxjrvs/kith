import { Link } from "@tanstack/react-router";
import { useAgenda, useListings, useMe } from "../api.ts";
import { ListingCard } from "../components/ListingCard.tsx";
import { TallySquares } from "../components/Squares.tsx";
import { statusOf } from "../components/AgendaRow.tsx";
import { inDays, stamp } from "../format.ts";

export function Home() {
  const signedIn = useMe().data?.signedIn === true;
  const listings = useListings().data?.listings ?? [];
  const agenda = useAgenda(signedIn ? "mine" : "public").data?.rows ?? [];
  const next = signedIn ? agenda[0] : undefined;

  return (
    <main className="page" style={{ gap: 36 }}>
      <section className="row" style={{ alignItems: "stretch", gap: 24 }}>
        <div className="stack" style={{ flex: "1 1 440px", justifyContent: "center", gap: 14 }}>
          <span className="label">The Orrey of Worlds</span>
          <h1 style={{ fontSize: 40, lineHeight: 1.08, letterSpacing: "-0.02em" }}>Every game we run, in one place.</h1>
          <p className="muted" style={{ fontSize: 15, maxWidth: "50ch" }}>
            Campaigns, game days, dates, links and what each table knows. Find a seat, or see when your games run.
          </p>
          <div className="row">
            <Link to="/find" className="btn primary">
              Find a game
            </Link>
            <Link to="/agenda" className="btn">
              See the agenda
            </Link>
          </div>
        </div>
        {next ? (
          <div className="panel" style={{ flex: "1 1 340px" }}>
            <div className="panel-head label">Next up · {inDays(next.startsAt)}</div>
            <div className="panel-body">
              <span className="mono" style={{ fontSize: 26 }}>
                {stamp(next.startsAt)}
              </span>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{next.title}</span>
              <div className="row" style={{ gap: 10 }}>
                <TallySquares tally={next.tally} />
                <span className="mono" style={{ fontSize: 13 }}>
                  {next.tally.in} / {next.rosterSize}
                </span>
                <span className={`pill ${statusOf(next).tone}`}>{statusOf(next).label}</span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="stack">
        <div className="section-head">
          <h2 className="label" style={{ fontSize: 12 }}>
            Open tables · {listings.length}
          </h2>
          <Link to="/find" style={{ fontSize: 13 }}>
            See every open table
          </Link>
        </div>
        {listings.length === 0 ? (
          <p className="empty">No open tables right now. Running campaigns are on the agenda.</p>
        ) : (
          <div className="grid">
            {listings.slice(0, 3).map((listing) => (
              <ListingCard key={`${listing.kind}:${listing.id}`} listing={listing} />
            ))}
          </div>
        )}
      </section>

      {agenda.length > 0 ? (
        <section className="stack">
          <div className="section-head">
            <h2 className="label" style={{ fontSize: 12 }}>
              Coming up
            </h2>
            <Link to="/agenda" style={{ fontSize: 13 }}>
              See the full agenda
            </Link>
          </div>
          <div className="panel">
            {agenda.slice(0, 5).map((row) => (
              <div key={row.sessionId} className={`panel-row${row.inJeopardy ? " jeopardy" : ""}`} style={{ minHeight: 48 }}>
                <span className="mono" style={{ width: 170, fontSize: 13 }}>
                  {stamp(row.startsAt)}
                </span>
                <span style={{ flex: "1 1 240px", fontWeight: 500 }}>{row.title}</span>
                <span className={`pill ${statusOf(row).tone}`}>{statusOf(row).label}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
