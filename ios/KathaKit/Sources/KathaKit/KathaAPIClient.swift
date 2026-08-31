import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Errors surfaced by ``KathaAPIClient``.
public enum KathaAPIError: Error, Equatable, Sendable {
    case badStatus(Int)
    case notEntitled            // 402 on an unlock — wallet cannot cover the cost
    case decoding(String)
    case invalidResponse
}

/// A thin async/await wrapper over core-api. Holds NO business authority; it only
/// carries the auth token and decodes typed models. Base URL is configurable
/// (default the dev core-api on http://localhost:8799).
public actor KathaAPIClient {
    public let baseURL: URL
    private let session: URLSession
    private var authToken: String?

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        return e
    }()

    public init(baseURL: URL = URL(string: "http://localhost:8799")!,
                session: URLSession = .shared,
                authToken: String? = nil) {
        self.baseURL = baseURL
        self.session = session
        self.authToken = authToken
    }

    public func setAuthToken(_ token: String?) {
        self.authToken = token
    }

    // MARK: - Catalog

    public func home(lang: String = "hi") async throws -> HomeResponse {
        try await get("/v1/home", query: ["lang": lang])
    }

    public func listSeries() async throws -> [SeriesSummary] {
        try await get("/v1/series")
    }

    public func seriesDetail(slug: String) async throws -> SeriesDetail {
        try await get("/v1/series/\(slug)")
    }

    // MARK: - Playback

    public func playback(slug: String, number: Int) async throws -> PlaybackResponse {
        try await send("/v1/series/\(slug)/episodes/\(number)/playback", method: "POST", body: Optional<Empty>.none)
    }

    // MARK: - Wallet & IAP

    public func wallet() async throws -> Wallet {
        try await get("/v1/wallet")
    }

    public func packs(storefront: String = "IN") async throws -> [CoinPack] {
        try await get("/v1/iap/packs", query: ["storefront": storefront])
    }

    public func verifyIAP(jws: String, sku: String) async throws -> Wallet {
        try await send("/v1/iap/verify", method: "POST", body: IapVerifyBody(jws: jws, sku: sku))
    }

    // MARK: - Unlock

    public func unlockEpisode(slug: String, number: Int, idempotencyKey: String) async throws -> UnlockResult {
        do {
            return try await send("/v1/series/\(slug)/episodes/\(number)/unlock",
                                   method: "POST", body: UnlockBody(idempotencyKey: idempotencyKey))
        } catch KathaAPIError.badStatus(402) {
            throw KathaAPIError.notEntitled
        }
    }

    public func unlockAll(slug: String, idempotencyKey: String) async throws -> UnlockResult {
        do {
            return try await send("/v1/series/\(slug)/unlock-all",
                                   method: "POST", body: UnlockBody(idempotencyKey: idempotencyKey))
        } catch KathaAPIError.badStatus(402) {
            throw KathaAPIError.notEntitled
        }
    }

    // MARK: - Transport

    private func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "GET"
        applyAuth(&req)
        return try await perform(req)
    }

    private func send<Body: Encodable, T: Decodable>(_ path: String, method: String, body: Body?) async throws -> T {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        applyAuth(&req)
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }
        return try await perform(req)
    }

    private func applyAuth(_ req: inout URLRequest) {
        if let authToken {
            req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw KathaAPIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw KathaAPIError.badStatus(http.statusCode)
        }
        return try decode(data)
    }

    /// Decode helper, also used directly by tests against sample fixtures.
    public func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw KathaAPIError.decoding(String(describing: error))
        }
    }
}

// MARK: - Request bodies

private struct Empty: Encodable {}

private struct IapVerifyBody: Encodable {
    let jws: String
    let sku: String
}

private struct UnlockBody: Encodable {
    let idempotencyKey: String
    enum CodingKeys: String, CodingKey { case idempotencyKey = "idempotency_key" }
}

/// A standalone decoder usable without an actor instance (handy in tests).
public enum KathaJSON {
    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw KathaAPIError.decoding(String(describing: error))
        }
    }
}
