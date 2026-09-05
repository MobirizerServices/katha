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
    @State private var showPacks = false

    private var price: Int { playback.priceCoins ?? detail.episodeCoinPrice }
    private var bundleCoins: Int? { playback.bundleOfferCoins }
    /// Episodes still to buy — from the server (the set unlock-all charges for),
    /// so an already-owned episode never inflates the "one by one" comparison.
    private var remainingLocked: Int {
        playback.remainingLocked ?? (detail.episodeCount - detail.freeEpisodeCount)
    }
    private var balance: Int { model.wallet.total }
    private var canAfford: Bool { balance >= price }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                // Header: episode identity
                VStack(alignment: .leading, spacing: 2) {
                    Text("Unlock E\(episodeNumber)")
                        .font(Katha.Font.display(28))
                        .foregroundStyle(Katha.Color.text)
                    Text(episodeTitle)
                        .kathaFont(14)
                        .foregroundStyle(Katha.Color.text2)
                        .lineLimit(1)
                }

                // Price with ₹ equivalent + balance ("Honest coins", PDD §6.5)
                HStack {
                    HStack(spacing: 6) {
                        Circle().fill(Katha.Color.coin).frame(width: 16, height: 16)
                        Text("\(price) coins")
                            .kathaFont(17, weight: .semibold)
                            .foregroundStyle(Katha.Color.text)
                        if let rate = model.rupeeRate {
                            Text("≈ ₹\(rupees(price, rate: rate))")
                                .kathaFont(13)
                                .foregroundStyle(Katha.Color.text2)
                        }
                    }
                    Spacer()
                    HStack(spacing: 5) {
                        Circle().fill(Katha.Color.coin).frame(width: 12, height: 12)
                        Text("You have \(balance)")
                            .kathaFont(13, weight: .semibold)
                            .foregroundStyle(Katha.Color.text)
                            .contentTransition(.numericText())
                            .animation(Katha.Motion.spring, value: balance)
                    }
                    .padding(.horizontal, 10)
                    .kathaFrame(height: 28)
                    .background(Katha.Color.raised)
                    .clipShape(Capsule())
                }

                // Primary action
                if canAfford {
                    KathaPrimaryButton(title: working ? model.t("paywall.unlocking")
                                                      : model.t("paywall.unlock"),
                                       enabled: !working) {
                        Task { await unlockEpisode() }
                    }
                } else {
                    // Opens the full packs sheet (3.4); the same packs also sit
                    // inline below so the fastest path stays one tap.
                    KathaPrimaryButton(title: model.t("paywall.getCoins")) {
                        showPacks = true
                    }
                }

                // Bundle (server-advertised total; the ledger charges exactly this)
                if let bundle = bundleCoins, remainingLocked > 1 {
                    Button {
                        Task { await unlockBundle() }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                // Two lines by design rather than a wrap that
                                // strands the separator at the end of line one.
                                Text("Unlock all \(remainingLocked) remaining")
                                    .kathaFont(15, weight: .semibold)
                                    .foregroundStyle(Katha.Color.text)
                                Text("\(bundle.formatted()) coins")
                                    .kathaFont(15, weight: .semibold)
                                    .foregroundStyle(Katha.Color.text)
                                if let rate = model.rupeeRate {
                                    Text("≈ ₹\(rupees(bundle, rate: rate)) vs ₹\(rupees(remainingLocked * price, rate: rate)) one by one")
                                        .kathaFont(12)
                                        .foregroundStyle(Katha.Color.text2)
                                }
                            }
                            Spacer()
                            Text("Save \(detail.bundleDiscountPct)%")
                                .kathaFont(11, weight: .bold)
                                .fixedSize()
                                .foregroundStyle(Katha.Color.accent)
                                .padding(.horizontal, 7)
                                .kathaFrame(height: 20)
                                .background(Katha.Color.accent.opacity(0.14))
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .padding(Katha.Spacing.lg)
                        .background(Katha.Color.raised)
                        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(working || balance < bundle)
                    .opacity(balance >= bundle ? 1 : 0.55)
                }

                // Auto-unlock (§8.4: off by default, debits only when an episode starts)
                Toggle(isOn: $model.autoUnlock) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.t("settings.autoUnlock"))
                            .kathaFont(15)
                            .foregroundStyle(Katha.Color.text)
                        Text(model.t("drawer.autoUnlock.caption.short"))
                            .kathaFont(12)
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
                .tint(Katha.Color.success)

                if let errorText {
                    Text(errorText)
                        .kathaFont(13)
                        .foregroundStyle(Katha.Color.danger)
                }

                // Not enough? The packs come to the paywall — never a dead end.
                if !canAfford {
                    VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                        Text(model.t("paywall.buyOnce"))
                            .kathaFont(15, weight: .bold)
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
                    Button(model.t(restored ? "packs.restored" : "packs.restore")) {
                        Task {
                            await model.restorePurchases()
                            restored = true
                        }
                    }
                    Text("·")
                    Button(model.t("packs.terms")) {}
                }
                .kathaFont(12)
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
            }
            .padding(Katha.Spacing.xl)
        }
        .background(Katha.Color.surface)
        .presentationDetents(canAfford ? [.medium, .large] : [.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
        .presentationCornerRadius(24)
        .sheet(isPresented: $showPacks) {
            PacksSheet(context: "E\(episodeNumber) unlocks the moment coins land.")
        }
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
            Haptics.success()
            await onUnlocked()
            dismiss()
        } catch {
            await model.refreshWallet()
            Haptics.warning()
            errorText = "The unlock didn't go through. You weren't charged twice — try again."
        }
    }

    private func unlockBundle() async {
        working = true; defer { working = false }
        do {
            let res = try await model.api.unlockAll(slug: slug, idempotencyKey: UUID().uuidString)
            model.wallet.reconcile(with: res.wallet)
            Haptics.success()
            await onUnlocked()
            dismiss()
        } catch {
            await model.refreshWallet()
            Haptics.warning()
            errorText = "The unlock didn't go through. You weren't charged twice — try again."
        }
    }

    private func buy(_ pack: CoinPack) async {
        buyingSku = pack.sku; defer { buyingSku = nil }
        // StoreKit 2 purchase → Apple's signed transaction → the ledger credits.
        switch await model.buy(sku: pack.sku) {
        case .credited:
            Haptics.success()
            errorText = nil
        case .cancelled:
            break
        case .pending:
            errorText = "Waiting for approval. Your coins will land as soon as the purchase is approved."
        case .failed(let reason):
            Haptics.warning()
            errorText = reason
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
                            .kathaFont(15, weight: .semibold)
                            .foregroundStyle(Katha.Color.text)
                        if let badge = meta.badge {
                            Text(badge)
                                .kathaFont(10, weight: .bold)
                                .foregroundStyle(meta.highlighted ? Katha.Color.accent : Katha.Color.coin)
                                .padding(.horizontal, 6)
                                .kathaFrame(height: 18)
                                .background((meta.highlighted ? Katha.Color.accent : Katha.Color.coin).opacity(0.15))
                                .clipShape(Capsule())
                        }
                    }
                    Text(meta.blurb)
                        .kathaFont(12)
                        .foregroundStyle(Katha.Color.text2)
                }
                Spacer()
                if buying {
                    ProgressView().tint(Katha.Color.text)
                } else {
                    Text("₹\(Int(pack.priceMajor))")
                        .kathaFont(14, weight: .semibold)
                        .fixedSize()
                        .foregroundStyle(Katha.Color.bg)
                        .padding(.horizontal, 14)
                        .kathaFrame(height: 32)
                        .background(Katha.Color.text)
                        .clipShape(Capsule())
                }
            }
            .padding(Katha.Spacing.md)
            // The badge alone carries "Popular". An accent border around a row
            // that buys the moment it is tapped promised a selection step that
            // does not exist; a warmer ground says the same thing honestly.
            .background(meta.highlighted ? Katha.Color.accent.opacity(0.08) : Katha.Color.raised)
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .disabled(buying)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(pack.totalCoins) coins for ₹\(Int(pack.priceMajor))")
    }
}
