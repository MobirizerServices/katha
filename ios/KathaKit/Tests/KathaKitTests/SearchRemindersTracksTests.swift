import XCTest
@testable import KathaKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Decoding + transport coverage for the v0.3 additions: search (series +
/// people), reminders, sign-out-of-other-devices, the app-language field on
/// the profile, and the caption/audio track lists on entitled playback.
final class SearchRemindersTracksTests: XCTestCase {

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

    private func lastBodyJSON() throws -> [String: Any] {
        let body = MockURLProtocol.lastRequest.flatMap(Self.bodyData)
        return try XCTUnwrap(body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any])
    }

    override func tearDown() {
        MockURLProtocol.handler = nil
        MockURLProtocol.lastRequest = nil
        super.tearDown()
    }

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

    // MARK: - Playback tracks

    func testEntitledPlaybackDecodesCaptionsAndAudio() throws {
        let json = """
        {"locked":false,"episode_id":"s:e1","hls_master_url":"https://cdn/m.m3u8",
         "resume_position_ms":0,
         "captions":[{"lang":"en","label":"English","url":"https://cdn/en.vtt"},
                     {"lang":"hi","url":"https://cdn/hi.vtt"}],
         "audio":[{"lang":"hi","label":"हिन्दी","kind":"original"},
                  {"lang":"ta"}]}
        """.data(using: .utf8)!
        let p = try KathaJSON.decode(PlaybackResponse.self, from: json)
        XCTAssertEqual(p.captions?.count, 2)
        XCTAssertEqual(p.captions?[0].label, "English")
        XCTAssertEqual(p.captions?[0].id, "en")
        // Missing label falls back to the language code; missing url to "".
        XCTAssertEqual(p.captions?[1].label, "hi")
        XCTAssertEqual(p.captions?[1].url, "https://cdn/hi.vtt")
        XCTAssertEqual(p.audio?.count, 2)
        XCTAssertEqual(p.audio?[0].kind, "original")
        XCTAssertEqual(p.audio?[0].id, "hi:original")
        XCTAssertEqual(p.audio?[1].label, "ta")
        XCTAssertEqual(p.audio?[1].kind, "original")
    }

    func testPlaybackWithoutTracksStillDecodes() throws {
        let json = #"{"locked":false,"episode_id":"s:e1","hls_master_url":"https://cdn/m.m3u8"}"#
            .data(using: .utf8)!
        let p = try KathaJSON.decode(PlaybackResponse.self, from: json)
        XCTAssertNil(p.captions)
        XCTAssertNil(p.audio)
    }

    func testTrackMemberwiseInitsAndRoundTrip() throws {
        let c = CaptionTrack(lang: "en", label: "", url: "u")
        XCTAssertEqual(c.label, "en")                    // empty label → lang
        let a = AudioTrack(lang: "hi", label: "Hindi", kind: "dubbed")
        XCTAssertEqual(a.id, "hi:dubbed")
        let pb = PlaybackResponse(locked: false, episodeId: "s:e1", captions: [c], audio: [a])
        let data = try JSONEncoder().encode(pb)
        let back = try JSONDecoder().decode(PlaybackResponse.self, from: data)
        XCTAssertEqual(back.captions, [c])
        XCTAssertEqual(back.audio, [a])
        let caption = try JSONDecoder().decode(CaptionTrack.self, from: JSONEncoder().encode(c))
        XCTAssertEqual(caption, c)
    }

    // MARK: - Search

    func testSearchSendsQueryAndDecodesSeriesAndPeople() async throws {
        reply("""
        {"query":"aditi",
         "series":[{"slug":"kaanch-ka-mahal","title":"Kaanch Ka Mahal","genres":["drama"],
                    "episode_count":60,"primary_language":"hi"}],
         "people":[{"name":"Aditi Rawal","role":"Lead",
                    "series":[{"slug":"kaanch-ka-mahal","title":"Kaanch Ka Mahal",
                               "genres":["drama"],"episode_count":60,"primary_language":"hi"}]}]}
        """)
        let r = try await makeClient().search(q: "aditi", lang: "hi")
        XCTAssertEqual(r.query, "aditi")
        XCTAssertEqual(r.series.map(\.slug), ["kaanch-ka-mahal"])
        XCTAssertEqual(r.people.count, 1)
        XCTAssertEqual(r.people[0].name, "Aditi Rawal")
        XCTAssertEqual(r.people[0].role, "Lead")
        XCTAssertEqual(r.people[0].id, "Aditi Rawal|Lead")
        XCTAssertEqual(r.people[0].series.count, 1)
        let url = try XCTUnwrap(MockURLProtocol.lastRequest?.url)
        XCTAssertEqual(url.path, "/v1/search")
        XCTAssertTrue(url.query?.contains("q=aditi") == true)
        XCTAssertTrue(url.query?.contains("lang=hi") == true)
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "GET")
    }

    func testSearchDecodesWithMissingSectionsAndPersonDefaults() throws {
        let r = try KathaJSON.decode(SearchResponse.self, from: Data("{}".utf8))
        XCTAssertEqual(r.query, "")
        XCTAssertEqual(r.series, [])
        XCTAssertEqual(r.people, [])
        let p = try KathaJSON.decode(SearchPerson.self, from: Data(#"{"name":"X"}"#.utf8))
        XCTAssertEqual(p.role, "")
        XCTAssertEqual(p.series, [])
        // Memberwise inits.
        let person = SearchPerson(name: "A", role: "Lead", series: [])
        let resp = SearchResponse(query: "a", series: [], people: [person])
        XCTAssertEqual(resp.people, [person])
        let data = try JSONEncoder().encode(resp)
        XCTAssertEqual(try JSONDecoder().decode(SearchResponse.self, from: data), resp)
    }

    // MARK: - Reminders

    func testRemindersGetPutDelete() async throws {
        let client = makeClient(authToken: "tok")
        reply(#"{"slugs":["raja-ki-beti"]}"#)
        let list = try await client.reminders()
        XCTAssertEqual(list.slugs, ["raja-ki-beti"])
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/v1/me/reminders")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "GET")

        reply(#"{"slugs":["raja-ki-beti","ceo-sahab"]}"#)
        let added = try await client.addReminder(slug: "ceo-sahab")
        XCTAssertEqual(added.slugs.count, 2)
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/v1/me/reminders/ceo-sahab")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "PUT")
        XCTAssertEqual(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"),
                       "Bearer tok")

        reply(#"{"slugs":[]}"#)
        let removed = try await client.removeReminder(slug: "ceo-sahab")
        XCTAssertEqual(removed.slugs, [])
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "DELETE")
    }

    func testReminderListDecodesEmptyObjectAndMemberwise() throws {
        let r = try KathaJSON.decode(ReminderList.self, from: Data("{}".utf8))
        XCTAssertEqual(r.slugs, [])
        let m = ReminderList(slugs: ["a"])
        let back = try JSONDecoder().decode(ReminderList.self, from: JSONEncoder().encode(m))
        XCTAssertEqual(back, m)
    }

    // MARK: - Profile: ui_language + sign-out-devices + PATCH

    func testUserProfileUiLanguageDefaultsToEnglishOnOldServers() throws {
        let old = try KathaJSON.decode(UserProfile.self, from: Data(
            #"{"user_id":"u1","kind":"phone","display_name":"Meera","language":"hi","phone":"+91"}"#.utf8))
        XCTAssertEqual(old.uiLanguage, "en")
        let new = try KathaJSON.decode(UserProfile.self, from: Data(
            #"{"user_id":"u1","kind":"guest","ui_language":"hi"}"#.utf8))
        XCTAssertEqual(new.uiLanguage, "hi")
        XCTAssertEqual(new.displayName, "")
        XCTAssertEqual(new.language, "hi")
        XCTAssertNil(new.phone)
        let member = UserProfile(userId: "u2", kind: "apple", uiLanguage: "hi")
        XCTAssertEqual(member.uiLanguage, "hi")
        let data = try JSONEncoder().encode(member)
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(obj["ui_language"] as? String, "hi")
    }

    func testUpdateMeSendsUiLanguageOnly() async throws {
        reply(#"{"user_id":"u1","kind":"guest","ui_language":"hi"}"#)
        let me = try await makeClient().updateMe(uiLanguage: "hi")
        XCTAssertEqual(me.uiLanguage, "hi")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "PATCH")
        let body = try lastBodyJSON()
        XCTAssertEqual(body["ui_language"] as? String, "hi")
        XCTAssertNil(body["language"])
        XCTAssertNil(body["display_name"])
    }

    func testSignOutDevicesStoresTheReplacementToken() async throws {
        let client = makeClient(authToken: "tok_old")
        reply("""
        {"access_token":"tok_new","user":{"user_id":"u1","kind":"phone","display_name":"M",
         "language":"hi","phone":"+919876543210","ui_language":"en"}}
        """)
        let auth = try await client.signOutDevices()
        XCTAssertEqual(auth.accessToken, "tok_new")
        XCTAssertEqual(auth.user.kind, "phone")
        XCTAssertEqual(MockURLProtocol.lastRequest?.url?.path, "/v1/me/signout-devices")
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "POST")
        XCTAssertNil(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Content-Type"))

        reply(#"{"balance_bought":0,"balance_bonus":0,"total":0}"#)
        _ = try await client.wallet()
        XCTAssertEqual(MockURLProtocol.lastRequest?.value(forHTTPHeaderField: "Authorization"),
                       "Bearer tok_new")
    }

    // MARK: - Continue list with a limit

    func testContinueWatchingLimitQuery() async throws {
        reply(#"{"items":[]}"#)
        _ = try await makeClient().continueWatching(limit: 50)
        let url = try XCTUnwrap(MockURLProtocol.lastRequest?.url)
        XCTAssertEqual(url.path, "/v1/me/continue")
        XCTAssertEqual(url.query, "limit=50")

        _ = try await makeClient().continueWatching()
        XCTAssertNil(MockURLProtocol.lastRequest?.url?.query)
    }
}
