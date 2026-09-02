import SwiftUI
import KathaKit

// Onboarding (mockup §1): splash → language → interests. Under 20 seconds, both
// steps skippable in spirit — no login required to watch free episodes.

struct SplashView: View {
    private let cardShape = RoundedRectangle(cornerRadius: Katha.Radius.xxl, style: .continuous)

    var body: some View {
        ZStack {
            Katha.Color.bg.ignoresSafeArea()
            Color.clear
                .overlay {
                    Image(decorative: "OnboardingHero")
                        .resizable()
                        .scaledToFill()
                }
                .overlay {
                    HeroScrim(topTint: 0.2, stops: [(opacity: 0.15, location: 0.5),
                                                    (opacity: 1, location: 1)])
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
                Text("Katha")
                    .font(.system(size: 44, weight: .heavy))
                    .foregroundStyle(Katha.Color.text)
                Text("कथा")
                    .font(.system(size: 18))
                    .foregroundStyle(Katha.Color.text2)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 28)
            .background(.ultraThinMaterial.opacity(0.72))
            .clipShape(cardShape)
            .overlay(cardShape.strokeBorder(.white.opacity(0.12)))
            VStack {
                Spacer()
                Text("Stories in 2 minutes.")
                    .font(.system(size: 15))
                    .foregroundStyle(Katha.Color.text2)
                    .padding(.bottom, 48)
            }
        }
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
                        try? await Task.sleep(for: .seconds(1))
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
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                Text("Pick one or more. You can change this anytime.")
                    .font(.system(size: 13))
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
                                    .font(.system(size: 17))
                                    .foregroundStyle(Katha.Color.text)
                                Text(opt.name)
                                    .font(.system(size: 13))
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
                        .frame(height: 56)
                    }
                    Divider().overlay(Katha.Color.raised)
                }
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("বাংলা · मराठी")
                            .font(.system(size: 17))
                            .foregroundStyle(Katha.Color.text2)
                        Text("Coming soon")
                            .font(.system(size: 13))
                            .foregroundStyle(Katha.Color.text2)
                    }
                    Spacer()
                }
                .padding(.horizontal, Katha.Spacing.lg)
                .frame(height: 56)
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
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Katha.Color.text)
                Text("Pick a few. Your feed starts here.")
                    .font(.system(size: 13))
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
                    .font(.system(size: 15))
                    .foregroundStyle(Katha.Color.text2)
                    .frame(height: 44)
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
                        .font(.system(size: 13))
                        .lineLimit(1)
                        .fixedSize()                     // chips hug their label — never truncate
                        .foregroundStyle(on ? Katha.Color.text : Katha.Color.text2)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
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
