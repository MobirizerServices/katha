import SwiftUI
import KathaKit

/// Wallet & history (mockup 3.5): split balance ("bonus is spent first"), the
/// coin packs, and the ledger history — every row names what moved and why.
struct WalletView: View {
    @Environment(AppModel.self) private var model
    @State private var packs: [CoinPack] = []
    @State private var history: [LedgerEntry] = []
    @State private var buying: String?
    @State private var restored = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                balanceCard

                VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                    Text("Get coins")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Katha.Color.text)
                    ForEach(packs) { pack in
                        PackRow(pack: pack, buying: buying == pack.sku) {
                            Task { await buy(pack) }
                        }
                    }
                    Text("Payment is handled by Apple. Prices include GST. Coins never expire while your account exists.")
                        .font(.system(size: 11))
                        .foregroundStyle(Katha.Color.text2)
                }

                if !history.isEmpty {
                    VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                        Text("History")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Katha.Color.text)
                        ForEach(history) { row in
                            historyRow(row)
                        }
                    }
                }

                Button(restored ? "Purchases restored" : "Restore purchases") {
                    Task { await model.refreshWallet(); await reload(); restored = true }
                }
                .font(.system(size: 13))
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
            }
            .padding(Katha.Spacing.lg)
        }
        .background(Katha.Color.bg)
        .navigationTitle("Wallet")
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .task { await reload() }
        .refreshable { await reload() }
    }

    private var balanceCard: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
            Text("Balance")
                .font(.system(size: 13))
                .foregroundStyle(Katha.Color.text2)
            HStack(spacing: Katha.Spacing.sm) {
                Circle().fill(Katha.Color.coin).frame(width: 28, height: 28)
                Text("\(model.wallet.total)")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                Text("≈ ₹\(rupees(model.wallet.total))")
                    .font(.system(size: 14))
                    .foregroundStyle(Katha.Color.text2)
            }
            Text("\(model.wallet.balanceBought) bought · \(model.wallet.balanceBonus) bonus — bonus is spent first. Coins never expire.")
                .font(.system(size: 12))
                .foregroundStyle(Katha.Color.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Katha.Spacing.lg)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
    }

    private func historyRow(_ row: LedgerEntry) -> some View {
        HStack {
            ZStack {
                Circle()
                    .fill(row.net >= 0 ? Katha.Color.success.opacity(0.15)
                                       : Katha.Color.raised)
                    .frame(width: 30, height: 30)
                Text(row.net >= 0 ? "+" : "−")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(row.net >= 0 ? Katha.Color.success : Katha.Color.text2)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(label(for: row))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                Text(sub(for: row))
                    .font(.system(size: 11))
                    .foregroundStyle(Katha.Color.text2)
            }
            Spacer()
            Text(row.net > 0 ? "+\(row.net)" : "\(row.net)")
                .font(.system(size: 14, weight: .semibold).monospacedDigit())
                .foregroundStyle(row.net >= 0 ? Katha.Color.coin : Katha.Color.text)
        }
        .padding(.vertical, 6)
    }

    private func label(for row: LedgerEntry) -> String {
        switch row.type {
        case "purchase": return "Coin pack"
        case "bonus": return "Bonus coins"
        case "checkin": return "Daily check-in"
        case "referral": return "Referral reward"
        case "unlock": return row.referenceType == "bundle" ? "Series bundle unlock" : "Episode unlock"
        case "refund_clawback": return "Refund"
        case "admin_adjust": return "Support adjustment"
        default: return row.type.capitalized
        }
    }

    private func sub(for row: LedgerEntry) -> String {
        switch row.type {
        case "purchase": return row.referenceType == "web_order" ? "Web store" : "App Store"
        case "unlock": return row.referenceId.replacingOccurrences(of: ":", with: " · ")
        default: return row.referenceId
        }
    }

    private func reload() async {
        await model.refreshWallet()
        packs = ((try? await model.api.packs(storefront: "IN")) ?? [])
            .filter { !$0.sku.hasPrefix("coins_web") }   // web-store SKUs never sell via Apple IAP
        history = (try? await model.api.walletTransactions()) ?? []
    }

    private func buy(_ pack: CoinPack) async {
        buying = pack.sku; defer { buying = nil }
        // Production: StoreKit 2 signed transaction; dev build stubs the JWS.
        if let w = try? await model.api.verifyIAP(jws: "dev-jws-\(pack.sku)", sku: pack.sku) {
            model.wallet.reconcile(with: w)
            history = (try? await model.api.walletTransactions()) ?? history
        }
    }
}
