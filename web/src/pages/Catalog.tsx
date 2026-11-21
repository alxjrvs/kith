import { useState } from "react";
import { useCatalogEdit, useGames, useMe, type CatalogEntry } from "../api.ts";

export function Catalog() {
  const games = useGames();
  const me = useMe().data;
  const organiser = me?.signedIn === true && me.organiser;
  const all = games.data?.games ?? [];
  const groups: [string, CatalogEntry[]][] = [
    ["Tabletop RPGs", all.filter((g) => g.category === "ttrpg")],
    ["Board games", all.filter((g) => g.category === "board")],
  ];

  return (
    <main className="page">
      <div className="stack" style={{ gap: 8 }}>
        <h1 style={{ fontSize: 32 }}>Games</h1>
        <p className="muted">The systems and board games the group plays.</p>
      </div>
      {games.isError ? <p className="notice error">{games.error.message}</p> : null}
      {games.isSuccess && all.length === 0 ? <p className="empty">No games in the catalog yet.</p> : null}
      {groups.map(([title, list]) =>
        list.length === 0 ? null : (
          <section key={title} className="stack" style={{ gap: 16 }}>
            <h2 className="label" style={{ fontSize: 12 }}>
              {title} · {list.length}
            </h2>
            <div className="grid">
              {list.map((game) => (
                <GameCard key={game.id} game={game} organiser={organiser} />
              ))}
            </div>
          </section>
        ),
      )}
    </main>
  );
}

function facts(game: CatalogEntry): string {
  const players =
    game.minPlayers && game.maxPlayers
      ? `${game.minPlayers} to ${game.maxPlayers} players`
      : game.maxPlayers
        ? `up to ${game.maxPlayers} players`
        : null;
  const length = game.defaultDurationMinutes ? `${Math.round(game.defaultDurationMinutes / 60)} h` : null;
  return [players, length].filter(Boolean).join(" · ").toUpperCase();
}

function GameCard({ game, organiser }: { game: CatalogEntry; organiser: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="panel">
      {game.coverUrl ? (
        <img src={game.coverUrl} alt="" style={{ display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "cover" }} />
      ) : null}
      <div className="panel-body">
        <span className="label">{game.category === "board" ? "Board game" : "TTRPG"}</span>
        <h3 style={{ fontSize: 20 }}>{game.name}</h3>
        {game.summary ? <p className="muted">{game.summary}</p> : null}
        {facts(game) ? <p className="mono" style={{ fontSize: 12 }}>{facts(game)}</p> : null}
        {organiser ? (
          editing ? (
            <CatalogEditor game={game} done={() => setEditing(false)} />
          ) : (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )
        ) : null}
      </div>
    </article>
  );
}

function CatalogEditor({ game, done }: { game: CatalogEntry; done: () => void }) {
  const edit = useCatalogEdit(game.id);
  const [category, setCategory] = useState(game.category);
  const [summary, setSummary] = useState(game.summary ?? "");
  const [coverUrl, setCoverUrl] = useState(game.coverUrl ?? "");
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        edit.mutate({ category, summary, coverUrl }, { onSuccess: done });
      }}
    >
      <div className="field">
        <label htmlFor={`cat-${game.id}`}>Kind</label>
        <select id={`cat-${game.id}`} value={category} onChange={(e) => setCategory(e.target.value as CatalogEntry["category"])}>
          <option value="ttrpg">TTRPG</option>
          <option value="board">Board game</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`sum-${game.id}`}>Summary</label>
        <textarea id={`sum-${game.id}`} maxLength={600} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`cov-${game.id}`}>Cover image URL (https)</label>
        <input id={`cov-${game.id}`} type="url" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
      </div>
      {edit.error ? <p className="notice error">{edit.error.message}</p> : null}
      <div className="row">
        <button type="submit" className="btn primary" disabled={edit.isPending}>
          Save
        </button>
        <button type="button" className="btn" onClick={done}>
          Cancel
        </button>
      </div>
    </form>
  );
}
