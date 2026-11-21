import { useState } from "react";
import { useListings } from "../api.ts";
import { ListingCard } from "../components/ListingCard.tsx";

type Kind = "all" | "campaign" | "game-day";

export function Find() {
  const query = useListings();
  const [kind, setKind] = useState<Kind>("all");
  const [game, setGame] = useState("any");
  const [openOnly, setOpenOnly] = useState(false);

  const all = query.data?.listings ?? [];
  const games = [...new Map(all.filter((l) => l.game).map((l) => [l.game!.id, l.game!.name])).entries()];
  const shown = all.filter(
    (l) =>
      (kind === "all" || l.kind === kind) &&
      (game === "any" || l.game?.id === game) &&
      (!openOnly || l.capacity === null || l.taken < l.capacity),
  );
  const campaigns = shown.filter((l) => l.kind === "campaign");
  const days = shown.filter((l) => l.kind === "game-day");

  return (
    <main className="page">
      <div className="stack" style={{ gap: 8 }}>
        <h1 style={{ fontSize: 32 }}>Find a game</h1>
        <p className="muted">Open tables you can take a seat at. A full table has a waitlist.</p>
      </div>

      <div className="row" style={{ gap: "12px 24px", alignItems: "flex-end", padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
        <div className="segmented" role="group" aria-label="Kind of table">
          {(
            [
              ["all", "All tables"],
              ["campaign", "Campaigns"],
              ["game-day", "Game days"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" className="btn" aria-pressed={kind === value} onClick={() => setKind(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="find-game">Game</label>
          <select id="find-game" value={game} onChange={(e) => setGame(e.target.value)}>
            <option value="any">Any game</option>
            {games.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="find-seats">Seats</label>
          <select id="find-seats" value={openOnly ? "open" : "all"} onChange={(e) => setOpenOnly(e.target.value === "open")}>
            <option value="all">Open seats and waitlists</option>
            <option value="open">Open seats only</option>
          </select>
        </div>
      </div>

      {query.isError ? <p className="notice error">{query.error.message}</p> : null}
      {query.isSuccess && shown.length === 0 ? (
        <p className="empty">No open tables right now. Running campaigns are on the agenda.</p>
      ) : null}

      {campaigns.length > 0 ? (
        <section className="stack" style={{ gap: 16 }}>
          <h2 style={{ fontSize: 20 }}>
            Campaigns forming <span className="muted" style={{ fontWeight: 400 }}>· recurring TTRPG tables</span>
          </h2>
          <div className="grid">
            {campaigns.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      ) : null}

      {days.length > 0 ? (
        <section className="stack" style={{ gap: 16 }}>
          <h2 style={{ fontSize: 20 }}>
            Game days <span className="muted" style={{ fontWeight: 400 }}>· one date, often a long day</span>
          </h2>
          <div className="grid">
            {days.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
