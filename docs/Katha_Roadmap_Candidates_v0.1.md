# Katha — Roadmap candidates v0.1 (4 September 2026)

Candidates distilled from the competitor teardown (`Katha_Competitor_Teardown_v0.1.md`)
and the "Verso" pitch review. Each item names the surface, the size, and what it
depends on. None is scheduled yet; ordering is a proposal.

## Recommended for the next cycle

| # | Item | Surface | Size | Why now | Depends on |
|---|---|---|---|---|---|
| R1 | **Consent step at first run (DPDP).** A notice + consent record before events, push registration or any analytics start; a "Data & privacy" row in Settings to review/withdraw; consent stored server-side on the profile. | iOS, web, core-api | S–M | Legal requirement we currently do not meet; both competitors reviewed also lack it. | Profile column (`consent_at`, `consent_scope`) via a migration |
| R2 | **App Attest before token issuance.** Guest and OTP token issuance gated on an attested device; guest→member merge only for attested guests (closes deferred review finding C6). | iOS, core-api | M | Stops scripted guest farming and merge abuse; the pattern (Play Integrity) is what the pitch and the teardown both point to. | Apple App Attest keys per device; a `device` row |
| R3 | **Offline library.** Download an unlocked episode (AVAssetDownloadTask) with an entitlement-bound, expiring licence; a Library screen; server endpoint to mint a download grant and record it in the ledger projections. | iOS, core-api | L | Commutes and data-saver users; every leader in the category ships it. | FairPlay (or AES-128 keys served behind the stream token) — the ingest tool already has `--encrypt` |
| R4 | **Retention cohorts on Analytics.** D1 / D7 / D14 / D30 per weekly signup cohort, per language, from the events table; category benchmark line (D1 27.5 %, D7 7.8 %, D14 5 %) shown for reference and marked unverified until sourced. | admin-api, admin | S | The board shows revenue and funnel but not the metric the category actually competes on. | none |

## Backlog

| # | Item | Surface | Size | Notes |
|---|---|---|---|---|
| B1 | Rewarded-video unlock as an opt-in alternative to coins when the balance is zero; a ledger `BONUS` credit with `reference_type="rewarded_ad"`, capped per day by config. | iOS, core-api | M | Needs an ad SDK decision; keep it to ONE mediation layer, consent-gated (R1). |
| B2 | "Next series" on the series end card, from the recommender. | iOS, web | S | Preload of the next episode exists; the cross-series hand-off does not. |
| B3 | Story-aware push templates keyed to progress (`stopped at E{n}`, finale tease, pre-launch countdown) + a pre-permission primer screen. | core-api, worker, iOS | M | Outbox + events already exist; the templates and the scheduler do not. |
| B4 | Background pipeline for transcode → QC → localization with event notification into Media & QC / Localization, replacing the manual status fields. | worker, admin | M | arq worker scaffold is in place; jobs are not. |
| B5 | Cellular vs Wi-Fi bitrate ceilings pushed from `/v1/config` (`player.max_bitrate_cellular`). | core-api, iOS, web | S | `PlayerEngine.bitrateCap` already exists behind the data-saver toggle. |
| B6 | Region/rights blocking with a specific user message when a title is pulled by the rights gate. | core-api, iOS, web | S | Ingest already records provenance; playback has no "removed" state. |
| B7 | Demo reel page from real device recordings (XCUITest result bundles already contain screen recordings). | docs | S | — |
| B8 | Android client. The Verso pitch's Compose / Media3 / Play Integrity stack is a reasonable starting point; contracts-first means the API needs no change. | new | XL | After iOS launch. |

## Open business decisions surfaced (not for engineering to settle)

- **Subscription / free trial** alongside coins (the Verso paywall shows "or start a free trial"). Already parked in the open-decisions list.
- **Ads at all.** B1 is only worth building if the business accepts an ad SDK in the app; the teardown argues for at most one mediation layer.

## Claims not to repeat

The Verso pitch states that "M+ Short shipped with TLS validation disabled" and used
"AES-ECB and an opaque native cipher". Our own analysis of the supplied binaries found
the M+ Short file to be a status-video template (not a drama app) and MicroShort to
allow cleartext and trust user-installed CAs; the ECB claim was not observed. Its
market figures are labelled sourced but are unverified here.
