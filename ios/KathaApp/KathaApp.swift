import SwiftUI
import UserNotifications
import KathaKit

// App entry + shared app state. The SwiftUI layer wraps KathaKit's pure view
// models and the KathaAPIClient actor. Requires Xcode/simulator to build & run.

@main
struct KathaApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Katha.Color.accent)
        }
        .onChange(of: scenePhase) { _, phase in
            // Leaving the app arms the next-episode drip nudge (mockup 3.6).
            if phase == .background {
                Task { await model.scheduleDropNudge() }
            }
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

    // Episode-drop notifications (mockup 3.6)
    var pendingRoute: EpisodeRoute?      // set by a notification tap; MainTabView pushes it
    var incomingDrop: DropAlert?         // foreground arrival → in-app banner
    private var notificationRouter: NotificationRouter?

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

    // Preferences (device-local). Stored properties (not computed over
    // UserDefaults) so @Observable tracks them — a computed getter is invisible
    // to observation and views would never refresh on change; persistence
    // happens in didSet. Loaded in init.
    private let defaults = UserDefaults.standard
    var contentLanguage = "hi" {
        didSet { defaults.set(contentLanguage, forKey: "katha.lang") }
    }
    var onboarded = false {
        didSet { defaults.set(onboarded, forKey: "katha.onboarded") }
    }
    var interests: [String] = [] {
        didSet { defaults.set(interests, forKey: "katha.interests") }
    }
    var autoUnlock = false {
        didSet { defaults.set(autoUnlock, forKey: "katha.autounlock") }
    }
    var dataSaver = false {
        didSet { defaults.set(dataSaver, forKey: "katha.datasaver") }
    }
    /// New-episode alerts (default on; delivery starts provisional/quiet).
    var episodeAlerts = true {
        didSet {
            defaults.set(episodeAlerts, forKey: "katha.alerts")
            if !episodeAlerts { cancelDropNudges() }
        }
    }
    /// Dev-slice parental PIN (production hashes with Argon2 server-side, PDD §12.9).
    var parentalPin: String? {
        didSet {
            if let parentalPin { defaults.set(parentalPin, forKey: "katha.pin") }
            else { defaults.removeObject(forKey: "katha.pin") }
        }
    }
    private var storedToken: String? {
        get { defaults.string(forKey: "katha.token") }
        set { defaults.set(newValue, forKey: "katha.token") }
    }

    init(baseURL: URL? = nil) {
        let env = ProcessInfo.processInfo.environment
        // UI-test hook: start from a blank slate (fresh guest, defaults cleared).
        if env["KATHA_RESET"] != nil {
            for key in ["katha.token", "katha.onboarded", "katha.lang", "katha.interests",
                        "katha.autounlock", "katha.datasaver", "katha.pin", "katha.alerts",
                        "katha.checkin.day", "katha.recentSearches"] {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
        // Base URL resolution: test env override → Info.plist KathaAPIBase (set
        // to the dev Mac's LAN IP for real-device builds — 127.0.0.1 would be
        // the phone itself) → simulator default. core-api binds IPv4, so never
        // "localhost" (the simulator resolves ::1 first and gets refused).
        let plistBase = (Bundle.main.object(forInfoDictionaryKey: "KathaAPIBase") as? String)
            .flatMap(URL.init(string:))
        let base = baseURL
            ?? env["KATHA_API_BASE"].flatMap(URL.init(string:))
            ?? plistBase
            ?? URL(string: "http://127.0.0.1:8799")!
        self.api = KathaAPIClient(baseURL: base)

        // Load persisted preferences into the observed stored properties.
        let d = UserDefaults.standard
        contentLanguage = d.string(forKey: "katha.lang") ?? "hi"
        // UI-test hook: KATHA_ONBOARDED skips onboarding without persisting.
        onboarded = env["KATHA_ONBOARDED"] != nil || d.bool(forKey: "katha.onboarded")
        interests = d.stringArray(forKey: "katha.interests") ?? []
        autoUnlock = d.bool(forKey: "katha.autounlock")
        dataSaver = d.bool(forKey: "katha.datasaver")
        episodeAlerts = d.object(forKey: "katha.alerts") == nil ? true : d.bool(forKey: "katha.alerts")
        parentalPin = d.string(forKey: "katha.pin")
    }

    // MARK: Session lifecycle

    /// Establish a session: reuse the stored token, else start as a guest.
    // Remote config: the server owns every business number the UI shows.
    var appConfig: AppConfig?
    var rupeeRate: Double { appConfig?.coinRupeeRate ?? 0.15 }
    var checkinCoins: Int { appConfig?.checkinCoins ?? 5 }
    var freeEpisodesDefault: Int { appConfig?.freeEpisodeCount ?? 10 }
    var firstPack2x: Bool { appConfig?.flags["offers.first_pack_2x"] ?? true }
    var updateRequired: Bool {
        guard let min = appConfig?.minAppVersion else { return false }
        let current = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
        return AppConfig.isOutdated(current: current, minimum: min)
    }

    func loadConfig() async {
        if let cfg = try? await api.config() { appConfig = cfg }
    }

    func bootstrap() async {
        setupNotifications()
        await loadConfig()
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
        // Dev hook: KATHA_NUDGE_SECONDS schedules the drip nudge immediately so
        // the foreground banner is demoable without backgrounding the app.
        if ProcessInfo.processInfo.environment["KATHA_NUDGE_SECONDS"] != nil {
            await scheduleDropNudge()
        }
    }

    // MARK: Episode-drop notifications (3.6)

    private func setupNotifications() {
        guard notificationRouter == nil else { return }
        let router = NotificationRouter(model: self)
        notificationRouter = router
        UNUserNotificationCenter.current().delegate = router
        // Provisional: granted without a prompt, delivers quietly until the user
        // promotes it (the toggle in Settings asks for full alerts).
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge, .provisional]) { _, _ in }
    }

    /// Upgrade quiet/provisional delivery to full alerts (Settings toggle).
    func promoteNotificationAuth() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]) { _, _ in }
    }

    /// Queue the 3.6 drip nudge for the next unwatched episode of the series
    /// the user is furthest into. Title is the episode label; the body hooks
    /// without spoiling. Quiet hours + frequency caps are server policy.
    func scheduleDropNudge() async {
        guard episodeAlerts, let item = continueItems.first else { return }
        let next = item.number + 1
        guard let d = try? await api.seriesDetail(slug: item.slug),
              next <= d.episodeCount else { return }
        let epTitle = d.episodes.first { $0.number == next }?.title ?? "Episode \(next)"

        let content = UNMutableNotificationContent()
        content.title = "E\(next) · \(epTitle)"
        content.body = "\(d.episodeCount - item.number) episodes left tonight. \(d.title) is waiting."
        content.sound = .default
        content.userInfo = ["katha": ["slug": d.slug, "episode": next]]

        let seconds = ProcessInfo.processInfo.environment["KATHA_NUDGE_SECONDS"]
            .flatMap(Double.init) ?? 3600            // dev default: an hour after leaving
        let request = UNNotificationRequest(
            identifier: "drop:\(d.slug)",            // one pending nudge per series
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false))
        try? await UNUserNotificationCenter.current().add(request)
    }

    func cancelDropNudges() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
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
    @Environment(AppModel.self) private var model
    @State private var homePath = NavigationPath()

    var body: some View {
        ZStack(alignment: .top) {
            TabView {
                tabStack(path: $homePath) { FeedView() }
                    .tabItem { Label("Home", systemImage: "play.rectangle.fill") }
                tabStack { BrowseView() }
                    .tabItem { Label("Browse", systemImage: "square.grid.2x2.fill") }
                tabStack { MyListView() }
                    .tabItem { Label("My list", systemImage: "bookmark.fill") }
                tabStack { ProfileView() }
                    .tabItem { Label("Profile", systemImage: "person.crop.circle.fill") }
            }
            .background(Katha.Color.bg)

            // Force update below config.min_app_version (server-decided).
            if model.updateRequired {
                UpdateRequiredView()
            }

            // 3.6: a drop that lands while the app is open shows the in-app card.
            if let drop = model.incomingDrop {
                DropBanner(drop: drop) {
                    model.incomingDrop = nil
                    model.pendingRoute = EpisodeRoute(slug: drop.slug, number: drop.episode)
                } dismiss: {
                    model.incomingDrop = nil
                }
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.35), value: model.incomingDrop)
        .task {
            // Dev/UI-test hook: KATHA_AUTOPLAY="slug:number" jumps straight into
            // the player (headless simctl can't tap; Xcode runs ignore it).
            if let spec = ProcessInfo.processInfo.environment["KATHA_AUTOPLAY"] {
                let parts = spec.split(separator: ":")
                if parts.count == 2, let n = Int(parts[1]) {
                    // One beat so the stack's destinations are registered — a
                    // push on the very first render is dropped on-device.
                    try? await Task.sleep(for: .milliseconds(500))
                    homePath.append(EpisodeRoute(slug: String(parts[0]), number: n))
                }
            }
            consumePendingRoute()   // notification tapped before the UI existed
        }
        .onChange(of: model.pendingRoute) { _, route in
            if route != nil { consumePendingRoute() }
        }
    }

    /// A notification tap lands here: push the player and clear the intent.
    private func consumePendingRoute() {
        guard let route = model.pendingRoute else { return }
        model.pendingRoute = nil
        homePath.append(route)
    }

    /// Every tab shares the two typed destinations (registered at stack level —
    /// never inside lazy containers, where SwiftUI ignores them).
    private func tabStack<Content: View>(
        path: Binding<NavigationPath>? = nil,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        let destinations = content()
            .navigationDestination(for: String.self) { slug in
                SeriesView(slug: slug)
            }
            .navigationDestination(for: EpisodeRoute.self) { route in
                PlayerView(slug: route.slug, number: route.number)
            }
        return Group {
            if let path {
                NavigationStack(path: path) { destinations }
            } else {
                NavigationStack { destinations }
            }
        }
    }
}


/// Blocking overlay when the server's `min_app_version` outruns this build —
/// payment-integrity gate (PDD app.min_version flag).
struct UpdateRequiredView: View {
    var body: some View {
        ZStack {
            Katha.Color.bg.ignoresSafeArea()
            VStack(spacing: Katha.Spacing.md) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(Katha.Color.accent)
                Text("Update Katha to continue")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                Text("This version can no longer make purchases safely. Get the latest from the App Store.")
                    .font(.system(size: 14))
                    .foregroundStyle(Katha.Color.text2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
        }
    }
}
