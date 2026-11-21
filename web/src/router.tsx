import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Header } from "./components/Header.tsx";
import { Home } from "./pages/Home.tsx";
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

const routeTree = rootRoute.addChildren([shell.addChildren([home])]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
