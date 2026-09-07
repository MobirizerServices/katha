package dev.katha.kit

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The client's job is to carry a token, decode the contract and translate status
 * codes. These tests pin exactly that, against a mock server — no live core-api,
 * so they run in CI without a backend.
 */
class KathaApiClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: KathaApiClient

    @BeforeTest fun setUp() {
        server = MockWebServer().also { it.start() }
        client = KathaApiClient(baseUrl = server.url("/").toString().trimEnd('/'))
    }

    @AfterTest fun tearDown() = server.shutdown()

    private fun reply(body: String, code: Int = 200) =
        server.enqueue(MockResponse().setResponseCode(code).setBody(body))

    @Test fun `decodes a series summary and keeps its own free count`() = runTest {
        reply("""{"rows":[{"title":"Trending","series":[{"slug":"kaanch-ka-mahal",
            "title":"Kaanch Ka Mahal","genres":["Family Drama"],"episode_count":4,
            "primary_language":"hi","free_episode_count":4}]}]}""")
        val home = client.home()
        val s = home.rows.single().series.single()
        assertEquals("kaanch-ka-mahal", s.slug)
        assertEquals(4, s.episodeCount)
        // the bug this pins: a card must use the series' own free run, never a global default
        assertEquals(4, s.freeEpisodeCount)
    }

    @Test fun `an unknown server field does not break an older client`() = runTest {
        reply("""{"slug":"x","title":"X","genres":[],"episode_count":1,
            "primary_language":"hi","synopsis":"s","episode_coin_price":30,
            "bundle_discount_pct":25,"episodes":[],"a_field_from_the_future":true}""")
        assertEquals("X", client.seriesDetail("x").title)
    }

    @Test fun `entitled playback carries the stream url`() = runTest {
        reply("""{"locked":false,"episode_id":"kaanch-ka-mahal:e1","entitled":true,
            "free":true,"hls_master_url":"http://h/master.m3u8","resume_position_ms":4200,
            "captions":[{"lang":"hi","label":"Hindi","url":"http://h/hi.vtt"}]}""")
        val p = client.playback("kaanch-ka-mahal", 1)
        assertFalse(p.locked)
        assertEquals("http://h/master.m3u8", p.hlsMasterUrl)
        assertEquals(4200, p.resumePositionMs)
        assertEquals("Hindi", p.captions.single().label)
    }

    @Test fun `a locked episode is a 200, not an error`() = runTest {
        reply("""{"locked":true,"episode_id":"kaanch-ka-mahal:e5","price_coins":30,
            "balance":10,"remaining_locked":56,"bundle_offer_coins":1260}""")
        val p = client.playback("kaanch-ka-mahal", 5)
        assertTrue(p.locked)
        assertEquals(30, p.priceCoins)
        assertEquals(1260, p.bundleOfferCoins)
        assertNull(p.hlsMasterUrl)
    }

    @Test fun `the auth token rides on every request once set`() = runTest {
        reply("""{"user_id":"u1","kind":"guest"}""")
        client.setAuthToken("tok-123")
        client.me()
        assertEquals("Bearer tok-123", server.takeRequest().getHeader("Authorization"))
    }

    @Test fun `401 raises Unauthorized and fires the handler exactly once`() = runTest {
        var fired = 0
        client.onUnauthorized { fired++ }
        reply("{}", code = 401)
        assertFailsWith<KathaApiError.Unauthorized> { client.me() }
        reply("{}", code = 401)
        assertFailsWith<KathaApiError.Unauthorized> { client.me() }
        assertEquals(1, fired, "a dead session should be reported once, not per call")
    }

    @Test fun `402 on unlock means the wallet cannot cover it`() = runTest {
        reply("""{"detail":"insufficient"}""", code = 402)
        assertFailsWith<KathaApiError.NotEntitled> {
            client.unlockEpisode("kaanch-ka-mahal", 5, "idem-1")
        }
    }

    @Test fun `402 elsewhere stays a plain status error`() = runTest {
        reply("""{"detail":"nope"}""", code = 402)
        val e = assertFailsWith<KathaApiError.BadStatus> { client.wallet() }
        assertEquals(402, e.code)
    }

    @Test fun `the idempotency key is sent in the unlock body`() = runTest {
        reply("""{"episode_ids":["kaanch-ka-mahal:e5"],"spent_bonus":0,"spent_bought":30,
            "wallet":{"balance_bought":70,"balance_bonus":0,"total":70}}""")
        val r = client.unlockEpisode("kaanch-ka-mahal", 5, "idem-abc")
        assertEquals(70, r.wallet.total)
        assertTrue(server.takeRequest().body.readUtf8().contains("idem-abc"))
    }

    @Test fun `malformed json is a decoding error, not a crash`() = runTest {
        reply("not json at all")
        assertFailsWith<KathaApiError.Decoding> { client.wallet() }
    }

    @Test fun `a 500 surfaces its status code`() = runTest {
        reply("boom", code = 500)
        assertEquals(500, assertFailsWith<KathaApiError.BadStatus> { client.wallet() }.code)
    }
}
