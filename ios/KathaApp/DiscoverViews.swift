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
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 122), spacing: 12)],
                              spacing: Katha.Spacing.lg) {
                        ForEach(filtered) { s in
                            NavigationLink(value: s.slug) { PosterCard(series: s) }
                                .buttonStyle(PressableStyle())
                        }
                    }
                    .padding(.horizontal, Katha.Spacing.lg)
                    .animation(Katha.Motion.snappy, value: filtered.map(\.slug))
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
    @State private var response: SearchResponse?
    @State private var searching = false
    @AppStorage("katha.recentSearches") private var recentsRaw = ""

    private var recents: [String] { recentsRaw.split(separator: "|").map(String.init) }

    /// Inline field per mockup 2.3 — always visible. (.searchable is collapsed
    /// entirely on pushed screens by iOS 26, leaving search unreachable.)
    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Katha.Color.text2)
            TextField("Series, people, tropes", text: $query)
                .foregroundStyle(Katha.Color.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if searching {
                ProgressView().tint(Katha.Color.text2)
            } else if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Katha.Color.text2)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 46)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    /// Series matches: the server's answer, else a local title/genre filter
    /// while the request is in flight or when the endpoint is unreachable.
    private var seriesResults: [SeriesSummary] {
        if let response, response.query == trimmed { return response.series }
        let q = trimmed.lowercased()
        guard !q.isEmpty else { return [] }
        return all.filter {
            $0.title.lowercased().contains(q) || $0.genres.contains { $0.lowercased().contains(q) }
        }
    }
    private var peopleResults: [SearchPerson] {
        guard let response, response.query == trimmed else { return [] }
        return response.people
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                searchBar
                if query.isEmpty {
                    idle
                } else if seriesResults.isEmpty && peopleResults.isEmpty && !searching {
                    emptyState("No results for “\(query)”",
                               "Check the spelling — or try a genre like Romance or Thriller.")
                } else {
                    if !seriesResults.isEmpty {
                        sectionLabel("Series")
                        ForEach(seriesResults) { s in
                            NavigationLink(value: s.slug) { seriesRow(s) }
                                .buttonStyle(PressableStyle())
                                .simultaneousGesture(TapGesture().onEnded { remember(query) })
                        }
                    }
                    if !peopleResults.isEmpty {
                        sectionLabel("People")
                        ForEach(peopleResults) { p in
                            NavigationLink(value: p) { personRow(p) }
                                .buttonStyle(PressableStyle())
                                .simultaneousGesture(TapGesture().onEnded { remember(query) })
                        }
                    }
                }
            }
            .padding(Katha.Spacing.lg)
            .animation(Katha.Motion.snappy, value: seriesResults.map(\.slug))
        }
        .background(Katha.Color.bg)
        .navigationTitle("Search")
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .task { if all.isEmpty { all = (try? await model.api.listSeries()) ?? [] } }
        .task(id: trimmed) {
            // Type-ahead: a short debounce, then /v1/search. Stale answers are
            // ignored by comparing the echoed query.
            let q = trimmed
            guard !q.isEmpty else { response = nil; searching = false; return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            searching = true
            defer { searching = false }
            if let r = try? await model.search(q), !Task.isCancelled {
                response = SearchResponse(query: q, series: r.series, people: r.people)
            }
        }
    }

    private var idle: some View {
        Group {
            if !recents.isEmpty {
                Text("Recent")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                FlowLayout(spacing: 8, lineSpacing: 8) {
                    ForEach(recents, id: \.self) { r in
                        Button { query = r } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "clock")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Katha.Color.text2)
                                Text(r)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(Katha.Color.text)
                            }
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .background(Katha.Color.surface)
                            .clipShape(Capsule())
                        }
                        .buttonStyle(PressableStyle())
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
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(Katha.Font.label(14))
            .kerning(1.2)
            .foregroundStyle(Katha.Color.text2)
    }

    private func seriesRow(_ s: SeriesSummary) -> some View {
        HStack(spacing: Katha.Spacing.md) {
            CoverImage(url: s.coverUrl)
                .frame(width: 44, height: 62)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.sm, style: .continuous))
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
        .contentShape(Rectangle())          // the Spacer must be tappable too
    }

    /// "Aditi Rawal · Lead · 2 series"
    private func personRow(_ p: SearchPerson) -> some View {
        HStack(spacing: Katha.Spacing.md) {
            ZStack {
                Circle().fill(Katha.Color.accent.opacity(0.16)).frame(width: 44, height: 44)
                Text(String(p.name.prefix(1)))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Katha.Color.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                Text("\(p.role.isEmpty ? "Cast" : p.role) · \(p.series.count) series")
                    .font(.system(size: 12))
                    .foregroundStyle(Katha.Color.text2)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12)).foregroundStyle(Katha.Color.text2)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func remember(_ q: String) {
        let t = q.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        var list = recents.filter { $0 != t }
        list.insert(t, at: 0)
        recentsRaw = list.prefix(5).joined(separator: "|")
    }
}

/// A person from search: name, role, and the series they appear in.
struct PersonView: View {
    let person: SearchPerson

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                HStack(spacing: Katha.Spacing.md) {
                    ZStack {
                        Circle().fill(Katha.Color.accent.opacity(0.16)).frame(width: 64, height: 64)
                        Text(String(person.name.prefix(1)))
                            .font(.system(size: 26, weight: .bold))
                            .foregroundStyle(Katha.Color.accent)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(person.name)
                            .font(Katha.Font.display(26))
                            .foregroundStyle(Katha.Color.text)
                        Text("\(person.role.isEmpty ? "Cast" : person.role) · \(person.series.count) series")
                            .font(.system(size: 13))
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
                .accessibilityElement(children: .combine)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 122), spacing: 12)],
                          spacing: Katha.Spacing.lg) {
                    ForEach(person.series) { s in
                        NavigationLink(value: s.slug) { PosterCard(series: s) }
                            .buttonStyle(PressableStyle())
                    }
                }
            }
            .padding(Katha.Spacing.lg)
        }
        .background(Katha.Color.bg)
        .navigationTitle(person.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
    }
}

// MARK: - My list

struct MyListView: View {
    @Environment(AppModel.self) private var model
    @State private var toast: String?

    var body: some View {
        ScrollView {
            if model.myListSeries.isEmpty {
                emptyState("Nothing saved yet",
                           "Tap the bookmark on any series and it lands here.",
                           icon: "bookmark")
                    .padding(.top, 120)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 122), spacing: 12)],
                          spacing: Katha.Spacing.lg) {
                    ForEach(model.myListSeries) { s in
                        VStack(alignment: .leading, spacing: 6) {
                            NavigationLink(value: s.slug) { PosterCard(series: s) }
                                .buttonStyle(PressableStyle())
                                // The bell sits on the poster (4.4 "Reminder on").
                                .overlay(alignment: .topLeading) {
                                    ReminderBell(slug: s.slug) { toast = $0 }
                                        .font(.system(size: 14, weight: .semibold))
                                        .padding(6)
                                        .background(Katha.Color.bg.opacity(0.6))
                                        .clipShape(Circle())
                                        .padding(7)
                                }
                            Text(model.t(model.reminderSlugs.contains(s.slug) ? "reminder.on" : "reminder.off"))
                                .font(.system(size: 12))
                                .foregroundStyle(model.reminderSlugs.contains(s.slug)
                                                 ? Katha.Color.coin : Katha.Color.text2)
                        }
                            .contextMenu {
                                Button(role: .destructive) {
                                    Haptics.tap()
                                    Task { await model.toggleMyList(slug: s.slug) }
                                } label: {
                                    Label("Remove from My list", systemImage: "bookmark.slash")
                                }
                            }
                    }
                }
                .padding(Katha.Spacing.lg)
                .animation(Katha.Motion.spring, value: model.myListSeries.map(\.slug))
            }
        }
        .background(Katha.Color.bg)
        .navigationTitle(model.t("tab.mylist"))
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .overlay(alignment: .bottom) {
            if let toast {
                ToastView(text: toast)
                    .padding(.bottom, 30)
                    .task { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                    .transition(.opacity)
            }
        }
        .animation(Katha.Motion.spring, value: toast)
        .task { await model.loadEngagement() }
    }
}

// MARK: - shared empty state

func emptyState(_ title: String, _ subtitle: String,
                icon: String = "theatermasks") -> some View {
    VStack(spacing: 8) {
        Image(systemName: icon)
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
