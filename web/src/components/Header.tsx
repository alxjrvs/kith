import { Link } from "@tanstack/react-router";
import { useMe } from "../api.ts";
import { initials } from "../format.ts";
import { signInHref } from "../signin.ts";

export function Header() {
  const me = useMe().data;
  return (
    <header className="site-header">
      <Link to="/" className="wordmark">
        <img src="/mark.svg" alt="" width="22" height="22" />
        Kith.town
      </Link>
      <nav aria-label="Main" className="site-nav">
        <Link to="/games" activeProps={{ "aria-current": "page" }}>
          Games
        </Link>
        <Link to="/agenda" activeProps={{ "aria-current": "page" }}>
          Agenda
        </Link>
        {me?.signedIn && me.organiser ? <a href="/console">Organise</a> : null}
      </nav>
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
