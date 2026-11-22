import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { access, d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

// kith-cms: EmDash on its own Worker (wrangler.jsonc). It has no public pages.
// Its admin is at cms.kith.town, behind Cloudflare Access. The Kith
// Worker (../wrangler.jsonc) reads published entries from EmDash's content API
// over a service binding, with a read-only API token, and renders them itself.
//
// This is the same setup as alxjrvs.com's EmDash (alxjrvs/alxjrvs-dot-com),
// minus the public site: Kith's pages are the React app in ../web.
export default defineConfig({
  site: "https://cms.kith.town",
  output: "server",
  adapter: cloudflare(),
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  integrations: [
    // EmDash's admin is a React app.
    react(),
    emdash({
      // The CMS's own origin: redirects, preview links and CSRF checks use it.
      siteUrl: "https://cms.kith.town",
      database: d1({ binding: "DB", session: "auto", coalesce: true }),
      storage: r2({ binding: "MEDIA" }),
      // In production only Access can sign in (Google, the same identity as
      // admin.alxjrvs.com), and EmDash checks its token on every admin
      // request. `astro dev` falls back to a local passkey. API tokens (the
      // Kith Worker's) authenticate on their own, without Access.
      auth: access({
        teamDomain: "alxjrvs.cloudflareaccess.com",
        audienceEnvVar: "CF_ACCESS_AUDIENCE",
      }),
    }),
  ],
});
