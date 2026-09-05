import SwiftUI
@preconcurrency import AVFoundation
import UIKit
import KathaKit

// The vertical player (mockup 3.1) + episode drawer (3.2). Custom chrome over an
// AVPlayerLayer: right rail, scrubber, tap-to-pause, swipe next/previous, and the
// designed states — buffering, connection lost, recording blocked, series end.
// Locked episodes pause under the paywall sheet; auto-unlock (when enabled and
// affordable) debits silently with a toast, per §8.4.

// MARK: - Engine

/// Owns the AVPlayer and republishes its state for SwiftUI. Main-actor
/// isolated: every observer hops (or is delivered) onto the main actor before
/// touching state, which is what the compiler now checks.
@Observable
@MainActor
final class PlayerEngine {
    let player = AVPlayer()
    var isPlaying = false
    var isBuffering = false
    var ended = false
    var failed = false
    var currentSeconds: Double = 0
    var durationSeconds: Double = 0
    /// True while the viewer holds for 2× (PDD §10.2 long-press).
    var boosting = false

    // Audio / subtitle selection (the stream's own AVMediaSelectionGroups).
    var legibleOptions: [AVMediaSelectionOption] = []
    var audibleOptions: [AVMediaSelectionOption] = []
    /// The caption language in force: nil = off. Persisted so the next episode
    /// (and the next launch) starts with the same choice.
    var captionLang: String?
    var audioLang: String?
    private var legibleGroup: AVMediaSelectionGroup?
    private var audibleGroup: AVMediaSelectionGroup?
    static let captionPrefKey = "katha.captions.lang"

    // Written once in init, read once in deinit (which is nonisolated): kept
    // outside the actor's isolation on purpose, and outside observation.
    @ObservationIgnored nonisolated(unsafe) private var timeObserver: Any?
    @ObservationIgnored nonisolated(unsafe) private var endObserver: NSObjectProtocol?
    @ObservationIgnored nonisolated(unsafe) private var statusObserver: NSKeyValueObservation?

    init() {
        // Playback category: audible with the ringer switch off, like every
        // video app. The default (.soloAmbient) obeys the mute switch, which
        // reads as "no sound" to viewers.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        // isPlaying follows the player itself (the system pauses it in the
        // background; a hand-maintained flag then needs two taps to resume).
        statusObserver = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            let playing = p.timeControlStatus != .paused
            Task { @MainActor in self?.isPlaying = playing }
        }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(value: 1, timescale: 2), queue: .main
        ) { [weak self] time in
            // Delivered on .main by contract; tell the compiler so.
            MainActor.assumeIsolated {
                guard let self else { return }
                self.currentSeconds = max(0, time.seconds)
                if let d = self.player.currentItem?.duration.seconds, d.isFinite, d > 0 {
                    self.durationSeconds = d
                }
                self.isBuffering = self.player.timeControlStatus == .waitingToPlayAtSpecifiedRate
                if self.player.currentItem?.status == .failed { self.failed = true; self.isPlaying = false }
            }
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main
        ) { [weak self] note in
            let item = note.object as? AVPlayerItem
            MainActor.assumeIsolated {
                guard let self, item === self.player.currentItem else { return }
                self.ended = true
                self.isPlaying = false
            }
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
        Task { @MainActor in _ = try? await item.asset.load(.isPlayable) }
    }

    func load(url: URL, resumeMs: Int) {
        try? AVAudioSession.sharedInstance().setActive(true)
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
        Task { await loadMediaSelection(for: item) }
    }

    func play() { player.play(); isPlaying = true }
    func pause() { player.pause(); isPlaying = false }
    func toggle() { isPlaying ? pause() : play() }

    /// Hold-to-boost: 2× while the finger is down, back to 1× on release.
    /// Only ever speeds up playback that is already running.
    func setBoost(_ on: Bool) {
        guard on != boosting else { return }
        boosting = on
        guard isPlaying, !ended else { return }
        player.rate = on ? 2.0 : 1.0
    }

    // MARK: Audio & subtitles

    /// Read the stream's selectable groups, then re-apply the remembered
    /// caption language so a choice made on E3 is still on for E4.
    private func loadMediaSelection(for item: AVPlayerItem) async {
        legibleOptions = []; audibleOptions = []
        legibleGroup = nil; audibleGroup = nil
        let asset = item.asset
        let legible = try? await asset.loadMediaSelectionGroup(for: .legible)
        let audible = try? await asset.loadMediaSelectionGroup(for: .audible)
        guard item === player.currentItem else { return }      // a swipe moved on
        legibleGroup = legible
        audibleGroup = audible
        legibleOptions = legible?.options.filter { !$0.hasMediaCharacteristic(.containsOnlyForcedSubtitles) } ?? []
        audibleOptions = audible?.options ?? []
        let stored = UserDefaults.standard.string(forKey: Self.captionPrefKey)
        captionLang = stored == "off" ? nil : stored
        applyCaptionSelection()
        if let g = audible, let cur = item.currentMediaSelection.selectedMediaOption(in: g) {
            audioLang = Self.langCode(cur)
        }
    }

    /// Choose a caption language (nil = Off). Applied to the stream when it
    /// carries that language; remembered either way.
    func selectCaptions(lang: String?) {
        captionLang = lang
        UserDefaults.standard.set(lang ?? "off", forKey: Self.captionPrefKey)
        applyCaptionSelection()
    }

    func selectAudio(lang: String) {
        audioLang = lang
        guard let g = audibleGroup, let item = player.currentItem else { return }
        if let opt = audibleOptions.first(where: { Self.langCode($0) == lang }) {
            item.select(opt, in: g)
        }
    }

    private func applyCaptionSelection() {
        guard let g = legibleGroup, let item = player.currentItem else { return }
        if let lang = captionLang,
           let opt = legibleOptions.first(where: { Self.langCode($0) == lang }) {
            item.select(opt, in: g)
        } else {
            item.select(nil, in: g)
        }
    }

    /// "hi-IN" → "hi": the payload and the stream speak in two-letter codes.
    static func langCode(_ option: AVMediaSelectionOption) -> String {
        if let tag = option.extendedLanguageTag ?? option.locale?.identifier {
            return String(tag.split(separator: "-").first ?? Substring(tag)).lowercased()
        }
        return option.displayName.lowercased()
    }
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
        statusObserver?.invalidate()
    }
}

/// Full-bleed AVPlayerLayer host (more control than VideoPlayer — SAD §11.3).
struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    var gravity: AVLayerVideoGravity = .resizeAspect
    /// Tap / double-tap / hold on the video surface. UIKit recognizers rather
    /// than SwiftUI gestures: `require(toFail:)` gives the single tap its
    /// double-tap grace period, and the long press reports began AND ended,
    /// which SwiftUI's LongPressGesture does not. Nil handlers add nothing
    /// (the Home preview stays a plain layer under its NavigationLink).
    var onTap: (() -> Void)? = nil
    var onDoubleTap: (() -> Void)? = nil
    var onHold: ((Bool) -> Void)? = nil

    final class LayerBackedView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    @MainActor final class Coordinator: NSObject {
        var onTap: (() -> Void)?
        var onDoubleTap: (() -> Void)?
        var onHold: ((Bool) -> Void)?

        @objc func tapped() { onTap?() }
        @objc func doubleTapped() { onDoubleTap?() }
        @objc func held(_ g: UILongPressGestureRecognizer) {
            switch g.state {
            case .began: onHold?(true)
            case .ended, .cancelled, .failed: onHold?(false)
            default: break
            }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> LayerBackedView {
        let v = LayerBackedView()
        v.playerLayer.player = player
        v.playerLayer.videoGravity = gravity
        v.backgroundColor = .black
        if onTap != nil || onDoubleTap != nil || onHold != nil {
            let c = context.coordinator
            let double = UITapGestureRecognizer(target: c, action: #selector(Coordinator.doubleTapped))
            double.numberOfTapsRequired = 2
            let single = UITapGestureRecognizer(target: c, action: #selector(Coordinator.tapped))
            single.require(toFail: double)
            let hold = UILongPressGestureRecognizer(target: c, action: #selector(Coordinator.held(_:)))
            hold.minimumPressDuration = 0.4
            v.addGestureRecognizer(double)
            v.addGestureRecognizer(single)
            v.addGestureRecognizer(hold)
            v.isUserInteractionEnabled = true
        }
        return v
    }

    func updateUIView(_ view: LayerBackedView, context: Context) {
        view.playerLayer.player = player
        context.coordinator.onTap = onTap
        context.coordinator.onDoubleTap = onDoubleTap
        context.coordinator.onHold = onHold
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
    @State private var showTracks = false
    @State private var chromeVisible = true
    /// Bumped by every interaction; restarts the inactivity countdown that
    /// hides the chrome (see `idleHideKey`).
    @State private var activityToken = 0
    /// The like belongs to ONE episode. There is no engagement endpoint yet, so
    /// it is kept on the device — but keyed per (series, episode) and persisted,
    /// instead of a view-local flag that followed the viewer into E2.
    @State private var liked = false
    /// Heart burst on double-tap; bumps so each burst replays.
    @State private var burstToken = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
    /// The one in-flight playback load. A swipe cancels it before starting the
    /// next, so two quick swipes can never race: only the load for the episode
    /// on screen may touch the engine or debit an auto-unlock.
    @State private var loadTask: Task<Void, Never>?
    @Environment(\.scenePhase) private var scenePhase

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
                PinGateView { pinPassed = true } onToast: { toast = $0 }
            } else {
                // Tap = reveal the chrome, or play/pause once it is already up
                // (after the double-tap grace); double-tap = like; hold = 2×
                // while held. The vertical swipe on the ZStack below still
                // advances: a moving finger fails all three.
                // Edge to edge: the video fills the screen the way a vertical
                // player is meant to, rather than sitting letterboxed above a
                // tab bar that has no business being over an episode.
                PlayerLayerView(
                    player: engine.player,
                    gravity: .resizeAspectFill,
                    onTap: { surfaceTapped() },
                    onDoubleTap: { doubleTapped() },
                    onHold: { on in setBoost(on) }
                )
                .ignoresSafeArea()
                .accessibilityIdentifier("player.surface")

                if engine.isBuffering && playback?.isEntitled == true {
                    ProgressView().tint(.white).scaleEffect(1.4)
                }
                if engine.boosting { boostPill }
                HeartBurst(token: burstToken)
                // While the paywall is up the lock overlay peeked over the
                // sheet's grabber and read as a stray control.
                if playback?.locked == true && !showPaywall { lockedFrame }
                if engine.failed || loadFailed { connectionLost }
                if engine.ended { seriesEndOrNext }
                // The end card owns the screen: the rail and scrubber would
                // otherwise sit on top of its corner.
                if chromeVisible && playback?.isEntitled == true && !engine.ended {
                    topScrim
                    chrome
                }
            }

            if let toast {
                VStack { Spacer(); ToastView(text: toast).padding(.bottom, 90) }
                    .task { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
            }
        }
        .navigationBarBackButtonHidden(false)
        .toolbarBackground(.clear, for: .navigationBar)
        // The player is the whole screen — the tab bar covered its bottom 90 pt
        // (and the PIN gate's) and pushed the picture up into a black band.
        .toolbar(.hidden, for: .tabBar)
        // The back button belongs to the chrome: it fades with the rest so an
        // idle player really does show a clean frame.
        .toolbar(hidesChrome ? .hidden : .visible, for: .navigationBar)
        .statusBarHidden(!chromeVisible)
        .gesture(swipeGesture)
        // Inactivity hides the chrome, the way every full-screen player behaves;
        // any tap, scrub, swipe or sheet brings it straight back.
        .task(id: idleHideKey) {
            guard chromeVisible, playback?.isEntitled == true,
                  engine.isPlaying, !engine.ended,
                  !showDrawer, !showTracks, !showPaywall else { return }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            withAnimation(Katha.Motion.spring) { chromeVisible = false }
        }
        .task {
            // .task re-runs whenever the view reappears (tab switch, sheet
            // dismissal); only the FIRST run may pick the starting episode,
            // or returning mid-binge would yank the viewer back to `number`.
            guard current == 0 else { return }
            current = number
            loadLiked(for: number)
            await loadDetail()
            startLoad(for: number)
        }
        .onDisappear {
            loadTask?.cancel()
            reportProgress(force: true)
            engine.stop()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in
            captured = UIScreen.main.isCaptured && !PlayerView.allowCapture
            if captured {
                // Stop, not pause: nothing (audio included) plays into the
                // recording, and any in-flight load or auto-unlock is dropped.
                loadTask?.cancel()
                engine.stop()
            } else {
                startLoad(for: current)      // recording ended: resume properly
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
            if playback?.isEntitled == true && !PlayerView.allowCapture {
                toast = model.t("player.screenshot")
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Leaving the foreground pauses and flushes progress; the engine's
            // isPlaying follows the player, so returning needs one tap, not two.
            if phase != .active {
                engine.pause()
                reportProgress(force: true)
            }
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
                    onUnlocked: { startLoad(for: current) }
                )
            }
        }
        .sheet(isPresented: $showDrawer) {
            if let d = detail {
                EpisodeDrawer(detail: d, current: current) { n in
                    showDrawer = false
                    advance(to: n)
                }
            }
        }
        .sheet(isPresented: $showTracks) {
            TrackPickerSheet(engine: engine, playback: playback)
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
                        .kathaFont(13, weight: .semibold)
                        .foregroundStyle(.white.opacity(0.85))
                    Text("E\(current) · \(episodeTitle)")
                        .kathaFont(16, weight: .bold)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                Spacer()
                // right rail
                VStack(spacing: 22) {
                    // No fabricated counts: the label reflects only this
                    // viewer's action until a real engagement API exists.
                    railButton(icon: liked ? "heart.fill" : "heart",
                               label: model.t(liked ? "player.liked" : "player.like"),
                               tint: liked ? Katha.Color.accent : .white) {
                        setLiked(!liked)
                        if liked { Haptics.tap() }
                    }
                    railButton(icon: "square.stack.3d.down.right", label: "E\(current)", tint: .white) {
                        showDrawer = true
                    }
                    railButton(icon: engine.captionLang == nil ? "captions.bubble" : "captions.bubble.fill",
                               label: "CC", tint: engine.captionLang == nil ? .white : Katha.Color.accent) {
                        showTracks = true
                    }
                    .accessibilityLabel(model.t("player.tracks"))
                    .accessibilityIdentifier("player.cc")
                    ShareLink(item: URL(string: "https://katha.example/e/\(slug)-\(current)")!) {
                        VStack(spacing: 3) {
                            Image(systemName: "square.and.arrow.up").kathaFont(24)
                            Text(model.t("player.share")).kathaFont(11, weight: .semibold)
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
        // White chrome sat straight on the picture; over a bright frame the
        // title, times and rail were unreadable. Two soft scrims give them a
        // ground without dimming the episode.
        .background(alignment: .bottom) {
            LinearGradient(colors: [.clear, .black.opacity(0.65)],
                           startPoint: .top, endPoint: .bottom)
                .frame(height: 260)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .allowsHitTesting(false)
                .ignoresSafeArea()
        }
    }

    /// A short scrim under the status bar and the glass back button.
    private var topScrim: some View {
        LinearGradient(colors: [.black.opacity(0.55), .clear],
                       startPoint: .top, endPoint: .bottom)
            .frame(height: 140)
            .frame(maxHeight: .infinity, alignment: .top)
            .allowsHitTesting(false)
            .ignoresSafeArea()
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
                Text(model.t("player.timeLeft", clock(max(0, engine.durationSeconds - engine.currentSeconds))))
            }
            .kathaFont(11)
            .foregroundStyle(.white.opacity(0.8))
        }
    }

    private func railButton(icon: String, label: String, tint: Color,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon).kathaFont(24).foregroundStyle(tint)
                Text(label).kathaFont(11, weight: .semibold).foregroundStyle(.white)
            }
            .shadow(radius: 4)
        }
    }

    // MARK: states

    private var lockedFrame: some View {
        VStack(spacing: Katha.Spacing.lg) {
            Image(systemName: "lock.fill")
                .kathaFont(40)
                .foregroundStyle(Katha.Color.coin)
            Text(model.t("player.locked", current))
                .kathaFont(18, weight: .semibold)
                .multilineTextAlignment(.center)
                .foregroundStyle(Katha.Color.text)
            // The price comes from the playback answer (or the series); with
            // neither known yet the button carries no number at all.
            let price = playback?.priceCoins ?? detail?.episodeCoinPrice
            let title: String = {
                guard let price else { return model.t("paywall.unlock") }
                if let rate = model.rupeeRate {
                    return model.t("player.unlockForRupees", price, rupees(price, rate: rate))
                }
                return model.t("player.unlockFor", price)
            }()
            KathaPrimaryButton(title: title) {
                showPaywall = true
            }
            .padding(.horizontal, 44)
        }
    }

    private var connectionLost: some View {
        VStack(spacing: Katha.Spacing.md) {
            Image(systemName: "wifi.slash").kathaFont(36).foregroundStyle(.white)
            Text(model.t("player.offline.title")).kathaFont(17, weight: .semibold).foregroundStyle(.white)
            Button(model.t("player.offline.retry")) {
                loadFailed = false
                reload()
            }
            .kathaFont(15, weight: .semibold)
            .foregroundStyle(Katha.Color.accent)
        }
        .padding(24)
        .background(.black.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
    }

    private var seriesEndOrNext: some View {
        VStack(spacing: Katha.Spacing.lg) {
            if let d = detail, current >= d.episodeCount {
                Text(model.t("player.finished", d.title))
                    .kathaFont(20, weight: .bold).foregroundStyle(Katha.Color.text)
                Text(model.t("player.finished.body"))
                    .kathaFont(14).foregroundStyle(Katha.Color.text2)
                Button(model.t("player.backHome")) { dismiss() }
                    .kathaFont(15, weight: .semibold)
                    .foregroundStyle(Katha.Color.accent)
            } else {
                Text(model.t("player.upNext", current + 1))
                    .kathaFont(18, weight: .bold).foregroundStyle(Katha.Color.text)
                KathaPrimaryButton(title: model.t("player.playNext")) {
                    advance(to: current + 1)
                }
            }
        }
        .multilineTextAlignment(.center)
        .padding(24)
        // Opaque, and no wider than the copy needs: at 75 % black the video's
        // own text bled through the card and its full width ran under the rail.
        .frame(maxWidth: 320)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
            .strokeBorder(.white.opacity(0.1), lineWidth: 1))
        .shadow(color: .black.opacity(0.5), radius: 24, y: 8)
        .padding(.horizontal, Katha.Spacing.xl)
    }

    /// "2×" chip while the long-press holds (top-centre, out of the rail's way).
    private var boostPill: some View {
        VStack {
            Text("2×")
                .kathaFont(15, weight: .bold, monospacedDigit: true)
                .foregroundStyle(Katha.Color.text)
                .padding(.horizontal, 12)
                .kathaFrame(height: 30)
                .background(.black.opacity(0.6))
                .clipShape(Capsule())
                .padding(.top, 56)
                .accessibilityIdentifier("player.rate2x")
                .accessibilityLabel(model.t("player.rate2x"))
            Spacer()
        }
        .transition(reduceMotion ? .opacity : .scale(scale: 0.8).combined(with: .opacity))
        .animation(Katha.Motion.snappy, value: engine.boosting)
    }

    private var recordingBlocked: some View {
        VStack(spacing: Katha.Spacing.md) {
            Image(systemName: "video.slash.fill").kathaFont(40)
                .foregroundStyle(Katha.Color.text2)
            Text(model.t("player.recording.title"))
                .kathaFont(17, weight: .semibold).foregroundStyle(Katha.Color.text)
            Text(model.t("player.recording.body"))
                .kathaFont(13).foregroundStyle(Katha.Color.text2)
        }
    }

    // MARK: gestures & actions

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 60)
            .onEnded { g in
                guard abs(g.translation.height) > abs(g.translation.width) else { return }
                guard !captured else { return }     // the shield must not be swiped through
                if g.translation.height < -60 {
                    Haptics.tap()
                    advance(to: current + 1)
                } else if g.translation.height > 60, current > 1 {
                    Haptics.tap()
                    advance(to: current - 1)
                }
            }
    }

    // MARK: chrome visibility

    /// Restarts the inactivity task whenever any of these change: showing the
    /// chrome, a fresh interaction, a swipe to another episode, playback
    /// stopping, or a sheet opening or closing.
    /// True once the idle timer has hidden the controls on a playing episode.
    /// The gate, the paywall and every error state keep their bar.
    private var hidesChrome: Bool {
        !chromeVisible && !captured && !needsPin && playback?.isEntitled == true
    }

    private var idleHideKey: String {
        "\(chromeVisible)-\(activityToken)-\(current)-\(engine.isPlaying)-\(engine.ended)-\(showDrawer || showTracks || showPaywall)"
    }

    /// Bring the chrome back and restart its countdown.
    private func showChrome() {
        activityToken += 1
        guard !chromeVisible else { return }
        withAnimation(Katha.Motion.snappy) { chromeVisible = true }
    }

    /// One tap on the video: reveal hidden chrome, otherwise play/pause. The
    /// old handler did both at once, so the only way to see a clean frame also
    /// stopped the episode.
    private func surfaceTapped() {
        guard chromeVisible else {
            showChrome()
            return
        }
        activityToken += 1
        engineTapPlayPause()
    }

    /// Double-tap = like — the same action as the rail's heart, plus the burst.
    private func doubleTapped() {
        guard playback?.isEntitled == true, !captured else { return }
        showChrome()
        like()
        burstToken += 1
    }

    /// Long-press ≥ 0.4 s = 2× while held (PDD §10.2), with the "2×" chip.
    private func setBoost(_ on: Bool) {
        if on {
            guard playback?.isEntitled == true, !captured, !engine.boosting else { return }
            Haptics.tap()
            showChrome()
        }
        withAnimation(Katha.Motion.snappy) { engine.setBoost(on) }
    }

    private func like() {
        if !liked { Haptics.tap() }
        setLiked(true)
    }

    // MARK: like (per episode)

    private func likeKey(_ n: Int) -> String { "katha.liked.\(slug).\(n)" }

    private func setLiked(_ on: Bool) {
        liked = on
        UserDefaults.standard.set(on, forKey: likeKey(current))
    }

    private func loadLiked(for n: Int) {
        liked = UserDefaults.standard.bool(forKey: likeKey(n))
    }

    private func engineTapPlayPause() {
        guard playback?.isEntitled == true, !engine.ended, !captured else { return }
        engine.toggle()
    }

    private func advance(to n: Int) {
        guard let d = detail, (1...d.episodeCount).contains(n) else { return }
        reportProgress(force: true)
        lastReported = 0        // the throttle window belongs to ONE episode
        current = n
        loadLiked(for: n)       // the heart belongs to the episode, not the view
        showChrome()
        showPaywall = false
        engine.setBoost(false)
        engine.stop()
        startLoad(for: n)
    }

    /// Cancel whatever is loading and load episode `n`. Everything the load
    /// does after an await re-checks that `n` is still the episode on screen.
    private func startLoad(for n: Int) {
        loadTask?.cancel()
        loadTask = Task { await loadPlayback(for: n) }
    }

    /// Retry from the connection-lost state.
    private func reload() {
        startLoad(for: current)
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

    private func loadPlayback(for n: Int) async {
        /// True while this load still belongs to the episode on screen.
        var live: Bool { !Task.isCancelled && current == n }

        if let ready = nextReady, ready.number == n, ready.pb.isEntitled {
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
            var pb = try await model.api.playback(slug: slug, number: n)
            guard live else { return }

            // Auto-unlock (§8.4): debit only as the episode starts, one-tap off in
            // the drawer; a toast confirms each auto-debit. Never behind the
            // capture shield, and never for an episode the viewer swiped past.
            if pb.locked, model.autoUnlock, !captured,
               let price = pb.priceCoins, model.wallet.total >= price {
                if let res = try? await model.api.unlockEpisode(
                    slug: slug, number: n, idempotencyKey: UUID().uuidString) {
                    model.wallet.reconcile(with: res.wallet)
                    guard live else { return }        // charged, but no longer on screen
                    toast = model.t("player.autoUnlocked", price, n)
                    Haptics.success()
                    pb = try await model.api.playback(slug: slug, number: n)
                    guard live else { return }
                }
            }

            playback = pb
            loadFailed = false
            if pb.isEntitled, let urlStr = pb.hlsMasterUrl, let url = URL(string: urlStr) {
                showPaywall = false
                if !captured { engine.load(url: url, resumeMs: pb.resumePositionMs ?? 0) }
            } else {
                engine.stop()
                Haptics.warning()
                showPaywall = true
            }
        } catch {
            if live { loadFailed = true }
        }
    }

    private func reportProgress(force: Bool = false) {
        guard playback?.isEntitled == true else { return }
        let pos = Int(engine.currentSeconds * 1000)
        let dur = Int(engine.durationSeconds * 1000)
        guard force || pos > 0 else { return }
        // A position behind the last one we sent means the viewer scrubbed
        // back; the server moves the resume point back ONLY when told so.
        let rewind = engine.currentSeconds + 1 < lastReported
        lastReported = engine.currentSeconds
        let report = ProgressReport(slug: slug, number: current, positionMs: pos,
                                    durationMs: dur, rewind: rewind)
        let reporter = model.progress
        Task { await reporter.submit(report) }
    }

    // MARK: formatting

    private func clock(_ s: Double) -> String {
        let t = Int(s.rounded())
        return String(format: "%d:%02d", t / 60, t % 60)
    }

}

// MARK: - Audio & subtitles picker

/// The CC sheet: audio tracks and subtitle languages from the playback
/// payload merged with what the stream itself advertises. Selecting applies
/// to the running item; the caption choice is remembered for the next load.
struct TrackPickerSheet: View {
    let engine: PlayerEngine
    let playback: PlaybackResponse?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private struct Track: Identifiable {
        let lang: String
        let label: String
        var inStream: Bool
        var id: String { lang }
    }

    /// Payload tracks first (server labels), then stream-only languages.
    private var audioTracks: [Track] {
        // The server says "dub"; older payloads said "dubbed".
        merge(payload: (playback?.audio ?? []).map { ($0.lang, $0.kind.hasPrefix("dub") ? "\($0.label) · dubbed" : $0.label) },
              stream: engine.audibleOptions)
    }
    private var captionTracks: [Track] {
        merge(payload: (playback?.captions ?? []).map { ($0.lang, $0.label) },
              stream: engine.legibleOptions)
    }

    private func merge(payload: [(String, String)], stream: [AVMediaSelectionOption]) -> [Track] {
        let tagged = stream.filter { $0.locale != nil || $0.extendedLanguageTag != nil }
        let streamLangs = Set(tagged.map(PlayerEngine.langCode))
        // An untagged stream track (no language metadata) is the one the
        // payload describes — fold it into the payload's first entry rather
        // than listing an "Unknown".
        let untagged = stream.count - tagged.count
        var out: [Track] = payload.enumerated().map { i, t in
            Track(lang: t.0, label: Self.nativeName(t.0, t.1),
                  inStream: streamLangs.contains(t.0) || (i == 0 && untagged > 0))
        }
        for opt in tagged where !out.contains(where: { $0.lang == PlayerEngine.langCode(opt) }) {
            out.append(Track(lang: PlayerEngine.langCode(opt), label: opt.displayName, inStream: true))
        }
        if out.isEmpty {
            for opt in stream {
                out.append(Track(lang: PlayerEngine.langCode(opt), label: opt.displayName, inStream: true))
            }
        }
        return out
    }

    /// A bare language code from the payload reads as its own script.
    private static func nativeName(_ lang: String, _ label: String) -> String {
        guard label == lang else { return label }
        switch lang {
        case "hi": return "हिन्दी"
        case "ta": return "தமிழ்"
        case "te": return "తెలుగు"
        case "en": return "English"
        default: return lang
        }
    }

    /// The audio row to tick. A stream with a single, untagged audio track
    /// reports no selection at all, which left every row unticked and the sheet
    /// silent about what you were listening to.
    private var selectedAudio: String? {
        if let lang = engine.audioLang, audioTracks.contains(where: { $0.lang == lang }) {
            return lang
        }
        return audioTracks.first?.lang
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            HStack {
                Text(model.t("player.tracks"))
                    .kathaFont(20, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                Spacer()
                Button(model.t("packs.done")) { dismiss() }
                    .kathaFont(15, weight: .semibold)
                    .foregroundStyle(Katha.Color.accent)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
                    if !audioTracks.isEmpty {
                        section(model.t("player.audio"))
                        ForEach(audioTracks) { t in
                            row(t.label, selected: selectedAudio == t.lang, available: t.inStream) {
                                engine.selectAudio(lang: t.lang)
                            }
                        }
                    }
                    section(model.t("player.subtitles"))
                    row(model.t("player.subtitles.off"), selected: engine.captionLang == nil, available: true) {
                        engine.selectCaptions(lang: nil)
                    }
                    .accessibilityIdentifier("captions.off")
                    if captionTracks.isEmpty {
                        Text(model.t("player.subtitles.none"))
                            .kathaFont(13)
                            .foregroundStyle(Katha.Color.text2)
                    }
                    ForEach(captionTracks) { t in
                        row(t.label, selected: engine.captionLang == t.lang, available: t.inStream) {
                            engine.selectCaptions(lang: t.lang)
                        }
                        .accessibilityIdentifier("captions.\(t.lang)")
                    }
                    Text(model.t("player.subtitles.footer"))
                        .kathaFont(11)
                        // Without this the sentence was squeezed to one clipped
                        // line at the sheet's bottom edge instead of wrapping.
                        .fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(Katha.Color.text2)
                        .padding(.bottom, Katha.Spacing.lg)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(Katha.Spacing.xl)
        .presentationDetents([.medium, .large])
        // The system grabber is the drag handle; the sheet no longer draws a
        // second capsule of its own directly under it.
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
    }

    private func section(_ title: String) -> some View {
        Text(title)
            .kathaLabel(14)
            .kerning(1.2)
            .foregroundStyle(Katha.Color.text2)
    }

    private func row(_ label: String, selected: Bool, available: Bool,
                     action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            HStack {
                Text(label)
                    .kathaFont(15, weight: selected ? .semibold : .regular)
                    .foregroundStyle(Katha.Color.text)
                if !available {
                    Text(model.t(selected ? "player.track.remembered" : "player.track.notHere"))
                        .kathaFont(10, weight: .semibold)
                        .foregroundStyle(selected ? Katha.Color.coin : Katha.Color.text2)
                        .padding(.horizontal, 6)
                        .kathaFrame(height: 18)
                        .background((selected ? Katha.Color.coin : Katha.Color.text2).opacity(0.14))
                        .clipShape(Capsule())
                }
                Spacer(minLength: Katha.Spacing.sm)
                if selected {
                    Image(systemName: "checkmark")
                        .kathaFont(14, weight: .bold)
                        .foregroundStyle(Katha.Color.accent)
                }
            }
            .padding(.horizontal, Katha.Spacing.md)
            .kathaFrame(height: 46)
            .background(selected ? Katha.Color.accent.opacity(0.12) : Katha.Color.raised)
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Heart burst (double-tap like)

/// A heart that swells and fades from the centre on every `token` change.
/// Under Reduce Motion it simply blinks in and out.
struct HeartBurst: View {
    let token: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var visible = false
    @State private var scale: CGFloat = 0.4

    var body: some View {
        Image(systemName: "heart.fill")
            .kathaFont(96)
            .foregroundStyle(Katha.Color.accent)
            .shadow(color: .black.opacity(0.35), radius: 12)
            .scaleEffect(reduceMotion ? 1 : scale)
            .opacity(visible ? 0.95 : 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: token) { _, _ in
                guard token > 0 else { return }
                scale = 0.4
                withAnimation(reduceMotion ? .linear(duration: 0.1) : .spring(response: 0.3, dampingFraction: 0.55)) {
                    visible = true
                    scale = 1.15
                }
                Task {
                    try? await Task.sleep(for: .milliseconds(450))
                    withAnimation(.easeOut(duration: 0.25)) { visible = false; scale = 1.3 }
                }
            }
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
                Text(model.t("drawer.title"))
                    .kathaFont(20, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                Spacer()
                Text(model.t("drawer.count", detail.episodeCount, detail.freeEpisodeCount))
                    .kathaFont(12)
                    .foregroundStyle(Katha.Color.text2)
            }

            Toggle(isOn: $model.autoUnlock) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.t("settings.autoUnlock"))
                        .kathaFont(15)
                        .foregroundStyle(Katha.Color.text)
                    Text(model.t("drawer.autoUnlock.caption", detail.episodeCoinPrice))
                        .kathaFont(12)
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
                                    .kathaFont(13, weight: .semibold)
                                    .foregroundStyle(Katha.Color.text)
                                if !ep.isFree {
                                    Image(systemName: "lock.fill")
                                        .kathaFont(8)
                                        .foregroundStyle(ep.number == current ? Katha.Color.text : Katha.Color.coin)
                                        .frame(maxWidth: .infinity, maxHeight: .infinity,
                                               alignment: .bottomTrailing)
                                        .padding(3)
                                }
                            }
                            .kathaFrame(height: 44)
                        }
                    }
                }
                // The safe-area inset landed on the sheet, not on the scroll
                // content, so the last row was sliced with a dead band under it.
                .padding(.bottom, Katha.Spacing.xl)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(Katha.Spacing.xl)
        .padding(.bottom, -Katha.Spacing.xl)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
    }
}
