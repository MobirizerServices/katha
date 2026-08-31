# Katha — Copy Deck v0.1
### Every user-facing string: App Store, onboarding, paywall, errors, push, web, support

| | |
|---|---|
| **Status** | Draft for Design + Growth + Legal review. Source of truth for English copy; the localisation source file. |
| **Scope** | App Store listing · onboarding · home and browse · player and paywall · coin store and wallet · settings, account and trust · empty, error and offline states · push and CRM library · marketing site · support articles · legal microcopy. |
| **Consistency** | Strings marked ✅ already appear in the mockups (`Katha_iOS_Design_v0.3.html`, `Katha_Website_v0.1.html`, `Katha_WebApp_v0.1.html`) and must not be reworded without updating those files. |
| **Localisation** | Every string ships in **English, Hindi, Tamil, Telugu**. Hindi/Tamil/Telugu are **transcreated, not translated** — see §12. |

---

## 1. Voice

**Katha sounds like a friend who respects your money and your time.**

| We are | We are not |
|---|---|
| Plain — "Unlock this episode", not "Continue your journey" | Salesy — no "Hurry!", no fake scarcity, no countdown we invented |
| Specific — "30 coins ≈ ₹4.5" | Vague — "affordable", "premium experience" |
| Calm about money — always show the balance and the price together | Cute about money — coins are money, not gems or diamonds |
| Warm in the mother tongue — "aapka", "unga", "mee" | Stiffly formal or English-transliterated Hindi |
| Honest about locks — "10 episodes free, then 30 coins each" | Coy — never hide the paywall until the viewer hits it |

**Mechanics.** Sentence case everywhere except the wordmark. No exclamation marks except in a celebration state (max one per screen). Numerals as digits. **₹ before the number, no space** (₹99). Coins as plain numbers with the word ("120 coins"). Never say "free trial", "subscription" or "membership" in v1 — none of them are true.

**Banned words:** unlimited, exclusive (unless contractually true), premium, journey, curated, seamless, revolutionary, binge-worthy, addictive.

---

## 2. Naming

| Thing | Copy | Never |
|---|---|---|
| The app | **Katha** | "Katha App", "KathaTV" |
| Currency | **coins** | gems, diamonds, tokens, credits |
| A title | **series** | show, drama, content |
| An instalment | **episode** (E11 in compact UI) ✅ | part, chapter, clip |
| Unlocking | **unlock** ✅ | buy, purchase, rent (an unlock is permanent — say so) |
| Free run | **the first 10 episodes** ✅ | free trial, sample |
| Saved list | **My list** ✅ | watchlist, favourites |

---

## 3. App Store listing (India, English — then localise)

**Name (30 chars max)**
> `Katha: Short Dramas in 2 Min` *(28)*

**Subtitle (30 chars max)**
> `Hindi, Tamil & Telugu series` *(28)*

**Promotional text (170 chars, editable without review — use it for the weekly drop)**
> New this week: *Kaanch Ka Mahal* in Hindi and *Vetri Vaasal* in Tamil. First 10 episodes of every series are free. No ads, ever.

**Keywords (100 chars, comma-separated, no spaces, no plurals, don't repeat the name/subtitle)**
> `web series,hindi drama,tamil,telugu,short film,serial,vertical,romance,thriller,offline,reels,story`

**Description**

> **Stories in 2 minutes. In your language. No ads.** ✅
>
> Katha is made for the way you actually watch — standing in a queue, on the bus, in the ten minutes before sleep. Every episode is 60 to 90 seconds. Every one ends somewhere you didn't expect.
>
> **Watch 10 episodes free** ✅
> Start any series and the first 10 episodes are free. No sign-up wall, no card, no trial that charges you later. If you want to keep going, you unlock the next episode for 30 coins — about ₹4.5. That unlock is yours permanently.
>
> **Originals in your language** ✅
> Hindi, Tamil and Telugu series shot in real Indian places — a Lucknow haveli, a Madurai kabaddi mat, a Vizag coaching centre. Family dramas, thrillers, romance, revenge, comedy. New series every week, with English subtitles and dubs.
>
> **Never an ad** ✅
> Not before the episode, not in the middle, not ever. You pay for what you watch and nothing else.
>
> **Built for an Indian phone**
> Works on 4G. ✅ Data saver mode. Picks up where you left off, on any device.
>
> **Ratings and a parental lock** ✅
> Every series is rated and described up front. Set a PIN and lock anything above your comfort level.
>
> **How coins work** ✅
> Coin packs start at ₹99. Bigger packs cost less per coin. Coins never expire while your account exists. A 60-episode series costs about ₹170 with the series bundle. Check in daily for free coins.
>
> Questions, refunds or a complaint: katha.app/support

**What's New (template)**
> New this week: [Series] in [language], plus [n] more. We also [fixed thing users noticed]. Tell us what to fix next: katha.app/support

**Screenshot captions (6)**
1. Stories in 2 minutes. In your language.
2. First 10 episodes free. Every series.
3. No ads. Not one.
4. Unlock an episode for about ₹4.5.
5. Hindi, Tamil, Telugu — with subtitles and dubs.
6. Ratings and a parental lock, built in.

**Age rating:** 12+ (matches a U/A 13+ ceiling). **Privacy nutrition label** must match the §15 data map — get it reviewed by counsel before submission, mismatches are a common rejection.

---

## 4. Onboarding

| Screen | Copy |
|---|---|
| Language picker (H) | Which language do you watch in? |
| Language picker (sub) | You can add more later in Settings. |
| Language options | हिन्दी · தமிழ் · తెలుగు · English |
| Taste picker (H) | What do you like? |
| Taste picker (sub) | Pick 3 or more. It only shapes your Home. |
| Taste chips | Family drama ✅ · Romance · Revenge · Thriller · Fantasy · Comedy · Workplace · Sports |
| Skip | Skip for now ✅ |
| Value screen (H) | Ten free episodes are waiting. ✅ |
| Value screen (body) | Start any series and watch the first 10 for free. No account needed until you want to buy coins. |
| Primary CTA | Start watching |
| Notification pre-prompt (H) | Want to know when the next episode drops? |
| Notification pre-prompt (body) | We'll tell you when a series you're watching adds episodes. Nothing else. |
| Pre-prompt buttons | Yes, notify me · Not now ✅ |

**Sign-in (only when required — first purchase, or restoring)**

| String | Copy |
|---|---|
| Header | Sign in to keep your unlocks |
| Body | Your unlocks and coins are tied to your account, so they follow you to a new phone. |
| Buttons | Sign in with Apple ✅ · Continue with phone ✅ · Continue as guest ✅ |
| OTP header | Enter the code ✅ |
| OTP sub | Sent to +91 [number]. It expires in 5 minutes. |
| OTP resend | Resend code · Resend in 0:{ss} |
| Alt | Use Apple instead ✅ |
| Guest warning | As a guest, your unlocks stay on this phone only. Sign in any time to save them. |

---

## 5. Home, browse, search

| Element | Copy |
|---|---|
| Rails | Continue watching ✅ · Trending this week ✅ · New series ✅ · Trending in Hindi ✅ · Top in Telugu ✅ · Up next in Hindi ✅ · Because you finished [Series] · Free to start · Finish in one sitting |
| Rail action | See all ✅ |
| Series card badges | New · E{n} today · 10 free ✅ · Dubbed · Finale |
| Series page CTA (new) | Play episode 1 ✅ |
| Series page CTA (returning) | Continue E{n} |
| Free-run line | First 10 episodes free ✅ |
| Metadata line | {n} episodes · {Language} · {Genre} · {Rating} |
| Dub label | Dubbed and subtitled ✅ |
| Save | My list ✅ |
| Saved toast | Saved to My list |
| Search placeholder | Search in Hindi ✅ |
| Search empty | No results ✅ |
| Search empty sub | Try a genre — romance, thriller, family — or clear your filters. |
| Filters cleared | Clear filters ✅ |
| Browse header | Browse series ✅ |

**Rail-naming rule:** a rail name must state *why these are together*. "Recommended for you" is banned; "Because you finished *Kaanch Ka Mahal*" is the pattern.

---

## 6. Player and paywall

### 6.1 Player

| Element | Copy |
|---|---|
| Episode chip | E{n} · {series} |
| Autoplay toggle | Autoplay trailers ✅ |
| Muted preview setting | Muted previews on Home ✅ |
| Subtitles menu | Subtitles · Off · English ✅ · हिन्दी · தமிழ் · తెలుగు |
| Audio menu | Audio · Original · Hindi dub · Tamil dub · Telugu dub |
| Quality | Auto · Data saver ✅ |
| Recording blocked ✅ | Recording isn't supported ✅ |
| Recording blocked sub | Playback pauses while your screen is being recorded. |
| Series end ✅ | You finished ✅ *{Series}*. |
| Series end sub | More like this, in {language}: |

### 6.2 Paywall sheet (PDD §8.4 — over the paused frame)

| State | Copy |
|---|---|
| Header | Unlock episode {n} ✅ |
| Sub | You've watched the 10 free episodes. |
| Price row | 30 coins · about ₹4.5 |
| Balance (enough) ✅ | You have 120 coins ✅ |
| Primary CTA | Unlock this episode |
| Secondary | Unlock all {n} remaining — save 25% ✅ |
| Bundle detail | {n} episodes · {coins} coins · about ₹{amount} |
| Auto-unlock toggle ✅ | Auto-unlock next episodes ✅ |
| Auto-unlock helper | Off by default. We'll only charge when an episode starts playing, and you can switch this off from the player any time. |
| Auto-unlock toast | −30 coins · E{n} unlocked |
| Restore | Restore purchases ✅ |
| Not enough ✅ | Not enough coins ✅ |
| Not enough sub | You have {n}. This episode needs 30. |
| Not enough CTA | Get coins ✅ |
| Dismiss | Keep watching free episodes ✅ |
| Permanence line | Unlocked episodes stay yours. |

**Paywall rules for writers:** never a countdown, never "only today", never a strikethrough price we didn't actually charge. The 25% bundle discount is real and stated as a rupee number. The paused frame behind the sheet is the *sell* — copy stays short so the frame shows.

### 6.3 Purchase states

| State | Copy |
|---|---|
| Ask to Buy pending ✅ | Waiting for approval ✅ |
| Ask to Buy sub | We've asked the family organiser. You haven't been charged yet. ✅ |
| Payment failed | That payment didn't go through |
| Payment failed sub | Nothing was charged. Try again, or use a different payment method in your Apple ID settings. |
| Payment failed CTA | Try again · Not now |
| Success | {n} coins added |
| Success sub | Enough for {n} episodes ✅ |
| Restore success | Restored. Your unlocks are back. |
| Restore nothing | Nothing to restore on this Apple ID. |
| Refund clawback | {n} coins were removed for a refunded purchase. ✅ |
| Negative balance | Your balance is −{n} coins. Add coins to unlock again. |

---

## 7. Coin store and wallet

| Element | Copy |
|---|---|
| Header | Get coins ✅ |
| Sub | Coins unlock episodes. 30 coins ≈ ₹4.5 an episode. |
| Pack labels | Starter · **Popular** ✅ · Value · Binge · Mega |
| Pack badges | Most chosen ✅ · Lowest price per coin ✅ · Best for binge weekends ✅ |
| Pack helper (₹99) | Enough for 20 episodes ✅ |
| Pack helper (₹199) | About two or three series ✅ |
| Pack helper (₹499) | About five series ✅ |
| First-purchase offer | Double coins on your first pack |
| First-purchase helper | One time, on your first purchase. Applies to the Starter pack. |
| Wallet header | Your coins |
| Wallet balance | {n} coins |
| Wallet breakdown | {n} bought · {n} earned |
| Spend order note | Earned coins are spent first. |
| Expiry note | Coins never expire while your account exists. |
| History header | Coin history |
| History rows | −30 · E{n} of {Series} · Unlocked · Refunded |
| Daily check-in ✅ | Claim today's 5 coins ✅ |
| Streak ✅ | Day 3 of your streak ✅ |
| Streak reward | 7 days in a row: 25 bonus coins |
| Streak broken | Streak reset. Start again today. |
| How coins work ✅ | How coins work ✅ |

**GST/pricing microcopy (legal — do not reword without counsel):** *Prices are set by the App Store and include GST. Payment is taken by Apple.*

---

## 8. Settings, account, trust

| Element | Copy |
|---|---|
| App language ✅ | App language ✅ |
| Content languages ✅ | Content languages ✅ |
| Content languages sub | Which languages appear on your Home. |
| Data saver ✅ | Data saver ✅ |
| Data saver sub | Lower quality on mobile data. Saves about 60% of data. |
| Downloads (P2) | Downloads |
| Parental lock ✅ | Parental lock ✅ |
| Parental lock sub | Hide series rated above your setting. Needs a PIN to change. |
| Set PIN ✅ | Set a 4-digit PIN ✅ |
| PIN wrong | That PIN doesn't match. |
| Report ✅ | Report a series or episode ✅ |
| Report sub | Tell us what's wrong. We review every report. |
| Report reasons | Wrong rating · Offensive content · Technical problem · Copyright · Something else |
| Report sent | Thanks. We've logged it and someone will look at it. |
| Complaint ✅ | File a complaint ✅ |
| Sign out ✅ | Sign out ✅ |
| Delete account ✅ | Delete my account ✅ |
| Delete warning | This deletes your account, your history and **your coins and unlocks**. It can't be undone, and coins can't be refunded. |
| Delete confirm | Delete my account ✅ · Keep my account ✅ |
| Delete done | Your account is scheduled for deletion. You'll get a confirmation within 30 days. |

---

## 9. Empty, error and offline states

**Rule:** name what happened, say whether it cost anything, give one action. Never "Oops", never "Something went wrong", never a raw error code in the headline.

| State | Headline | Body | Action |
|---|---|---|---|
| My list empty ✅ | Nothing saved yet ✅ | Tap the bookmark on any series to keep it here. | Browse series ✅ |
| Continue watching empty | You haven't started a series | The first 10 episodes of every series are free. | Watch a free episode ✅ |
| Coin history empty | No coins spent yet | Unlocks will show up here. | — |
| Offline | You're offline | We'll pick up where you left off when you reconnect. | Try again |
| Connection lost mid-play ✅ | Connection lost ✅ | Your place is saved at {mm:ss}. | Retry |
| Playback failed | This episode won't play | Nothing was charged. We're looking into it. | Try again · Report |
| Episode unavailable | This episode isn't available | It may have been removed for a rights or compliance reason. Coins you spent on it have been returned. | See the series |
| Series removed | This series is no longer on Katha | Your unlocked episodes stay yours where we can still show them; otherwise your coins have been returned. | Browse series |
| Region blocked | Not available in your region | Katha is available in India and selected App Store regions. | — |
| Server error | We're having a problem | Nothing was charged. Try again in a minute. | Try again |
| Rate limited | Too many attempts | Wait a minute and try again. | — |
| App update required | Update Katha to keep watching | This version can no longer play episodes. | Update |

---

## 10. Push and CRM library

**Rules.** Max **2 pushes/week** per user, hard cap 1/day. Quiet hours 22:00–08:00 IST except a drop the user opted into. Every campaign runs against a **5% holdout**. Never push a paywall to a user who has never finished a free episode. Deep-link every push to the exact episode.

| # | Trigger | Title | Body | Deep link |
|---|---|---|---|---|
| 1 | E1 finished, 4 h idle | {Series} — E2 is waiting | You stopped right before the good part. | E2 |
| 2 | E9 finished, 2 h idle | One more free episode | E10 of {Series} is still free. | E10 |
| 3 | E10 finished, no unlock, 6 h | About {Series} | You've been at the same cliff for six hours. E11 answers it. | Paywall |
| 4 | Drip drop, opted in | Two new episodes tonight | E{n} and E{n+1} of {Series} are up. | E{n} |
| 5 | Series completed | You finished {Series} | Here's what people watched next. | Similar rail |
| 6 | Daily check-in unclaimed, 20:00 | 5 coins are waiting | Day {n} of your streak. Claim before midnight. | Check-in |
| 7 | Streak about to break | Don't lose your {n}-day streak | Claiming takes a second. | Check-in |
| 8 | Balance < 30, has unlocked before | You're 1 episode short | {n} coins left. E{n} needs 30. | Coin store |
| 9 | Lapsed 7 days | {Series} added 6 episodes | You left off at E{n}. | E{n} |
| 10 | Lapsed 30 days | New in {language} this week | Three new series since you were last here. | Home |
| 11 | New language launch | Katha is now in {language} | {n} new series, first 10 episodes free. | Language home |
| 12 | Purchase failed | Your coin purchase didn't complete | Nothing was charged. | Coin store |
| 13 | Ask to Buy approved | Approved — your coins are in | {n} coins added. Back to E{n}? | E{n} |
| 14 | Refund processed | Your refund is complete | {n} coins were removed from your balance. | Wallet |

**Email/SMS (transactional only in v1):** OTP, purchase receipt, refund notice, account-deletion confirmation, grievance acknowledgement. No marketing email until an explicit opt-in exists.

**Never send:** "We miss you 😢" · "Your coins are lonely" · manufactured urgency about a price that isn't changing · anything implying an unlock will expire.

---

## 11. Marketing site (`katha.app`)

| Section | Copy |
|---|---|
| Hero H1 | Stories in 2 minutes. ✅ |
| Hero sub | In your language. No ads. ✅ |
| Hero CTA | Get the app ✅ |
| Hero secondary | Watch E1 free ✅ |
| QR helper | Scan with your iPhone camera. ✅ |
| Proof strip | First 10 episodes free ✅ · Never an ad ✅ · Works on 4G ✅ · Hindi, Tamil, Telugu |
| Section 2 H | How coins work ✅ |
| Section 2 body | Watch 10 episodes free. ✅ Unlock the next one ✅ for 30 coins — about ₹4.5. Packs start at ₹99, and coins never expire while your account exists. |
| Section 3 H | Originals in your language ✅ |
| Section 3 body | Series shot in real Indian places, with English subtitles ✅ and dubs. New titles every week. |
| Section 4 H | Ratings and a parental lock ✅ |
| Section 4 body | Every series is rated and described before you start. Set a PIN to lock anything above your comfort level. |
| FAQ H | Questions people ask ✅ |
| Partner H | Make the next binge. ✅ |
| Partner tabs | For studios ✅ · For creators ✅ · For brands ✅ |
| Studios | Studios and production houses ✅ — we commission Core original ✅, Lean original ✅ and Licensed catalogue ✅ titles on full buyout, and pay against six delivery gates. **Pitch a series** ✅ |
| Creators | Join the creator program ✅ — you direct, we fund, your name is on it. **Get paid** ✅ fairly and on time. |
| Brands | Brands and agencies ✅ — no ads inside episodes, ever. Talk to us ✅ about original branded series. |
| Footer legal | Terms · Privacy · Content ratings · Grievance officer ✅ · Refunds and cancellations ✅ |
| App CTA | Download on the App Store ✅ |
| Accessibility | Skip to content ✅ |

---

## 12. Localisation notes

**Transcreate, don't translate.** These strings are rewritten by a native writer with the English as intent, not source.

| Rule | Detail |
|---|---|
| Money | Keep ₹ and Western digits in all four languages. Say "about ₹4.5" — never a converted-looking decimal chain. |
| "Coins" | Use the natural local word (Hindi *सिक्के*), consistently everywhere. Never transliterate "coins" in Devanagari. |
| Address form | Hindi **आप**; Tamil **நீங்கள்**; Telugu **మీరు**. Formal, never the familiar form, even in push. |
| Series titles | Never translated. Show the native script with a transliteration where the UI has room. |
| Length | Hindi/Tamil/Telugu run **20–35% longer** than English. Buttons need two-line tolerance; test the paywall CTA at 35% overflow before locking the design. |
| Numerals in text | Digits, not spelled words, in all languages ("10 episodes", not "दस"). |
| Legal strings | GST/payment/refund/deletion microcopy is translated by counsel's translator, not the content team. |
| Do not localise | The wordmark "Katha", "App Store", "Apple", "UPI", episode codes (E11). |

---

## 13. Support articles (the ten that cover ~80% of contacts)

Each: a one-line answer first, then detail, then one action.

1. **How coins work** — 10 free, 30 coins ≈ ₹4.5 after; packs from ₹99; unlocks are permanent; coins never expire while the account exists.
2. **Why can't I watch episode 11?** — the free run is 10 episodes; how to unlock; the 25% series bundle.
3. **I bought coins but don't see them** — Apple can take a few minutes; how to Restore purchases; what to send us if it's still missing.
4. **Refunds and cancellations** ✅ — purchases go through Apple, so refunds are requested from Apple (reportaproblem.apple.com); a refunded purchase removes those coins; what happens if the balance goes negative.
5. **I changed my phone — where are my unlocks?** — sign in with the same Apple ID or phone number; guest unlocks live on one device only.
6. **Turn off auto-unlock** — where the toggle is in the player and the paywall; we only charge when an episode starts playing.
7. **Change languages or subtitles** ✅ — app language vs content languages vs per-episode subtitles and dubs.
8. **Set a parental lock** — PIN setup, what each rating means, what a locked series looks like.
9. **Report a series or episode** ✅ — how, what happens next, and our response time.
10. **Delete my account** ✅ — what is deleted, what happens to coins and unlocks, the 30-day confirmation.

**Support macro tone:** answer in the first sentence, no "we sincerely apologise for the inconvenience". If money is involved, say the money outcome in that first sentence.

---

## 14. Legal microcopy (verify with counsel before shipping)

| Placement | String |
|---|---|
| Coin store footer | Prices are set by the App Store and include GST. Payment is taken by Apple. |
| Paywall footer | Unlocked episodes remain available in your account. Coins are not refundable except as required by law or by Apple. |
| Rating chip | U/A 13+ · Family conflict, mild peril |
| Dubbed titles | Dubbed. Original language: {language}. |
| AI subtitles | Subtitles generated with assistance and reviewed by our team. |
| Grievance (site footer) ✅ | Grievance Officer: {name}, {email}, {address}. We acknowledge complaints within 24 hours and resolve within 15 days, per the IT Rules, 2021. |
| Age gate | Katha is for viewers 12 and over. Some series are rated higher. |

> ⚠️ **Blocker:** the grievance-officer name, email and address are still placeholders on the website. A named officer is a **legal prerequisite for beta**, not a launch-week task.

---

## 15. What still needs a decision

1. **Web playback wording.** The web app's copy currently implies paid episodes play in the browser; PDD §5.3/§16 put that at P2. Until that is decided, the web CTA should read **"Unlock and watch in the app"**, not "Watch now". Same open item as the review log.
2. **First-purchase offer name.** "Double coins on your first pack" tests against "2× your first pack" — pick one and freeze it; it appears in the store, the paywall and two pushes.
3. **Do we ever say "save"?** The bundle line says "save 25%". If Legal wants a reference-price disclosure, the string becomes "25% less than unlocking one by one" — decide before the store screenshots are cut.
4. **Guest mode.** Copy assumes guests can watch free episodes without an account. If the final build requires sign-in at E1, §4 and §5 both change.
