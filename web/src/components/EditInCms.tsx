/**
 * Where an organiser edits the words on a page: kith-cms, Kith's EmDash
 * (docs/CMS.md). The site shows them; it no longer edits them.
 */
export const CMS_ADMIN = "https://admin.kith.town/_emdash/admin";

export function EditInCms({ collection, children }: { collection: "games" | "characters" | "pages" | "links" | "sections"; children: string }) {
  return (
    <p className="panel-body" style={{ fontSize: 13 }}>
      <a href={`${CMS_ADMIN}/content/${collection}`} target="_blank" rel="noopener noreferrer">
        {children} ↗
      </a>
    </p>
  );
}
