import { describe, expect, it } from "vitest";
import { route } from "../cms/src/gateway.ts";

const req = (url: string, method = "GET") => new Request(url, { method });

describe("kith-cms gateway", () => {
  it("hands everything on the admin host to EmDash, behind Access", () => {
    expect(route(req("https://admin.kith.town/_emdash/admin/"))).toBe("emdash");
    expect(route(req("https://admin.kith.town/"))).toBe("emdash");
    expect(route(req("https://admin.kith.town/_emdash/api/content/games", "POST"))).toBe("emdash");
  });

  it("lets the Kith Worker's binding read the content API and nothing else", () => {
    expect(route(req("https://cms.internal/_emdash/api/content/games"))).toBe("emdash");
    expect(route(req("https://cms.internal/_emdash/api/media/file/abc"))).toBe("emdash");
    expect(route(req("https://cms.internal/_emdash/api/content/games", "POST"))).toBe("not-found");
    expect(route(req("https://cms.internal/_emdash/admin/"))).toBe("not-found");
  });

  it("never serves the admin where Access doesn't guard it", () => {
    expect(route(req("https://kith-cms.alxjrvs.workers.dev/_emdash/admin/"))).toBe("not-found");
    expect(route(req("https://kith-cms.alxjrvs.workers.dev/_emdash/api/content/games"))).toBe("not-found");
    expect(route(req("https://kith-cms.alxjrvs.workers.dev/healthz"))).toBe("health");
  });
});
