import { defineConfig } from "@playwright/test";

/** Browser e2e for the money paths (admin review #108).
 *
 * Boots a THROWAWAY admin-api (fresh SQLite in a temp dir, OIDC mode with the
 * built-in dev IdP) on :8899 and a vite instance proxying to it on :5199 —
 * completely isolated from any dev servers on :8800/:5174. Uses the system
 * Chrome (channel), so no browser download is needed.
 *
 * Run: npm run test:e2e
 */
const API = "http://127.0.0.1:8899";
const WEB = "http://localhost:5199";

const backendEnv = [
  "KATHA_PERSIST=1",
  `KATHA_DB_URL=sqlite+aiosqlite:////tmp/katha_e2e_${process.pid}.db`,
  "KATHA_ADMIN_AUTH=oidc",
  `KATHA_OIDC_REDIRECT_URL=${WEB}/admin/v1/auth/callback`,
  'KATHA_ADMIN_USERS=ops@katha.dev:admin,farah@katha.dev:finance',
  'PYTHONPATH=packages/domain:packages/ledger:packages/infra:services/admin-api:services/core-api',
].join(" ");

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    channel: "chrome",
    headless: true,
  },
  webServer: [
    {
      command: `cd ../../backend && ${backendEnv} .venv/bin/python -m uvicorn admin_app.main:app --port 8899`,
      url: `${API}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "KATHA_ADMIN_PROXY=http://127.0.0.1:8899 npx vite --port 5199 --strictPort",
      url: WEB,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
