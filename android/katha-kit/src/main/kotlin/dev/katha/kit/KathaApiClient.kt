package dev.katha.kit

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.atomic.AtomicReference

/** Errors surfaced by [KathaApiClient]. Mirrors `KathaAPIError` in the Swift package. */
sealed class KathaApiError(message: String) : Exception(message) {
    data class BadStatus(val code: Int) : KathaApiError("HTTP $code")
    /** 401: the token expired or was revoked — start over. */
    object Unauthorized : KathaApiError("unauthorized")
    /** 402 on an unlock — the wallet cannot cover the cost. */
    object NotEntitled : KathaApiError("not entitled")
    data class Decoding(val detail: String) : KathaApiError("decoding: $detail")
    object InvalidResponse : KathaApiError("invalid response")
}

/**
 * A thin coroutine wrapper over core-api, mirroring `KathaAPIClient` in
 * ios/KathaKit one method for one method.
 *
 * It holds NO business authority. It carries the auth token, decodes typed
 * models, and translates status codes — every rule about what an episode costs
 * or who may watch it lives on the server, where the ledger is. That separation
 * is the reason the iOS client could never be tricked into granting an unlock,
 * and it has to survive the port.
 */
class KathaApiClient(
    baseUrl: String = "http://localhost:8799",
    private val http: OkHttpClient = OkHttpClient(),
    authToken: String? = null,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    val baseUrl: HttpUrl = baseUrl.trimEnd('/').toHttpUrl()

    private val token = AtomicReference(authToken)
    private val onUnauthorized = AtomicReference<(() -> Unit)?>(null)

    private val json = Json {
        ignoreUnknownKeys = true      // a new server field must never break an old client
        explicitNulls = false
        coerceInputValues = true
    }

    fun setAuthToken(value: String?) {
        token.set(value)
    }

    /**
     * Called once per 401 — a token that expired or was invalidated server-side —
     * so the app can drop the dead session instead of failing every later call.
     */
    fun onUnauthorized(handler: (() -> Unit)?) {
        onUnauthorized.set(handler)
    }

    // ---------------------------------------------------------------- auth ----

    suspend fun requestOtp(phone: String): OtpRequest =
        post("/v1/auth/otp/request", mapOf("phone" to phone))

    suspend fun verifyOtp(phone: String, code: String): AuthToken =
        post("/v1/auth/otp/verify", mapOf("phone" to phone, "code" to code))

    suspend fun guestLogin(): AuthToken = post("/v1/auth/guest", emptyMap<String, String>())

    suspend fun appleLogin(identityToken: String, fullName: String? = null): AuthToken =
        post("/v1/auth/apple", buildMap {
            put("identity_token", identityToken)
            fullName?.let { put("full_name", it) }
        })

    suspend fun me(): UserProfile = get("/v1/me")

    suspend fun updateMe(
        displayName: String? = null,
        language: String? = null,
        uiLanguage: String? = null,
    ): UserProfile = request("PATCH", "/v1/me", buildMap {
        displayName?.let { put("display_name", it) }
        language?.let { put("language", it) }
        uiLanguage?.let { put("ui_language", it) }
    })

    suspend fun deleteMe() {
        requestUnit("DELETE", "/v1/me", null)
    }

    // ------------------------------------------------------------ catalogue ----

    suspend fun home(lang: String = "hi"): HomeResponse = get("/v1/home", mapOf("lang" to lang))

    suspend fun listSeries(): List<SeriesSummary> = get("/v1/series")

    suspend fun seriesDetail(slug: String): SeriesDetail = get("/v1/series/$slug")

    suspend fun search(q: String, lang: String = "hi"): SearchResponse =
        get("/v1/search", mapOf("q" to q, "lang" to lang))

    suspend fun playback(slug: String, number: Int): PlaybackResponse =
        post("/v1/series/$slug/episodes/$number/playback", emptyMap<String, String>())

    // ---------------------------------------------------------------- money ----

    suspend fun wallet(): Wallet = get("/v1/wallet")

    suspend fun packs(storefront: String = "IN"): List<CoinPack> =
        get("/v1/iap/packs", mapOf("storefront" to storefront))

    /**
     * Unlock one episode. [idempotencyKey] must be stable across retries of the
     * SAME intent and unique across different ones — the server keys the ledger
     * write on it, so a retried network call cannot charge twice.
     */
    suspend fun unlockEpisode(slug: String, number: Int, idempotencyKey: String): UnlockResult =
        unlock("/v1/series/$slug/episodes/$number/unlock", idempotencyKey)

    suspend fun unlockAll(slug: String, idempotencyKey: String): UnlockResult =
        unlock("/v1/series/$slug/unlock-all", idempotencyKey)

    private suspend fun unlock(path: String, key: String): UnlockResult =
        try {
            post(path, mapOf("idempotency_key" to key))
        } catch (e: KathaApiError.BadStatus) {
            if (e.code == 402) throw KathaApiError.NotEntitled else throw e
        }

    // -------------------------------------------------------------- library ----

    suspend fun checkin(): CheckinResult = post("/v1/rewards/checkin", emptyMap<String, String>())

    suspend fun myList(): MyList = get("/v1/me/list")

    suspend fun addToList(slug: String): MyList = post("/v1/me/list/$slug", emptyMap<String, String>())

    suspend fun removeFromList(slug: String): MyList = request("DELETE", "/v1/me/list/$slug", null)

    suspend fun reminders(): ReminderList = get("/v1/me/reminders")

    suspend fun addReminder(slug: String): ReminderList =
        post("/v1/me/reminders/$slug", emptyMap<String, String>())

    suspend fun removeReminder(slug: String): ReminderList =
        request("DELETE", "/v1/me/reminders/$slug", null)

    suspend fun continueWatching(limit: Int? = null): ContinueList =
        get("/v1/me/continue", if (limit == null) emptyMap() else mapOf("limit" to limit.toString()))

    suspend fun reportProgress(items: List<ProgressReport>) {
        requestUnit("PUT", "/v1/progress", json.encodeToString(ProgressBatch(items)))
    }

    @kotlinx.serialization.Serializable
    private data class ProgressBatch(val items: List<ProgressReport>)

    // ------------------------------------------------------------ transport ----

    private suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T {
        val url = baseUrl.newBuilder().addPathSegments(path.trimStart('/')).apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        return perform(Request.Builder().url(url).get())
    }

    private suspend inline fun <reified T> post(path: String, body: Map<String, String>): T =
        request("POST", path, body)

    private suspend inline fun <reified T> request(method: String, path: String, body: Map<String, String>?): T {
        val payload = body?.let { json.encodeToString(it) }
        val url = baseUrl.newBuilder().addPathSegments(path.trimStart('/')).build()
        val rb = payload?.toRequestBody(JSON_MEDIA)
        // OkHttp requires a body for POST/PUT/PATCH even when there is nothing to say.
        val fallback = if (method in setOf("POST", "PUT", "PATCH")) EMPTY_JSON else null
        return perform(Request.Builder().url(url).method(method, rb ?: fallback))
    }

    private suspend fun requestUnit(method: String, path: String, rawBody: String?) {
        val url = baseUrl.newBuilder().addPathSegments(path.trimStart('/')).build()
        val rb = rawBody?.toRequestBody(JSON_MEDIA)
        val fallback = if (method in setOf("POST", "PUT", "PATCH")) EMPTY_JSON else null
        performRaw(Request.Builder().url(url).method(method, rb ?: fallback))
    }

    private suspend inline fun <reified T> perform(builder: Request.Builder): T {
        val text = performRaw(builder)
        return try {
            json.decodeFromString<T>(text)
        } catch (e: Exception) {
            throw KathaApiError.Decoding(e.message ?: "unparseable")
        }
    }

    private suspend fun performRaw(builder: Request.Builder): String = withContext(io) {
        token.get()?.let { builder.header("Authorization", "Bearer $it") }
        val response = http.newCall(builder.build()).execute()
        response.use {
            val text = it.body?.string() ?: ""
            when {
                it.code == 401 -> {
                    onUnauthorized.getAndSet(null)?.invoke()
                    throw KathaApiError.Unauthorized
                }
                !it.isSuccessful -> throw KathaApiError.BadStatus(it.code)
                else -> text
            }
        }
    }

    private companion object {
        val JSON_MEDIA = "application/json".toMediaType()
        val EMPTY_JSON = "{}".toRequestBody("application/json".toMediaType())
    }
}
