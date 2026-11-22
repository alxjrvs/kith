import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Header } from "./components/Header.tsx";
import { Home } from "./pages/Home.tsx";
import { Games } from "./pages/Games.tsx";
import { GameHome } from "./pages/GameHome.tsx";
import { Agenda } from "./pages/Agenda.tsx";
import { Profile } from "./pages/Profile.tsx";
import { Splash } from "./pages/Splash.tsx";
import { Landing } from "./pages/Landing.tsx";
import { useMe } from "./api.ts";
import { Table } from "./pages/Table.tsx";
import { GameKnowledgePage, TableKnowledgePage } from "./pages/KnowledgePage.tsx";
import { NotFound } from "./pages/NotFound.tsx";

/** Every page but the splash wears the site header. */
function Shell() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  );
}

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFound });
const shell = createRoute({ getParentRoute: () => rootRoute, id: "shell", component: Shell });

/**
 * The front page. Signed out, it is the landing: every game, one screen, and a
 * way in. Signed in, it is the usual home with the site header.
 */
function Front() {
  const me = useMe();
  if (me.isPending) return <div className="show" aria-busy="true" />;
  if (!me.data?.signedIn) return <Landing />;
  return (
    <>
      <Header />
      <Home />
    </>
  );
}

const home = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Front });
/** There is no searching for a game any more: the games are the hub. Old links land there. */
const find = createRoute({
  getParentRoute: () => shell,
  path: "/find",
  beforeLoad: () => {
    throw redirect({ to: "/games", replace: true });
  },
});
const games = createRoute({ getParentRoute: () => shell, path: "/games", component: Games });
/** A home base wears the splash, so like the splash it brings its own header. */
const gameHome = createRoute({ getParentRoute: () => rootRoute, path: "/games/$slug", component: GameHome });

/** A new page arrives with the title typed on the home base. */
const titleSearch = (search: Record<string, unknown>): { title?: string } =>
  typeof search.title === "string" ? { title: search.title } : {};

const gamePage = createRoute({
  getParentRoute: () => shell,
  path: "/games/$slug/$page",
  component: GameKnowledgePage,
  validateSearch: titleSearch,
});
const agenda = createRoute({ getParentRoute: () => shell, path: "/agenda", component: Agenda });
const profile = createRoute({ getParentRoute: () => shell, path: "/profile", component: Profile });
const table = createRoute({ getParentRoute: () => shell, path: "/table/$kind/$id", component: Table });
const knowledge = createRoute({
  getParentRoute: () => shell,
  path: "/table/$kind/$id/$slug",
  component: TableKnowledgePage,
  validateSearch: titleSearch,
});

/** The splash is full screen and brings its own header. */
const splash = createRoute({ getParentRoute: () => rootRoute, path: "/join/$kind/$id", component: Splash });

const routeTree = rootRoute.addChildren([shell.addChildren([find, games, gamePage, agenda, profile, table, knowledge]), home, gameHome, splash]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
