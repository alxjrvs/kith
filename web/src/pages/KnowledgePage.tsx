import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ApiError, usePage, useTable, useTableEdits, type Visibility } from "../api.ts";
import { Markdown } from "../markdown.tsx";

/** One knowledge page: read it, or, for organisers, write it. */
export function KnowledgePage() {
  const { kind, id, slug } = useParams({ from: "/shell/table/$kind/$id/$slug" });
  const search = useSearch({ from: "/shell/table/$kind/$id/$slug" });
  const table = useTable(kind, id);
  const page = usePage(kind, id, slug);
  const canEdit = table.data?.canEdit === true;
  // Only a 404 is a page that does not exist yet. Any other failure must never
  // open an empty editor over a page that is really there.
  const missing = page.error instanceof ApiError && page.error.status === 404;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (missing && canEdit) setEditing(true);
  }, [missing, canEdit]);

  const back = (
    <Link to="/table/$kind/$id" params={{ kind, id }} style={{ fontSize: 13 }}>
      Back to {table.data?.listing.name ?? "the table"}
    </Link>
  );

  if (page.isPending || table.isPending) return <main className="page" aria-busy="true" />;

  if (editing) {
    return (
      <main className="page">
        {back}
        <PageEditor
          kind={kind}
          id={id}
          slug={slug}
          initial={{
            title: page.data?.page.title ?? search.title ?? "",
            body: page.data?.page.body ?? "",
            visibility: page.data?.page.visibility ?? "members",
          }}
          done={() => setEditing(false)}
          isNew={missing}
        />
      </main>
    );
  }

  if (page.isError) {
    return (
      <main className="page">
        {back}
        <h1>Nothing here</h1>
        <p className="muted">{page.error.message}</p>
      </main>
    );
  }

  const data = page.data.page;
  return (
    <main className="page">
      {back}
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>{data.title}</h1>
          <span className="muted" style={{ fontSize: 12 }}>
            Updated {new Date(data.updatedAt * 1000).toLocaleDateString()}
            {data.updatedBy ? ` by ${data.updatedBy.name}` : ""}
          </span>
        </div>
        {canEdit ? (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      <article className="panel">
        <div className="panel-body">
          <Markdown source={data.body} />
        </div>
      </article>
    </main>
  );
}

function PageEditor({
  kind,
  id,
  slug,
  initial,
  done,
  isNew,
}: {
  kind: string;
  id: string;
  slug: string;
  initial: { title: string; body: string; visibility: Visibility };
  done: () => void;
  isNew: boolean;
}) {
  const edits = useTableEdits(kind, id);
  const navigate = useNavigate();
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility);
  const [preview, setPreview] = useState(false);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        edits.putPage.mutate({ slug, title, body, visibility }, { onSuccess: done });
      }}
    >
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: "3 1 320px" }}>
          <label htmlFor="pe-title">Title</label>
          <input id="pe-title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pe-vis">Who can read it</label>
          <select id="pe-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            <option value="members">The table</option>
            <option value="public">Anyone</option>
            <option value="organisers">Organisers</option>
          </select>
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Write or preview">
        <button type="button" className="btn" aria-pressed={!preview} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" className="btn" aria-pressed={preview} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? (
        <div className="panel">
          <div className="panel-body">
            <Markdown source={body} />
          </div>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="pe-body">Markdown: # headings, - lists, **bold**, *italic*, [links](https://…)</label>
          <textarea id="pe-body" style={{ minHeight: 360, fontFamily: "var(--font-mono)" }} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      )}
      {edits.putPage.error ? <p className="notice error">{edits.putPage.error.message}</p> : null}
      <div className="row">
        <button type="submit" className="btn primary" disabled={edits.putPage.isPending}>
          Save the page
        </button>
        {isNew ? null : (
          <>
            <button type="button" className="btn" onClick={done}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              style={{ marginLeft: "auto", borderColor: "var(--out)" }}
              onClick={() =>
                edits.removePage.mutate(slug, { onSuccess: () => void navigate({ to: "/table/$kind/$id", params: { kind, id } }) })
              }
            >
              Delete the page
            </button>
          </>
        )}
      </div>
    </form>
  );
}
