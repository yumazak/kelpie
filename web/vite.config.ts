import { fileURLToPath, URL } from "node:url";

import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The dev server proxies the API to a locally running `kelpie serve`, so the
// browser talks to one origin in development exactly as it does behind the
// front door in production. `KELPIE_API` points it at a different port, e.g.
// the debug binary on 7182 while the installed service holds 7180.
const apiTarget = process.env.KELPIE_API ?? "http://127.0.0.1:7180";

export default defineConfig({
  // `tanstackRouter` generates `src/routeTree.gen.ts` and splits each route's
  // component into its own chunk. It must run before the React plugin.
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": apiTarget,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
