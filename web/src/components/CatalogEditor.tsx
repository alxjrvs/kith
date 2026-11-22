import { useState } from "react";
import { useCatalogEdit, type CatalogEntry } from "../api.ts";

/** An organiser's edit of a game's catalog card: its kind, summary and cover. */
export function CatalogEditor({ game, done }: { game: CatalogEntry; done: () => void }) {
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
