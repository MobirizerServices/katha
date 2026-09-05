import AuthenticationServices
import SwiftUI
import KathaKit

// Login (mockup 1.4/1.5) + the value-moment variant (5.2): guests are asked to
// sign in only when it protects something — first unlock, first purchase, saving
// a series. The sheet names what's at stake and returns the user where they were.

struct LoginSheet: View {
    /// One line of context for the value moment, e.g. "You're about to unlock E11."
    var context: String? = nil
    var onSignedIn: (() -> Void)? = nil

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var step: Step = .phone
    @State private var phone = ""
    @State private var code = ""
    @State private var working = false
    @State private var error: String?
    @State private var apple = AppleSignInCoordinator()
    private enum Step { case phone, otp }

    var body: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            switch step {
            case .phone: phoneStep
            case .otp: otpStep
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Katha.Spacing.xl)
        .padding(.top, Katha.Spacing.xl)      // clear of the system grabber
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .presentationBackground(Katha.Color.surface)
    }

    // MARK: 1.4 — phone first, Apple as the equal alternative, guest stays visible

    private var phoneStep: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Save your coins and your place")
                    .kathaFont(22, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                Text(context ?? "Log in to unlock episodes and keep watching on any device.")
                    .kathaFont(15)
                    .foregroundStyle(Katha.Color.text2)
            }

            // "+91" is a fixed prefix, not a value: keeping it out of the
            // field lets the placeholder say what to type in the space it left.
            HStack(spacing: 10) {
                Image(systemName: "phone.fill")
                    .foregroundStyle(Katha.Color.accent)
                Text("+91")
                    .kathaFont(16, weight: .semibold)
                    .foregroundStyle(Katha.Color.text2)
                TextField(model.t("login.phone.placeholder"), text: $phone)
                    .keyboardType(.phonePad)
                    .foregroundStyle(Katha.Color.text)
            }
            .padding(.horizontal, 14)
            .kathaFrame(height: 52)
            .background(Katha.Color.raised)
            .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))

            KathaPrimaryButton(title: working ? "Sending…" : "Get OTP",
                               enabled: !working && digits.count >= 10) {
                Task { await requestOtp() }
            }

            if let error {
                Text(error).kathaFont(13).foregroundStyle(Katha.Color.danger)
            }

            HStack {
                Rectangle().fill(Katha.Color.raised).frame(height: 1)
                Text("or").kathaFont(13).foregroundStyle(Katha.Color.text2)
                Rectangle().fill(Katha.Color.raised).frame(height: 1)
            }

            Button {
                Task { await appleSignIn() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "apple.logo")
                    Text("Sign in with Apple").kathaFont(16, weight: .semibold)
                }
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
            }

            Button("Not now") { dismiss() }
                .kathaFont(15)
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)

            Text("By continuing you agree to the Terms and the Privacy Notice. You must be 18 or older.")
                .kathaFont(11)
                .foregroundStyle(Katha.Color.text2)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: 1.5 — OTP entry

    private var otpStep: some View {
        VStack(alignment: .leading, spacing: Katha.Spacing.lg) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Enter the code")
                    .kathaFont(22, weight: .bold)
                    .foregroundStyle(Katha.Color.text)
                Text("Sent by SMS to \(e164).\(devOtpHint)")
                    .kathaFont(14)
                    .foregroundStyle(Katha.Color.text2)
            }

            TextField(model.t("otp.placeholder"), text: $code)
                .keyboardType(.numberPad)
                .kathaFont(28, weight: .semibold, monospacedDigit: true)
                .multilineTextAlignment(.center)
                .foregroundStyle(Katha.Color.text)
                .kathaFrame(height: 56)
                .background(Katha.Color.raised)
                .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.md, style: .continuous))
                .onChange(of: code) { _, new in
                    if new.count == 4 { Task { await verify() } }
                }

            KathaPrimaryButton(title: working ? "Verifying…" : "Verify",
                               enabled: !working && code.count == 4) {
                Task { await verify() }
            }

            if let error {
                Text(error).kathaFont(13).foregroundStyle(Katha.Color.danger)
            }

            HStack {
                Button("Change number") { step = .phone; code = ""; error = nil }
                Spacer()
                Button("Use Apple instead") { Task { await appleSignIn() } }
            }
            .kathaFont(14)
            .foregroundStyle(Katha.Color.text2)
        }
    }

    // MARK: actions

    /// Just the digits the viewer typed…
    private var digits: String { phone.filter(\.isNumber) }
    /// …and the number the server is asked about, prefix included.
    private var e164: String { "+91 " + digits }

    private func requestOtp() async {
        working = true; defer { working = false }
        do {
            _ = try await model.api.requestOtp(phone: e164)
            error = nil
            step = .otp
        } catch {
            self.error = "Couldn't send the code. Check the number and try again."
        }
    }

    private func verify() async {
        working = true; defer { working = false }
        if await model.signIn(phone: e164, code: code) {
            dismiss()
            onSignedIn?()
        } else {
            error = "That code didn't work. Try again."
        }
    }

    /// The OTP hint about the dev stub is compiled out of Release.
    private var devOtpHint: String {
        #if DEBUG
        return " Dev build: any 4 digits work."
        #else
        return ""
        #endif
    }

    private func appleSignIn() async {
        working = true; defer { working = false }
        let ok: Bool
        #if DEBUG
        if ProcessInfo.processInfo.environment["KATHA_FAKE_APPLE"] == "1" {
            // XCUITest harness on simulators without an Apple ID: the server's
            // dev stub accepts this token. Compiled out of Release.
            ok = await model.signInWithApple(identityToken: "dev-apple-token")
            finish(ok); return
        }
        #endif
        do {
            let r = try await apple.signIn()
            ok = await model.signInWithApple(identityToken: r.token, fullName: r.name)
        } catch let e as ASAuthorizationError where e.code == .canceled {
            return
        } catch {
            ok = false
        }
        finish(ok)
    }

    private func finish(_ ok: Bool) {
        if ok {
            dismiss()
            onSignedIn?()
        } else {
            error = "Apple sign-in didn't go through. Try again or use your phone number."
        }
    }
}
