import SwiftUI
import KathaKit

// Account section (mockup §4): Profile (member/guest), Settings, Parental lock,
// Help & grievance, Delete account.

// MARK: - 4.1 Profile

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @State private var showLogin = false
    /// The row metrics: 52 pt rows around 15 pt labels clip the moment the
    /// reader turns text up, so both grow on the Dynamic Type curve.
    @ScaledMetric(relativeTo: .body) private var rowHeight: CGFloat = 52
    @ScaledMetric(relativeTo: .body) private var iconTile: CGFloat = 30
    @ScaledMetric(relativeTo: .title2) private var avatar: CGFloat = 52

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                identityCard

                VStack(spacing: 0) {
                    row("creditcard.fill", model.t("wallet.title"),
                        value: model.t("profile.coins", model.wallet.total)) { WalletView() }
                    row("bookmark.fill", model.t("tab.mylist"),
                        value: "\(model.myListSeries.count)") { MyListView() }
                    row("doc.text.fill", model.t("profile.invoices")) { InvoicesView() }
                    row("gearshape.fill", model.t("settings.title")) { SettingsView() }
                    row("questionmark.circle.fill", model.t("settings.help")) { HelpView() }
                    actionRow("lightbulb.fill", model.t("profile.replayTips")) {
                        model.coachReplayToken += 1
                    }
                }
                .background(Katha.Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))

                if model.isSignedIn {
                    Button(model.t("profile.signOut")) { Task { await model.signOut() } }
                        .kathaFont(15)
                        .foregroundStyle(Katha.Color.danger)
                        .frame(maxWidth: .infinity)
                }

                Text(model.t("profile.version", Self.versionString))
                    .kathaFont(11)
                    .foregroundStyle(Katha.Color.text2)
                    .frame(maxWidth: .infinity)
            }
            .padding(Katha.Spacing.lg)
        }
        .background(Katha.Color.bg)
        .navigationTitle(model.t("profile.title"))
        // Popping back from Settings otherwise left the root wearing the small
        // inline title it had collapsed to on the way out.
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .sheet(isPresented: $showLogin) { LoginSheet().environment(model) }
    }

    /// The real bundle version — "(dev)" is a DEBUG marker, not part of the
    /// number, so a Release build no longer claims to be a dev build.
    private static var versionString: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        let build = info?["CFBundleVersion"] as? String
        #if DEBUG
        return build.map { "\(short) (\($0), dev)" } ?? "\(short) (dev)"
        #else
        return build.map { "\(short) (\($0))" } ?? short
        #endif
    }

    /// Members see their identity; guests see exactly what an account protects.
    private var identityCard: some View {
        HStack(spacing: Katha.Spacing.md) {
            ZStack {
                Circle().fill(Katha.Color.accent.opacity(0.2)).frame(width: avatar, height: avatar)
                Text(model.isSignedIn ? String((model.profile?.displayName.first ?? "K")) : "👋")
                    .kathaFont(22, weight: .bold)
                    .foregroundStyle(Katha.Color.accent)
            }
            VStack(alignment: .leading, spacing: 3) {
                if model.isSignedIn {
                    Text(model.profile?.displayName.isEmpty == false
                         ? model.profile!.displayName : model.t("profile.member"))
                        .kathaFont(17, weight: .semibold)
                        .foregroundStyle(Katha.Color.text)
                    Text(masked(model.profile?.phone))
                        .kathaFont(13)
                        .foregroundStyle(Katha.Color.text2)
                } else {
                    Text(model.t("profile.guest.title"))
                        .kathaFont(16, weight: .semibold)
                        .foregroundStyle(Katha.Color.text)
                    Text(model.t("profile.guest.body"))
                        .kathaFont(12)
                        .foregroundStyle(Katha.Color.text2)
                }
            }
            Spacer()
            if !model.isSignedIn {
                Button(model.t("profile.signIn")) { showLogin = true }
                    .kathaFont(14, weight: .semibold)
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 14)
                    .kathaFrame(height: 34)
                    .background(Katha.Color.accent)
                    .clipShape(Capsule())
            }
        }
        .padding(Katha.Spacing.lg)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
    }

    private func masked(_ phone: String?) -> String {
        guard let phone, phone.count > 4 else { return model.t("profile.signedIn") }
        return String(phone.prefix(phone.count - 4)).replacingOccurrences(
            of: "[0-9]", with: "•", options: .regularExpression) + phone.suffix(4)
    }

    private func row<D: View>(_ icon: String, _ title: String, value: String = "",
                              @ViewBuilder destination: @escaping () -> D) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: Katha.Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Katha.Color.accent.opacity(0.16))
                        .frame(width: iconTile, height: iconTile)
                    Image(systemName: icon)
                        .kathaFont(14, weight: .semibold)
                        .foregroundStyle(Katha.Color.accent)
                }
                Text(title)
                    .kathaFont(15)
                    .foregroundStyle(Katha.Color.text)
                Spacer(minLength: Katha.Spacing.sm)
                Text(value)
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.text2)
                Image(systemName: "chevron.right")
                    .kathaFont(12)
                    .foregroundStyle(Katha.Color.text2)
            }
            .padding(.horizontal, Katha.Spacing.lg)
            .frame(minHeight: rowHeight)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }

    /// A tappable row that runs an action in place (no navigation), matching the
    /// look of `row` minus the disclosure chevron.
    private func actionRow(_ icon: String, _ title: String,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Katha.Spacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Katha.Color.accent.opacity(0.16))
                        .frame(width: iconTile, height: iconTile)
                    Image(systemName: icon)
                        .kathaFont(14, weight: .semibold)
                        .foregroundStyle(Katha.Color.accent)
                }
                Text(title)
                    .kathaFont(15)
                    .foregroundStyle(Katha.Color.text)
                Spacer(minLength: Katha.Spacing.sm)
                // Not a chevron: this row acts in place rather than pushing a
                // screen, and the glyph is what says so.
                Image(systemName: "arrow.counterclockwise")
                    .kathaFont(12, weight: .semibold)
                    .foregroundStyle(Katha.Color.text2)
            }
            .padding(.horizontal, Katha.Spacing.lg)
            .frame(minHeight: rowHeight)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }
}

// MARK: - 4.2 Settings

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var pinSheetMode: PinSheetMode?
    @State private var showDelete = false
    @State private var toast: String?
    @State private var signingOutOthers = false

    var body: some View {
        @Bindable var model = model
        List {
            Section {
                Picker(model.t("settings.contentLanguage"), selection: $model.contentLanguage) {
                    Text("हिन्दी").tag("hi")
                    Text("தமிழ்").tag("ta")
                    Text("తెలుగు").tag("te")
                }
                .onChange(of: model.contentLanguage) { _, lang in
                    Task { await model.loadHome(lang: lang) }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text(model.t("settings.appLanguage"))
                    // Segmented, not a pushed list: one glance, one tap, and the
                    // whole chrome re-renders in place.
                    Picker(model.t("settings.appLanguage"),
                           selection: Binding(get: { model.uiLanguage },
                                              set: { model.setUILanguage($0) })) {
                        ForEach(L10n.supported, id: \.code) { opt in
                            Text(opt.native).tag(opt.code)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("settings.appLanguage")
                }
            } header: { Text(model.t("settings.language")) } footer: {
                Text(model.t("settings.appLanguage.footer"))
            }
            Section {
                Toggle(model.t("settings.dataSaver"), isOn: $model.dataSaver)
                Toggle(model.t("settings.autoUnlock"), isOn: $model.autoUnlock)
                Toggle(isOn: $model.previewsMuted) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.t("settings.previews"))
                        Text(model.t("settings.previews.caption"))
                            .kathaFont(12)
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
            } header: { Text(model.t("settings.playback")) } footer: {
                Text(model.t("settings.playback.footer"))
            }
            Section {
                Toggle(model.t("settings.alerts"), isOn: $model.episodeAlerts)
                    .onChange(of: model.episodeAlerts) { _, on in
                        if on { model.promoteNotificationAuth() }
                    }
            } header: { Text(model.t("settings.notifications")) } footer: {
                Text(model.t("settings.alerts.footer"))
            }
            Section {
                Button(model.parentalLockSet ? model.t("settings.parental.change")
                                             : model.t("settings.parental.set")) {
                    pinSheetMode = .set
                }
                if model.parentalLockSet {
                    Button(model.t("settings.parental.remove"), role: .destructive) {
                        pinSheetMode = .remove
                    }
                }
            } header: { Text(model.t("settings.parental")) } footer: {
                Text(model.t("settings.parental.footer"))
            }
            if model.isSignedIn {
                Section(model.t("settings.account")) {
                    Button(model.t("settings.signOutDevices")) {
                        guard !signingOutOthers else { return }
                        signingOutOthers = true
                        Task {
                            if await model.signOutOtherDevices() {
                                Haptics.success()
                                toast = model.t("settings.signOutDevices.done")
                            }
                            signingOutOthers = false
                        }
                    }
                    .disabled(signingOutOthers)
                }
            }
            Section(model.t("settings.about")) {
                NavigationLink(model.t("settings.help")) { HelpView() }
                Link(model.t("settings.legal"), destination: URL(string: "https://katha.example/legal")!)
                Button(model.t("settings.delete"), role: .destructive) { showDelete = true }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Katha.Color.bg)
        .navigationTitle(model.t("settings.title"))
        .sheet(item: $pinSheetMode) { mode in
            PinSetupSheet(mode: mode) { toast = $0 }
        }
        .sheet(isPresented: $showDelete) {
            DeleteAccountSheet()
        }
        .overlay(alignment: .bottom) {
            if let toast {
                ToastView(text: toast)
                    .padding(.bottom, 30)
                    .task { try? await Task.sleep(for: .seconds(2)); self.toast = nil }
                    .transition(.opacity)
            }
        }
        .animation(Katha.Motion.spring, value: toast)
    }
}

// MARK: - 4.3 Parental lock

enum PinSheetMode: String, Identifiable {
    case set, remove
    var id: String { rawValue }
}

/// Set / change / remove the PIN. An existing lock is verified first — the
/// current PIN is the only credential that can change or drop it.
struct PinSetupSheet: View {
    let mode: PinSheetMode
    /// A one-line confirmation for the host to toast (e.g. after a PIN reset).
    var onToast: ((String) -> Void)? = nil
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private enum Step { case current, new, confirm }
    @State private var step: Step
    @State private var pin = ""
    @State private var current: String?
    @State private var firstNew = ""
    @State private var message: String?
    @State private var lockedFor = 0
    @State private var showForgot = false

    init(mode: PinSheetMode, onToast: ((String) -> Void)? = nil) {
        self.mode = mode
        self.onToast = onToast
        // Existing lock → the current PIN comes first for change AND remove.
        _step = State(initialValue: .new)
    }

    private var title: String {
        switch (mode, step) {
        case (.remove, _): return "Remove parental lock"
        case (.set, .current): return "Enter your current PIN"
        case (.set, .new): return model.parentalLockSet ? "Choose a new PIN" : "Set a parental PIN"
        case (.set, .confirm): return "Confirm the new PIN"
        }
    }
    private var subtitle: String {
        if let message { return message }
        switch step {
        case .current: return "Asked before the lock can change."
        case .new: return "Asked before U/A 16+ and A-rated titles play."
        case .confirm: return "Enter the same 4 digits again."
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Katha.Spacing.lg) {
                Text(title)
                    .kathaFont(20, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                    .multilineTextAlignment(.center)
                Text(subtitle)
                    .kathaFont(13)
                    .foregroundStyle(message == nil ? Katha.Color.text2 : Katha.Color.danger)
                    .multilineTextAlignment(.center)
                PinDots(filled: pin.count)
                PinPad { digit in
                    guard lockedFor == 0 else { return }
                    if digit == -1 { if !pin.isEmpty { pin.removeLast() } }
                    else if pin.count < 4 {
                        pin.append(String(digit))
                        if pin.count == 4 { submit() }
                    }
                }
                .disabled(lockedFor > 0)
                .opacity(lockedFor > 0 ? 0.4 : 1)
                HStack(spacing: 24) {
                    // A swipe-down was the only exit; a keypad sheet needs a
                    // control that says so.
                    Button(model.t("action.cancel")) { dismiss() }
                        .foregroundStyle(Katha.Color.text2)
                        .accessibilityIdentifier("pin.cancel")
                    if step == .current {
                        Button(model.t("pin.forgot")) { showForgot = true }
                            .foregroundStyle(Katha.Color.accent)
                    }
                }
                .kathaFont(14)
            }
            .padding(Katha.Spacing.xl)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        // Half height, sized to the keypad — the sheet used to float in the
        // middle of a full-screen presentation with 45 % dead space.
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
        .sheet(isPresented: $showForgot) {
            ForgotPinSheet {
                // The lock is gone: nothing left to change or remove here.
                onToast?(model.t("pin.reset.done"))
                dismiss()
            }
        }
        .onAppear {
            if model.parentalLockSet { step = .current }
            lockedFor = model.parentalLock.lockoutRemaining
            if lockedFor > 0 { message = "Too many wrong PINs. Try again in \(lockedFor)s." }
        }
        .task(id: lockedFor) {
            guard lockedFor > 0 else { return }
            try? await Task.sleep(for: .seconds(1))
            lockedFor = model.parentalLock.lockoutRemaining
            if lockedFor == 0 { message = nil } else { message = "Too many wrong PINs. Try again in \(lockedFor)s." }
        }
    }

    private func submit() {
        let entered = pin
        pin = ""
        switch step {
        case .current:
            switch model.parentalLock.verify(entered) {
            case .ok:
                current = entered
                message = nil
                if mode == .remove {
                    model.removeParentalPin(current: entered)
                    Haptics.success()
                    dismiss()
                } else {
                    step = .new
                }
            case .wrong(let left):
                Haptics.warning()
                message = "Wrong PIN. \(left) attempt\(left == 1 ? "" : "s") left."
            case .lockedOut(let seconds):
                Haptics.warning()
                lockedFor = seconds
                message = "Too many wrong PINs. Try again in \(seconds)s."
            }
        case .new:
            firstNew = entered
            message = nil
            step = .confirm
        case .confirm:
            guard entered == firstNew else {
                Haptics.warning()
                message = "The PINs didn't match. Start again."
                step = .new
                return
            }
            if model.setParentalPin(entered, current: current) {
                Haptics.success()
                dismiss()
            } else {
                message = "Couldn't change the lock. Enter the current PIN again."
                step = .current
            }
        }
    }
}

/// The in-player gate for rated titles.
struct PinGateView: View {
    let onSuccess: () -> Void
    var onToast: ((String) -> Void)? = nil
    @Environment(AppModel.self) private var model
    @State private var pin = ""
    @State private var message: String?
    @State private var lockedFor = 0
    @State private var showForgot = false

    var body: some View {
        VStack(spacing: Katha.Spacing.lg) {
            Image(systemName: "lock.shield.fill")
                .kathaFont(40)
                .foregroundStyle(Katha.Color.accent)
            Text("Parental lock")
                .kathaFont(20, weight: .bold)
                .foregroundStyle(Katha.Color.text)
            Text(message ?? "This title is rated for older viewers.")
                .kathaFont(13)
                .foregroundStyle(message == nil ? Katha.Color.text2 : Katha.Color.danger)
                .multilineTextAlignment(.center)
            PinDots(filled: pin.count)
            PinPad { digit in
                guard lockedFor == 0 else { return }
                if digit == -1 { if !pin.isEmpty { pin.removeLast() } }
                else if pin.count < 4 {
                    pin.append(String(digit))
                    if pin.count == 4 {
                        let entered = pin
                        pin = ""
                        switch model.parentalLock.verify(entered) {
                        case .ok:
                            onSuccess()
                        case .wrong(let left):
                            Haptics.warning()
                            message = "Wrong PIN — \(left) attempt\(left == 1 ? "" : "s") left."
                        case .lockedOut(let seconds):
                            Haptics.warning()
                            lockedFor = seconds
                            message = "Too many wrong PINs. Try again in \(seconds)s."
                        }
                    }
                }
            }
            .disabled(lockedFor > 0)
            .opacity(lockedFor > 0 ? 0.4 : 1)
            // No "Go back": the navigation bar's back button already does
            // exactly that, and two controls for one action read as two doors.
            Button(model.t("pin.forgot")) { showForgot = true }
                .kathaFont(14)
                .foregroundStyle(Katha.Color.accent)
        }
        .padding(Katha.Spacing.xl)
        .sheet(isPresented: $showForgot) {
            ForgotPinSheet {
                onToast?(model.t("pin.reset.done"))
                onSuccess()
            }
        }
        .onAppear {
            lockedFor = model.parentalLock.lockoutRemaining
            if lockedFor > 0 { message = "Too many wrong PINs. Try again in \(lockedFor)s." }
        }
        .task(id: lockedFor) {
            guard lockedFor > 0 else { return }
            try? await Task.sleep(for: .seconds(1))
            lockedFor = model.parentalLock.lockoutRemaining
            if lockedFor == 0 { message = nil } else { message = "Too many wrong PINs. Try again in \(lockedFor)s." }
        }
    }
}

/// "Forgot PIN?" — recovery goes through phone verification, not email
/// (mockup 4.3). A code goes to the phone on the signed-in profile; entering
/// it re-verifies the session and drops the lock. Guests (and Apple-only
/// accounts with no phone) are told a phone sign-in is needed first.
struct ForgotPinSheet: View {
    /// Called once the lock has been removed.
    let onReset: () -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private enum Step { case intro, code }
    @State private var step: Step = .intro
    @State private var code = ""
    @State private var working = false
    @State private var error: String?
    @State private var showLogin = false

    private var phone: String? {
        guard model.isSignedIn, let p = model.profile?.phone, !p.isEmpty else { return nil }
        return p
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            Text(step == .intro ? model.t("pin.reset.title") : model.t("pin.reset.enter"))
                .kathaFont(22, weight: .bold)
                .foregroundStyle(Katha.Color.text)

            if let phone {
                if step == .intro {
                    Text(model.t("pin.reset.body"))
                        .kathaFont(15)
                        .foregroundStyle(Katha.Color.text2)
                    Text(masked(phone))
                        .kathaFont(15, weight: .semibold)
                        .foregroundStyle(Katha.Color.text)
                    KathaPrimaryButton(title: working ? "Sending…" : model.t("pin.reset.send"),
                                       enabled: !working) {
                        Task { await sendCode(to: phone) }
                    }
                } else {
                    Text("Sent by SMS to \(masked(phone)).")
                        .kathaFont(14)
                        .foregroundStyle(Katha.Color.text2)
                    TextField(model.t("otp.placeholder"), text: $code)
                        .keyboardType(.numberPad)
                        .kathaFont(28, weight: .semibold, monospacedDigit: true)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Katha.Color.text)
                        .kathaFrame(height: 56)
                        .background(Katha.Color.raised)
                        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
                        .accessibilityIdentifier("pin.reset.code")
                        .onChange(of: code) { _, new in
                            if new.count == 4 { Task { await verify(phone: phone) } }
                        }
                    KathaPrimaryButton(title: working ? "Verifying…" : "Verify",
                                       enabled: !working && code.count == 4) {
                        Task { await verify(phone: phone) }
                    }
                }
            } else {
                // No phone on this session: explain, and offer the sign-in.
                Text(model.t("pin.reset.guest"))
                    .kathaFont(15)
                    .foregroundStyle(Katha.Color.text2)
                KathaPrimaryButton(title: "Sign in with phone") { showLogin = true }
            }

            if let error {
                Text(error).kathaFont(13).foregroundStyle(Katha.Color.danger)
            }

            Button(model.t("action.notNow")) { dismiss() }
                .kathaFont(15)
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Katha.Spacing.xl)
        .padding(.top, Katha.Spacing.xl)      // clear of the system grabber
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
        .sheet(isPresented: $showLogin) { LoginSheet().environment(model) }
    }

    private func masked(_ phone: String) -> String {
        guard phone.count > 4 else { return phone }
        return String(phone.prefix(phone.count - 4)).replacingOccurrences(
            of: "[0-9]", with: "•", options: .regularExpression) + phone.suffix(4)
    }

    private func sendCode(to phone: String) async {
        working = true; defer { working = false }
        do {
            _ = try await model.api.requestOtp(phone: phone)
            error = nil
            step = .code
        } catch {
            self.error = "Couldn't send the code. Try again in a moment."
        }
    }

    private func verify(phone: String) async {
        working = true; defer { working = false }
        // A successful OTP re-verifies the account holder: that is the
        // credential the lock accepts instead of the forgotten PIN.
        if await model.signIn(phone: phone, code: code) {
            model.parentalLock.clearUnconditionally()
            model.parentalLockSet = false
            Haptics.success()
            dismiss()
            onReset()
        } else {
            code = ""
            error = "That code didn't work. Try again."
        }
    }
}

struct PinDots: View {
    let filled: Int
    var body: some View {
        HStack(spacing: 18) {
            ForEach(0..<4, id: \.self) { i in
                Circle()
                    .strokeBorder(Katha.Color.text2, lineWidth: 2)
                    .background(Circle().fill(i < filled ? Katha.Color.text : .clear))
                    .frame(width: 16, height: 16)
            }
        }
    }
}

struct PinPad: View {
    let onKey: (Int) -> Void
    private let rows: [[Int]] = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [-2, 0, -1]]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 10) {
                    ForEach(row, id: \.self) { key in
                        Button {
                            if key >= -1 { onKey(key) }
                        } label: {
                            Group {
                                if key == -1 { Image(systemName: "delete.left") }
                                else if key == -2 { Color.clear }
                                else { Text("\(key)") }
                            }
                            .kathaFont(22, weight: .medium)
                            .foregroundStyle(Katha.Color.text)
                            .frame(maxWidth: .infinity)
                            .kathaFrame(height: 48)
                            .background(key == -2 ? .clear : Katha.Color.raised)
                            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.sm))
                        }
                        .disabled(key == -2)
                    }
                }
            }
        }
        .frame(maxWidth: 280)
    }
}

// MARK: - 4.6 Help & grievance

struct HelpView: View {
    @Environment(AppModel.self) private var model
    private var faqs: [(q: String, a: String)] {
        [
        (model.t("help.faq.coins.q"), faqCoinsAnswer(model)),
        (model.t("help.faq.missing.q"), model.t("help.faq.missing.a")),
        (model.t("help.faq.refunds.q"), model.t("help.faq.refunds.a")),
        (model.t("help.faq.parental.q"), model.t("help.faq.parental.a")),
        ]
    }

    var body: some View {
        List {
            Section {
                // The assistant is the first door (mockup 4.6).
                NavigationLink {
                    HelpAssistantView()
                } label: {
                    HStack(spacing: Katha.Spacing.md) {
                        ZStack {
                            Circle().fill(Katha.Color.accent.opacity(0.16)).frame(width: 44, height: 44)
                            Image(systemName: "bubble.left.and.text.bubble.right.fill")
                                .kathaFont(18)
                                .foregroundStyle(Katha.Color.accent)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.t("assistant.title"))
                                .kathaFont(16, weight: .semibold)
                                .foregroundStyle(Katha.Color.text)
                            Text(model.t("assistant.card"))
                                .kathaFont(12)
                                .foregroundStyle(Katha.Color.text2)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .accessibilityIdentifier("help.assistant")
            }
            Section(model.t("help.common")) {
                ForEach(faqs, id: \.q) { faq in
                    DisclosureGroup(faq.q) {
                        Text(faq.a)
                            .kathaFont(13)
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
            }
            GrievanceFormSection()

            Section {
                Link("help@katha.example", destination: URL(string: "mailto:help@katha.example")!)
                Link("grievance@katha.example", destination: URL(string: "mailto:grievance@katha.example")!)
            } header: { Text(model.t("help.contact")) } footer: {
                Text(model.t("help.contact.footer"))
            }
        }
        .scrollContentBackground(.hidden)
        .background(Katha.Color.bg)
        .navigationTitle(model.t("settings.help"))
    }
}

/// The IT-Rules grievance form (contact + subject → ticket id + SLA), shared
/// by the Help screen and the assistant's "Talk to a person".
struct GrievanceFormSection: View {
    @Environment(AppModel.self) private var model
    @State private var gContact = ""
    @State private var gSubject = ""
    @State private var gAck: GrievanceAck?
    @State private var gBusy = false
    @State private var gError = false

    var body: some View {
        Section {
            TextField(model.t("help.grievance.contact"), text: $gContact)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
            TextField(model.t("help.grievance.subject"), text: $gSubject)
            if let ack = gAck {
                Text(model.t("help.grievance.ack", ack.id))
                    .kathaFont(13)
                    .foregroundStyle(Katha.Color.success)
            } else {
                Button(model.t(gBusy ? "help.grievance.filing" : "help.grievance.file")) {
                    gBusy = true
                    gError = false
                    Task {
                        gAck = try? await model.api.fileGrievance(
                            contact: gContact.trimmingCharacters(in: .whitespaces),
                            subject: gSubject.trimmingCharacters(in: .whitespaces),
                            body: "")
                        gBusy = false
                        if gAck == nil { gError = true }
                    }
                }
                .disabled(gBusy || gContact.trimmingCharacters(in: .whitespaces).isEmpty
                          || gSubject.trimmingCharacters(in: .whitespaces).isEmpty)
                .foregroundStyle(Katha.Color.accent)
                if gError {
                    Text(model.t("help.grievance.error"))
                        .kathaFont(13)
                        .foregroundStyle(Katha.Color.text2)
                }
            }
        } header: { Text(model.t("help.grievance.header")) } footer: {
            Text(model.t("help.grievance.footer"))
        }
    }
}

// MARK: - 4.7 Delete account

struct DeleteAccountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var understood = false
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            Text(model.t("delete.title"))
                .kathaFont(22, weight: .bold)
                .foregroundStyle(Katha.Color.text)

            VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                bullet("trash", model.t("delete.coins"))
                bullet("clock", model.t("delete.data"))
                bullet("creditcard", model.t("delete.apple"))
            }

            Toggle(isOn: $understood) {
                Text(model.t("delete.understood"))
                    .kathaFont(14)
                    .foregroundStyle(Katha.Color.text)
            }
            .tint(Katha.Color.danger)

            Button {
                Task {
                    working = true
                    await model.deleteAccount()
                    working = false
                    dismiss()
                }
            } label: {
                Text(model.t(working ? "delete.deleting" : "delete.confirm"))
                    .kathaFont(16, weight: .semibold)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(understood ? Katha.Color.danger : Katha.Color.raised)
                    .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md))
            }
            .disabled(!understood || working)

            Button(model.t("delete.keep")) { dismiss() }
                .kathaFont(15)
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
        }
        .padding(Katha.Spacing.xl)
        .frame(maxHeight: .infinity, alignment: .top)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .frame(width: 20)
                .foregroundStyle(Katha.Color.text2)
            Text(text)
                .kathaFont(14)
                .foregroundStyle(Katha.Color.text2)
        }
    }
}


/// FAQ copy renders the SERVER's pricing profile, never a baked-in number.
@MainActor func faqCoinsAnswer(_ model: AppModel) -> String {
    guard let free = model.freeEpisodesDefault, let price = model.appConfig?.episodeCoinPrice else {
        return model.t("help.faq.coins.a.plain")
    }
    let rupee = model.rupeeRate.map { " (about ₹\(rupees(price, rate: $0)))" } ?? ""
    return model.t("help.faq.coins.a", free, price, rupee)
}


// MARK: - Invoices (web/UPI purchases; GST breakdown from the server)

struct InvoicesView: View {
    @Environment(AppModel.self) private var model
    @State private var invoices: [Invoice]?

    var body: some View {
        Group {
            if let invoices {
                if invoices.isEmpty {
                    VStack(spacing: Katha.Spacing.sm) {
                        Image(systemName: "doc.text")
                            .kathaFont(34)
                            .foregroundStyle(Katha.Color.text2)
                        Text(model.t("invoices.empty.title"))
                            .kathaFont(16, weight: .semibold)
                            .foregroundStyle(Katha.Color.text)
                        Text(model.t("invoices.empty.body"))
                            .kathaFont(13)
                            .foregroundStyle(Katha.Color.text2)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(invoices) { inv in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(inv.id)
                                    .kathaFont(13, weight: .semibold)
                                    .foregroundStyle(Katha.Color.text)
                                Spacer()
                                Text(paise(inv.totalMinor))
                                    .kathaFont(15, weight: .bold)
                                    .foregroundStyle(Katha.Color.text)
                            }
                            Text("\(inv.coins) coins" +
                                 (inv.bonusCoins > 0 ? " + \(inv.bonusCoins) bonus" : ""))
                                .kathaFont(13)
                                .foregroundStyle(Katha.Color.text2)
                            Text("Taxable \(paise(inv.taxableMinor)) · GST @\(inv.gstRatePct)% \(paise(inv.gstMinor)) · \(String(inv.createdAt.prefix(10)))")
                                .kathaFont(12)
                                .foregroundStyle(Katha.Color.text2)
                        }
                        .listRowBackground(Katha.Color.surface)
                    }
                    .scrollContentBackground(.hidden)
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Katha.Color.bg)
        .navigationTitle(model.t("profile.invoices"))
        .task { invoices = (try? await model.api.myInvoices())?.invoices ?? [] }
    }

    private func paise(_ minor: Int) -> String {
        "₹\(minor / 100).\(String(format: "%02d", minor % 100))"
    }
}
