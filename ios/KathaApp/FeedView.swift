import SwiftUI
import KathaKit

/// Discover / home feed — horizontal rows of series posters (mockup §2 Discover).
struct FeedView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            content
                .background(Katha.Color.bg)
                .navigationTitle("Katha")
                .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        }
        .task { if model.feed.rows.isEmpty { await model.loadHome() } }
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
                    ForEach(model.feed.rows) { row in
                        FeedRow(row: row)
                    }
                }
                .padding(.vertical, Katha.Spacing.lg)
            }
        }
    }
}

/// Backend unreachable / load failed, with a Retry that re-runs the fetch.
private struct FeedErrorState: View {
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

private struct FeedLoadingState: View {
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
        .navigationDestination(for: String.self) { slug in
            SeriesView(slug: slug)
        }
    }
}

private struct PosterCard: View {
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
