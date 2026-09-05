import SwiftUI

// First-run coach marks: a one-time spotlight tour on the first Home visit that
// teaches the three non-obvious things — daily coins, the swipe-up player
// gesture, and the tabs. Tap anywhere to advance; skippable. Re-triggerable from
// Profile → Replay tips. Honors Reduce Motion (no bobbing arrow, instant fades).
//
// Anchoring: only the check-in card is a real view we own, so it gets a true
// spotlight cutout; the swipe and tabs steps are positioned cards (the player
// isn't on screen here, and the tab bar is system-drawn). If the check-in card
// isn't present (already claimed / offline), step one degrades to a top card.

// MARK: - Anchor plumbing

/// Views the tour can spotlight. Marked with `.coachAnchor(_:)`.
enum CoachTarget: Hashable {
    case checkin
}

struct CoachAnchorKey: PreferenceKey {
    static let defaultValue: [CoachTarget: Anchor<CGRect>] = [:]
    static func reduce(value: inout [CoachTarget: Anchor<CGRect>],
                       nextValue: () -> [CoachTarget: Anchor<CGRect>]) {
        value.merge(nextValue()) { _, new in new }
    }
}

extension View {
    /// Register this view as a spotlight target for the coach-mark tour.
    func coachAnchor(_ target: CoachTarget) -> some View {
        anchorPreference(key: CoachAnchorKey.self, value: .bounds) { [target: $0] }
    }
}

// MARK: - Steps

private struct CoachStep {
    enum Placement { case belowTarget, center, bottom }
    let icon: String
    let title: String
    let body: String
    let target: CoachTarget?
    let placement: Placement
    var showsSwipeArrow = false
}

private let coachSteps: [CoachStep] = [
    CoachStep(icon: "indianrupeesign.circle.fill",
              title: "Coins, on the house",
              body: "Claim free coins every day. Your first episodes are free — coins unlock the rest.",
              target: .checkin, placement: .belowTarget),
    CoachStep(icon: "hand.draw.fill",
              title: "Swipe up for the next episode",
              body: "Inside an episode, swipe up to jump to the next one — swipe down to go back.",
              target: nil, placement: .center, showsSwipeArrow: true),
    CoachStep(icon: "square.grid.2x2.fill",
              title: "Everything's a tab away",
              body: "Browse by genre, keep a My List, and pick up where you left off — all from the bar below.",
              target: nil, placement: .bottom),
]

// MARK: - Host

/// Wraps the tab shell, decides when the tour runs, and overlays it.
struct CoachMarksHost<Content: View>: View {
    @Environment(AppModel.self) private var model
    @ViewBuilder var content: Content

    @State private var active = false
    @State private var index = 0

    var body: some View {
        content
            .overlayPreferenceValue(CoachAnchorKey.self) { anchors in
                GeometryReader { proxy in
                    if active, index < coachSteps.count {
                        let step = coachSteps[index]
                        let spot = step.target.flatMap { anchors[$0] }.map { proxy[$0] }
                        CoachOverlay(step: step, spotlight: spot, size: proxy.size,
                                     index: index, total: coachSteps.count,
                                     onNext: advance, onSkip: finish)
                            .transition(.opacity)
                    }
                }
                .ignoresSafeArea()
            }
            .task(id: model.coachReplayToken) {
                if model.coachReplayToken > 0 { start(); return }
                let env = ProcessInfo.processInfo.environment
                // dev/QA force-show; KATHA_COACH=<n> opens at step n (1-based).
                if let c = env["KATHA_COACH"] { start(at: max(0, (Int(c) ?? 1) - 1)); return }
                // UI tests and marketing tours drive scripted flows — the tour's
                // dimming overlay must never sit on top of them. Both set one of
                // these; a real first-run user sets neither.
                if env["KATHA_RESET"] != nil || env["KATHA_ONBOARDED"] != nil { return }
                guard !model.hasSeenCoachMarks else { return }
                // Wait for the home feed so the spotlight target exists.
                for _ in 0..<20 where model.feed.rows.isEmpty {
                    try? await Task.sleep(for: .milliseconds(150))
                }
                start()
            }
    }

    private func start(at step: Int = 0) {
        index = min(step, coachSteps.count - 1)
        withAnimation(.easeOut(duration: 0.3)) { active = true }
    }

    private func advance() {
        if index + 1 < coachSteps.count {
            withAnimation(Katha.Motion.snappy) { index += 1 }
        } else {
            finish()
        }
    }

    private func finish() {
        withAnimation(.easeOut(duration: 0.25)) { active = false }
        model.hasSeenCoachMarks = true
    }
}

// MARK: - Overlay

private struct CoachOverlay: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let step: CoachStep
    let spotlight: CGRect?
    let size: CGSize
    let index: Int
    let total: Int
    let onNext: () -> Void
    let onSkip: () -> Void

    @State private var bob = false

    private var haloRect: CGRect? {
        spotlight.map { $0.insetBy(dx: -8, dy: -8) }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Dim everything, punching a hole around the spotlight target.
            Rectangle()
                .fill(.black.opacity(0.74))
                .reverseMask {
                    if let r = haloRect {
                        RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
                            .frame(width: r.width, height: r.height)
                            .position(x: r.midX, y: r.midY)
                    }
                }

            if let r = haloRect {
                RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous)
                    .stroke(Katha.Color.accent.opacity(0.9), lineWidth: 2)
                    .frame(width: r.width, height: r.height)
                    .position(x: r.midX, y: r.midY)
            }

            card
                .frame(maxWidth: 320)
                .position(cardCenter)

            Button("Skip", action: onSkip)
                .kathaFont(15, weight: .semibold)
                .foregroundStyle(.white.opacity(0.9))
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onNext)
        .onAppear { if !reduceMotion { bob = true } }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(step.title). \(step.body)")
        .accessibilityHint("Double-tap to continue")
        .accessibilityAddTraits(.isModal)
    }

    private var card: some View {
        VStack(spacing: 10) {
            if step.showsSwipeArrow {
                VStack(spacing: -6) {
                    Image(systemName: "chevron.up")
                    Image(systemName: "chevron.up").opacity(0.5)
                }
                .kathaFont(26, weight: .bold)
                .foregroundStyle(Katha.Color.accent)
                .offset(y: bob ? -8 : 4)
                .animation(reduceMotion ? nil :
                            .easeInOut(duration: 0.85).repeatForever(autoreverses: true),
                           value: bob)
            } else {
                Image(systemName: step.icon)
                    .kathaFont(30, weight: .semibold)
                    .foregroundStyle(Katha.Color.accent)
            }
            Text(step.title)
                .kathaFont(19, weight: .bold)
                .foregroundStyle(Katha.Color.text)
                .multilineTextAlignment(.center)
            Text(step.body)
                .kathaFont(14)
                .foregroundStyle(Katha.Color.text2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                ForEach(0..<total, id: \.self) { i in
                    Capsule()
                        .fill(i == index ? Katha.Color.accent : Katha.Color.text2.opacity(0.4))
                        .frame(width: i == index ? 18 : 6, height: 6)
                }
            }
            .padding(.top, 2)

            Text(index + 1 == total ? "Got it" : "Next")
                .kathaFont(15, weight: .semibold)
                .foregroundStyle(Katha.Color.text)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(
                    LinearGradient(colors: [Katha.Color.accent, Katha.Color.accentPressed],
                                   startPoint: .top, endPoint: .bottom))
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
                .padding(.top, 2)
        }
        .padding(20)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.xl, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Katha.Radius.xl, style: .continuous)
            .strokeBorder(.white.opacity(0.08)))
        .shadow(color: .black.opacity(0.4), radius: 24, y: 12)
    }

    /// Where the card sits — below the spotlight, screen-centered, or above the
    /// tab bar — clamped so it never runs off the top or bottom edge.
    private var cardCenter: CGPoint {
        let x = size.width / 2
        let half: CGFloat = 130            // approx half the card height for clamping
        switch step.placement {
        case .center:
            return CGPoint(x: x, y: size.height * 0.46)
        case .bottom:
            return CGPoint(x: x, y: size.height - 150)
        case .belowTarget:
            if let r = spotlight {
                let below = r.maxY + 24 + half
                // If the target sits low, place the card above it instead.
                if below + half > size.height - 60, r.minY - 24 - half > 80 {
                    return CGPoint(x: x, y: r.minY - 24 - half)
                }
                return CGPoint(x: x, y: min(below, size.height - 60 - half))
            }
            return CGPoint(x: x, y: max(180, size.height * 0.22))
        }
    }
}

// MARK: - reverse mask (punch a hole in a view)

private extension View {
    func reverseMask<Mask: View>(@ViewBuilder _ mask: () -> Mask) -> some View {
        self.mask {
            Rectangle()
                .overlay { mask().blendMode(.destinationOut) }
                .compositingGroup()
        }
    }
}
