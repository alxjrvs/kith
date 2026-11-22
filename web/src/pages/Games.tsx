import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCopy, useGames, useHomes, useMe, type CatalogEntry, type GameSummary } from "../api.ts";
import { Markdown } from "../markdown.tsx";
import { CatalogEditor } from "../components/CatalogEditor.tsx";
import { inDays, stamp } from "../format.ts";
import { signInHref } from "../signin.ts";
import { SeatSquares } from "../components/Squares.tsx";

const STATE_LABEL: Record<string, string> = {
  FORMING: "Forming",
  RUNNING: "Running",
  HIATUS: "On hiatus",
  CONCLUDED: "Concluded",
  SEATING: "Taking seats",
  PROPOSED: "Date set",
  LOCKED: "Table set",
  IDLE: "Between days",
};

/** The hub: every game we run, each one a door to its home base. */
export function Games() {
  const me = useMe().data;
  const homes = useHomes();
  const copy = useCopy().data?.games;
  const all = homes.data?.games ?? [];
  const live = all.filter((g) => g.state !== "CONCLUDED");
  const groups: [string, GameSummary[]][] = [
    ["Campaigns", live.filter((g) => g.kind === "campaign")],
    ["Board games", live.filter((g) => g.kind === "board")],
    ["Other game days", live.filter((g) => g.kind === "day")],
    ["Concluded", all.filter((g) => g.state === "CONCLUDED")],
  ];

  return (
    <main className="page">
      <div className="stack" style={{ gap: 8 }}>
        <h1 style={{ fontSize: 32 }}>{copy?.title ?? "Games"}</h1>
        {copy?.body ? (
          <div className="muted">
            <Markdown source={copy.body} />
          </div>
        ) : (
          <p className="muted">Every table we run. Each one has a home base with who plays whom and when it meets next.</p>
        )}
      </div>
      {homes.isError ? <p className="notice error">{homes.error.message}</p> : null}
      {homes.isSuccess && all.length === 0 ? (
        <p className="empty">
          No games you can see yet.{" "}
          {me && !me.signedIn ? (
            <>
              Most tables show to the people on them, so <a href={signInHref()}>sign in with Discord</a>.
            </>
          ) : null}
        </p>
      ) : null}
      {groups.map(([title, list]) =>
        list.length === 0 ? null : (
          <section key={title} className="stack" style={{ gap: 16 }}>
            <h2 className="label">
              {title}
            </h2>
            <div className="grid">
              {list.map((game) => (
                <GameCard key={`${game.kind}:${game.slug}`} game={game} />
              ))}
            </div>
          </section>
        ),
      )}
      {me?.signedIn && me.organiser ? <Catalog /> : null}
    </main>
  );
}

/**
 * Organisers only: every system and board game Kith knows, home base or not,
 * so a summary or cover can be set before the first day is on the calendar.
 */
function Catalog() {
  const games = useGames().data?.games ?? [];
  if (games.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 16 }}>
      <h2 className="label">
        Catalog, for organisers
      </h2>
      <div className="panel">
        {games.map((game) => (
          <CatalogRow key={game.id} game={game} />
        ))}
      </div>
    </section>
  );
}

function CatalogRow({ game }: { game: CatalogEntry }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="panel-row" style={{ flexWrap: "wrap" }}>
      <span className="label" style={{ width: 90 }}>
        {game.category === "board" ? "Board game" : "TTRPG"}
      </span>
      <span style={{ flex: "1 1 200px", fontWeight: 600 }}>
        {game.category === "board" ? (
          <Link to="/games/$slug" params={{ slug: game.id }} style={{ color: "var(--text)" }}>
            {game.name}
          </Link>
        ) : (
          game.name
        )}
      </span>
      {editing ? null : (
        <button type="button" className="btn" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => setEditing(true)}>
          Edit
        </button>
      )}
      {editing ? (
        <div style={{ flex: "1 1 100%" }}>
          <CatalogEditor game={game} done={() => setEditing(false)} />
        </div>
      ) : null}
    </div>
  );
}

export function GameCard({ game }: { game: GameSummary }) {
  return (
    <article className="panel" style={{ display: "flex", flexDirection: "column" }}>
      {game.imageUrl ? (
        <div style={{ position: "relative" }}>
          <img src={game.imageUrl} alt="" style={{ display: "block", width: "100%", aspectRatio: "16 / 7", objectFit: "cover" }} />
          {game.logoUrl ? <img className="card-logo" src={game.logoUrl} alt="" /> : null}
        </div>
      ) : null}
      <div className="panel-head label">
        <span>{STATE_LABEL[game.state] ?? game.state.toLowerCase()}</span>
        <span>{game.label ?? ""}</span>
      </div>
      <div className="panel-body" style={{ flexGrow: 1 }}>
        <h3 style={{ fontSize: 20, fontWeight: 600 }}>
          {game.kind === "day" ? (
            <Link to="/table/$kind/$id" params={{ kind: "game-day", id: game.slug }} style={{ color: "var(--text)" }}>
              {game.name}
            </Link>
          ) : (
            <Link to="/games/$slug" params={{ slug: game.slug }} style={{ color: "var(--text)" }}>
              {game.name}
            </Link>
          )}
        </h3>
        {game.tagline ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {game.tagline}
          </p>
        ) : null}
        {game.next ? (
          <p className="num" style={{ fontSize: 12 }}>
            Next game {inDays(game.next)}, {stamp(game.next)}
          </p>
        ) : null}
        {game.lead ? (
          <p className="muted" style={{ fontSize: 12 }}>
            {game.kind === "campaign" ? "GM" : "Host"} {game.lead.name}
          </p>
        ) : null}
        <div className="row" style={{ marginTop: "auto", gap: 10 }}>
          {game.open ? (
            <>
              <SeatSquares capacity={game.capacity} taken={game.players} />
              <span className="num" style={{ fontSize: 13 }}>
                {game.capacity === null ? `${game.players} in` : `${game.players} / ${game.capacity}`}
              </span>
            </>
          ) : game.players > 0 ? (
            <span className="num" style={{ fontSize: 13 }}>
              {game.players} {game.players === 1 ? "player" : "players"}
            </span>
          ) : null}
          {game.mine ? <span className="pill in">Yours</span> : null}
          {game.open ? <span className="pill accent">Signing up</span> : null}
        </div>
      </div>
    </article>
  );
}
