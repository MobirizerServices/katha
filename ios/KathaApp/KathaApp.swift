import SwiftUI
import UserNotifications
import KathaKit

// App entry + shared app state. The SwiftUI layer wraps KathaKit's pure view
// models and the KathaAPIClient actor. Requires Xcode/simulator to build & run.

/// Receives the APNs device token (SwiftUI apps still need a UIKit delegate
/// for remote-notification registration callbacks) and forwards it to the
/// server so episode-drop pushes can reach this device.
final class PushDelegate: NSObject, UIApplicationDelegate {
    // Static: SwiftUI's adaptor instantiates its own delegate instance, so the
    // hook must not live on a particular object.
    nonisolated(unsafe) static var onToken: ((String) -> Void)?

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        PushDelegate.onToken?(hex)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Simulator / missing push capability: local features keep working.
        print("APNs registration unavailable: \(error.localizedDescription)")
    }
}


@main
struct KathaApp: App {
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushDelegate
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // App language (Settings → App language): system-formatted
                // pieces (dates, numbers, VoiceOver) follow it; the chrome
                // strings come from L10n.
                .environment(\.locale, Locale(identifier: model.uiLanguage))
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
    /// Series with the new-episode bell on (`/v1/me/reminders`).
    var reminderSlugs: Set<String> = []

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
    /// App (UI) language — en | hi. Separate from the content languages.
    /// Persisted locally and mirrored to the profile (PATCH /v1/me ui_language).
    var uiLanguage = "en" {
        didSet { defaults.set(uiLanguage, forKey: "katha.uilang") }
    }
    /// Home hero autoplays a muted preview (mockup 4.2 "Autoplay trailers").
    var previewsMuted = true {
        didSet { defaults.set(previewsMuted, forKey: "katha.previews.muted") }
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
    /// First-run coach marks shown once on the first Home visit; re-triggerable
    /// from Help. Persisted so the tour never re-runs on its own.
    var hasSeenCoachMarks = false {
        didSet { defaults.set(hasSeenCoachMarks, forKey: "katha.coachmarks.seen") }
    }
    /// Bumped to replay the coach-mark tour on demand (from Profile → Replay
    /// tips). Transient — not persisted; the host observes the change.
    var coachReplayToken = 0
    /// Parental lock: salted hash in the Keychain, attempt lockout, current PIN
    /// required to change or remove (see ParentalLock).
    let parentalLock = ParentalLock()
    /// Observed mirror of `parentalLock.isSet` so views refresh when it changes.
    var parentalLockSet = false
    /// The session bearer lives in the Keychain (see KeychainStore) — it
    /// authorises money for 30 days and must not ride along in a backup.
    private static let tokenKey = "session.token"
    private var storedToken: String? {
        get { KeychainStore.get(Self.tokenKey) }
        set { KeychainStore.set(newValue, for: Self.tokenKey) }
    }

    /// StoreKit 2 bridge to the ledger (PaywallView / WalletView buy through it).
    let store = CoinStore()

    init(baseURL: URL? = nil) {
        let env = ProcessInfo.processInfo.environment
        // UI-test hook: start from a blank slate (fresh guest, defaults cleared).
        if env["KATHA_RESET"] != nil {
            for key in ["katha.token", "katha.onboarded", "katha.lang", "katha.interests",
                        "katha.autounlock", "katha.datasaver", "katha.pin", "katha.alerts",
                        "katha.checkin.day", "katha.recentSearches", "katha.coachmarks.seen",
                        "katha.uilang", "katha.previews.muted", "katha.captions.lang"] {
                UserDefaults.standard.removeObject(forKey: key)
            }
            KeychainStore.delete(Self.tokenKey)
            parentalLock.clearUnconditionally()
        }
        // Builds before the hashed lock kept the PIN in UserDefaults: scrub it.
        // (Re-setting the lock is a one-time ask; a plaintext PIN must not live on.)
        UserDefaults.standard.removeObject(forKey: "katha.pin")
        parentalLockSet = parentalLock.isSet
        // One-time migration: builds before the Keychain move kept the bearer
        // in UserDefaults. Move it, then scrub the old copy.
        if let legacy = UserDefaults.standard.string(forKey: "katha.token") {
            KeychainStore.set(legacy, for: Self.tokenKey)
            UserDefaults.standard.removeObject(forKey: "katha.token")
        }
        // Base URL resolution: test env override → Info.plist KathaAPIBase (set
        // to the dev Mac's LAN IP for real-device builds — 127.0.0.1 would be
        // the phone itself) → simulator default. core-api binds IPv4, so never
        // "localhost" (the simulator resolves ::1 first and gets refused).
        let plistBase = (Bundle.main.object(forInfoDictionaryKey: "KathaAPIBase") as? String)
            .flatMap(URL.init(string:))
        #if DEBUG
        let base = baseURL
            ?? env["KATHA_API_BASE"].flatMap(URL.init(string:))
            ?? plistBase
            ?? URL(string: "http://127.0.0.1:8799")!
        #else
        // Release: the base comes from Config/Release.xcconfig only, and it must
        // be HTTPS — the bearer and every money call ride on it. A misbuilt
        // binary fails here, on first launch, instead of shipping cleartext.
        guard let base = baseURL ?? plistBase, base.scheme == "https" else {
            fatalError("KathaAPIBase must be an https URL in Release builds")
        }
        #endif
        self.api = KathaAPIClient(baseURL: base)
        self.progress = ProgressReporter(api: self.api)

        // Load persisted preferences into the observed stored properties.
        let d = UserDefaults.standard
        contentLanguage = d.string(forKey: "katha.lang") ?? "hi"
        uiLanguage = d.string(forKey: "katha.uilang") ?? "en"
        previewsMuted = d.object(forKey: "katha.previews.muted") == nil
            ? true : d.bool(forKey: "katha.previews.muted")
        // UI-test hook: KATHA_ONBOARDED skips onboarding without persisting.
        onboarded = env["KATHA_ONBOARDED"] != nil || d.bool(forKey: "katha.onboarded")
        interests = d.stringArray(forKey: "katha.interests") ?? []
        autoUnlock = d.bool(forKey: "katha.autounlock")
        dataSaver = d.bool(forKey: "katha.datasaver")
        episodeAlerts = d.object(forKey: "katha.alerts") == nil ? true : d.bool(forKey: "katha.alerts")
        hasSeenCoachMarks = d.bool(forKey: "katha.coachmarks.seen")
        // The check-in card reappeared every launch even when today's reward
        // was already claimed (the server deduped, but the card still asked).
        checkinClaimedToday = (d.string(forKey: "katha.checkin.day") ?? "") == Self.istToday()
    }

    /// Today's date in IST — the check-in day boundary, as the server counts it.
    static func istToday() -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    // MARK: Session lifecycle

    /// Establish a session: reuse the stored token, else start as a guest.
    // Remote config: the server owns every business number the UI shows.
    var appConfig: AppConfig?
    // Optional on purpose: until /v1/config has answered, the UI shows no ₹
    // equivalents, no check-in amount and no offer badge, rather than a number
    // made up on the client.
    var rupeeRate: Double? { appConfig?.coinRupeeRate }
    var checkinCoins: Int? { appConfig?.checkinCoins }
    var freeEpisodesDefault: Int? { appConfig?.freeEpisodeCount }
    var firstPack2x: Bool { appConfig?.flags["offers.first_pack_2x"] ?? false }
    /// Shown once when a dead session was replaced by a fresh guest (I8).
    var sessionNotice: String?
    private var recoveringSession = false
    /// Serialized, coalesced watch-progress reports (I10).
    @ObservationIgnored let progress: ProgressReporter
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
        await api.onUnauthorized { [weak self] in
            Task { @MainActor in await self?.sessionLost() }
        }
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
        // Paid-but-uncredited transactions from an interrupted purchase are
        // re-sent now; later ones (Ask to Buy approvals, other devices) arrive
        // on the updates stream.
        store.startListening(api: api) { [weak self] w in self?.wallet.reconcile(with: w) }
        if await store.syncPending(api: api) > 0 { await refreshWallet() }
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
            options: [.alert, .sound, .badge, .provisional]) { [weak self] granted, _ in
            guard granted else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                let api = self.api
                PushDelegate.onToken = { hex in
                    Task { try? await api.registerPush(token: hex) }
                }
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
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

    /// The server said 401 mid-session (30-day token expired, or "sign out all
    /// devices" / account deletion from elsewhere): drop the dead token and
    /// continue as a fresh guest instead of failing every call until a
    /// force-quit.
    func sessionLost() async {
        guard !recoveringSession else { return }
        recoveringSession = true
        defer { recoveringSession = false }
        let wasMember = isSignedIn
        storedToken = nil
        profile = nil
        wallet = WalletStore()
        continueItems = []; myListSlugs = []; myListSeries = []; reminderSlugs = []
        await api.setAuthToken(nil)
        await startGuest()
        await refreshWallet()
        await loadEngagement()
        sessionNotice = wasMember
            ? "You were signed out. Sign in again to see your coins and your place."
            : "Your session expired — we started a fresh one."
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

    /// `identityToken` is the JWT from ASAuthorizationAppleIDCredential; the
    /// server verifies it against Apple's keys.
    func signInWithApple(identityToken: String, fullName: String? = nil) async -> Bool {
        do {
            let auth = try await api.appleLogin(identityToken: identityToken, fullName: fullName)
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
        continueItems = []; myListSlugs = []; myListSeries = []; reminderSlugs = []
        await api.setAuthToken(nil)
        await startGuest()
        await refreshWallet()
    }

    /// "Sign out of other devices": the server rotates the session and hands
    /// THIS device a fresh token, so only the current phone stays signed in.
    func signOutOtherDevices() async -> Bool {
        guard let auth = try? await api.signOutDevices() else { return false }
        storedToken = auth.accessToken
        profile = auth.user
        return true
    }

    /// Change the app language: persisted at once (the UI re-renders), then
    /// mirrored to the profile so the next device picks it up.
    func setUILanguage(_ lang: String) {
        guard uiLanguage != lang else { return }
        uiLanguage = lang
        Task { if let me = try? await api.updateMe(uiLanguage: lang) { profile = me } }
    }

    /// App-language string lookup (see Strings.swift).
    func t(_ key: String) -> String { L10n.string(key, lang: uiLanguage) }

    /// Same, for keys that carry positional placeholders ("%d", "%1$d", "%@").
    /// Formatting runs in the POSIX locale so a Hindi UI still prints ASCII
    /// digits — the catalog, the ledger and the tests all speak in those.
    func t(_ key: String, _ args: CVarArg...) -> String {
        String(format: L10n.string(key, lang: uiLanguage), locale: Locale(identifier: "en_US_POSIX"),
               arguments: args)
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

    // MARK: Coins (StoreKit 2 → ledger)

    /// Buy a coin pack. The wallet changes only when the ledger says it did.
    func buy(sku: String) async -> PurchaseOutcome {
        let outcome = await store.buy(sku: sku, api: api)
        if case .credited(let w) = outcome { wallet.reconcile(with: w) }
        return outcome
    }

    /// Restore purchases: re-send anything paid but not yet credited, then
    /// re-read the wallet. Returns how many transactions were credited.
    @discardableResult
    func restorePurchases() async -> Int {
        let n = await store.restore(api: api)
        await refreshWallet()
        return n
    }

    func loadEngagement() async {
        if let cont = try? await api.continueWatching() { continueItems = cont.items }
        if let list = try? await api.myList() {
            myListSlugs = Set(list.slugs)
            myListSeries = list.series
        }
        // Reminders are additive to the session: a server without the
        // endpoint yet leaves whatever the bell toggled locally.
        if let r = try? await api.reminders() { reminderSlugs = Set(r.slugs) }
    }

    /// New-episode reminder bell for a series. Optimistic; the server's list
    /// wins when it answers, and a failed call leaves the optimistic state so
    /// the bell never flips back under the finger.
    func toggleReminder(slug: String) async {
        let wasOn = reminderSlugs.contains(slug)
        if wasOn { reminderSlugs.remove(slug) } else { reminderSlugs.insert(slug) }
        let result = wasOn
            ? try? await api.removeReminder(slug: slug)
            : try? await api.addReminder(slug: slug)
        if let result { reminderSlugs = Set(result.slugs) }
    }

    /// `/v1/search` (series + people). The DEBUG harness may answer locally so
    /// the UI test for the People section does not depend on the endpoint.
    func search(_ q: String) async throws -> SearchResponse {
        #if DEBUG
        if ProcessInfo.processInfo.environment["KATHA_STUB_SEARCH"] == "1" {
            return Self.stubSearch(q, lang: contentLanguage, catalog: feed.allSeries)
        }
        #endif
        return try await api.search(q: q, lang: contentLanguage)
    }

    #if DEBUG
    /// Title match over the cached feed plus one canned person (the seed
    /// catalog's Kaanch Ka Mahal lead) — UI-test scaffolding only.
    static func stubSearch(_ q: String, lang: String, catalog: [SeriesSummary]) -> SearchResponse {
        let needle = q.lowercased()
        let series = catalog.filter { $0.title.lowercased().contains(needle) }
        let lead = catalog.first { $0.slug == "kaanch-ka-mahal" }
        let people: [SearchPerson] = "aditi rawal".contains(needle) && lead != nil
            ? [SearchPerson(name: "Aditi Rawal", role: "Lead", series: [lead!])] : []
        return SearchResponse(query: q, series: series, people: people)
    }
    #endif

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

    /// Series title for a slug from the caches, else the slug prettified
    /// ("kaanch-ka-mahal" → "Kaanch Ka Mahal").
    func title(forSlug slug: String) -> String {
        let all = feed.rows.flatMap(\.series) + myListSeries
        if let s = all.first(where: { $0.slug == slug }) { return s.title }
        return slug.split(separator: "-").map(\.capitalized).joined(separator: " ")
    }

    // MARK: Parental lock

    func ratingNeedsPin(_ rating: String) -> Bool {
        guard parentalLockSet else { return false }
        return rating.contains("16+") || rating == "A"
    }

    /// Set (or, with `current`, change) the PIN. False when the current PIN is wrong.
    @discardableResult
    func setParentalPin(_ pin: String, current: String? = nil) -> Bool {
        let ok = parentalLock.set(pin, current: current)
        parentalLockSet = parentalLock.isSet
        return ok
    }

    /// Remove the lock; the current PIN is required.
    @discardableResult
    func removeParentalPin(current: String) -> Bool {
        let ok = parentalLock.clear(current: current)
        parentalLockSet = parentalLock.isSet
        return ok
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
    /// Hero → series container zoom (scoped to the Home stack only, so a rail
    /// card in another tab never matches the hero's transition source).
    @Namespace private var heroZoom

    var body: some View {
        ZStack(alignment: .top) {
            CoachMarksHost {
                TabView {
                    tabStack(path: $homePath) { FeedView() }
                        .environment(\.zoomNamespace, heroZoom)
                        .tabItem { Label(model.t("tab.home"), systemImage: "play.rectangle.fill") }
                    tabStack { BrowseView() }
                        .tabItem { Label(model.t("tab.browse"), systemImage: "square.grid.2x2.fill") }
                    tabStack { MyListView() }
                        .tabItem { Label(model.t("tab.mylist"), systemImage: "bookmark.fill") }
                    tabStack { ProfileView() }
                        .tabItem { Label(model.t("tab.profile"), systemImage: "person.crop.circle.fill") }
                }
                .background(Katha.Color.bg)
            }

            // Force update below config.min_app_version (server-decided).
            if model.updateRequired {
                UpdateRequiredView()
            }

            // A dead session was replaced (I8): say so once, then get out of the way.
            if let notice = model.sessionNotice {
                VStack { Spacer(); ToastView(text: notice).padding(.bottom, 90) }
                    .task { try? await Task.sleep(for: .seconds(4)); model.sessionNotice = nil }
                    .transition(.opacity)
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
            // Search → person page. Registered here, not inside SearchView: a
            // destination declared in the pushed view itself leaves its links
            // disabled on iOS 17/18.
            .navigationDestination(for: SearchPerson.self) { person in
                PersonView(person: person)
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
                    .kathaFont(44)
                    .foregroundStyle(Katha.Color.accent)
                Text("Update Katha to continue")
                    .kathaFont(20, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                Text("This version can no longer make purchases safely. Get the latest from the App Store.")
                    .kathaFont(14)
                    .foregroundStyle(Katha.Color.text2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
        }
    }
}
