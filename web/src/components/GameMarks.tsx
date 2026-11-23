import { useEffect, useRef, useState } from "react";
import { soundCloudPlayer, soundCloudTrack, type Player } from "../soundcloud.ts";
import { youTubeVideo } from "../sound-link.ts";
import { youTubePlayer } from "../youtube.ts";

/**
 * What sits above a game's name everywhere the game is shown big: its system,
 * as a chip, and its sound. The home base, the splash, a game's own page and
 * the slideshow all wear this, so a game looks like itself wherever it is.
 * The slideshow passes no sound: it never plays one.
 */
export function GameMarks({ system, soundUrl = null }: { system: string | null; soundUrl?: string | null }) {
  if (!system && !soundUrl) return null;
  return (
    <div className="game-marks">
      {system ? <span className="chip system">{system}</span> : null}
      <SoundButton url={soundUrl} />
    </div>
  );
}

/** A visitor who mutes the sound keeps it muted on every game page until they close the tab. */
const MUTED_KEY = "kith-sound-muted";
function readMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMuted(muted: boolean) {
  try {
    if (muted) sessionStorage.setItem(MUTED_KEY, "1");
    else sessionStorage.removeItem(MUTED_KEY);
  } catch {
    // No storage (a private window): the choice holds for this page only.
  }
}

/**
 * A game's sound: it plays by itself and loops, and the button mutes it.
 * Browsers hold sound back until the visitor has touched the page, so when the
 * first try is refused the sound starts on their first click or key press
 * anywhere else. Shared by the splash and the home bases.
 */
function SoundButton({ url }: { url: string | null }) {
  const player = useRef<Player | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const muted = useRef(readMuted());

  useEffect(() => {
    if (!url) return;
    const made = linkedPlayer(url, setPlaying) ?? audioPlayer(url, setPlaying);
    player.current = made;
    if (!muted.current) made.play();

    const events = ["click", "keydown"] as const;
    const off = () => {
      for (const type of events) document.removeEventListener(type, kick, true);
    };
    // A press of the button itself is the button's own business: it would start the sound and then mute it.
    function kick(event: Event) {
      if (event.target instanceof Node && button.current?.contains(event.target)) return;
      off();
      if (!muted.current) made.play();
    }
    for (const type of events) document.addEventListener(type, kick, true);

    return () => {
      off();
      made.destroy();
      player.current = null;
      setPlaying(false);
    };
  }, [url]);

  const toggle = () => {
    muted.current = playing;
    writeMuted(muted.current);
    if (playing) player.current?.pause();
    else player.current?.play();
  };

  if (!url) return null;
  return (
    <button ref={button} type="button" className="btn sound" aria-pressed={playing} onClick={toggle}>
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
          Play the sound
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
