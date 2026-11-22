// Which requests kith-cms answers, as a pure function so it can be tested
// without the Workers runtime (gateway.test.ts).

export const ADMIN_HOST = "cms.kith.town";
/** The hostname a service-binding request from the Kith Worker carries. */
export const BINDING_HOST = "cms.internal";

export type Route = "emdash" | "health" | "not-found";

export function route(request: Request): Route {
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return "health";
  // Behind Access: everything is EmDash's.
  if (url.hostname === ADMIN_HOST) return "emdash";
  // The Kith Worker, through the service binding: the content API only, and
  // only reads. EmDash still checks the API token and its scope.
  if (url.hostname === BINDING_HOST) {
    const reading = request.method === "GET" || request.method === "HEAD";
    return reading && url.pathname.startsWith("/_emdash/api/") ? "emdash" : "not-found";
  }
  // `astro dev` and `wrangler dev`.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "emdash";
  // workers.dev and anything else Access doesn't guard.
  return "not-found";
}
