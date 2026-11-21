import { useMe, useSignup, type Listing } from "../api.ts";
import { signInHref } from "../signin.ts";

/**
 * The one control for joining a table, used on cards and on the splash page.
 * Signed out, it is the sign-in button, and sign-in brings you back here.
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
        {big ? `Sign in with Discord to ${full ? "join the waitlist" : "take a seat"}` : full ? "Join the waitlist" : "Take a seat"}
      </a>
    );
  }

  const error = signup.error ? <p className="notice error">{signup.error.message}</p> : null;

  if (listing.mine) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <span className="pill in">{listing.mine === "in" ? "You have a seat" : "You are on the waitlist"}</span>
          <button type="button" className={`btn${size}`} disabled={signup.isPending} onClick={() => signup.mutate("out")}>
            Give it back
          </button>
        </div>
        {error}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <button
        type="button"
        className={`btn${full ? "" : " primary"}${size}`}
        disabled={signup.isPending}
        onClick={() => signup.mutate(full ? "waitlist" : "seat")}
      >
        {full ? "Join the waitlist" : "Take a seat"}
      </button>
      {error}
    </div>
  );
}
