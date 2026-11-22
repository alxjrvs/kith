import { useIntent, type AgendaRow as Row, type Intent } from "../api.ts";
import { time } from "../format.ts";
import { TallySquares } from "./Squares.tsx";
import { ToTable } from "./To.tsx";

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
export function AgendaRow({
  row,
  answer = true,
  tally = true,
  simple = false,
}: {
  row: Row;
  answer?: boolean;
  tally?: boolean;
  /**
   * One button instead of three. On a roster silence is already "in", so the
   * only thing a player needs to say is that they cannot make it, and take it back.
   */
  simple?: boolean;
}) {
  const intent = useIntent();
  const status = statusOf(row);
  const taking = row.state !== "LOCKED" && row.state !== "CANCELLED" && row.state !== "PLAYED";
  const choose = (value: Intent) => intent.mutate({ sessionId: row.sessionId, intent: value });

  return (
    <article className={`panel-row${row.inJeopardy ? " jeopardy" : ""}`}>
      <span className="num" style={{ width: 52, fontSize: 15 }}>
        {time(row.startsAt)}
      </span>
      <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column" }}>
        {row.campaignId || row.gameDayId ? (
          <ToTable
            kind={row.campaignId ? "campaign" : "game-day"}
            id={(row.campaignId ?? row.gameDayId)!}
            style={{ fontWeight: 600, color: "var(--text)" }}
          >
            {row.title}
          </ToTable>
        ) : (
          <span style={{ fontWeight: 600 }}>{row.title}</span>
        )}
        {row.location ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {row.location}
          </span>
        ) : null}
      </div>
      {tally ? (
        <div className="row" style={{ gap: 10 }}>
          <TallySquares tally={row.tally} />
          <span className="num" style={{ fontSize: 13 }}>
            {row.tally.in} / {row.rosterSize}
          </span>
        </div>
      ) : null}
      <span className={`pill ${status.tone}`}>{status.label}</span>
      {answer && row.canAnswer && taking && simple ? (
        row.myIntent === "out" ? (
          <div className="row" style={{ gap: 10 }}>
            <span className="pill out">You can't make it</span>
            <button type="button" className="btn" style={{ minHeight: 32, padding: "0 10px" }} disabled={intent.isPending} onClick={() => choose("in")}>
              Actually, I can
            </button>
          </div>
        ) : (
          <button type="button" className="btn" style={{ minHeight: 32, padding: "0 12px" }} disabled={intent.isPending} onClick={() => choose("out")}>
            I can't make it
          </button>
        )
      ) : null}
      {answer && row.canAnswer && taking && !simple ? (
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
