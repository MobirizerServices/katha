import SwiftUI
import KathaKit

/// Series detail (mockup 2.4): billboard, rating badge, one primary job —
/// get the viewer into E1 or back where they left off — plus the episode grid.
struct SeriesView: View {
    let slug: String
    @Environment(AppModel.self) private var model
    @State private var detail: SeriesDetail?
    @State private var error: String?
    @State private var toast: String?

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
        // Without a bar background the CTA and the pricing line slid under the
        // status bar and behind the glass toolbar buttons on the way up.
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .zoomDestination(id: slug)
        .overlay(alignment: .bottom) {
            if let toast {
                ToastView(text: toast)
                    .padding(.bottom, 30)
                    .task { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                    .transition(.opacity)
            }
        }
        .animation(Katha.Motion.spring, value: toast)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ReminderBell(slug: slug) { toast = $0 }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.tap()
                    Task { await model.toggleMyList(slug: slug) }
                } label: {
                    Image(systemName: model.myListSlugs.contains(slug) ? "bookmark.fill" : "bookmark")
                        .accessibilityLabel(model.t(model.myListSlugs.contains(slug)
                                                    ? "series.unsave" : "series.save"))
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
                            .kathaFont(11, weight: .bold)
                            .foregroundStyle(Katha.Color.text)
                            .padding(.horizontal, 7)
                            .kathaFrame(height: 20)
                            .overlay(RoundedRectangle(cornerRadius: 5)
                                .strokeBorder(Katha.Color.text2, lineWidth: 1))
                    }
                    chip(model.t("home.episodes", d.episodeCount))
                }

                Text(d.synopsis)
                    .kathaFont(15)
                    .foregroundStyle(Katha.Color.text2)

                Text(model.t("series.pricing", d.freeEpisodeCount, d.episodeCoinPrice,
                             model.rupeeRate.map { " (≈ ₹\(rupees(d.episodeCoinPrice, rate: $0)))" } ?? ""))
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.text2)

                // The screen's one job: into the story in a single tap.
                if let cp = continuePoint {
                    NavigationLink(value: EpisodeRoute(slug: slug, number: cp.number)) {
                        primaryCTA(model.t("series.continue", cp.number))
                    }
                    .buttonStyle(PressableStyle())
                } else {
                    NavigationLink(value: EpisodeRoute(slug: slug, number: 1)) {
                        primaryCTA(model.t("series.play1"))
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
        .kathaFont(16, weight: .semibold)
        .foregroundStyle(Katha.Color.text)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(LinearGradient(colors: [Katha.Color.accent, Katha.Color.accentPressed],
                                   startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .kathaFont(11, weight: .semibold)
            .foregroundStyle(Katha.Color.text2)
            .padding(.horizontal, 8)
            .kathaFrame(height: 20)
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
                            .kathaFont(14, weight: .semibold)
                            .foregroundStyle(ep.isFree || ep.number == currentEp
                                             ? Katha.Color.text : Katha.Color.text2)
                        if ep.number == currentEp {
                            Image(systemName: "play.fill")
                                .kathaFont(8)
                                .foregroundStyle(Katha.Color.accent)
                                .frame(maxWidth: .infinity, maxHeight: .infinity,
                                       alignment: .bottomTrailing)
                                .padding(4)
                        } else if !ep.isFree {
                            Image(systemName: "lock.fill")
                                .kathaFont(9)
                                .foregroundStyle(Katha.Color.coin)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                                .padding(4)
                        }
                    }
                    .kathaFrame(height: 48)
                    .overlay(RoundedRectangle(cornerRadius: Katha.Radius.sm, style: .continuous)
                        .strokeBorder(ep.number == currentEp ? Katha.Color.accent : .clear,
                                      lineWidth: 1))
                    .accessibilityLabel(model.t("series.episode", ep.number)
                        + model.t(ep.isFree ? "series.episode.free" : "series.episode.locked")
                        + (ep.number == currentEp ? model.t("series.episode.here") : ""))
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

/// The new-episode reminder bell for one series (My list 4.4 "Reminder on",
/// and the series toolbar). State lives in AppModel.reminderSlugs.
struct ReminderBell: View {
    enum Style {
        /// Bell glyph only — the series toolbar.
        case glyph
        /// Bell + label in a capsule — My list, where the caption under the
        /// poster is itself the control and has to look like one.
        case capsule
    }

    let slug: String
    var style: Style = .glyph
    var onToggled: ((String) -> Void)? = nil
    @Environment(AppModel.self) private var model

    private var isOn: Bool { model.reminderSlugs.contains(slug) }

    var body: some View {
        Button {
            Haptics.tap()
            let turningOn = !isOn
            Task {
                await model.toggleReminder(slug: slug)
                onToggled?(model.t(turningOn ? "reminder.toast.on" : "reminder.toast.off"))
            }
        } label: {
            switch style {
            case .glyph:
                bell
            case .capsule:
                HStack(spacing: 4) {
                    bell
                    Text(model.t(isOn ? "reminder.on" : "reminder.off"))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .kathaFont(12, weight: .semibold)
                .padding(.horizontal, 9)
                .kathaFrame(height: 26)
                .background(isOn ? Katha.Color.coin.opacity(0.16) : Katha.Color.surface)
                .overlay(Capsule().strokeBorder(isOn ? Katha.Color.coin.opacity(0.5)
                                                     : Katha.Color.raised, lineWidth: 1))
                .clipShape(Capsule())
            }
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(model.t(isOn ? "reminder.on" : "reminder.off"))
        .accessibilityHint(model.t("series.reminderHint"))
        .accessibilityIdentifier("reminder.\(slug)")
        .accessibilityValue(isOn ? "on" : "off")
    }

    private var bell: some View {
        Image(systemName: isOn ? "bell.fill" : "bell")
            .foregroundStyle(isOn ? Katha.Color.coin : Katha.Color.text)
            .symbolEffect(.bounce, value: isOn)
    }
}

/// Rupee display helper (30 coins ≈ ₹4.5 — PDD "Honest coins" principle).
func rupees(_ coins: Int, rate: Double) -> String {
    let value = CoinMath.rupees(forCoins: coins, rupeePerCoin: rate)
    return value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
}
