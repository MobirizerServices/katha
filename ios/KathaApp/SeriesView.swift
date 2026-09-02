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
                VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                    SkeletonBlock(height: 260, radius: 0)
                    VStack(alignment: .leading, spacing: Katha.Spacing.md) {
                        SkeletonBlock(width: 220, height: 20, radius: 6)
                        SkeletonBlock(height: 60)
                        SkeletonBlock(height: 48)
                    }
                    .padding(.horizontal, Katha.Spacing.lg)
                }
            }
        }
        .background(Katha.Color.bg)
        .navigationBarTitleDisplayMode(.inline)
        .zoomDestination(id: slug)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.tap()
                    Task { await model.toggleMyList(slug: slug) }
                } label: {
                    Image(systemName: model.myListSlugs.contains(slug) ? "bookmark.fill" : "bookmark")
                        .accessibilityLabel(model.myListSlugs.contains(slug)
                                            ? "Remove from My list" : "Save to My list")
                        .foregroundStyle(model.myListSlugs.contains(slug)
                                         ? Katha.Color.accent : Katha.Color.text)
                        .symbolEffect(.bounce, value: model.myListSlugs.contains(slug))
                }
            }
        }
        .task { await load() }
    }

    private func content(_ d: SeriesDetail) -> some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            // Billboard — stretches under an over-pull, drifts on scroll.
            ZStack(alignment: .bottomLeading) {
                CoverImage(url: d.coverWideUrl)
                    .frame(height: 260)
                    .overlay {
                        // Scrim strong enough that the title reads over any key art
                        // (dev placeholder covers carry baked-in text of their own).
                        HeroScrim(stops: [(opacity: 0, location: 0),
                                          (opacity: 0.55, location: 0.62),
                                          (opacity: 0.98, location: 1)])
                    }
                    .visualEffect { content, proxy in
                        let minY = proxy.frame(in: .scrollView).minY
                        return content
                            .offset(y: minY > 0 ? -minY : 0)
                            .scaleEffect(minY > 0 ? 1 + minY / 500 : 1, anchor: .top)
                    }
                Text(d.title.uppercased())
                    .font(Katha.Font.display(34))
                    .foregroundStyle(Katha.Color.text)
                    .shadow(color: .black.opacity(0.6), radius: 6, y: 1)
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

                Text("Free · \(d.freeEpisodeCount) episodes, then \(d.episodeCoinPrice) coins (≈ ₹\(rupees(d.episodeCoinPrice, rate: model.rupeeRate))) each")
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)

                // The screen's one job: into the story in a single tap.
                if let cp = continuePoint {
                    NavigationLink(value: EpisodeRoute(slug: slug, number: cp.number)) {
                        primaryCTA("Continue E\(cp.number)")
                    }
                    .buttonStyle(PressableStyle())
                } else {
                    NavigationLink(value: EpisodeRoute(slug: slug, number: 1)) {
                        primaryCTA("Play episode 1")
                    }
                    .buttonStyle(PressableStyle())
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
        .background(LinearGradient(colors: [Katha.Color.accent, Katha.Color.accentPressed],
                                   startPoint: .top, endPoint: .bottom))
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
        let currentEp = continuePoint?.number
        return LazyVGrid(columns: cols, spacing: Katha.Spacing.sm) {
            ForEach(d.episodes) { ep in
                NavigationLink(value: EpisodeRoute(slug: d.slug, number: ep.number)) {
                    ZStack {
                        RoundedRectangle(cornerRadius: Katha.Radius.sm, style: .continuous)
                            .fill(ep.number == currentEp
                                  ? Katha.Color.accent.opacity(0.18) : Katha.Color.surface)
                        Text("\(ep.number)")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(ep.isFree || ep.number == currentEp
                                             ? Katha.Color.text : Katha.Color.text2)
                        if ep.number == currentEp {
                            Image(systemName: "play.fill")
                                .font(.system(size: 8))
                                .foregroundStyle(Katha.Color.accent)
                                .frame(maxWidth: .infinity, maxHeight: .infinity,
                                       alignment: .bottomTrailing)
                                .padding(4)
                        } else if !ep.isFree {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(Katha.Color.coin)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                                .padding(4)
                        }
                    }
                    .frame(height: 48)
                    .overlay(RoundedRectangle(cornerRadius: Katha.Radius.sm, style: .continuous)
                        .strokeBorder(ep.number == currentEp ? Katha.Color.accent : .clear,
                                      lineWidth: 1))
                    .accessibilityLabel("Episode \(ep.number)\(ep.isFree ? ", free" : ", locked")\(ep.number == currentEp ? ", continue here" : "")")
                }
                .buttonStyle(PressableStyle())
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
func rupees(_ coins: Int, rate: Double) -> String {
    let value = CoinMath.rupees(forCoins: coins, rupeePerCoin: rate)
    return value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
}
