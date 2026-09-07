package dev.katha.kit

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire models for core-api, mirroring `ios/KathaKit/Sources/KathaKit/Models.swift`.
 *
 * Field names come from `contracts/openapi/core-api.json`, which is committed and
 * drift-gated in CI — so this file has one job, to stay honest to that contract.
 * Anything the server may omit is nullable with a default here rather than
 * required, because a client that refuses to parse a response over a field it
 * does not use is a client that breaks on the next harmless server addition.
 */

@Serializable
data class SeriesSummary(
    val slug: String,
    val title: String,
    val genres: List<String> = emptyList(),
    @SerialName("episode_count") val episodeCount: Int,
    @SerialName("primary_language") val primaryLanguage: String,
    @SerialName("content_rating") val contentRating: String = "",
    @SerialName("cover_url") val coverUrl: String = "",
    @SerialName("cover_wide_url") val coverWideUrl: String = "",
    /** How many of THIS series' episodes are free. Never fall back to the global
     *  default from /v1/config: that prints "First 10 free" on a 4-episode season. */
    @SerialName("free_episode_count") val freeEpisodeCount: Int = 0,
)

@Serializable
data class CastMember(val name: String, val role: String)

@Serializable
data class Episode(
    val number: Int,
    val title: String,
    @SerialName("is_free") val isFree: Boolean,
    @SerialName("coin_price") val coinPrice: Int,
)

@Serializable
data class SeriesDetail(
    val slug: String,
    val title: String,
    val genres: List<String> = emptyList(),
    @SerialName("episode_count") val episodeCount: Int,
    @SerialName("primary_language") val primaryLanguage: String,
    @SerialName("content_rating") val contentRating: String = "",
    @SerialName("cover_url") val coverUrl: String = "",
    @SerialName("cover_wide_url") val coverWideUrl: String = "",
    @SerialName("free_episode_count") val freeEpisodeCount: Int = 0,
    val synopsis: String,
    @SerialName("title_native") val titleNative: String = "",
    val tropes: List<String> = emptyList(),
    val cast: List<CastMember> = emptyList(),
    @SerialName("episode_coin_price") val episodeCoinPrice: Int,
    @SerialName("bundle_discount_pct") val bundleDiscountPct: Int,
    val episodes: List<Episode> = emptyList(),
)

@Serializable
data class HomeRow(val title: String, val series: List<SeriesSummary> = emptyList())

@Serializable
data class HomeResponse(val rows: List<HomeRow> = emptyList())

@Serializable
data class SearchPerson(
    val name: String,
    val role: String,
    val series: List<SeriesSummary> = emptyList(),
)

@Serializable
data class SearchResponse(
    val query: String,
    val series: List<SeriesSummary> = emptyList(),
    val people: List<SearchPerson> = emptyList(),
)

// MARK: - Identity

@Serializable
data class UserProfile(
    @SerialName("user_id") val userId: String,
    val kind: String,
    @SerialName("display_name") val displayName: String = "",
    val language: String = "hi",
    @SerialName("ui_language") val uiLanguage: String? = null,
    val phone: String? = null,
)

@Serializable
data class AuthToken(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String = "bearer",
    val user: UserProfile? = null,
)

@Serializable
data class OtpRequest(
    @SerialName("request_id") val requestId: String,
    val phone: String,
    /** Dev builds only — the server never sends this from a real OTP provider. */
    @SerialName("dev_hint") val devHint: String? = null,
)

// MARK: - Money

@Serializable
data class Wallet(
    @SerialName("balance_bought") val balanceBought: Int,
    @SerialName("balance_bonus") val balanceBonus: Int,
    val total: Int,
)

@Serializable
data class UnlockResult(
    @SerialName("episode_ids") val episodeIds: List<String> = emptyList(),
    @SerialName("spent_bonus") val spentBonus: Int = 0,
    @SerialName("spent_bought") val spentBought: Int = 0,
    val wallet: Wallet,
)

@Serializable
data class CoinPack(
    val sku: String,
    val storefront: String,
    @SerialName("price_minor") val priceMinor: Int,
    val currency: String,
    val coins: Int,
    @SerialName("bonus_coins") val bonusCoins: Int = 0,
    @SerialName("web_bonus_coins") val webBonusCoins: Int = 0,
)

@Serializable
data class CheckinResult(
    @SerialName("granted_coins") val grantedCoins: Int,
    @SerialName("already_claimed") val alreadyClaimed: Boolean,
    val day: String,
    val wallet: Wallet,
)

// MARK: - Library

@Serializable
data class MyList(
    val slugs: List<String> = emptyList(),
    val series: List<SeriesSummary> = emptyList(),
)

@Serializable
data class ReminderList(val slugs: List<String> = emptyList())

@Serializable
data class ContinueItem(
    val slug: String,
    val number: Int,
    @SerialName("episode_id") val episodeId: String,
    @SerialName("position_ms") val positionMs: Long,
    @SerialName("duration_ms") val durationMs: Long,
    val title: String,
    val percent: Int,
    @SerialName("series_title") val seriesTitle: String = "",
    @SerialName("episode_title") val episodeTitle: String = "",
    @SerialName("cover_url") val coverUrl: String = "",
    @SerialName("cover_wide_url") val coverWideUrl: String = "",
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class ContinueList(val items: List<ContinueItem> = emptyList())

@Serializable
data class ProgressReport(
    val slug: String,
    val number: Int,
    @SerialName("position_ms") val positionMs: Long? = null,
    @SerialName("duration_ms") val durationMs: Long? = null,
    val rewind: Boolean? = null,
)

// MARK: - Playback
//
// The playback endpoint answers with one of two shapes under a `locked` flag —
// the corrected convention: 200 either way, never a 402 for "you must pay".
// Modelled as one type with a discriminator rather than a sealed hierarchy so a
// caller can branch on `locked` exactly as the iOS client does.

@Serializable
data class CaptionTrack(val lang: String, val label: String, val url: String)

@Serializable
data class AudioTrack(val lang: String, val label: String, val kind: String)

@Serializable
data class PlaybackResponse(
    val locked: Boolean,
    @SerialName("episode_id") val episodeId: String,
    // entitled
    val entitled: Boolean = false,
    val free: Boolean = false,
    @SerialName("hls_master_url") val hlsMasterUrl: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("resume_position_ms") val resumePositionMs: Long = 0,
    val captions: List<CaptionTrack> = emptyList(),
    val audio: List<AudioTrack> = emptyList(),
    // locked
    @SerialName("price_coins") val priceCoins: Int = 0,
    val balance: Int = 0,
    @SerialName("remaining_locked") val remainingLocked: Int = 0,
    @SerialName("bundle_offer_coins") val bundleOfferCoins: Int = 0,
)
