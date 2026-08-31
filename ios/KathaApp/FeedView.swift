import SwiftUI
import KathaKit

/// Discover / home feed — horizontal rows of series posters (mockup §2 Discover).
struct FeedView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                    ForEach(model.feed.rows) { row in
                        FeedRow(row: row)
                    }
                }
                .padding(.vertical, Katha.Spacing.lg)
            }
            .background(Katha.Color.bg)
            .navigationTitle("Katha")
            .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        }
        .task { await model.loadHome() }
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
