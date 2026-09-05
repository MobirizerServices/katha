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
    @State private var showPacks = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                balanceCard

                VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                    HStack {
                        Text(model.t("wallet.getCoins"))
                            .kathaLabel(14)
                            .kerning(1.2)
                            .foregroundStyle(Katha.Color.text2)
                        Spacer()
                        // The 3.4 packs sheet, with the confirming / pending /
                        // failed states drawn in full.
                        Button {
                            showPacks = true
                        } label: {
                            HStack(spacing: 4) {
                                Text(model.t("wallet.allPacks"))
                                Image(systemName: "chevron.right").kathaFont(10, weight: .bold)
                            }
                            .kathaFont(13, weight: .semibold)
                            .foregroundStyle(Katha.Color.accent)
                        }
                        .accessibilityIdentifier("wallet.allPacks")
                    }
                    ForEach(packs) { pack in
                        PackRow(pack: pack, buying: buying == pack.sku) {
                            Task { await buy(pack) }
                        }
                    }
                    Text(model.t("wallet.footer"))
                        .kathaFont(11)
                        .foregroundStyle(Katha.Color.text2)
                }

                VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                    Text(model.t("wallet.history"))
                        .kathaLabel(14)
                        .kerning(1.2)
                        .foregroundStyle(Katha.Color.text2)
                    // The header stays even with nothing in it: a new viewer
                    // should learn that this is where their coins are accounted
                    // for, not find the section missing.
                    if history.isEmpty {
                        Text(model.t("wallet.history.empty"))
                            .kathaFont(13)
                            .foregroundStyle(Katha.Color.text2)
                            .padding(.vertical, Katha.Spacing.sm)
                    }
                    Group {
                        ForEach(groupedHistory, id: \.day) { group in
                            Text(dayLabel(group.day))
                                .kathaFont(12, weight: .semibold)
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

                Button(model.t(restored ? "packs.restored" : "packs.restore")) {
                    Task { await model.restorePurchases(); await reload(); restored = true }
                }
                .kathaFont(13)
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
            }
            .padding(Katha.Spacing.lg)
        }
        .background(Katha.Color.bg)
        .navigationTitle(model.t("wallet.title"))
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .task { await reload() }
        .refreshable { await reload() }
        .sheet(isPresented: $showPacks) {
            PacksSheet { Task { await reload() } }
        }
    }

    private var balanceCard: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
            Text(model.t("wallet.balance"))
                .kathaLabel()
                .kerning(1.1)
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
                        .kathaFont(14, weight: .bold)
                        .foregroundStyle(Katha.Color.bg)
                }
                Text("\(model.wallet.total)")
                    .kathaFont(40, weight: .heavy, monospacedDigit: true)
                    .foregroundStyle(Katha.Color.text)
                    .contentTransition(.numericText())
                    .animation(Katha.Motion.spring, value: model.wallet.total)
                if let rate = model.rupeeRate {
                    Text("≈ ₹\(rupees(model.wallet.total, rate: rate))")
                        .kathaFont(14)
                        .foregroundStyle(Katha.Color.text2)
                }
            }
            Text(model.t("wallet.split", model.wallet.balanceBought, model.wallet.balanceBonus))
                .kathaFont(12)
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
                    .kathaFrame(width: 30, height: 30)
                Text(row.net >= 0 ? "+" : "−")
                    .kathaFont(15, weight: .bold)
                    .foregroundStyle(row.net >= 0 ? Katha.Color.success : Katha.Color.text2)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(label(for: row))
                    .kathaFont(14, weight: .semibold)
                    .foregroundStyle(Katha.Color.text)
                Text(sub(for: row))
                    .kathaFont(11)
                    .foregroundStyle(Katha.Color.text2)
            }
            Spacer()
            Text(row.net > 0 ? "+\(row.net)" : "\(row.net)")
                .kathaFont(14, weight: .semibold, monospacedDigit: true)
                .foregroundStyle(row.net >= 0 ? Katha.Color.coin : Katha.Color.text)
        }
        .padding(.vertical, 6)
    }

    private func label(for row: LedgerEntry) -> String {
        switch row.type {
        case "purchase": return model.t("wallet.row.purchase")
        case "bonus": return model.t("wallet.row.bonus")
        case "checkin": return model.t("wallet.row.checkin")
        case "referral": return model.t("wallet.row.referral")
        case "unlock":
            return model.t(row.referenceType == "bundle" ? "wallet.row.bundle" : "wallet.row.unlock")
        case "refund_clawback": return model.t("wallet.row.refund")
        case "admin_adjust": return model.t("wallet.row.adjust")
        default: return row.type.capitalized
        }
    }

    private func sub(for row: LedgerEntry) -> String {
        switch row.type {
        case "purchase":
            return model.t(row.referenceType == "web_order" ? "wallet.src.web" : "wallet.src.appstore")
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
        if Calendar.current.isDateInToday(date) { return model.t("wallet.today") }
        if Calendar.current.isDateInYesterday(date) { return model.t("wallet.yesterday") }
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
        // StoreKit 2 purchase → Apple's signed transaction → the ledger credits.
        if case .credited = await model.buy(sku: pack.sku) {
            history = (try? await model.api.walletTransactions()) ?? history
        }
    }
}
