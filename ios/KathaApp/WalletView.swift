import SwiftUI
import KathaKit

/// Wallet + coin store (mockup §4 Account). Shows the split balance and the
/// coin packs; buying runs StoreKit in production, here it calls iap/verify.
struct WalletView: View {
    @Environment(AppModel.self) private var model
    @State private var packs: [CoinPack] = []
    @State private var buying: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                    balanceCard
                    VStack(alignment: .leading, spacing: Katha.Spacing.md) {
                        Text("Get coins")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Katha.Color.text)
                        ForEach(packs) { pack in
                            packRow(pack)
                        }
                    }
                }
                .padding(Katha.Spacing.lg)
            }
            .background(Katha.Color.bg)
            .navigationTitle("Wallet")
        }
        .task {
            await model.refreshWallet()
            packs = (try? await model.api.packs(storefront: "IN")) ?? []
        }
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
            }
            Text("\(model.wallet.balanceBonus) bonus · \(model.wallet.balanceBought) bought · never expire")
                .font(.system(size: 12))
                .foregroundStyle(Katha.Color.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Katha.Spacing.lg)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
    }

    private func packRow(_ pack: CoinPack) -> some View {
        Button {
            Task { await buy(pack) }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    CoinBadge(coins: pack.totalCoins)
                    if pack.bonusCoins > 0 {
                        Text("+\(pack.bonusCoins) bonus")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Katha.Color.success)
                    }
                }
                Spacer()
                Text("₹\(Int(pack.priceMajor))")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, Katha.Spacing.lg)
                    .padding(.vertical, 8)
                    .background(Katha.Color.accent)
                    .clipShape(Capsule())
            }
            .padding(Katha.Spacing.lg)
            .background(Katha.Color.raised)
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        }
        .disabled(buying != nil)
    }

    private func buy(_ pack: CoinPack) async {
        buying = pack.sku; defer { buying = nil }
        // Production: obtain a StoreKit 2 signed transaction (JWS) then verify.
        let devJWS = "dev-jws-\(pack.sku)"
        if let w = try? await model.api.verifyIAP(jws: devJWS, sku: pack.sku) {
            model.wallet.reconcile(with: w)
        }
    }
}
