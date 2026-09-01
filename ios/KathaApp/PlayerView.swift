import SwiftUI
import AVFoundation
import UIKit
import KathaKit

// The vertical player (mockup 3.1) + episode drawer (3.2). Custom chrome over an
// AVPlayerLayer: right rail, scrubber, tap-to-pause, swipe next/previous, and the
// designed states — buffering, connection lost, recording blocked, series end.
// Locked episodes pause under the paywall sheet; auto-unlock (when enabled and
// affordable) debits silently with a toast, per §8.4.

// MARK: - Engine

/// Owns the AVPlayer and republishes its state for SwiftUI. Used from the main
/// thread only (observers are delivered on .main).
@Observable
final class PlayerEngine {
    let player = AVPlayer()
    var isPlaying = false
    var isBuffering = false
    var ended = false
    var failed = false
    var currentSeconds: Double = 0
    var durationSeconds: Double = 0

    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    init() {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 2), queue: .main
        ) { [weak self] time in
            guard let self else { return }
            self.currentSeconds = max(0, time.seconds)
            if let d = self.player.currentItem?.duration.seconds, d.isFinite, d > 0 {
                self.durationSeconds = d
            }
            self.isBuffering = self.player.timeControlStatus == .waitingToPlayAtSpecifiedRate
            if self.player.currentItem?.status == .failed { self.failed = true; self.isPlaying = false }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main
        ) { [weak self] note in
            guard let self, (note.object as? AVPlayerItem) === self.player.currentItem else { return }
            self.ended = true
            self.isPlaying = false
        }
    }

    func load(url: URL, resumeMs: Int) {
        ended = false; failed = false
        currentSeconds = 0; durationSeconds = 0
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        if resumeMs > 1500 {
            player.seek(to: CMTime(seconds: Double(resumeMs) / 1000, preferredTimescale: 600))
        }
        play()
    }

    func play() { player.play(); isPlaying = true }
    func pause() { player.pause(); isPlaying = false }
    func toggle() { isPlaying ? pause() : play() }
    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    }
    func stop() {
        player.pause()
        player.replaceCurrentItem(with: nil)
        isPlaying = false
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    }
}

/// Full-bleed AVPlayerLayer host (more control than VideoPlayer — SAD §11.3).
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    final class LayerBackedView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerBackedView {
        let v = LayerBackedView()
        v.playerLayer.player = player
        v.playerLayer.videoGravity = .resizeAspect
        v.backgroundColor = .black
        return v
    }

    func updateUIView(_ view: LayerBackedView, context: Context) {
        view.playerLayer.player = player
    }
}

// MARK: - Player screen

struct PlayerView: View {
    let slug: String
    let number: Int

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var engine = PlayerEngine()
    @State private var detail: SeriesDetail?
    @State private var playback: PlaybackResponse?
    @State private var current: Int = 0                 // episode currently loaded
    @State private var showPaywall = false
    @State private var showDrawer = false
    @State private var chromeVisible = true
    @State private var liked = false
    @State private var likeCount = Int.random(in: 800...14000)
    @State private var captured = UIScreen.main.isCaptured
    @State private var loadFailed = false
    @State private var toast: String?
    @State private var pinPassed = false
    @State private var lastReported = 0.0

    private var episodeTitle: String {
        detail?.episodes.first { $0.number == current }?.title ?? "Episode \(current)"
    }
    private var needsPin: Bool {
        guard let d = detail else { return false }
        return model.ratingNeedsPin(d.contentRating) && !pinPassed
    }

    var body: some View {
        ZStack {
            Katha.Color.bg.ignoresSafeArea()

            if captured {
                recordingBlocked
            } else if needsPin {
                PinGateView { pinPassed = true } onCancel: { dismiss() }
            } else {
                PlayerLayerView(player: engine.player)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation { chromeVisible.toggle() }; engineTapPlayPause() }

                if engine.isBuffering && playback?.isEntitled == true {
                    ProgressView().tint(.white).scaleEffect(1.4)
                }
                if playback?.locked == true { lockedFrame }
                if engine.failed || loadFailed { connectionLost }
                if engine.ended { seriesEndOrNext }
                if chromeVisible && playback?.isEntitled == true { chrome }
            }

            if let toast {
                VStack { Spacer(); ToastView(text: toast).padding(.bottom, 90) }
                    .task { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
            }
        }
        .navigationBarBackButtonHidden(false)
        .toolbarBackground(.clear, for: .navigationBar)
        .statusBarHidden(!chromeVisible)
        .gesture(swipeGesture)
        .task {
            current = number
            await loadDetail()
            await loadPlayback()
        }
        .onDisappear {
            reportProgress(force: true)
            engine.stop()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in
            captured = UIScreen.main.isCaptured
            if captured { engine.pause() }
        }
        .onChange(of: engine.currentSeconds) { _, s in
            if s - lastReported >= 5 { reportProgress() }
        }
        .sheet(isPresented: $showPaywall) {
            if let pb = playback, let d = detail {
                PaywallView(
                    slug: slug,
                    episodeNumber: current,
                    episodeTitle: episodeTitle,
                    playback: pb,
                    detail: d,
                    onUnlocked: { await loadPlayback() }
                )
            }
        }
        .sheet(isPresented: $showDrawer) {
            if let d = detail {
                EpisodeDrawer(detail: d, current: current) { n in
                    showDrawer = false
                    Task { await advance(to: n) }
                }
            }
        }
    }

    // MARK: chrome (rail + labels + scrubber)

    private var chrome: some View {
        VStack {
            Spacer()
            HStack(alignment: .bottom) {
                // bottom-left: series + episode label
                VStack(alignment: .leading, spacing: 4) {
                    Text(detail?.title ?? "")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.85))
                    Text("E\(current) · \(episodeTitle)")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                Spacer()
                // right rail
                VStack(spacing: 22) {
                    railButton(icon: liked ? "heart.fill" : "heart",
                               label: compact(likeCount),
                               tint: liked ? Katha.Color.accent : .white) {
                        liked.toggle(); likeCount += liked ? 1 : -1
                    }
                    railButton(icon: "square.stack.3d.down.right", label: "E\(current)", tint: .white) {
                        showDrawer = true
                    }
                    ShareLink(item: URL(string: "https://katha.example/e/\(slug)-\(current)")!) {
                        VStack(spacing: 3) {
                            Image(systemName: "square.and.arrow.up").font(.system(size: 24))
                            Text("Share").font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .shadow(radius: 4)
                    }
                }
            }
            .padding(.horizontal, Katha.Spacing.lg)

            scrubber
                .padding(.horizontal, Katha.Spacing.lg)
                .padding(.bottom, 22)
        }
    }

    private var scrubber: some View {
        VStack(spacing: 6) {
            Slider(
                value: Binding(
                    get: { engine.currentSeconds },
                    set: { engine.seek(to: $0) }
                ),
                in: 0...max(engine.durationSeconds, 1)
            )
            .tint(Katha.Color.accent)
            HStack {
                Text(clock(engine.currentSeconds))
                Spacer()
                Text("\(clock(max(0, engine.durationSeconds - engine.currentSeconds))) left")
            }
            .font(.system(size: 11))
            .foregroundStyle(.white.opacity(0.8))
        }
    }

    private func railButton(icon: String, label: String, tint: Color,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 24)).foregroundStyle(tint)
                Text(label).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
            }
            .shadow(radius: 4)
        }
    }

    // MARK: states

    private var lockedFrame: some View {
        VStack(spacing: Katha.Spacing.lg) {
            Image(systemName: "lock.fill")
                .font(.system(size: 40))
                .foregroundStyle(Katha.Color.coin)
            Text("Episode \(current) is locked")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Katha.Color.text)
            KathaPrimaryButton(title: "Unlock for \(playback?.priceCoins ?? 30) coins  ·  ≈ ₹\(rupees(playback?.priceCoins ?? 30))") {
                showPaywall = true
            }
            .padding(.horizontal, 44)
        }
    }

    private var connectionLost: some View {
        VStack(spacing: Katha.Spacing.md) {
            Image(systemName: "wifi.slash").font(.system(size: 36)).foregroundStyle(.white)
            Text("Connection lost").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
            Button("Retry") {
                loadFailed = false
                Task { await loadPlayback() }
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Katha.Color.accent)
        }
        .padding(24)
        .background(.black.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
    }

    private var seriesEndOrNext: some View {
        VStack(spacing: Katha.Spacing.lg) {
            if let d = detail, current >= d.episodeCount {
                Text("You finished \(d.title)")
                    .font(.system(size: 20, weight: .bold)).foregroundStyle(.white)
                Text("New stories drop every week.")
                    .font(.system(size: 14)).foregroundStyle(.white.opacity(0.8))
                Button("Back to Home") { dismiss() }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Katha.Color.accent)
            } else {
                Text("Up next: E\(current + 1)")
                    .font(.system(size: 18, weight: .bold)).foregroundStyle(.white)
                KathaPrimaryButton(title: "Play next episode") {
                    Task { await advance(to: current + 1) }
                }
                .padding(.horizontal, 60)
            }
        }
        .padding(28)
        .background(.black.opacity(0.75))
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
    }

    private var recordingBlocked: some View {
        VStack(spacing: Katha.Spacing.md) {
            Image(systemName: "video.slash.fill").font(.system(size: 40))
                .foregroundStyle(Katha.Color.text2)
            Text("Recording isn't supported")
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(Katha.Color.text)
            Text("Playback resumes when screen recording stops.")
                .font(.system(size: 13)).foregroundStyle(Katha.Color.text2)
        }
    }

    // MARK: gestures & actions

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 60)
            .onEnded { g in
                guard abs(g.translation.height) > abs(g.translation.width) else { return }
                if g.translation.height < -60 { Task { await advance(to: current + 1) } }
                else if g.translation.height > 60, current > 1 { Task { await advance(to: current - 1) } }
            }
    }

    private func engineTapPlayPause() {
        guard playback?.isEntitled == true, !engine.ended else { return }
        engine.toggle()
    }

    private func advance(to n: Int) async {
        guard let d = detail, (1...d.episodeCount).contains(n) else { return }
        reportProgress(force: true)
        current = n
        showPaywall = false
        engine.stop()
        await loadPlayback()
    }

    // MARK: loading

    private func loadDetail() async {
        detail = try? await model.api.seriesDetail(slug: slug)
    }

    private func loadPlayback() async {
        do {
            var pb = try await model.api.playback(slug: slug, number: current)

            // Auto-unlock (§8.4): debit only as the episode starts, one-tap off in
            // the drawer; a toast confirms each auto-debit.
            if pb.locked, model.autoUnlock,
               let price = pb.priceCoins, model.wallet.total >= price {
                if let res = try? await model.api.unlockEpisode(
                    slug: slug, number: current, idempotencyKey: UUID().uuidString) {
                    model.wallet.reconcile(with: res.wallet)
                    toast = "−\(price) coins · E\(current) unlocked"
                    pb = try await model.api.playback(slug: slug, number: current)
                }
            }

            playback = pb
            loadFailed = false
            if pb.isEntitled, let urlStr = pb.hlsMasterUrl, let url = URL(string: urlStr) {
                showPaywall = false
                engine.load(url: url, resumeMs: pb.resumePositionMs ?? 0)
            } else {
                engine.stop()
                showPaywall = true
            }
        } catch {
            loadFailed = true
        }
    }

    private func reportProgress(force: Bool = false) {
        guard playback?.isEntitled == true else { return }
        let pos = Int(engine.currentSeconds * 1000)
        let dur = Int(engine.durationSeconds * 1000)
        guard force || pos > 0 else { return }
        lastReported = engine.currentSeconds
        let report = ProgressReport(slug: slug, number: current, positionMs: pos, durationMs: dur)
        Task { try? await model.api.reportProgress([report]) }
    }

    // MARK: formatting

    private func clock(_ s: Double) -> String {
        let t = Int(s.rounded())
        return String(format: "%d:%02d", t / 60, t % 60)
    }

    private func compact(_ n: Int) -> String {
        n >= 1000 ? String(format: "%.1fk", Double(n) / 1000) : "\(n)"
    }
}

// MARK: - Episode drawer (3.2)

struct EpisodeDrawer: View {
    let detail: SeriesDetail
    let current: Int
    let onPick: (Int) -> Void

    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            HStack {
                Text("Episodes")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                Spacer()
                Text("\(detail.episodeCount) · 1–\(detail.freeEpisodeCount) free")
                    .font(.system(size: 12))
                    .foregroundStyle(Katha.Color.text2)
            }

            Toggle(isOn: $model.autoUnlock) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Auto-unlock next episodes")
                        .font(.system(size: 15))
                        .foregroundStyle(Katha.Color.text)
                    Text("Charges \(detail.episodeCoinPrice) coins only when an episode starts")
                        .font(.system(size: 12))
                        .foregroundStyle(Katha.Color.text2)
                }
            }
            .tint(Katha.Color.success)

            ScrollView {
                let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: 6)
                LazyVGrid(columns: cols, spacing: 8) {
                    ForEach(detail.episodes) { ep in
                        Button { onPick(ep.number) } label: {
                            ZStack {
                                RoundedRectangle(cornerRadius: Katha.Radius.sm, style: .continuous)
                                    .fill(ep.number == current ? Katha.Color.accent : Katha.Color.raised)
                                Text("\(ep.number)")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Katha.Color.text)
                                if !ep.isFree {
                                    Image(systemName: "lock.fill")
                                        .font(.system(size: 8))
                                        .foregroundStyle(ep.number == current ? Katha.Color.text : Katha.Color.coin)
                                        .frame(maxWidth: .infinity, maxHeight: .infinity,
                                               alignment: .bottomTrailing)
                                        .padding(3)
                                }
                            }
                            .frame(height: 44)
                        }
                    }
                }
            }
        }
        .padding(Katha.Spacing.xl)
        .presentationDetents([.medium, .large])
        .presentationBackground(Katha.Color.surface)
    }
}
