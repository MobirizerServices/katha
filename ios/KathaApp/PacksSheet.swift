import SwiftUI
import KathaKit

/// Coin packs (mockup 3.4) as a standalone sheet — reached from Wallet →
/// "Get coins" and the paywall's "Get coins". Every 3.3 purchase state has a
/// screen of its own: confirming (other packs disabled, "still confirming"
/// after 10 s), Ask to Buy / pending ("You haven't been charged yet."),
/// failed (inline banner + Retry) and cancelled (back to the packs, no copy).
struct PacksSheet: View {
    /// One line of context above the packs, e.g. "E11 unlocks the moment coins land."
    var context: String? = nil
    /// Called with the ledger's wallet after a credited purchase.
    var onCredited: (() -> Void)? = nil

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Phase: Equatable {
        case list
        case confirming(sku: String)
        case pending
        case failed(reason: String, sku: String)
        case credited(coins: Int)
    }
    @State private var phase: Phase = .list
    @State private var packs: [CoinPack] = []
    @State private var restored = false
    @State private var stillConfirming = false
    /// The packs need about half a sheet; a forced `.large` left 40 % of it
    /// empty. The terminal states are taller, so they take the sheet up with
    /// them rather than hiding their own Done button below the fold.
    @State private var detent: PresentationDetent = .medium

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                header

                switch phase {
                case .pending:
                    pendingState
                case .credited(let coins):
                    creditedState(coins)
                case .failed(let reason, let sku):
                    failedBanner(reason, sku: sku)
                    packList
                case .list, .confirming:
                    packList
                }

                footer
            }
            .padding(Katha.Spacing.xl)
            .animation(reduceMotion ? nil : Katha.Motion.spring, value: phase)
        }
        .background(Katha.Color.surface)
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
        .presentationCornerRadius(24)
        // While Apple confirms, the sheet stays put (PDD §10.3).
        .interactiveDismissDisabled(isConfirming)
        .accessibilityIdentifier("packs.sheet")
        .task {
            if packs.isEmpty {
                packs = ((try? await model.api.packs(storefront: "IN")) ?? [])
                    .filter { !$0.sku.hasPrefix("coins_web") }   // web-store SKUs never sell via Apple IAP
            }
        }
        .onChange(of: phase) { _, new in
            switch new {
            case .pending, .credited: detent = .large
            default: break
            }
        }
        .task(id: isConfirming) {
            // After 10 s the copy admits it is slow and lets the viewer go on.
            stillConfirming = false
            guard isConfirming else { return }
            try? await Task.sleep(for: .seconds(10))
            if isConfirming { stillConfirming = true }
        }
    }

    private var isConfirming: Bool {
        if case .confirming = phase { return true }
        return false
    }

    // MARK: pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(model.t("packs.title"))
                    .font(Katha.Font.display(28))
                    .foregroundStyle(Katha.Color.text)
                Spacer()
                HStack(spacing: 5) {
                    Circle().fill(Katha.Color.coin).frame(width: 12, height: 12)
                    Text("You have \(model.wallet.total)")
                        .kathaFont(13, weight: .semibold)
                        .foregroundStyle(Katha.Color.text)
                        .contentTransition(.numericText())
                        .animation(Katha.Motion.spring, value: model.wallet.total)
                }
                .padding(.horizontal, 10)
                .kathaFrame(height: 28)
                .background(Katha.Color.raised)
                .clipShape(Capsule())
            }
            if let context {
                Text(context)
                    .kathaFont(14)
                    .foregroundStyle(Katha.Color.text2)
            }
        }
    }

    private var packList: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
            if packs.isEmpty {
                ForEach(0..<3, id: \.self) { _ in SkeletonBlock(height: 64) }
            }
            ForEach(packs) { pack in
                let buying = phase == .confirming(sku: pack.sku)
                PackRow(pack: pack, buying: buying) {
                    Task { await buy(pack) }
                }
                .accessibilityIdentifier("pack.\(pack.sku)")
                .disabled(isConfirming && !buying)
                .opacity(isConfirming && !buying ? 0.5 : 1)
            }
            if isConfirming {
                Text(stillConfirming ? model.t("packs.stillConfirming") : model.t("packs.confirming"))
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.text2)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(.top, 6)
            }
        }
    }

    /// Ask to Buy / deferred: nothing was charged; StoreKit's updates stream
    /// finishes the purchase later (CoinStore.startListening).
    private var pendingState: some View {
        VStack(spacing: Katha.Spacing.lg) {
            ZStack {
                Circle().fill(Katha.Color.coin.opacity(0.16)).frame(width: 72, height: 72)
                Image(systemName: "bell.badge.fill")
                    .kathaFont(30)
                    .foregroundStyle(Katha.Color.coin)
                    .symbolEffect(.pulse, options: reduceMotion ? .nonRepeating : .repeating)
            }
            Text(model.t("packs.confirming"))
                .kathaFont(15, weight: .semibold)
                .foregroundStyle(Katha.Color.text)
                .multilineTextAlignment(.center)
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "bell")
                    .foregroundStyle(Katha.Color.coin)
                Text(model.t("packs.pending.banner"))
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.text)
            }
            .padding(Katha.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Katha.Color.raised)
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
            Text(model.t("packs.pending.notCharged"))
                .kathaFont(13)
                .foregroundStyle(Katha.Color.text2)
            KathaPrimaryButton(title: model.t("packs.done")) { dismiss() }
        }
        .padding(.vertical, Katha.Spacing.md)
        .accessibilityIdentifier("packs.pending")
    }

    private func creditedState(_ coins: Int) -> some View {
        VStack(spacing: Katha.Spacing.md) {
            Image(systemName: "checkmark.circle.fill")
                .kathaFont(44)
                .foregroundStyle(Katha.Color.success)
                .symbolEffect(.bounce, value: phase)
            Text("+\(coins.formatted()) \(model.t("packs.credited"))")
                .kathaFont(18, weight: .bold)
                .foregroundStyle(Katha.Color.text)
            KathaPrimaryButton(title: model.t("packs.done")) { dismiss() }
        }
        .padding(.vertical, Katha.Spacing.lg)
    }

    private func failedBanner(_ reason: String, sku: String) -> some View {
        HStack(spacing: 10) {
            Text(reason)
                .kathaFont(13)
                .foregroundStyle(Katha.Color.text)
            Spacer()
            Button(model.t("packs.retry")) {
                if let pack = packs.first(where: { $0.sku == sku }) {
                    Task { await buy(pack) }
                } else {
                    phase = .list
                }
            }
            .kathaFont(13, weight: .semibold)
            .foregroundStyle(Katha.Color.accent)
        }
        .padding(Katha.Spacing.md)
        .background(Katha.Color.danger.opacity(0.12))
        .overlay(alignment: .leading) {
            Rectangle().fill(Katha.Color.danger).frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var footer: some View {
        VStack(spacing: Katha.Spacing.sm) {
            Text(model.t("packs.footer"))
                .kathaFont(11)
                .foregroundStyle(Katha.Color.text2)
                .multilineTextAlignment(.center)
            HStack(spacing: 6) {
                Button(restored ? model.t("packs.restored") : model.t("packs.restore")) {
                    Task {
                        await model.restorePurchases()
                        restored = true
                    }
                }
                Text("·")
                Link(model.t("packs.terms"), destination: URL(string: "https://katha.example/legal")!)
            }
            .kathaFont(12)
            .foregroundStyle(Katha.Color.text2)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, Katha.Spacing.sm)
    }

    // MARK: purchase

    private func buy(_ pack: CoinPack) async {
        phase = .confirming(sku: pack.sku)
        // StoreKit 2 purchase → Apple's signed transaction → the ledger credits.
        switch await model.buy(sku: pack.sku) {
        case .credited:
            Haptics.success()
            phase = .credited(coins: pack.totalCoins)
            onCredited?()
        case .cancelled:
            // Back to the packs with no error copy (PDD §10.3).
            phase = .list
        case .pending:
            phase = .pending
        case .failed(let reason):
            Haptics.warning()
            phase = .failed(reason: reason, sku: pack.sku)
        }
    }
}
