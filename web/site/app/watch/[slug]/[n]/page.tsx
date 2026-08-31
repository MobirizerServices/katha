import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Player from "@/components/Player";
import { getSeries, allSlugs } from "@/lib/catalog";

export function generateStaticParams() {
  // Pre-render episode 1 of each series; deeper episodes render on demand.
  return allSlugs().map((slug) => ({ slug, n: "1" }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; n: string }>;
}): Promise<Metadata> {
  const { slug, n } = await params;
  const s = getSeries(slug);
  if (!s) return { title: "Watch" };
  return { title: `${s.title} · E${n}`, robots: { index: false } };
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ slug: string; n: string }>;
}) {
  const { slug, n } = await params;
  const s = getSeries(slug);
  const num = Number(n);
  if (!s || !Number.isInteger(num) || num < 1 || num > s.episodeCount) notFound();
  return <Player series={s} n={num} />;
}
