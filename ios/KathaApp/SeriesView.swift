import SwiftUI
import KathaKit

/// Series detail (mockup 2.4): billboard, rating badge, one primary job —
/// get the viewer into E1 or back where they left off — plus the episode grid.
struct SeriesView: View {
    let slug: String
    @Environment(AppModel.self) private var model
    @State private var detail: SeriesDetail?
    @State private var error: String?

    /// Where the viewer left off in THIS series, if anywhere.
    private var continuePoint: ContinueItem? {
        model.continueItems.first { $0.slug == slug }
    }

    var body: some View {
        ScrollView {
            if let d = detail {
                content(d)
            } else if error != nil {
                FeedErrorState(detail: error) { await load() }
                    .frame(minHeight: 400)
            } else {
                ProgressView().tint(Katha.Color.accent).padding(40)
            }
        }
        .background(Katha.Color.bg)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.toggleMyList(slug: slug) }
                } label: {
                    Image(systemName: model.myListSlugs.contains(slug) ? "bookmark.fill" : "bookmark")
                        .foregroundStyle(model.myListSlugs.contains(slug)
                                         ? Katha.Color.accent : Katha.Color.text)
                }
            }
        }
        .task { await load() }
    }

    private func content(_ d: SeriesDetail) -> some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            // Billboard
            ZStack(alignment: .bottomLeading) {
                CoverImage(url: d.coverWideUrl)
                    .frame(height: 230)
                    .overlay {
                        LinearGradient(colors: [.clear, Katha.Color.bg.opacity(0.9)],
                                       startPoint: .center, endPoint: .bottom)
                    }
                Text(d.title)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                    .padding(Katha.Spacing.lg)
            }

            VStack(alignment: .leading, spacing: Katha.Spacing.md) {
                // Chips: language · genre · RATING (IT Rules badge) · count
                HStack(spacing: 8) {
                    chip(d.primaryLanguage.uppercased())
                    if let g = d.genres.first { chip(g) }
                    if !d.contentRating.isEmpty {
                        Text(d.contentRating)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Katha.Color.text)
                            .padding(.horizontal, 7)
                            .frame(height: 20)
                            .overlay(RoundedRectangle(cornerRadius: 5)
                                .strokeBorder(Katha.Color.text2, lineWidth: 1))
                    }
                    chip("\(d.episodeCount) episodes")
                }

                Text(d.synopsis)
                    .font(.system(size: 15))
                    .foregroundStyle(Katha.Color.text2)

                Text("Free · \(d.freeEpisodeCount) episodes, then \(d.episodeCoinPrice) coins (≈ ₹\(rupees(d.episodeCoinPrice))) each")
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)

                // The screen's one job: into the story in a single tap.
                if let cp = continuePoint {
                    NavigationLink(value: EpisodeRoute(slug: slug, number: cp.number)) {
                        primaryCTA("Continue E\(cp.number)")
                    }
                } else {
                    NavigationLink(value: EpisodeRoute(slug: slug, number: 1)) {
                        primaryCTA("Play episode 1")
                    }
                }
            }
            .padding(.horizontal, Katha.Spacing.lg)

            episodeGrid(d)
        }
    }

    private func primaryCTA(_ title: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "play.fill")
            Text(title)
        }
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(Katha.Color.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Katha.Color.accent)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Katha.Color.text2)
            .padding(.horizontal, 8)
            .frame(height: 20)
            .background(Katha.Color.surface)
            .clipShape(Capsule())
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
    }

    private func load() async {
        do {
            detail = try await model.api.seriesDetail(slug: slug)
            error = nil
        } catch { self.error = String(describing: error) }
    }
}

/// Rupee display helper (30 coins ≈ ₹4.5 — PDD "Honest coins" principle).
func rupees(_ coins: Int) -> String {
    let value = CoinMath.rupees(forCoins: coins)
    return value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
}
