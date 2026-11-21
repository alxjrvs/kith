import { useIntent, type AgendaRow as Row, type Intent } from "../api.ts";
import { time } from "../format.ts";
import { TallySquares } from "./Squares.tsx";

export function statusOf(row: Row): { label: string; tone: string } {
  if (row.state === "CANCELLED") return { label: "Called off", tone: "out" };
  if (row.inJeopardy) {
    const short = row.quorum.required !== null ? row.quorum.required - row.quorum.saidIn : 0;
    return { label: short > 0 ? `Jeopardy · needs ${short}` : "Jeopardy", tone: "maybe" };
  }
  if (row.quorum.confirmed || row.state === "CONFIRMED") return { label: "Confirmed", tone: "in" };
  if (row.state === "LOCKED") return { label: "Locked", tone: "in" };
  return { label: "Scheduled", tone: "accent" };
}

/** One session on the agenda, with your own In / Maybe / Out when it is yours. */
export function AgendaRow({ row, answer = true }: { row: Row; answer?: boolean }) {
  const intent = useIntent();
  const status = statusOf(row);
  const taking = row.state !== "LOCKED" && row.state !== "CANCELLED" && row.state !== "PLAYED";
  const choose = (value: Intent) => intent.mutate({ sessionId: row.sessionId, intent: value });

  return (
    <article className={`panel-row${row.inJeopardy ? " jeopardy" : ""}`}>
      <span className="mono" style={{ width: 52, fontSize: 15 }}>
        {time(row.startsAt)}
      </span>
      <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column" }}>
        <span style={{ fontWeight: 600 }}>{row.title}</span>
        {row.location ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {row.location}
          </span>
        ) : null}
      </div>
      <div className="row" style={{ gap: 10 }}>
        <TallySquares tally={row.tally} />
        <span className="mono" style={{ fontSize: 13 }}>
          {row.tally.in} / {row.rosterSize}
        </span>
      </div>
      <span className={`pill ${status.tone}`}>{status.label}</span>
      {answer && row.mine && taking ? (
        <div className="segmented" role="group" aria-label={`Your answer for ${row.title}`}>
          {(["in", "maybe", "out"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="btn"
              aria-pressed={row.myIntent === value}
              disabled={intent.isPending}
              onClick={() => choose(value)}
            >
              {value === "in" ? "In" : value === "maybe" ? "Maybe" : "Out"}
            </button>
          ))}
        </div>
      ) : null}
      {intent.error ? <p className="notice error" style={{ flex: "1 1 100%" }}>{intent.error.message}</p> : null}
    </article>
  );
}
