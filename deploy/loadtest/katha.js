// k6 load test (P1-6): ramps to ~120 virtual users against the QA stack and
// exercises the read-hot public paths a tester cohort actually hits — home
// feed, remote config, a series page, and a playback authorization. Money
// mutations are deliberately excluded (they'd pollute the ledger); point a
// separate signed-in soak run at those once QA has seed accounts.
//
//   BASE_URL=https://qa.katha.example k6 run deploy/loadtest/katha.js
//
// Thresholds fail the run if p95 latency or the error rate blow past target,
// so this doubles as a release gate before opening QA to the 100 testers.
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:8799";

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
