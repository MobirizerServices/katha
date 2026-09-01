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
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    HStack(spacing: 8) {
                        Image(systemName: "play.rectangle.fill")
                            .foregroundStyle(Katha.Color.accent)
                        Text("Katha")
                            .font(.system(size: 22, weight: .heavy))
                            .foregroundStyle(Katha.Color.text)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 14) {
                        languageMenu
                        NavigationLink(value: SearchRoute()) {
                            Image(systemName: "magnifyingglass")
                                .foregroundStyle(Katha.Color.text)
                        }
                    }
                }
            }
            .navigationDestination(for: SearchRoute.self) { _ in SearchView() }
            .toolbarBackground(Katha.Color.bg, for: .navigationBar)
            .task { if model.feed.rows.isEmpty { await model.loadHome() } }
            .overlay(alignment: .bottom) {
                if let coins = claimedToast {
                    ToastView(text: "+\(coins) coins · day streak")
                        .padding(.bottom, 30)
                        .task { try? await Task.sleep(for: .seconds(2)); claimedToast = nil }
                }
            }
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
                LazyVStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                    if !model.checkinClaimedToday { checkinCard }
                    if let hero = model.feed.rows.first?.series.first { HeroCard(series: hero) }
                    if !model.continueItems.isEmpty { continueRow }
                    ForEach(model.feed.rows) { row in
                        FeedRow(row: row)
                    }
                }
                .padding(.vertical, Katha.Spacing.lg)
            }
            .refreshable { await model.loadHome(); await model.loadEngagement() }
        }
    }

    // MARK: check-in (5 coins/day, PDD §8.2)

    private var checkinCard: some View {
        HStack(spacing: Katha.Spacing.md) {
            Circle().fill(Katha.Color.coin).frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("Daily check-in")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                Text("Claim today's 5 coins")
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)
            }
            Spacer()
            Button {
                Task { claimedToast = await model.claimCheckin() }
            } label: {
                Text("Claim")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 16)
                    .frame(height: 36)
                    .background(Katha.Color.accent)
                    .clipShape(Capsule())
            }
        }
        .padding(Katha.Spacing.lg)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
        .padding(.horizontal, Katha.Spacing.lg)
    }

    // MARK: continue watching

    private var continueRow: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
            Text("Continue watching")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Katha.Color.text)
                .padding(.horizontal, Katha.Spacing.lg)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Katha.Spacing.md) {
                    ForEach(model.continueItems) { item in
                        NavigationLink(value: EpisodeRoute(slug: item.slug, number: item.number)) {
                            VStack(alignment: .leading, spacing: 6) {
                                ZStack(alignment: .bottom) {
                                    RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous)
                                        .fill(Katha.Color.raised)
                                        .frame(width: 168, height: 96)
                                        .overlay {
                                            Image(systemName: "play.fill")
                                                .foregroundStyle(Katha.Color.text)
                                        }
                                    GeometryReader { geo in
                                        Rectangle().fill(Katha.Color.accent)
                                            .frame(width: geo.size.width * CGFloat(item.percent) / 100,
                                                   height: 3)
                                    }
                                    .frame(height: 3)
                                }
                                Text("E\(item.number) · \(item.slug.replacingOccurrences(of: "-", with: " ").capitalized)")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Katha.Color.text)
                                    .lineLimit(1)
                                    .frame(width: 168, alignment: .leading)
                            }
                        }
                    }
                }
                .padding(.horizontal, Katha.Spacing.lg)
            }
        }
    }
}

/// The big For You card (2.1): tagline + Play E1, "Free · 10 episodes" badge.
private struct HeroCard: View {
    let series: SeriesSummary

    var body: some View {
        NavigationLink(value: series.slug) {
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
                    .fill(LinearGradient(colors: [Katha.Color.raised, Katha.Color.bg],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(height: 420)
                VStack(alignment: .leading, spacing: 8) {
                    Text(series.title)
                        .font(.system(size: 30, weight: .heavy))
                        .foregroundStyle(Katha.Color.text)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: 8) {
                        NavigationLink(value: EpisodeRoute(slug: series.slug, number: 1)) {
                            HStack(spacing: 6) {
                                Image(systemName: "play.fill")
                                Text("Play E1")
                            }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                            .padding(.horizontal, 16)
                            .frame(height: 40)
                            .background(Katha.Color.accent)
                            .clipShape(Capsule())
                        }
                        Text("\(series.genres.first ?? "") · \(series.episodeCount) episodes")
                            .font(.system(size: 13))
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
                .padding(Katha.Spacing.lg)

                VStack {
                    HStack {
                        Text("Free · 10 episodes")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                            .padding(.horizontal, 8)
                            .frame(height: 22)
                            .background(.black.opacity(0.55))
                            .clipShape(Capsule())
                        Spacer()
                    }
                    Spacer()
                }
                .padding(Katha.Spacing.md)
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Katha.Spacing.lg)
    }
}

struct SearchRoute: Hashable {}

private struct FeedRow: View {
    let row: HomeRow

    var body: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
            Text(row.title)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Katha.Color.text)
                .padding(.horizontal, Katha.Spacing.lg)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Katha.Spacing.md) {
                    ForEach(row.series) { series in
                        NavigationLink(value: series.slug) {
                            PosterCard(series: series)
                        }
                    }
                }
                .padding(.horizontal, Katha.Spacing.lg)
            }
        }
    }
}

struct PosterCard: View {
    let series: SeriesSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous)
                .fill(Katha.Color.raised)
                .frame(width: 124, height: 176)
                .overlay(alignment: .bottomLeading) {
                    Text(series.primaryLanguage.uppercased())
                        .font(.system(size: 10, weight: .bold))
                        .padding(4)
                        .background(Katha.Color.bg.opacity(0.6))
                        .clipShape(Capsule())
                        .padding(6)
                }
            Text(series.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Katha.Color.text)
                .lineLimit(2)
                .frame(width: 124, alignment: .leading)
            Text("\(series.episodeCount) episodes")
                .font(.system(size: 11))
                .foregroundStyle(Katha.Color.text2)
        }
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

struct FeedLoadingState: View {
    var body: some View {
        VStack(spacing: Katha.Spacing.md) {
            ProgressView().tint(Katha.Color.accent)
            Text("Loading stories…")
                .font(.system(size: 15))
                .foregroundStyle(Katha.Color.text2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Katha.Color.bg)
    }
}
