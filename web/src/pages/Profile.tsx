import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, useMe } from "../api.ts";
import { initials } from "../format.ts";
import { signInHref } from "../signin.ts";

export function Profile() {
  const me = useMe();
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => api<{ said: string }>("/console/me/delete", { method: "POST" }),
    onSuccess: () => void client.invalidateQueries(),
  });

  if (me.isPending) return <main className="page" aria-busy="true" />;
  if (!me.data?.signedIn) {
    return (
      <main className="page">
        <h1>Your profile</h1>
        {remove.data ? <p className="notice">{remove.data.said}</p> : null}
        <p className="muted">Sign in to see your games and what Kith keeps about you.</p>
        <div className="row">
          <a className="btn primary" href={signInHref()}>
            Sign in with Discord
          </a>
        </div>
      </main>
    );
  }

  const user = me.data.user;
  return (
    <main className="page">
      <div className="row" style={{ gap: 16 }}>
        <span className="avatar" style={{ width: 64, height: 64, fontSize: 18 }}>
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
        </span>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 28 }}>{user.name}</h1>
          <span className="label">Signed in with Discord as {me.data.organiser ? "an organiser" : "a player"}</span>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel-head label">You and Kith</h2>
        <div className="panel-body">
          <p className="muted">
            Kith keeps your Discord id, name and avatar, your answers and seats, and your feed token.{" "}
            <a href="/privacy">What Kith knows about you</a>
          </p>
          <div className="row">
            <form method="post" action="/console/logout">
              <button type="submit" className="btn">
                Sign out
              </button>
            </form>
            {confirming ? (
              <>
                <button type="button" className="btn" style={{ borderColor: "var(--out)" }} disabled={remove.isPending} onClick={() => remove.mutate()}>
                  Yes, delete everything Kith holds about me
                </button>
                <button type="button" className="btn" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirming(true)}>
                Delete my data
              </button>
            )}
          </div>
          {remove.error ? <p className="notice error">{remove.error.message}</p> : null}
        </div>
      </section>
    </main>
  );
}
