# web/admin — Katha back office

React 19 + Vite. Talks only to admin-api (`/admin/v1`, proxied by the dev server).
The 112-finding admin review is fully implemented here; the historical mockup is
`docs/Katha_Admin_Dashboard_v0.2.html`.

What it does: OIDC sign-in (dev IdP locally, Google Workspace via env — see
`docs/Katha_Admin_OIDC_Setup_v0.1.md`) with server-side roles and step-up for money
actions; a business analytics board (windowed KPIs, funnel, revenue split, coin
liability); users/money desk (search, risk flags, adjust with dual approval, refunds,
DPDP export/erase, devices + sign-out-everywhere); catalog lifecycle with drafts,
pricing, rights and retitles; percentage rollouts + an experiment registry; the
hash-chain-verified audit log with annotations; the IT-Rules grievance queue; ⌘K.

Honest-offline principle: with no server the views render sample data behind a
banner and every mutation is disabled — the UI never fakes success.

```sh
npx vite --port 5174        # needs admin-api on :8800 (make admin from the repo root)
npm run coverage            # 218 tests; gates 98 lines / 95 branches / 96 functions
npm run test:e2e            # Playwright money-path suite (system Chrome, throwaway servers)
```

Sign in as `ops@katha.dev` (bootstrap admin); provision everyone else in
Roles & access. `src/api/paths.generated.ts` is generated — run
`make gen-contracts` after changing admin-api routes or the drift gates fail.
