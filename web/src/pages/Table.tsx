import { useState, type FormEvent } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useTable, useTableEdits, type Table as TableData, type Visibility } from "../api.ts";
import { SeatSquares, seatLine } from "../components/Squares.tsx";
import { SignupButtons } from "../components/SignupButtons.tsx";
import { cadence } from "../format.ts";

const VIS_LABEL: Record<Visibility, string> = { public: "Anyone", members: "Table", organisers: "Organisers" };

/** One table's home: what it is, where its links go, and what it knows. */
export function Table() {
  const { kind, id } = useParams({ from: "/shell/table/$kind/$id" });
  const table = useTable(kind, id);

  if (table.isPending) return <main className="page" aria-busy="true" />;
  if (table.isError) {
    return (
      <main className="page">
        <h1>Nothing here</h1>
        <p className="muted">{table.error.message}</p>
      </main>
    );
  }

  const { listing, links, pages, canEdit, member } = table.data;
  return (
    <main className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">
            {listing.kind === "campaign" ? "Campaign" : "Game day"} · {listing.state.toLowerCase()}
            {listing.game ? ` · ${listing.game.name}` : ""}
          </span>
          <h1>{listing.name}</h1>
          {listing.tagline ? <p className="muted">{listing.tagline}</p> : null}
        </div>
        <div className="row">
          <Link to="/join/$kind/$id" params={{ kind, id }} className="btn">
            Splash page
          </Link>
          {listing.open ? <SignupButtons listing={listing} /> : null}
        </div>
      </div>

      <div className="split">
        <div className="main">
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
                  <Link to="/table/$kind/$id/$slug" params={{ kind, id, slug: page.slug }}>
                    {page.title}
                  </Link>
                  <span className="pill">{VIS_LABEL[page.visibility]}</span>
                </div>
              ))
            )}
            {canEdit ? <NewPage kind={kind} id={id} /> : null}
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
        </div>
        <aside>
          <section className="panel">
            <h2 className="panel-head label">Links · {links.length}</h2>
            {links.length === 0 ? <p className="panel-body muted">No links yet.</p> : null}
            {links.map((link) => (
              <LinkRow key={link.id} link={link} canEdit={canEdit} kind={kind} id={id} />
            ))}
            {canEdit ? <NewLink kind={kind} id={id} /> : null}
          </section>
          <section className="panel">
            <h2 className="panel-head label">The table</h2>
            <div className="panel-body">
              {cadence(listing).length > 0 ? <span className="mono" style={{ fontSize: 12 }}>{cadence(listing).join(" · ").toUpperCase()}</span> : null}
              {listing.lead ? (
                <span className="muted">
                  {listing.kind === "campaign" ? "GM" : "Host"} {listing.lead.name}
                </span>
              ) : null}
              <div className="row">
                <SeatSquares capacity={listing.capacity} taken={listing.taken} />
                <span className="mono" style={{ fontSize: 13 }}>
                  {seatLine(listing)}
                </span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function LinkRow({ link, canEdit, kind, id }: { link: TableData["links"][number]; canEdit: boolean; kind: string; id: string }) {
  const edits = useTableEdits(kind, id);
  return (
    <div className="link-row">
      <span className="label" style={{ width: 64 }}>
        {link.kind}
      </span>
      <a href={link.url} target="_blank" rel="noopener noreferrer" style={{ flex: "1 1 120px" }}>
        {link.label}
      </a>
      {canEdit ? (
        <>
          <span className="pill">{VIS_LABEL[link.visibility]}</span>
          <button type="button" className="btn" style={{ minHeight: 32, padding: "0 10px" }} onClick={() => edits.removeLink.mutate(link.id)}>
            Remove
          </button>
        </>
      ) : null}
    </div>
  );
}

function NewLink({ kind, id }: { kind: string; id: string }) {
  const edits = useTableEdits(kind, id);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [linkKind, setLinkKind] = useState("other");
  const [visibility, setVisibility] = useState<Visibility>("members");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    edits.addLink.mutate(
      { label, url, kind: linkKind, visibility },
      {
        onSuccess: () => {
          setLabel("");
          setUrl("");
        },
      },
    );
  };
  return (
    <form className="panel-body" onSubmit={submit} style={{ borderTop: "1px solid var(--border)" }}>
      <span className="label">Add a link</span>
      <div className="field">
        <label htmlFor="nl-label">Label</label>
        <input id="nl-label" required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="nl-url">URL (https)</label>
        <input id="nl-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="nl-kind">Kind</label>
          <select id="nl-kind" value={linkKind} onChange={(e) => setLinkKind(e.target.value)}>
            <option value="vtt">VTT</option>
            <option value="sheet">Character sheet</option>
            <option value="rules">Rules</option>
            <option value="doc">Doc</option>
            <option value="discord">Discord</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="nl-vis">Who sees it</label>
          <select id="nl-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="members">The table</option>
            <option value="public">Anyone</option>
            <option value="organisers">Organisers</option>
          </select>
        </div>
      </div>
      {edits.addLink.error ? <p className="notice error">{edits.addLink.error.message}</p> : null}
      <button type="submit" className="btn primary" disabled={edits.addLink.isPending}>
        Add the link
      </button>
    </form>
  );
}

function NewPage({ kind, id }: { kind: string; id: string }) {
  const [title, setTitle] = useState("");
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return (
    <div className="panel-body row" style={{ borderTop: "1px solid var(--border)", alignItems: "flex-end" }}>
      <div className="field">
        <label htmlFor="np-title">New page title</label>
        <input id="np-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="House rules" />
      </div>
      {slug ? (
        <Link to="/table/$kind/$id/$slug" params={{ kind, id, slug }} search={{ title }} className="btn primary">
          Write it
        </Link>
      ) : null}
    </div>
  );
}
