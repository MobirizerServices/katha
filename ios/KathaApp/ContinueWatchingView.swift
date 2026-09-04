import SwiftUI
import KathaKit

/// Continue watching, the full list (mockup 4.5): every in-progress episode
/// from `/v1/me/continue`, each row saying exactly where you are and how much
/// is left. Tap → the player at that episode.
struct ContinueWatchingView: View {
    @Environment(AppModel.self) private var model
    @State private var items: [ContinueItem]?
    @State private var failed = false

    var body: some View {
        ScrollView {
            if let items {
                if items.isEmpty {
                    emptyState(model.t("continue.empty.title"), model.t("continue.empty.body"),
                               icon: "play.circle")
                        .padding(.top, 120)
                } else {
                    LazyVStack(spacing: Katha.Spacing.sm) {
                        ForEach(items) { item in
                            NavigationLink(value: EpisodeRoute(slug: item.slug, number: item.number)) {
                                ContinueRow(item: item)
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                    .padding(Katha.Spacing.lg)
                }
            } else if failed {
                FeedErrorState(detail: nil) { await load() }
                    .frame(minHeight: 400)
            } else {
                VStack(spacing: Katha.Spacing.sm) {
                    ForEach(0..<4, id: \.self) { _ in SkeletonBlock(height: 96) }
                }
                .padding(Katha.Spacing.lg)
            }
        }
        .background(Katha.Color.bg)
        .navigationTitle(model.t("continue.title"))
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            let list = try await model.api.continueWatching(limit: 50)
            items = list.items
            model.continueItems = list.items
            failed = false
        } catch {
            if items == nil { failed = true }
        }
    }

    /// "E7 · 1 min left" — the episode plus what remains, from position and
    /// duration. No duration yet (the first report hasn't landed) → "E7".
    static func subtitle(for item: ContinueItem) -> String {
        let remaining = max(0, item.durationMs - item.positionMs) / 1000
        guard item.durationMs > 0 else { return "E\(item.number)" }
        let m = remaining / 60, s = remaining % 60
        let left: String
        if m == 0 { left = "\(s) s left" }
        else if s == 0 { left = "\(m) min left" }
        else { left = "\(m) min \(s) s left" }
        return "E\(item.number) · \(left)"
    }
}

/// One 4.5 row: poster, title, "E7 · 1 min left", progress bar, Resume pill.
struct ContinueRow: View {
    @Environment(AppModel.self) private var model
    let item: ContinueItem

    var body: some View {
        HStack(spacing: Katha.Spacing.md) {
            CoverImage(url: model.coverURL(forSlug: item.slug))
                .frame(width: 56, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.sm, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title.isEmpty ? model.title(forSlug: item.slug) : item.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                    .lineLimit(1)
                Text(ContinueWatchingView.subtitle(for: item))
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Katha.Color.raised)
                        Capsule().fill(Katha.Color.accent)
                            .frame(width: max(6, geo.size.width * CGFloat(min(100, item.percent)) / 100))
                    }
                }
                .frame(height: 3)
                .padding(.top, 4)
            }
            Spacer(minLength: 4)
            HStack(spacing: 5) {
                Image(systemName: "play.fill").font(.system(size: 11))
                Text("Resume")
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Katha.Color.text)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(Katha.Color.raised)
            .clipShape(Capsule())
        }
        .padding(Katha.Spacing.md)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(model.title(forSlug: item.slug)), \(ContinueWatchingView.subtitle(for: item)), \(item.percent) percent watched")
        .accessibilityHint("Resumes the episode")
    }
}

/// Typed route for the full continue-watching list (Home row → "See all").
struct ContinueRoute: Hashable {}
