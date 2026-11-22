/**
 * Kith has had three homes: orrey.alxjrvs.com (the product's old name), then
 * kith.alxjrvs.com, and now kith.town. The old hostnames still point at this
 * Worker so nothing already shared breaks; this decides which requests on them
 * are sent on to the current one.
 *
 * Only page loads move. Anything a machine calls, or a flow already in flight,
 * keeps answering on an old hostname: Discord's interactions endpoint and
 * OAuth callback, calendar feeds Google has subscribed to, push channels, the
 * health check the deploy verifies, and the JSON API.
 */
export const LEGACY_HOSTS: readonly string[] = ["orrey.alxjrvs.com", "kith.alxjrvs.com"];
export const CURRENT_ORIGIN = "https://kith.town";

const STAYS = ["/interactions", "/ics/", "/google/", "/healthz", "/api/", "/console/callback", "/console/me/"];

export function legacyRedirect(method: string, url: URL): string | null {
  if (!LEGACY_HOSTS.includes(url.hostname)) return null;
  if (method !== "GET" && method !== "HEAD") return null;
  if (STAYS.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))) return null;
  return `${CURRENT_ORIGIN}${url.pathname}${url.search}`;
}
