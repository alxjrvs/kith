// kith-cms's Worker entry: EmDash (Astro's request handler), plus the Cron
// Trigger that runs EmDash's scheduled publishing and housekeeping.
//
// Two kinds of caller reach it:
//
// - People, at admin.kith.town. Cloudflare Access guards that hostname
//   as a whole, and EmDash checks the Access token on every admin request.
// - The Kith Worker, over its `CMS` service binding. A service binding never
//   passes through Access, so it authenticates the way any API client does:
//   with an EmDash API token (`Authorization: Bearer ec_pat_…`), scoped to
//   reading content. It only ever reads `/_emdash/api/*`.
//
// On workers.dev (which Access doesn't guard) only the health check answers,
// so the admin is never reachable around Access.
import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";
import { route } from "./gateway";

export { PluginBridge };

type Fetch = (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;
const astro = handler.fetch as unknown as Fetch;

const fetch = async (request: Request, env: unknown, ctx: unknown): Promise<Response> => {
  switch (route(request)) {
    case "health":
      return new Response("ok", { headers: { "Cache-Control": "no-store" } });
    case "not-found":
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    case "emdash": {
      const response = await astro(request, env, ctx);
      if (response.status === 101) return response; // a WebSocket upgrade
      const out = new Response(response.body, response);
      out.headers.set("Cache-Control", "private, no-store");
      out.headers.set("X-Robots-Tag", "noindex, nofollow");
      return out;
    }
  }
};

export default {
  ...handler,
  fetch,
  scheduled: createScheduledHandler(),
};
