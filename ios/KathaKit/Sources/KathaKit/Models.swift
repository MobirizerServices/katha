import Foundation

// Codable models mirroring contracts/openapi/core-api.json. The client decodes
// server JSON into these; the app never computes prices or entitlements itself
// (the ledger is the source of truth — PDD principle 7).

public struct SeriesSummary: Codable, Hashable, Identifiable, Sendable {
    public let slug: String
    public let title: String
    public let genres: [String]
    public let episodeCount: Int
    public let primaryLanguage: String

    public var id: String { slug }

    enum CodingKeys: String, CodingKey {
        case slug, title, genres
        case episodeCount = "episode_count"
        case primaryLanguage = "primary_language"
    }

    public init(slug: String, title: String, genres: [String], episodeCount: Int, primaryLanguage: String) {
        self.slug = slug; self.title = title; self.genres = genres
        self.episodeCount = episodeCount; self.primaryLanguage = primaryLanguage
    }
}

public struct Episode: Codable, Hashable, Identifiable, Sendable {
    public let number: Int
    public let title: String
    public let isFree: Bool
    public let coinPrice: Int

    public var id: Int { number }

    enum CodingKeys: String, CodingKey {
        case number, title
        case isFree = "is_free"
        case coinPrice = "coin_price"
    }

    public init(number: Int, title: String, isFree: Bool, coinPrice: Int) {
        self.number = number; self.title = title; self.isFree = isFree; self.coinPrice = coinPrice
    }
}

public struct SeriesDetail: Codable, Hashable, Identifiable, Sendable {
    public let slug: String
    public let title: String
    public let genres: [String]
    public let episodeCount: Int
    public let primaryLanguage: String
    public let synopsis: String
    public let tropes: [String]
    public let freeEpisodeCount: Int
    public let episodeCoinPrice: Int
    public let bundleDiscountPct: Int
    public let episodes: [Episode]

    public var id: String { slug }

    enum CodingKeys: String, CodingKey {
        case slug, title, genres, synopsis, tropes, episodes
        case episodeCount = "episode_count"
        case primaryLanguage = "primary_language"
        case freeEpisodeCount = "free_episode_count"
        case episodeCoinPrice = "episode_coin_price"
        case bundleDiscountPct = "bundle_discount_pct"
    }

    public init(slug: String, title: String, genres: [String], episodeCount: Int,
                primaryLanguage: String, synopsis: String, tropes: [String],
                freeEpisodeCount: Int, episodeCoinPrice: Int, bundleDiscountPct: Int,
                episodes: [Episode]) {
        self.slug = slug; self.title = title; self.genres = genres
        self.episodeCount = episodeCount; self.primaryLanguage = primaryLanguage
        self.synopsis = synopsis; self.tropes = tropes
        self.freeEpisodeCount = freeEpisodeCount; self.episodeCoinPrice = episodeCoinPrice
        self.bundleDiscountPct = bundleDiscountPct; self.episodes = episodes
    }

    // Custom decoding to tolerate the optional `tropes` field (defaults to []).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        title = try c.decode(String.self, forKey: .title)
        genres = try c.decode([String].self, forKey: .genres)
        episodeCount = try c.decode(Int.self, forKey: .episodeCount)
        primaryLanguage = try c.decode(String.self, forKey: .primaryLanguage)
        synopsis = try c.decode(String.self, forKey: .synopsis)
        tropes = try c.decodeIfPresent([String].self, forKey: .tropes) ?? []
        freeEpisodeCount = try c.decode(Int.self, forKey: .freeEpisodeCount)
        episodeCoinPrice = try c.decode(Int.self, forKey: .episodeCoinPrice)
        bundleDiscountPct = try c.decode(Int.self, forKey: .bundleDiscountPct)
        episodes = try c.decode([Episode].self, forKey: .episodes)
    }
}

public struct HomeRow: Codable, Hashable, Identifiable, Sendable {
    public let title: String
    public let series: [SeriesSummary]
    public var id: String { title }

    public init(title: String, series: [SeriesSummary]) {
        self.title = title; self.series = series
    }
}

public struct HomeResponse: Codable, Hashable, Sendable {
    public let rows: [HomeRow]
    public init(rows: [HomeRow]) { self.rows = rows }
}

public struct Wallet: Codable, Hashable, Sendable {
    public let balanceBought: Int
    public let balanceBonus: Int
    public let total: Int

    enum CodingKeys: String, CodingKey {
        case balanceBought = "balance_bought"
        case balanceBonus = "balance_bonus"
        case total
    }

    public init(balanceBought: Int, balanceBonus: Int, total: Int) {
        self.balanceBought = balanceBought; self.balanceBonus = balanceBonus; self.total = total
    }
}

public struct CoinPack: Codable, Hashable, Identifiable, Sendable {
    public let sku: String
    public let storefront: String
    public let priceMinor: Int
    public let currency: String
    public let coins: Int
    public let bonusCoins: Int

    public var id: String { sku }
    /// Total coins granted including any bonus.
    public var totalCoins: Int { coins + bonusCoins }
    /// Major-unit price (₹) for display.
    public var priceMajor: Double { Double(priceMinor) / 100.0 }

    enum CodingKeys: String, CodingKey {
        case sku, storefront, currency, coins
        case priceMinor = "price_minor"
        case bonusCoins = "bonus_coins"
    }

    public init(sku: String, storefront: String, priceMinor: Int, currency: String,
                coins: Int, bonusCoins: Int = 0) {
        self.sku = sku; self.storefront = storefront; self.priceMinor = priceMinor
        self.currency = currency; self.coins = coins; self.bonusCoins = bonusCoins
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sku = try c.decode(String.self, forKey: .sku)
        storefront = try c.decode(String.self, forKey: .storefront)
        priceMinor = try c.decode(Int.self, forKey: .priceMinor)
        currency = try c.decode(String.self, forKey: .currency)
        coins = try c.decode(Int.self, forKey: .coins)
        bonusCoins = try c.decodeIfPresent(Int.self, forKey: .bonusCoins) ?? 0
    }
}

/// Playback is polymorphic: the server returns 200 with either an entitled
/// payload (hls url) or a `locked` payload (price + balance + bundle offer).
public struct PlaybackResponse: Codable, Hashable, Sendable {
    public let locked: Bool
    public let episodeId: String

    // Entitled fields
    public let hlsMasterUrl: String?
    public let resumePositionMs: Int?

    // Locked fields
    public let priceCoins: Int?
    public let balance: Int?
    public let bundleOfferCoins: Int?

    public var isEntitled: Bool { !locked }

    enum CodingKeys: String, CodingKey {
        case locked
        case episodeId = "episode_id"
        case hlsMasterUrl = "hls_master_url"
        case resumePositionMs = "resume_position_ms"
        case priceCoins = "price_coins"
        case balance
        case bundleOfferCoins = "bundle_offer_coins"
    }

    public init(locked: Bool, episodeId: String, hlsMasterUrl: String? = nil,
                resumePositionMs: Int? = nil, priceCoins: Int? = nil,
                balance: Int? = nil, bundleOfferCoins: Int? = nil) {
        self.locked = locked; self.episodeId = episodeId
        self.hlsMasterUrl = hlsMasterUrl; self.resumePositionMs = resumePositionMs
        self.priceCoins = priceCoins; self.balance = balance; self.bundleOfferCoins = bundleOfferCoins
    }
}

public struct UnlockResult: Codable, Hashable, Sendable {
    public let episodeIds: [String]
    public let spentBonus: Int
    public let spentBought: Int
    public let wallet: Wallet

    enum CodingKeys: String, CodingKey {
        case episodeIds = "episode_ids"
        case spentBonus = "spent_bonus"
        case spentBought = "spent_bought"
        case wallet
    }

    public init(episodeIds: [String], spentBonus: Int, spentBought: Int, wallet: Wallet) {
        self.episodeIds = episodeIds; self.spentBonus = spentBonus
        self.spentBought = spentBought; self.wallet = wallet
    }
}
