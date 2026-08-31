import SwiftUI
import AVKit
import KathaKit

/// Vertical full-bleed player. Calls playback; if entitled it streams the HLS
/// master, otherwise it presents the paywall sheet (mockup §3 Watch and pay).
struct PlayerView: View {
    let slug: String
    let number: Int
    let bundleDiscountPct: Int
    let remainingLocked: Int

    @Environment(AppModel.self) private var model
    @State private var playback: PlaybackResponse?
    @State private var player: AVPlayer?
    @State private var showPaywall = false

    var body: some View {
        ZStack {
            Katha.Color.bg.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
            } else if playback?.locked == true {
                lockedPlaceholder
            } else {
                ProgressView().tint(Katha.Color.accent)
            }
        }
        .task { await loadPlayback() }
        .sheet(isPresented: $showPaywall) {
            if let pb = playback {
                PaywallView(
                    model: PaywallViewModel(slug: slug, episodeNumber: number,
                                            playback: pb, bundleDiscountPct: bundleDiscountPct,
                                            remainingLocked: remainingLocked,
                                            wallet: model.wallet),
                    onUnlocked: { await loadPlayback() }
                )
                .presentationDetents([.medium, .large])
            }
        }
    }

    private var lockedPlaceholder: some View {
        VStack(spacing: Katha.Spacing.lg) {
            Image(systemName: "lock.fill")
                .font(.system(size: 40))
                .foregroundStyle(Katha.Color.coin)
            Text("Episode \(number) is locked")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Katha.Color.text)
            KathaPrimaryButton(title: "Unlock") { showPaywall = true }
                .padding(.horizontal, 40)
        }
    }

    private func loadPlayback() async {
        do {
            let pb = try await model.api.playback(slug: slug, number: number)
            playback = pb
            if pb.isEntitled, let urlStr = pb.hlsMasterUrl, let url = URL(string: urlStr) {
                player = AVPlayer(url: url)
                player?.play()
                showPaywall = false
            } else {
                player = nil
                showPaywall = true
            }
        } catch {
            // Leave the placeholder; a real build would show a retry banner.
        }
    }
}
