import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useHomes, type GameSummary } from "../api.ts";
import { inDays, stamp } from "../format.ts";
import { signInHref } from "../signin.ts";

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
      <Top />
      {homes.isPending ? null : slides.length === 0 ? <Empty /> : <Slides slides={slides} />}
    </div>
  );
}

function Top() {
  return (
    <header className="show-top">
      <Link to="/" className="wordmark" style={{ fontSize: 26 }}>
        <img src="/mark.svg" alt="" width="26" height="26" />
        Kith.town
      </Link>
    </header>
  );
}

/** With no games anyone may see, the Kith mark holds the room. */
function Empty() {
  return (
    <>
      <img className="show-mark" src="/mark.svg" alt="" aria-hidden="true" />
      <div className="show-slide-words" style={{ position: "relative" }}>
        <h1>Every game we run, in one place.</h1>
        <p className="show-tagline">Most tables show only to the people on them.</p>
      </div>
      <Footer />
    </>
  );
}

function Slides({ slides }: { slides: GameSummary[] }) {
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const calm = useReducedMotion();
  const count = slides.length;
  const index = at % count;

  const go = useCallback((step: number) => setAt((i) => (((i + step) % count) + count) % count), [count]);

  // Turn on a timer, unless someone is reading (pointer or focus on a slide),
  // the tab is hidden, or they asked the system for less motion.
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
        onPointerEnter={(e) => e.pointerType === "mouse" && setHeld(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHeld(false)}
        onFocus={() => setHeld(true)}
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
          <Slide key={`${game.kind}:${game.slug}`} game={game} current={i === index} position={`${i + 1} of ${count}`} />
        ))}
      </section>
      <Footer>
        {count > 1 ? (
          <div className="show-dots" role="group" aria-label="Choose a game">
            {slides.map((game, i) => (
              <button
                key={`${game.kind}:${game.slug}`}
                type="button"
                aria-label={game.name}
                aria-current={i === index ? "true" : undefined}
                onClick={() => setAt(i)}
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
      <Top />
      <section className="show-slides">
        <Slide game={game} current still position="" />
      </section>
      <Footer action={action} hint={false} />
    </div>
  );
}

function Slide({ game, current, position, still = false }: { game: GameSummary; current: boolean; position: string; still?: boolean }) {
  return (
    <article
      className="show-slide"
      aria-roledescription={still ? undefined : "slide"}
      aria-label={still ? game.name : `${game.name}, ${position}`}
      aria-hidden={current ? undefined : true}
      data-current={current ? "" : undefined}
      data-still={still ? "" : undefined}
      inert={current ? undefined : true}
    >
      {game.imageUrl ? (
        <div className="show-art" style={{ backgroundImage: `url("${encodeURI(game.imageUrl)}")` }} />
      ) : (
        <img className="show-mark" src="/mark.svg" alt="" aria-hidden="true" />
      )}
      <div className="show-slide-words">
        {game.label ? <span className="chip system show-system">{game.label}</span> : null}
        <h1>{still || game.state === "CONCLUDED" ? game.name : <GameLink game={game}>{game.name}</GameLink>}</h1>
        {game.tagline ? <p className="show-tagline">{game.tagline}</p> : null}
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
  // Signed out, a game day's page is its splash: the only page of it that is public.
  return game.kind === "day" ? (
    <Link to="/join/$kind/$id" params={{ kind: "game-day", id: game.slug }}>
      {children}
    </Link>
  ) : (
    <Link to="/games/$slug" params={{ slug: game.slug }}>
      {children}
    </Link>
  );
}

function Footer({ children, action, hint = true }: { children?: ReactNode; action?: ReactNode; hint?: boolean }) {
  return (
    <footer className="show-bottom">
      {children ?? <span />}
      <div className="row" style={{ gap: 12 }}>
        {hint ? <span className="muted show-hint">Playing in one of these?</span> : null}
        {action ?? (
          <a className="btn primary" href={signInHref()}>
            Sign in with Discord
          </a>
        )}
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
