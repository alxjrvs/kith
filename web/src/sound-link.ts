/**
 * Reading a sound link, with nothing that needs a browser, so the tests can
 * check it. The players themselves are in soundcloud.ts and youtube.ts.
 */

/** A YouTube video's id, and where to start in it (`&t=90`, `?t=1m30s`, `#t=0:09`). */
export interface YouTubeVideo {
  id: string;
  startMs: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** `youtube.com/watch?v=…`, `youtu.be/…`, `/embed/…`, `/shorts/…`, `/live/…`, and music.youtube.com. */
export function youTubeVideo(link: string): YouTubeVideo | null {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^(?:www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = parsed.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [first, second] = parsed.pathname.slice(1).split("/");
    id = first === "watch" ? parsed.searchParams.get("v") : first && ["embed", "shorts", "live", "v"].includes(first) ? (second ?? null) : null;
  } else return null;
  if (!id || !VIDEO_ID.test(id)) return null;
  const t = parsed.searchParams.get("t") ?? parsed.searchParams.get("start") ?? new URLSearchParams(parsed.hash.slice(1)).get("t");
  return { id, startMs: t ? startMs(t) : 0 };
}

/** `0:09`, `1:02:03`, `9`, `1m30s` → milliseconds; anything else is the start. */
export function startMs(t: string): number {
  if (/^\d+(?::\d{1,2}){0,2}$/.test(t)) return t.split(":").reduce((s, part) => s * 60 + Number(part), 0) * 1000;
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (m && t) return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
  return 0;
}
