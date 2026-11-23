/**
 * A game's sound can be a YouTube video. Like a SoundCloud track, it plays
 * through YouTube's own player (hidden), so the video stays on YouTube; Kith
 * never copies the audio. Only the sound is heard.
 * https://developers.google.com/youtube/iframe_api_reference
 */
import type { YouTubeVideo } from "./sound-link.ts";
import type { Player } from "./soundcloud.ts";

const State = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        options: {
          videoId: string;
          width?: number;
          height?: number;
          playerVars?: Record<string, number | string>;
          events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void; onError?: () => void };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let api: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  api ??= new Promise<void>((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      before?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      api = null;
      reject(new Error("YouTube's player didn't load"));
    };
    document.head.append(script);
  });
  return api;
}

/** YouTube's player, hidden, starting at the link's time and looping back to it. */
export function youTubePlayer(video: YouTubeVideo, onPlaying: (playing: boolean) => void): Player {
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  Object.assign(box.style, { position: "absolute", width: "1px", height: "1px", overflow: "hidden", opacity: "0", pointerEvents: "none" });
  const slot = document.createElement("div");
  box.append(slot);
  document.body.append(box);

  const start = Math.floor(video.startMs / 1000);
  let player: YTPlayer | null = null;
  let playing = false;
  let wanted = false;
  let gone = false;
  loadApi()
    .then(() => {
      if (gone) return;
      const p = new window.YT!.Player(slot, {
        videoId: video.id,
        width: 1,
        height: 1,
        playerVars: { start, controls: 0, disablekb: 1, playsinline: 1, rel: 0, fs: 0, iv_load_policy: 3 },
        events: {
          onReady: () => {
            player = p;
            if (wanted) p.playVideo();
          },
          onStateChange: ({ data }) => {
            if (data === State.PLAYING) {
              playing = true;
              onPlaying(true);
            } else if (data === State.PAUSED) {
              playing = false;
              onPlaying(false);
            } else if (data === State.ENDED) {
              p.seekTo(start, true);
              p.playVideo();
            }
          },
          onError: () => onPlaying(false),
        },
      });
    })
    .catch(() => onPlaying(false));

  return {
    play() {
      wanted = true;
      if (player && !playing) player.playVideo();
    },
    pause() {
      wanted = false;
      if (player && playing) player.pauseVideo();
    },
    destroy() {
      gone = true;
      player?.destroy();
      box.remove();
    },
  };
}
