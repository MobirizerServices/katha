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
                        ForEach(groupedHistory, id: \.day) { group in
                            Text(dayLabel(group.day))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Katha.Color.text2)
                                .textCase(.uppercase)
                                .kerning(0.6)
                                .padding(.top, 6)
                            ForEach(group.rows) { row in
                                historyRow(row)
                            }
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
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Katha.Color.text2)
            HStack(spacing: Katha.Spacing.sm) {
                ZStack {
                    Circle()
                        .fill(LinearGradient(colors: [Katha.Color.coin,
                                                      Katha.Color.coin.opacity(0.5)],
                                             startPoint: .topLeading,
                                             endPoint: .bottomTrailing))
                        .frame(width: 34, height: 34)
                    Image(systemName: "indianrupeesign")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Katha.Color.bg)
                }
                Text("\(model.wallet.total)")
                    .font(.system(size: 40, weight: .heavy).monospacedDigit())
                    .foregroundStyle(Katha.Color.text)
                    .contentTransition(.numericText())
                    .animation(Katha.Motion.spring, value: model.wallet.total)
                Text("≈ ₹\(rupees(model.wallet.total, rate: model.rupeeRate))")
                    .font(.system(size: 14))
                    .foregroundStyle(Katha.Color.text2)
            }
            Text("\(model.wallet.balanceBought) bought · \(model.wallet.balanceBonus) bonus — bonus is spent first. Coins never expire.")
                .font(.system(size: 12))
                .foregroundStyle(Katha.Color.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Katha.Spacing.lg)
        .background {
            LinearGradient(colors: [Katha.Color.raised, Katha.Color.surface],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
            .strokeBorder(Katha.Color.coin.opacity(0.2), lineWidth: 1))
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
        case "unlock": return prettyRef(row.referenceId)
        default: return row.referenceId
        }
    }

    /// "kaanch-ka-mahal:e11" → "Kaanch Ka Mahal · E11" — the ledger speaks in
    /// ids; the history speaks the viewer's language.
    private func prettyRef(_ ref: String) -> String {
        let parts = ref.split(separator: ":", maxSplits: 1)
        let title = parts[0].split(separator: "-").map(\.capitalized).joined(separator: " ")
        guard parts.count == 2 else { return title }
        return "\(title) · \(parts[1].uppercased())"
    }

    private var groupedHistory: [(day: String, rows: [LedgerEntry])] {
        let byDay = Dictionary(grouping: history) { String($0.createdAt.prefix(10)) }
        return byDay.keys.sorted(by: >).map { (day: $0, rows: byDay[$0] ?? []) }
    }

    private func dayLabel(_ day: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: day) else { return day }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.day().month(.wide))
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
        if let w = try? await model.api.verifyIAP(jws: "dev-jws-\(pack.sku)-\(UUID().uuidString)", sku: pack.sku) {
            model.wallet.reconcile(with: w)
            history = (try? await model.api.walletTransactions()) ?? history
        }
    }
}
