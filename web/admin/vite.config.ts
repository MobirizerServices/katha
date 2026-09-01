import { defineConfig } from "vite";
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
        target: "http://localhost:8800",
        changeOrigin: true,
      },
    },
  },
});
