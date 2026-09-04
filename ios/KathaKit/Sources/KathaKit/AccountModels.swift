import Foundation

// Codable models for identity + engagement (auth, profile, check-in, My List,
// continue-watching), mirroring core-api's response schemas.

public struct UserProfile: Codable, Hashable, Sendable {
    public let userId: String
    public let kind: String            // guest | phone | apple
    public let displayName: String
    public let language: String        // hi | ta | te  (content language)
    public let phone: String?
    /// App (UI) language: en | hi. Optional on the wire — servers before the
    /// setting existed omit it, and the app then reads "en".
    public let uiLanguage: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case kind
        case displayName = "display_name"
        case language, phone
        case uiLanguage = "ui_language"
    }

    public init(userId: String, kind: String, displayName: String = "",
                language: String = "hi", phone: String? = nil, uiLanguage: String = "en") {
        self.userId = userId; self.kind = kind; self.displayName = displayName
        self.language = language; self.phone = phone; self.uiLanguage = uiLanguage
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        kind = try c.decode(String.self, forKey: .kind)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? "hi"
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        uiLanguage = try c.decodeIfPresent(String.self, forKey: .uiLanguage) ?? "en"
    }
}

/// `GET/PUT/DELETE /v1/me/reminders[/{slug}]`: the series this account wants
/// new-episode reminders for.
public struct ReminderList: Codable, Hashable, Sendable {
    public let slugs: [String]

    public init(slugs: [String]) { self.slugs = slugs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slugs = try c.decodeIfPresent([String].self, forKey: .slugs) ?? []
    }

    enum CodingKeys: String, CodingKey { case slugs }
}

public struct AuthToken: Codable, Hashable, Sendable {
    public let accessToken: String
    public let user: UserProfile

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case user
    }

    public init(accessToken: String, user: UserProfile) {
        self.accessToken = accessToken; self.user = user
    }
}

public struct OtpRequest: Codable, Hashable, Sendable {
    public let requestId: String
    public let phone: String

    enum CodingKeys: String, CodingKey {
        case requestId = "request_id"
        case phone
    }

    public init(requestId: String, phone: String) {
        self.requestId = requestId; self.phone = phone
    }
}

public struct CheckinResult: Codable, Hashable, Sendable {
    public let grantedCoins: Int
    public let alreadyClaimed: Bool
    public let day: String
    public let wallet: Wallet

    enum CodingKeys: String, CodingKey {
        case grantedCoins = "granted_coins"
        case alreadyClaimed = "already_claimed"
        case day, wallet
    }

    public init(grantedCoins: Int, alreadyClaimed: Bool, day: String, wallet: Wallet) {
        self.grantedCoins = grantedCoins; self.alreadyClaimed = alreadyClaimed
        self.day = day; self.wallet = wallet
    }
}

public struct MyList: Codable, Hashable, Sendable {
    public let slugs: [String]
    public let series: [SeriesSummary]

    public init(slugs: [String], series: [SeriesSummary]) {
        self.slugs = slugs; self.series = series
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slugs = try c.decodeIfPresent([String].self, forKey: .slugs) ?? []
        series = try c.decodeIfPresent([SeriesSummary].self, forKey: .series) ?? []
    }

    enum CodingKeys: String, CodingKey { case slugs, series }
}

public struct ContinueItem: Codable, Hashable, Identifiable, Sendable {
    public let slug: String
    public let number: Int
    public let episodeId: String
    public let positionMs: Int
    public let durationMs: Int
    public let title: String
    public let percent: Int

    public var id: String { episodeId }

    enum CodingKeys: String, CodingKey {
        case slug, number, title, percent
        case episodeId = "episode_id"
        case positionMs = "position_ms"
        case durationMs = "duration_ms"
    }

    public init(slug: String, number: Int, episodeId: String, positionMs: Int,
                durationMs: Int, title: String = "", percent: Int = 0) {
        self.slug = slug; self.number = number; self.episodeId = episodeId
        self.positionMs = positionMs; self.durationMs = durationMs
        self.title = title; self.percent = percent
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        number = try c.decode(Int.self, forKey: .number)
        episodeId = try c.decode(String.self, forKey: .episodeId)
        positionMs = try c.decode(Int.self, forKey: .positionMs)
        durationMs = try c.decode(Int.self, forKey: .durationMs)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        percent = try c.decodeIfPresent(Int.self, forKey: .percent) ?? 0
    }
}

public struct ContinueList: Codable, Hashable, Sendable {
    public let items: [ContinueItem]
    public init(items: [ContinueItem]) { self.items = items }
}

/// One progress report from the player (media time, not wall clock).
public struct ProgressReport: Codable, Hashable, Sendable {
    public let slug: String
    public let number: Int
    public let positionMs: Int
    public let durationMs: Int
    /// The viewer scrubbed backwards: the server may move the resume point back.
    public let rewind: Bool

    enum CodingKeys: String, CodingKey {
        case slug, number, rewind
        case positionMs = "position_ms"
        case durationMs = "duration_ms"
    }

    public init(slug: String, number: Int, positionMs: Int, durationMs: Int, rewind: Bool = false) {
        self.rewind = rewind
        self.slug = slug; self.number = number
        self.positionMs = positionMs; self.durationMs = durationMs
    }
}

/// Decodes successfully from any JSON object — for endpoints whose body we
/// acknowledge but don't consume.
public struct Ack: Codable, Sendable {
    private enum CodingKeys: CodingKey {}
    public init() {}
    public init(from decoder: Decoder) throws {}
    public func encode(to encoder: Encoder) throws {
        _ = encoder.container(keyedBy: CodingKeys.self)   // encodes {}
    }
}

/// One row of the user's own coin-ledger history (newest first from the API).
public struct LedgerEntry: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let type: String            // purchase | bonus | checkin | unlock | ...
    public let amountBought: Int
    public let amountBonus: Int
    public let referenceType: String
    public let referenceId: String
    public let createdAt: String

    public var net: Int { amountBought + amountBonus }

    enum CodingKeys: String, CodingKey {
        case id, type
        case amountBought = "amount_bought"
        case amountBonus = "amount_bonus"
        case referenceType = "reference_type"
        case referenceId = "reference_id"
        case createdAt = "created_at"
    }

    public init(id: String, type: String, amountBought: Int, amountBonus: Int,
                referenceType: String, referenceId: String, createdAt: String) {
        self.id = id; self.type = type
        self.amountBought = amountBought; self.amountBonus = amountBonus
        self.referenceType = referenceType; self.referenceId = referenceId
        self.createdAt = createdAt
    }
}
