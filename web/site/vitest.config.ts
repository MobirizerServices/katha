import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirror tsconfig paths: "@/*" -> project root.
    alias: { "@": resolve(__dirname, ".") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // Scope: the surface's real substance — coin economy logic, the live
      // api client, and every client component that holds behavior.
      include: ["lib/**/*.ts", "components/**/*.tsx"],
      exclude: [
        // seed_catalog.json is data, not code (v8 ignores JSON anyway).
        "lib/seed_catalog.json",
      ],
      // Enforced gate: matches the backend's --cov-fail-under=95 standard.
      // Below any threshold, `vitest run --coverage` exits non-zero.
      thresholds: {
        // Primary gate (matches backend --cov-fail-under=95). Below any of
        // these, `vitest run --coverage` exits non-zero.
        lines: 95,
        statements: 95,
        functions: 95,
        // Branch floor kept below the measured 85% so the honest gate is
        // stable; the untested branches are the hls.js-only playback paths
        // and defensive localStorage try/catch fallbacks that jsdom can't hit.
        branches: 80,
      },
    },
  },
});
