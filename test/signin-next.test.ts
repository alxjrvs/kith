import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { NEXT_COOKIE, STATE_COOKIE, nextFromCookie, safeNext } from "../src/console/cookies.ts";

/**
 * The site's "Sign in with Discord" brings people back to the page they were
 * on. The only thing worth testing hard is that "the page they were on" can
 * never be somebody else's host.
 */
const app = createApp();
const realFetch = globalThis.fetch;

function consoleEnv() {
  return { ...env, CONSOLE_SESSION_SECRET: "a-secret", DISCORD_APPLICATION_ID: "app-1", DISCORD_CLIENT_SECRET: "shh" };
}

function get(path: string, cookie?: string) {
  return app.fetch(
    new Request(`https://orrey.test${path}`, {
      redirect: "manual",
      ...(cookie ? { headers: { cookie } } : {}),
    }),
    consoleEnv(),
  );
}

beforeEach(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/oauth2/token")) {
      return Response.json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 604_800 });
    }
    if (url.includes("/users/@me")) return Response.json({ id: "1001", username: "ada", global_name: "Ada" });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  await env.DB.prepare("DELETE FROM discord_tokens").run();
  await env.DB.prepare("DELETE FROM users").run();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("safeNext", () => {
  it("keeps a same-origin path", () => {
    expect(safeNext("/join/campaign/hollowmere")).toBe("/join/campaign/hollowmere");
    expect(safeNext("/find?q=a%26b")).toBe("/find?q=a%26b");
  });

  it("decodes the cookie exactly once", () => {
    expect(nextFromCookie(encodeURIComponent("/find?q=100%25"))).toBe("/find?q=100%25");
    expect(nextFromCookie("%E0%A4%A")).toBeUndefined();
  });

  it("refuses anything a browser would read as another host", () => {
    for (const raw of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", "", "/caf\u00e9"]) {
      expect(safeNext(raw)).toBeUndefined();
    }
  });
});

describe("sign in from the site", () => {
  it("remembers where to come back to", async () => {
    const response = await get("/console/login?next=%2Fgames");
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${NEXT_COOKIE}=%2Fgames`))).toBe(true);
  });

  it("lands on that page after the callback", async () => {
    const response = await get(
      "/console/callback?code=c1&state=s1",
      `${STATE_COOKIE}=s1; ${NEXT_COOKIE}=%2Fgames`,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/games");
  });

  it("falls back to the console for the slash command's link, or a hostile next", async () => {
    const plain = await get("/console/callback?code=c1&state=s1", `${STATE_COOKIE}=s1`);
    expect(plain.headers.get("location")).toBe("/console");

    const hostile = await get(
      "/console/callback?code=c1&state=s1",
      `${STATE_COOKIE}=s1; ${NEXT_COOKIE}=%2F%2Fevil.example`,
    );
    expect(hostile.headers.get("location")).toBe("/console");
  });
});
