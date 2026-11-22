import { useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useCancelSession, useHome, useMe, type BoardHome, type CampaignHome, type AgendaRow as Row, type Seat } from "../api.ts";
import { AgendaRow } from "../components/AgendaRow.tsx";
import { CatalogEditor } from "../components/CatalogEditor.tsx";
import { SeatSquares, seatLine } from "../components/Squares.tsx";
import { SignupButtons } from "../components/SignupButtons.tsx";
import { ToPage } from "../components/To.tsx";
import { cadence, inDays, stamp } from "../format.ts";
import { LinkRow, NewLink, NewPage, VIS_LABEL } from "./Table.tsx";
import { SoundButton, TableMotif } from "./Splash.tsx";
import { Header } from "../components/Header.tsx";
import { signInHref } from "../signin.ts";

const STATE_EYEBROW: Record<string, string> = {
  FORMING: "New campaign",
  RUNNING: "Campaign",
  HIATUS: "Campaign on hiatus",
  CONCLUDED: "Concluded campaign",
};

/** A game's home base: `/games/<slug>`, a campaign or a board game. */
export function GameHome() {
  const { slug } = useParams({ from: "/games/$slug" });
  const home = useHome(slug);

  if (home.isPending) return <div className="splash base" aria-busy="true" />;
  if (home.isError) {
    return (
      <>
        <Header />
        <main className="page">
          <h1>Nothing here</h1>
          <p className="muted">
            {home.error.message} <Link to="/games">See every game</Link>
          </p>
        </main>
      </>
    );
  }
  const data = home.data.home;
  return data.kind === "campaign" ? <CampaignBase home={data} /> : <BoardBase home={data} />;
}

/**
 * The top of a home base, in the splash page's clothes: the hero image behind,
 * the round table, a big title. A home base is the game's own front door, so it
 * reads like one rather than like a settings page.
 */
function BaseHero({
  eyebrow,
  title,
  tagline,
  heroUrl,
  soundUrl,
  chips,
  children,
}: {
  eyebrow: string;
  title: string;
  tagline: string | null;
  heroUrl: string | null;
  soundUrl: string | null;
  chips: string[];
  children?: ReactNode;
}) {
  const me = useMe().data;
  return (
    <div className="splash base">
      {heroUrl ? <div className="hero" style={{ backgroundImage: `url("${encodeURI(heroUrl)}")` }} /> : null}
      <TableMotif />
      <header>
        <div className="row" style={{ gap: 24 }}>
          <Link to="/" className="wordmark" style={{ fontSize: 26 }}>
            <img src="/mark.svg" alt="" width="26" height="26" />
            kith
          </Link>
          <nav aria-label="Main" className="site-nav">
            <Link to="/games">Games</Link>
            <Link to="/agenda">Agenda</Link>
          </nav>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <SoundButton url={soundUrl} />
          {me && !me.signedIn ? (
            <a className="btn" href={signInHref()}>
              Sign in
            </a>
          ) : null}
        </div>
      </header>
      <main>
        <span className="label">{eyebrow}</span>
        <h1>{title}</h1>
        {tagline ? <p className="tagline">{tagline}</p> : null}
        {chips.length > 0 ? (
          <div className="row" style={{ gap: 6 }}>
            {chips.map((chip) => (
              <span key={chip} className="chip">
                {chip}
              </span>
            ))}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}

/** The next session, big, where the eye lands first. */
function NextUp({ row }: { row: Row }) {
  return (
    <div className="next-up">
      <span className="label">Next up · {inDays(row.startsAt)}</span>
      <span className="mono next-stamp">{stamp(row.startsAt)}</span>
      <div className="panel" style={{ marginTop: 4 }}>
        <AgendaRow row={row} tally={false} simple={row.quorum.rule === "unanimous"} />
      </div>
    </div>
  );
}

function CampaignBase({ home }: { home: CampaignHome }) {
  const { listing, roster, upcoming, links, pages, canEdit, member } = home;
  const kind = "campaign";
  const id = listing.id;
  const days = new Map<string, Row[]>();
  for (const row of upcoming) days.set(row.day, [...(days.get(row.day) ?? []), row]);

  return (
    <>
      <BaseHero
        eyebrow={[STATE_EYEBROW[listing.state] ?? "Campaign", listing.game?.name, listing.lead ? `GM ${listing.lead.name}` : null]
          .filter(Boolean)
          .join(" · ")}
        title={listing.name}
        tagline={listing.tagline}
        heroUrl={listing.heroUrl}
        soundUrl={listing.soundUrl}
        chips={[...cadence(listing), listing.where === "voice" ? "Voice" : listing.where].filter((c): c is string => Boolean(c))}
      >
        {upcoming[0] ? <NextUp row={upcoming[0]} /> : null}
        <div className="row" style={{ gap: "16px 24px" }}>
          {listing.open ? <SignupButtons listing={listing} big /> : null}
          <CalendarLink url={home.calendarUrl} />
          {listing.open || canEdit ? (
            <Link to="/join/$kind/$id" params={{ kind, id }}>
              Splash page
            </Link>
          ) : null}
        </div>
      </BaseHero>
    <main className="page">

      <div className="split">
        <div className="main">
          <section className="panel">
            <h2 className="panel-head label">
              <span>Coming up · {upcoming.length}</span>
              <Link to="/agenda" style={{ fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
                Full agenda
              </Link>
            </h2>
            {upcoming.length === 0 ? (
              <p className="panel-body muted">
                {listing.state === "FORMING" ? "Sessions go on the calendar once the table is set." : "Nothing on the calendar yet."}
              </p>
            ) : (
              [...days.entries()].map(([day, list]) => (
                <div key={day}>
                  <div className="label" style={{ padding: "10px 16px 0" }}>
                    {list[0]!.dayLabel} · {inDays(list[0]!.startsAt)}
                  </div>
                  {list.map((row) => (
                    <div key={row.sessionId}>
                      <AgendaRow row={row} tally={false} simple={row.quorum.rule === "unanimous"} />
                      {canEdit ? <CancelSession row={row} /> : null}
                    </div>
                  ))}
                </div>
              ))
            )}
          </section>


          {listing.pitch ? (
            <section className="stack">
              <h2 className="label" style={{ fontSize: 12 }}>
                The pitch
              </h2>
              <p className="prose" style={{ whiteSpace: "pre-line" }}>
                {listing.pitch}
              </p>
            </section>
          ) : null}

          <section className="panel">
            <h2 className="panel-head label">
              <span>Knowledge · {pages.length}</span>
            </h2>
            {pages.length === 0 ? (
              <p className="panel-body muted">
                {member || canEdit ? "No pages yet." : "Nothing public yet. The table sees more once they are on it."}
              </p>
            ) : (
              pages.map((page) => (
                <div key={page.slug} className="link-row">
                  <ToPage kind={kind} id={id} slug={page.slug}>
                    {page.title}
                  </ToPage>
                  <span className="pill">{VIS_LABEL[page.visibility]}</span>
                </div>
              ))
            )}
            {canEdit ? <NewPage kind={kind} id={id} /> : null}
          </section>
        </div>

        <aside>
          <Roster
            seats={roster}
            title={listing.state === "FORMING" ? "Signed up so far" : "Roster"}
            empty={listing.state === "FORMING" ? "Nobody has signed up yet." : "No roster yet."}
          />
          <section className="panel">
            <h2 className="panel-head label">Links · {links.length}</h2>
            {links.length === 0 ? <p className="panel-body muted">No links yet.</p> : null}
            {links.map((link) => (
              <LinkRow key={link.id} link={link} canEdit={canEdit} kind={kind} id={id} />
            ))}
            {canEdit ? <NewLink kind={kind} id={id} /> : null}
          </section>
        </aside>
      </div>
    </main>
    </>
  );
}

function BoardBase({ home }: { home: BoardHome }) {
  const { game, upcoming, played, canEdit } = home;
  const [editing, setEditing] = useState(false);
  const players =
    game.minPlayers && game.maxPlayers
      ? `${game.minPlayers} to ${game.maxPlayers} players`
      : game.maxPlayers
        ? `Up to ${game.maxPlayers} players`
        : null;
  const length = game.defaultDurationMinutes ? `About ${Math.round(game.defaultDurationMinutes / 60)} hours` : null;
  const next = upcoming[0]?.listing;

  return (
    <>
      <BaseHero
        eyebrow={["Board game", next?.lead ? `Host ${next.lead.name}` : null].filter(Boolean).join(" · ")}
        title={game.name}
        tagline={game.summary}
        heroUrl={next?.heroUrl ?? game.coverUrl}
        soundUrl={next?.soundUrl ?? null}
        chips={[players, length, played > 0 ? `Played ${played}×` : null].filter((c): c is string => Boolean(c))}
      >
        {next ? (
          <div className="next-up">
            <span className="label">Next game day · {next.when.startsAt ? inDays(next.when.startsAt) : "date to come"}</span>
            {next.when.startsAt ? <span className="mono next-stamp">{stamp(next.when.startsAt)}</span> : null}
            {next.open ? (
              <div className="row">
                <SeatSquares capacity={next.capacity} taken={next.taken} big />
                <span className="mono" style={{ fontSize: 13 }}>
                  {seatLine(next)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="row" style={{ gap: "16px 24px" }}>
          {next?.open ? <SignupButtons listing={next} big /> : null}
          <CalendarLink url={home.calendarUrl} />
          {canEdit && !editing ? (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit the game
            </button>
          ) : null}
        </div>
      </BaseHero>
    <main className="page" id="days">
      {editing ? <CatalogEditor game={game} done={() => setEditing(false)} /> : null}

      <div className="split">
        <div className="main">
          <h2 className="label" style={{ fontSize: 12 }}>
            Upcoming game days · {upcoming.length}
          </h2>
          {upcoming.length === 0 ? <p className="empty">No day on the calendar yet.</p> : null}
          {upcoming.map(({ listing, seats }) => (
            <section key={listing.id} className="panel">
              <h3 className="panel-head label">
                <span>
                  {listing.when.startsAt ? `${stamp(listing.when.startsAt)} · ${inDays(listing.when.startsAt)}` : "Date to come"}
                </span>
                <span>{listing.state.toLowerCase()}</span>
              </h3>
              <div className="panel-body">
                <Link to="/table/$kind/$id" params={{ kind: "game-day", id: listing.id }} style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>
                  {listing.name}
                </Link>
                {listing.tagline ? <p className="muted">{listing.tagline}</p> : null}
                {listing.where || listing.lead ? (
                  <span className="muted" style={{ fontSize: 13 }}>
                    {[listing.where, listing.lead ? `Host ${listing.lead.name}` : null].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
                {listing.open ? (
                  <div className="row">
                    <SeatSquares capacity={listing.capacity} taken={listing.taken} />
                    <span className="mono" style={{ fontSize: 13 }}>
                      {seatLine(listing)}
                    </span>
                  </div>
                ) : null}
                {listing.open ? <SignupButtons listing={listing} /> : null}
              </div>
              <RosterRows seats={seats} empty="No seats taken yet." characters={false} />
            </section>
          ))}
        </div>
      </div>
    </main>
    </>
  );
}

/** The roster as a table in the sidebar: Discord faces, characters, the GM lit. */
function Roster({ seats, title, empty }: { seats: Seat[]; title: string; empty: string }) {
  return (
    <section className="panel" id="roster">
      <h2 className="panel-head label">
        {title} · {seats.length}
      </h2>
      <RosterRows seats={seats} empty={empty} />
    </section>
  );
}

/** Discord's own default face, for a seat whose person is kept to the table. */
const ANONYMOUS_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

function RosterRows({ seats, empty, characters = true }: { seats: Seat[]; empty: string; characters?: boolean }) {
  if (seats.length === 0) return <p className="panel-body muted">{empty}</p>;
  return (
    <table className="roster">
      <thead className="visually-hidden">
        <tr>
          <th>Avatar</th>
          <th>Player</th>
          {characters ? <th>Character</th> : null}
        </tr>
      </thead>
      <tbody>
        {seats.map((seat, i) => (
          <tr key={`${seat.role}-${seat.person?.id ?? i}`} className={seat.role === "gm" ? "gm" : undefined}>
            <td style={{ width: 44 }}>
              <img
                className="discord-avatar"
                src={seat.person?.avatarUrl ?? ANONYMOUS_AVATAR}
                alt=""
                width="28"
                height="28"
                // A blocked CDN leaves the round placeholder, not a broken-image glyph.
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
            </td>
            <td className="roster-user">
              {seat.person?.name ?? <span className="muted">Kept to the table</span>}
              {seat.state === "waitlisted" ? <span className="muted"> · waitlist</span> : null}
            </td>
            {characters ? (
              <td className="roster-character">{seat.role === "gm" ? <span className="muted">GM</span> : (seat.character ?? <span className="muted">—</span>)}</td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Subscribe to this one game. `webcal:` hands the feed to the calendar app;
 * the copy is for Google, which wants the https URL pasted in.
 */
function CalendarLink({ url }: { url: string | null }) {
  const me = useMe().data;
  const [copied, setCopied] = useState(false);
  if (!url) {
    return me && !me.signedIn ? <a href={signInHref()}>Sign in to subscribe in your calendar</a> : null;
  }
  return (
    <span className="row" style={{ gap: 12 }}>
      <a className="btn" href={url.replace(/^https?:/, "webcal:")}>
        Subscribe in your calendar
      </a>
      <button
        type="button"
        className="btn"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy feed link"}
      </button>
    </span>
  );
}

/** Organisers only: call off one session, the same cancel the console makes. */
function CancelSession({ row }: { row: Row }) {
  const cancel = useCancelSession();
  const [asking, setAsking] = useState(false);
  if (row.state === "CANCELLED" || row.state === "PLAYED") return null;
  return (
    <div className="row" style={{ gap: 10, padding: "0 16px 12px", justifyContent: "flex-end" }}>
      {asking ? (
        <>
          <span className="muted" style={{ fontSize: 13 }}>
            Call off {stamp(row.startsAt)}? Discord and calendars are told.
          </span>
          <button
            type="button"
            className="btn"
            style={{ minHeight: 32, padding: "0 10px", borderColor: "var(--out)" }}
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(row.sessionId, { onSuccess: () => setAsking(false) })}
          >
            Yes, cancel it
          </button>
          <button type="button" className="btn" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => setAsking(false)}>
            Keep it
          </button>
        </>
      ) : (
        <button type="button" className="btn" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => setAsking(true)}>
          Cancel this session
        </button>
      )}
      {cancel.error ? <p className="notice error" style={{ flex: "1 1 100%" }}>{cancel.error.message}</p> : null}
    </div>
  );
}
