/**
 * A game's sound can be a SoundCloud track instead of an uploaded file. Kith
 * streams it through SoundCloud's own player (hidden), so the track stays on
 * SoundCloud and plays with its credit there; Kith never copies the audio.
 * https://developers.soundcloud.com/docs/api/html5-widget
 */
import { startMs } from "./sound-link.ts";

/** A SoundCloud track's address, and where to start in it (`#t=0:09`, `#t=9`, `?t=1m30s`). */
export interface SoundCloudTrack {
  url: string;
  startMs: number;
}

export function soundCloudTrack(link: string): SoundCloudTrack | null {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !/^(?:www\.|m\.)?soundcloud\.com$/.test(parsed.hostname)) return null;
  const hash = new URLSearchParams(parsed.hash.slice(1));
  const start = hash.get("t") ?? parsed.searchParams.get("t");
  parsed.hash = "";
  parsed.searchParams.delete("t");
  parsed.hostname = "soundcloud.com";
  return { url: parsed.toString(), startMs: start ? startMs(start) : 0 };
}


interface Widget {
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  bind(event: string, fn: () => void): void;
}
declare global {
  interface Window {
    SC?: { Widget: ((iframe: HTMLIFrameElement) => Widget) & { Events: Record<string, string> } };
  }
}

let api: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.SC) return Promise.resolve();
  api ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://w.soundcloud.com/player/api.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      api = null;
      reject(new Error("SoundCloud's player didn't load"));
    };
    document.head.append(script);
  });
  return api;
}

/** What the sound button drives: an <audio> element, SoundCloud's player or YouTube's. */
export interface Player {
  play(): void;
  pause(): void;
  destroy(): void;
}

/** SoundCloud's player, hidden, starting at the link's time and looping back to it. */
export function soundCloudPlayer(track: SoundCloudTrack, onPlaying: (playing: boolean) => void): Player {
  const iframe = document.createElement("iframe");
  const src = new URL("https://w.soundcloud.com/player/");
  src.searchParams.set("url", track.url);
  src.searchParams.set("auto_play", "false");
  src.searchParams.set("visual", "false");
  iframe.src = src.toString();
  iframe.allow = "autoplay";
  iframe.title = "SoundCloud player";
  iframe.tabIndex = -1;
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "absolute", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", border: "0" });
  document.body.append(iframe);

  let widget: Widget | null = null;
  let playing = false;
  // Seek on the first play: SoundCloud ignores a seek before the track loads.
  let fresh = true;
  let wanted = false;
  loadApi()
    .then(() => {
      const SC = window.SC!;
      const w = SC.Widget(iframe);
      w.bind(SC.Widget.Events.READY!, () => {
        widget = w;
        if (wanted) w.play();
      });
      w.bind(SC.Widget.Events.PLAY!, () => {
        if (fresh && track.startMs > 0) w.seekTo(track.startMs);
        fresh = false;
        playing = true;
        onPlaying(true);
      });
      w.bind(SC.Widget.Events.PAUSE!, () => {
        playing = false;
        onPlaying(false);
      });
      w.bind(SC.Widget.Events.FINISH!, () => {
        w.seekTo(track.startMs);
        w.play();
      });
    })
    .catch(() => onPlaying(false));

  return {
    play() {
      wanted = true;
      if (widget && !playing) widget.play();
    },
    pause() {
      wanted = false;
      if (widget && playing) widget.pause();
    },
    destroy() {
      widget?.pause();
      iframe.remove();
    },
  };
}
