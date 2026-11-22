import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { channelOf } from "../src/attendance/thread.ts";
import { destinationForDay } from "../src/game-days/notice.ts";
import { catalog } from "../src/hub/catalog.ts";
import { listingFor } from "../src/hub/listings.ts";
import { loadProjectionTarget } from "../src/projection/target.ts";
import { isStagingParent, publishesTo, siteVisibility } from "../src/projection/staging.ts";
import { createCampaign, updateCampaign } from "../src/campaigns/write.ts";
import { putGame } from "../src/campaigns/roster-write.ts";

/**
 * Test games (src/projection/staging.ts). What matters: a test never posts in a
 * real channel, falls back to nothing rather than to the real channel, stays
 * off the calendar and the server's event list, and is invisible on the site to
 * everybody but organisers. A real game is untouched by all of it.
 */
const PROD = "prod-scheduling";
const STAGING = "staging-scheduling";
const later = Math.floor(Date.now() / 1000) + 7 * 86_400;
const anyone = { userId: "someone", organiser: false };
const organiser = { userId: "jrvs", organiser: true };

async function run(sql: string, ...binds: unknown[]) {
  await env.DB.prepare(sql).bind(...binds).run();
}

beforeEach(async () => {
  for (const table of ["sessions", "game_days", "campaigns", "games"]) await run(`DELETE FROM ${table}`);
  await run("INSERT OR IGNORE INTO users (discord_id, username, feed_token) VALUES ('jrvs', 'jrvs', 't-jrvs')");
  await setSetting(env, SETTING_KEYS.schedulingChannelId, PROD);
  await setSetting(env, SETTING_KEYS.stagingChannelId, STAGING);
  await run(
    "INSERT INTO campaigns (id, name, kind, state, visibility, staging) VALUES ('real', 'Real', 'run', 'RUNNING', 'public', 0)",
  );
  await run(
    "INSERT INTO campaigns (id, name, kind, state, visibility, staging) VALUES ('test-rpg', 'Test RPG', 'run', 'RUNNING', 'public', 1)",
  );
  await run("INSERT INTO games (id, name, category, staging) VALUES ('ti', 'Twilight Imperium', 'board', 0)");
  await run("INSERT INTO games (id, name, category, staging) VALUES ('test-ti', 'Test TI', 'board', 1)");
  for (const [id, gameId] of [
    ["real-day", "ti"],
    ["test-day", "test-ti"],
  ]) {
    await run(
      "INSERT INTO game_days (id, kind, game_id, state, starts_at, ends_at, visibility) VALUES (?, 'single', ?, 'SEATING', ?, ?, 'public')",
      id,
      gameId,
      later,
      later + 8 * 3600,
    );
  }
  for (const [id, campaignId] of [
    ["real-s1", "real"],
    ["test-s1", "test-rpg"],
  ]) {
    await run(
      "INSERT INTO sessions (id, kind, campaign_id, starts_at, ends_at, state) VALUES (?, 'campaign_session', ?, ?, ?, 'SCHEDULED')",
      id,
      campaignId,
      later,
      later + 4 * 3600,
    );
  }
});

describe("where a test posts", () => {
  it("sends a test campaign's scheduling-channel posts to Staging, and a real one's to the real channel", async () => {
    expect(await channelOf(env, (await loadProjectionTarget(env, "real-s1"))!)).toBe(PROD);
    expect(await channelOf(env, (await loadProjectionTarget(env, "test-s1"))!)).toBe(STAGING);
  });

  it("sends a test game's days to Staging", async () => {
    expect(await destinationForDay(env, "real-day")).toBe(PROD);
    expect(await destinationForDay(env, "test-day")).toBe(STAGING);
  });

  it("keeps a test campaign's own channel, which is the organiser's to point under Staging", async () => {
    await run("UPDATE campaigns SET discord_channel_id = 'test-channel' WHERE id = 'test-rpg'");
    expect(await channelOf(env, (await loadProjectionTarget(env, "test-s1"))!)).toBe("test-channel");
  });

  it("posts nowhere, never the real channel, when Staging is not set", async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(SETTING_KEYS.stagingChannelId).run();
    expect(await channelOf(env, (await loadProjectionTarget(env, "test-s1"))!)).toBeUndefined();
    expect(await destinationForDay(env, "test-day")).toBeUndefined();
  });

  it("answers the same question from ids", async () => {
    expect(await isStagingParent(env, { campaignId: "test-rpg" })).toBe(true);
    expect(await isStagingParent(env, { gameId: "test-ti" })).toBe(true);
    expect(await isStagingParent(env, { campaignId: "real", gameId: "ti" })).toBe(false);
    expect(await isStagingParent(env, {})).toBe(false);
    // A campaign decides for itself, even when it names a test game.
    expect(await isStagingParent(env, { campaignId: "real", gameId: "test-ti" })).toBe(false);
  });
});

describe("what a test publishes", () => {
  it("puts nothing on the calendar and no server-wide event up", async () => {
    const test = (await loadProjectionTarget(env, "test-s1"))!;
    expect(publishesTo(test, "google")).toBe(false);
    expect(publishesTo(test, "discord")).toBe(false);

    const real = (await loadProjectionTarget(env, "real-s1"))!;
    expect(publishesTo(real, "google")).toBe(true);
    expect(publishesTo(real, "discord")).toBe(true);
  });

  it("allows a Discord event only in the test campaign's own voice channel", async () => {
    await run(
      "UPDATE campaigns SET location_type = 'voice', discord_voice_channel_id = 'staging-voice' WHERE id = 'test-rpg'",
    );
    const test = (await loadProjectionTarget(env, "test-s1"))!;
    expect(publishesTo(test, "discord")).toBe(true);
    expect(publishesTo(test, "google")).toBe(false);
  });
});

describe("who sees a test on the site", () => {
  it("is organisers only, whatever its listing says", async () => {
    expect(siteVisibility("public", 1)).toBe("organisers");
    expect(siteVisibility("public", 0)).toBe("public");

    expect(await listingFor(env, "campaign", "test-rpg", anyone)).toBeUndefined();
    expect(await listingFor(env, "campaign", "test-rpg", organiser)).toBeDefined();
    expect(await listingFor(env, "campaign", "real", anyone)).toBeDefined();

    expect(await listingFor(env, "game-day", "test-day", anyone)).toBeUndefined();
    expect(await listingFor(env, "game-day", "test-day", organiser)).toBeDefined();
    expect(await listingFor(env, "game-day", "real-day", anyone)).toBeDefined();
  });

  it("leaves a test game out of the catalog for everybody but organisers", async () => {
    expect((await catalog(env, anyone)).map((g) => g.id)).toEqual(["ti"]);
    expect((await catalog(env, organiser)).map((g) => g.id).sort()).toEqual(["test-ti", "ti"]);
  });
});

describe("choosing a test", () => {
  it("can be chosen while nothing is scheduled", async () => {
    const id = await createCampaign(env, { name: "Fresh", kind: "run", staging: true }, "jrvs");
    expect(await isStagingParent(env, { campaignId: id })).toBe(true);
    await updateCampaign(env, id, { staging: false }, "jrvs");
    expect(await isStagingParent(env, { campaignId: id })).toBe(false);

    await putGame(env, "fresh-game", { name: "Fresh game", staging: true }, "jrvs");
    expect(await isStagingParent(env, { gameId: "fresh-game" })).toBe(true);
  });

  it("cannot change once there are sessions or game days, so nothing posted is left behind", async () => {
    await expect(updateCampaign(env, "real", { staging: true }, "jrvs")).rejects.toThrow(/cannot become a test/);
    await expect(updateCampaign(env, "test-rpg", { staging: false }, "jrvs")).rejects.toThrow(/cannot become a test/);
    await expect(putGame(env, "ti", { name: "Twilight Imperium", staging: true }, "jrvs")).rejects.toThrow(
      /cannot become a test/,
    );
    // Saying what it already is, is not a change.
    await updateCampaign(env, "test-rpg", { staging: true }, "jrvs");
    await putGame(env, "test-ti", { name: "Test TI", staging: true }, "jrvs");
  });
});
