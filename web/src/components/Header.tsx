import { Link } from "@tanstack/react-router";
import { useMe } from "../api.ts";
import { initials } from "../format.ts";
import { signInHref } from "../signin.ts";

/**
 * The one site header. Every signed-in page wears this same header, with the
 * same links in the same places, so moving around Kith never changes the top
 * of the screen. The organiser console copies its markup and look by hand
 * (public/console/index.html), since that page has no build step.
 *
 * `over` is for a page whose top is a hero image (a home base, a splash, the
 * slideshow): the header floats above the picture as text only, with no bar
 * behind it. Same words, same sizes, only the background goes.
 */
export function Header({ over = false }: { over?: boolean }) {
  const me = useMe().data;
  return (
    <header className={over ? "site-header over" : "site-header"}>
      <Link to="/" className="wordmark">
        <img src="/mark.svg" alt="" width="22" height="22" />
        Kith.town
      </Link>
      {/* Signed out, there is no app to get around: only the front page and the game pages. */}
      {me?.signedIn ? (
        <nav aria-label="Main" className="site-nav">
          <Link to="/games" activeProps={{ "aria-current": "page" }}>
            Games
          </Link>
          <Link to="/agenda" activeProps={{ "aria-current": "page" }}>
            Agenda
          </Link>
          <Link to="/coc" activeProps={{ "aria-current": "page" }}>
            Rules
          </Link>
          <Link to="/slideshow" activeProps={{ "aria-current": "page" }}>
            Slideshow
          </Link>
          {me.organiser ? <a href="/console">Organise</a> : null}
        </nav>
      ) : (
        <span />
      )}
      {me?.signedIn ? (
        <Link to="/profile" className="avatar" aria-label={`Your profile, ${me.user.name}`}>
          {me.user.avatarUrl ? <img src={me.user.avatarUrl} alt="" /> : initials(me.user.name)}
        </Link>
      ) : me ? (
        <a className="btn primary" href={signInHref()}>
          Sign in with Discord
        </a>
      ) : null}
    </header>
  );
}
