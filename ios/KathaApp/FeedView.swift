import SwiftUI
@preconcurrency import AVFoundation
import KathaKit

/// Home (mockup 2.1): check-in card pinned on top, one large For You hero,
/// a continue-watching row, then curated rows. States: loaded / loading /
/// offline-with-retry — never a blank screen.
struct FeedView: View {
    @Environment(AppModel.self) private var model
    @State private var claimedToast: Int?

    var body: some View {
        content
            .background(Katha.Color.bg)
            // One header band, one row: the masthead rides the toolbar's
            // principal slot beside the controls instead of costing the feed a
            // second full row underneath an otherwise empty bar. The ribbon is
            // a safe-area inset, so it stays pinned under the bar as its rule.
            .toolbar {
                ToolbarItem(placement: .principal) { masthead }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        languageMenu
                        NavigationLink(value: SearchRoute()) {
                            Image(systemName: "magnifyingglass")
                                .kathaFont(16, weight: .semibold)
                                .foregroundStyle(Katha.Color.text)
                                .accessibilityLabel(model.t("home.search"))
                        }
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Katha.Color.bg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) { BrandRibbon() }
            .navigationDestination(for: SearchRoute.self) { _ in SearchView() }
            .navigationDestination(for: ContinueRoute.self) { _ in ContinueWatchingView() }
            .task {
                if model.feed.rows.isEmpty { await model.loadHome() }
                // Returning from the player: let its final progress flush land,
                // then refresh the continue row.
                try? await Task.sleep(for: .milliseconds(400))
                await model.loadEngagement()
            }
            .overlay(alignment: .bottom) {
                if let coins = claimedToast {
                    ToastView(text: model.t("home.checkin.toast", coins))
                        .padding(.bottom, 30)
                        .task { try? await Task.sleep(for: .seconds(2)); claimedToast = nil }
                }
            }
    }

    /// The literary signature: serif-italic wordmark + Devanagari echo, sized so
    /// it fits the toolbar's principal slot beside the trailing controls.
    private var masthead: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("Katha")
                .kathaFont(20, weight: .bold, design: .serif, relativeTo: .title3).italic()
                .foregroundStyle(Katha.Color.text)
            Text("कथा")
                .kathaFont(13, weight: .semibold)
                .foregroundStyle(Katha.Color.text2)
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Katha")
    }

    private var nativeLanguageName: String {
        ["hi": "हिन्दी", "ta": "தமிழ்", "te": "తెలుగు"][model.contentLanguage] ?? "हिन्दी"
    }

    private var languageMenu: some View {
        Menu {
            ForEach([("hi", "हिन्दी"), ("ta", "தமிழ்"), ("te", "తెలుగు")], id: \.0) { code, native in
                Button {
                    model.contentLanguage = code
                    Task { await model.loadHome(lang: code) }
                } label: {
                    if model.contentLanguage == code { Label(native, systemImage: "checkmark") }
                    else { Text(native) }
                }
            }
        } label: {
            Text(nativeLanguageName)
                .kathaFont(13, weight: .semibold)
                .foregroundStyle(Katha.Color.text)
                .padding(.horizontal, 10)
                .kathaFrame(height: 28)
                .background(Katha.Color.surface)
                .clipShape(Capsule())
        }
        // The value alone ("हिन्दी") says nothing about what the control does.
        .accessibilityLabel(model.t("home.contentLanguage"))
        .accessibilityValue(nativeLanguageName)
    }

    // Three states: the feed if we have it; otherwise an error-with-retry when the
    // load failed and there is nothing to show, or a spinner while loading.
    @ViewBuilder private var content: some View {
        if model.feed.rows.isEmpty && model.loadError != nil {
            FeedErrorState(detail: model.loadError) { await model.loadHome() }
        } else if model.feed.rows.isEmpty {
            FeedLoadingState()
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                    if !model.checkinClaimedToday {
                        checkinCard
                            .coachAnchor(.checkin)
                            .transition(.scale(scale: 0.92).combined(with: .opacity))
                    }
                    if let hero = model.feed.rows.first?.series.first { HeroCard(series: hero) }
                    if !model.continueItems.isEmpty { continueRow }
                    ForEach(model.feed.rows) { row in
                        FeedRow(row: row)
                    }
                }
                .padding(.vertical, Katha.Spacing.lg)
                .animation(Katha.Motion.spring, value: model.checkinClaimedToday)
            }
            .refreshable { await model.loadHome(); await model.loadEngagement() }
        }
    }

    // MARK: check-in (5 coins/day, PDD §8.2)

    private var checkinCard: some View {
        HStack(spacing: Katha.Spacing.md) {
            ZStack {
                Circle()
                    .fill(LinearGradient(colors: [Katha.Color.coin,
                                                  Katha.Color.coin.opacity(0.55)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 34, height: 34)
                Image(systemName: "indianrupeesign")
                    .kathaFont(14, weight: .bold)
                    .foregroundStyle(Katha.Color.bg)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(model.t("home.checkin.title"))
                    .kathaFont(15, weight: .semibold)
                    .foregroundStyle(Katha.Color.text)
                Text(model.checkinCoins.map { model.t("home.checkin.body", $0) }
                     ?? model.t("home.checkin.body.plain"))
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.text2)
            }
            Spacer()
            Button {
                Task {
                    claimedToast = await model.claimCheckin()
                    if claimedToast != nil { Haptics.success() }
                }
            } label: {
                Text(model.t("home.checkin.claim"))
                    .kathaFont(14, weight: .semibold)
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 16)
                    .kathaFrame(height: 36)
                    .background(Katha.Color.accent)
                    .clipShape(Capsule())
            }
            .buttonStyle(PressableStyle())
        }
        .padding(.horizontal, Katha.Spacing.lg)
        .padding(.vertical, Katha.Spacing.md)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
            .strokeBorder(Katha.Color.coin.opacity(0.25), lineWidth: 1))
        .padding(.horizontal, Katha.Spacing.lg)
        .accessibilityElement(children: .combine)
    }

    // MARK: continue watching

    private var continueRow: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
            HStack {
                Text(model.t("continue.title"))
                    .kathaLabel(14)
                    .kerning(1.2)
                    .foregroundStyle(Katha.Color.text2)
                Spacer()
                NavigationLink(value: ContinueRoute()) {
                    HStack(spacing: 3) {
                        Text(model.t("continue.seeAll"))
                        Image(systemName: "chevron.right").kathaFont(10, weight: .bold)
                    }
                    .kathaFont(13, weight: .semibold)
                    .foregroundStyle(Katha.Color.accent)
                }
                .accessibilityIdentifier("continue.seeAll")
            }
            .padding(.horizontal, Katha.Spacing.lg)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Katha.Spacing.md) {
                    ForEach(model.continueItems) { item in
                        NavigationLink(value: EpisodeRoute(slug: item.slug, number: item.number)) {
                            VStack(alignment: .leading, spacing: 6) {
                                ZStack(alignment: .bottom) {
                                    CoverImage(url: model.coverURL(forSlug: item.slug, wide: true))
                                        .frame(width: 168, height: 96)
                                        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md,
                                                                    style: .continuous))
                                        .overlay {
                                            Image(systemName: "play.fill")
                                                .foregroundStyle(Katha.Color.text)
                                                .shadow(radius: 4)
                                        }
                                    // A track behind the fill: a lone 4 pt sliver
                                    // over key art reads as an artefact, not
                                    // progress.
                                    GeometryReader { geo in
                                        ZStack(alignment: .leading) {
                                            Capsule().fill(.black.opacity(0.45))
                                            Capsule().fill(Katha.Color.accent)
                                                .frame(width: max(8, geo.size.width * CGFloat(item.percent) / 100))
                                        }
                                    }
                                    .frame(height: 5)
                                    .padding(.horizontal, 6)
                                    .padding(.bottom, 6)
                                }
                                Text(model.title(forSlug: item.slug))
                                    .kathaFont(12, weight: .semibold)
                                    .foregroundStyle(Katha.Color.text)
                                    .lineLimit(1)
                                    .frame(width: 168, alignment: .leading)
                                Text(ContinueWatchingView.subtitle(for: item, model))
                                    .kathaFont(11)
                                    .foregroundStyle(Katha.Color.text2)
                                    .lineLimit(1)
                                    .frame(width: 168, alignment: .leading)
                            }
                            .accessibilityElement(children: .combine)
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(.horizontal, Katha.Spacing.lg)
            }
        }
    }
}

/// The big For You card (2.1): tagline + Play E1, "Free · 10 episodes" badge.
private struct HeroCard: View {
    @Environment(AppModel.self) private var model
    let series: SeriesSummary

    var body: some View {
        NavigationLink(value: series.slug) {
            ZStack(alignment: .bottomLeading) {
                CoverImage(url: series.coverWideUrl)
                    .frame(height: 500)
                    .overlay {
                        // Muted E1 preview (mockup 2.1) — off under data saver
                        // and via Settings → "Autoplay trailers".
                        if model.previewsMuted && !model.dataSaver {
                            HeroPreview(slug: series.slug)
                        }
                    }
                    .overlay {
                        // Fade seamlessly into the page ground — full-bleed,
                        // no card frame: the story IS the screen.
                        HeroScrim(stops: [(opacity: 0, location: 0.45),
                                          (opacity: 0.75, location: 0.82),
                                          (opacity: 1, location: 1)])
                    }
                    .clipped()
                    // The art drifts slower than the scroll — quiet depth.
                    .visualEffect { content, proxy in
                        let minY = proxy.frame(in: .scrollView).minY
                        return content.offset(y: minY < 0 ? -minY * 0.18 : 0)
                    }
                VStack(alignment: .leading, spacing: 10) {
                    Text(series.title.uppercased())
                        .font(Katha.Font.display(42))
                        .foregroundStyle(Katha.Color.text)
                        .multilineTextAlignment(.leading)
                        .shadow(color: .black.opacity(0.5), radius: 8, y: 2)
                    Text(([series.genres.first, model.t("home.episodes", series.episodeCount),
                           series.freeEpisodeCount > 0 && series.freeEpisodeCount < series.episodeCount
                               ? model.t("home.firstFree", series.freeEpisodeCount) : nil]
                        .compactMap { $0 }.filter { !$0.isEmpty }).joined(separator: " · "))
                        .kathaFont(13, weight: .medium)
                        .foregroundStyle(Katha.Color.text2)
                        .lineLimit(1)
                    NavigationLink(value: EpisodeRoute(slug: series.slug, number: 1)) {
                        HStack(spacing: 6) {
                            Image(systemName: "play.fill")
                            Text(model.t("home.playE1"))
                        }
                        .kathaFont(15, weight: .semibold)
                        .foregroundStyle(Katha.Color.text)
                        .padding(.horizontal, 20)
                        .kathaFrame(height: 42)
                        .background(LinearGradient(colors: [Katha.Color.accent,
                                                            Katha.Color.accentPressed],
                                                   startPoint: .top, endPoint: .bottom))
                        .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, Katha.Spacing.lg)
                .padding(.bottom, Katha.Spacing.sm)
            }
        }
        .buttonStyle(PressableStyle())
        .zoomSource(id: series.slug)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(model.t("home.featured", series.title))
    }
}

struct SearchRoute: Hashable {}

private struct FeedRow: View {
    let row: HomeRow

    /// The personalized rail gets a spark so "picked for you" reads at a glance.
    private var isPersonal: Bool { row.title.hasPrefix("Because you watched") }

    var body: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
            HStack(spacing: 6) {
                if isPersonal {
                    Image(systemName: "sparkles")
                        .kathaFont(14, weight: .bold)
                        .foregroundStyle(Katha.Color.accent)
                }
                Text(row.title)
                    .kathaLabel(14)
                    .kerning(1.2)
                    .foregroundStyle(isPersonal ? Katha.Color.text : Katha.Color.text2)
            }
            .padding(.horizontal, Katha.Spacing.lg)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Katha.Spacing.md) {
                    ForEach(row.series) { series in
                        NavigationLink(value: series.slug) {
                            PosterCard(series: series)
                        }
                        .buttonStyle(PressableStyle())
                        // Cards ease in from the rail's edges.
                        .scrollTransition(axis: .horizontal) { content, phase in
                            content
                                .opacity(phase.isIdentity ? 1 : 0.6)
                                .scaleEffect(phase.isIdentity ? 1 : 0.94)
                        }
                    }
                }
                .padding(.horizontal, Katha.Spacing.lg)
            }
        }
    }
}

/// Cover art over the gradient placeholder — the gradient shows while the image
/// loads and stays as the fallback when a series has no artwork yet.
struct CoverImage: View {
    let url: String

    var body: some View {
        LinearGradient(colors: [Katha.Color.raised, Katha.Color.bg],
                       startPoint: .top, endPoint: .bottom)
            .overlay {
                if let u = URL(string: url), !url.isEmpty {
                    AsyncImage(url: u) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        }
                    }
                }
            }
            .clipped()
    }
}

struct PosterCard: View {
    @Environment(AppModel.self) private var model
    let series: SeriesSummary
    /// nil = fill the grid cell (Browse / My list / a person's credits); the
    /// horizontal rails keep the design's fixed 122 pt poster.
    var width: CGFloat? = 122

    /// The poster's aspect (122 × 217 in the design board).
    private static let ratio: CGFloat = 122.0 / 217.0

    var body: some View {
        CoverImage(url: series.coverUrl)
            .aspectRatio(Self.ratio, contentMode: .fit)
            .frame(width: width, height: width.map { $0 / Self.ratio })
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .overlay(alignment: .topTrailing) {
                Text(series.primaryLanguage.uppercased())
                    .kathaFont(9, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 6)
                    .kathaFrame(height: 18)
                    .background(Katha.Color.bg.opacity(0.55))
                    .clipShape(Capsule())
                    .padding(7)
            }
            .shadow(color: .black.opacity(0.4), radius: 10, y: 5)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(series.title), \(model.t("home.episodes", series.episodeCount))")
    }
}

struct ToastView: View {
    let text: String
    var body: some View {
        Text(text)
            .kathaFont(14, weight: .semibold)
            .foregroundStyle(Katha.Color.text)
            .padding(.horizontal, 16)
            .kathaFrame(height: 40)
            .multilineTextAlignment(.center)
            .background(Katha.Color.raised)
            .clipShape(Capsule())
            .shadow(radius: 12, y: 4)
    }
}

/// Backend unreachable / load failed, with a Retry that re-runs the fetch.
struct FeedErrorState: View {
    @Environment(AppModel.self) private var model
    let detail: String?
    let retry: () async -> Void
    @State private var retrying = false

    var body: some View {
        VStack(spacing: Katha.Spacing.md) {
            Image(systemName: "wifi.slash")
                .kathaFont(46)
                .foregroundStyle(Katha.Color.text2)
            Text(model.t("home.offline.title"))
                .kathaFont(20, weight: .semibold)
                .foregroundStyle(Katha.Color.text)
            Text(model.t("home.offline.body"))
                .kathaFont(15)
                .foregroundStyle(Katha.Color.text2)
                .multilineTextAlignment(.center)
            Button {
                Task { retrying = true; await retry(); retrying = false }
            } label: {
                HStack(spacing: 8) {
                    if retrying { ProgressView().tint(.white) }
                    Text(model.t(retrying ? "home.offline.retrying" : "home.offline.retry"))
                }
                .kathaFont(16, weight: .semibold)
                .frame(maxWidth: 220)
                .padding(.vertical, 14)
                .background(Katha.Color.accent)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
            }
            .disabled(retrying)
            .padding(.top, Katha.Spacing.sm)
        }
        .padding(Katha.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Katha.Color.bg)
    }
}

/// Skeleton of the real layout — the screen never blanks, it sketches itself
/// in and then fills with content.
struct FeedLoadingState: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                SkeletonBlock(height: 74, radius: Katha.Radius.lg)
                SkeletonBlock(height: 420, radius: Katha.Radius.lg)
                VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                    SkeletonBlock(width: 140, height: 18, radius: 6)
                    HStack(spacing: Katha.Spacing.md) {
                        ForEach(0..<3, id: \.self) { _ in
                            SkeletonBlock(width: 124, height: 176)
                        }
                    }
                }
            }
            .padding(Katha.Spacing.lg)
        }
        .scrollDisabled(true)
        .background(Katha.Color.bg)
        .accessibilityLabel("Loading stories")
    }
}

// MARK: - Hero preview (muted, looping E1)

/// The For You card's muted trailer: E1's stream, looped, no sound, fading in
/// once the first frame is up. Honors Settings → "Autoplay trailers" (the
/// caller decides whether to mount it) and stops the moment it leaves the
/// screen. Free E1 only — never a locked episode.
private struct HeroPreview: View {
    let slug: String
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?
    @State private var ready = false

    var body: some View {
        ZStack {
            if let player {
                PlayerLayerView(player: player, gravity: .resizeAspectFill)
                    .opacity(ready ? 1 : 0)
                    .animation(reduceMotion ? nil : .easeIn(duration: 0.6), value: ready)
            }
        }
        .accessibilityHidden(true)
        .accessibilityIdentifier("hero.preview")
        .task(id: slug) {
            guard let pb = try? await model.api.playback(slug: slug, number: 1),
                  pb.isEntitled, let u = pb.hlsMasterUrl, let url = URL(string: u) else { return }
            let item = AVPlayerItem(url: url)
            item.preferredPeakBitRate = 900_000        // a preview, not the episode
            let queue = AVQueuePlayer()
            queue.isMuted = true
            queue.preventsDisplaySleepDuringVideoPlayback = false
            looper = AVPlayerLooper(player: queue, templateItem: item)
            player = queue
            queue.play()
            // Fade in once the item actually plays (a black frame otherwise).
            for _ in 0..<40 where !ready {
                try? await Task.sleep(for: .milliseconds(150))
                if queue.timeControlStatus == .playing { ready = true }
            }
        }
        .onDisappear {
            player?.pause()
            player = nil
            looper = nil
        }
    }
}
