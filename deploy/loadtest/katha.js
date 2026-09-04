// k6 load test (P1-6): ramps to ~120 virtual users against the QA stack and
// exercises the read-hot public paths a tester cohort actually hits — home
// feed, remote config, a series page, and a playback authorization — plus,
// when JWT_SECRET is given, a signed-in scenario over the write path.
//
//   BASE_URL=https://qa.katha.example JWT_SECRET=$KATHA_JWT_SECRET k6 run deploy/loadtest/katha.js
//
// Thresholds fail the run if p95 latency or the error rate blow past target,
// so this doubles as a release gate before opening QA to the 100 testers.
import http from "k6/http";
import { check, sleep } from "k6";
import crypto from "k6/crypto";
import encoding from "k6/encoding";

const BASE = __ENV.BASE_URL || "http://localhost:8799";
// Signed-in scenario: give k6 the QA JWT secret and it mints a bearer per VU
// (HS256, same claims the API issues) so /v1/wallet, member playback and a
// free-episode unlock — the write path — run under load too. Money is never
// moved: unlocking a FREE episode grants an entitlement for 0 coins.
const JWT_SECRET = __ENV.JWT_SECRET || "";

function b64url(s) {
  return encoding.b64encode(s, "rawurl");
}
function mintJwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ sub, iat: now, exp: now + 3600, ver: 0 }));
  const sig = crypto.hmac("sha256", JWT_SECRET, `${head}.${body}`, "base64rawurl");
  return `${head}.${body}.${sig}`;
}

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 40 },
        { duration: "2m", target: 120 },
        { duration: "3m", target: 120 },
        { duration: "1m", target: 0 },
      ],
    },
    ...(JWT_SECRET ? {
      member: {
        executor: "ramping-vus",
        exec: "member",
        startVUs: 0,
        stages: [
          { duration: "1m", target: 20 },
          { duration: "4m", target: 60 },
          { duration: "1m", target: 0 },
        ],
      },
    } : {}),
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],          // <1% errors
    http_req_duration: ["p(95)<500"],        // p95 under 500ms
    "http_req_duration{name:playback}": ["p(95)<800"],
  },
};

export default function () {
  check(http.get(`${BASE}/health`), { "health 200": (r) => r.status === 200 });

  const home = http.get(`${BASE}/v1/home?lang=hi`, { tags: { name: "home" } });
  check(home, { "home 200": (r) => r.status === 200 });

  http.get(`${BASE}/v1/config`, { tags: { name: "config" } });

  // Pull a real slug from the home feed and authorize episode 1 playback.
  let slug = "kaanch-ka-mahal";
  try {
    const rows = home.json("rows");
    if (rows && rows[0] && rows[0].series && rows[0].series[0]) {
      slug = rows[0].series[0].slug;
    }
  } catch (_) { /* fall back to the seed slug */ }

  const pb = http.post(`${BASE}/v1/series/${slug}/episodes/1/playback`, null, {
    tags: { name: "playback" },
  });
  check(pb, { "playback ok": (r) => r.status === 200 });

  sleep(Math.random() * 2 + 1);
}


/** Signed-in path (needs JWT_SECRET): wallet read, member playback auth, and a
 *  free-episode unlock with a unique idempotency key — the locked write path
 *  (ledger transaction + entitlement row) under Postgres contention. */
export function member() {
  const sub = `usr_loadtest_${__VU}`;
  const auth = { headers: { Authorization: `Bearer ${mintJwt(sub)}`, "Content-Type": "application/json" } };
  check(http.get(`${BASE}/v1/wallet`, { ...auth, tags: { name: "wallet" } }),
        { "wallet 200": (r) => r.status === 200 });
  const slug = "kaanch-ka-mahal";
  const ep = 1 + (__ITER % 10);                 // stays inside the free window
  check(http.post(`${BASE}/v1/series/${slug}/episodes/${ep}/playback`, null,
                  { ...auth, tags: { name: "playback_member" } }),
        { "member playback 200": (r) => r.status === 200 });
  const key = `k6-${__VU}-${__ITER}-${Date.now()}`;
  check(http.post(`${BASE}/v1/series/${slug}/episodes/${ep}/unlock`,
                  JSON.stringify({ idempotency_key: key }),
                  { ...auth, tags: { name: "unlock_free" } }),
        { "free unlock 200, 0 coins": (r) => r.status === 200 && r.json("spent_bought") === 0 });
  sleep(Math.random() * 2 + 1);
}
