import Foundation
import Security

/// The one place secrets live on the device. The session bearer authorises
/// unlocks, purchases and account deletion for 30 days, so it is kept in the
/// Keychain (this-device-only, available after first unlock so background
/// refreshes work) — never in UserDefaults, which ships in unencrypted backups
/// and is readable by anything that can see the app container.
enum KeychainStore {
    private static let service = "dev.katha.app"

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// `nil` deletes. Writes replace: a stale value is never left behind.
    /// Returns false when the item could NOT be stored — callers must not
    /// pretend a secret exists that the next launch will not find.
    @discardableResult
    static func set(_ value: String?, for key: String) -> Bool {
        delete(key)
        guard let value, let data = value.data(using: .utf8) else { return true }
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(item as CFDictionary, nil)
        if status != errSecSuccess {
            // -34018 (errSecMissingEntitlement) is what an UNSIGNED build gets:
            // the keychain needs an application identifier, so simulator builds
            // must be signed to run locally (see generate_xcodeproj.rb).
            print("KeychainStore: SecItemAdd(\(key)) failed with \(status)")
            return false
        }
        return true
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
