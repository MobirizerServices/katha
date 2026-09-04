import CryptoKit
import Foundation

/// The parental PIN (IT Rules 2021 gate for U/A 16+ and A titles).
///
/// Stored as a salted SHA-256 digest in the Keychain — never the digits, never
/// in UserDefaults. Wrong attempts are counted and, after five, every further
/// try is refused for an exponentially growing lockout, so the 10,000-combo
/// space cannot be walked. Changing or removing the lock requires the current
/// PIN: the child the lock is meant to gate must not be able to switch it off
/// from Settings.
@MainActor
final class ParentalLock {
    private static let hashKey = "parental.pin.hash"
    private static let saltKey = "parental.pin.salt"
    private static let failKey = "parental.pin.failures"
    private static let untilKey = "parental.pin.lockedUntil"

    static let maxFreeAttempts = 5

    enum Verify: Equatable {
        case ok
        case wrong(attemptsLeft: Int)
        case lockedOut(seconds: Int)
    }

    private(set) var isSet: Bool

    init() {
        isSet = KeychainStore.get(Self.hashKey) != nil
    }

    /// Seconds until attempts are accepted again (0 when not locked out).
    var lockoutRemaining: Int {
        guard let raw = KeychainStore.get(Self.untilKey), let until = Double(raw) else { return 0 }
        return max(0, Int(until - Date().timeIntervalSince1970))
    }

    // MARK: Set / clear

    /// Store a new PIN. Requires the current one when a lock already exists.
    @discardableResult
    func set(_ pin: String, current: String? = nil) -> Bool {
        if isSet {
            guard let current, verify(current) == .ok else { return false }
        }
        var saltBytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, saltBytes.count, &saltBytes)
        let salt = Data(saltBytes).base64EncodedString()
        guard KeychainStore.set(salt, for: Self.saltKey),
              KeychainStore.set(Self.digest(pin, salt: salt), for: Self.hashKey) else {
            clearUnconditionally()          // never report a lock the next launch won't have
            return false
        }
        resetFailures()
        isSet = true
        return true
    }

    /// Remove the lock. Requires the current PIN.
    @discardableResult
    func clear(current: String) -> Bool {
        guard verify(current) == .ok else { return false }
        clearUnconditionally()
        return true
    }

    /// Test/reset hook only (KATHA_RESET): no PIN check.
    func clearUnconditionally() {
        for k in [Self.hashKey, Self.saltKey, Self.failKey, Self.untilKey] { KeychainStore.delete(k) }
        isSet = false
    }

    // MARK: Verify

    func verify(_ pin: String) -> Verify {
        guard isSet, let salt = KeychainStore.get(Self.saltKey),
              let stored = KeychainStore.get(Self.hashKey) else {
            return .wrong(attemptsLeft: 0)
        }
        let wait = lockoutRemaining
        if wait > 0 { return .lockedOut(seconds: wait) }

        if Self.constantTimeEqual(Self.digest(pin, salt: salt), stored) {
            resetFailures()
            return .ok
        }
        let failures = (Int(KeychainStore.get(Self.failKey) ?? "") ?? 0) + 1
        KeychainStore.set(String(failures), for: Self.failKey)
        if failures >= Self.maxFreeAttempts {
            // 30 s after the 5th miss, doubling each further miss, capped at an hour.
            let extra = min(failures - Self.maxFreeAttempts, 7)
            let seconds = min(30 * (1 << extra), 3600)
            KeychainStore.set(String(Date().timeIntervalSince1970 + Double(seconds)), for: Self.untilKey)
            return .lockedOut(seconds: seconds)
        }
        return .wrong(attemptsLeft: Self.maxFreeAttempts - failures)
    }

    // MARK: internals

    private func resetFailures() {
        KeychainStore.delete(Self.failKey)
        KeychainStore.delete(Self.untilKey)
    }

    private static func digest(_ pin: String, salt: String) -> String {
        let data = Data((salt + ":" + pin).utf8)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func constantTimeEqual(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }
}
