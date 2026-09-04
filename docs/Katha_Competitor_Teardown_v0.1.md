# Katha — Competitor Teardown v0.1 (4 September 2026)

Static analysis of three Android builds supplied by the team, done with `aapt2`, `unzip` and dex string extraction.
No app was run and no network call was made. Stream endpoints, API hosts, keys and tokens were deliberately
excluded: this document is product and engineering research, not a content-acquisition guide
(see the repo rule: never download or serve third-party video).

## Competitive teardown — three "micro-drama" APKs

Work done entirely under the scratchpad (`…/scratchpad/td/`) with `aapt2`, `unzip -l` and a Python printable-string extractor over the dex files (macOS `strings` mangles dex). No app was run, no network calls were made, nothing in the Katha repo was touched. API hosts, ad/app IDs, license blobs and key-like strings were seen and deliberately skipped.

### 0. Identity check — read this first

Only **one** of the three files is a micro-drama app.

| File | Actual package / label | What it really is |
|---|---|---|
| `com.microshort.drama_1.10.3.xapk` | `com.microshort.drama` / **MicroShort** | Genuine micro-drama app, built on ByteDance's **Pangle Short Play SDK** (`com.bytedance.sdk.shortplay`, "PSSDK") — ByteDance supplies catalog, player and ad-monetisation. |
| `M+short_6.0_APKPure.apk` | `com.mmvideo11` / **"VideoStatus"** | A CodeCanyon-style *video status* template app (record/trim/upload status clips, "Latest Dance", "Earn Points", Withdrawal model). Zero occurrences of `drama`/`Drama`/`episode` in its dex. Not a micro-drama product. |
| `myshort.apk` | `cm.aptoide.pt` v9.22.5.3 / **Aptoide** | The Aptoide third-party app store itself (2,959 `cm/aptoide/pt` classes, Install/Update/Wallet/AppCoins UI). Not a micro-drama app at all — almost certainly a mis-download (Aptoide's own installer APK). |

The deep teardown below is therefore weighted to MicroShort; the other two are covered fully but their "product" findings are mostly evidence that they are the wrong artefacts. Suggest re-sourcing the real "M+ Short" and "MyShort" builds if those are the intended competitors.

---

## 1. MicroShort — `com.microshort.drama` 1.10.3 (versionCode 11003)

### 1.1 Identity
| | |
|---|---|
| Size | XAPK 116.8 MB: base 79.5 MB + `config.arm64_v8a` 37.0 MB + `config.mdpi` 0.13 MB (Play App Bundle split; `com.android.vending.splits` meta-data) |
| minSdk / targetSdk / compileSdk | **28 / 36 / 36** (Android 9+, targets Android 16) |
| ABIs | **arm64-v8a only** (44 native libs in the split; base has none) |
| Framework | **Native Kotlin/Java**, Kotlin 2.2.20, Gradle 8.11.1 (from `kotlin-tooling-metadata.json`). Jetpack **Compose** present (`androidx/compose/foundation` ×1525, no material3) alongside 844 XML layouts. No Flutter/RN/Unity/Cocos/Cordova markers. |
| Dex | 9 classes.dex (~67 MB) + 2 extra dex loaded from `assets/audience_network/` (Meta Audience Network dynamic loading) |
| Build stamp | class-name suffix `V1_10_3_11003__202608171447_release` → built 17 Aug 2026 |
| App wrapper | `android:name="com.pairip.application.Application"` → **Google Play "pairip" protection**; launcher activity and app services carry generated names (`utilirai.sticrea.bolbonus…SmelltioActivity`, `…CrodiblService`) — heavy identifier obfuscation |

### 1.2 Permissions (28) and what they imply
| Permission | Implication |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_NETWORK_STATE`, `CHANGE_WIFI_STATE` | streaming + network-aware ABR (`cellular_max_resolution_index` in `vod_gear_strategy_default.json`) |
| `POST_NOTIFICATIONS` | push (FCM) — heavy retention copy (see 1.4) |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (type 0x2) on a `MediaSessionService` | background/lock-screen playback + media controls |
| `WAKE_LOCK`, `VIBRATE`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH` | player; BT is a TTVideoEngine/LiteAV audio-route dependency |
| `READ_PHONE_STATE`, `READ_BASIC_PHONE_STATE` | device fingerprinting for ad SDKs/attribution (unusual for a video app) |
| `com.google.android.gms.permission.AD_ID`, `ACCESS_ADSERVICES_AD_ID/_ATTRIBUTION/_TOPICS/_CUSTOM_AUDIENCE` | GAID + full Android **Privacy Sandbox** attribution/Topics/FLEDGE |
| `BIND_GET_INSTALL_REFERRER_SERVICE` | Play Install Referrer (AppsFlyer/Adjust) |
| `com.android.vending.CHECK_LICENSE` | Play Licensing (pairip) |
| Samsung `READ_APP_INFO`, Huawei `GET_COMMON_DATA`, `com.oplus.ocs.permission.third`, `com.amazon.privacypass.ATTEST` | OEM attribution / Amazon Privacy Pass attestation — ad-SDK baggage |
| `com.google.android.c2dm.permission.RECEIVE` | FCM |
| No storage, camera, location, `SYSTEM_ALERT_WINDOW` in manifest (though a "Turn on floating window permissions" string exists — PiP prompt) |

### 1.3 SDK inventory
| Group | Evidence |
|---|---|
| **Video player** | **ByteDance TTVideoEngine / BytePlus VOD** (`com/ss/ttvideoengine` ×887, `libttmplayer.so`, `libttffmpeg.so`, `libByteVC1_dec.so` = ByteDance proprietary codec, `libavmdlv2.so` = Media Data Loader for preload/P2P-ish caching, `libvcn.so`, engine tag `2.10.232.201-tob-widevine`). **Tencent LiteAV/TXPlayer** also bundled (`libliteavsdk.so`, `libtxffmpeg.so`, `com/tencent/liteav`, `com/tencent/rtmp`, a `.lic` asset for LiteAV). Plus **Media3 1.9.3/1.10.0** (session, ui) and **ExoPlayer 2.18.1/2.18.2** (mostly ad-SDK internals; `MBridge_ExoPlayer`). ABR config asset `vod_settings/vod_gear_strategy_default.json`: WiFi max resolution index 3, cellular max index 1, speed-predict window 100, startup bandwidth model. Dubbing model in player: `DubbedInfo`, `getDubbedAudios`, `isEnablePreloadDubbedAudio`, local DB column `isDubbing` — **separate dubbed-audio tracks muxed at play time, preloaded**. Subtitles: WebVTT ×66, `Subtitle` ×455. Speed: `setSpeed` ×19, `playbackSpeed`. |
| **DRM / anti-capture** | Widevine strings present inside TTVideoEngine (`WidevineDrm doKeyRequest failed`), HLS `#EXT-X-KEY`, `AES-128`, `ClearKey` in Media3; `setSecure` ×2 (likely SurfaceView secure flag), no `FLAG_SECURE` literal. The Short Play SDK has its own `internal/Encrypt`, `internal/AES`, `TokenHelper` → **encrypted playback-token scheme + short-lived video models**, not full DRM. Assessment: encrypted/tokenised HLS-style delivery via ByteDance CDN; Widevine capability exists but nothing indicates the catalog is Widevine-packaged. |
| **Payments** | Google Play Billing present (`com/android/billingclient` ×37, `ProductDetails` ×71, `SUBS` ×30, `acknowledgePurchase`) but **no app-level store copy at all** — the app markets itself as "All Dramas Free to Watch" / "No Payment Required". Billing is most likely pulled in by AppsFlyer purchase-connector (`afpurchases.db` backup rule) and ad SDKs. No Razorpay/Paytm/PhonePe/UPI SDK (the 11 `UPI` hits are unrelated tokens). No web checkout. |
| **Ads (the real business model)** | Enormous waterfall/mediation: **TopOn/ThinkUp** mediation (`com/thinkup` ×2719, adapters `VungleTU*`), **AppLovin MAX** 13.6.x, **AdMob/GMA** (+ AD_MANAGER_APP), **Meta Audience Network** (dynamic dex), **Pangle** 8.1.0.3, **BIGO Ads**, **InMobi** 10.7.x, **Mintegral** (MAL_17.1.61), **Vungle/Liftoff**, **Unity Ads**, **Moloco**, **Opera Ads**, **Yandex Mobile Ads** (Russian rewarded-ad copy shipped), **TaurusX**, **AdMaster** (`cc/admaster`, incl. `MobRewardVideoActivity`), **SmartDigiMkt** (`SDMSplashAd`, `SDMNativeAd`, adx bid floors), IronSource stub, IAB **OMSDK 1.6.5** and MRAID bridges. Ad formats by string volume: native ×2258, interstitial ×956, banner ×1121, splash ×374, app-open ×200, rewarded ×645 ("RewardVideo" ×145). Gamified ad templates in `assets/template/` (`ecPlayable`, `video904`, `customWebview`) with "lucky bag", "shake to jump", "slide puzzle", "red packet", "double reward" copy. |
| **Attribution / analytics / crash** | **AppsFlyer 6.17.3** (+purchase connector), **Adjust** (android5.4.4), **Firebase** Analytics + Crashlytics + Messaging + Remote Config + Sessions, **Yandex AppMetrica** (`io/appmetrica` ×2529), **Meta App Events**, ByteDance **AppLog/bdtracker** + **APM Insight** (`libapminsight*.so`, `libnms.so`), Play **Integrity API** (standard + express), Facebook "integrity/ProtectedMode" managers. |
| **Push** | FCM (`FirebaseMessagingService`), default channel "Now playing" (media session). |
| **Growth** | App Links: `https` with `autoVerify=true` on 2 hosts + custom scheme `microshort://`; `smsto`/`sms` share intents; Facebook Login + CustomTab; queries for Facebook/Instagram/Snapchat/YouTube packages (share targets). Install-referrer. Rate-us prompt copy ("Your five-star review inspires us…"). |
| **Image loading** | Picasso ×91, Coil ×10, Glide ×14 (light — ad SDKs), Compose image. |
| **Localisation / dubbing** | Server-driven language switch ("Switch language to watch the short drama.", "Install Language", `Dub.`/`Orig.` toggles). |
| **AI / TTS** | No TTS engine; the only "AI" is copy ("AI has matched this show…"). |
| **Other** | Room, WorkManager, DataStore, MMKV (`libadmastermmkv.so`), Cronet via Play Services, Protobuf, `com.blankj.utilcode`, BRVAH (Chinese `brvah_load_*` strings left untranslated). |

### 1.4 Product features inferred (app-own string names are obfuscated, e.g. `aspeest`)
- **Positioning**: free, ad-supported. Copy: "Watch For Free", "All Dramas Free to Watch", "No Payment Required", "Premium Drama", "Exclusive Popular Picks".
- **Content model**: Pangle Short Play SDK API — `ShortPlay`, `EpisodeData`, `ShortPlayCategory`, `Tag`, `FeedListLoadResult`, `CategoryListResultListener`, `ShortPlayBlockResultListener` (server-side geo/legal blocking: "Playback is not supported in the current region", "Sorry, this short drama has been removed."). Detail page = `ShortPlayDetailFragment` with `DrawItemEpisodeData` interleaved with `DrawItemAdData` → **ads inserted as swipe items between episodes** (`DrawAdProvider`). `PSSDK$RevenueInfo{AdFormat, CurrencyType, RevenueType}` → per-impression revenue callback = **ByteDance pays per ad impression**.
- **Unlock mechanic**: `ControlStatus`, `IControlStatusView`, `isLocked`, `mUnlockedIndexSet`, `isFullyUnlocked`, `isForbiddenScrollToUnlock`, `getWatchAdCtaText`, `watchAdButtonParams` → episodes lock after N free ones and unlock by **rewarded ad**, with scroll-past-lock forbidden. `"%s episodes left"` counter. No coins/VIP/packs (VIP/Vip hits are all SDK-internal).
- **Resume UX**: "Continue current playback or start from Ep.1?", "Last Watched", "Last Viewed", "History", `"%s｜%d Episodes"`, "Episode %d", "Completed / On Going" status.
- **Discovery**: Home, Discover, Rankings, Viewer's Picks, Most Saved, New Arrivals/New Releases, "Over 5,000 watching:", Top Search Queries, "Recommended for you", "Because you…"-style similar-show copy. Genres: Counterattack Drama, Costume Time Travel, Family Ethics, Sweet Romance, Suspense & Mystery, Urban Workplace, Dark Romance | Thriller.
- **Onboarding taste picker**: "Choose Your Favorites", "For you, your style", "Female" (gender), "Experience a Range of Emotions", "Diverse Genres".
- **Lists**: My List / Add to My List / Already in My List / Watch Later / follow ("You haven't followed any dramas yet").
- **Notifications = the retention engine** (~35 push templates): "Your followed drama is updated", "Launch tomorrow %s" / "Launching in" / "Launch Alert" (pre-release countdown), "Stopped at Episode X? The most exciting twist is about to start!", "Don't miss out! After you left, the plot of %1$s has taken a shocking reversal.", "Congratulations! The progress bar is 90% loaded…", "Done with work? The unfinished drama is waiting…", "Shhh! Quiet reminder…", "Return to Episode 8 now…", pre-permission primer ("Drama launch alerts—check notifications", "New drama alert! Enable notifications, watch first").
- **Player**: PiP / "floating window permissions for unrestricted viewing", swipe-up-to-close ("%ss Swipe up to close"), dub/orig toggle, subtitle, speed, preload of next episodes (`VideoEnginePreload`), "Playback error. Tap to retry".
- **Not found**: daily check-in, streaks, lottery/spin, referral, coin store, account deletion, grievance/support channel, parental/age gate (only the ad SDKs' "Age Restricted User" flag), downloads/offline (`download` hits are ad-SDK app-download flows). No ₹/INR/UPI/Hindi product cues.
- **Oddity**: "Recover photos / Recover videos / Recover files / Photos icon / Files icon" strings live in the app's own resource table — template reuse from a file-recovery app (or cloaking scaffolding). Worth noting when judging this developer's seriousness.

### 1.5 Pricing / copy tables
None. No pack, coin, price, bonus-% or VIP strings exist in any locale. Only ad-SDK reward copy: "Watch the video for %s seconds to get rewards…", "View for %d seconds to get the reward", "Limited-Time Privilege: AD free", "Limited-Time Privilege: Double Rewards".

### 1.6 Localisation
- 103 locale folders, but that is library baggage. **App-own copy (182 strings) is translated into exactly 6 locales: `pt-rPT`, `in-rID`, `th-rTH`, `ja-rJP`, `ko-rKR`, `es-rES`** (163–164 of 182 each). English default.
- **Hindi/Tamil/Telugu/Bengali/Marathi/etc.: 39/479 strings and every one is a Google/Material/AdMob library string** — zero product copy in any Indic language. India is not a target market for this build.
- Translations are reasonably idiomatic (e.g. ja "無料視聴", ko "결제 필요 없음"), consistent register — reads like a professional/LLM pass, not raw MT; a few glitches ("Continuar reproducción o empezar desde Ep.1?" without ¿). Untranslated Chinese (`brvah_load_*`) and Russian (Yandex rewarded copy) leak in.
- `supportsRtl=true` (Arabic/Hebrew lib strings only).

### 1.7 Quality / security signals
| Signal | Value |
|---|---|
| Obfuscation | R8 + pairip: 10,019 classes under `com/microshort/drama`, 4,535 with ≤2-char names; resource names randomised (`aspeest`, `charttex.xml`); component names randomised |
| Debuggable | not set (false) |
| `usesCleartextTraffic` | **true**, and network-security-config `base-config` has `cleartextTrafficPermitted=true` **and trusts `user` CAs in release** (`<certificates src="user"/>` in base-config, not just debug-overrides) → trivially MITM-able; weak for a "protected" app |
| `allowBackup` | false; `fullBackupContent` + `dataExtractionRules` exclude AppsFlyer data only |
| `extractNativeLibs` | false (page-aligned libs) |
| Exported | 123 activities / 18 services / 11 receivers / 21 providers; exported set is standard SDK surface (AppLovin/Mintegral/AdMaster reward activities, AppMetrica service/provider, WorkManager, FCM) — no app-specific exported deep-link handlers beyond the launcher |
| Integrity | Play Integrity (standard + express), pairip licensing, Frida/Xposed/emulator/root detection strings (mostly inside ad SDKs and Pangle `libpglarmor.so`) |
| Debug residue | `activity_debug.xml`, `applog_activity_simulate.xml`, AppLovin creative-debugger panel strings, `NATIVE_AD_DEBUGGER_ENABLED` meta-data, `DEBUG` ×92 |

---

## 2. "M+short" = `com.mmvideo11` 6.0 ("VideoStatus")

### 2.1 Identity
15.3 MB single APK; minSdk **21**, targetSdk **30** (would be rejected by Play today), compileSdk 30. Native Java (no Kotlin builtins; unobfuscated `com.mmvideo11.Activity.*` names — 37 app classes). Native libs for **7 ABIs incl. `mips`, `mips64`, `armeabi`** (dead ABIs): `libjpge/libjpgd/libJniBitmapOperator/libJniYuvOperator/libyuv-decoder` — image/YUV helpers for the video-status editor. Meta Audience Network dynamic dex in `assets/audience_network.dex`.

### 2.2 Permissions (36)
Storage read/write + `MANAGE_DOCUMENTS` + `requestLegacyExternalStorage`, `CAMERA`, `RECORD_AUDIO`, `RECORD_VIDEO`, `FLASHLIGHT` (it is a status recorder), `FOREGROUND_SERVICE` (exported `Upload_Service`), `RECEIVE_BOOT_COMPLETED`, C2DM/FCM, install-referrer, and **15 OEM launcher-badge permissions** (ShortcutBadger). No AD_ID declared despite AdMob/FAN.

### 2.3 SDKs
ExoPlayer **2.10.3** (with HLS/DASH/Widevine/ClearKey/`EXT-X-KEY` modules — generic bundle, app uses it for MP4 status clips), Glide + Picasso, Retrofit/OkHttp, Gson, mp4parser (`com/coremedia/iso`) for trim/merge, **AdMob + Meta Audience Network** (rewarded/interstitial), **OneSignal** push, Firebase Auth/Messaging/Analytics, Facebook Login + Share + Places, Google Sign-In, **Amazon IAP** (`com/amazon/device/iap` — template leftover), Huawei HMS stubs, SpinKit. No attribution SDK, no crash reporter beyond Firebase.

### 2.4 Product features
Splash → Welcome slides ("Best Place to Find everything you need", "…add Store on Social Media") → Login/Registration/Forgot (email+password, Google, Facebook) → Home / Latest Status / Latest Dance / Most View Dance / New Arrival / Category / Users list / Top Users / Profile / My Favourites / My Downloaded Status / Upload Video (Record, Trim, Sound list, Post) / **Earn Points** (`EarnPointActivity`, `add_earnpoint`, rewarded video) / **Payment Details** + `WithDrawalModel` (creator points → payout) / Rate app / Share app / Day-night toggle / Clear cache / Language switch. Comments, "Related Books" (template leakage). No episodes, no coins, no paywall, no drama.

### 2.5 Pricing copy — none.

### 2.6 Localisation
Ships `values-hi/ta/te/bn/mr/gu/kn/ml/pa/ur` etc., but the 115-string translated set is again library strings; app copy (96 strings) is English-only. `change_language` exists but drives server content language.

### 2.7 Quality
No obfuscation; `allowBackup=true`; `usesCleartextTraffic=true` with an NSC that whitelists two developer domains for cleartext; `largeHeap=true`; `org.apache.http.legacy`; targetSdk 30; exported `Upload_Service`; dead ABIs inflate size. Low engineering quality — a purchased template.

---

## 3. "myshort" = `cm.aptoide.pt` 9.22.5.3 (Aptoide store)

### 3.1 Identity
20.1 MB; minSdk **16**, targetSdk 32; Kotlin + RxJava + Epoxy; ABIs arm64/armeabi-v7a/x86/x86_64 with only `libsentry*.so`. Lottie reaction animations (`like/love/laugh/thug.json`).

### 3.2 Permissions
Store-class: `INSTALL_PACKAGES`, `REQUEST_INSTALL/DELETE_PACKAGES`, `QUERY_ALL_PACKAGES`, accounts (`GET/MANAGE/AUTHENTICATE_ACCOUNTS`, `USE_CREDENTIALS`), sync settings, storage, camera (QR via zxing), AD_ID, install referrer, boot-completed, `INSTALL_SHORTCUT`.

### 3.3 SDKs
Sentry (native NDK), Firebase Crashlytics/Messaging/Analytics/RemoteConfig, **Flurry**, Rakam analytics, Facebook Login/App Events, Google Sign-In, AdMob (rewarded), Play Billing (`querySkuDetails`) + AppCoins wallet, Moshi/Gson, Glide/Picasso, Room, WorkManager, DataStore, SafetyNet, zxing, FileDownloader. ExoPlayerLib 2.4.2 (trailer playback).

### 3.4 Product
App store: Home/Editorial, Search widget, Downloads/Updates/Installed, Stores, AppCoins "Aptoide Wallet" bonus ("You'll get up to %s%% Bonus for every purchase…", "Earn Aptoide Balance", "Install to get %1$s in Aptoide balance"), reactions on editorials. Nothing drama-related (4 keyword hits, all "short" as in abbreviation).

### 3.5 Pricing — AppCoins bonus copy only (above).

### 3.6 Localisation — genuinely localised store (Hindi 840/911 strings, plus bn/mr/pa/ta/te partial); professional translations.

### 3.7 Quality — R8-obfuscated (108 `a/b/c` packages, app classes kept), `allowBackup=false`, NSC pins a bundled CA + system, user CAs only in debug-overrides, no cleartext flag; targetSdk 32 dated. Solid, but irrelevant to Katha.

---

## 4. Cross-app comparison

| Dimension | MicroShort | "M+short" (VideoStatus) | "myshort" (Aptoide) | Katha (today) |
|---|---|---|---|---|
| Is it a micro-drama app | Yes (ByteDance Short Play SDK wrapper) | No | No | Yes |
| Stack | Kotlin + Compose/XML, R8 + pairip | Java template, no obfuscation | Kotlin/Rx | SwiftUI iOS + Next.js web + FastAPI |
| min/target SDK | 28 / 36 | 21 / 30 | 16 / 32 | — |
| Player | TTVideoEngine + LiteAV + Media3 session; ABR asset; dubbed-audio tracks; preload | ExoPlayer 2.10.3 (MP4) | ExoPlayer 2.4.2 | hls.js / AVPlayer HLS |
| Content protection | Token/AES-encrypted models; Widevine-capable engine; `setSecure` | none | n/a | capture shield + playback auth |
| Monetisation | 100 % ads (15+ networks, TopOn+MAX mediation, rewarded-to-unlock) | rewarded ads → points → withdrawal | AppCoins bonus | coins: 10 free eps, 30 coins ≈ ₹4.5/ep, bundle −25 %, web UPI +10 % |
| Attribution | AppsFlyer + Adjust + AppMetrica + Firebase + Meta | Firebase only | Flurry/Rakam/Firebase | — |
| Push | FCM, ~35 retention templates | OneSignal | FCM | notifications screen exists |
| Locales (own copy) | en + pt/id/th/ja/ko/es; **no Indic** | en only | en + full Hindi etc. | en/hi per copy deck |
| Cleartext / user-CA | allowed + user CAs trusted | allowed | no | TLS edge proxy |
| Backup | off | **on** | off | — |
| Retention hooks | push storytelling, follow/My List, launch countdown, resume prompt | none | none | check-in, streaks planned |
| Account/DPDP | none visible | email login | account | grievances, DPDP tools, parental PIN |

## 5. What Katha should copy / avoid (product + technical only)

**Copy**
1. **Story-aware push templates** keyed to progress state (MicroShort: "Stopped at Episode X?", "progress bar is 90 % loaded", "Launch tomorrow %s", "the plot of %1$s has taken a shocking reversal"). Katha already has an events pipeline + outbox; add a `last_episode`/`pct_complete`/`is_finale` template family, and a *pre-launch countdown* for slate titles.
2. **Notification pre-permission primer** with a value promise ("New drama alert! Enable notifications, watch first") before the OS dialog — MicroShort ships both the primer and the decline path ("Maybe Later").
3. **Resume prompt on re-entry**: "Continue current playback or start from Ep.1?" plus explicit "Last Watched" and "%s episodes left" counters — cheap, visible on the series page.
4. **Follow / My List / Watch Later + "Your followed drama is updated"** as the hook for weekly-drop titles.
5. **Onboarding taste picker** (gender + genre chips: "Choose Your Favorites") feeding the personalised rails Katha already has.
6. **Dubbed audio as separate tracks, preloaded** (`DubbedInfo`, `isEnablePreloadDubbedAudio`) with a `Dub./Orig.` toggle in-player — the right architecture for Hindi/Tamil/Telugu dubs vs. re-encoding whole episodes.
7. **Network-aware ABR ceilings** (`cellular_max_resolution_index=1` vs WiFi 3) — for Indian mobile data, cap cellular default bitrate server-side via `/v1/config`.
8. **Server-side region/rights blocking with a specific user message** ("Playback is not supported in the current region", "this short drama has been removed") — Katha's rights-gated ingest already needs a client string for this.
9. **Ads interleaved as swipe items** between episodes (`DrawItemAdData`) is worth a *limited* test only as a "watch an ad to unlock this episode" alternative to coins for low-ARPU cohorts — MicroShort's `getWatchAdCtaText` + `isForbiddenScrollToUnlock` pattern (lock is a hard stop, not skippable by swiping). Keep it a rewarded, opt-in unlock in the ledger, not interstitials.
10. **Play App Bundle split, arm64-only, `extractNativeLibs=false`** when Katha ships Android — MicroShort's 37 MB native split shows why.

**Avoid**
1. **Building on a third-party content SDK**: MicroShort has no catalog, no player, no pricing of its own — everything is `PSSDK`; the "removed"/"region" strings show the aggregator can pull titles. Katha's owned-catalog stance is the right call (see `no-pirated-content` memory).
2. **15-network ad waterfalls**: 116 MB install, `READ_PHONE_STATE`, Privacy Sandbox + OEM permissions, Russian/Chinese ad copy leaking into UI, "shake/lucky-bag/red-packet" gamified ads. This is what a DPDP-compliant, ₹-priced product should not look like.
3. **Trusting user CAs and cleartext in release NSC** (MicroShort) — keep Katha's TLS edge-only posture; never add `src="user"` outside `debug-overrides`.
4. **Zero Indic localisation** — MicroShort's 103 locale folders are an illusion (39/479 strings, all library). Katha's copy deck must own Hindi first-class, not rely on `values-hi` scaffolding.
5. **No account deletion / support / grievance / age-gate** (MicroShort has none; the only "parental" strings are Media3 defaults). Katha already exceeds this — keep it visible in-app.
6. **`allowBackup=true` + template leftovers** (M+short: Amazon IAP, "Related Books", dead MIPS ABIs; MicroShort: "Recover photos" strings) — signals shipped to reviewers and to Play's policy scanners; keep the manifest/resources tight.
7. **Making the paywall invisible**: MicroShort's "No Payment Required" is only possible because ByteDance subsidises it. Katha's coin ladder should stay explicit and server-rendered (as it is), but borrow MicroShort's *framing* copy around free episodes ("Watch For Free", "The first three episodes have sky-high ratings…") for the 10 free episodes.

**Caveat for the team**: two of the three inputs were not micro-drama apps, so the comparison is effectively MicroShort vs. Katha. If the real "M+ Short" / "MyShort" builds are obtained, this same pipeline (unzip → `aapt2` badging/permissions/xmltree/resources → dex string counts → filtered string tables) runs in minutes; scripts are in `/private/tmp/claude-501/-Users-pawankumar-Desktop-Katha/d3a71510-2308-44d4-9a97-4ebe087dbe72/scratchpad/td/` (`strs.py`, `parse_res.py`, `filt.py`).
