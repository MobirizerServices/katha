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
    static func set(_ value: String?, for key: String) {
        delete(key)
        guard let value, let data = value.data(using: .utf8) else { return }
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(item as CFDictionary, nil)
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
