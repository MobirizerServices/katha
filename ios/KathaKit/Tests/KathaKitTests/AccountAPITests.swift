import XCTest
@testable import KathaKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Transport + decode coverage for the auth/identity/engagement endpoints,
/// driven through the real client via MockURLProtocol.
final class AccountAPITests: XCTestCase {

    private func makeClient(authToken: String? = nil) -> KathaAPIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return KathaAPIClient(baseURL: URL(string: "http://localhost:8799")!,
                              session: URLSession(configuration: config),
                              authToken: authToken)
    }

    private func reply(_ json: String, status: Int = 200) {
        MockURLProtocol.handler = { req in
            let resp = HTTPURLResponse(url: req.url!, statusCode: status,
                                       httpVersion: "HTTP/1.1", headerFields: nil)!
            return (Data(json.utf8), resp)
        }
    }

    override func tearDown() {
        MockURLProtocol.handler = nil
        MockURLProtocol.lastRequest = nil
        super.tearDown()
    }

    private static let authTokenJSON = """
    {"access_token":"tok_abc","token_type":"bearer",
     "user":{"user_id":"usr_1","kind":"phone","display_name":"Meera",
             "language":"hi","phone":"+919876543210"}}
    """

    // MARK: - Auth

    func testRequestOtpPostsPhoneAndDecodes() async throws {
        reply(#"{"request_id":"otp_12ab","phone":"+919876543210","dev_hint":"any 4 digits"}"#)
        let r = try await makeClient().requestOtp(phone: "+919876543210")
        XCTAssertEqual(r.requestId, "otp_12ab")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "POST")
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/v1/auth/otp/request")
    }

    func testVerifyOtpDecodesAndStoresTokenForNextCall() async throws {
        reply(Self.authTokenJSON)
        let client = makeClient()
        let token = try await client.verifyOtp(phone: "+919876543210", code: "1234")
        XCTAssertEqual(token.accessToken, "tok_abc")
        XCTAssertEqual(token.user.userId, "usr_1")
        XCTAssertEqual(token.user.phone, "+919876543210")

        // The stored token must ride on the next request.
        reply(#"{"balance_bought":0,"balance_bonus":0,"total":0}"#)
        _ = try await client.wallet()
        let auth = MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization")
        XCTAssertEqual(auth, "Bearer tok_abc")
    }

    func testGuestLoginStoresToken() async throws {
        reply(Self.authTokenJSON)
        let client = makeClient()
        _ = try await client.guestLogin()
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/v1/auth/guest")
    }

    func testAppleLoginSendsIdentityToken() async throws {
        reply(Self.authTokenJSON)
        _ = try await makeClient().appleLogin(identityToken: "apple-jwt", fullName: "Meera K")
        let body = MockURLProtocol.lastRequest.flatMap(Self.bodyData)
        let json = try XCTUnwrap(body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])
        XCTAssertEqual(json["identity_token"] as? String, "apple-jwt")
        XCTAssertEqual(json["full_name"] as? String, "Meera K")
    }

    func testMeAndPatchMe() async throws {
        reply(#"{"user_id":"usr_1","kind":"guest","display_name":"","language":"hi","phone":null}"#)
        let me = try await makeClient().me()
        XCTAssertEqual(me.kind, "guest")
        XCTAssertNil(me.phone)

        reply(#"{"user_id":"usr_1","kind":"guest","display_name":"","language":"ta","phone":null}"#)
        let updated = try await makeClient().updateMe(language: "ta")
        XCTAssertEqual(updated.language, "ta")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "PATCH")
    }

    func testDeleteMeClearsToken() async throws {
        reply(#"{"status":"deleted"}"#)
        let client = makeClient(authToken: "tok_old")
        try await client.deleteMe()
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "DELETE")

        // Next request must carry no Authorization header.
        reply(#"{"rows":[]}"#)
        _ = try await client.home()
        XCTAssertNil(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"))
    }

    // MARK: - Engagement

    func testReportProgressPutsSnakeCaseItems() async throws {
        reply("{}")
        try await makeClient().reportProgress([
            ProgressReport(slug: "kaanch-ka-mahal", number: 3, positionMs: 4000, durationMs: 60000)
        ])
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "PUT")
        let body = MockURLProtocol.lastRequest.flatMap(Self.bodyData)
        let json = try XCTUnwrap(body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])
        let items = try XCTUnwrap(json["items"] as? [[String: Any]])
        XCTAssertEqual(items.first?["position_ms"] as? Int, 4000)
    }

    func testContinueWatchingDecodesWithDefaults() async throws {
        reply("""
        {"items":[{"slug":"s","number":11,"episode_id":"s:e11",
                   "position_ms":1000,"duration_ms":60000}]}
        """)
        let list = try await makeClient().continueWatching()
        XCTAssertEqual(list.items.first?.number, 11)
        XCTAssertEqual(list.items.first?.title, "")       // optional, defaulted
        XCTAssertEqual(list.items.first?.percent, 0)
    }

    func testMyListRoundtrip() async throws {
        let json = """
        {"slugs":["kaanch-ka-mahal"],"series":[
          {"slug":"kaanch-ka-mahal","title":"Kaanch Ka Mahal","genres":[],
           "episode_count":60,"primary_language":"hi","content_rating":"U/A 16+"}]}
        """
        reply(json)
        let list = try await makeClient().myList()
        XCTAssertEqual(list.slugs, ["kaanch-ka-mahal"])
        XCTAssertEqual(list.series.first?.contentRating, "U/A 16+")

        reply(json)
        _ = try await makeClient().addToList(slug: "kaanch-ka-mahal")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "PUT")
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/v1/me/list/kaanch-ka-mahal")

        reply(json)
        _ = try await makeClient().removeFromList(slug: "kaanch-ka-mahal")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "DELETE")
    }

    func testMyListToleratesEmptyObject() throws {
        let list = try KathaJSON.decode(MyList.self, from: Data("{}".utf8))
        XCTAssertTrue(list.slugs.isEmpty && list.series.isEmpty)
    }

    func testCheckinDecodes() async throws {
        reply("""
        {"granted_coins":5,"already_claimed":false,"day":"2026-09-14",
         "wallet":{"balance_bought":0,"balance_bonus":5,"total":5}}
        """)
        let r = try await makeClient().checkin()
        XCTAssertEqual(r.grantedCoins, 5)
        XCTAssertFalse(r.alreadyClaimed)
        XCTAssertEqual(r.wallet.total, 5)
    }

    // MARK: - Model tolerances

    func testSeriesSummaryDecodesWithoutRating() throws {
        let s = try KathaJSON.decode(SeriesSummary.self, from: Data("""
        {"slug":"x","title":"X","genres":[],"episode_count":1,"primary_language":"hi"}
        """.utf8))
        XCTAssertEqual(s.contentRating, "")
    }

    func testSeriesDetailDecodesRating() throws {
        let d = try KathaJSON.decode(SeriesDetail.self, from: Data("""
        {"slug":"x","title":"X","genres":[],"episode_count":1,"primary_language":"hi",
         "content_rating":"U/A 13+","synopsis":"s","free_episode_count":10,
         "episode_coin_price":30,"bundle_discount_pct":25,"episodes":[]}
        """.utf8))
        XCTAssertEqual(d.contentRating, "U/A 13+")
    }

    func testAckDecodesFromAnything() throws {
        _ = try KathaJSON.decode(Ack.self, from: Data(#"{"anything":123}"#.utf8))
    }

    /// Exercise the memberwise inits the app layer uses (and Ack's encode side).
    func testMemberwiseConstruction() throws {
        let profile = UserProfile(userId: "u", kind: "phone", displayName: "M",
                                  language: "hi", phone: "+91")
        let token = AuthToken(accessToken: "t", user: profile)
        XCTAssertEqual(token.user.displayName, "M")

        XCTAssertEqual(OtpRequest(requestId: "r", phone: "+91").requestId, "r")

        let checkin = CheckinResult(grantedCoins: 5, alreadyClaimed: false, day: "d",
                                    wallet: Wallet(balanceBought: 0, balanceBonus: 5, total: 5))
        XCTAssertEqual(checkin.wallet.total, 5)

        let summary = SeriesSummary(slug: "s", title: "S", genres: [], episodeCount: 1,
                                    primaryLanguage: "hi", contentRating: "U/A 16+")
        let list = MyList(slugs: ["s"], series: [summary])
        XCTAssertEqual(list.series.first?.contentRating, "U/A 16+")

        let item = ContinueItem(slug: "s", number: 3, episodeId: "s:e3",
                                positionMs: 10, durationMs: 100, title: "T", percent: 10)
        XCTAssertEqual(item.id, "s:e3")
        XCTAssertEqual(ContinueList(items: [item]).items.count, 1)

        _ = try JSONEncoder().encode(Ack())   // encode side of Ack
    }

    // MARK: - helpers

    /// URLSession moves httpBody into a stream for uploads; read whichever is set.
    private static func bodyData(_ req: URLRequest) -> Data? {
        if let b = req.httpBody { return b }
        guard let stream = req.httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data()
        let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
        defer { buf.deallocate() }
        while stream.hasBytesAvailable {
            let n = stream.read(buf, maxLength: 4096)
            if n <= 0 { break }
            data.append(buf, count: n)
        }
        return data
    }
}

extension AccountAPITests {
    func testWalletTransactionsDecode() async throws {
        reply("""
        [{"id":"ctx_1","type":"unlock","amount_bought":0,"amount_bonus":-30,
          "reference_type":"episode","reference_id":"kkm:e11","created_at":"t"},
         {"id":"ctx_0","type":"purchase","amount_bought":1300,"amount_bonus":0,
          "reference_type":"web_order","reference_id":"sku","created_at":"t"}]
        """)
        let rows = try await makeClientForExt().walletTransactions()
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].net, -30)
        XCTAssertEqual(rows[1].type, "purchase")
        XCTAssertEqual(LedgerEntry(id: "x", type: "bonus", amountBought: 0, amountBonus: 5,
                                   referenceType: "day", referenceId: "d", createdAt: "t").net, 5)
    }

    private func makeClientForExt() -> KathaAPIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return KathaAPIClient(baseURL: URL(string: "http://localhost:8799")!,
                              session: URLSession(configuration: config))
    }
}
