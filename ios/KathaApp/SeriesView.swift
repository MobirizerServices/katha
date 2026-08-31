import SwiftUI
import KathaKit

/// Series detail — synopsis, tropes, and the episode grid with free/locked pips
/// (mockup §2/§3). Tapping a locked episode opens the player, which gates.
struct SeriesView: View {
    let slug: String
    @Environment(AppModel.self) private var model
    @State private var detail: SeriesDetail?
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let d = detail {
                content(d)
            } else if let error {
                Text(error).foregroundStyle(Katha.Color.danger).padding()
            } else {
                ProgressView().tint(Katha.Color.accent).padding(40)
            }
        }
        .background(Katha.Color.bg)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func content(_ d: SeriesDetail) -> some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            RoundedRectangle(cornerRadius: 0)
                .fill(Katha.Color.raised)
                .frame(height: 220)
                .overlay(alignment: .bottomLeading) {
                    Text(d.title)
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(Katha.Color.text)
                        .padding(Katha.Spacing.lg)
                }

            VStack(alignment: .leading, spacing: Katha.Spacing.md) {
                Text(d.genres.joined(separator: " · "))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Katha.Color.accent)
                Text(d.synopsis)
                    .font(.system(size: 15))
                    .foregroundStyle(Katha.Color.text2)
                Text("Free · \(d.freeEpisodeCount) episodes, then \(d.episodeCoinPrice) coins each")
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)
            }
            .padding(.horizontal, Katha.Spacing.lg)

            episodeGrid(d)
        }
    }

    private func episodeGrid(_ d: SeriesDetail) -> some View {
        let cols = Array(repeating: GridItem(.flexible(), spacing: Katha.Spacing.sm), count: 5)
        return LazyVGrid(columns: cols, spacing: Katha.Spacing.sm) {
            ForEach(d.episodes) { ep in
                NavigationLink(value: EpisodeRoute(slug: d.slug, number: ep.number)) {
                    ZStack {
                        RoundedRectangle(cornerRadius: Katha.Radius.sm, style: .continuous)
                            .fill(Katha.Color.surface)
                        Text("\(ep.number)")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                        if !ep.isFree {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(Katha.Color.coin)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                                .padding(4)
                        }
                    }
                    .frame(height: 48)
                }
            }
        }
        .padding(.horizontal, Katha.Spacing.lg)
        .navigationDestination(for: EpisodeRoute.self) { route in
            PlayerView(slug: route.slug, number: route.number,
                       bundleDiscountPct: d.bundleDiscountPct,
                       remainingLocked: d.episodeCount - d.freeEpisodeCount)
        }
    }

    private func load() async {
        do { detail = try await model.api.seriesDetail(slug: slug) }
        catch { self.error = String(describing: error) }
    }
}

struct EpisodeRoute: Hashable {
    let slug: String
    let number: Int
}
