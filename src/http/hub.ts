import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../env.ts";
import { db, schema } from "../db/index.ts";
import { sessionFrom } from "../console/session.ts";
import { isOrganiser } from "../console/roles.ts";
import { personFrom } from "../hub/people.ts";
import { ANONYMOUS, type Viewer } from "../hub/visibility.ts";
import { listingFor, openListings } from "../hub/listings.ts";
import { catalog } from "../hub/catalog.ts";
import { gamesFor, homeBase } from "../hub/home-base.ts";
import { agendaFor } from "../hub/agenda.ts";
import { isMemberOf } from "../hub/membership.ts";
import { linksFor, pageFor, pagesFor } from "../hub/knowledge.ts";
import { joinForming, leaveForming } from "../campaigns/forming-signup.ts";
import { loadProjectionTarget } from "../projection/target.ts";
import { takesIntent } from "../sessions/lifecycle.ts";
import type { InteractionUser } from "../discord/types.ts";

/**
 * `/api/hub/*`: the site's API, for everybody.
 *
 * The rest of `/api/*` is the organiser console and sits behind the organiser
 * gate. These routes do not: reads answer anybody and filter by
 * `src/hub/visibility.ts`; writes need a signed-in person and act only as them.
 * The id always comes off the session cookie, never off the request.
 *
 * Writes are refused unless they come from this origin. SameSite=Lax is not
 * enough on its own, because a sibling subdomain of the same site is
 * "same-site" and gets the cookie sent. So a write needs a content type of
 * exactly `application/json` (which no page can send cross-origin without a
 * preflight this origin never answers), and, when the browser says where the
 * request came from, it has to say this origin.
 */
type HubEnv = { Bindings: Env; Variables: { viewer: Viewer } };

export function hubRoutes() {
  const hub = new Hono<HubEnv>();

  hub.use("*", async (c, next) => {
    c.set("viewer", await viewerOf(c.env, c.req.header("cookie")));
    await next();
  });

  hub.get("/me", async (c) => {
    const viewer = c.get("viewer");
    if (!viewer.userId) return c.json({ signedIn: false });
    const user = await userRow(c.env, viewer.userId);
    if (!user) return c.json({ signedIn: false });
    return c.json({ signedIn: true, user: personFrom(user), organiser: viewer.organiser });
  });

  hub.get("/listings", async (c) =>
    c.json({ asOf: unixNow(), listings: await openListings(c.env, c.get("viewer")) }),
  );

  hub.get("/listings/:kind/:id", async (c) => {
    const kind = c.req.param("kind");
    if (kind !== "campaign" && kind !== "game-day") return c.json({ error: "No such listing." }, 404);
    const listing = await listingFor(c.env, kind, c.req.param("id"), c.get("viewer"));
    // Not there and not yours to see are the same answer, so a guess learns nothing.
    return listing
      ? c.json({ asOf: unixNow(), listing })
      : c.json({ error: "Kith has no listing here, or it is not public." }, 404);
  });

  /**
   * A table's own page: the listing, its links and its knowledge pages. The
   * table's visibility gates the lot; each link and page is then checked
   * against its own.
   */
  hub.get("/tables/:kind/:id", async (c) => {
    const kind = c.req.param("kind");
    if (kind !== "campaign" && kind !== "game-day") return c.json({ error: "No such table." }, 404);
    const id = c.req.param("id");
    const viewer = c.get("viewer");
    const listing = await listingFor(c.env, kind, id, viewer);
    if (!listing) return c.json({ error: "Kith has no table here, or it is not yours to see." }, 404);
    const member = await isMemberOf(c.env, kind, id, viewer.userId);
    return c.json({
      listing,
      member,
      canEdit: viewer.organiser,
      links: await linksFor(c.env, kind, id, viewer, member),
      pages: await pagesFor(c.env, kind, id, viewer, member),
    });
  });

  hub.get("/tables/:kind/:id/pages/:slug", async (c) => {
    const kind = c.req.param("kind");
    if (kind !== "campaign" && kind !== "game-day") return c.json({ error: "No such page." }, 404);
    const id = c.req.param("id");
    const viewer = c.get("viewer");
    const missing = c.json({ error: "Kith has no page here, or it is not yours to see." }, 404);
    if (!(await listingFor(c.env, kind, id, viewer))) return missing;
    const member = await isMemberOf(c.env, kind, id, viewer.userId);
    const page = await pageFor(c.env, kind, id, c.req.param("slug"), viewer, member);
    return page ? c.json({ page }) : missing;
  });

  hub.get("/games", async (c) => c.json({ games: await catalog(c.env) }));

  /** The hub: one card per game the viewer may see. */
  hub.get("/homes", async (c) => c.json({ asOf: unixNow(), games: await gamesFor(c.env, c.get("viewer")) }));

  /** One game's home base: a campaign's roster and sessions, or a board game's days. */
  hub.get("/homes/:slug", async (c) => {
    const home = await homeBase(c.env, c.req.param("slug"), c.get("viewer"));
    return home
      ? c.json({ asOf: unixNow(), home })
      : c.json({ error: "Kith has no game here, or it is not yours to see." }, 404);
  });

  hub.get("/agenda", async (c) => {
    const scope = c.req.query("scope") === "public" ? "public" : "mine";
    return c.json(await agendaFor(c.env, c.get("viewer"), scope, new Date()));
  });

  hub.post("/campaigns/:id/signup", async (c) => {
    const actor = await signedInActor(c);
    if (actor instanceof Response) return actor;
    const action = (await body(c)).action;
    const id = c.req.param("id");

    // Visibility first: a campaign you cannot see is not one you can join.
    const listing = await listingFor(c.env, "campaign", id, c.get("viewer"));
    if (!listing) return c.json({ error: "Kith has no listing here, or it is not public." }, 404);

    const outcome =
      action === "out"
        ? await leaveForming(c.env, id, actor.id)
        : action === "seat" || action === "waitlist"
          ? await joinForming(c.env, id, actor.id, action)
          : undefined;
    if (!outcome) return c.json({ error: "action is seat, waitlist or out" }, 400);
    if (outcome === "not-forming") return c.json({ error: "That campaign has stopped taking signups." }, 409);
    return c.json({ outcome, listing: await listingFor(c.env, "campaign", id, c.get("viewer")) });
  });

  hub.post("/game-days/:id/seat", async (c) => {
    const actor = await signedInActor(c);
    if (actor instanceof Response) return actor;
    const action = (await body(c)).action;
    const id = c.req.param("id");

    const listing = await listingFor(c.env, "game-day", id, c.get("viewer"));
    if (!listing) return c.json({ error: "Kith has no listing here, or it is not public." }, 404);
    if (!listing.open) return c.json({ error: "Seating for that day is closed." }, 409);

    // Through the day's lock, the same one the Discord buttons use, so a click
    // here and a click there cannot both take the last seat.
    const lock = c.env.SESSION_LOCK.get(c.env.SESSION_LOCK.idFromName(id));
    if (action === "seat" || action === "waitlist") {
      await lock.takeSeat({ gameDayId: id, actor, prefer: action });
    } else if (action === "out") {
      await lock.leaveSeat({ gameDayId: id, actor });
    } else {
      return c.json({ error: "action is seat, waitlist or out" }, 400);
    }
    return c.json({ listing: await listingFor(c.env, "game-day", id, c.get("viewer")) });
  });

  hub.post("/sessions/:id/intent", async (c) => {
    const actor = await signedInActor(c);
    if (actor instanceof Response) return actor;
    const intent = (await body(c)).intent;
    if (intent !== "in" && intent !== "out" && intent !== "maybe") {
      return c.json({ error: "intent is in, out or maybe" }, 400);
    }

    const sessionId = c.req.param("id");
    const target = await loadProjectionTarget(c.env, sessionId);
    if (!target) return c.json({ error: "Kith does not know that session." }, 404);
    if (!(await onTable(c.env, target, actor.id))) {
      return c.json({ error: "That is for the people at that table." }, 403);
    }
    if (!takesIntent(target.session)) {
      return c.json({ error: "That session has stopped taking answers." }, 409);
    }

    // The lock the attendance post's buttons go through: the click here that
    // crosses quorum confirms the session exactly as a click in Discord would.
    const lock = c.env.SESSION_LOCK.get(c.env.SESSION_LOCK.idFromName(sessionId));
    await lock.setIntent({ sessionId, actor, intent });
    return c.json({ ok: true, intent });
  });

  return hub;
}

/**
 * The site's organiser flag, remembered for a minute per person.
 *
 * One page load asks the hub three or four things, and each answer would
 * otherwise be a guild-member fetch. The flag here only decides what the site
 * *shows* (hidden listings, edit buttons); every organiser *write* goes through
 * the console's gate, which still reads the role fresh on every request.
 */
const ORGANISER_TTL_MS = 60_000;
const organiserSeen = new Map<string, { value: boolean; until: number }>();

async function viewerOf(env: Env, cookie: string | undefined): Promise<Viewer> {
  const session = await sessionFrom(env, cookie, new Date());
  if (!session) return ANONYMOUS;
  const seen = organiserSeen.get(session.userId);
  if (seen && seen.until > Date.now()) return { userId: session.userId, organiser: seen.value };

  let organiser = false;
  try {
    organiser = await isOrganiser(env, session.userId);
    organiserSeen.set(session.userId, { value: organiser, until: Date.now() + ORGANISER_TTL_MS });
  } catch (error) {
    // An unseeded role or Discord being slow means "not an organiser" here,
    // not a broken page for everybody. The console's gate still says 503.
    console.warn("organiser check failed on the site", error);
  }
  return { userId: session.userId, organiser };
}

/** For tests: forget every remembered organiser flag. */
export function forgetOrganisers(): void {
  organiserSeen.clear();
}

function userRow(env: Env, userId: string) {
  return db(env).select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
}

/** The signed-in person as the shape the locks take, or the response that refuses. */
async function signedInActor(c: Context<HubEnv>): Promise<InteractionUser | Response> {
  const mediaType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (mediaType !== "application/json") return c.json({ error: "Send JSON." }, 415);
  if (!sameOrigin(c)) return c.json({ error: "That did not come from Kith." }, 403);
  const userId = c.get("viewer").userId;
  if (!userId) return c.json({ error: "Sign in with Discord first." }, 401);
  const user = await userRow(c.env, userId);
  if (!user) return c.json({ error: "Sign in with Discord first." }, 401);
  return { id: user.discordId, username: user.username ?? user.discordId, global_name: user.globalName };
}

function sameOrigin(c: Context<HubEnv>): boolean {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = c.req.header("origin");
  return !origin || origin === new URL(c.req.url).origin;
}

async function body(c: Context<HubEnv>): Promise<Record<string, unknown>> {
  try {
    const parsed = (await c.req.json()) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** On the roster of the session's campaign, or holding a seat at (or hosting) its game day. */
async function onTable(
  env: Env,
  target: NonNullable<Awaited<ReturnType<typeof loadProjectionTarget>>>,
  userId: string,
): Promise<boolean> {
  const d = db(env);
  if (target.campaign) {
    const member = await d
      .select({ userId: schema.campaignMembers.userId })
      .from(schema.campaignMembers)
      .where(eq(schema.campaignMembers.campaignId, target.campaign.id))
      .all();
    return member.some((m) => m.userId === userId);
  }
  if (target.gameDay) {
    if (target.gameDay.hostUserId === userId) return true;
    const seats = await d
      .select({ userId: schema.signups.userId, state: schema.signups.state, type: schema.signups.targetType })
      .from(schema.signups)
      .where(eq(schema.signups.targetId, target.gameDay.id))
      .all();
    return seats.some((s) => s.type === "game_day" && s.userId === userId && s.state === "in");
  }
  return false;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
