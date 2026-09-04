import XCTest

// E2E UI tests: every design-board screen, driven through the real app against
// the live core-api on 127.0.0.1:8799 (start it with `make api` first).
//
// Determinism: each test launches with KATHA_RESET=1 (defaults wiped → fresh
// guest, 0 coins) and KATHA_ONBOARDED=1 (skip onboarding) unless it is testing
// those states themselves. KATHA_AUTOPLAY jumps straight into the player.
//
// Query style: SwiftUI merges a link/button's children into one accessibility
// element, so container taps use `buttons.containing(label CONTAINS …)`; plain
// Texts are asserted directly.
final class KathaAppUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @discardableResult
    private func launchApp(reset: Bool = true, onboarded: Bool = true,
                           extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        var env: [String: String] = ["KATHA_ALLOW_CAPTURE": "1",   // device runs are recorded
                                     "KATHA_FAKE_IAP": "1",        // no StoreKit sheet under XCUITest (DEBUG-only hook)
                                     "KATHA_FAKE_APPLE": "1"]      // no Apple ID sheet either (DEBUG-only hook)
        if reset { env["KATHA_RESET"] = "1" }
        if onboarded { env["KATHA_ONBOARDED"] = "1" }
        extra.forEach { env[$0] = $1 }
        app.launchEnvironment = env
        app.launch()
        dismissLocalNetworkPrompt()
        return app
    }

    /// iOS resets the Local Network grant on a fresh install and throws its
    /// system alert mid-run — with nobody to tap Allow, every LAN request
    /// (playback, covers) blackholes and the player shows "Connection lost".
    /// Headless device runs accept it here.
    private func dismissLocalNetworkPrompt() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
    }

    private func assertExists(_ element: XCUIElement, _ timeout: TimeInterval = 12) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "missing: \(element)")
    }

    private func tapWhenReady(_ element: XCUIElement, _ timeout: TimeInterval = 12) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), "never appeared: \(element)")
        element.tap()
    }

    private func button(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.buttons.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    // MARK: 1.1–1.3 Splash → language → interests → home

    func test01_OnboardingFlow() {
        let app = launchApp(onboarded: false)

        // 1.1 splash auto-advances to 1.2 (first launch pays the install tax)
        assertExists(app.staticTexts["Which languages do you watch in?"], 40)
        assertExists(app.staticTexts["Coming soon"], 5)
        tapWhenReady(button(app, containing: "Hindi"))
        tapWhenReady(app.buttons["Continue"])

        // 1.3 interests
        assertExists(app.staticTexts["What do you like watching?"], 8)
        tapWhenReady(button(app, containing: "Romance"))
        tapWhenReady(button(app, containing: "Revenge"))
        tapWhenReady(app.buttons["Continue"])

        // lands on the home feed
        assertExists(app.staticTexts["Daily check-in"], 20)
    }

    // MARK: 2.1 Home + check-in claim

    func test02_HomeFeedAndCheckin() {
        let app = launchApp()
        assertExists(app.staticTexts["Daily check-in"], 20)
        assertExists(app.staticTexts["Trending in हिन्दी"], 10)
        tapWhenReady(app.buttons["Claim"])
        // deterministic post-state: the claimed card leaves the feed
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.staticTexts["Daily check-in"])
        waitForExpectations(timeout: 12)
    }

    // MARK: 2.4 Series page + 4.4 My list

    func test03_SeriesPageAndMyList() {
        let app = launchApp()
        assertExists(app.staticTexts["Trending in हिन्दी"], 20)
        tapWhenReady(button(app, containing: "Kaanch Ka Mahal"))

        assertExists(app.staticTexts["Free · 10 episodes, then 30 coins (≈ ₹4.5) each"], 12)
        assertExists(app.staticTexts["U/A 13+"], 5)
        tapWhenReady(app.buttons["Save to My list"])

        // 4.4: saved series appears under the My list tab
        tapWhenReady(app.tabBars.buttons["My list"])
        assertExists(button(app, containing: "Kaanch Ka Mahal"), 10)
    }

    // MARK: 2.2 Browse filters

    func test04_BrowseFilters() {
        let app = launchApp()
        tapWhenReady(app.tabBars.buttons["Browse"])
        assertExists(app.buttons["Everything"], 12)
        tapWhenReady(app.buttons["தமிழ்"])
        assertExists(button(app, containing: "Kadhal Kanakku"), 10)
        tapWhenReady(app.buttons["All"])
        assertExists(button(app, containing: "Kaanch Ka Mahal"), 10)
    }

    // MARK: 2.3 Search

    func test05_Search() {
        let app = launchApp()
        assertExists(app.staticTexts["Daily check-in"], 20)
        // Coordinate tap: the toolbar can re-render mid-tap and break re-resolution.
        let search = app.buttons["Search"].firstMatch
        assertExists(search, 12)
        // The toolbar can swallow a tap while the hero/rails re-render on a
        // real device: retry a few times until SearchView is up.
        for _ in 0..<4 where !app.staticTexts["Trending"].exists {
            if search.exists { search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
            if app.staticTexts["Trending"].waitForExistence(timeout: 4) { break }
        }
        assertExists(app.staticTexts["Trending"], 10)     // SearchView is up
        let field = app.textFields.firstMatch          // the inline 2.3 search bar
        assertExists(field, 6)
        field.tap()
        field.typeText("kaanch")
        tapWhenReady(button(app, containing: "Kaanch Ka Mahal"))
        assertExists(app.staticTexts["Free · 10 episodes, then 30 coins (≈ ₹4.5) each"], 12)
    }

    // MARK: 3.1 Player (free episode) + 3.2 episode drawer

    func test06_PlayerAndDrawer() {
        let app = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        assertExists(app.staticTexts["E1 · One face too many"], 20)
        assertExists(app.sliders.firstMatch, 8)          // scrubber (chrome visible)

        // 3.2: the drawer opens from the right rail and can jump episodes
        tapWhenReady(app.buttons["E1"].firstMatch)
        assertExists(app.switches.containing(
            NSPredicate(format: "label CONTAINS 'Auto-unlock'")).firstMatch, 8)
        tapWhenReady(app.buttons["2"].firstMatch)
        assertExists(app.staticTexts["E2 · The seventh plate"], 15)
    }

    // MARK: 3.3 Paywall + 3.4 packs + the real unlock tap

    func test07_PaywallBuyAndUnlock() {
        let app = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:11"])

        // locked E11 → the sheet presents itself in the insufficient state
        assertExists(app.staticTexts["Unlock E11"], 20)
        assertExists(app.staticTexts["You have 0"], 8)
        assertExists(app.buttons["Get coins"], 5)
        assertExists(app.staticTexts["Save 25%"], 5)

        // 3.4: buy the starter pack inline (dev-stubbed StoreKit)
        tapWhenReady(button(app, containing: "600 coins"))
        assertExists(app.staticTexts["You have 600"], 12)

        // the money tap: Unlock episode → sheet dismisses → E11 plays
        tapWhenReady(app.buttons["Unlock episode"])
        assertExists(app.staticTexts["E11 · The signature"], 15)
        assertExists(app.sliders.firstMatch, 8)
    }

    // MARK: 3.5 Wallet & history

    func test08_WalletBuyAndHistory() {
        let app = launchApp()
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        tapWhenReady(button(app, containing: "Wallet"))
        assertExists(app.staticTexts["Balance"], 10)
        assertExists(app.staticTexts["Get coins"], 8)

        // buy the Popular pack → history gains a "Coin pack" row
        tapWhenReady(button(app, containing: "1,300 coins"))
        assertExists(app.staticTexts["History"], 12)
        assertExists(app.staticTexts["Coin pack"], 8)
        assertExists(app.buttons["Restore purchases"], 5)
    }

    // MARK: 4.1 Profile + 1.4/1.5/5.2 login sheet (phone → OTP)

    func test09_LoginWithOtp() {
        let app = launchApp()
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        assertExists(app.staticTexts["You're browsing as a guest"], 10)
        tapWhenReady(app.buttons["Sign in"])

        // 1.4 phone step (field pre-filled with "+91 ", so query by kind not placeholder)
        assertExists(app.staticTexts["Save your coins and your place"], 8)
        let phone = app.textFields.firstMatch
        assertExists(phone, 5)
        phone.tap()
        phone.typeText("9876501234")
        tapWhenReady(app.buttons["Get OTP"])

        // 1.5 OTP step (dev build: any 4 digits; auto-verifies on the 4th)
        assertExists(app.staticTexts["Enter the code"], 10)
        let otp = app.textFields.firstMatch
        assertExists(otp, 5)
        otp.tap()
        otp.typeText("4321")

        // signed in: Sign out appears on the profile
        assertExists(app.buttons["Sign out"], 15)
    }

    // MARK: 4.2 Settings + 4.3 parental lock end to end

    func test10_SettingsAndParentalLock() {
        let app = launchApp()
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        tapWhenReady(button(app, containing: "Settings"))
        assertExists(app.switches["Data saver"], 10)
        assertExists(app.switches["New episode alerts"], 5)

        // set the PIN 1-2-3-4 — entered twice (the sheet confirms it)
        tapWhenReady(app.buttons["Set parental lock"])
        assertExists(app.staticTexts["Set a parental PIN"], 8)
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        assertExists(app.staticTexts["Confirm the new PIN"], 8)
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        assertExists(app.buttons["Change parental lock"], 8)
        // changing or removing the lock asks for the CURRENT pin first
        tapWhenReady(app.buttons["Remove parental lock"])
        assertExists(app.staticTexts["Remove parental lock"], 8)
        for digit in ["9", "9", "9", "9"] { app.buttons[digit].tap() }   // wrong: refused, still locked
        assertExists(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Wrong PIN'")).firstMatch, 8)
        app.swipeDown()                                                   // dismiss the sheet
        assertExists(app.buttons["Change parental lock"], 8)

        // relaunch KEEPING state into a U/A 16+ title → the gate asks for the PIN
        let gated = launchApp(reset: false,
                              extra: ["KATHA_AUTOPLAY": "dilli-6-ka-raaz:1"])
        assertExists(gated.staticTexts["Parental lock"], 20)
        for digit in ["1", "2", "3", "4"] { gated.buttons[digit].tap() }
        assertExists(gated.sliders.firstMatch, 15)       // player chrome = playing
    }

    // MARK: 4.6 Help & grievance + 4.7 delete account

    func test11_HelpAndDeleteAccount() {
        let app = launchApp()
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        // iOS 27 beta can restore the previous run's pushed stack — pop to root.
        for _ in 0..<3 where !app.staticTexts["You're browsing as a guest"].exists {
            let back = app.navigationBars.buttons.firstMatch
            if back.exists { back.tap() } else { break }
        }
        tapWhenReady(button(app, containing: "Help & grievance"))
        // Smaller phones: the contact links sit below the assistant card.
        if !app.links["grievance@katha.example"].waitForExistence(timeout: 4) { app.swipeUp() }
        assertExists(app.links["grievance@katha.example"], 10)
        app.navigationBars.buttons.firstMatch.tap()      // back to Profile

        tapWhenReady(button(app, containing: "Settings"))
        app.swipeUp()                                    // small screens: row is below the fold
        tapWhenReady(app.buttons["Delete account"])      // opens the sheet
        assertExists(app.staticTexts["Delete your account?"], 8)
        tapWhenReady(app.switches.containing(
            NSPredicate(format: "label CONTAINS 'I understand'")).firstMatch)
        // two "Delete account" buttons exist now (settings row + sheet confirm)
        tapWhenReady(app.buttons.matching(identifier: "Delete account").element(boundBy: 1))

        // sheet dismisses; back out to Profile — a fresh guest again. The pop
        // can be swallowed while the post-delete refresh runs, so retry it.
        assertExists(app.staticTexts["Settings"], 10)
        for _ in 0..<4 where !app.staticTexts["You're browsing as a guest"]
            .waitForExistence(timeout: 3) {
            let back = app.navigationBars.buttons.firstMatch
            if back.exists { back.tap() }
        }
        assertExists(app.staticTexts["You're browsing as a guest"], 5)
    }

    // MARK: 5.1 error state (backend unreachable) + retry control

    func test12_FeedErrorState() {
        let app = launchApp(extra: ["KATHA_API_BASE": "http://127.0.0.1:9"])
        assertExists(app.staticTexts["Can't reach Katha"], 20)
        assertExists(app.buttons["Retry"], 5)
    }

    private func text(_ app: XCUIApplication, containing s: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    private func openSettings(_ app: XCUIApplication) {
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        for _ in 0..<3 where !app.staticTexts["You're browsing as a guest"].exists
            && !app.buttons["Sign out"].exists {
            let back = app.navigationBars.buttons.firstMatch
            if back.exists { back.tap() } else { break }
        }
        tapWhenReady(button(app, containing: "Settings"))
        assertExists(app.switches["Data saver"], 10)
    }

    /// Phone → OTP sign-in from the Profile tab (the 1.4/1.5 flow of test09).
    private func signInWithPhone(_ app: XCUIApplication) {
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        tapWhenReady(app.buttons["Sign in"])
        assertExists(app.staticTexts["Save your coins and your place"], 8)
        let phone = app.textFields.firstMatch
        assertExists(phone, 5)
        phone.tap()
        phone.typeText("9876501234")
        tapWhenReady(app.buttons["Get OTP"])
        assertExists(app.staticTexts["Enter the code"], 10)
        let otp = app.textFields.firstMatch
        assertExists(otp, 5)
        otp.tap()
        otp.typeText("4321")
        assertExists(app.buttons["Sign out"], 15)
    }

    // MARK: 3.4 Packs sheet: pending (Ask to Buy) and failed states

    func test13_PacksSheetAndPending() {
        // KATHA_FAKE_IAP=pending → CoinStore answers .pending without a sheet.
        let app = launchApp(extra: ["KATHA_FAKE_IAP": "pending"])
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        tapWhenReady(button(app, containing: "Wallet"))
        assertExists(app.staticTexts["Get coins"], 10)
        tapWhenReady(button(app, containing: "All packs"))
        assertExists(app.staticTexts["Coin packs"], 8)
        tapWhenReady(app.buttons["pack.coins_starter_in"])
        assertExists(app.staticTexts["Confirming with the App Store. Your episode unlocks automatically."], 8)
        assertExists(app.staticTexts["You haven't been charged yet."], 5)
        assertExists(text(app, containing: "family organizer"), 5)
        tapWhenReady(app.buttons["Done"])
        assertExists(app.staticTexts["Balance"], 8)          // back on the wallet

        // Failed purchase, reached from the paywall's "Get coins".
        let failed = launchApp(extra: ["KATHA_FAKE_IAP": "failed",
                                       "KATHA_AUTOPLAY": "kaanch-ka-mahal:11"])
        assertExists(failed.staticTexts["Unlock E11"], 20)
        tapWhenReady(failed.buttons["Get coins"])
        assertExists(failed.staticTexts["Coin packs"], 8)
        tapWhenReady(failed.buttons["pack.coins_popular_in"])
        assertExists(text(failed, containing: "Payment didn't go through. You weren't charged."), 8)
        assertExists(failed.buttons["Retry"], 5)
        assertExists(failed.buttons["Restore purchases"], 5)
    }

    // MARK: 4.5 Continue watching, full list

    func test14_ContinueWatchingList() {
        let app = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        assertExists(app.staticTexts["E1 · One face too many"], 20)
        assertExists(app.sliders.firstMatch, 8)
        // Leaving the player flushes progress; Home's task then reloads the row.
        app.navigationBars.buttons.firstMatch.tap()
        assertExists(app.staticTexts["Daily check-in"], 15)
        if !app.buttons["continue.seeAll"].waitForExistence(timeout: 8) {
            tapWhenReady(app.tabBars.buttons["My list"])     // loadEngagement
            tapWhenReady(app.tabBars.buttons["Home"])
        }
        tapWhenReady(app.buttons["continue.seeAll"])
        assertExists(app.navigationBars["Continue watching"], 10)
        let row = button(app, containing: "Kaanch Ka Mahal")
        assertExists(row, 10)
        XCTAssertTrue(row.label.contains("E1"), "row should name the episode: \(row.label)")
        row.tap()
        assertExists(app.staticTexts["E1 · One face too many"], 20)   // → player
    }

    // MARK: 2.3 Search: Series + People sections, person page

    func test15_SearchPeople() {
        // KATHA_STUB_SEARCH: the People answer comes from the DEBUG stub while
        // /v1/search is still being added server-side (drop the env once it
        // is live — the screen already calls the real endpoint otherwise).
        let app = launchApp(extra: ["KATHA_STUB_SEARCH": "1"])
        assertExists(app.staticTexts["Daily check-in"], 20)
        let search = app.buttons["Search"].firstMatch
        assertExists(search, 12)
        search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        if !app.staticTexts["Trending"].waitForExistence(timeout: 5), search.exists {
            search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        assertExists(app.staticTexts["Trending"], 10)
        let field = app.textFields.firstMatch
        assertExists(field, 6)
        field.tap()
        field.typeText("aditi")
        assertExists(app.staticTexts["People"], 12)
        let person = button(app, containing: "Aditi Rawal")
        assertExists(person, 8)
        XCTAssertTrue(person.label.contains("Lead"), person.label)
        XCTAssertTrue(person.label.contains("series"), person.label)
        person.tap()
        assertExists(app.navigationBars["Aditi Rawal"], 10)
        tapWhenReady(button(app, containing: "Kaanch Ka Mahal"))
        assertExists(app.staticTexts["Free · 10 episodes, then 30 coins (≈ ₹4.5) each"], 12)

        // Series section still answers a title query.
        app.navigationBars.buttons.firstMatch.tap()
        app.navigationBars.buttons.firstMatch.tap()
        assertExists(app.textFields.firstMatch, 8)
        app.buttons["Clear search"].tap()
        app.textFields.firstMatch.tap()
        app.textFields.firstMatch.typeText("kaanch")
        assertExists(app.staticTexts["Series"], 12)
        assertExists(button(app, containing: "Kaanch Ka Mahal"), 8)
    }

    // MARK: 4.2 App language (English / हिन्दी) + muted previews toggle

    func test16_AppLanguageAndPreviews() {
        let app = launchApp()
        openSettings(app)
        let previews = app.switches.containing(
            NSPredicate(format: "label CONTAINS 'Muted previews'")).firstMatch
        assertExists(previews, 8)
        // A List toggle is a switch element wrapping the real control; tap the
        // innermost one so the tap lands on the knob, not the label.
        let knob = previews.switches.firstMatch.exists ? previews.switches.firstMatch : previews
        XCTAssertEqual(knob.value as? String, "1")              // default on
        knob.tap()
        XCTAssertTrue(knob.waitForValue("0", timeout: 3), "toggle did not turn off")

        // Switch the app language: tab titles + Settings re-render in Hindi.
        tapWhenReady(app.segmentedControls.buttons["हिन्दी"])
        assertExists(app.tabBars.buttons["होम"], 8)
        assertExists(app.tabBars.buttons["प्रोफ़ाइल"], 5)
        assertExists(app.switches["डेटा सेवर"], 5)
        assertExists(app.navigationBars["सेटिंग्स"], 5)
        // Content language stays its own setting (still हिन्दी / தமிழ் / తెలుగు).
        tapWhenReady(app.segmentedControls.buttons["English"])
        assertExists(app.tabBars.buttons["Home"], 8)
        assertExists(app.switches["Data saver"], 5)
    }

    // MARK: 4.3 Forgot PIN → OTP to the account phone → lock removed

    func test17_ForgotPin() {
        let app = launchApp()
        signInWithPhone(app)
        tapWhenReady(button(app, containing: "Settings"))
        tapWhenReady(app.buttons["Set parental lock"])
        assertExists(app.staticTexts["Set a parental PIN"], 8)
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        assertExists(app.staticTexts["Confirm the new PIN"], 8)
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        tapWhenReady(app.buttons["Change parental lock"])
        assertExists(app.staticTexts["Enter your current PIN"], 8)
        tapWhenReady(app.buttons["Forgot PIN?"])
        assertExists(app.staticTexts["Reset the parental lock"], 8)
        tapWhenReady(app.buttons["Send code"])
        assertExists(app.staticTexts["Enter the code"], 10)
        let code = app.textFields["pin.reset.code"]
        assertExists(code, 5)
        code.tap()
        code.typeText("2468")                                   // dev build: any 4 digits
        assertExists(app.staticTexts["Parental lock removed"], 10)
        assertExists(app.buttons["Set parental lock"], 8)       // lock is gone
        XCTAssertFalse(app.buttons["Remove parental lock"].exists)
    }

    // MARK: 4.4 Reminders: the bell on the series page and in My list

    func test18_Reminders() {
        let app = launchApp()
        assertExists(app.staticTexts["Trending in हिन्दी"], 20)
        tapWhenReady(button(app, containing: "Kaanch Ka Mahal"))
        assertExists(app.staticTexts["U/A 13+"], 12)
        tapWhenReady(app.buttons["Save to My list"])
        tapWhenReady(app.buttons["Remind me"])
        assertExists(app.staticTexts["We'll nudge you when a new episode drops"], 6)
        assertExists(app.buttons["Reminder on"], 6)

        // My list shows the same state and can turn it off.
        tapWhenReady(app.tabBars.buttons["My list"])
        assertExists(button(app, containing: "Kaanch Ka Mahal"), 10)
        assertExists(app.staticTexts["Reminder on"], 8)
        tapWhenReady(app.buttons["Reminder on"])
        assertExists(app.staticTexts["Reminder turned off"], 6)
        assertExists(app.staticTexts["Remind me"], 6)
    }

    // MARK: 4.6 Help assistant

    func test19_HelpAssistant() {
        let app = launchApp()
        assertExists(app.staticTexts["Daily check-in"], 20)
        tapWhenReady(app.tabBars.buttons["Profile"])
        tapWhenReady(button(app, containing: "Help & grievance"))
        tapWhenReady(button(app, containing: "Chat with us"))
        assertExists(text(app, containing: "Ask me about coins"), 10)
        assertExists(text(app, containing: "no AI service is contacted"), 5)

        // A suggested question answers from the FAQ.
        tapWhenReady(app.buttons["Refunds and cancellations"])
        assertExists(text(app, containing: "reportaproblem.apple.com"), 8)

        // Free text, Hinglish: matched by keyword.
        let input = app.textFields["assistant.input"]
        assertExists(input, 5)
        input.tap()
        input.typeText("paid but coins nahi mile")
        tapWhenReady(app.buttons["assistant.send"])
        XCTAssertTrue(text(app, containing: "Restore purchases").waitForExistence(timeout: 8),
                      "Hinglish question should route to the missing-coins answer")

        // A person steps in when needed: the grievance form.
        tapWhenReady(app.buttons["Talk to a person"])
        assertExists(app.textFields["Your email or phone"], 8)
        assertExists(app.buttons["File grievance"], 5)
    }

    // MARK: 3.1 Player: CC picker, double-tap like, long-press 2×, swipe next

    func test20_PlayerTracksAndGestures() {
        let app = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        assertExists(app.staticTexts["E1 · One face too many"], 20)
        assertExists(app.sliders.firstMatch, 8)

        // CC → the picker lists Off + the payload's caption languages.
        tapWhenReady(app.buttons["player.cc"])
        assertExists(app.staticTexts["Subtitles"], 8)
        assertExists(app.buttons["captions.off"], 5)
        // Caption rows come from subs/*.vtt beside the media (make seed-media
        // writes hi + en); a catalog without subtitle files lists only Off.
        if app.buttons["captions.hi"].waitForExistence(timeout: 3) {
            app.buttons["captions.hi"].tap()
            XCTAssertTrue(app.buttons["captions.hi"].isSelected)
        }
        tapWhenReady(app.buttons["Done"])                        // dismiss the sheet
        XCTAssertTrue(app.staticTexts["Subtitles"].waitForNonExistence(timeout: 5))
        assertExists(app.sliders.firstMatch, 8)

        // Double-tap = like (same as the rail heart).
        let surface = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        surface.doubleTap()
        assertExists(app.buttons["Liked"], 6)

        // Long-press = 2× while held; releasing returns to normal playback.
        surface.press(forDuration: 1.2)
        assertExists(app.sliders.firstMatch, 5)
        XCTAssertFalse(app.staticTexts["2×"].exists)

        // The vertical swipe still advances to the next episode.
        app.swipeUp()
        assertExists(app.staticTexts["E2 · The seventh plate"], 15)
    }
}

private extension XCUIElement {
    /// Poll `value` (switch "0"/"1") instead of a fixed sleep.
    func waitForValue(_ expected: String, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if (value as? String) == expected { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return (value as? String) == expected
    }
}
