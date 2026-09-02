import SwiftUI
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
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: SearchRoute.self) { _ in SearchView() }
            .task { if model.feed.rows.isEmpty { await model.loadHome() } }
            .overlay(alignment: .bottom) {
                if let coins = claimedToast {
                    ToastView(text: "+\(coins) coins · day streak")
                        .padding(.bottom, 30)
                        .task { try? await Task.sleep(for: .seconds(2)); claimedToast = nil }
                }
            }
    }

    /// The literary signature: serif-italic wordmark + Devanagari echo. Lives
    /// in the content (it scrolls away) because the iOS 26 toolbar clips its
    /// leading item into a glass circle.
    private var masthead: some View {
        HStack(spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Katha")
                    .font(Katha.Font.wordmark)
                    .foregroundStyle(Katha.Color.text)
                Text("कथा")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Katha.Color.text2)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Katha")
            Spacer()
            languageMenu
            NavigationLink(value: SearchRoute()) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                    .frame(width: 34, height: 34)
                    .background(Katha.Color.surface)
                    .clipShape(Circle())
                    .accessibilityLabel("Search")
            }
        }
        .padding(.horizontal, Katha.Spacing.lg)
        .padding(.top, Katha.Spacing.sm)
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
            Text(["hi": "हिन्दी", "ta": "தமிழ்", "te": "తెలుగు"][model.contentLanguage] ?? "हिन्दी")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Katha.Color.text)
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(Katha.Color.surface)
                .clipShape(Capsule())
        }
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
                    masthead
                    BrandRibbon().padding(.top, -Katha.Spacing.sm)
                    if !model.checkinClaimedToday {
                        checkinCard
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
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Katha.Color.bg)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Daily check-in")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                Text("Claim today's \(model.checkinCoins) coins")
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)
            }
            Spacer()
            Button {
                Task {
                    claimedToast = await model.claimCheckin()
                    if claimedToast != nil { Haptics.success() }
                }
            } label: {
                Text("Claim")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 16)
                    .frame(height: 36)
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
            Text("Continue watching")
                .font(Katha.Font.label(14))
                .kerning(1.2)
                .foregroundStyle(Katha.Color.text2)
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
                                    GeometryReader { geo in
                                        Capsule().fill(Katha.Color.accent)
                                            .frame(width: max(8, geo.size.width * CGFloat(item.percent) / 100),
                                                   height: 4)
                                    }
                                    .frame(height: 4)
                                    .padding(.horizontal, 6)
                                    .padding(.bottom, 5)
                                }
                                Text("E\(item.number) · \(item.slug.replacingOccurrences(of: "-", with: " ").capitalized)")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Katha.Color.text)
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
                CoverImage(url: series.coverUrl)
                    .frame(height: 500)
                    .overlay {
                        // Fade seamlessly into the page ground — full-bleed,
                        // no card frame: the story IS the screen.
                        LinearGradient(stops: [
                            .init(color: .clear, location: 0.45),
                            .init(color: Katha.Color.bg.opacity(0.75), location: 0.82),
                            .init(color: Katha.Color.bg, location: 1),
                        ], startPoint: .top, endPoint: .bottom)
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
                    HStack(spacing: 10) {
                        NavigationLink(value: EpisodeRoute(slug: series.slug, number: 1)) {
                            HStack(spacing: 6) {
                                Image(systemName: "play.fill")
                                Text("Play E1")
                            }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                            .padding(.horizontal, 18)
                            .frame(height: 42)
                            .background(LinearGradient(colors: [Katha.Color.accent,
                                                                Katha.Color.accentPressed],
                                                       startPoint: .top, endPoint: .bottom))
                            .clipShape(Capsule())
                        }
                        Text("\(series.genres.first ?? "") · \(series.episodeCount) episodes · Free · \(model.freeEpisodesDefault)")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
                .padding(.horizontal, Katha.Spacing.lg)
                .padding(.bottom, Katha.Spacing.sm)
            }
        }
        .buttonStyle(PressableStyle())
        .zoomSource(id: series.slug)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(series.title), featured story")
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
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Katha.Color.accent)
                }
                Text(row.title)
                    .font(Katha.Font.label(14))
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
    let series: SeriesSummary

    var body: some View {
        CoverImage(url: series.coverUrl)
            .frame(width: 138, height: 196)
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1))
            .overlay(alignment: .topTrailing) {
                Text(series.primaryLanguage.uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 6)
                    .frame(height: 18)
                    .background(Katha.Color.bg.opacity(0.55))
                    .clipShape(Capsule())
                    .padding(7)
            }
            .shadow(color: .black.opacity(0.4), radius: 10, y: 5)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(series.title), \(series.episodeCount) episodes")
    }
}

struct ToastView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Katha.Color.text)
            .padding(.horizontal, 16)
            .frame(height: 40)
            .background(Katha.Color.raised)
            .clipShape(Capsule())
            .shadow(radius: 12, y: 4)
    }
}

/// Backend unreachable / load failed, with a Retry that re-runs the fetch.
struct FeedErrorState: View {
    let detail: String?
    let retry: () async -> Void
    @State private var retrying = false

    var body: some View {
        VStack(spacing: Katha.Spacing.md) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 46))
                .foregroundStyle(Katha.Color.text2)
            Text("Can't reach Katha")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Katha.Color.text)
            Text("Check your connection and try again.")
                .font(.system(size: 15))
                .foregroundStyle(Katha.Color.text2)
                .multilineTextAlignment(.center)
            Button {
                Task { retrying = true; await retry(); retrying = false }
            } label: {
                HStack(spacing: 8) {
                    if retrying { ProgressView().tint(.white) }
                    Text(retrying ? "Retrying…" : "Retry")
                }
                .font(.system(size: 16, weight: .semibold))
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
