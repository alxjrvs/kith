import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ToTable } from "../components/To.tsx";
import { Link, useParams } from "@tanstack/react-router";
import { useListing, useMe, type Listing } from "../api.ts";
import { SeatSquares } from "../components/Squares.tsx";
import { SignupButtons } from "../components/SignupButtons.tsx";
import { ListingEditor } from "../components/ListingEditor.tsx";
import { cadence } from "../format.ts";
import { signInHref } from "../signin.ts";

/**
 * A new game's front door: full screen, the hero image behind, the sound on a
 * button (browsers only play audio after a press, and that is the design
 * anyway), and one big way in.
 */
export function Splash() {
  const { kind, id } = useParams({ from: "/join/$kind/$id" });
  const query = useListing(kind, id);
  const me = useMe().data;

  if (query.isPending) return <div className="splash" aria-busy="true" />;
  if (query.isError) {
    return (
      <main className="page">
        <h1>Nothing to join here</h1>
        <p className="muted">
          {query.error.message}{" "}
          {me && !me.signedIn ? (
            <>
              If it is a table you are on, <a href={signInHref()}>sign in with Discord</a>.
            </>
          ) : null}{" "}
          <Link to="/games">See every game</Link>
        </p>
      </main>
    );
  }

  const listing = query.data.listing;
  return (
    <>
      <SplashHero listing={listing} signedIn={me?.signedIn === true} />
      <section id="details" className="page">
        <div className="split">
          <div className="main">
            <h2 style={{ fontSize: 22, fontFamily: "var(--font-head)" }}>About {listing.name}</h2>
            {listing.pitch ? (
              <p className="prose" style={{ whiteSpace: "pre-line" }}>
                {listing.pitch}
              </p>
            ) : (
              <p className="muted">The organiser has not written more about this one yet.</p>
            )}
          </div>
          <aside>
            <div className="panel">
              <div className="panel-head label">The table</div>
              <div className="panel-body">
                {listing.game ? <span>{listing.game.name}</span> : null}
                {listing.lead ? (
                  <span className="muted">
                    {listing.kind === "campaign" ? "GM" : "Host"} {listing.lead.name}
                  </span>
                ) : null}
                <div className="row">
                  <SeatSquares capacity={listing.capacity} taken={listing.taken} />
                  <span className="mono" style={{ fontSize: 13 }}>
                    {listing.capacity === null ? `${listing.taken} in` : `${listing.taken} / ${listing.capacity}`}
                    {listing.waitlist > 0 ? ` · waitlist ${listing.waitlist}` : ""}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>
        {me?.signedIn && me.organiser ? <ListingEditor listing={listing} /> : null}
      </section>
    </>
  );
}

/** The splash's sound: off until pressed, looping once it plays. Shared with the home bases. */
export function SoundButton({ url }: { url: string | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!url) return;
    const element = new Audio(url);
    element.loop = true;
    element.preload = "none";
    element.addEventListener("pause", () => setPlaying(false));
    element.addEventListener("play", () => setPlaying(true));
    audio.current = element;
    return () => {
      element.pause();
      audio.current = null;
    };
  }, [url]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  };

  if (!url) return null;
  return (
    <button type="button" className="btn" aria-pressed={playing} onClick={toggle}>
      {playing ? (
        <>
          <span aria-hidden="true" style={{ display: "inline-flex", gap: 3 }}>
            <span style={{ width: 4, height: 12, background: "var(--in)" }} />
            <span style={{ width: 4, height: 12, background: "var(--in)" }} />
          </span>
          Pause the sound
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            style={{ width: 0, height: 0, borderLeft: "10px solid var(--text)", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }}
          />
          Play the sound
        </>
      )}
    </button>
  );
}

function SplashHero({ listing, signedIn }: { listing: Listing; signedIn: boolean }) {
  const left = listing.capacity === null ? null : Math.max(listing.capacity - listing.taken, 0);
  const eyebrow = [
    listing.kind === "campaign" ? "New campaign" : "Game day",
    listing.game?.name,
    listing.lead ? `${listing.kind === "campaign" ? "GM" : "Host"} ${listing.lead.name}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="splash">
      {listing.heroUrl ? <div className="hero" style={{ backgroundImage: `url("${encodeURI(listing.heroUrl)}")` }} /> : null}
      <TableMotif />
      <header>
        <Link to="/" className="wordmark" style={{ fontSize: 26 }}>
          <img src="/mark.svg" alt="" width="26" height="26" />
          kith
        </Link>
        <div className="row" style={{ gap: 10 }}>
          <SoundButton url={listing.soundUrl} />
          {signedIn ? (
            <Link to="/agenda" className="btn">
              Your agenda
            </Link>
          ) : (
            <a className="btn" href={signInHref()}>
              Sign in
            </a>
          )}
        </div>
      </header>
      <main>
        <span className="label">{eyebrow}</span>
        <h1>{listing.name}</h1>
        {listing.tagline ? <p className="tagline">{listing.tagline}</p> : null}
        <div className="row" style={{ gap: 6 }}>
          {[...cadence(listing), listing.where === "voice" ? "Voice" : listing.where].filter(Boolean).map((chip) => (
            <span key={chip} className="chip">
              {chip}
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: "16px 24px" }}>
          <SignupButtons listing={listing} big />
          <div className="row" style={{ gap: 10 }}>
            <SeatSquares capacity={listing.capacity} taken={listing.taken} big />
            <span className="mono" style={{ fontSize: 13 }}>
              {listing.capacity === null ? `${listing.taken} in` : `${listing.taken} / ${listing.capacity}`}
              {left !== null ? ` · ${left === 0 ? "full" : `${left} ${left === 1 ? "seat" : "seats"} left`}` : ""}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 18, fontSize: 13 }}>
          <a href="#details">Read the full details</a>
          <ToTable kind={listing.kind} id={listing.id}>
            {listing.kind === "campaign" ? "The game's home base" : "Links and pages"}
          </ToTable>
        </div>
      </main>
    </div>
  );
}

/** The mark, at room scale: a round table seen from above, six seats, the top one lit. */
export function TableMotif() {
  const at = (size: number, style: CSSProperties, dx = 0, dy = 0) => (
    <div
      aria-hidden="true"
      className="seat"
      style={{ left: "68%", top: "46%", width: size, height: size, margin: `${dy - size / 2}px 0 0 ${dx - size / 2}px`, ...style }}
    />
  );
  const seats = Array.from({ length: 6 }, (_, i) => {
    const t = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return at(56, { background: i === 0 ? "var(--accent)" : "var(--border)", border: 0, opacity: i === 0 ? 0.85 : 0.5 }, 300 * Math.cos(t), 300 * Math.sin(t));
  });
  return (
    <>
      {at(1100, { borderColor: "var(--rule)" })}
      {at(400, { background: "var(--panel)", border: "2px solid var(--accent)", opacity: 0.55 })}
      {seats}
    </>
  );
}
