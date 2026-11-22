import { useState, type FormEvent } from "react";
import { useListingEdit, type Listing, type Visibility } from "../api.ts";

/** What organisers see under a splash page: the listing's words, links and who may see it. */
export function ListingEditor({ listing }: { listing: Listing }) {
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
        <span>Organisers · the listing</span>
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
            <label htmlFor="le-sound">Sound URL (https, mp3 or ogg)</label>
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
