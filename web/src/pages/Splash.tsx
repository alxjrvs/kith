import { useEffect, useRef, useState } from "react";
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
          <Link to="/find">See every open table</Link>
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

function SplashHero({ listing, signedIn }: { listing: Listing; signedIn: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!listing.soundUrl) return;
    const element = new Audio(listing.soundUrl);
    element.loop = true;
    element.preload = "none";
    element.addEventListener("pause", () => setPlaying(false));
    element.addEventListener("play", () => setPlaying(true));
    audio.current = element;
    return () => {
      element.pause();
      audio.current = null;
    };
  }, [listing.soundUrl]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  };

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
      <Orbits />
      <header>
        <Link to="/" className="wordmark" style={{ fontSize: 14 }}>
          ORREY
        </Link>
        <div className="row" style={{ gap: 10 }}>
          {listing.soundUrl ? (
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
          ) : null}
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
        <a href="#details" style={{ fontSize: 13 }}>
          Read the full details
        </a>
      </main>
    </div>
  );
}

/** The Lantern splash's orrery: three rings, the ember sun and two worlds. */
function Orbits() {
  const ring = (size: number, color = "var(--border)") => (
    <div
      aria-hidden="true"
      className="orbit"
      style={{ left: "68%", top: "46%", width: size, height: size, margin: `${-size / 2}px 0 0 ${-size / 2}px`, borderColor: color }}
    />
  );
  return (
    <>
      {ring(1100, "var(--rule)")}
      {ring(760)}
      {ring(440)}
      <div aria-hidden="true" className="orbit" style={{ left: "68%", top: "46%", width: 150, height: 150, margin: "-75px 0 0 -75px", background: "var(--accent)", border: 0, opacity: 0.9 }} />
      <div aria-hidden="true" className="orbit" style={{ left: "68%", top: "46%", width: 22, height: 22, margin: "-231px 0 0 60px", background: "var(--text)", border: 0 }} />
      <div aria-hidden="true" className="orbit" style={{ left: "68%", top: "46%", width: 14, height: 14, margin: "120px 0 0 -366px", background: "var(--maybe)", border: 0 }} />
    </>
  );
}
