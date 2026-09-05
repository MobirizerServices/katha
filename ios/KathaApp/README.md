# KathaApp (SwiftUI iOS target)

The user-facing SwiftUI app. It imports the local `KathaKit` package for all
value logic (models, `KathaAPIClient`, and the SwiftUI-free view models) and
adds only presentation on top.

These files require Xcode + an iOS simulator to build (they use SwiftUI, AVKit,
and `@Observable`). They are intentionally **not** part of the `swift build`
verification, which covers the pure `KathaKit` package on macOS.

## Files
- `KathaApp.swift` — `@main` app, `AppModel` (env), `RootTabView`.
- `DesignSystem.swift` — Katha color/radius/spacing tokens, the Dynamic Type
  layer (`.kathaFont(_:)` / `.kathaLabel(_:)` / `.kathaFrame(…)` — design sizes
  that scale; screens must not call `.font(.system(size:))`, which does not) and
  the shared components.
- `FeedView.swift` — Discover feed of series posters.
- `SeriesView.swift` — series detail + episode grid (free/locked).
- `PlayerView.swift` — vertical player; gates via playback, shows paywall.
- `PaywallView.swift` — episode vs bundle unlock, optimistic + reconcile.
- `WalletView.swift` — balance + coin store (IAP verify).
- `PacksSheet.swift` — 3.4 coin packs sheet with the confirming / pending
  (Ask to Buy) / failed states; reached from Wallet and the paywall.
- `ContinueWatchingView.swift` — 4.5 full continue-watching list ("E7 · 1 min left").
- `HelpAssistantView.swift` — 4.6 chat-style help over the FAQ (local intent
  matcher, English/Hindi, "Talk to a person" → grievance form). No network AI.
- `Strings.swift` — app-language table (en/hi) for every screen's chrome: tabs,
  Home, Browse, Search, Series, My list, Wallet, Profile, Help, the player and
  its sheets, Settings, paywall and packs. Applied through `AppModel.t(_:)`
  (and `t(_:_:)` for the keys carrying `%d` / `%@` placeholders) plus
  `.environment(\.locale)`.
- `DiscoverViews.swift` — Browse, Search (`/v1/search`: Series + People,
  `PersonView`), My list (reminder bell).
- `ProfileViews.swift` — Profile, Settings (app language, muted previews,
  sign out of other devices), parental lock incl. "Forgot PIN?" (OTP reset),
  Help & grievance, delete account.

## Wiring into an Xcode project
1. Create an iOS App target (iOS 17+).
2. Add the `KathaKit` package (`ios/KathaKit`) as a local package dependency.
3. Add these `.swift` files to the app target.
4. Point `AppModel(baseURL:)` at the running core-api (default
   `http://localhost:8799`); allow local HTTP via ATS for dev.
