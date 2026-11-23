import { useEffect, useRef, useState, type ReactNode } from "react";
import { soundCloudPlayer, soundCloudTrack, type Player } from "../soundcloud.ts";
import { youTubeVideo } from "../sound-link.ts";
import { youTubePlayer } from "../youtube.ts";

/**
 * What sits above a game's name everywhere the game is shown big: its system,
 * as a chip, and its sound. The home base, the splash, a game's own page and
 * the slideshow all wear this, so a game looks like itself wherever it is.
 * The slideshow passes no sound: it never plays one. A home base adds its
 * calendar link to the end of the row.
 */
export function GameMarks({ system, soundUrl = null, children }: { system: string | null; soundUrl?: string | null; children?: ReactNode }) {
  if (!system && !soundUrl && !children) return null;
  return (
    <div className="game-marks">
      {system ? <span className="chip system">{system}</span> : null}
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
