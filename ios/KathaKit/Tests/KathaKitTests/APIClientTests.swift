import XCTest
@testable import KathaKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A URLProtocol that intercepts every request and answers from a per-test handler.
/// Lets us drive KathaAPIClient's real transport (get/send/perform/decode/applyAuth)
/// without a network, so those branches are actually exercised.
final class MockURLProtocol: URLProtocol {
    /// Returns the bytes + response to reply with, or throws to simulate a transport error.
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Data, URLResponse))?
    /// Records the last request seen so assertions can inspect method/headers/body/url.
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        MockURLProtocol.lastRequest = request
        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: KathaAPIError.invalidResponse)
            return
        }
        do {
            let (data, response) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

final class KathaAPIClientTests: XCTestCase {

    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    private func makeClient(authToken: String? = nil) -> KathaAPIClient {
        KathaAPIClient(baseURL: URL(string: "http://localhost:8799")!,
                       session: makeSession(),
                       authToken: authToken)
    }

    /// Build an HTTP response with the given status for the request's URL.
    private func http(_ status: Int, for req: URLRequest) -> HTTPURLResponse {
        HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
    }

    override func tearDown() {
        MockURLProtocol.handler = nil
        MockURLProtocol.lastRequest = nil
        super.tearDown()
    }

    // MARK: - Catalog GET decoding + query/path/auth

    func testHomeSendsLangQueryAndAuthAndDecodes() async throws {
        let json = """
        {"rows":[{"title":"Trending","series":[
          {"slug":"kaanch-ka-mahal","title":"Kaanch Ka Mahal","genres":["drama"],
           "episode_count":60,"primary_language":"hi"}]}]}
        """
        MockURLProtocol.handler = { req in (Data(json.utf8), self.http(200, for: req)) }
        let client = makeClient(authToken: "secret-token")

        let home = try await client.home(lang: "ta")

        XCTAssertEqual(home.rows.count, 1)
        XCTAssertEqual(home.rows[0].series[0].slug, "kaanch-ka-mahal")
        // Auth header applied.
        XCTAssertEqual(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"),
                       "Bearer secret-token")
        // Lang query present and path correct.
        let url = MockURLProtocol.lastRequest!.url!.absoluteString
        XCTAssertTrue(url.contains("/v1/home"))
        XCTAssertTrue(url.contains("lang=ta"))
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "GET")
    }

    func testListSeriesDecodesArrayNoAuthHeaderWhenTokenNil() async throws {
        let json = """
        [{"slug":"ceo-sahab","title":"CEO Sahab","genres":["romance"],
          "episode_count":72,"primary_language":"hi"}]
        """
        MockURLProtocol.handler = { req in (Data(json.utf8), self.http(200, for: req)) }
        let client = makeClient() // no token

        let series = try await client.listSeries()

        XCTAssertEqual(series.count, 1)
        XCTAssertEqual(series[0].episodeCount, 72)
        XCTAssertNil(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"))
    }

    func testSeriesDetailInterpolatesSlug() async throws {
        let json = """
        {"slug":"ceo-sahab","title":"CEO Sahab","genres":["romance"],"episode_count":72,
         "primary_language":"hi","synopsis":"s","free_episode_count":10,
         "episode_coin_price":30,"bundle_discount_pct":25,"episodes":[]}
        """
        MockURLProtocol.handler = { req in (Data(json.utf8), self.http(200, for: req)) }
        let client = makeClient()

        let detail = try await client.seriesDetail(slug: "ceo-sahab")

        XCTAssertEqual(detail.freeEpisodeCount, 10)
        XCTAssertTrue(MockURLProtocol.lastRequest!.url!.absoluteString.contains("/v1/series/ceo-sahab"))
    }

    // MARK: - setAuthToken mutates auth on the actor

    func testSetAuthTokenAppliesLater() async throws {
        MockURLProtocol.handler = { req in
            (Data(#"{"balance_bought":0,"balance_bonus":0,"total":0}"#.utf8), self.http(200, for: req))
        }
        let client = makeClient()
        await client.setAuthToken("later-token")
        _ = try await client.wallet()
        XCTAssertEqual(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"),
                       "Bearer later-token")
    }

    // MARK: - POST send() with and without a body

    func testPlaybackPostHasNoBodyAndCorrectMethod() async throws {
        let json = """
        {"locked":false,"episode_id":"ceo-sahab:e001",
         "hls_master_url":"https://cdn/x.m3u8","resume_position_ms":0}
        """
        MockURLProtocol.handler = { req in (Data(json.utf8), self.http(200, for: req)) }
        let client = makeClient()

        let pb = try await client.playback(slug: "ceo-sahab", number: 1)

        XCTAssertTrue(pb.isEntitled)
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "POST")
        // Empty body -> no Content-Type header set.
        XCTAssertNil(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Content-Type"))
        XCTAssertTrue(MockURLProtocol.lastRequest!.url!.absoluteString
            .hasSuffix("/v1/series/ceo-sahab/episodes/1/playback"))
    }

    func testVerifyIAPEncodesJSONBody() async throws {
        MockURLProtocol.handler = { req in
            (Data(#"{"balance_bought":1300,"balance_bonus":130,"total":1430}"#.utf8),
             self.http(200, for: req))
        }
        let client = makeClient()

        let wallet = try await client.verifyIAP(jws: "signed.jws.blob", sku: "coins_popular_in")

        XCTAssertEqual(wallet.total, 1430)
        let req = MockURLProtocol.lastRequest!
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        // Body carries the encoded fields. URLProtocol exposes it via httpBodyStream.
        let body = Self.bodyData(from: req)
        let obj = try JSONSerialization.jsonObject(with: body) as! [String: Any]
        XCTAssertEqual(obj["jws"] as? String, "signed.jws.blob")
        XCTAssertEqual(obj["sku"] as? String, "coins_popular_in")
    }

    func testPacksSendsStorefrontQuery() async throws {
        let json = """
        [{"sku":"coins_starter_in","storefront":"IN","price_minor":9900,
          "currency":"INR","coins":600}]
        """
        MockURLProtocol.handler = { req in (Data(json.utf8), self.http(200, for: req)) }
        let client = makeClient()

        let packs = try await client.packs(storefront: "IN")

        XCTAssertEqual(packs[0].coins, 600)
        XCTAssertTrue(MockURLProtocol.lastRequest!.url!.absoluteString.contains("storefront=IN"))
    }

    // MARK: - unlock success + idempotency-key body

    func testUnlockEpisodeSuccessEncodesIdempotencyKey() async throws {
        let json = """
        {"episode_ids":["ceo-sahab:e011"],"spent_bonus":20,"spent_bought":10,
         "wallet":{"balance_bought":90,"balance_bonus":0,"total":90}}
        """
        MockURLProtocol.handler = { req in (Data(json.utf8), self.http(200, for: req)) }
        let client = makeClient()

        let result = try await client.unlockEpisode(slug: "ceo-sahab", number: 11,
                                                     idempotencyKey: "idem-123")

        XCTAssertEqual(result.spentBonus, 20)
        XCTAssertEqual(result.wallet.total, 90)
        let body = Self.bodyData(from: MockURLProtocol.lastRequest!)
        let obj = try JSONSerialization.jsonObject(with: body) as! [String: Any]
        // snake_case coding key.
        XCTAssertEqual(obj["idempotency_key"] as? String, "idem-123")
    }

    func testUnlockAllSuccess() async throws {
        let json = """
        {"episode_ids":["s:e011","s:e012"],"spent_bonus":0,"spent_bought":900,
         "wallet":{"balance_bought":100,"balance_bonus":0,"total":100}}
        """
        MockURLProtocol.handler = { req in (Data(json.utf8), self.http(200, for: req)) }
        let client = makeClient()

        let result = try await client.unlockAll(slug: "s", idempotencyKey: "k")

        XCTAssertEqual(result.episodeIds.count, 2)
        XCTAssertEqual(result.spentBought, 900)
        XCTAssertTrue(MockURLProtocol.lastRequest!.url!.absoluteString.hasSuffix("/v1/series/s/unlock-all"))
    }

    // MARK: - 402 mapping to .notEntitled

    func testUnlockEpisode402MapsToNotEntitled() async {
        MockURLProtocol.handler = { req in (Data("{}".utf8), self.http(402, for: req)) }
        let client = makeClient()
        do {
            _ = try await client.unlockEpisode(slug: "s", number: 11, idempotencyKey: "k")
            XCTFail("expected notEntitled")
        } catch {
            XCTAssertEqual(error as? KathaAPIError, .notEntitled)
        }
    }

    func testUnlockAll402MapsToNotEntitled() async {
        MockURLProtocol.handler = { req in (Data("{}".utf8), self.http(402, for: req)) }
        let client = makeClient()
        do {
            _ = try await client.unlockAll(slug: "s", idempotencyKey: "k")
            XCTFail("expected notEntitled")
        } catch {
            XCTAssertEqual(error as? KathaAPIError, .notEntitled)
        }
    }

    /// A non-402 error status on unlock is surfaced as badStatus, not remapped.
    func testUnlockEpisodeOtherStatusPropagates() async {
        MockURLProtocol.handler = { req in (Data("{}".utf8), self.http(500, for: req)) }
        let client = makeClient()
        do {
            _ = try await client.unlockEpisode(slug: "s", number: 11, idempotencyKey: "k")
            XCTFail("expected badStatus")
        } catch {
            XCTAssertEqual(error as? KathaAPIError, .badStatus(500))
        }
    }

    // MARK: - perform() error branches

    func testBadStatusThrows() async {
        MockURLProtocol.handler = { req in (Data("{}".utf8), self.http(404, for: req)) }
        let client = makeClient()
        do {
            _ = try await client.listSeries()
            XCTFail("expected badStatus")
        } catch {
            XCTAssertEqual(error as? KathaAPIError, .badStatus(404))
        }
    }

    func testNonHTTPResponseThrowsInvalidResponse() async {
        MockURLProtocol.handler = { req in
            // A plain URLResponse is not an HTTPURLResponse -> invalidResponse.
            let resp = URLResponse(url: req.url!, mimeType: "application/json",
                                   expectedContentLength: 2, textEncodingName: nil)
            return (Data("{}".utf8), resp)
        }
        let client = makeClient()
        do {
            _ = try await client.wallet()
            XCTFail("expected invalidResponse")
        } catch {
            XCTAssertEqual(error as? KathaAPIError, .invalidResponse)
        }
    }

    func testDecodeErrorOnMalformedBody() async {
        MockURLProtocol.handler = { req in
            (Data("not json at all".utf8), self.http(200, for: req))
        }
        let client = makeClient()
        do {
            _ = try await client.wallet()
            XCTFail("expected decoding error")
        } catch let KathaAPIError.decoding(msg) {
            XCTAssertFalse(msg.isEmpty)
        } catch {
            XCTFail("expected .decoding, got \(error)")
        }
    }

    // MARK: - public decode() helper on the actor

    func testActorDecodeHelperSuccessAndFailure() async throws {
        let client = makeClient()
        let w: Wallet = try await client.decode(Data(#"{"balance_bought":5,"balance_bonus":1,"total":6}"#.utf8))
        XCTAssertEqual(w.total, 6)
        do {
            let _: Wallet = try await client.decode(Data("{".utf8))
            XCTFail("expected decoding error")
        } catch let KathaAPIError.decoding(msg) {
            XCTAssertFalse(msg.isEmpty)
        }
    }

    // MARK: - standalone KathaJSON decoder error path

    func testKathaJSONDecodeThrowsDecodingOnBadData() {
        do {
            _ = try KathaJSON.decode(Wallet.self, from: Data("}{".utf8))
            XCTFail("expected decoding error")
        } catch let KathaAPIError.decoding(msg) {
            XCTAssertFalse(msg.isEmpty)
        } catch {
            XCTFail("expected .decoding, got \(error)")
        }
    }

    // MARK: - KathaAPIError equatable identity

    func testErrorEquality() {
        XCTAssertEqual(KathaAPIError.badStatus(402), .badStatus(402))
        XCTAssertNotEqual(KathaAPIError.badStatus(402), .badStatus(500))
        XCTAssertNotEqual(KathaAPIError.notEntitled, .invalidResponse)
        XCTAssertEqual(KathaAPIError.decoding("x"), .decoding("x"))
    }

    // MARK: - default init (default base URL + shared session), no request issued

    func testDefaultInitUsesDevBaseURL() async {
        let client = KathaAPIClient()
        let base = await client.baseURL
        XCTAssertEqual(base.absoluteString, "http://localhost:8799")
    }

    /// Reconstruct the request body whether Foundation stored it as data or a stream.
    private static func bodyData(from req: URLRequest) -> Data {
        if let d = req.httpBody { return d }
        guard let stream = req.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
