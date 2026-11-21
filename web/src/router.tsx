import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Header } from "./components/Header.tsx";
import { Home } from "./pages/Home.tsx";
import { Find } from "./pages/Find.tsx";
import { Catalog } from "./pages/Catalog.tsx";
import { Agenda } from "./pages/Agenda.tsx";
import { Profile } from "./pages/Profile.tsx";
import { Splash } from "./pages/Splash.tsx";
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

const home = createRoute({ getParentRoute: () => shell, path: "/", component: Home });
const find = createRoute({ getParentRoute: () => shell, path: "/find", component: Find });
const games = createRoute({ getParentRoute: () => shell, path: "/games", component: Catalog });
const agenda = createRoute({ getParentRoute: () => shell, path: "/agenda", component: Agenda });
const profile = createRoute({ getParentRoute: () => shell, path: "/profile", component: Profile });

/** The splash is full screen and brings its own header. */
const splash = createRoute({ getParentRoute: () => rootRoute, path: "/join/$kind/$id", component: Splash });

const routeTree = rootRoute.addChildren([shell.addChildren([home, find, games, agenda, profile]), splash]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
