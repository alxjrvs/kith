import type { GuildGovernor } from "./do/guild-governor.ts";
import type { PollLock } from "./do/poll-lock.ts";
import type { SessionLock } from "./do/session-lock.ts";

export interface Env {
  // Bindings
  DB: D1Database;
  OUTBOX: Queue<OutboxMessage>;
  ASSETS: Fetcher;
  GUILD: DurableObjectNamespace<GuildGovernor>;
  SESSION_LOCK: DurableObjectNamespace<SessionLock>;
  POLL_LOCK: DurableObjectNamespace<PollLock>;
  /**
   * kith-cms (cms/, EmDash), where every word lives (docs/CMS.md). Optional:
   * until kith-cms is set up, and in tests, the site reads as if it were empty.
   */
  CMS?: Fetcher;
  /**
   * Cloudflare Images, to cut each game's art into a square app icon
   * (src/http/game-apps.ts). Optional: without it a game's app wears Kith's icon.
   */
  IMAGES?: ImagesBinding;

  // Vars
  ENVIRONMENT: "development" | "production";
  /**
   * Where Google should push to.
   *
   * A request can be asked for its own origin; the cron cannot — it has no
   * request — and the cron is what opens and renews the channel. So the public
   * hostname is configuration rather than something derived at the callsite.
   */
  PUBLIC_ORIGIN: string;

  // Secrets
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_GUILD_ID: string;
  GOOGLE_CALENDAR_ID: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string;
  CONSOLE_SESSION_SECRET: string;
  /** An EmDash API token with only `content:read`, for reading kith-cms. */
  CMS_TOKEN?: string;
}

/**
 * Everything Kith projects outward. Note what is absent: Discord *messages*.
 * Messages are send-only and are never reconciled, so they never ride the queue.
 */
export type OutboxMessage =
  | { kind: "gcal.upsert"; sessionId: string }
  | { kind: "gcal.delete"; sessionId: string }
  | { kind: "discord.event.upsert"; sessionId: string }
  | { kind: "discord.event.delete"; sessionId: string };
