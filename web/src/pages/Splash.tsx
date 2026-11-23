import { useEffect, useRef, useState } from "react";
import { ToTable } from "../components/To.tsx";
import { Header } from "../components/Header.tsx";
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
      <>
      {me?.signedIn ? <Header /> : null}
      <main className="page">
        <h1>Nothing to join here</h1>
        <p className="muted">
          {query.error.message}{" "}
          {me && !me.signedIn ? (
            <>
              If it is a table you are on, <a href={signInHref()}>sign in with Discord</a>.
            </>
          ) : null}{" "}
          {me?.signedIn ? <Link to="/games">See every game</Link> : <Link to="/">Back to the front page</Link>}
        </p>
      </main>
      </>
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
                  <span className="num" style={{ fontSize: 13 }}>
                    {listing.capacity === null ? `${listing.taken} in` : `${listing.taken} / ${listing.capacity}`}
                    {listing.waitlist > 0 ? `, ${listing.waitlist} waiting` : ""}
                    {listing.interested > 0 ? `, ${listing.interested} interested` : ""}
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
  // The system is a chip of its own below the title, where people look for it.
  const eyebrow = `${listing.kind === "campaign" ? "New campaign" : "Game day"}${
    listing.lead ? ` ${listing.kind === "campaign" ? "run" : "hosted"} by ${listing.lead.name}` : ""
  }`;

  return (
    <div className="splash">
      {listing.heroUrl ? <div className="hero" style={{ backgroundImage: `url("${encodeURI(listing.heroUrl)}")` }} /> : null}
      {listing.heroUrl ? null : <TableMotif />}
      {signedIn ? (
        <Header over={Boolean(listing.heroUrl)} />
      ) : (
        <header>
          <Link to="/" className="wordmark" style={{ fontSize: 26 }}>
            <img src="/mark.svg" alt="" width="26" height="26" />
            Kith.town
          </Link>
          <div className="row" style={{ gap: 10 }}>
            <SoundButton url={listing.soundUrl} />
            <a className="btn" href={signInHref()}>
              Sign in
            </a>
          </div>
        </header>
      )}
      <main>
        <span className="label">{eyebrow}</span>
        <h1>{listing.name}</h1>
        {listing.tagline ? <p className="tagline">{listing.tagline}</p> : null}
        <div className="row" style={{ gap: 6 }}>
          {listing.game ? <span className="chip system">{listing.game.name}</span> : null}
          {[...cadence(listing), listing.where === "voice" ? "Voice" : listing.where].filter(Boolean).map((chip) => (
            <span key={chip} className="chip">
              {chip}
            </span>
          ))}
          {signedIn ? <SoundButton url={listing.soundUrl} /> : null}
        </div>
        <div className="row" style={{ gap: "16px 24px" }}>
          <SignupButtons listing={listing} big />
          <div className="row" style={{ gap: 10 }}>
            <SeatSquares capacity={listing.capacity} taken={listing.taken} big />
            <span className="num" style={{ fontSize: 13 }}>
              {listing.capacity === null ? `${listing.taken} in` : `${listing.taken} / ${listing.capacity}`}
              {left !== null ? `, ${left === 0 ? "full" : `${left} ${left === 1 ? "seat" : "seats"} left`}` : ""}
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 18, fontSize: 13 }}>
          <a href="#details">Read the full details</a>
          {signedIn || listing.kind === "campaign" ? (
            <ToTable kind={listing.kind} id={listing.id}>
              {listing.kind === "campaign" ? "The game's home base" : "Links and pages"}
            </ToTable>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/**
 * With no hero image, the art is the Kith logo itself, at room scale on the
 * right. With one, the organiser's picture is the art and this stays out.
 */
export function TableMotif() {
  return <img className="logo-art" src="/mark.svg" alt="" aria-hidden="true" />;
}
