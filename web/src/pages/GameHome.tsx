import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useHome, type BoardHome, type CampaignHome, type AgendaRow as Row, type Seat } from "../api.ts";
import { AgendaRow } from "../components/AgendaRow.tsx";
import { CatalogEditor } from "../components/CatalogEditor.tsx";
import { SeatSquares, seatLine } from "../components/Squares.tsx";
import { SignupButtons } from "../components/SignupButtons.tsx";
import { ToPage } from "../components/To.tsx";
import { cadence, inDays, initials, stamp } from "../format.ts";
import { LinkRow, NewLink, NewPage, VIS_LABEL } from "./Table.tsx";

/** A game's home base: `/games/<slug>`, a campaign or a board game. */
export function GameHome() {
  const { slug } = useParams({ from: "/shell/games/$slug" });
  const home = useHome(slug);

  if (home.isPending) return <main className="page" aria-busy="true" />;
  if (home.isError) {
    return (
      <main className="page">
        <h1>Nothing here</h1>
        <p className="muted">
          {home.error.message} <Link to="/games">See every game</Link>
        </p>
      </main>
    );
  }
  const data = home.data.home;
  return data.kind === "campaign" ? <CampaignBase home={data} /> : <BoardBase home={data} />;
}

function Hero({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      style={{ display: "block", width: "100%", aspectRatio: "21 / 6", objectFit: "cover", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}
    />
  );
}

function CampaignBase({ home }: { home: CampaignHome }) {
  const { listing, roster, upcoming, links, pages, canEdit, member } = home;
  const kind = "campaign";
  const id = listing.id;
  const days = new Map<string, Row[]>();
  for (const row of upcoming) days.set(row.day, [...(days.get(row.day) ?? []), row]);

  return (
    <main className="page">
      <Hero url={listing.heroUrl} />
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">
            Campaign · {listing.state.toLowerCase()}
            {listing.game ? ` · ${listing.game.name}` : ""}
          </span>
          <h1>{listing.name}</h1>
          {listing.tagline ? <p className="muted">{listing.tagline}</p> : null}
        </div>
        <div className="row">
          {listing.open || canEdit ? (
            <Link to="/join/$kind/$id" params={{ kind, id }} className="btn">
              Splash page
            </Link>
          ) : null}
          {listing.open ? <SignupButtons listing={listing} /> : null}
        </div>
      </div>

      <div className="split">
        <div className="main">
          <section className="panel">
            <h2 className="panel-head label">
              <span>Coming up · {upcoming.length}</span>
              <Link to="/agenda" style={{ fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
                Full agenda
              </Link>
            </h2>
            {upcoming.length === 0 ? (
              <p className="panel-body muted">
                {listing.state === "FORMING" ? "Sessions go on the calendar once the table is set." : "Nothing on the calendar yet."}
              </p>
            ) : (
              [...days.entries()].map(([day, list]) => (
                <div key={day}>
                  <div className="label" style={{ padding: "10px 16px 0" }}>
                    {list[0]!.dayLabel} · {inDays(list[0]!.startsAt)}
                  </div>
                  {list.map((row) => (
                    <AgendaRow key={row.sessionId} row={row} />
                  ))}
                </div>
              ))
            )}
          </section>

          <section className="panel">
            <h2 className="panel-head label">
              <span>{listing.state === "FORMING" ? "Signed up so far" : "The table"} · {roster.length}</span>
            </h2>
            <SeatList seats={roster} empty={listing.state === "FORMING" ? "Nobody has signed up yet." : "No roster yet."} />
          </section>

          {listing.pitch ? (
            <section className="stack">
              <h2 className="label" style={{ fontSize: 12 }}>
                The pitch
              </h2>
              <p className="prose" style={{ whiteSpace: "pre-line" }}>
                {listing.pitch}
              </p>
            </section>
          ) : null}

          <section className="panel">
            <h2 className="panel-head label">
              <span>Knowledge · {pages.length}</span>
            </h2>
            {pages.length === 0 ? (
              <p className="panel-body muted">
                {member || canEdit ? "No pages yet." : "Nothing public yet. The table sees more once they are on it."}
              </p>
            ) : (
              pages.map((page) => (
                <div key={page.slug} className="link-row">
                  <ToPage kind={kind} id={id} slug={page.slug}>
                    {page.title}
                  </ToPage>
                  <span className="pill">{VIS_LABEL[page.visibility]}</span>
                </div>
              ))
            )}
            {canEdit ? <NewPage kind={kind} id={id} /> : null}
          </section>
        </div>

        <aside>
          <section className="panel">
            <h2 className="panel-head label">Links · {links.length}</h2>
            {links.length === 0 ? <p className="panel-body muted">No links yet.</p> : null}
            {links.map((link) => (
              <LinkRow key={link.id} link={link} canEdit={canEdit} kind={kind} id={id} />
            ))}
            {canEdit ? <NewLink kind={kind} id={id} /> : null}
          </section>
          <section className="panel">
            <h2 className="panel-head label">At a glance</h2>
            <div className="panel-body">
              {cadence(listing).length > 0 ? (
                <span className="mono" style={{ fontSize: 12 }}>
                  {cadence(listing).join(" · ").toUpperCase()}
                </span>
              ) : null}
              {listing.where === "voice" ? <span className="muted">On voice</span> : null}
              {listing.lead ? <span className="muted">GM {listing.lead.name}</span> : null}
              <div className="row">
                <SeatSquares capacity={listing.capacity} taken={listing.taken} />
                <span className="mono" style={{ fontSize: 13 }}>
                  {seatLine(listing)}
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function BoardBase({ home }: { home: BoardHome }) {
  const { game, upcoming, played, canEdit } = home;
  const [editing, setEditing] = useState(false);
  const players =
    game.minPlayers && game.maxPlayers
      ? `${game.minPlayers} to ${game.maxPlayers} players`
      : game.maxPlayers
        ? `Up to ${game.maxPlayers} players`
        : null;
  const length = game.defaultDurationMinutes ? `About ${Math.round(game.defaultDurationMinutes / 60)} hours` : null;

  return (
    <main className="page">
      <Hero url={game.coverUrl} />
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Board game</span>
          <h1>{game.name}</h1>
          {game.summary ? <p className="muted">{game.summary}</p> : null}
        </div>
        {canEdit && !editing ? (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      {editing ? <CatalogEditor game={game} done={() => setEditing(false)} /> : null}

      <div className="split">
        <div className="main">
          <h2 className="label" style={{ fontSize: 12 }}>
            Upcoming game days · {upcoming.length}
          </h2>
          {upcoming.length === 0 ? <p className="empty">No day on the calendar yet.</p> : null}
          {upcoming.map(({ listing, seats }) => (
            <section key={listing.id} className="panel">
              <h3 className="panel-head label">
                <span>
                  {listing.when.startsAt ? `${stamp(listing.when.startsAt)} · ${inDays(listing.when.startsAt)}` : "Date to come"}
                </span>
                <span>{listing.state.toLowerCase()}</span>
              </h3>
              <div className="panel-body">
                <Link to="/table/$kind/$id" params={{ kind: "game-day", id: listing.id }} style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>
                  {listing.name}
                </Link>
                {listing.tagline ? <p className="muted">{listing.tagline}</p> : null}
                {listing.where || listing.lead ? (
                  <span className="muted" style={{ fontSize: 13 }}>
                    {[listing.where, listing.lead ? `Host ${listing.lead.name}` : null].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
                <div className="row">
                  <SeatSquares capacity={listing.capacity} taken={listing.taken} />
                  <span className="mono" style={{ fontSize: 13 }}>
                    {seatLine(listing)}
                  </span>
                </div>
                {listing.open ? <SignupButtons listing={listing} /> : null}
              </div>
              <SeatList seats={seats} empty="No seats taken yet." characters={false} />
            </section>
          ))}
        </div>
        <aside>
          <section className="panel">
            <h2 className="panel-head label">At a glance</h2>
            <div className="panel-body">
              {players ? <span className="muted">{players}</span> : null}
              {length ? <span className="muted">{length}</span> : null}
              <span className="mono" style={{ fontSize: 12 }}>
                {played === 0 ? "NOT PLAYED HERE YET" : `PLAYED ${played} ${played === 1 ? "TIME" : "TIMES"}`}
              </span>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

/** Who plays whom. Signed out, it is the characters without the people. */
function SeatList({ seats, empty, characters = true }: { seats: Seat[]; empty: string; characters?: boolean }) {
  if (seats.length === 0) return <p className="panel-body muted">{empty}</p>;
  return (
    <div>
      {seats.map((seat, i) => (
        <div key={seat.person?.id ?? `seat-${i}`} className="panel-row" style={{ minHeight: 52 }}>
          <span className="avatar" style={{ width: 32, height: 32 }} aria-hidden="true">
            {seat.person?.avatarUrl ? <img src={seat.person.avatarUrl} alt="" /> : seat.person ? initials(seat.person.name) : "?"}
          </span>
          <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column" }}>
            {characters ? (
              <>
                <span style={{ fontWeight: 600 }}>
                  {seat.role === "gm" && !seat.character ? (seat.person?.name ?? "Game master") : (seat.character ?? "Character to come")}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {seat.role === "gm" && !seat.character
                    ? "Runs the table"
                    : seat.person
                      ? `Played by ${seat.person.name}`
                      : "Shown to the table"}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontWeight: 600 }}>{seat.person?.name ?? "Seat taken"}</span>
                {seat.person ? null : (
                  <span className="muted" style={{ fontSize: 12 }}>
                    Shown to the table
                  </span>
                )}
              </>
            )}
          </div>
          {seat.role === "gm" ? <span className="pill accent">GM</span> : null}
          {seat.state === "waitlisted" ? <span className="pill maybe">Waitlist</span> : null}
        </div>
      ))}
    </div>
  );
}
