import SwiftUI
import KathaKit

// Browse (2.2) + Search (2.3) + My list (4.4).

// MARK: - Browse

struct BrowseView: View {
    @Environment(AppModel.self) private var model
    @State private var all: [SeriesSummary] = []
    @State private var genre: String?
    @State private var lang: String?
    @State private var failed = false

    private var genres: [String] {
        Array(Set(all.flatMap(\.genres))).sorted()
    }
    private var filtered: [SeriesSummary] {
        all.filter { s in
            (genre == nil || s.genres.contains(genre!)) &&
            (lang == nil || s.primaryLanguage == lang!)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                // language chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("All", isOn: lang == nil) { lang = nil }
                        ForEach([("hi", "हिन्दी"), ("ta", "தமிழ்"), ("te", "తెలుగు")], id: \.0) { code, native in
                            filterChip(native, isOn: lang == code) { lang = code }
                        }
                    }
                    .padding(.horizontal, Katha.Spacing.lg)
                }
                // genre chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("Everything", isOn: genre == nil) { genre = nil }
                        ForEach(genres, id: \.self) { g in
                            filterChip(g, isOn: genre == g) { genre = g }
                        }
                    }
                    .padding(.horizontal, Katha.Spacing.lg)
                }

                if failed {
                    FeedErrorState(detail: nil) { await load() }
                } else if filtered.isEmpty && !all.isEmpty {
                    emptyState("Nothing here yet",
                               "Try another genre — or switch language.")
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 124), spacing: 12)],
                              spacing: Katha.Spacing.lg) {
                        ForEach(filtered) { s in
                            NavigationLink(value: s.slug) { PosterCard(series: s) }
                        }
                    }
                    .padding(.horizontal, Katha.Spacing.lg)
                }
            }
            .padding(.vertical, Katha.Spacing.lg)
        }
        .background(Katha.Color.bg)
        .navigationTitle("Browse")
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .task { if all.isEmpty { await load() } }
    }

    private func load() async {
        do { all = try await model.api.listSeries(); failed = false }
        catch { failed = true }
    }

    private func filterChip(_ label: String, isOn: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(isOn ? Katha.Color.text : Katha.Color.text2)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(isOn ? Katha.Color.accent.opacity(0.14) : Katha.Color.surface)
                .overlay(Capsule().strokeBorder(isOn ? Katha.Color.accent : .clear, lineWidth: 1))
                .clipShape(Capsule())
        }
    }
}

// MARK: - Search

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var all: [SeriesSummary] = []
    @State private var query = ""
    @AppStorage("katha.recentSearches") private var recentsRaw = ""

    private var recents: [String] { recentsRaw.split(separator: "|").map(String.init) }
    private var results: [SeriesSummary] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return all.filter {
            $0.title.lowercased().contains(q) || $0.genres.contains { $0.lowercased().contains(q) }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                if query.isEmpty {
                    if !recents.isEmpty {
                        Text("Recent")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Katha.Color.text)
                        ForEach(recents, id: \.self) { r in
                            Button { query = r } label: {
                                HStack {
                                    Image(systemName: "clock").foregroundStyle(Katha.Color.text2)
                                    Text(r).foregroundStyle(Katha.Color.text)
                                    Spacer()
                                }
                            }
                        }
                    }
                    Text("Trending")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Katha.Color.text)
                    ForEach(all.prefix(5)) { s in
                        NavigationLink(value: s.slug) {
                            HStack {
                                Image(systemName: "flame").foregroundStyle(Katha.Color.accent)
                                Text(s.title).foregroundStyle(Katha.Color.text)
                                Spacer()
                                Text("\(s.episodeCount) eps")
                                    .font(.system(size: 12)).foregroundStyle(Katha.Color.text2)
                            }
                        }
                    }
                } else if results.isEmpty {
                    emptyState("No results for “\(query)”",
                               "Check the spelling — or try a genre like Romance or Thriller.")
                } else {
                    ForEach(results) { s in
                        NavigationLink(value: s.slug) {
                            HStack(spacing: Katha.Spacing.md) {
                                CoverImage(url: s.coverUrl)
                                    .frame(width: 44, height: 62)
                                    .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.sm,
                                                                style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.title)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(Katha.Color.text)
                                    Text("\(s.primaryLanguage.uppercased()) · \(s.genres.first ?? "") · \(s.episodeCount) episodes")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Katha.Color.text2)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12)).foregroundStyle(Katha.Color.text2)
                            }
                        }
                        .simultaneousGesture(TapGesture().onEnded { remember(query) })
                    }
                }
            }
            .padding(Katha.Spacing.lg)
        }
        .background(Katha.Color.bg)
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Series, genres, tropes")
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .task { if all.isEmpty { all = (try? await model.api.listSeries()) ?? [] } }
    }

    private func remember(_ q: String) {
        let t = q.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        var list = recents.filter { $0 != t }
        list.insert(t, at: 0)
        recentsRaw = list.prefix(5).joined(separator: "|")
    }
}

// MARK: - My list

struct MyListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            if model.myListSeries.isEmpty {
                emptyState("Nothing saved yet",
                           "Tap the bookmark on any series and it lands here.")
                    .padding(.top, 120)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 124), spacing: 12)],
                          spacing: Katha.Spacing.lg) {
                    ForEach(model.myListSeries) { s in
                        NavigationLink(value: s.slug) { PosterCard(series: s) }
                    }
                }
                .padding(Katha.Spacing.lg)
            }
        }
        .background(Katha.Color.bg)
        .navigationTitle("My list")
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .task { await model.loadEngagement() }
    }
}

// MARK: - shared empty state

func emptyState(_ title: String, _ subtitle: String) -> some View {
    VStack(spacing: 8) {
        Image(systemName: "sparkles")
            .font(.system(size: 34))
            .foregroundStyle(Katha.Color.text2)
        Text(title)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Katha.Color.text)
        Text(subtitle)
            .font(.system(size: 14))
            .foregroundStyle(Katha.Color.text2)
            .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(Katha.Spacing.xl)
}
