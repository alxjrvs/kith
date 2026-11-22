import { Link } from "@tanstack/react-router";
import { useHomes, useMe, type GameSummary } from "../api.ts";
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
  const all = homes.data?.games ?? [];
  const live = all.filter((g) => g.state !== "CONCLUDED");
  const groups: [string, GameSummary[]][] = [
    ["Campaigns", live.filter((g) => g.kind === "campaign")],
    ["Board games", live.filter((g) => g.kind === "board")],
    ["Concluded", all.filter((g) => g.state === "CONCLUDED")],
  ];

  return (
    <main className="page">
      <div className="stack" style={{ gap: 8 }}>
        <h1 style={{ fontSize: 32 }}>Games</h1>
        <p className="muted">Every table we run. Each one has a home base with who plays whom and when it meets next.</p>
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
            <h2 className="label" style={{ fontSize: 12 }}>
              {title} · {list.length}
            </h2>
            <div className="grid">
              {list.map((game) => (
                <GameCard key={`${game.kind}:${game.slug}`} game={game} />
              ))}
            </div>
          </section>
        ),
      )}
    </main>
  );
}

export function GameCard({ game }: { game: GameSummary }) {
  return (
    <article className="panel" style={{ display: "flex", flexDirection: "column" }}>
      {game.imageUrl ? (
        <img src={game.imageUrl} alt="" style={{ display: "block", width: "100%", aspectRatio: "16 / 7", objectFit: "cover" }} />
      ) : null}
      <div className="panel-head label">
        <span>{STATE_LABEL[game.state] ?? game.state.toLowerCase()}</span>
        <span>{game.label ?? ""}</span>
      </div>
      <div className="panel-body" style={{ flexGrow: 1 }}>
        <h3 style={{ fontSize: 20, fontWeight: 600 }}>
          <Link to="/games/$slug" params={{ slug: game.slug }} style={{ color: "var(--text)" }}>
            {game.name}
          </Link>
        </h3>
        {game.tagline ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {game.tagline}
          </p>
        ) : null}
        {game.next ? (
          <p className="mono" style={{ fontSize: 12 }}>
            NEXT {stamp(game.next)} · {inDays(game.next).toUpperCase()}
          </p>
        ) : null}
        {game.lead ? (
          <p className="muted" style={{ fontSize: 12 }}>
            {game.kind === "campaign" ? "GM" : "Host"} {game.lead.name}
          </p>
        ) : null}
        <div className="row" style={{ marginTop: "auto", gap: 10 }}>
          <SeatSquares capacity={game.capacity} taken={game.players} />
          <span className="mono" style={{ fontSize: 13 }}>
            {game.capacity === null ? `${game.players} playing` : `${game.players} / ${game.capacity}`}
          </span>
          {game.mine ? <span className="pill in">Yours</span> : null}
          {game.open ? <span className="pill accent">Signing up</span> : null}
        </div>
      </div>
    </article>
  );
}
