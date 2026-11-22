import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Tests run inside workerd with the real bindings from wrangler.jsonc: a
 * throwaway D1 with the migrations applied, the two Durable Object classes,
 * and the outbox queue. Nothing here touches Discord or Google.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "drizzle"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
          // kith-cms isn't running in tests. Without a CMS_TOKEN nothing asks
          // it anything; tests that read the CMS pass their own fake.
          serviceBindings: { CMS: () => new Response("kith-cms is not running in tests", { status: 503 }) },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
