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
    public let contentRating: String   // IT Rules self-classification, e.g. "U/A 16+"
    public let coverUrl: String        // 9:16 poster (absolute URL; empty when unset)
    public let coverWideUrl: String    // 16:9 billboard

    public var id: String { slug }

    enum CodingKeys: String, CodingKey {
        case slug, title, genres
        case episodeCount = "episode_count"
        case primaryLanguage = "primary_language"
        case contentRating = "content_rating"
        case coverUrl = "cover_url"
        case coverWideUrl = "cover_wide_url"
    }

    public init(slug: String, title: String, genres: [String], episodeCount: Int,
                primaryLanguage: String, contentRating: String = "",
                coverUrl: String = "", coverWideUrl: String = "") {
        self.slug = slug; self.title = title; self.genres = genres
        self.episodeCount = episodeCount; self.primaryLanguage = primaryLanguage
        self.contentRating = contentRating
        self.coverUrl = coverUrl; self.coverWideUrl = coverWideUrl
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        title = try c.decode(String.self, forKey: .title)
        genres = try c.decode([String].self, forKey: .genres)
        episodeCount = try c.decode(Int.self, forKey: .episodeCount)
        primaryLanguage = try c.decode(String.self, forKey: .primaryLanguage)
        contentRating = try c.decodeIfPresent(String.self, forKey: .contentRating) ?? ""
        coverUrl = try c.decodeIfPresent(String.self, forKey: .coverUrl) ?? ""
        coverWideUrl = try c.decodeIfPresent(String.self, forKey: .coverWideUrl) ?? ""
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
    public let contentRating: String   // IT Rules self-classification badge
    public let coverUrl: String
    public let coverWideUrl: String
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
        case contentRating = "content_rating"
        case coverUrl = "cover_url"
        case coverWideUrl = "cover_wide_url"
        case freeEpisodeCount = "free_episode_count"
        case episodeCoinPrice = "episode_coin_price"
        case bundleDiscountPct = "bundle_discount_pct"
    }

    public init(slug: String, title: String, genres: [String], episodeCount: Int,
                primaryLanguage: String, synopsis: String, tropes: [String],
                freeEpisodeCount: Int, episodeCoinPrice: Int, bundleDiscountPct: Int,
                episodes: [Episode], contentRating: String = "",
                coverUrl: String = "", coverWideUrl: String = "") {
        self.slug = slug; self.title = title; self.genres = genres
        self.episodeCount = episodeCount; self.primaryLanguage = primaryLanguage
        self.contentRating = contentRating
        self.coverUrl = coverUrl; self.coverWideUrl = coverWideUrl
        self.synopsis = synopsis; self.tropes = tropes
        self.freeEpisodeCount = freeEpisodeCount; self.episodeCoinPrice = episodeCoinPrice
        self.bundleDiscountPct = bundleDiscountPct; self.episodes = episodes
    }

    // Custom decoding to tolerate optional fields (tropes, content_rating).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        slug = try c.decode(String.self, forKey: .slug)
        title = try c.decode(String.self, forKey: .title)
        genres = try c.decode([String].self, forKey: .genres)
        episodeCount = try c.decode(Int.self, forKey: .episodeCount)
        primaryLanguage = try c.decode(String.self, forKey: .primaryLanguage)
        contentRating = try c.decodeIfPresent(String.self, forKey: .contentRating) ?? ""
        coverUrl = try c.decodeIfPresent(String.self, forKey: .coverUrl) ?? ""
        coverWideUrl = try c.decodeIfPresent(String.self, forKey: .coverWideUrl) ?? ""
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
    /// Episodes the viewer does not own yet — the set the bundle offer covers.
    public let remainingLocked: Int?
    /// Entitled: whether this episode is free (vs bought).
    public let free: Bool?

    public var isEntitled: Bool { !locked }

    enum CodingKeys: String, CodingKey {
        case locked
        case episodeId = "episode_id"
        case hlsMasterUrl = "hls_master_url"
        case resumePositionMs = "resume_position_ms"
        case priceCoins = "price_coins"
        case balance
        case bundleOfferCoins = "bundle_offer_coins"
        case remainingLocked = "remaining_locked"
        case free
    }

    public init(locked: Bool, episodeId: String, hlsMasterUrl: String? = nil,
                resumePositionMs: Int? = nil, priceCoins: Int? = nil,
                balance: Int? = nil, bundleOfferCoins: Int? = nil,
                remainingLocked: Int? = nil, free: Bool? = nil) {
        self.locked = locked; self.episodeId = episodeId
        self.hlsMasterUrl = hlsMasterUrl; self.resumePositionMs = resumePositionMs
        self.priceCoins = priceCoins; self.balance = balance; self.bundleOfferCoins = bundleOfferCoins
        self.remainingLocked = remainingLocked
        self.free = free
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

/// Remote config from `GET /v1/config` — the app renders THESE values and
/// never carries its own copies of business numbers (pricing, the coin→₹
/// rate, check-in reward, kill-switch flags). Edited in the back office;
/// live on the next fetch.
public struct AppConfig: Codable, Hashable, Sendable {
    public let minAppVersion: String
    public let freeEpisodeCount: Int
    public let episodeCoinPrice: Int
    public let bundleDiscountPct: Int
    public let coinRupeeRate: Double
    public let checkinCoins: Int
    public let flags: [String: Bool]
    public let experiments: [String: String]

    enum CodingKeys: String, CodingKey {
        case minAppVersion = "min_app_version"
        case freeEpisodeCount = "free_episode_count"
        case episodeCoinPrice = "episode_coin_price"
        case bundleDiscountPct = "bundle_discount_pct"
        case coinRupeeRate = "coin_rupee_rate"
        case checkinCoins = "checkin_coins"
        case flags
        case experiments
    }

    public init(minAppVersion: String, freeEpisodeCount: Int, episodeCoinPrice: Int,
                bundleDiscountPct: Int, coinRupeeRate: Double, checkinCoins: Int,
                flags: [String: Bool] = [:], experiments: [String: String] = [:]) {
        self.minAppVersion = minAppVersion
        self.freeEpisodeCount = freeEpisodeCount
        self.episodeCoinPrice = episodeCoinPrice
        self.bundleDiscountPct = bundleDiscountPct
        self.coinRupeeRate = coinRupeeRate
        self.checkinCoins = checkinCoins
        self.flags = flags
        self.experiments = experiments
    }

    /// Force-update check: numeric dotted-version compare (missing parts = 0).
    public static func isOutdated(current: String, minimum: String) -> Bool {
        func parts(_ v: String) -> [Int] { v.split(separator: ".").map { Int($0) ?? 0 } }
        let a = parts(current), b = parts(minimum)
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x < y }
        }
        return false
    }
}

/// GST invoice for a WEB (UPI) coin purchase — buy on the web, see it in-app.
public struct Invoice: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let orderRef: String
    public let sku: String
    public let coins: Int
    public let bonusCoins: Int
    public let totalMinor: Int
    public let taxableMinor: Int
    public let gstMinor: Int
    public let gstRatePct: Int
    public let sellerGstin: String
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case orderRef = "order_ref"
        case sku, coins
        case bonusCoins = "bonus_coins"
        case totalMinor = "total_minor"
        case taxableMinor = "taxable_minor"
        case gstMinor = "gst_minor"
        case gstRatePct = "gst_rate_pct"
        case sellerGstin = "seller_gstin"
        case createdAt = "created_at"
    }
}

public struct InvoiceList: Codable, Hashable, Sendable {
    public let invoices: [Invoice]
}


/// Acknowledgement for a filed grievance (IT Rules: 24 h ack / 15 d resolve).
public struct GrievanceAck: Codable, Hashable, Sendable {
    public let id: String
    public let status: String
    public let promise: String
}
