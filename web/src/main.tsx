import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    // The data is a reading of D1 and every page says "as of"; a stale tab is
    // refetched when it is looked at again rather than on a timer.
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
