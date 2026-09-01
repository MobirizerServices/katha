import { defineConfig } from "vite";

// vite.config runs under node; the project deliberately carries no @types/node.
declare const process: { env: Record<string, string | undefined> };
import react from "@vitejs/plugin-react";

// Dev proxy: admin-api is expected at /admin/v1. In production the SPA is
// served behind the same gateway. The client has a static mock fallback so
// the app builds and renders even when no server is reachable.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/admin/v1": {
        // e2e runs point this at a throwaway admin-api (playwright.config.ts)
        target: process.env.KATHA_ADMIN_PROXY || "http://localhost:8800",
        changeOrigin: true,
      },
    },
  },
});
