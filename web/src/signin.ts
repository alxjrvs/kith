/**
 * Where "Sign in with Discord" goes. `next` brings the person back to the page
 * they pressed it on; the Worker only honours a same-origin path. It is always
 * sent, because a login with no `next` is the slash command's and lands in the
 * organiser console.
 */
export function signInHref(next: string = currentPath()): string {
  return `/console/login?next=${encodeURIComponent(next)}`;
}

function currentPath(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;
}
