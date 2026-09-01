import SwiftUI
import KathaKit

// App entry + shared app state. The SwiftUI layer wraps KathaKit's pure view
// models and the KathaAPIClient actor. Requires Xcode/simulator to build & run.

@main
struct KathaApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Katha.Color.accent)
        }
    }
}

/// Typed route for pushing the player from any episode tap.
struct EpisodeRoute: Hashable {
    let slug: String
    let number: Int
}

// MARK: - App model

/// Observable façade over the API client, session, wallet and engagement state,
/// shared through the environment. The backend stays the source of truth; this
/// only caches what screens render.
@MainActor @Observable
final class AppModel {
    let api: KathaAPIClient
    var wallet = WalletStore()
    var feed = FeedViewModel()
    var loadError: String?
    var isLoading = false

    // Session
    var profile: UserProfile?
    var isSignedIn: Bool { ["phone", "apple"].contains(profile?.kind ?? "") }

    // Engagement caches
    var continueItems: [ContinueItem] = []
    var myListSlugs: Set<String> = []
    var myListSeries: [SeriesSummary] = []

    // Check-in
    var checkinClaimedToday = false
    var lastCheckinDay: String {
        get { defaults.string(forKey: "katha.checkin.day") ?? "" }
        set { defaults.set(newValue, forKey: "katha.checkin.day") }
    }

    // Preferences (device-local)
    private let defaults = UserDefaults.standard
    var contentLanguage: String {
        get { defaults.string(forKey: "katha.lang") ?? "hi" }
        set { defaults.set(newValue, forKey: "katha.lang") }
    }
    var onboarded: Bool {
        get { defaults.bool(forKey: "katha.onboarded") }
        set { defaults.set(newValue, forKey: "katha.onboarded") }
    }
    var interests: [String] {
        get { defaults.stringArray(forKey: "katha.interests") ?? [] }
        set { defaults.set(newValue, forKey: "katha.interests") }
    }
    var autoUnlock: Bool {
        get { defaults.bool(forKey: "katha.autounlock") }
        set { defaults.set(newValue, forKey: "katha.autounlock") }
    }
    var dataSaver: Bool {
        get { defaults.bool(forKey: "katha.datasaver") }
        set { defaults.set(newValue, forKey: "katha.datasaver") }
    }
    /// Dev-slice parental PIN (production hashes with Argon2 server-side, PDD §12.9).
    var parentalPin: String? {
        get { defaults.string(forKey: "katha.pin") }
        set { defaults.set(newValue, forKey: "katha.pin") }
    }
    private var storedToken: String? {
        get { defaults.string(forKey: "katha.token") }
        set { defaults.set(newValue, forKey: "katha.token") }
    }

    init(baseURL: URL = URL(string: "http://127.0.0.1:8799")!) {
        // 127.0.0.1 (not "localhost"): core-api binds IPv4 only, and "localhost"
        // resolves to IPv6 ::1 first on the simulator → a refused connection first.
        self.api = KathaAPIClient(baseURL: baseURL)
    }

    // MARK: Session lifecycle

    /// Establish a session: reuse the stored token, else start as a guest.
    func bootstrap() async {
        if let token = storedToken {
            await api.setAuthToken(token)
            if let me = try? await api.me() {
                profile = me
            } else {
                await startGuest()   // stale token — fall back to a fresh guest
            }
        } else {
            await startGuest()
        }
        await loadHome(lang: contentLanguage)
        await loadEngagement()
    }

    private func startGuest() async {
        if let auth = try? await api.guestLogin() {
            storedToken = auth.accessToken
            profile = auth.user
        }
    }

    func signIn(phone: String, code: String) async -> Bool {
        do {
            let auth = try await api.verifyOtp(phone: phone, code: code)
            storedToken = auth.accessToken
            profile = auth.user
            await refreshWallet()
            await loadEngagement()
            return true
        } catch { return false }
    }

    func signInWithApple() async -> Bool {
        do {
            // Dev stub token; production passes ASAuthorization's identityToken.
            let auth = try await api.appleLogin(identityToken: "dev-apple-token")
            storedToken = auth.accessToken
            profile = auth.user
            await refreshWallet()
            await loadEngagement()
            return true
        } catch { return false }
    }

    func signOut() async {
        storedToken = nil
        profile = nil
        wallet = WalletStore()
        continueItems = []; myListSlugs = []; myListSeries = []
        await api.setAuthToken(nil)
        await startGuest()
        await refreshWallet()
    }

    /// Account deletion (App Store requirement). Ledger is retained server-side.
    func deleteAccount() async {
        try? await api.deleteMe()
        await signOut()
    }

    // MARK: Data loads

    func loadHome(lang: String? = nil) async {
        isLoading = true
        defer { isLoading = false }
        let language = lang ?? contentLanguage   // hoisted: async let args are nonisolated
        do {
            async let home = api.home(lang: language)
            async let w = api.wallet()
            feed.load(try await home)
            wallet.reconcile(with: try await w)
            loadError = nil
        } catch {
            loadError = String(describing: error)
        }
    }

    func refreshWallet() async {
        if let w = try? await api.wallet() { wallet.reconcile(with: w) }
    }

    func loadEngagement() async {
        if let cont = try? await api.continueWatching() { continueItems = cont.items }
        if let list = try? await api.myList() {
            myListSlugs = Set(list.slugs)
            myListSeries = list.series
        }
    }

    func toggleMyList(slug: String) async {
        let wasSaved = myListSlugs.contains(slug)
        if wasSaved { myListSlugs.remove(slug) } else { myListSlugs.insert(slug) }  // optimistic
        let result = wasSaved
            ? try? await api.removeFromList(slug: slug)
            : try? await api.addToList(slug: slug)
        if let result {
            myListSlugs = Set(result.slugs)
            myListSeries = result.series
        }
    }

    func claimCheckin() async -> Int? {
        guard let r = try? await api.checkin() else { return nil }
        wallet.reconcile(with: r.wallet)
        lastCheckinDay = r.day
        checkinClaimedToday = true
        return r.alreadyClaimed ? nil : r.grantedCoins
    }

    /// Cover art for a slug from whatever is already cached (feed rows, my list) —
    /// used where the payload has no cover of its own (e.g. continue-watching).
    func coverURL(forSlug slug: String, wide: Bool = false) -> String {
        let all = feed.rows.flatMap(\.series) + myListSeries
        guard let s = all.first(where: { $0.slug == slug }) else { return "" }
        return wide ? s.coverWideUrl : s.coverUrl
    }

    // MARK: Parental lock

    func ratingNeedsPin(_ rating: String) -> Bool {
        guard parentalPin != nil else { return false }
        return rating.contains("16+") || rating == "A"
    }
}

// MARK: - Root flow

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var booted = false

    var body: some View {
        Group {
            if !model.onboarded {
                OnboardingFlow()
            } else if !booted {
                SplashView()
            } else {
                MainTabView()
            }
        }
        .task {
            guard model.onboarded else { return }
            await model.bootstrap()
            booted = true
        }
        .onChange(of: model.onboarded) { _, done in
            // Finishing onboarding boots the session.
            if done {
                Task { await model.bootstrap(); booted = true }
            }
        }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            tabStack { FeedView() }
                .tabItem { Label("Home", systemImage: "play.rectangle.fill") }
            tabStack { BrowseView() }
                .tabItem { Label("Browse", systemImage: "square.grid.2x2.fill") }
            tabStack { MyListView() }
                .tabItem { Label("My list", systemImage: "bookmark.fill") }
            tabStack { ProfileView() }
                .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
        }
        .background(Katha.Color.bg)
    }

    /// Every tab shares the two typed destinations (registered at stack level —
    /// never inside lazy containers, where SwiftUI ignores them).
    private func tabStack<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        NavigationStack {
            content()
                .navigationDestination(for: String.self) { slug in
                    SeriesView(slug: slug)
                }
                .navigationDestination(for: EpisodeRoute.self) { route in
                    PlayerView(slug: route.slug, number: route.number)
                }
        }
    }
}
