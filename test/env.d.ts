import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { Env } from "../src/env.ts";

/**
 * `cloudflare:test` exposes the Worker's bindings as `Cloudflare.Env`. Kith
 * does not generate `worker-configuration.d.ts`, so the hand-written Env is the
 * shape — plus the migrations the setup file applies.
 */
declare global {
  namespace Cloudflare {
    interface Env extends KithEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

type KithEnv = Env;
