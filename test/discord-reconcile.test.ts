import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, schema } from "../src/db/index.ts";
import { SETTING_KEYS, setSetting } from "../src/db/settings.ts";
import { reconcileDiscordEvents } from "../src/discord/reconcile.ts";
import type { OutboxMessage } from "../src/env.ts";

/**
 * The hourly reconcile works out what the server's event list should hold from
 * D1 alone and asks for the difference. What is worth testing is the set it
 * decides on, and that it puts right what the edit-time paths left wrong.
 */
const NOW = new Date("2026-12-01T12:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);
const realFetch = globalThis.fetch;

let sent: OutboxMessage[] = [];
let deleted: string[] = [];
let guildEvents: { id: string; name: string; status: number; description?: string }[] = [];
let guilds = 0;

function outboxEnv() {
  return {
    ...env,
    OUTBOX: {
      sendBatch: async (messages: { body: OutboxMessage }[]) => {
        sent.push(...messages.map((m) => m.body));
      },
    },
  } as unknown as typeof env;
}

async function campaign(id: string, state: "RUNNING" | "HIATUS" | "CONCLUDED") {
  await db(env).insert(schema.campaigns).values({ id, name: id, kind: "run", discordChannelId: "c", state });
}

async function session(
  id: string,
  campaignId: string,
  days: number,
  extra: Partial<typeof schema.sessions.$inferInsert> = {},
) {
  await db(env)
    .insert(schema.sessions)
    .values({
      id,
      kind: "campaign_session",
      campaignId,
      startsAt: nowSeconds + days * 86_400,
      endsAt: nowSeconds + days * 86_400 + 4 * 3600,
      ...extra,
    });
}

beforeEach(async () => {
  sent = [];
  deleted = [];
  guildEvents = [];
  for (const table of ["publications", "jobs", "sessions", "campaigns", "settings"]) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await setSetting(env, SETTING_KEYS.guildId, `rg${++guilds}`);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if ((init?.method ?? "GET") === "DELETE") {
      deleted.push(url.pathname.split("/").pop()!);
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(guildEvents), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const upserts = () => sent.filter((m) => m.kind === "discord.event.upsert").map((m) => m.sessionId).sort();
const deletes = () => sent.filter((m) => m.kind === "discord.event.delete").map((m) => m.sessionId).sort();

describe("the hourly Discord reconcile", () => {
  it("asks for the next two sessions of a running campaign, skipping a cancelled one", async () => {
    await campaign("umbra", "RUNNING");
    await session("umbra-s1", "umbra", 1);
    await session("umbra-s2", "umbra", 8, { state: "CANCELLED" });
    await session("umbra-s3", "umbra", 15);
    await session("umbra-s4", "umbra", 22);

    await reconcileDiscordEvents(outboxEnv(), NOW);

    expect(upserts()).toEqual(["umbra-s1", "umbra-s3"]);
    expect(deletes()).toEqual([]);
  });

  it("takes down the events of a campaign that has stopped running", async () => {
    await campaign("fulcrum", "CONCLUDED");
    await session("fulcrum-s9", "fulcrum", 3, { discordEventId: "evt-9" });
    guildEvents = [{ id: "evt-9", name: "x", status: 1, description: "[orrey:session:fulcrum-s9]" }];

    await reconcileDiscordEvents(outboxEnv(), NOW);

    expect(upserts()).toEqual([]);
    expect(deletes()).toEqual(["fulcrum-s9"]);
    // Through the ledger, not directly: the session still holds the id.
    expect(deleted).toEqual([]);
  });

  it("forgets an event that was deleted by hand, so the upsert makes a new one", async () => {
    await campaign("umbra", "RUNNING");
    await session("umbra-s1", "umbra", 1, { discordEventId: "evt-gone", discordEventFingerprint: "fp" });

    await reconcileDiscordEvents(outboxEnv(), NOW);

    const row = await db(env).select().from(schema.sessions).where(eq(schema.sessions.id, "umbra-s1")).get();
    expect(row?.discordEventId).toBeNull();
    expect(row?.discordEventFingerprint).toBeNull();
    expect(upserts()).toEqual(["umbra-s1"]);
  });

  it("keeps the id of an event that is still live", async () => {
    await campaign("umbra", "RUNNING");
    await session("umbra-s1", "umbra", 1, { discordEventId: "evt-1", discordEventFingerprint: "fp" });
    guildEvents = [{ id: "evt-1", name: "x", status: 1, description: "[orrey:session:umbra-s1]" }];

    await reconcileDiscordEvents(outboxEnv(), NOW);

    const row = await db(env).select().from(schema.sessions).where(eq(schema.sessions.id, "umbra-s1")).get();
    expect(row?.discordEventId).toBe("evt-1");
  });

  it("deletes a Kith event nobody holds, and leaves everyone else's alone", async () => {
    await campaign("umbra", "RUNNING");
    guildEvents = [
      { id: "evt-stray", name: "x", status: 1, description: "Who's coming\n\n[orrey:session:gone-s1]" },
      { id: "evt-theirs", name: "Movie night", status: 1, description: "popcorn" },
      { id: "evt-done", name: "x", status: 3, description: "[orrey:session:gone-s2]" },
    ];

    const result = await reconcileDiscordEvents(outboxEnv(), NOW);

    expect(deleted).toEqual(["evt-stray"]);
    expect(result.strays).toEqual(["evt-stray"]);
  });

  it("leaves the event of a session that has already started", async () => {
    await campaign("umbra", "RUNNING");
    await session("umbra-s1", "umbra", -0.05);
    guildEvents = [{ id: "evt-now", name: "x", status: 2, description: "[orrey:session:umbra-s1]" }];

    await reconcileDiscordEvents(outboxEnv(), NOW);
    expect(deleted).toEqual([]);
  });

  it("does nothing before the guild is set", async () => {
    await env.DB.prepare("DELETE FROM settings").run();
    await campaign("umbra", "RUNNING");
    await session("umbra-s1", "umbra", 1);

    await reconcileDiscordEvents(outboxEnv(), NOW);
    expect(sent).toEqual([]);
  });
});
