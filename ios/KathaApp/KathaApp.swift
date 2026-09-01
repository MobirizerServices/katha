import SwiftUI
import KathaKit

// App entry + shared app state. The SwiftUI layer wraps KathaKit's pure view
// models and the KathaAPIClient actor. Requires Xcode/simulator to build & run.

@main
struct KathaApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(Katha.Color.accent)
        }
    }
}

/// Observable façade over the API client and wallet, shared through the environment.
@MainActor @Observable
final class AppModel {
    let api: KathaAPIClient
    var wallet = WalletStore()
    var feed = FeedViewModel()
    var loadError: String?
    var isLoading = false

    // 127.0.0.1 (not "localhost"): core-api binds IPv4 only, and "localhost"
    // resolves to IPv6 ::1 first on the simulator → a refused connection first.
    init(baseURL: URL = URL(string: "http://127.0.0.1:8799")!) {
        self.api = KathaAPIClient(baseURL: baseURL, authToken: "dev-user")
    }

    func loadHome(lang: String = "hi") async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let home = api.home(lang: lang)
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
}

struct RootTabView: View {
    var body: some View {
        TabView {
            FeedView()
                .tabItem { Label("Home", systemImage: "play.rectangle.fill") }
            WalletView()
                .tabItem { Label("Wallet", systemImage: "creditcard.fill") }
        }
        .background(Katha.Color.bg)
    }
}
