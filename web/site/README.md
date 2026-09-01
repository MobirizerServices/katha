# web/site — Katha public site + web watch app

Next.js 15. Two modes on one codebase (SAD §5.5): public indexable marketing + SEO
series pages (free playback), and a logged-in `noindex` web watch app + UPI coin store
(hls.js player). Reviewed design: `docs/Katha_Website_v0.1.html`, `docs/Katha_WebApp_v0.1.html`.

    npm install && npm run dev   # :3000 — needs core-api on :8799 (make api) for the live catalog
    npm run coverage             # 76 tests; gates 98 lines / 95 branches / 96 functions

Wired to the live ledger end-to-end: guest → OTP → UPI pack (+10% web bonus)
→ unlock → plays. The few uncovered branches are hls.js internals jsdom cannot
reach; real-browser checks cover playback.
