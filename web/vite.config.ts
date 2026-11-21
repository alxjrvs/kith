import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The site is the Worker's static assets, so it builds into the folder
 * wrangler.jsonc points `assets.directory` at.
 *
 * `publicDir` is the repo's existing `public/`: the old organiser console and
 * the privacy page are copied through untouched, so `/console` and `/privacy`
 * keep working while their pages are ported.
 *
 * In dev, Vite serves the app and hands everything the Worker answers to
 * `wrangler dev` on its default port.
 */
const worker = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  publicDir: "../public",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": worker,
      "/console/login": worker,
      "/console/callback": worker,
      "/console/logout": worker,
      "/console/me": worker,
      "/ics": worker,
      "/privacy": worker,
    },
  },
});
