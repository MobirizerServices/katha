# KathaApp (SwiftUI iOS target)

The user-facing SwiftUI app. It imports the local `KathaKit` package for all
value logic (models, `KathaAPIClient`, and the SwiftUI-free view models) and
adds only presentation on top.

These files require Xcode + an iOS simulator to build (they use SwiftUI, AVKit,
and `@Observable`). They are intentionally **not** part of the `swift build`
verification, which covers the pure `KathaKit` package on macOS.

## Files
- `KathaApp.swift` — `@main` app, `AppModel` (env), `RootTabView`.
- `DesignSystem.swift` — Katha color/radius/spacing tokens + shared components.
- `FeedView.swift` — Discover feed of series posters.
- `SeriesView.swift` — series detail + episode grid (free/locked).
- `PlayerView.swift` — vertical player; gates via playback, shows paywall.
- `PaywallView.swift` — episode vs bundle unlock, optimistic + reconcile.
- `WalletView.swift` — balance + coin store (IAP verify).

## Wiring into an Xcode project
1. Create an iOS App target (iOS 17+).
2. Add the `KathaKit` package (`ios/KathaKit`) as a local package dependency.
3. Add these `.swift` files to the app target.
4. Point `AppModel(baseURL:)` at the running core-api (default
   `http://localhost:8799`); allow local HTTP via ATS for dev.
