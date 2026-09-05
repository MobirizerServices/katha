import SwiftUI
import KathaKit

// Onboarding (mockup §1): splash → language → interests. Under 20 seconds, both
// steps skippable in spirit — no login required to watch free episodes.

/// The launch identity — a staged cinematic entrance: the key art fades in and
/// drifts (Ken Burns), the mark springs up, the wordmark and Devanagari echo
/// stagger, and the tagline rises last. Shown at onboarding step 0 and as the
/// RootView boot screen. Honors Reduce Motion: everything lands at once, no drift.
struct SplashView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let cardShape = RoundedRectangle(cornerRadius: Katha.Radius.xxl, style: .continuous)

    // Each element's entrance is its own flag so the sequence can stagger them.
    @State private var heroIn = false
    @State private var drift = false
    @State private var markIn = false
    @State private var wordIn = false
    @State private var devIn = false
    @State private var taglineIn = false

    var body: some View {
        ZStack {
            Katha.Color.bg.ignoresSafeArea()
            Color.clear
                .overlay {
                    Image(decorative: "OnboardingHero")
                        .resizable()
                        .scaledToFill()
                        .scaleEffect(drift ? 1.08 : 1.0)      // slow Ken Burns
                        .opacity(heroIn ? 1 : 0)
                }
                .overlay {
                    HeroScrim(topTint: 0.2, stops: [(opacity: 0.15, location: 0.5),
                                                    (opacity: 1, location: 1)])
                        .opacity(heroIn ? 1 : 0.55)           // scrim breathes up
                }
                .clipped()
                .ignoresSafeArea()

            VStack(spacing: 10) {
                Image(decorative: "KathaMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 92, height: 92)
                    .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.xl, style: .continuous))
                    .shadow(color: Katha.Color.accent.opacity(0.35), radius: 24, y: 10)
                    .scaleEffect(markIn ? 1 : 0.8)
                    .opacity(markIn ? 1 : 0)
                Text("Katha")
                    .kathaFont(44, weight: .heavy)
                    .foregroundStyle(Katha.Color.text)
                    .opacity(wordIn ? 1 : 0)
                    .offset(y: wordIn ? 0 : 12)
                Text("कथा")
                    .kathaFont(18)
                    .foregroundStyle(Katha.Color.text2)
                    .opacity(devIn ? 1 : 0)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 28)
            .background(.ultraThinMaterial.opacity(0.72))
            .clipShape(cardShape)
            .overlay(cardShape.strokeBorder(.white.opacity(0.12)))
            .opacity(markIn ? 1 : 0)                            // card fades with the mark
            VStack {
                Spacer()
                Text("Stories in 2 minutes.")
                    .kathaFont(15)
                    .foregroundStyle(Katha.Color.text2)
                    .padding(.bottom, 48)
                    .opacity(taglineIn ? 1 : 0)
                    .offset(y: taglineIn ? 0 : 16)
            }
        }
        .task { await runIntro() }
    }

    /// Drive the staggered entrance. Under Reduce Motion every element is placed
    /// immediately with no animation or drift.
    private func runIntro() async {
        guard !reduceMotion else {
            heroIn = true; markIn = true; wordIn = true; devIn = true; taglineIn = true
            return
        }
        withAnimation(.easeOut(duration: 0.8)) { heroIn = true }
        // A long, once-through drift that keeps moving under the whole sequence.
        withAnimation(.easeInOut(duration: 6)) { drift = true }
        try? await Task.sleep(for: .milliseconds(200))
        withAnimation(Katha.Motion.spring) { markIn = true }
        try? await Task.sleep(for: .milliseconds(300))
        withAnimation(.easeOut(duration: 0.5)) { wordIn = true }
        try? await Task.sleep(for: .milliseconds(200))
        withAnimation(.easeOut(duration: 0.5)) { devIn = true }
        try? await Task.sleep(for: .milliseconds(300))
        withAnimation(.easeOut(duration: 0.6)) { taglineIn = true }
    }
}

struct OnboardingFlow: View {
    @Environment(AppModel.self) private var model
    @State private var step = 0                      // 0 splash, 1 language, 2 interests
    @State private var languages: Set<String> = []
    @State private var picked: Set<String> = []

    var body: some View {
        ZStack {
            Katha.Color.bg.ignoresSafeArea()
            switch step {
            case 0:
                SplashView()
                    .task {
                        // Hold long enough for the cinematic entrance to finish.
                        try? await Task.sleep(for: .seconds(2))
                        withAnimation { step = 1 }
                    }
            case 1:
                LanguagePickerView(selected: $languages) {
                    model.contentLanguage = languages.first ?? "hi"
                    withAnimation { step = 2 }
                }
            default:
                InterestsView(picked: $picked) {
                    model.interests = Array(picked)
                    model.onboarded = true            // RootView boots the session
                }
            }
        }
    }
}

struct LanguagePickerView: View {
    @Binding var selected: Set<String>
    let onContinue: () -> Void

    private let options: [(code: String, native: String, name: String)] = [
        ("hi", "हिन्दी", "Hindi"),
        ("ta", "தமிழ்", "Tamil"),
        ("te", "తెలుగు", "Telugu"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                Text("Which languages do you watch in?")
                    .kathaFont(28, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                Text("Pick one or more. You can change this anytime.")
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.text2)
            }
            .padding(.horizontal, Katha.Spacing.lg)
            .padding(.top, 72)

            VStack(spacing: 0) {
                ForEach(options, id: \.code) { opt in
                    Button {
                        if selected.contains(opt.code) { selected.remove(opt.code) }
                        else { selected.insert(opt.code) }
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(opt.native)
                                    .kathaFont(17)
                                    .foregroundStyle(Katha.Color.text)
                                Text(opt.name)
                                    .kathaFont(13)
                                    .foregroundStyle(Katha.Color.text2)
                            }
                            Spacer()
                            if selected.contains(opt.code) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Katha.Color.accent)
                            } else {
                                Circle()
                                    .strokeBorder(Katha.Color.text2, lineWidth: 1.5)
                                    .frame(width: 22, height: 22)
                            }
                        }
                        .padding(.horizontal, Katha.Spacing.lg)
                        .kathaFrame(height: 56)
                    }
                    Divider().overlay(Katha.Color.raised)
                }
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("বাংলা · मराठी")
                            .kathaFont(17)
                            .foregroundStyle(Katha.Color.text2)
                        Text("Coming soon")
                            .kathaFont(13)
                            .foregroundStyle(Katha.Color.text2)
                    }
                    Spacer()
                }
                .padding(.horizontal, Katha.Spacing.lg)
                .kathaFrame(height: 56)
                .opacity(0.5)
            }
            .padding(.top, Katha.Spacing.xl)

            Spacer()
            KathaPrimaryButton(title: "Continue", enabled: !selected.isEmpty) { onContinue() }
                .padding(.horizontal, Katha.Spacing.lg)
                .padding(.bottom, 44)
        }
    }
}

struct InterestsView: View {
    @Binding var picked: Set<String>
    let onDone: () -> Void

    private let chips = ["Romance", "Family drama", "Revenge", "Thriller",
                         "Fantasy & myth", "Comedy", "Horror", "Workplace",
                         "Campus", "Sports", "Crime", "Contract marriage",
                         "Secret billionaire", "Time-slip", "In-laws saga", "Second chance"]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                Text("What do you like watching?")
                    .kathaFont(28, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                Text("Pick a few. Your feed starts here.")
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.text2)
            }
            .padding(.horizontal, Katha.Spacing.lg)
            .padding(.top, 72)

            FlowChips(chips: chips, picked: $picked)
                .padding(Katha.Spacing.lg)

            Spacer()
            VStack(spacing: 6) {
                KathaPrimaryButton(title: "Continue", enabled: !picked.isEmpty) { onDone() }
                Button("Skip for now") { onDone() }
                    .kathaFont(15)
                    .foregroundStyle(Katha.Color.text2)
                    .kathaFrame(height: 44)
            }
            .padding(.horizontal, Katha.Spacing.lg)
            .padding(.bottom, 32)
        }
    }
}

/// Simple wrapping chip grid (selected = accent tint + border, never solid fill).
struct FlowChips: View {
    let chips: [String]
    @Binding var picked: Set<String>

    var body: some View {
        FlowLayout(spacing: 8, lineSpacing: 10) {
            ForEach(chips, id: \.self) { chip in
                let on = picked.contains(chip)
                Button {
                    if on { picked.remove(chip) } else { picked.insert(chip) }
                } label: {
                    Text(chip)
                        .kathaFont(13)
                        .lineLimit(1)
                        .fixedSize()                     // chips hug their label — never truncate
                        .foregroundStyle(on ? Katha.Color.text : Katha.Color.text2)
                        .padding(.horizontal, 12)
                        .kathaFrame(height: 32)
                        .background(on ? Katha.Color.accent.opacity(0.14) : Katha.Color.surface)
                        .overlay(
                            Capsule().strokeBorder(on ? Katha.Color.accent : Katha.Color.raised,
                                                   lineWidth: 1)
                        )
                        .clipShape(Capsule())
                }
            }
        }
    }
}
