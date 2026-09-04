import Foundation
import StoreKit
import KathaKit

/// What a purchase attempt came to. `credited` carries the wallet the LEDGER
/// returned — the app never decides how many coins a pack is worth.
enum PurchaseOutcome {
    case credited(Wallet)
    case cancelled
    case pending          // Ask to Buy / awaiting approval; coins land later
    case failed(String)   // user-facing reason
}

/// StoreKit 2 → Katha ledger. The contract that keeps money safe:
///
///   * Apple's signed transaction (`jwsRepresentation`) is what the server
///     verifies and credits; the app sends it, it never credits locally.
///   * A transaction is `finish()`ed ONLY after the server has credited it.
///     If the network drops in between, StoreKit keeps it in
///     `Transaction.unfinished` and we re-send it at launch and on Restore —
///     a paid pack can never be lost, and re-sending is idempotent server-side
///     (the ledger keys on the transaction).
///   * Consumables have no entitlement to restore; "Restore purchases" means
///     `AppStore.sync()` + re-sending anything still unfinished.
@MainActor
final class CoinStore {
    private var updates: Task<Void, Never>?

    /// DEBUG-only harness hook: the XCUITest suite runs on simulators with no
    /// StoreKit configuration, so it asks for the server's dev stub instead of
    /// the App Store sheet. Compiled out of Release — a shipping build can only
    /// buy through StoreKit.
    static var harnessStub: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["KATHA_FAKE_IAP"] == "1"
        #else
        return false
        #endif
    }

    // MARK: Purchase

    func buy(sku: String, api: KathaAPIClient) async -> PurchaseOutcome {
        if Self.harnessStub { return await stubBuy(sku: sku, api: api) }
        do {
            guard let product = try await Product.products(for: [sku]).first else {
                return .failed("This pack isn't available right now.")
            }
            switch try await product.purchase() {
            case .success(let verification):
                return await credit(verification, api: api)
            case .userCancelled:
                return .cancelled
            case .pending:
                return .pending
            @unknown default:
                return .failed("The App Store returned an unknown result.")
            }
        } catch {
            return .failed("Payment didn't go through. You weren't charged.")
        }
    }

    /// Hand Apple's signed transaction to the ledger; finish it only once the
    /// server has credited it.
    @discardableResult
    private func credit(_ verification: VerificationResult<Transaction>,
                        api: KathaAPIClient) async -> PurchaseOutcome {
        guard case .verified(let tx) = verification else {
            return .failed("Apple couldn't verify this purchase.")
        }
        do {
            let wallet = try await api.verifyIAP(jws: verification.jwsRepresentation,
                                                 sku: tx.productID)
            await tx.finish()
            return .credited(wallet)
        } catch {
            // Deliberately NOT finished: it stays in Transaction.unfinished and
            // is re-sent at next launch / Restore. The user paid; the coins
            // will land.
            return .failed("Payment went through but the coins haven't landed yet — "
                           + "they'll appear the next time you open Katha.")
        }
    }

    // MARK: Recovery

    /// Re-send every paid transaction the server hasn't credited yet.
    /// Returns how many were credited this time.
    @discardableResult
    func syncPending(api: KathaAPIClient) async -> Int {
        if Self.harnessStub { return 0 }
        var credited = 0
        for await verification in Transaction.unfinished {
            if case .credited = await credit(verification, api: api) { credited += 1 }
        }
        return credited
    }

    /// "Restore purchases": ask the App Store for anything this Apple ID paid
    /// for on other devices, then re-send whatever is still unfinished.
    func restore(api: KathaAPIClient) async -> Int {
        if Self.harnessStub { return 0 }
        try? await AppStore.sync()
        return await syncPending(api: api)
    }

    /// Transactions that arrive outside a purchase call (Ask to Buy approved,
    /// a pending payment completing, a purchase made on another device).
    func startListening(api: KathaAPIClient, onCredited: @escaping @MainActor (Wallet) -> Void) {
        guard updates == nil, !Self.harnessStub else { return }
        updates = Task { [weak self] in
            for await verification in Transaction.updates {
                guard let self else { return }
                if case .credited(let w) = await self.credit(verification, api: api) {
                    onCredited(w)
                }
            }
        }
    }

    // MARK: Dev stub (DEBUG + harness only)

    private func stubBuy(sku: String, api: KathaAPIClient) async -> PurchaseOutcome {
        do {
            let w = try await api.verifyIAP(jws: "dev-jws-\(sku)-\(UUID().uuidString)", sku: sku)
            return .credited(w)
        } catch {
            return .failed("Payment didn't go through. You weren't charged.")
        }
    }
}
