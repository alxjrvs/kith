import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, useFeeds, useMe, type FeedsPanel } from "../api.ts";
import { initials } from "../format.ts";
import { signInHref } from "../signin.ts";

export function Profile() {
  const me = useMe();
  const signedIn = me.data?.signedIn === true;
  const feeds = useFeeds(signedIn);
  const client = useQueryClient();
  const rotate = useMutation({
    mutationFn: () => api<FeedsPanel>("/console/me/feeds/rotate", { method: "POST" }),
    onSuccess: (panel) => client.setQueryData(["feeds"], panel),
  });
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
        <p className="muted">Sign in to see your games, your calendar feeds and what Orrey keeps about you.</p>
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
          <span className="label">{me.data.organiser ? "Organiser" : "Player"} · signed in with Discord</span>
        </div>
      </div>

      <section id="feeds" className="panel">
        <h2 className="panel-head label">Calendar feeds</h2>
        <div className="panel-body">
          <p className="muted">Subscribe in any calendar app. Each link is private to you.</p>
          {feeds.data?.links.map((link) => (
            <div key={link.url} className="field">
              <label htmlFor={`feed-${link.label}`}>{link.label}</label>
              <input id={`feed-${link.label}`} readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            </div>
          ))}
          {feeds.data ? <p className="muted" style={{ fontSize: 13 }}>{feeds.data.lag}</p> : null}
          {feeds.isError ? <p className="notice error">{feeds.error.message}</p> : null}
          <div className="row">
            <button type="button" className="btn" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
              Make new links (the old ones stop working)
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-head label">You and Orrey</h2>
        <div className="panel-body">
          <p className="muted">
            Orrey keeps your Discord id, name and avatar, your answers and seats, and your feed token.{" "}
            <a href="/privacy">What the Orrey knows about you</a>
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
                  Yes, delete everything Orrey holds about me
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
