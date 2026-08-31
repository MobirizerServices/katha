import XCTest
@testable import KathaKit

/// Exercises the memberwise initializers, Identifiable ids, computed properties,
/// and encode paths of the Codable models that the decode-focused tests skip.
final class ModelValueTests: XCTestCase {

    func testSeriesSummaryMemberwiseInitAndId() {
        let s = SeriesSummary(slug: "kaanch-ka-mahal", title: "Kaanch Ka Mahal",
                              genres: ["drama"], episodeCount: 60, primaryLanguage: "hi")
        XCTAssertEqual(s.id, "kaanch-ka-mahal")
        XCTAssertEqual(s.id, s.slug)
    }

    func testEpisodeMemberwiseInitAndId() {
        let e = Episode(number: 11, title: "Ep 11", isFree: false, coinPrice: 30)
        XCTAssertEqual(e.id, 11)
        XCTAssertFalse(e.isFree)
    }

    func testSeriesDetailMemberwiseInitAndId() {
        let d = SeriesDetail(slug: "ceo-sahab", title: "CEO Sahab", genres: ["romance"],
                             episodeCount: 72, primaryLanguage: "hi", synopsis: "s",
                             tropes: ["enemies-to-lovers"], freeEpisodeCount: 10,
                             episodeCoinPrice: 30, bundleDiscountPct: 25, episodes: [])
        XCTAssertEqual(d.id, "ceo-sahab")
        XCTAssertEqual(d.tropes, ["enemies-to-lovers"])
    }

    func testHomeRowAndResponseMemberwiseInitAndId() {
        let row = HomeRow(title: "Trending", series: [])
        XCTAssertEqual(row.id, "Trending")
        let resp = HomeResponse(rows: [row])
        XCTAssertEqual(resp.rows.count, 1)
    }

    func testWalletMemberwiseInit() {
        let w = Wallet(balanceBought: 600, balanceBonus: 130, total: 730)
        XCTAssertEqual(w.total, 730)
    }

    func testCoinPackMemberwiseInitComputedAndId() {
        let pack = CoinPack(sku: "coins_popular_in", storefront: "IN", priceMinor: 19900,
                            currency: "INR", coins: 1300, bonusCoins: 130)
        XCTAssertEqual(pack.id, "coins_popular_in")
        XCTAssertEqual(pack.totalCoins, 1430)
        XCTAssertEqual(pack.priceMajor, 199.0, accuracy: 0.001)
        // Default bonus argument path.
        let noBonus = CoinPack(sku: "coins_starter_in", storefront: "IN", priceMinor: 9900,
                               currency: "INR", coins: 600)
        XCTAssertEqual(noBonus.bonusCoins, 0)
        XCTAssertEqual(noBonus.totalCoins, 600)
    }

    func testPlaybackResponseMemberwiseInitAndEntitled() {
        let entitled = PlaybackResponse(locked: false, episodeId: "s:e001",
                                        hlsMasterUrl: "https://cdn/x.m3u8", resumePositionMs: 500)
        XCTAssertTrue(entitled.isEntitled)
        XCTAssertEqual(entitled.resumePositionMs, 500)
        let locked = PlaybackResponse(locked: true, episodeId: "s:e011", priceCoins: 30)
        XCTAssertFalse(locked.isEntitled)
        XCTAssertEqual(locked.priceCoins, 30)
    }

    func testUnlockResultMemberwiseInit() {
        let r = UnlockResult(episodeIds: ["s:e011"], spentBonus: 20, spentBought: 10,
                             wallet: Wallet(balanceBought: 90, balanceBonus: 0, total: 90))
        XCTAssertEqual(r.episodeIds, ["s:e011"])
        XCTAssertEqual(r.wallet.total, 90)
    }

    /// Round-trip encode -> decode keeps the snake_case coding keys intact.
    func testCoinPackEncodeRoundTrip() throws {
        let pack = CoinPack(sku: "coins_value_in", storefront: "IN", priceMinor: 49900,
                            currency: "INR", coins: 3500, bonusCoins: 0)
        let data = try JSONEncoder().encode(pack)
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(obj["price_minor"] as? Int, 49900)
        XCTAssertEqual(obj["bonus_coins"] as? Int, 0)
        let back = try JSONDecoder().decode(CoinPack.self, from: data)
        XCTAssertEqual(back, pack)
    }

    func testWalletEncodeUsesSnakeCaseKeys() throws {
        let data = try JSONEncoder().encode(Wallet(balanceBought: 5, balanceBonus: 1, total: 6))
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(obj["balance_bought"] as? Int, 5)
        XCTAssertEqual(obj["balance_bonus"] as? Int, 1)
    }
}

/// Fills in the WalletStore / PaywallViewModel / FeedViewModel branches that the
/// existing suite does not reach.
final class ViewModelBranchTests: XCTestCase {

    func testWalletStoreInitFromWallet() {
        let w = WalletStore(wallet: Wallet(balanceBought: 100, balanceBonus: 30, total: 130))
        XCTAssertEqual(w.balanceBonus, 30)
        XCTAssertEqual(w.balanceBought, 100)
        XCTAssertEqual(w.total, 130)
    }

    func testWalletStoreDefaultInitIsZero() {
        let w = WalletStore()
        XCTAssertEqual(w.total, 0)
        XCTAssertFalse(w.canAfford(1))
    }

    func testApplySpendExactlyBonusLeavesBoughtUntouched() {
        var w = WalletStore(balanceBonus: 30, balanceBought: 50)
        let split = w.applySpend(cost: 30)
        XCTAssertEqual(split?.bonus, 30)
        XCTAssertEqual(split?.bought, 0)
        XCTAssertEqual(w.balanceBought, 50)
    }

    func testPaywallOptimisticUnlockEpisodeSuccessAndFailure() {
        // Affordable: episode unlock succeeds and deducts bonus-first.
        var pw = PaywallViewModel(slug: "s", episodeNumber: 11, episodePrice: 30,
                                  remainingLocked: 40, bundleDiscountPct: 25,
                                  wallet: WalletStore(balanceBonus: 30, balanceBought: 0))
        XCTAssertTrue(pw.optimisticUnlockEpisode())
        XCTAssertEqual(pw.wallet.total, 0)
        // Now broke: a second unlock fails and leaves the wallet unchanged.
        XCTAssertFalse(pw.optimisticUnlockEpisode())
        XCTAssertEqual(pw.wallet.total, 0)
    }

    func testPaywallCannotAffordBundleButCanAffordEpisode() {
        var pw = PaywallViewModel(slug: "s", episodeNumber: 11, episodePrice: 30,
                                  remainingLocked: 50, bundleDiscountPct: 25,
                                  wallet: WalletStore(balanceBought: 30))
        XCTAssertTrue(pw.canAffordEpisode)
        XCTAssertFalse(pw.canAffordBundle)
        XCTAssertFalse(pw.optimisticUnlockBundle()) // rejected, insufficient
        XCTAssertEqual(pw.wallet.total, 30)         // unchanged
        // Already affordable -> shortfall is zero.
        XCTAssertEqual(pw.coinsShortForEpisode, 0)
    }

    func testPaywallRupeeAndBundleRupeeDisplay() {
        let pw = PaywallViewModel(slug: "s", episodeNumber: 11, episodePrice: 30,
                                  remainingLocked: 50, bundleDiscountPct: 25,
                                  wallet: WalletStore(balanceBought: 2000))
        XCTAssertEqual(pw.episodeRupees, 4.5, accuracy: 0.001)   // 30 * 0.15
        XCTAssertEqual(pw.bundleRupees, 168.75, accuracy: 0.001) // 1125 * 0.15
    }

    func testPaywallBuildFromLockedPlaybackWithMissingPriceDefaultsToZero() {
        // priceCoins nil -> episodePrice 0.
        let pb = PlaybackResponse(locked: true, episodeId: "s:e011")
        let pw = PaywallViewModel(slug: "s", episodeNumber: 11, playback: pb,
                                  bundleDiscountPct: 25, remainingLocked: 40,
                                  wallet: WalletStore())
        XCTAssertEqual(pw.episodePrice, 0)
        XCTAssertEqual(pw.bundlePrice, 0)
    }

    func testFeedDefaultInitIsEmpty() {
        let feed = FeedViewModel()
        XCTAssertTrue(feed.isEmpty)
        XCTAssertEqual(feed.allSeries, [])
    }

    func testFeedLoadReplacesRows() {
        var feed = FeedViewModel()
        let s = SeriesSummary(slug: "a", title: "A", genres: [], episodeCount: 1, primaryLanguage: "hi")
        feed.load(HomeResponse(rows: [HomeRow(title: "Row", series: [s])]))
        XCTAssertFalse(feed.isEmpty)
        XCTAssertEqual(feed.allSeries.map(\.slug), ["a"])
    }

    func testFeedSeriesInRowMissReturnsEmpty() {
        let feed = FeedViewModel(rows: [HomeRow(title: "Row", series: [])])
        XCTAssertEqual(feed.series(inRow: "Nonexistent"), [])
    }

    func testFreeWindowBoundaries() {
        XCTAssertTrue(FeedViewModel.isFree(episode: 1, freeEpisodeCount: 10))
        XCTAssertTrue(FeedViewModel.isFree(episode: 10, freeEpisodeCount: 10))
        XCTAssertFalse(FeedViewModel.isFree(episode: 11, freeEpisodeCount: 10))
    }
}
