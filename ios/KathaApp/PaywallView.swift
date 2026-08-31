import SwiftUI
import KathaKit

/// The money gate: single-episode unlock vs the discounted series bundle
/// (mockup §3). Optimistically updates the wallet, then reconciles with the
/// server's authoritative UnlockResult.
struct PaywallView: View {
    @State var model: PaywallViewModel
    let onUnlocked: () async -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var working = false
    @State private var errorText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            Text("Keep watching")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Katha.Color.text)

            HStack {
                Text("Your balance")
                    .font(.system(size: 14))
                    .foregroundStyle(Katha.Color.text2)
                Spacer()
                CoinBadge(coins: model.wallet.total)
            }

            // Single episode
            offerCard(
                title: "This episode",
                subtitle: "Episode \(model.episodeNumber)",
                coins: model.episodePrice,
                affordable: model.canAffordEpisode,
                highlighted: false
            ) { await unlockEpisode() }

            // Bundle
            offerCard(
                title: "Unlock all \(model.remainingLocked) remaining",
                subtitle: "Save \(model.bundleSavings) coins · \(model.bundleDiscountPct)% off",
                coins: model.bundlePrice,
                affordable: model.canAffordBundle,
                highlighted: true
            ) { await unlockBundle() }

            if let errorText {
                Text(errorText)
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.danger)
            }

            if model.coinsShortForEpisode > 0 {
                Text("You need \(model.coinsShortForEpisode) more coins.")
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)
            }
            Spacer()
        }
        .padding(Katha.Spacing.xl)
        .background(Katha.Color.surface)
    }

    private func offerCard(title: String, subtitle: String, coins: Int,
                           affordable: Bool, highlighted: Bool,
                           action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Katha.Color.text)
                    Text(subtitle).font(.system(size: 13))
                        .foregroundStyle(Katha.Color.text2)
                }
                Spacer()
                CoinBadge(coins: coins)
            }
            .padding(Katha.Spacing.lg)
            .background(highlighted ? Katha.Color.accent.opacity(0.14) : Katha.Color.raised)
            .overlay(
                RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous)
                    .stroke(highlighted ? Katha.Color.accent : .clear, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        }
        .disabled(working || !affordable)
        .opacity(affordable ? 1 : 0.5)
    }

    private func unlockEpisode() async {
        working = true; defer { working = false }
        model.optimisticUnlockEpisode()
        do {
            let res = try await app.api.unlockEpisode(
                slug: model.slug, number: model.episodeNumber,
                idempotencyKey: UUID().uuidString)
            app.wallet.reconcile(with: res.wallet)
            model.wallet = app.wallet
            await onUnlocked()
            dismiss()
        } catch {
            await app.refreshWallet()
            model.wallet = app.wallet
            errorText = "Unlock failed. Please try again."
        }
    }

    private func unlockBundle() async {
        working = true; defer { working = false }
        model.optimisticUnlockBundle()
        do {
            let res = try await app.api.unlockAll(
                slug: model.slug, idempotencyKey: UUID().uuidString)
            app.wallet.reconcile(with: res.wallet)
            model.wallet = app.wallet
            await onUnlocked()
            dismiss()
        } catch {
            await app.refreshWallet()
            model.wallet = app.wallet
            errorText = "Unlock failed. Please try again."
        }
    }
}
