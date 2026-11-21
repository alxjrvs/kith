import { signInHref } from "../signin.ts";

export function Home() {
  return (
    <main className="page">
      <section className="row" style={{ alignItems: "stretch", gap: 24 }}>
        <div className="stack" style={{ flex: "1 1 440px", justifyContent: "center", gap: 14 }}>
          <span className="label">The Orrey of Worlds</span>
          <h1 style={{ fontSize: 40, lineHeight: 1.08, letterSpacing: "-0.02em" }}>
            Every game we run, in one place.
          </h1>
          <p className="muted" style={{ fontSize: 15, maxWidth: "50ch" }}>
            Campaigns, game days, dates, links and what each table knows. Find a seat, or see when
            your games run.
          </p>
          <div className="row">
            <a className="btn primary" href={signInHref()}>
              Sign in with Discord
            </a>
          </div>
          <p className="muted" style={{ fontSize: 13, maxWidth: "56ch" }}>
            Discord is how Orrey knows who you are. It asks Discord for your name and nothing else,
            and it has no password of its own. <a href="/privacy">What the Orrey knows about you</a>
          </p>
        </div>
      </section>
    </main>
  );
}
