import { Link } from "@tanstack/react-router";
import { signInHref } from "../signin.ts";

export function Header() {
  return (
    <header className="site-header">
      <Link to="/" className="wordmark">
        ORREY
      </Link>
      <nav aria-label="Main" className="site-nav" />
      <a className="btn primary" href={signInHref()}>
        Sign in with Discord
      </a>
    </header>
  );
}
