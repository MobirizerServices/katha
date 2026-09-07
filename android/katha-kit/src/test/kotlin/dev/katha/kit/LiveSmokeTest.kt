package dev.katha.kit

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Runs the client against a REAL core-api instead of a mock, to catch the one
 * thing mocks cannot: the contract drifting away from the server.
 *
 * Skipped unless `KATHA_BASE` is set, so CI and a laptop with no backend both
 * stay green:
 *
 *     KATHA_BASE=http://127.0.0.1:8799 ./gradlew test
 */
class LiveSmokeTest {
    private val base: String? = System.getenv("KATHA_BASE")

    @Test fun `guest login, catalogue and playback against a live core-api`() = runTest {
        val url = base ?: return@runTest println("KATHA_BASE unset — live smoke skipped")
        val client = KathaApiClient(baseUrl = url)

        val auth = client.guestLogin()
        assertTrue(auth.accessToken.isNotBlank(), "guest login should mint a token")
        client.setAuthToken(auth.accessToken)

        val me = client.me()
        assertTrue(me.userId.isNotBlank())

        val home = client.home()
        assertTrue(home.rows.isNotEmpty(), "home should carry at least one row")

        val detail = client.seriesDetail("kaanch-ka-mahal")
        assertTrue(detail.episodes.size == detail.episodeCount,
            "the episode list must match the count the card advertises")
        assertTrue(detail.freeEpisodeCount <= detail.episodeCount,
            "a series can never promise more free episodes than it has")

        val play = client.playback("kaanch-ka-mahal", 1)
        assertTrue(!play.locked && play.hlsMasterUrl?.contains("master.m3u8") == true,
            "episode 1 is free and should return a stream url")

        val wallet = client.wallet()
        assertTrue(wallet.total == wallet.balanceBought + wallet.balanceBonus,
            "wallet total must be the sum of its parts")

        println("live smoke OK — ${detail.title}: ${detail.episodeCount} eps, " +
            "${detail.freeEpisodeCount} free, wallet ${wallet.total}")
    }
}
