import SwiftUI
import KathaKit

// Account section (mockup §4): Profile (member/guest), Settings, Parental lock,
// Help & grievance, Delete account.

// MARK: - 4.1 Profile

struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @State private var showLogin = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Katha.Spacing.xl) {
                identityCard

                VStack(spacing: 0) {
                    row("creditcard.fill", "Wallet",
                        value: "\(model.wallet.total) coins") { WalletView() }
                    row("bookmark.fill", "My list",
                        value: "\(model.myListSeries.count)") { MyListView() }
                    row("doc.text.fill", "Invoices") { InvoicesView() }
                    row("gearshape.fill", "Settings") { SettingsView() }
                    row("questionmark.circle.fill", "Help & grievance") { HelpView() }
                    actionRow("lightbulb.fill", "Replay tips") { model.coachReplayToken += 1 }
                }
                .background(Katha.Color.surface)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))

                if model.isSignedIn {
                    Button("Sign out") { Task { await model.signOut() } }
                        .font(.system(size: 15))
                        .foregroundStyle(Katha.Color.danger)
                        .frame(maxWidth: .infinity)
                }

                Text("Version 1.0.0 (dev)")
                    .font(.system(size: 11))
                    .foregroundStyle(Katha.Color.text2)
                    .frame(maxWidth: .infinity)
            }
            .padding(Katha.Spacing.lg)
        }
        .background(Katha.Color.bg)
        .navigationTitle("Profile")
        .toolbarBackground(Katha.Color.bg, for: .navigationBar)
        .sheet(isPresented: $showLogin) { LoginSheet().environment(model) }
    }

    /// Members see their identity; guests see exactly what an account protects.
    private var identityCard: some View {
        HStack(spacing: Katha.Spacing.md) {
            ZStack {
                Circle().fill(Katha.Color.accent.opacity(0.2)).frame(width: 52, height: 52)
                Text(model.isSignedIn ? String((model.profile?.displayName.first ?? "K")) : "👋")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Katha.Color.accent)
            }
            VStack(alignment: .leading, spacing: 3) {
                if model.isSignedIn {
                    Text(model.profile?.displayName.isEmpty == false
                         ? model.profile!.displayName : "Katha member")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Katha.Color.text)
                    Text(masked(model.profile?.phone))
                        .font(.system(size: 13))
                        .foregroundStyle(Katha.Color.text2)
                } else {
                    Text("You're browsing as a guest")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Katha.Color.text)
                    Text("Create an account to keep your coins and progress.")
                        .font(.system(size: 12))
                        .foregroundStyle(Katha.Color.text2)
                }
            }
            Spacer()
            if !model.isSignedIn {
                Button("Sign in") { showLogin = true }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(Katha.Color.accent)
                    .clipShape(Capsule())
            }
        }
        .padding(Katha.Spacing.lg)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
    }

    private func masked(_ phone: String?) -> String {
        guard let phone, phone.count > 4 else { return "Signed in" }
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
                        .frame(width: 30, height: 30)
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Katha.Color.accent)
                }
                Text(title)
                    .font(.system(size: 15))
                    .foregroundStyle(Katha.Color.text)
                Spacer()
                Text(value)
                    .font(.system(size: 13))
                    .foregroundStyle(Katha.Color.text2)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12))
                    .foregroundStyle(Katha.Color.text2)
            }
            .padding(.horizontal, Katha.Spacing.lg)
            .frame(height: 52)
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
                        .frame(width: 30, height: 30)
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Katha.Color.accent)
                }
                Text(title)
                    .font(.system(size: 15))
                    .foregroundStyle(Katha.Color.text)
                Spacer()
            }
            .padding(.horizontal, Katha.Spacing.lg)
            .frame(height: 52)
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

    var body: some View {
        @Bindable var model = model
        List {
            Section("Language") {
                Picker("Content language", selection: $model.contentLanguage) {
                    Text("हिन्दी").tag("hi")
                    Text("தமிழ்").tag("ta")
                    Text("తెలుగు").tag("te")
                }
                .onChange(of: model.contentLanguage) { _, lang in
                    Task { await model.loadHome(lang: lang) }
                }
            }
            Section {
                Toggle("Data saver", isOn: $model.dataSaver)
                Toggle("Auto-unlock next episodes", isOn: $model.autoUnlock)
            } header: { Text("Playback") } footer: {
                Text("Data saver caps streaming quality on mobile data. Auto-unlock charges coins only when an episode starts.")
            }
            Section {
                Toggle("New episode alerts", isOn: $model.episodeAlerts)
                    .onChange(of: model.episodeAlerts) { _, on in
                        if on { model.promoteNotificationAuth() }
                    }
            } header: { Text("Notifications") } footer: {
                Text("One alert when your next episode drops. Never between 11 pm and 8 am, at most two a day.")
            }
            Section {
                Button(model.parentalLockSet ? "Change parental lock" : "Set parental lock") {
                    pinSheetMode = .set
                }
                if model.parentalLockSet {
                    Button("Remove parental lock", role: .destructive) {
                        pinSheetMode = .remove
                    }
                }
            } header: { Text("Parental lock") } footer: {
                Text("A PIN is asked before playing U/A 16+ and A-rated titles (IT Rules 2021). "
                     + "Changing or removing the lock asks for the current PIN.")
            }
            Section("About") {
                NavigationLink("Help & grievance") { HelpView() }
                Link("Terms · Privacy Notice", destination: URL(string: "https://katha.example/legal")!)
                Button("Delete account", role: .destructive) { showDelete = true }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Katha.Color.bg)
        .navigationTitle("Settings")
        .sheet(item: $pinSheetMode) { mode in
            PinSetupSheet(mode: mode)
        }
        .sheet(isPresented: $showDelete) {
            DeleteAccountSheet()
        }
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
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private enum Step { case current, new, confirm }
    @State private var step: Step
    @State private var pin = ""
    @State private var current: String?
    @State private var firstNew = ""
    @State private var message: String?
    @State private var lockedFor = 0

    init(mode: PinSheetMode) {
        self.mode = mode
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
        VStack(spacing: Katha.Spacing.lg) {
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Katha.Color.text)
            Text(subtitle)
                .font(.system(size: 13))
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
        }
        .padding(Katha.Spacing.xl)
        .presentationDetents([.large])
        .presentationBackground(Katha.Color.surface)
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
    let onCancel: () -> Void
    @Environment(AppModel.self) private var model
    @State private var pin = ""
    @State private var message: String?
    @State private var lockedFor = 0

    var body: some View {
        VStack(spacing: Katha.Spacing.lg) {
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 40))
                .foregroundStyle(Katha.Color.accent)
            Text("Parental lock")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Katha.Color.text)
            Text(message ?? "This title is rated for older viewers.")
                .font(.system(size: 13))
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
            Button("Go back") { onCancel() }
                .font(.system(size: 14))
                .foregroundStyle(Katha.Color.text2)
        }
        .padding(Katha.Spacing.xl)
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
                            .font(.system(size: 22, weight: .medium))
                            .foregroundStyle(Katha.Color.text)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
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
    @State private var gContact = ""
    @State private var gSubject = ""
    @State private var gAck: GrievanceAck?
    @State private var gBusy = false
    @State private var gError = false
    private var faqs: [(q: String, a: String)] {
        [
        ("How do coins work?",
         faqCoinsAnswer(model)),
        ("I paid but didn't get my coins",
         "Pull to refresh your Wallet, then tap Restore purchases. If the coins still haven't landed within a few minutes, contact support — verified failed transactions are re-credited."),
        ("Refunds and cancellations",
         "App Store purchases are refunded by Apple under Apple's policy (reportaproblem.apple.com). Coins bought on the web are refundable within 7 days if unspent."),
        ("Parental controls",
         "Set a PIN in Settings → Parental lock. U/A 16+ and A-rated titles then require it before playing."),
        ]
    }

    var body: some View {
        List {
            Section("Common questions") {
                ForEach(faqs, id: \.q) { faq in
                    DisclosureGroup(faq.q) {
                        Text(faq.a)
                            .font(.system(size: 13))
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
            }
            Section {
                TextField("Your email or phone", text: $gContact)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                TextField("What went wrong?", text: $gSubject)
                if let ack = gAck {
                    Text("Filed as \(ack.id). We'll acknowledge within 24 hours and resolve within 15 days.")
                        .font(.system(size: 13))
                        .foregroundStyle(Katha.Color.success)
                } else {
                    Button(gBusy ? "Filing…" : "File grievance") {
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
                        Text("Couldn't file right now — email us below instead.")
                            .font(.system(size: 13))
                            .foregroundStyle(Katha.Color.text2)
                    }
                }
            } header: { Text("File a grievance") } footer: {
                Text("Goes straight to the grievance officer, no email needed.")
            }

            Section {
                Link("help@katha.example", destination: URL(string: "mailto:help@katha.example")!)
                Link("grievance@katha.example", destination: URL(string: "mailto:grievance@katha.example")!)
            } header: { Text("Contact") } footer: {
                Text("Complaints are acknowledged within 24 hours and resolved within 15 days, as required under the IT Rules, 2021. Support hours 9 am–9 pm IST.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Katha.Color.bg)
        .navigationTitle("Help & grievance")
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
            Text("Delete your account?")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Katha.Color.text)

            VStack(alignment: .leading, spacing: Katha.Spacing.sm) {
                bullet("trash", "Your coins and unlocked episodes are removed.")
                bullet("clock", "Your phone number and watch history are deleted within 30 days.")
                bullet("creditcard", "Purchases made through Apple follow Apple's refund policy.")
            }

            Toggle(isOn: $understood) {
                Text("I understand my coins won't be refunded.")
                    .font(.system(size: 14))
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
                Text(working ? "Deleting…" : "Delete account")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(understood ? Katha.Color.danger : Katha.Color.raised)
                    .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md))
            }
            .disabled(!understood || working)

            Button("Keep my account") { dismiss() }
                .font(.system(size: 15))
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
        }
        .padding(Katha.Spacing.xl)
        .presentationDetents([.medium])
        .presentationBackground(Katha.Color.surface)
    }

    private func bullet(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .frame(width: 20)
                .foregroundStyle(Katha.Color.text2)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Katha.Color.text2)
        }
    }
}


/// FAQ copy renders the SERVER's pricing profile, never a baked-in number.
@MainActor func faqCoinsAnswer(_ model: AppModel) -> String {
    let free = model.freeEpisodesDefault
    let price = model.appConfig?.episodeCoinPrice ?? 30
    return "The first \(free) episodes of every series are free. After that, " +
           "each episode costs \(price) coins (about ₹\(rupees(price, rate: model.rupeeRate))). " +
           "Buy packs once — coins never expire."
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
                            .font(.system(size: 34))
                            .foregroundStyle(Katha.Color.text2)
                        Text("No invoices yet")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Katha.Color.text)
                        Text("Coins bought on the Katha website (UPI) are invoiced here. App Store purchases are invoiced by Apple.")
                            .font(.system(size: 13))
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
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Katha.Color.text)
                                Spacer()
                                Text(paise(inv.totalMinor))
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(Katha.Color.text)
                            }
                            Text("\(inv.coins) coins" +
                                 (inv.bonusCoins > 0 ? " + \(inv.bonusCoins) bonus" : ""))
                                .font(.system(size: 13))
                                .foregroundStyle(Katha.Color.text2)
                            Text("Taxable \(paise(inv.taxableMinor)) · GST @\(inv.gstRatePct)% \(paise(inv.gstMinor)) · \(String(inv.createdAt.prefix(10)))")
                                .font(.system(size: 12))
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
        .navigationTitle("Invoices")
        .task { invoices = (try? await model.api.myInvoices())?.invoices ?? [] }
    }

    private func paise(_ minor: Int) -> String {
        "₹\(minor / 100).\(String(format: "%02d", minor % 100))"
    }
}
