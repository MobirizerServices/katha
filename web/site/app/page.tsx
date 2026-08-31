// Katha home (public). Design reference: docs/Katha_Website_v0.1.html.
// Fetches the live catalog from core-api; falls back to a message if it is offline.
async function getSeries() {
  try {
    const r = await fetch("http://localhost:8799/v1/series", { cache: "no-store" });
    return (await r.json()) as { slug: string; title: string; episode_count: number }[];
  } catch {
    return [];
  }
}

export default async function Home() {
  const series = await getSeries();
  return (
    <main style={{ fontFamily: "system-ui", padding: 32, background: "#0B0B0F", color: "#F5F5F7", minHeight: "100vh" }}>
      <h1>Katha — Stories in 2 minutes</h1>
      <p style={{ color: "#A1A1AA" }}>First 10 episodes free · unlock the rest with coins.</p>
      <ul>
        {series.map((s) => (
          <li key={s.slug}>{s.title} — {s.episode_count} episodes</li>
        ))}
      </ul>
      {series.length === 0 && <p>Start core-api on :8799 to see the live catalog.</p>}
    </main>
  );
}
