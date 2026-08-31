import XCTest
@testable import KathaKit

final class WalletStoreTests: XCTestCase {

    func testCanAffordAndSpendBonusFirst() {
        var w = WalletStore(balanceBonus: 20, balanceBought: 100)
        XCTAssertTrue(w.canAfford(30))
        let split = w.applySpend(cost: 30)
        XCTAssertEqual(split?.bonus, 20)
        XCTAssertEqual(split?.bought, 10)
        XCTAssertEqual(w.balanceBonus, 0)
        XCTAssertEqual(w.balanceBought, 90)
        XCTAssertEqual(w.total, 90)
    }

    func testSpendRejectedWhenInsufficient() {
        var w = WalletStore(balanceBonus: 5, balanceBought: 10)
        XCTAssertFalse(w.canAfford(30))
        XCTAssertNil(w.applySpend(cost: 30))
        // Unchanged.
        XCTAssertEqual(w.total, 15)
    }

    func testCreditAndReconcile() {
        var w = WalletStore(balanceBonus: 0, balanceBought: 0)
        w.credit(coins: 1300, bonus: 130)  // web popular pack
        XCTAssertEqual(w.balanceBought, 1300)
        XCTAssertEqual(w.balanceBonus, 130)
        w.reconcile(with: Wallet(balanceBought: 600, balanceBonus: 0, total: 600))
        XCTAssertEqual(w.total, 600)
        XCTAssertEqual(w.balanceBonus, 0)
    }
}

final class PaywallViewModelTests: XCTestCase {

    func testBundlePricingAndSavings() {
        // 50 locked * 30 = 1500 gross; 25% off -> 1125; save 375.
        let wallet = WalletStore(balanceBonus: 0, balanceBought: 2000)
        var pw = PaywallViewModel(slug: "his-one-and-only-love", episodeNumber: 11,
                                  episodePrice: 30, remainingLocked: 50,
                                  bundleDiscountPct: 25, wallet: wallet)
        XCTAssertEqual(pw.bundleGross, 1500)
        XCTAssertEqual(pw.bundlePrice, 1125)
        XCTAssertEqual(pw.bundleSavings, 375)
        XCTAssertEqual(pw.episodeRupees, 4.5, accuracy: 0.001)
        XCTAssertTrue(pw.canAffordEpisode)
        XCTAssertTrue(pw.canAffordBundle)

        XCTAssertTrue(pw.optimisticUnlockBundle())
        XCTAssertEqual(pw.wallet.total, 875)
    }

    func testShortfallWhenCannotAfford() {
        let wallet = WalletStore(balanceBonus: 0, balanceBought: 10)
        let pw = PaywallViewModel(slug: "x", episodeNumber: 11, episodePrice: 30,
                                  remainingLocked: 40, bundleDiscountPct: 25, wallet: wallet)
        XCTAssertFalse(pw.canAffordEpisode)
        XCTAssertEqual(pw.coinsShortForEpisode, 20)
    }

    func testBuildFromLockedPlayback() {
        let pb = PlaybackResponse(locked: true, episodeId: "s:e011",
                                  priceCoins: 30, balance: 50, bundleOfferCoins: 1125)
        let pw = PaywallViewModel(slug: "s", episodeNumber: 11, playback: pb,
                                  bundleDiscountPct: 25, remainingLocked: 50,
                                  wallet: WalletStore(balanceBought: 50))
        XCTAssertEqual(pw.episodePrice, 30)
        XCTAssertEqual(pw.bundlePrice, 1125)  // matches server bundle_offer_coins
    }
}

final class FeedViewModelTests: XCTestCase {

    private func sampleHome() -> HomeResponse {
        let a = SeriesSummary(slug: "a", title: "A", genres: ["romance"], episodeCount: 81, primaryLanguage: "hi")
        let b = SeriesSummary(slug: "b", title: "B", genres: ["fantasy"], episodeCount: 50, primaryLanguage: "ta")
        return HomeResponse(rows: [
            HomeRow(title: "Trending", series: [a, b]),
            HomeRow(title: "Romance", series: [a])  // a repeated
        ])
    }

    func testAllSeriesDeduplicates() {
        let feed = FeedViewModel(home: sampleHome())
        XCTAssertFalse(feed.isEmpty)
        XCTAssertEqual(feed.allSeries.map(\.slug), ["a", "b"])
        XCTAssertEqual(feed.series(inRow: "Romance").map(\.slug), ["a"])
    }

    func testFreeWindow() {
        XCTAssertTrue(FeedViewModel.isFree(episode: 10, freeEpisodeCount: 10))
        XCTAssertFalse(FeedViewModel.isFree(episode: 11, freeEpisodeCount: 10))
    }

    func testEmptyFeed() {
        let feed = FeedViewModel(rows: [HomeRow(title: "Empty", series: [])])
        XCTAssertTrue(feed.isEmpty)
    }
}
