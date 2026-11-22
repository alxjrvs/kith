/**
 * One game's service worker. The same script is registered once per game, each
 * time scoped to that game's path (`/games/<slug>`, web/src/pwa.ts), so every
 * game installs as its own app with its own cache, and none sees another's.
 *
 * What it does, and no more:
 * - a page load in the game goes to the network first, and when there is no
 *   network gets the last copy of that page, or of the game's home base, or a
 *   short offline note;
 * - the site's built files and uploaded art never change at a URL, so they come
 *   from the cache once seen;
 * - the site's API (`/api/hub/*`) goes to the network first and falls back to
 *   the last answer, so the game reads as it last did, marked by its own "as of".
 *
 * Only GETs on this origin are touched. Nothing is ever written offline.
 */
const VERSION = 1;
const SCOPE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const CACHE = `kith-game:${SCOPE}:v${VERSION}`;

/** Exactly this game: the scope is a string prefix, so `/games/root` would also match `/games/root-two`. */
const inGame = (path) => path === SCOPE || path.startsWith(`${SCOPE}/`);
const immutable = (path) => path.startsWith("/assets/") || path.startsWith("/media/");

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(SCOPE, { credentials: "include" })))
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const mine = `kith-game:${SCOPE}:`;
      for (const name of await caches.keys()) {
        if (name.startsWith(mine) && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (inGame(url.pathname)) event.respondWith(page(request));
    return;
  }
  if (immutable(url.pathname)) return event.respondWith(cacheFirst(request));
  if (url.pathname.startsWith("/api/hub/")) return event.respondWith(networkFirst(request, url));
});

async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match(SCOPE)) ?? offline();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only what the server says never changes: a game icon's stand-in is briefly
  // cached so the real cut replaces it, and must not be kept here for good.
  if (response.ok && (request.url.includes("/assets/") || /immutable/.test(response.headers.get("cache-control") ?? ""))) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // Signed out since the last answer: nothing seen while signed in may be shown offline afterwards.
      if (url.pathname === "/api/hub/me" && (await signedIn(await cache.match(request))) && !(await signedIn(response.clone()))) {
        await forgetApi(cache);
      }
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.json({ error: "You're offline, and Kith has no copy of this yet." }, { status: 503 });
  }
}

async function signedIn(response) {
  if (!response) return false;
  try {
    return (await response.json()).signedIn === true;
  } catch {
    return false;
  }
}

async function forgetApi(cache) {
  for (const key of await cache.keys()) {
    if (new URL(key.url).pathname.startsWith("/api/hub/")) await cache.delete(key);
  }
}

function offline() {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#211d1b;color:#f4eee8;font:16px/1.5 "Hanken Grotesk",system-ui,sans-serif;padding:16px;text-align:center}a{color:#ffb38a}</style></head>
<body><main><h1>You're offline</h1><p>This game will be here when you're back online.</p><p><a href="${SCOPE}">Try again</a></p></main></body></html>`;
  return new Response(body, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
