import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useHomes, useMe, type GameSummary } from "../api.ts";
import { inDays, kindWord, leadChip, stamp } from "../format.ts";
import { Markdown } from "../markdown.tsx";
import { signInHref } from "../signin.ts";
import { Header } from "../components/Header.tsx";
import { GameMarks } from "../components/GameMarks.tsx";

/** How long each game holds the screen before the next one comes in. */
const HOLD_MS = 7000;

/**
 * The front door for someone who has not signed in: one screen, no scrolling,
 * each game in turn with its own art, and a way in at the bottom.
 *
 * It shows what the hub shows a stranger, nothing more: the games are read
 * from `/api/hub/homes`, where visibility is already decided, so a test game
 * or a members-only one never reaches this page. Running games come first and
 * finished ones after, so the slideshow is both what is on now and what has
 * been played.
 */
export function Landing() {
  const homes = useHomes();
  const all = homes.data?.games ?? [];
  const slides = [...all.filter((g) => g.state !== "CONCLUDED"), ...all.filter((g) => g.state === "CONCLUDED")];

  useNoScroll();

  return (
    <div className="show">
      <Top about={!homes.isPending && slides.length > 0} />
      {homes.isPending ? null : slides.length === 0 ? <Empty /> : <Slides slides={slides} />}
    </div>
  );
}

/**
 * Signed out: the name, and on the slides what Kith is (the empty room says it
 * larger). Signed in, the slideshow is one more page of the site, so it wears
 * the site header, floating over the art as text.
 */
function Top({ about }: { about: boolean }) {
  const signedIn = useMe().data?.signedIn === true;
  if (signedIn) return <Header over />;
  return (
    <header className="show-top">
      <Link to="/" className="wordmark" style={{ fontSize: 26 }}>
        <img src="/mark.svg" alt="" width="26" height="26" />
        Kith.town
      </Link>
      {about ? <p className="show-about words-card">An invite-only community of gamers.</p> : null}
    </header>
  );
}

/** With no games anyone may see, the Kith mark holds the room. */
function Empty() {
  return (
    <>
      <img className="show-mark" src="/mark.svg" alt="" aria-hidden="true" />
      <div className="show-slide-words" style={{ position: "relative" }}>
        <h1>An invite-only community of gamers.</h1>
        <p className="show-tagline">Most tables show only to the people on them.</p>
      </div>
      <Footer />
    </>
  );
}

function Slides({ slides }: { slides: GameSummary[] }) {
  // Where the show is, where it came from, and which way it moved, so the
  // incoming game slides in from that side and the outgoing one slides away.
  const [turn, setTurn] = useState<{ at: number; from: number | null; dir: 1 | -1 }>({ at: 0, from: null, dir: 1 });
  const [held, setHeld] = useState(false);
  const calm = useReducedMotion();
  const count = slides.length;
  const at = turn.at;
  const index = at % count;

  const go = useCallback(
    (step: number) =>
      setTurn((t) => ({ at: (((t.at + step) % count) + count) % count, from: t.at, dir: step < 0 ? -1 : 1 })),
    [count],
  );
  const jump = (i: number) => {
    if (i !== at) setTurn({ at: i, from: at, dir: i < at ? -1 : 1 });
  };

  // Always moving on: a press, a swipe or a key restarts the count, and the
  // only pause is while a keyboard user is on a slide's link, which ends when
  // they move off it. (A hover pause would stop it for good: the slide fills
  // the screen, so the pointer is always over it.) Hidden tabs skip a turn.
  // Someone who asked their system for less motion moves it themselves.
  useEffect(() => {
    if (held || calm || count < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") go(1);
    }, HOLD_MS);
    return () => window.clearInterval(timer);
  }, [at, held, calm, count, go]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const touch = useRef<number | null>(null);

  return (
    <>
      <section
        className="show-slides"
        aria-roledescription="carousel"
        aria-label="The games"
        onFocus={(e) => {
          // Keyboard focus only: a click focuses too, and would hold it for good.
          if (e.target instanceof HTMLElement && e.target.matches(":focus-visible")) setHeld(true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
        }}
        onTouchStart={(e) => {
          touch.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const from = touch.current;
          const to = e.changedTouches[0]?.clientX;
          touch.current = null;
          if (from === null || to === undefined || Math.abs(to - from) < 40) return;
          go(to < from ? 1 : -1);
        }}
      >
        {slides.map((game, i) => (
          <Slide
            key={`${game.kind}:${game.slug}`}
            game={game}
            current={i === index}
            motion={i === index && turn.from !== null ? (turn.dir > 0 ? "in-next" : "in-prev") : i === turn.from ? (turn.dir > 0 ? "out-next" : "out-prev") : undefined}
            position={`${i + 1} of ${count}`}
          />
        ))}
      </section>
      <Footer marks={slides[index] ? <GameChips key={`${slides[index].kind}:${slides[index].slug}`} game={slides[index]} /> : null}>
        {count > 1 ? (
          <div className="show-dots" role="group" aria-label="Choose a game">
            {slides.map((game, i) => (
              <button
                key={`${game.kind}:${game.slug}`}
                type="button"
                aria-label={game.name}
                aria-current={i === index ? "true" : undefined}
                onClick={() => jump(i)}
              >
                {i === index && !held && !calm ? <span key={at} className="fill" style={{ animationDuration: `${HOLD_MS}ms` }} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </Footer>
    </>
  );
}

/**
 * A game's own page for someone signed out: its slide from the slideshow,
 * standing still. No details beyond what the game is, and the way in at the
 * bottom (taking a seat, when it is signing up).
 */
export function StillSlide({ game, action }: { game: GameSummary; action?: ReactNode }) {
  useNoScroll();
  return (
    <div className="show">
      <Top about />
      <section className="show-slides">
        <Slide game={game} current still position="" />
      </section>
      <Footer action={action} hint={false} marks={<GameChips game={game} />} />
    </div>
  );
}

type Motion = "in-next" | "in-prev" | "out-next" | "out-prev";

function Slide({
  game,
  current,
  position,
  still = false,
  motion,
}: {
  game: GameSummary;
  current: boolean;
  position: string;
  still?: boolean;
  /** How this slide is moving: coming in, or going out, and from which side. */
  motion?: Motion | undefined;
}) {
  return (
    <article
      className="show-slide"
      aria-roledescription={still ? undefined : "slide"}
      aria-label={still ? game.name : `${game.name}, ${position}`}
      aria-hidden={current ? undefined : true}
      data-current={current ? "" : undefined}
      data-still={still ? "" : undefined}
      data-motion={motion}
      inert={current ? undefined : true}
    >
      {game.imageUrl ? (
        <div className="show-art" style={{ backgroundImage: `url("${encodeURI(game.imageUrl)}")` }} />
      ) : (
        <img className="show-mark" src="/mark.svg" alt="" aria-hidden="true" />
      )}
      {/* Over a picture the words sit on a soft frosted card, so bright art can't wash them out. */}
      <div className={game.imageUrl ? "show-slide-words words-card" : "show-slide-words"}>
        <h1>{still || game.state === "CONCLUDED" ? game.name : <GameLink game={game}>{game.name}</GameLink>}</h1>
        {game.tagline ? <p className="show-tagline">{game.tagline}</p> : null}
        {game.pitch ? (
          <div className="show-pitch">
            <Markdown source={game.pitch} />
          </div>
        ) : null}
        {still ? null : (
        <div className="row" style={{ gap: "8px 18px", fontSize: 14 }}>
          {game.next ? (
            <span className="num">
              Next game {inDays(game.next)}, {stamp(game.next)}
            </span>
          ) : null}
          {game.open ? <span className="pill accent">Signing up</span> : null}
        </div>
        )}
      </div>
    </article>
  );
}

function GameLink({ game, children }: { game: GameSummary; children: ReactNode }) {
  // Signed out, a game day's page shows its slide: the only part of it that is public.
  return game.kind === "day" ? (
    <Link to="/table/$kind/$id" params={{ kind: "game-day", id: game.slug }}>
      {children}
    </Link>
  ) : (
    <Link to="/games/$slug" params={{ slug: game.slug }}>
      {children}
    </Link>
  );
}

/**
 * A game's chips, the same on its slide and on its own page signed out: what
 * kind of game, its system, who runs it, and its theme (played only on a press).
 */
function GameChips({ game }: { game: GameSummary }) {
  return <GameMarks kind={kindWord(game.kind)} system={game.label} lead={leadChip(game)} soundUrl={game.soundUrl} />;
}

/** The bottom of the slideshow and of a game's own page: the dots on the left, the game's chips just above the way in. */
function Footer({ children, action, hint = true, marks }: { children?: ReactNode; action?: ReactNode; hint?: boolean; marks?: ReactNode }) {
  // Signed in, the slideshow is at /slideshow, and the way out is back to Kith.
  const signedIn = useMe().data?.signedIn === true;
  if (signedIn && !action) {
    action = (
      <Link to="/" className="btn">
        Back to Kith
      </Link>
    );
    hint = false;
  }
  return (
    <footer className="show-bottom">
      {children ?? <span />}
      <div className="show-way-in">
        {marks}
        <div className="row" style={{ gap: 12 }}>
          {hint ? <span className="muted show-hint">Playing in one of these?</span> : null}
          {action ?? (
            <a className="btn primary" href={signInHref()}>
              Sign in with Discord
            </a>
          )}
        </div>
      </div>
    </footer>
  );
}

/** The landing is one screen: the page under it must not scroll while it is up. */
function useNoScroll() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("no-scroll");
    return () => root.classList.remove("no-scroll");
  }, []);
}

const REDUCE = "(prefers-reduced-motion: reduce)";

function useReducedMotion(): boolean {
  const [calm, setCalm] = useState(() => window.matchMedia(REDUCE).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCE);
    const update = () => setCalm(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return calm;
}
