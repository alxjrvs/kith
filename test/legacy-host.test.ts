import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { legacyRedirect } from "../src/http/legacy-host.ts";

/**
 * orrey.alxjrvs.com is Kith's old hostname. Page loads there move to
 * kith.alxjrvs.com; anything a machine calls, or a sign-in already in flight,
 * keeps answering where it is.
 */
const at = (path: string) => new URL(`https://orrey.alxjrvs.com${path}`);

describe("legacyRedirect", () => {
  it("sends page loads on the old hostname to the new one, keeping path and query", () => {
    expect(legacyRedirect("GET", at("/privacy"))).toBe("https://kith.alxjrvs.com/privacy");
    expect(legacyRedirect("GET", at("/console/login?next=%2Fagenda"))).toBe(
      "https://kith.alxjrvs.com/console/login?next=%2Fagenda",
    );
    expect(legacyRedirect("HEAD", at("/me"))).toBe("https://kith.alxjrvs.com/me");
  });

  it("leaves machine endpoints and in-flight sign-ins on the old hostname", () => {
    for (const path of ["/interactions", "/ics/abc.ics", "/google/push", "/healthz", "/api/hub/me", "/console/callback?code=x", "/console/me/feeds"]) {
      expect(legacyRedirect("GET", at(path)), path).toBeNull();
    }
  });

  it("never redirects a write", () => {
    expect(legacyRedirect("POST", at("/privacy"))).toBeNull();
  });

  it("does nothing on any other hostname", () => {
    expect(legacyRedirect("GET", new URL("https://kith.alxjrvs.com/privacy"))).toBeNull();
    expect(legacyRedirect("GET", new URL("https://orrey.alxjrvs.workers.dev/privacy"))).toBeNull();
  });
});

describe("the Worker on the old hostname", () => {
  const app = createApp();

  it("answers a page load with a permanent redirect", async () => {
    const response = await app.request("https://orrey.alxjrvs.com/privacy", {}, env);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://kith.alxjrvs.com/privacy");
  });

  it("still answers the health check the deploy verifies", async () => {
    const response = await app.request("https://orrey.alxjrvs.com/healthz", {}, env);
    expect(response.status).toBe(200);
  });
});
