/**
 * Where a person signs in. The console has a public front door: the "Sign in
 * with Discord" button on `/` and the link `/console` posts both land on
 * `/console/login`, which starts Discord OAuth for anybody who asks.
 *
 * That replaces an earlier rule that `/console/login` needed a five-minute
 * signed token minted by the slash command. The site now has members, not only
 * organisers, and they arrive from the web. What keeps a login safe is not who
 * may *start* one but who may *finish* it: the callback refuses any `code`
 * whose `state` does not match the cookie this browser was given, so nobody can
 * complete a login in somebody else's browser. The authorize page is Discord's
 * own, asking for `identify` and nothing else.
 */
export function loginLink(origin: string): string {
  return `${origin}/console/login`;
}
