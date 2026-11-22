import { useState } from "react";
import { useCatalogEdit, type CatalogEntry } from "../api.ts";
import { EditInCms } from "./EditInCms.tsx";

/** An organiser's edit of a game's catalog card: its kind. Its summary and cover are written in kith-cms. */
export function CatalogEditor({ game, done }: { game: CatalogEntry; done: () => void }) {
  const edit = useCatalogEdit(game.id);
  const [category, setCategory] = useState(game.category);
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        edit.mutate({ category }, { onSuccess: done });
      }}
    >
      <div className="field">
        <label htmlFor={`cat-${game.id}`}>Kind</label>
        <select id={`cat-${game.id}`} value={category} onChange={(e) => setCategory(e.target.value as CatalogEntry["category"])}>
          <option value="ttrpg">TTRPG</option>
          <option value="board">Board game</option>
        </select>
      </div>
      <EditInCms collection="games">Edit its summary and cover in the CMS</EditInCms>
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
