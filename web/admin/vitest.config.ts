import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest configuration for the admin SPA. Because this app is fully
// client-side, we hold ALL of src/ to a >=95% line-coverage gate (matching the
// backend's --cov-fail-under=95). Only the framework entry (main.tsx), the
// Vite ambient type file (vite-env.d.ts), and pure type declarations
// (api/types.ts) are excluded — none of them carry testable logic.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx", // framework entry/glue — mounts React root, not unit-testable
        "src/vite-env.d.ts", // Vite ambient type reference, no runtime code
        "src/api/types.ts", // pure TypeScript interfaces/types, no runtime code
      ],
      thresholds: {
        lines: 98,
        statements: 98,
        functions: 96,
        branches: 95,
      },
    },
  },
});
