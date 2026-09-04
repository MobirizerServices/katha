import AuthenticationServices
import UIKit

enum AppleSignInError: Error { case noIdentityToken }

/// Sign in with Apple through ASAuthorizationController: the server verifies
/// the returned identity token against Apple's keys and identifies the person
/// by its stable `sub`, so every sign-in lands in the same account.
final class AppleSignInCoordinator: NSObject, ASAuthorizationControllerDelegate,
                                    ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<(token: String, name: String?), Error>?

    func signIn() async throws -> (token: String, name: String?) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        return try await withCheckedThrowingContinuation { c in
            continuation = c
            controller.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = cred.identityToken, let token = String(data: data, encoding: .utf8) else {
            continuation?.resume(throwing: AppleSignInError.noIdentityToken)
            continuation = nil
            return
        }
        // Apple hands the name over on the FIRST sign-in only; the server keeps it.
        let name = [cred.fullName?.givenName, cred.fullName?.familyName]
            .compactMap { $0 }.joined(separator: " ")
        continuation?.resume(returning: (token, name.isEmpty ? nil : name))
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}
