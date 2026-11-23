import { useRef, useState } from "react";
import { useStopSign, useSuggestion } from "../api.ts";

/**
 * The stop sign: a safety tool, like the X-card. Anybody at the game can press
 * it, any time, and never has to say why. It always sits in the corner of a
 * game's home base, and it asks once before it sends, so a stray tap does
 * nothing.
 */
export function StopSign({ slug, game }: { slug: string; game: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stop = useStopSign(slug);
  const sent = stop.data;

  const open = () => {
    stop.reset();
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  return (
    <>
      <button type="button" className="stop-sign" onClick={open} aria-haspopup="dialog">
        <span className="stop-octagon" aria-hidden="true">
          STOP
        </span>
        <span>Stop sign</span>
      </button>
      <dialog ref={dialog} className="stop-dialog" aria-labelledby="stop-title" onClick={(e) => e.target === dialog.current && close()}>
        {sent ? (
          <div className="stack">
            <h2 id="stop-title">Sent</h2>
            <p>
              {sent.posted
                ? "The table has been told in Discord."
                : sent.unconfirmed
                  ? "Kith sent the alert to Discord but couldn't confirm it went up."
                  : "Kith couldn't reach Discord just now and will keep trying. Please tell the table yourself too."}{" "}
              {sent.emailed ? "The organiser has been emailed." : "The organiser will be emailed as soon as Kith can."}
            </p>
            <p className="muted">Take whatever time you need. Nobody needs a reason.</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={close}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <h2 id="stop-title">Press the stop sign?</h2>
            <p>
              Kith posts an alert in {game}'s Discord channel saying you pressed it, and lets the organiser know. You
              don't have to say why.
            </p>
            {stop.error ? <p className="notice error">{stop.error.message}</p> : null}
            <div className="row">
              <button type="button" className="btn stop-confirm" disabled={stop.isPending} onClick={() => stop.mutate()}>
                {stop.isPending ? "Sending…" : "Yes, send it"}
              </button>
              <button type="button" className="btn" onClick={close}>
                Not now
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

/** The suggestion box: words for the organiser, with your name or without it. Nothing goes to Discord. */
export function SuggestionBox({ slug }: { slug: string }) {
  const suggest = useSuggestion(slug);
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(true);
  const [left, setLeft] = useState<"named" | "anonymous" | null>(null);

  return (
    <section className="panel" id="suggestions">
      <h2 className="panel-head label">Suggestion box</h2>
      <form
        className="panel-body"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body) return;
          suggest.mutate(
            { body, anonymous },
            {
              onSuccess: () => {
                setText("");
                setLeft(anonymous ? "anonymous" : "named");
              },
            },
          );
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Something that would make this game better? Only the organiser reads these.
        </p>
        <label className="field" style={{ flex: "none" }}>
          <span className="visually-hidden">Your suggestion</span>
          <textarea
            value={text}
            maxLength={2000}
            onChange={(e) => {
              setText(e.target.value);
              setLeft(null);
            }}
          />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          <span>Leave it anonymously</span>
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {anonymous
            ? "Kith keeps no name with it, only the day, so nobody can tell it was you."
            : "Your name goes with it."}
        </p>
        {suggest.error ? <p className="notice error">{suggest.error.message}</p> : null}
        {left ? <p className="notice">Thanks. It's in the box{left === "anonymous" ? ", with no name on it" : ""}.</p> : null}
        <div className="row">
          <button type="submit" className="btn primary" disabled={suggest.isPending || !text.trim()}>
            {suggest.isPending ? "Leaving it…" : "Leave a suggestion"}
          </button>
        </div>
      </form>
    </section>
  );
}
