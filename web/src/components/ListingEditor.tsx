import { useState, type FormEvent } from "react";
import { useListingEdit, type Listing, type Visibility } from "../api.ts";
import { EditInCms } from "./EditInCms.tsx";

/**
 * What organisers see at the foot of a game's page. A campaign's words are written in
 * kith-cms (docs/CMS.md), so for a campaign this sets only who may see it; a
 * game day's words are still edited here.
 */
export function ListingEditor({ listing }: { listing: Listing }) {
  return listing.kind === "campaign" ? <VisibilityEditor listing={listing} /> : <DayListingEditor listing={listing} />;
}

function VisibilityEditor({ listing }: { listing: Listing }) {
  const edit = useListingEdit(listing);
  const [visibility, setVisibility] = useState<Visibility>(listing.visibility);
  return (
    <form
      className="panel"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        edit.mutate({ visibility });
      }}
    >
      <div className="panel-head label">
        <span>For organisers</span>
        <span>{edit.isSuccess ? "Saved" : ""}</span>
      </div>
      <div className="panel-body">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label htmlFor="le-visibility">Who can see it</label>
            <select id="le-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
              <option value="public">Anyone (shown on the games hub)</option>
              <option value="members">The people on it</option>
              <option value="organisers">Organisers only</option>
            </select>
          </div>
          <button type="submit" className="btn primary" disabled={edit.isPending}>
            Save
          </button>
        </div>
        {edit.error ? <p className="notice error">{edit.error.message}</p> : null}
      </div>
      <EditInCms collection="games">Edit the tagline, pitch, hero and sound in the CMS</EditInCms>
    </form>
  );
}

function DayListingEditor({ listing }: { listing: Listing }) {
  const edit = useListingEdit(listing);
  const [visibility, setVisibility] = useState<Visibility>(listing.visibility);
  const [tagline, setTagline] = useState(listing.tagline ?? "");
  const [pitch, setPitch] = useState(listing.pitch ?? "");
  const [heroUrl, setHeroUrl] = useState(listing.heroUrl ?? "");
  const [soundUrl, setSoundUrl] = useState(listing.soundUrl ?? "");

  const save = (event: FormEvent) => {
    event.preventDefault();
    edit.mutate({ visibility, tagline, pitch, heroUrl, soundUrl });
  };

  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-head label">
        <span>The listing</span>
        <span>{edit.isSuccess ? "Saved" : ""}</span>
      </div>
      <div className="panel-body">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label htmlFor="le-visibility">Who can see it</label>
            <select id="le-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
              <option value="public">Anyone (shown on the games hub)</option>
              <option value="members">The people on it</option>
              <option value="organisers">Organisers only</option>
            </select>
          </div>
          <div className="field" style={{ flex: "2 1 320px" }}>
            <label htmlFor="le-tagline">Tagline</label>
            <input id="le-tagline" maxLength={140} value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="le-pitch">Pitch: what it is about, the tone, who it suits</label>
          <textarea id="le-pitch" maxLength={2000} value={pitch} onChange={(e) => setPitch(e.target.value)} />
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field">
            <label htmlFor="le-hero">Hero image URL (https)</label>
            <input id="le-hero" type="url" value={heroUrl} onChange={(e) => setHeroUrl(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="le-sound">Sound URL (https: an mp3 or ogg, a SoundCloud track or a YouTube video, with #t=0:09 to start partway)</label>
            <input id="le-sound" type="url" value={soundUrl} onChange={(e) => setSoundUrl(e.target.value)} />
          </div>
        </div>
        {edit.error ? <p className="notice error">{edit.error.message}</p> : null}
        <div className="row">
          <button type="submit" className="btn primary" disabled={edit.isPending}>
            Save the listing
          </button>
        </div>
      </div>
    </form>
  );
}
