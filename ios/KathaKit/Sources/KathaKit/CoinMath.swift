import Foundation

/// Pure coin-economy helpers used by the Wallet and Paywall feature modules for
/// *optimistic* UI only. The backend ledger remains the source of truth
/// (PDD principle 7, §12.7); these must agree with it so the optimistic number
/// the viewer sees matches what the server later confirms.
public enum CoinMath {

    /// Price to unlock all remaining locked episodes after the series bundle discount.
    /// Mirrors `catalog.bundle_price` in the backend (floor, not round).
    public static func bundlePrice(remainingLocked: Int, episodePrice: Int, discountPct: Int) -> Int {
        let gross = remainingLocked * episodePrice
        return Int((Double(gross) * Double(100 - discountPct) / 100.0).rounded(.down))
    }

    /// Preview how a spend splits across pools — bonus is always spent first.
    /// Returns (spentBonus, spentBought). Does not mutate anything.
    public static func spendSplit(cost: Int, balanceBonus: Int, balanceBought: Int) -> (bonus: Int, bought: Int) {
        let bonus = min(balanceBonus, cost)
        let bought = cost - bonus
        return (bonus, bought)
    }

    /// Whether the wallet can cover a cost (bonus + bought together).
    public static func canAfford(cost: Int, balanceBonus: Int, balanceBought: Int) -> Bool {
        balanceBonus + balanceBought >= cost
    }

    /// ₹ equivalent for a coin count, given ₹ per coin (default 0.15 — PDD §8.2).
    public static func rupees(forCoins coins: Int, rupeePerCoin: Double = 0.15) -> Double {
        Double(coins) * rupeePerCoin
    }
}
