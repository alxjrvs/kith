import { useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useCancelSession, useHome, useMe, type BoardHome, type CampaignHome, type GameSummary, type HomeBase, type AgendaRow as Row, type Seat } from "../api.ts";
import { AgendaRow } from "../components/AgendaRow.tsx";
import { CatalogEditor } from "../components/CatalogEditor.tsx";
import { SeatSquares, seatLine } from "../components/Squares.tsx";
import { SignupButtons } from "../components/SignupButtons.tsx";
import { ToPage } from "../components/To.tsx";
import { cadence, inDays, stamp } from "../format.ts";
import { LinkRow, VIS_LABEL } from "./Table.tsx";
import { EditInCms } from "../components/EditInCms.tsx";
import { Markdown } from "../markdown.tsx";
import { SoundButton, TableMotif } from "./Splash.tsx";
import { StillSlide } from "./Landing.tsx";
import { Header } from "../components/Header.tsx";
import { signInHref } from "../signin.ts";
import { useGameApp } from "../pwa.ts";
import { StopSign, SuggestionBox } from "../components/Safety.tsx";

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
  const me = useMe();
  const signedIn = me.data?.signedIn === true;
  useGameApp(home.data ? slug : undefined);

  // Wait for both: which page this is depends on who is looking.
  if (home.isPending || me.isPending) return <div className={signedIn ? "splash base" : "show"} aria-busy="true" />;
  if (home.isError) {
    return (
      <>
        <Header />
        <main className="page">
          <h1>Nothing here</h1>
          <p className="muted">
            {home.error.message} {signedIn ? <Link to="/games">See every game</Link> : <Link to="/">Back to the front page</Link>}
          </p>
        </main>
      </>
    );
  }
  const data = home.data.home;
  if (!signedIn) return <PublicGame home={data} />;
  return data.kind === "campaign" ? <CampaignBase home={data} /> : <BoardBase home={data} />;
}

/**
 * Signed out, a home base is the game's slide from the front page, standing
 * still: what the game is and the way in, nothing about who plays or when.
 */
function PublicGame({ home }: { home: HomeBase }) {
  const listing = home.kind === "campaign" ? home.listing : home.upcoming[0]?.listing;
  const game: GameSummary =
    home.kind === "campaign"
      ? {
          kind: "campaign",
          slug: home.slug,
          name: home.listing.name,
          state: home.listing.state,
          label: home.listing.system ?? home.listing.game?.name ?? null,
          tagline: home.listing.tagline,
          pitch: home.listing.pitch,
          imageUrl: home.listing.heroUrl ?? home.listing.logoUrl,
          logoUrl: null,
          lead: null,
          players: 0,
          capacity: null,
          next: null,
          mine: false,
          open: home.listing.open,
        }
      : {
          kind: "board",
          slug: home.slug,
          name: home.game.name,
          state: "IDLE",
          label: "Board game",
          tagline: home.game.summary,
          pitch: null,
          imageUrl: listing?.heroUrl ?? home.game.coverUrl,
          logoUrl: null,
          lead: null,
          players: 0,
          capacity: null,
          next: null,
          mine: false,
          open: listing?.open === true,
        };
  return <StillSlide game={game} action={listing?.open ? <SignupButtons listing={listing} /> : undefined} />;
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
  logoUrl = null,
  soundUrl,
  chips,
  system = null,
  children,
}: {
  eyebrow: string;
  title: string;
  tagline: string | null;
  heroUrl: string | null;
  /** The game's logo, worn above its title. */
  logoUrl?: string | null;
  soundUrl: string | null;
  chips: string[];
  /** The game system, as its own chip: people look for it first. */
  system?: string | null;
  children?: ReactNode;
}) {
  const me = useMe().data;
  return (
    <div className="splash base">
      {heroUrl ? <div className="hero" style={{ backgroundImage: `url("${encodeURI(heroUrl)}")` }} /> : null}
      {heroUrl ? null : <TableMotif />}
      <header>
        <div className="row" style={{ gap: 24 }}>
          <Link to="/" className="wordmark" style={{ fontSize: 26 }}>
            <img src="/mark.svg" alt="" width="26" height="26" />
            Kith.town
          </Link>
          <nav aria-label="Main" className="site-nav">
            <Link to="/games">Games</Link>
            <Link to="/agenda">Agenda</Link>
            <Link to="/slideshow">Slideshow</Link>
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
        {logoUrl ? <img className="base-logo" src={logoUrl} alt="" /> : null}
        <span className="label">{eyebrow}</span>
        <h1>{title}</h1>
        {tagline ? <p className="tagline">{tagline}</p> : null}
        {chips.length > 0 || system ? (
          <div className="row" style={{ gap: 6 }}>
            {system ? <span className="chip system">{system}</span> : null}
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
      <span className="label">Next up {inDays(row.startsAt)}</span>
      <span className="num next-stamp">{stamp(row.startsAt)}</span>
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
        eyebrow={`${STATE_EYEBROW[listing.state] ?? "Campaign"}${listing.lead ? ` run by ${listing.lead.name}` : ""}`}
        title={listing.name}
        tagline={listing.tagline}
        heroUrl={listing.heroUrl}
        logoUrl={listing.logoUrl}
        soundUrl={listing.soundUrl}
        system={listing.system ?? listing.game?.name ?? null}
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
              <span>Coming up</span>
              <Link to="/agenda">
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
                    {list[0]!.dayLabel}, {inDays(list[0]!.startsAt)}
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
              <h2 className="label">
                The pitch
              </h2>
              <div className="prose">
                <Markdown source={listing.pitch} />
              </div>
            </section>
          ) : null}

          <section className="panel">
            <h2 className="panel-head label">
              <span>Knowledge</span>
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
            {canEdit ? <EditInCms collection="pages">Add or edit pages in the CMS</EditInCms> : null}
          </section>
        </div>

        <aside>
          <Roster
            seats={roster}
            title={listing.state === "FORMING" ? "Signed up so far" : "Roster"}
            empty={listing.state === "FORMING" ? "Nobody has signed up yet." : "No roster yet."}
          />
          <section className="panel">
            <h2 className="panel-head label">Links</h2>
            {links.length === 0 ? <p className="panel-body muted">No links yet.</p> : null}
            {links.map((link) => (
              <LinkRow key={link.id} link={link} canEdit={canEdit} removable={!link.id.startsWith("cms:")} kind={kind} id={id} />
            ))}
            {canEdit ? <EditInCms collection="links">Add or edit links in the CMS</EditInCms> : null}
          </section>
          <SuggestionBox slug={home.slug} />
        </aside>
      </div>
    </main>
    <StopSign slug={home.slug} game={listing.name} />
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
        eyebrow={`Board game${next?.lead ? ` hosted by ${next.lead.name}` : ""}`}
        title={game.name}
        tagline={game.summary}
        heroUrl={next?.heroUrl ?? game.coverUrl}
        soundUrl={next?.soundUrl ?? null}
        chips={[players, length, played > 0 ? `Played ${played}×` : null].filter((c): c is string => Boolean(c))}
      >
        {next ? (
          <div className="next-up">
            <span className="label">{next.when.startsAt ? `Next game day ${inDays(next.when.startsAt)}` : "Next game day, date to come"}</span>
            {next.when.startsAt ? <span className="num next-stamp">{stamp(next.when.startsAt)}</span> : null}
            {next.open ? (
              <div className="row">
                <SeatSquares capacity={next.capacity} taken={next.taken} big />
                <span className="num" style={{ fontSize: 13 }}>
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
          <h2 className="label">
            Upcoming game days
          </h2>
          {upcoming.length === 0 ? <p className="empty">No day on the calendar yet.</p> : null}
          {upcoming.map(({ listing, seats }) => (
            <section key={listing.id} className="panel">
              <h3 className="panel-head label">
                <span>
                  {listing.when.startsAt ? `${stamp(listing.when.startsAt)}, ${inDays(listing.when.startsAt)}` : "Date to come"}
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
                    {[listing.where, listing.lead ? `hosted by ${listing.lead.name}` : null].filter(Boolean).join(", ")}
                  </span>
                ) : null}
                {listing.open ? (
                  <div className="row">
                    <SeatSquares capacity={listing.capacity} taken={listing.taken} />
                    <span className="num" style={{ fontSize: 13 }}>
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
        <aside>
          <SuggestionBox slug={home.slug} />
        </aside>
      </div>
    </main>
    <StopSign slug={home.slug} game={game.name} />
    </>
  );
}

/** The roster as a table in the sidebar: Discord faces, characters, the GM lit. */
function Roster({ seats, title, empty }: { seats: Seat[]; title: string; empty: string }) {
  return (
    <section className="panel" id="roster">
      <h2 className="panel-head label">
        {title}
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
              {seat.state === "waitlisted" ? <span className="muted"> (waitlist)</span> : null}
            </td>
            {characters ? (
              <td className="roster-character">
                {seat.role === "gm" ? (
                  <span className="muted">GM</span>
                ) : seat.character && seat.sheetUrl ? (
                  <a href={seat.sheetUrl} target="_blank" rel="noopener noreferrer">
                    {seat.character}
                  </a>
                ) : (
                  (seat.character ?? <span className="muted">—</span>)
                )}
              </td>
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
