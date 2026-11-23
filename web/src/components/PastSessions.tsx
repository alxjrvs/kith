import { useState } from "react";
import { useNameSession, type PastSession } from "../api.ts";
import { onDay } from "../format.ts";

/** How many evenings show before "Show all". */
const FIRST = 8;

/**
 * A campaign's past sessions, newest first, each with its episode name when it
 * has one. The GM or an organiser can name one, or rename it, after the fact.
 */
export function PastSessions({ past, canName }: { past: PastSession[]; canName: boolean }) {
  const [all, setAll] = useState(false);
  if (past.length === 0) return null;
  const shown = all ? past : past.slice(0, FIRST);
  return (
    <section className="panel" id="past">
      <h2 className="panel-head label">
        <span>Past sessions</span>
        <span className="num">{past.length}</span>
      </h2>
      <ol className="past-sessions">
        {shown.map((session) => (
          <PastRow key={session.sessionId} session={session} canName={canName} />
        ))}
      </ol>
      {past.length > FIRST ? (
        <div className="panel-body">
          <button type="button" className="btn" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : `Show all ${past.length}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PastRow({ session, canName }: { session: PastSession; canName: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title ?? "");
  const name = useNameSession();

  if (editing) {
    return (
      <li className="past-session">
        <span className="num muted past-date">{onDay(session.startsAt)}</span>
        <form
          className="row past-edit"
          onSubmit={(e) => {
            e.preventDefault();
            name.mutate({ sessionId: session.sessionId, title: draft }, { onSuccess: () => setEditing(false) });
          }}
        >
          <div className="field">
            <label htmlFor={`title-${session.sessionId}`}>What was this one called?</label>
            <input
              id={`title-${session.sessionId}`}
              value={draft}
              maxLength={200}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn primary" disabled={name.isPending}>
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setDraft(session.title ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
          {name.isError ? <p className="notice error">{name.error.message}</p> : null}
        </form>
      </li>
    );
  }

  return (
    <li className="past-session">
      <span className="num muted past-date">{onDay(session.startsAt)}</span>
      <span className="past-title">{session.title ?? <span className="muted">No name yet</span>}</span>
      {canName ? (
        <button
          type="button"
          className="btn past-name"
          onClick={() => {
            name.reset();
            setDraft(session.title ?? "");
            setEditing(true);
          }}
        >
          {session.title ? "Rename" : "Name it"}
        </button>
      ) : null}
    </li>
  );
}
