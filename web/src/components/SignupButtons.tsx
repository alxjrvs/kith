import { useMe, useSignup, type Listing } from "../api.ts";
import { signInHref } from "../signin.ts";

const MINE: Record<NonNullable<Listing["mine"]>, string> = {
  in: "You're in",
  waitlisted: "You're on the waitlist",
  interested: "You're interested",
};

/**
 * The one control for joining a table, used on cards and on the splash page.
 * Signed out, the same "I Want To Play" is the sign-in button, and sign-in
 * brings you back here.
 *
 * Every signup is In or Interested. To change one, you un-sign up and sign up
 * again. Somebody who isn't in the Kith server yet still signs up: their place
 * is held until they're let in, and then this shows their invite.
 */
export function SignupButtons({ listing, big = false }: { listing: Listing; big?: boolean }) {
  const me = useMe().data;
  const signup = useSignup(listing);
  const size = big ? " big" : "";
  const full = listing.capacity !== null && listing.taken >= listing.capacity;

  if (!listing.open) return <span className="pill">Not taking signups</span>;

  if (!me?.signedIn) {
    const here = `/join/${listing.kind}/${listing.id}`;
    return (
      <a className={`btn primary${size}`} href={signInHref(here)}>
        {full ? "I Want To Play (join the waitlist)" : "I Want To Play"}
      </a>
    );
  }

  const error = signup.error ? <p className="notice error">{signup.error.message}</p> : null;
  const invite = me.server === "approved" && me.invite ? (
    <a className={`btn primary${size}`} href={me.invite} target="_blank" rel="noopener">
      Join the Kith Discord server
    </a>
  ) : null;

  if (listing.mine) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <span className="pill in">{MINE[listing.mine]}</span>
          <button type="button" className={`btn${size}`} disabled={signup.isPending} onClick={() => signup.mutate("out")}>
            Un-sign up
          </button>
        </div>
        {listing.held ? (
          <p className="muted">Your spot is saved. You'll be signed up once you're let into the Kith Discord server.</p>
        ) : null}
        {invite ? (
          <>
            <p className="muted">You've been let in. Join the server to find the game's channel.</p>
            {invite}
          </>
        ) : null}
        {error}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button
          type="button"
          className={`btn primary${size}`}
          disabled={signup.isPending}
          onClick={() => signup.mutate("in")}
        >
          {full ? "I Want To Play (join the waitlist)" : "I Want To Play"}
        </button>
        <button type="button" className={`btn${size}`} disabled={signup.isPending} onClick={() => signup.mutate("interested")}>
          Interested
        </button>
      </div>
      {invite}
      {error}
    </div>
  );
}
