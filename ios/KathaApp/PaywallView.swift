import SwiftUI
import KathaKit

/// The money gate (mockup 3.3, PDD §8.4): price always shows the ₹ equivalent
/// ("Honest coins"), the bundle offer uses the server-advertised total, and when
/// the balance is short the coin packs appear INLINE — never a dead end.
struct PaywallView: View {
    let slug: String
    let episodeNumber: Int
    let episodeTitle: String
    let playback: PlaybackResponse
    let detail: SeriesDetail
    let onUnlocked: () async -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var working = false
    @State private var buyingSku: String?
    @State private var errorText: String?
    @State private var packs: [CoinPack] = []
    @State private var restored = false

    private var price: Int { playback.priceCoins ?? detail.episodeCoinPrice }
    private var bundleCoins: Int? { playback.bundleOfferCoins }
    private var remainingLocked: Int { detail.episodeCount - detail.freeEpisodeCount }
    private var balance: Int { model.wallet.total }
    private var canAfford: Bool { balance >= price }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                Capsule().fill(Katha.Color.raised)
                    .frame(width: 36, height: 5)
                    .frame(maxWidth: .infinity)

                // Header: episode identity
                VStack(alignment: .leading, spacing: 2) {
                    Text("Unlock E\(episodeNumber)")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Katha.Color.text)
                    Text(episodeTitle)
                        .font(.system(size: 14))
                        .foregroundStyle(Katha.Color.text2)
                        .lineLimit(1)
                }

                // Price with ₹ equivalent + balance ("Honest coins", PDD §6.5)
                HStack {
                    HStack(spacing: 6) {
                        Circle().fill(Katha.Color.coin).frame(width: 16, height: 16)
                        Text("\(price) coins")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                        Text("≈ ₹\(rupees(price, rate: model.rupeeRate))")
                            .font(.system(size: 13))
                            .foregroundStyle(Katha.Color.text2)
                    }
                    Spacer()
                    HStack(spacing: 5) {
                        Circle().fill(Katha.Color.coin).frame(width: 12, height: 12)
                        Text("You have \(balance)")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                    }
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Katha.Color.raised)
                    .clipShape(Capsule())
                }

                // Primary action
                if canAfford {
                    KathaPrimaryButton(title: working ? "Unlocking…" : "Unlock episode",
                                       enabled: !working) {
                        Task { await unlockEpisode() }
                    }
                } else {
                    KathaPrimaryButton(title: "Get coins", enabled: false) {}
                        .opacity(0.9)
                }

                // Bundle (server-advertised total; the ledger charges exactly this)
                if let bundle = bundleCoins, remainingLocked > 1 {
                    Button {
                        Task { await unlockBundle() }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Unlock all \(remainingLocked) remaining · \(bundle) coins")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Katha.Color.text)
                                Text("≈ ₹\(rupees(bundle, rate: model.rupeeRate)) vs ₹\(rupees(remainingLocked * price, rate: model.rupeeRate)) one by one")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Katha.Color.text2)
                            }
                            Spacer()
                            Text("Save \(detail.bundleDiscountPct)%")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Katha.Color.accent)
                                .padding(.horizontal, 7)
                                .frame(height: 20)
                                .background(Katha.Color.accent.opacity(0.14))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .padding(Katha.Spacing.lg)
                        .background(Katha.Color.raised)
                        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
                    }
                    .disabled(working || balance < bundle)
                    .opacity(balance >= bundle ? 1 : 0.55)
                }

                // Auto-unlock (§8.4: off by default, debits only when an episode starts)
                Toggle(isOn: $model.autoUnlock) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Auto-unlock next episodes")
                            .font(.system(size: 15))
                            .foregroundStyle(Katha.Color.text)
                        Text("Charges only when an episode starts")
                            .font(.system(size: 12))
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
                .tint(Katha.Color.success)

                if let errorText {
                    Text(errorText)
                        .font(.system(size: 13))
                        .foregroundStyle(Katha.Color.danger)
                }

                // Not enough? The packs come to the paywall — never a dead end.
                if !canAfford {
                    VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                        Text("Buy once, keep watching")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Katha.Color.text)
                        ForEach(packs) { pack in
                            PackRow(pack: pack, buying: buyingSku == pack.sku) {
                                Task { await buy(pack) }
                            }
                        }
                    }
                }

                // Footer
                HStack(spacing: 6) {
                    Button(restored ? "Purchases restored" : "Restore purchases") {
                        Task {
                            await model.refreshWallet()
                            restored = true
                        }
                    }
                    Text("·")
                    Button("Terms") {}
                }
                .font(.system(size: 12))
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
            }
            .padding(Katha.Spacing.xl)
        }
        .background(Katha.Color.surface)
        .presentationDetents(canAfford ? [.medium, .large] : [.large])
        .presentationBackground(Katha.Color.surface)
        .task {
            if packs.isEmpty {
                packs = ((try? await model.api.packs(storefront: "IN")) ?? [])
            .filter { !$0.sku.hasPrefix("coins_web") }   // web-store SKUs never sell via Apple IAP
            }
        }
    }

    // MARK: actions

    private func unlockEpisode() async {
        working = true; defer { working = false }
        do {
            let res = try await model.api.unlockEpisode(
                slug: slug, number: episodeNumber, idempotencyKey: UUID().uuidString)
            model.wallet.reconcile(with: res.wallet)
            await onUnlocked()
            dismiss()
        } catch {
            await model.refreshWallet()
            errorText = "The unlock didn't go through. You weren't charged twice — try again."
        }
    }

    private func unlockBundle() async {
        working = true; defer { working = false }
        do {
            let res = try await model.api.unlockAll(slug: slug, idempotencyKey: UUID().uuidString)
            model.wallet.reconcile(with: res.wallet)
            await onUnlocked()
            dismiss()
        } catch {
            await model.refreshWallet()
            errorText = "The unlock didn't go through. You weren't charged twice — try again."
        }
    }

    private func buy(_ pack: CoinPack) async {
        buyingSku = pack.sku; defer { buyingSku = nil }
        // Production: StoreKit 2 purchase → send tx.jwsRepresentation. Dev: stub JWS.
        do {
            let w = try await model.api.verifyIAP(jws: "dev-jws-\(pack.sku)-\(UUID().uuidString)", sku: pack.sku)
            model.wallet.reconcile(with: w)
            errorText = nil
        } catch {
            errorText = "Payment didn't go through. You weren't charged."
        }
    }
}

// MARK: - Coin pack row (shared with Wallet; mockup 3.4 copy)

struct PackMeta {
    let name: String
    let blurb: String
    let badge: String?
    let highlighted: Bool

    static func lookup(_ sku: String, firstPack2x: Bool) -> PackMeta {
        switch sku {
        case "coins_starter_in":
            return .init(name: "Starter", blurb: "Enough for 20 episodes",
                         badge: firstPack2x ? "2× on your first pack" : nil, highlighted: false)
        case "coins_popular_in":
            return .init(name: "Popular", blurb: "Finishes a series and the next",
                         badge: "Popular", highlighted: true)
        case "coins_value_in":
            return .init(name: "Value", blurb: "Best for binge weekends", badge: nil, highlighted: false)
        case "coins_binge_in":
            return .init(name: "Binge", blurb: "About five series", badge: nil, highlighted: false)
        case "coins_mega_in":
            return .init(name: "Mega", blurb: "Lowest price per coin", badge: nil, highlighted: false)
        default:
            return .init(name: sku, blurb: "", badge: nil, highlighted: false)
        }
    }
}

struct PackRow: View {
    @Environment(AppModel.self) private var model
    let pack: CoinPack
    var buying = false
    let action: () -> Void

    var body: some View {
        let meta = PackMeta.lookup(pack.sku, firstPack2x: model.firstPack2x)
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text("\(pack.totalCoins.formatted()) coins")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                        if let badge = meta.badge {
                            Text(badge)
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(meta.highlighted ? Katha.Color.accent : Katha.Color.coin)
                                .padding(.horizontal, 6)
                                .frame(height: 18)
                                .background((meta.highlighted ? Katha.Color.accent : Katha.Color.coin).opacity(0.15))
                                .clipShape(Capsule())
                        }
                    }
                    Text(meta.blurb)
                        .font(.system(size: 12))
                        .foregroundStyle(Katha.Color.text2)
                }
                Spacer()
                if buying {
                    ProgressView().tint(Katha.Color.text)
                } else {
                    Text("₹\(Int(pack.priceMajor))")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Katha.Color.bg)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Katha.Color.text)
                        .clipShape(Capsule())
                }
            }
            .padding(Katha.Spacing.md)
            .background(Katha.Color.raised)
            .overlay(
                RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous)
                    .strokeBorder(meta.highlighted ? Katha.Color.accent : .clear, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        }
        .disabled(buying)
    }
}
