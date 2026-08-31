import XCTest
@testable import KathaKit

final class CoinMathTests: XCTestCase {

    func testBundlePriceMatchesBackend() {
        // 40 locked * 30 * 0.75 = 900 (same as the core-api test).
        XCTAssertEqual(CoinMath.bundlePrice(remainingLocked: 40, episodePrice: 30, discountPct: 25), 900)
        // 50 locked * 30 * 0.75 = 1125 (matches the iOS paywall mockup copy).
        XCTAssertEqual(CoinMath.bundlePrice(remainingLocked: 50, episodePrice: 30, discountPct: 25), 1125)
    }

    func testSpendSplitBonusFirst() {
        let s = CoinMath.spendSplit(cost: 30, balanceBonus: 20, balanceBought: 100)
        XCTAssertEqual(s.bonus, 20)
        XCTAssertEqual(s.bought, 10)
    }

    func testSpendSplitAllFromBonusWhenEnough() {
        let s = CoinMath.spendSplit(cost: 30, balanceBonus: 120, balanceBought: 0)
        XCTAssertEqual(s.bonus, 30)
        XCTAssertEqual(s.bought, 0)
    }

    func testCanAfford() {
        XCTAssertTrue(CoinMath.canAfford(cost: 30, balanceBonus: 15, balanceBought: 15))
        XCTAssertFalse(CoinMath.canAfford(cost: 30, balanceBonus: 10, balanceBought: 15))
    }

    func testRupeeEquivalent() {
        XCTAssertEqual(CoinMath.rupees(forCoins: 30), 4.5, accuracy: 0.0001)  // 30 coins ≈ ₹4.5
    }
}
