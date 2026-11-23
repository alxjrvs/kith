import { useEffect, useRef, useState, type ReactNode } from "react";
import { soundCloudPlayer, soundCloudTrack, type Player } from "../soundcloud.ts";
import { youTubeVideo } from "../sound-link.ts";
import { youTubePlayer } from "../youtube.ts";

/**
 * A game's chips, in one row, the same everywhere the game is shown big: what
 * kind of game it is, its system, who runs it, and its sound. A home base sets
 * them beside "I Want To Play", a game's own page signed out sets them beside
 * its way in, and the slideshow sets them above the name. The slideshow passes
 * no sound: it never plays one. A home base adds its calendar link at the end.
 */
export function GameMarks({
  kind = null,
  system,
  lead = null,
  soundUrl = null,
  children,
}: {
  kind?: string | null;
  system: string | null;
  lead?: string | null;
  soundUrl?: string | null;
  children?: ReactNode;
}) {
  // A board game's system is "Board game" already: say it once.
  const what = kind && kind !== system ? kind : null;
  if (!what && !system && !lead && !soundUrl && !children) return null;
  return (
    <div className="game-marks">
      {what ? <span className="chip">{what}</span> : null}
      {system ? <span className="chip system">{system}</span> : null}
      {lead ? <span className="chip lead">{lead}</span> : null}
      <SoundButton url={soundUrl} />
      {children}
    </div>
  );
}

/**
 * A game's sound: it waits for the visitor to ask for it, then loops, and the
 * same button stops it. Until it has been pressed it glows faintly, so the
 * sound is easy to find without ever playing by itself.
 */
function SoundButton({ url }: { url: string | null }) {
  const player = useRef<Player | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!url) return;
    const made = linkedPlayer(url, setPlaying) ?? audioPlayer(url, setPlaying);
    player.current = made;
    return () => {
      made.destroy();
      player.current = null;
      setPlaying(false);
    };
  }, [url]);

  const toggle = () => {
    setPressed(true);
    if (playing) player.current?.pause();
    else player.current?.play();
  };

  if (!url) return null;
  return (
    <button type="button" className="btn sound" aria-pressed={playing} data-unheard={pressed ? undefined : ""} onClick={toggle}>
      {playing ? (
        <>
          <span aria-hidden="true" style={{ display: "inline-flex", gap: 3 }}>
            <span style={{ width: 4, height: 12, background: "var(--in)" }} />
            <span style={{ width: 4, height: 12, background: "var(--in)" }} />
          </span>
          Mute
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            style={{ width: 0, height: 0, borderLeft: "10px solid var(--text)", borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }}
          />
          Hear the theme
        </>
      )}
    </button>
  );
}

/** A SoundCloud track or a YouTube video, played through its own hidden player. */
function linkedPlayer(url: string, onPlaying: (playing: boolean) => void): Player | null {
  const track = soundCloudTrack(url);
  if (track) return soundCloudPlayer(track, onPlaying);
  const video = youTubeVideo(url);
  if (video) return youTubePlayer(video, onPlaying);
  return null;
}

/** An uploaded file (or any audio URL), looping. */
function audioPlayer(url: string, onPlaying: (playing: boolean) => void): Player {
  const element = new Audio(url);
  element.loop = true;
  element.preload = "none";
  element.addEventListener("pause", () => onPlaying(false));
  element.addEventListener("play", () => onPlaying(true));
  return {
    play() {
      if (element.paused) void element.play().catch(() => onPlaying(false));
    },
    pause() {
      element.pause();
    },
    destroy() {
      element.pause();
    },
  };
}
