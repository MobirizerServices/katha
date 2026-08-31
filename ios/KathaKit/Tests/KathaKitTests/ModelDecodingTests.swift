import XCTest
@testable import KathaKit

final class ModelDecodingTests: XCTestCase {

    func testDecodeHomeResponse() throws {
        let json = """
        {"rows":[
          {"title":"Trending now","series":[
            {"slug":"his-one-and-only-love","title":"His One and Only Love",
             "genres":["romance","drama"],"episode_count":81,"primary_language":"hi"},
            {"slug":"deny-me-dragon-king","title":"Deny Me, Dragon King",
             "genres":["fantasy"],"episode_count":50,"primary_language":"ta"}
          ]}
        ]}
        """.data(using: .utf8)!
        let home = try KathaJSON.decode(HomeResponse.self, from: json)
        XCTAssertEqual(home.rows.count, 1)
        XCTAssertEqual(home.rows[0].title, "Trending now")
        XCTAssertEqual(home.rows[0].series.count, 2)
        XCTAssertEqual(home.rows[0].series[0].slug, "his-one-and-only-love")
        XCTAssertEqual(home.rows[0].series[0].episodeCount, 81)
        XCTAssertEqual(home.rows[0].series[1].primaryLanguage, "ta")
    }

    func testDecodeSeriesDetailWithMissingTropes() throws {
        // `tropes` omitted -> defaults to [].
        let json = """
        {"slug":"i-wish-it-were-you","title":"I Wish It Were You","genres":["romance"],
         "episode_count":78,"primary_language":"hi","synopsis":"A love story.",
         "free_episode_count":10,"episode_coin_price":30,"bundle_discount_pct":25,
         "episodes":[
           {"number":1,"title":"Ep 1","is_free":true,"coin_price":0},
           {"number":11,"title":"Ep 11","is_free":false,"coin_price":30}
         ]}
        """.data(using: .utf8)!
        let d = try KathaJSON.decode(SeriesDetail.self, from: json)
        XCTAssertEqual(d.slug, "i-wish-it-were-you")
        XCTAssertEqual(d.tropes, [])
        XCTAssertEqual(d.freeEpisodeCount, 10)
        XCTAssertEqual(d.episodeCoinPrice, 30)
        XCTAssertEqual(d.bundleDiscountPct, 25)
        XCTAssertEqual(d.episodes.count, 2)
        XCTAssertTrue(d.episodes[0].isFree)
        XCTAssertEqual(d.episodes[1].coinPrice, 30)
    }

    func testDecodeWallet() throws {
        let json = #"{"balance_bought":600,"balance_bonus":130,"total":730}"#.data(using: .utf8)!
        let w = try KathaJSON.decode(Wallet.self, from: json)
        XCTAssertEqual(w.balanceBought, 600)
        XCTAssertEqual(w.balanceBonus, 130)
        XCTAssertEqual(w.total, 730)
    }

    func testDecodeCoinPacksIncludingWebBonus() throws {
        let json = """
        [
          {"sku":"coins_starter_in","storefront":"IN","price_minor":9900,"currency":"INR","coins":600},
          {"sku":"coins_web_popular_in","storefront":"WEB","price_minor":19900,"currency":"INR","coins":1300,"bonus_coins":130}
        ]
        """.data(using: .utf8)!
        let packs = try KathaJSON.decode([CoinPack].self, from: json)
        XCTAssertEqual(packs.count, 2)
        // Bonus omitted -> 0.
        XCTAssertEqual(packs[0].bonusCoins, 0)
        XCTAssertEqual(packs[0].totalCoins, 600)
        XCTAssertEqual(packs[0].priceMajor, 99.0, accuracy: 0.001)
        // Web pack carries +10% bonus.
        XCTAssertEqual(packs[1].bonusCoins, 130)
        XCTAssertEqual(packs[1].totalCoins, 1430)
    }

    func testDecodeLockedPlayback() throws {
        let json = """
        {"locked":true,"episode_id":"his-one-and-only-love:e011","price_coins":30,
         "balance":50,"bundle_offer_coins":1125}
        """.data(using: .utf8)!
        let p = try KathaJSON.decode(PlaybackResponse.self, from: json)
        XCTAssertTrue(p.locked)
        XCTAssertFalse(p.isEntitled)
        XCTAssertEqual(p.priceCoins, 30)
        XCTAssertEqual(p.balance, 50)
        XCTAssertEqual(p.bundleOfferCoins, 1125)
        XCTAssertNil(p.hlsMasterUrl)
    }

    func testDecodeEntitledPlayback() throws {
        let json = """
        {"locked":false,"episode_id":"his-one-and-only-love:e001","entitled":true,
         "hls_master_url":"https://cdn.katha.dev/hls/x/master.m3u8","resume_position_ms":0}
        """.data(using: .utf8)!
        let p = try KathaJSON.decode(PlaybackResponse.self, from: json)
        XCTAssertFalse(p.locked)
        XCTAssertTrue(p.isEntitled)
        XCTAssertEqual(p.hlsMasterUrl, "https://cdn.katha.dev/hls/x/master.m3u8")
        XCTAssertNil(p.priceCoins)
    }

    func testDecodeUnlockResult() throws {
        let json = """
        {"episode_ids":["s:e011"],"spent_bonus":20,"spent_bought":10,
         "wallet":{"balance_bought":90,"balance_bonus":0,"total":90}}
        """.data(using: .utf8)!
        let r = try KathaJSON.decode(UnlockResult.self, from: json)
        XCTAssertEqual(r.episodeIds, ["s:e011"])
        XCTAssertEqual(r.spentBonus, 20)
        XCTAssertEqual(r.spentBought, 10)
        XCTAssertEqual(r.wallet.total, 90)
    }
}
