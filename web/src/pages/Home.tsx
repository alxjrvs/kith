import { Link } from "@tanstack/react-router";
import { useAgenda, useCopy, useHomes, useMe } from "../api.ts";
import { Markdown } from "../markdown.tsx";
import { GameCard } from "./Games.tsx";
import { TallySquares } from "../components/Squares.tsx";
import { statusOf } from "../components/AgendaRow.tsx";
import { inDays, stamp } from "../format.ts";

export function Home() {
  const signedIn = useMe().data?.signedIn === true;
  const copy = useCopy().data?.home;
  const games = (useHomes().data?.games ?? []).filter((g) => g.state !== "CONCLUDED");
  // Yours first, then the rest in the hub's order.
  const shown = [...games.filter((g) => g.mine), ...games.filter((g) => !g.mine)].slice(0, 6);
  const agenda = useAgenda(signedIn ? "mine" : "public").data?.rows ?? [];
  const next = signedIn ? agenda[0] : undefined;

  return (
    <main className="page" style={{ gap: 36 }}>
      <section className="row" style={{ alignItems: "stretch", gap: 24 }}>
        <div className="stack" style={{ flex: "1 1 440px", justifyContent: "center", gap: 14 }}>
          <span className="label">{copy?.kicker ?? "The Orrey of Worlds"}</span>
          <h1 style={{ fontSize: 40, lineHeight: 1.08, letterSpacing: "-0.02em" }}>{copy?.title ?? "Every game we run, in one place."}</h1>
          <div className="muted" style={{ fontSize: 15, maxWidth: "50ch" }}>
            {copy?.body ? (
              <Markdown source={copy.body} />
            ) : (
              <p>Each game has a home base: who plays whom, when it meets next, its links and what the table knows.</p>
            )}
          </div>
          <div className="row">
            <Link to="/games" className="btn primary">
              See the games
            </Link>
            <Link to="/agenda" className="btn">
              See the agenda
            </Link>
          </div>
        </div>
        {next ? (
          <div className="panel" style={{ flex: "1 1 340px" }}>
            <div className="panel-head label">Next up {inDays(next.startsAt)}</div>
            <div className="panel-body">
              <span className="num" style={{ fontSize: 26 }}>
                {stamp(next.startsAt)}
              </span>
              <span style={{ fontSize: 17, fontWeight: 600 }}>{next.title}</span>
              <div className="row" style={{ gap: 10 }}>
                <TallySquares tally={next.tally} />
                <span className="num" style={{ fontSize: 13 }}>
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
          <h2 className="label">
            {signedIn && shown.some((g) => g.mine) ? "Your games and the rest" : "The games"}
          </h2>
          <Link to="/games" style={{ fontSize: 13 }}>
            See every game
          </Link>
        </div>
        {games.length === 0 ? (
          <p className="empty">No games you can see yet.</p>
        ) : (
          <div className="grid">
            {shown.map((game) => (
              <GameCard key={`${game.kind}:${game.slug}`} game={game} />
            ))}
          </div>
        )}
      </section>

      {agenda.length > 0 ? (
        <section className="stack">
          <div className="section-head">
            <h2 className="label">
              Coming up
            </h2>
            <Link to="/agenda" style={{ fontSize: 13 }}>
              See the full agenda
            </Link>
          </div>
          <div className="panel">
            {agenda.slice(0, 5).map((row) => (
              <div key={row.sessionId} className={`panel-row${row.inJeopardy ? " jeopardy" : ""}`} style={{ minHeight: 48 }}>
                <span className="num" style={{ width: 170, fontSize: 13 }}>
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
