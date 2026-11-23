import { describe, expect, it } from "vitest";
import { youTubeVideo } from "../web/src/sound-link.ts";

describe("a game's sound from a YouTube link", () => {
  it("reads the video from every usual shape of link", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=eXV4WyQMHFM",
      "https://youtube.com/watch?v=eXV4WyQMHFM&list=PL123",
      "https://m.youtube.com/watch?v=eXV4WyQMHFM",
      "https://music.youtube.com/watch?v=eXV4WyQMHFM",
      "https://youtu.be/eXV4WyQMHFM",
      "https://www.youtube.com/embed/eXV4WyQMHFM",
      "https://www.youtube.com/shorts/eXV4WyQMHFM",
      "https://www.youtube-nocookie.com/embed/eXV4WyQMHFM",
    ]) {
      expect(youTubeVideo(link), link).toEqual({ id: "eXV4WyQMHFM", startMs: 0 });
    }
  });

  it("starts partway when the link says where", () => {
    expect(youTubeVideo("https://youtu.be/eXV4WyQMHFM?t=90")?.startMs).toBe(90_000);
    expect(youTubeVideo("https://www.youtube.com/watch?v=eXV4WyQMHFM&t=1m30s")?.startMs).toBe(90_000);
    expect(youTubeVideo("https://www.youtube.com/watch?v=eXV4WyQMHFM#t=0:09")?.startMs).toBe(9_000);
  });

  it("leaves anything else to the other players", () => {
    for (const link of [
      "http://www.youtube.com/watch?v=eXV4WyQMHFM",
      "https://soundcloud.com/someone/a-track",
      "https://www.youtube.com/@someone",
      "https://www.youtube.com/watch?v=short",
      "https://notyoutube.com/watch?v=eXV4WyQMHFM",
      "not a link",
    ]) {
      expect(youTubeVideo(link), link).toBeNull();
    }
  });
});
