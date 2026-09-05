import SwiftUI
import KathaKit

// Help assistant (mockup 4.6 "Chat with us — Answers in Hindi and English. A
// person steps in when needed."). A chat-shaped screen over the FAQ: a local
// keyword matcher picks the entry, the answer renders in the app language,
// and "Talk to a person" hands over to the grievance form. No network AI —
// the footer says so.

// MARK: - Knowledge base

/// One FAQ intent: keywords in English, Hinglish and Devanagari, answers in
/// both app languages. Answers that quote server numbers are built at match
/// time from the remote config (never a baked-in price).
struct HelpIntent: Identifiable, Sendable {
    let id: String
    let keywords: [String]
    let questionEn: String
    let questionHi: String
    let answer: @MainActor @Sendable (AppModel) -> String

    static let all: [HelpIntent] = [
        HelpIntent(
            id: "coins",
            keywords: ["coin", "coins", "sikke", "सिक्के", "सिक्का", "price", "cost", "kitne", "कितने",
                       "pack", "buy", "kharid", "खरीद", "paise", "पैसे", "rupee", "₹"],
            questionEn: "How do coins work?",
            questionHi: "सिक्के कैसे काम करते हैं?",
            answer: { m in m.uiLanguage == "hi" ? faqCoinsAnswerHindi(m) : faqCoinsAnswer(m) }),
        HelpIntent(
            id: "free",
            keywords: ["free", "muft", "मुफ़्त", "मुफ्त", "first episodes", "pehle", "पहले", "without paying",
                       "bina", "बिना"],
            questionEn: "Which episodes are free?",
            questionHi: "कौन से एपिसोड मुफ़्त हैं?",
            answer: { m in
                let n = m.freeEpisodesDefault.map(String.init) ?? "the first few"
                return m.uiLanguage == "hi"
                    ? "हर कहानी के पहले \(n) एपिसोड मुफ़्त हैं — बिना लॉगिन के भी। उसके बाद के एपिसोड सिक्कों से खुलते हैं, और रोज़ का चेक-इन मुफ़्त सिक्के देता है।"
                    : "The first \(n) episodes of every series are free — no login needed. Episodes after that unlock with coins, and the daily check-in on Home gives you free coins."
            }),
        HelpIntent(
            id: "missing",
            keywords: ["paid", "didn't get", "didnt get", "not credited", "missing", "nahi mile", "नहीं मिले",
                       "nahi aaye", "नहीं आए", "restore", "purchase"],
            questionEn: "I paid but didn't get my coins",
            questionHi: "पैसे कटे पर सिक्के नहीं मिले",
            answer: { m in m.uiLanguage == "hi"
                ? "वॉलेट खोलकर नीचे खींचें, फिर \"खरीदारी वापस लाएँ\" दबाएँ। Apple से पुष्टि हुई खरीद कभी खोती नहीं — कुछ मिनट में सिक्के जुड़ जाते हैं। फिर भी न आएँ तो \"किसी इंसान से बात करें\"।"
                : "Open Wallet, pull to refresh, then tap Restore purchases. A purchase Apple confirmed is never lost — the coins land within a few minutes. If they still haven't, tap \"Talk to a person\" and we'll re-credit it."
            }),
        HelpIntent(
            id: "refund",
            keywords: ["refund", "cancel", "money back", "wapas", "वापस", "रिफ़ंड", "रिफंड", "return"],
            questionEn: "Refunds and cancellations",
            questionHi: "रिफ़ंड और रद्द करना",
            answer: { m in m.uiLanguage == "hi"
                ? "App Store की खरीद का रिफ़ंड Apple अपनी नीति के तहत करता है (reportaproblem.apple.com)। वेबसाइट पर खरीदे सिक्के 7 दिन के अंदर, अगर खर्च न हुए हों, रिफ़ंड हो सकते हैं।"
                : "App Store purchases are refunded by Apple under Apple's policy (reportaproblem.apple.com). Coins bought on the Katha website are refundable within 7 days if unspent."
            }),
        HelpIntent(
            id: "parental",
            keywords: ["parental", "pin", "lock", "kids", "child", "bachche", "बच्चे", "पिन", "लॉक", "16+",
                       "adult", "forgot"],
            questionEn: "Parental lock and PIN",
            questionHi: "पैरेंटल लॉक और PIN",
            answer: { m in m.uiLanguage == "hi"
                ? "सेटिंग्स → पैरेंटल लॉक में 4 अंकों का PIN लगाएँ। उसके बाद U/A 16+ और A रेटेड कहानियाँ PIN के बिना नहीं चलतीं। PIN भूल गए? लॉक स्क्रीन पर \"PIN भूल गए?\" दबाएँ — आपके फ़ोन पर कोड आएगा।"
                : "Set a 4-digit PIN in Settings → Parental lock. U/A 16+ and A-rated titles then ask for it before playing. Forgot it? Tap \"Forgot PIN?\" on the lock screen and we'll send a code to the phone on your account."
            }),
        HelpIntent(
            id: "delete",
            keywords: ["delete", "remove account", "close account", "account delete", "hatana", "हटाना",
                       "हटाएँ", "band", "बंद", "data"],
            questionEn: "Deleting my account",
            questionHi: "खाता हटाना",
            answer: { m in m.uiLanguage == "hi"
                ? "सेटिंग्स → खाता हटाएँ। आपके सिक्के और अनलॉक किए एपिसोड हट जाते हैं; फ़ोन नंबर और देखने का इतिहास 30 दिन में मिट जाता है। Apple से की खरीद पर Apple की रिफ़ंड नीति लागू है।"
                : "Settings → Delete account. Your coins and unlocked episodes are removed; your phone number and watch history are deleted within 30 days. Purchases made through Apple follow Apple's refund policy."
            }),
        HelpIntent(
            id: "language",
            keywords: ["language", "bhasha", "भाषा", "hindi", "tamil", "telugu", "english", "subtitle",
                       "subtitles", "dub", "dubbed", "caption", "हिन्दी", "अंग्रेज़ी", "सबटाइटल"],
            questionEn: "Changing languages or subtitles",
            questionHi: "भाषा या सबटाइटल बदलना",
            answer: { m in m.uiLanguage == "hi"
                ? "कहानियों की भाषा होम के ऊपर के मेनू या सेटिंग्स → भाषा से बदलें। ऐप की भाषा (मेनू, बटन) अलग सेटिंग है। प्लेयर में CC बटन से ऑडियो और सबटाइटल चुनें — आपकी पसंद अगले एपिसोड में याद रहती है।"
                : "Change the content language from the menu at the top of Home or Settings → Language. The app language (menus, buttons) is a separate setting there. In the player, the CC button picks audio and subtitles — your choice is remembered for the next episode."
            }),
        HelpIntent(
            id: "playback",
            keywords: ["play", "playing", "buffer", "buffering", "stuck", "loading", "slow", "video",
                       "connection", "not working", "chal nahi", "चल नहीं", "अटक", "atak", "quality",
                       "black screen", "sound", "audio", "error"],
            questionEn: "Playback problems",
            questionHi: "वीडियो चलने में दिक्कत",
            answer: { m in m.uiLanguage == "hi"
                ? "पहले इंटरनेट जाँचें और प्लेयर में \"फिर कोशिश करें\" दबाएँ। धीमे नेटवर्क पर सेटिंग्स → डेटा सेवर चालू करें — क्वालिटी कम, रुकावट कम। स्क्रीन रिकॉर्डिंग चालू हो तो वीडियो छिप जाता है; उसे बंद करें। समस्या बनी रहे तो एपिसोड का नाम बताकर \"किसी इंसान से बात करें\"।"
                : "Check your connection and tap Retry in the player. On a slow network turn on Settings → Data saver — lower quality, fewer stalls. Video hides while screen recording is on; stop the recording and it resumes. If it keeps happening, tap \"Talk to a person\" and name the episode."
            }),
    ]

    /// Best intent for a question. Hits are weighted by keyword length, so a
    /// specific phrase ("nahi mile") outranks a generic word ("coins") that
    /// several intents share; nothing matched → nil.
    static func match(_ text: String) -> HelpIntent? {
        let q = text.lowercased()
        guard !q.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let scored = all.map { intent -> (HelpIntent, Int) in
            (intent, intent.keywords.reduce(0) { $0 + (q.contains($1) ? $1.count : 0) })
        }
        guard let best = scored.max(by: { $0.1 < $1.1 }), best.1 > 0 else { return nil }
        return best.0
    }
}

/// Hindi twin of `faqCoinsAnswer` — same server numbers, same promise.
@MainActor func faqCoinsAnswerHindi(_ model: AppModel) -> String {
    guard let free = model.freeEpisodesDefault, let price = model.appConfig?.episodeCoinPrice else {
        return "हर कहानी के पहले एपिसोड मुफ़्त हैं; उसके बाद हर एपिसोड के लिए सिक्के लगते हैं। पैक एक बार खरीदें — सिक्के कभी खत्म नहीं होते।"
    }
    let rupee = model.rupeeRate.map { " (लगभग ₹\(rupees(price, rate: $0)))" } ?? ""
    return "हर कहानी के पहले \(free) एपिसोड मुफ़्त हैं। उसके बाद हर एपिसोड \(price) सिक्कों\(rupee) में खुलता है। पैक एक बार खरीदें — सिक्के कभी खत्म नहीं होते।"
}

// MARK: - Screen

struct HelpAssistantView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Message: Identifiable, Equatable {
        enum Role { case user, bot }
        let id = UUID()
        let role: Role
        let text: String
    }

    @State private var messages: [Message] = []
    @State private var draft = ""
    @State private var showGrievance = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: Katha.Spacing.md) {
                        ForEach(messages) { m in
                            bubble(m).id(m.id)
                        }
                        if messages.count <= 1 { suggestions }
                    }
                    .padding(Katha.Spacing.lg)
                }
                .onChange(of: messages) { _, all in
                    guard let last = all.last else { return }
                    withAnimation(reduceMotion ? nil : Katha.Motion.snappy) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            Divider().overlay(Katha.Color.raised)

            VStack(spacing: Katha.Spacing.sm) {
                HStack(spacing: 10) {
                    TextField(model.t("assistant.placeholder"), text: $draft)
                        .focused($focused)
                        .foregroundStyle(Katha.Color.text)
                        .submitLabel(.send)
                        .onSubmit(send)
                        .accessibilityIdentifier("assistant.input")
                    Button(action: send) {
                        Image(systemName: "arrow.up.circle.fill")
                            .kathaFont(28)
                            .foregroundStyle(draft.trimmingCharacters(in: .whitespaces).isEmpty
                                             ? Katha.Color.text2 : Katha.Color.accent)
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel(model.t("assistant.send"))
                    .accessibilityIdentifier("assistant.send")
                }
                .padding(.horizontal, 14)
                .kathaFrame(height: 48)
                .background(Katha.Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))

                Button {
                    showGrievance = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.wave.2.fill")
                        Text(model.t("assistant.person"))
                    }
                    .kathaFont(14, weight: .semibold)
                    .foregroundStyle(Katha.Color.text)
                    .frame(maxWidth: .infinity)
                    .kathaFrame(height: 40)
                    .background(Katha.Color.raised)
                    .clipShape(Capsule())
                }
                .buttonStyle(PressableStyle())

                Text(model.t("assistant.footer"))
                    .kathaFont(11)
                    .foregroundStyle(Katha.Color.text2)
                    .multilineTextAlignment(.center)
            }
            .padding(Katha.Spacing.lg)
            .background(Katha.Color.bg)
        }
        .background(Katha.Color.bg)
        .navigationTitle(model.t("assistant.title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .sheet(isPresented: $showGrievance) { GrievanceSheet() }
        .onAppear {
            if messages.isEmpty {
                messages = [Message(role: .bot, text: model.t("assistant.greeting"))]
            }
        }
    }

    /// The FAQ questions as tappable chips — the fastest path to an answer.
    private var suggestions: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(HelpIntent.all) { intent in
                let q = model.uiLanguage == "hi" ? intent.questionHi : intent.questionEn
                Button { ask(q, intent: intent) } label: {
                    Text(q)
                        .kathaFont(13, weight: .medium)
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundStyle(Katha.Color.text)
                        .padding(.horizontal, 12)
                        .kathaFrame(height: 32)
                        .background(Katha.Color.surface)
                        .overlay(Capsule().strokeBorder(Katha.Color.raised, lineWidth: 1))
                        .clipShape(Capsule())
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(.top, 4)
    }

    private func bubble(_ m: Message) -> some View {
        HStack {
            if m.role == .user { Spacer(minLength: 48) }
            Text(m.text)
                .kathaFont(15)
                .foregroundStyle(Katha.Color.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(m.role == .user ? Katha.Color.accent.opacity(0.22) : Katha.Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
                .accessibilityLabel(m.role == .user ? "You: \(m.text)" : "Katha: \(m.text)")
            if m.role == .bot { Spacer(minLength: 48) }
        }
        .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
    }

    private func send() {
        let q = draft.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        draft = ""
        ask(q, intent: HelpIntent.match(q))
    }

    private func ask(_ question: String, intent: HelpIntent?) {
        withAnimation(reduceMotion ? nil : Katha.Motion.spring) {
            messages.append(Message(role: .user, text: question))
        }
        let answer = intent?.answer(model) ?? model.t("assistant.fallback")
        Task {
            // A beat before the reply so the exchange reads as a conversation.
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 350))
            withAnimation(reduceMotion ? nil : Katha.Motion.spring) {
                messages.append(Message(role: .bot, text: answer))
            }
        }
    }
}

/// The grievance form on its own, for "Talk to a person".
struct GrievanceSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List { GrievanceFormSection() }
                .scrollContentBackground(.hidden)
                .background(Katha.Color.bg)
                .navigationTitle("File a grievance")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
                }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Katha.Color.surface)
    }
}
