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

    /// Data-saver ceiling in bits/second; 0 lifts the cap. Applied to the
    /// current item live and to everything loaded afterwards.
    var bitrateCap: Double = 0 {
        didSet { player.currentItem?.preferredPeakBitRate = bitrateCap }
    }
    private var warmed: (url: URL, item: AVPlayerItem)?

    /// Warm the next episode: the item exists and its master playlist is
    /// fetched before the swipe, so advancing starts in a beat, not a spinner.
    func warm(url: URL) {
        guard warmed?.url != url else { return }
        let item = AVPlayerItem(url: url)
        item.preferredPeakBitRate = bitrateCap
        item.preferredForwardBufferDuration = 6
        warmed = (url, item)
        Task { _ = try? await item.asset.load(.isPlayable) }
    }

    func load(url: URL, resumeMs: Int) {
        ended = false; failed = false
        currentSeconds = 0; durationSeconds = 0
        let item: AVPlayerItem
        if let warmed, warmed.url == url {
            item = warmed.item
            self.warmed = nil
        } else {
            item = AVPlayerItem(url: url)
        }
        item.preferredPeakBitRate = bitrateCap
        player.replaceCurrentItem(with: item)
        if resumeMs > 1500 {
            player.seek(to: CMTime(seconds: Double(resumeMs) / 1000, preferredTimescale: 600))
        }
        play()
    }

    func play() { player.play(); isPlaying = true }
    func pause() { player.pause(); isPlaying = false }
    func toggle() { isPlaying ? pause() : play() }
    func seek(to seconds: Double) {
        // Scrubbing back after the end notification means the episode is live
        // again — leaving `ended` set would freeze the end card over playback
        // and block play/pause and progress for the rest of the session.
        ended = false
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
    /// UI-test runs record the screen by design; the env flag keeps the §12.9
    /// capture shield honest in production while letting automation through.
    private static let allowCapture =
        ProcessInfo.processInfo.environment["KATHA_ALLOW_CAPTURE"] != nil
    @State private var captured = UIScreen.main.isCaptured && !PlayerView.allowCapture
    @State private var loadFailed = false
    @State private var toast: String?
    @State private var pinPassed = false
    @State private var lastReported = 0.0
    @State private var nextReady: (number: Int, pb: PlaybackResponse)?
    @State private var preloadingFor: Int?

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
            // .task re-runs whenever the view reappears (tab switch, sheet
            // dismissal); only the FIRST run may pick the starting episode,
            // or returning mid-binge would yank the viewer back to `number`.
            guard current == 0 else { return }
            current = number
            await loadDetail()
            await loadPlayback()
        }
        .onDisappear {
            reportProgress(force: true)
            engine.stop()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in
            captured = UIScreen.main.isCaptured && !PlayerView.allowCapture
            if captured { engine.pause() }
        }
        .onChange(of: engine.currentSeconds) { _, s in
            // abs(): a seek BACK must keep reporting too, or resume freezes at
            // the high-water mark until playback passes it again.
            if abs(s - lastReported) >= 5 { reportProgress() }
            maybePreloadNext(at: s)
        }
        .onChange(of: model.dataSaver, initial: true) { _, saver in
            engine.bitrateCap = saver ? 900_000 : 0
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
                    // No fabricated counts: the label reflects only this
                    // viewer's action until a real engagement API exists.
                    railButton(icon: liked ? "heart.fill" : "heart",
                               label: liked ? "Liked" : "Like",
                               tint: liked ? Katha.Color.accent : .white) {
                        liked.toggle()
                        if liked { Haptics.tap() }
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
            KathaPrimaryButton(title: "Unlock for \(playback?.priceCoins ?? detail?.episodeCoinPrice ?? model.appConfig?.episodeCoinPrice ?? 30) coins  ·  ≈ ₹\(rupees(playback?.priceCoins ?? detail?.episodeCoinPrice ?? model.appConfig?.episodeCoinPrice ?? 30, rate: model.rupeeRate))") {
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
                if g.translation.height < -60 {
                    Haptics.tap()
                    Task { await advance(to: current + 1) }
                } else if g.translation.height > 60, current > 1 {
                    Haptics.tap()
                    Task { await advance(to: current - 1) }
                }
            }
    }

    private func engineTapPlayPause() {
        guard playback?.isEntitled == true, !engine.ended else { return }
        engine.toggle()
    }

    private func advance(to n: Int) async {
        guard let d = detail, (1...d.episodeCount).contains(n) else { return }
        reportProgress(force: true)
        lastReported = 0        // the throttle window belongs to ONE episode
        current = n
        showPaywall = false
        engine.stop()
        await loadPlayback()
    }

    // MARK: loading

    private func loadDetail() async {
        detail = try? await model.api.seriesDetail(slug: slug)
    }

    /// Preload the next episode in the final 20 seconds — playback auth,
    /// stream token and master playlist are ready before the swipe. Never
    /// debits: a locked next episode simply isn't warmed (auto-unlock stays
    /// a start-of-episode decision).
    private func maybePreloadNext(at s: Double) {
        guard engine.durationSeconds > 0, s > engine.durationSeconds - 20,
              let d = detail, current < d.episodeCount,
              preloadingFor != current + 1 else { return }
        let n = current + 1
        preloadingFor = n
        Task {
            guard let pb = try? await model.api.playback(slug: slug, number: n),
                  pb.isEntitled, let u = pb.hlsMasterUrl,
                  let url = URL(string: u) else { return }
            nextReady = (n, pb)
            engine.warm(url: url)
        }
    }

    private func loadPlayback() async {
        if let ready = nextReady, ready.number == current, ready.pb.isEntitled {
            nextReady = nil
            playback = ready.pb
            loadFailed = false
            showPaywall = false
            if let u = ready.pb.hlsMasterUrl, let url = URL(string: u) {
                engine.load(url: url, resumeMs: ready.pb.resumePositionMs ?? 0)
                return
            }
        }
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
                    Haptics.success()
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
                Haptics.warning()
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
