import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAgenda, useMe, type AgendaRow as Row } from "../api.ts";
import { AgendaRow } from "../components/AgendaRow.tsx";
import { asOf, inDays } from "../format.ts";
import { signInHref } from "../signin.ts";

export function Agenda() {
  const me = useMe().data;
  const signedIn = me?.signedIn === true;
  const [scope, setScope] = useState<"mine" | "public">("mine");
  const effective = signedIn ? scope : "public";
  const agenda = useAgenda(effective);
  const rows = agenda.data?.rows ?? [];

  const days = new Map<string, Row[]>();
  for (const row of rows) days.set(row.day, [...(days.get(row.day) ?? []), row]);
  const waiting = rows.filter((r) => r.mine && r.myIntent === null && r.state !== "LOCKED" && r.state !== "CANCELLED");

  return (
    <main className="page" style={{ gap: 20 }}>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>Agenda</h1>
          <p className="muted" style={{ fontSize: 13 }}>
            Does it run, then when. {agenda.data ? <span className="mono">{asOf(agenda.data.asOf)}</span> : null}
          </p>
        </div>
        <div className="row">
          {signedIn ? (
            <>
              <div className="segmented" role="group" aria-label="Which games">
                <button type="button" className="btn" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
                  Your games
                </button>
                <button type="button" className="btn" aria-pressed={scope === "public"} onClick={() => setScope("public")}>
                  Everything you can see
                </button>
              </div>
              <Link to="/profile" hash="feeds" className="btn">
                Subscribe by calendar feed
              </Link>
            </>
          ) : me ? (
            <a className="btn primary" href={signInHref()}>
              Sign in to see your games
            </a>
          ) : null}
        </div>
      </div>

      <div className="split">
        <div className="main">
          {agenda.isError ? <p className="notice error">{agenda.error.message}</p> : null}
          {agenda.isSuccess && rows.length === 0 ? (
            <p className="empty">
              {effective === "mine" ? "Nothing on your tables in the next six weeks." : "Nothing public in the next six weeks."}{" "}
              <Link to="/find">Find a game</Link>
            </p>
          ) : null}
          {[...days.entries()].map(([day, list]) => (
            <section key={day} className="panel">
              <h2 className="panel-head label">
                {list[0]!.dayLabel} · {inDays(list[0]!.startsAt)}
              </h2>
              {list.map((row) => (
                <AgendaRow key={row.sessionId} row={row} />
              ))}
            </section>
          ))}
        </div>
        <aside>
          {signedIn && waiting.length > 0 ? (
            <section className="panel">
              <h2 className="panel-head label">Waiting on you · {waiting.length}</h2>
              {waiting.map((row) => (
                <div key={row.sessionId} className="panel-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <span style={{ fontWeight: 600 }}>No reply · {row.title}</span>
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {row.dayLabel.toLowerCase()}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
          <section className="panel">
            <h2 className="panel-head label">Reading the squares</h2>
            <div className="panel-body" style={{ gap: 8, fontSize: 13 }}>
              {(
                [
                  ["in", "In"],
                  ["maybe", "Maybe"],
                  ["out", "Out"],
                  ["", "No reply. Not a no."],
                ] as const
              ).map(([kind, label]) => (
                <span key={label} className="row" style={{ gap: 8 }}>
                  <span className="squares" aria-hidden="true">
                    <span className={kind} />
                  </span>
                  {label}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
