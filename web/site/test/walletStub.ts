import { vi } from "vitest";
import type { WalletCtx } from "@/components/WalletProvider";

/** A controllable wallet context for component tests. */
export function makeWallet(over: Partial<WalletCtx> = {}): WalletCtx {
  return {
    signed: false,
    phone: "",
    name: "",
    bought: 0,
    bonus: 0,
    balance: 0,
    ready: true,
    signIn: vi.fn(async () => true),
    signOut: vi.fn(),
    openSignIn: vi.fn(),
    unlockEpisode: vi.fn(async () => ({ ok: true as const, spent: 30 })),
    unlockBundle: vi.fn(async () => ({ ok: true as const, spent: 1395 })),
    purchase: vi.fn(async () => 0),
    refreshWallet: vi.fn(async () => {}),
    toast: vi.fn(),
    ...over,
  };
}

/** A SeriesSummary as the catalog endpoints return it. */
export function summary(slug: string, over: Partial<{
  title: string; genres: string[]; episode_count: number; primary_language: string; content_rating: string;
}> = {}) {
  return {
    slug,
    title: over.title ?? slug.replace(/-/g, " "),
    genres: over.genres ?? ["Romance"],
    episode_count: over.episode_count ?? 60,
    primary_language: over.primary_language ?? "hi",
    content_rating: over.content_rating ?? "U/A 13+",
    cover_url: `http://localhost:8799/media/${slug}/cover_9x16.jpg`,
    cover_wide_url: `http://localhost:8799/media/${slug}/cover_16x9.jpg`,
  };
}
