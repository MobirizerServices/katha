import Foundation

// Plain view-model logic with pure methods so it compiles and unit-tests without
// SwiftUI. The SwiftUI layer (ios/KathaApp) wraps these and adds @Observable.
// All money math routes through CoinMath, which mirrors the backend ledger, so
// the optimistic number the viewer sees matches what the server later confirms.

/// Holds the local view of the wallet and previews spends optimistically.
public struct WalletStore: Equatable, Sendable {
    public private(set) var balanceBonus: Int
    public private(set) var balanceBought: Int

    public init(balanceBonus: Int = 0, balanceBought: Int = 0) {
        self.balanceBonus = balanceBonus
        self.balanceBought = balanceBought
    }

    public init(wallet: Wallet) {
        self.balanceBonus = wallet.balanceBonus
        self.balanceBought = wallet.balanceBought
    }

    public var total: Int { balanceBonus + balanceBought }

    public func canAfford(_ cost: Int) -> Bool {
        CoinMath.canAfford(cost: cost, balanceBonus: balanceBonus, balanceBought: balanceBought)
    }

    /// Optimistically deduct a spend (bonus first). Returns the split applied.
    /// No-op and returns nil if the wallet cannot cover the cost.
    @discardableResult
    public mutating func applySpend(cost: Int) -> (bonus: Int, bought: Int)? {
        guard canAfford(cost) else { return nil }
        let split = CoinMath.spendSplit(cost: cost, balanceBonus: balanceBonus, balanceBought: balanceBought)
        balanceBonus -= split.bonus
        balanceBought -= split.bought
        return split
    }

    /// Credit coins into the wallet (e.g. after a verified purchase).
    public mutating func credit(coins: Int, bonus: Int = 0) {
        balanceBought += coins
        balanceBonus += bonus
    }

    /// Reconcile against the authoritative server wallet (replaces local state).
    public mutating func reconcile(with wallet: Wallet) {
        balanceBonus = wallet.balanceBonus
        balanceBought = wallet.balanceBought
    }
}

/// Drives the paywall shown on a locked episode: single-episode price vs the
/// discounted series bundle, and whether the current wallet can cover each.
public struct PaywallViewModel: Equatable, Sendable {
    public let slug: String
    public let episodeNumber: Int
    public let episodePrice: Int
    public let remainingLocked: Int
    public let bundleDiscountPct: Int
    public var wallet: WalletStore

    public init(slug: String, episodeNumber: Int, episodePrice: Int,
                remainingLocked: Int, bundleDiscountPct: Int, wallet: WalletStore) {
        self.slug = slug
        self.episodeNumber = episodeNumber
        self.episodePrice = episodePrice
        self.remainingLocked = remainingLocked
        self.bundleDiscountPct = bundleDiscountPct
        self.wallet = wallet
    }

    /// Build a paywall from server-authoritative data.
    public init(slug: String, episodeNumber: Int, playback: PlaybackResponse,
                bundleDiscountPct: Int, remainingLocked: Int, wallet: WalletStore) {
        self.slug = slug
        self.episodeNumber = episodeNumber
        self.episodePrice = playback.priceCoins ?? 0
        self.remainingLocked = remainingLocked
        self.bundleDiscountPct = bundleDiscountPct
        self.wallet = wallet
    }

    /// Full (undiscounted) price of unlocking all remaining locked episodes.
    public var bundleGross: Int { remainingLocked * episodePrice }

    /// Discounted bundle price (matches the backend/CoinMath computation).
    public var bundlePrice: Int {
        CoinMath.bundlePrice(remainingLocked: remainingLocked,
                             episodePrice: episodePrice,
                             discountPct: bundleDiscountPct)
    }

    /// Coins saved by buying the bundle vs one-by-one.
    public var bundleSavings: Int { bundleGross - bundlePrice }

    public var canAffordEpisode: Bool { wallet.canAfford(episodePrice) }
    public var canAffordBundle: Bool { wallet.canAfford(bundlePrice) }

    /// How many more coins the viewer needs to buy this episode (0 if affordable).
    public var coinsShortForEpisode: Int { max(0, episodePrice - wallet.total) }

    /// Rupee display strings (₹, one decimal) for the two offers.
    public var episodeRupees: Double { CoinMath.rupees(forCoins: episodePrice) }
    public var bundleRupees: Double { CoinMath.rupees(forCoins: bundlePrice) }

    /// Apply an optimistic single-episode unlock to the local wallet.
    @discardableResult
    public mutating func optimisticUnlockEpisode() -> Bool {
        wallet.applySpend(cost: episodePrice) != nil
    }

    /// Apply an optimistic bundle unlock to the local wallet.
    @discardableResult
    public mutating func optimisticUnlockBundle() -> Bool {
        wallet.applySpend(cost: bundlePrice) != nil
    }
}

/// The home feed: server-provided rows plus a flattened, de-duplicated list.
public struct FeedViewModel: Equatable, Sendable {
    public private(set) var rows: [HomeRow]

    public init(rows: [HomeRow] = []) { self.rows = rows }

    public init(home: HomeResponse) { self.rows = home.rows }

    public mutating func load(_ home: HomeResponse) { self.rows = home.rows }

    public var isEmpty: Bool { rows.allSatisfy { $0.series.isEmpty } }

    /// All series across rows, de-duplicated by slug, order preserved.
    public var allSeries: [SeriesSummary] {
        var seen = Set<String>()
        var out: [SeriesSummary] = []
        for row in rows {
            for s in row.series where !seen.contains(s.slug) {
                seen.insert(s.slug)
                out.append(s)
            }
        }
        return out
    }

    public func series(inRow title: String) -> [SeriesSummary] {
        rows.first { $0.title == title }?.series ?? []
    }

    /// Whether an episode number is in the free window for a series.
    public static func isFree(episode number: Int, freeEpisodeCount: Int) -> Bool {
        number <= freeEpisodeCount
    }
}
