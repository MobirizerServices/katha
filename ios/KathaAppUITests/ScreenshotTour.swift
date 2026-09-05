import XCTest

// Screenshot tour: navigates to every design-board screen and captures a PNG
// attachment per screen (numbered to match docs/Katha_iOS_Design_v0.3.html).
// Run alone:  xcodebuild test … -only-testing:KathaAppUITests/ScreenshotTour
// Extract:    xcrun xcresulttool export attachments --path <bundle.xcresult>
final class ScreenshotTour: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = true          // capture as much of the tour as possible
    }

    private func launchApp(reset: Bool = true, onboarded: Bool = true,
                           extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        var env: [String: String] = ["KATHA_ALLOW_CAPTURE": "1",   // device runs are recorded
                                     "KATHA_FAKE_IAP": "1",        // server stub, no App Store sheet (DEBUG-only hooks)
                                     "KATHA_FAKE_APPLE": "1"]
        if reset { env["KATHA_RESET"] = "1" }
        if onboarded { env["KATHA_ONBOARDED"] = "1" }
        extra.forEach { env[$0] = $1 }
        app.launchEnvironment = env
        app.launch()
        // Same guard as the main suite: a fresh install re-asks for Local
        // Network and the unanswered alert blackholes every LAN request.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.alerts.buttons["Allow"]
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        return app
    }

    private func snap(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func wait(_ app: XCUIApplication, text: String, _ timeout: TimeInterval = 15) {
        _ = app.staticTexts[text].waitForExistence(timeout: timeout)
    }

    private func button(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.buttons.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// The player chrome auto-hides after ~4 idle seconds; a tap while it is
    /// hidden only brings it back (it does not pause), so this is safe to call
    /// before any capture that is supposed to show the controls.
    private func revealChrome(_ app: XCUIApplication) {
        guard !app.sliders.firstMatch.exists else { return }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        _ = app.sliders.firstMatch.waitForExistence(timeout: 5)
    }

    /// Wait for the player, re-revealing the chrome if the idle timer hid the
    /// episode label before the wait started.
    private func waitPlayer(_ app: XCUIApplication, _ label: String,
                            _ timeout: TimeInterval = 25) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if app.staticTexts[label].waitForExistence(timeout: 5) { return }
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        }
    }

    func test01_TourOnboarding() {
        let app = launchApp(onboarded: false)
        // Wait for SwiftUI's first paint (the device is slower than the
        // simulator) so the splash capture shows the real screen, then shoot
        // within its ~1.2s display window.
        _ = app.staticTexts["Katha"].waitForExistence(timeout: 3)
        snap("1.1-splash")
        wait(app, text: "Which languages do you watch in?")
        snap("1.2-language-picker")
        button(app, containing: "Hindi").tap()
        app.buttons["Continue"].tap()
        wait(app, text: "What do you like watching?", 8)
        button(app, containing: "Romance").tap()
        button(app, containing: "Secret billionaire").tap()
        snap("1.3-interests")
        app.buttons["Continue"].tap()
        wait(app, text: "Daily check-in", 20)
    }

    func test02_TourDiscover() {
        let app = launchApp()
        wait(app, text: "Trending in हिन्दी", 20)
        snap("2.1-home")

        app.tabBars.buttons["Browse"].tap()
        _ = app.buttons["Everything"].waitForExistence(timeout: 10)
        app.buttons["தமிழ்"].tap()
        _ = button(app, containing: "Kadhal Kanakku").waitForExistence(timeout: 8)
        snap("2.2-browse-tamil-filter")
        app.buttons["All"].tap()

        app.tabBars.buttons["Home"].tap()
        // Coordinate taps: the header can re-render mid-tap (same guard as
        // the main suite's test05).
        let search = app.buttons["Search"].firstMatch
        _ = search.waitForExistence(timeout: 8)
        search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        if !app.staticTexts["Trending"].waitForExistence(timeout: 5), search.exists {
            search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            _ = app.staticTexts["Trending"].waitForExistence(timeout: 8)
        }
        let field = app.textFields.firstMatch          // inline 2.3 search bar
        _ = field.waitForExistence(timeout: 8)
        snap("2.3-search-empty")
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        field.typeText("kaanch")
        _ = button(app, containing: "Kaanch Ka Mahal").waitForExistence(timeout: 8)
        snap("2.3b-search-results")

        button(app, containing: "Kaanch Ka Mahal").tap()
        wait(app, text: "Free · 10 episodes, then 30 coins (≈ ₹4.5) each")
        snap("2.4-series-page")
        app.buttons["Save to My list"].tap()

        app.tabBars.buttons["My list"].tap()
        _ = button(app, containing: "Kaanch Ka Mahal").waitForExistence(timeout: 8)
        snap("4.4-my-list")
    }

    func test03_TourPlayerAndDrawer() {
        let app = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        waitPlayer(app, "E1 · One face too many")
        sleep(2)                                             // let a frame decode
        revealChrome(app)
        snap("3.1-player-free")
        revealChrome(app)
        app.buttons["E1"].firstMatch.tap()
        wait(app, text: "Episodes", 8)
        snap("3.2-episode-drawer")
    }

    func test04_TourMoney() {
        let app = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:11"])
        wait(app, text: "Unlock E11", 20)
        wait(app, text: "You have 0", 8)
        snap("3.3-paywall-insufficient")

        button(app, containing: "600 coins").tap()
        wait(app, text: "You have 600", 12)
        snap("3.3b-paywall-funded")
        _ = app.buttons["Unlock episode"].waitForExistence(timeout: 8)   // the sheet re-lays out after the buy
        app.buttons["Unlock episode"].tap()
        waitPlayer(app, "E11 · The signature")
        sleep(2)
        revealChrome(app)
        snap("3.1b-player-unlocked-E11")

        // back out to the wallet (history now shows purchase + unlock)
        revealChrome(app)
        app.navigationBars.buttons.firstMatch.tap()
        app.tabBars.buttons["Profile"].tap()
        _ = app.staticTexts["You're browsing as a guest"].waitForExistence(timeout: 10)
        snap("4.1-profile-guest")
        button(app, containing: "Wallet").tap()
        wait(app, text: "Balance", 10)
        wait(app, text: "History", 8)
        snap("3.5-wallet-history")
    }

    func test05_TourAccount() {
        let app = launchApp()
        wait(app, text: "Daily check-in", 20)
        app.tabBars.buttons["Profile"].tap()
        _ = app.buttons["Sign in"].waitForExistence(timeout: 10)
        app.buttons["Sign in"].tap()
        wait(app, text: "Save your coins and your place", 8)
        snap("1.4-login-phone")
        let phone = app.textFields.firstMatch
        phone.tap()
        phone.typeText("9876501234")
        app.buttons["Get OTP"].tap()
        wait(app, text: "Enter the code", 10)
        snap("1.5-login-otp")
        let otp = app.textFields.firstMatch
        otp.tap()
        otp.typeText("4321")
        _ = app.buttons["Sign out"].waitForExistence(timeout: 15)
        snap("4.1b-profile-member")

        button(app, containing: "Settings").tap()
        _ = app.switches["Data saver"].waitForExistence(timeout: 10)
        snap("4.2-settings")

        app.buttons["Set parental lock"].tap()
        wait(app, text: "Set a parental PIN", 8)
        snap("4.3-parental-pin-setup")
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        _ = app.staticTexts["Confirm the new PIN"].waitForExistence(timeout: 8)
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        _ = app.buttons["Change parental lock"].waitForExistence(timeout: 8)

        button(app, containing: "Help & grievance").tap()
        _ = app.links["grievance@katha.example"].waitForExistence(timeout: 10)
        snap("4.6-help-grievance")
        app.navigationBars.buttons.firstMatch.tap()

        app.buttons["Delete account"].tap()
        wait(app, text: "Delete your account?", 8)
        snap("4.7-delete-account")
    }

    func test06_TourGateAndStates() {
        // PIN gate needs a persisted PIN: set it, then relaunch into a 16+ title.
        let setup = launchApp()
        _ = setup.staticTexts["Daily check-in"].waitForExistence(timeout: 20)
        setup.tabBars.buttons["Profile"].tap()
        button(setup, containing: "Settings").tap()
        _ = setup.buttons["Set parental lock"].waitForExistence(timeout: 10)
        setup.buttons["Set parental lock"].tap()
        _ = setup.staticTexts["Set a parental PIN"].waitForExistence(timeout: 8)
        for digit in ["1", "2", "3", "4"] { setup.buttons[digit].tap() }
        _ = setup.staticTexts["Confirm the new PIN"].waitForExistence(timeout: 8)
        for digit in ["1", "2", "3", "4"] { setup.buttons[digit].tap() }
        _ = setup.buttons["Change parental lock"].waitForExistence(timeout: 8)

        let gated = launchApp(reset: false, extra: ["KATHA_AUTOPLAY": "dilli-6-ka-raaz:1"])
        wait(gated, text: "Parental lock", 20)
        snap("4.3b-pin-gate")

        // 5.1: backend unreachable
        let down = launchApp(extra: ["KATHA_API_BASE": "http://127.0.0.1:9"])
        wait(down, text: "Can't reach Katha", 20)
        snap("5.1-error-state")

        // 3.6: the in-app drop banner via the self-scheduled drip nudge
        let drop = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        waitPlayer(drop, "E1 · One face too many")
        sleep(3)                                             // accrue progress
        revealChrome(drop)
        drop.navigationBars.buttons.firstMatch.tap()         // back → progress reported
        let nudged = launchApp(reset: false, extra: ["KATHA_NUDGE_SECONDS": "4"])
        _ = nudged.buttons["Watch now"].waitForExistence(timeout: 25)
        snap("3.6-drop-banner")           // immediately — the banner lives 6 s
    }

    func test07_TourNewSurfaces() {
        // Watch a little so the "Because you watched" rail has a seed, then
        // relaunch — the feed personalizes on load, not on back-navigation.
        let seeded = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        waitPlayer(seeded, "E1 · One face too many")
        sleep(3)
        revealChrome(seeded)
        seeded.navigationBars.buttons.firstMatch.tap()
        sleep(1)                                     // progress report flushes

        let app = launchApp(reset: false)
        _ = app.staticTexts["Daily check-in"].waitForExistence(timeout: 20)
        _ = app.staticTexts.containing(
            NSPredicate(format: "label BEGINSWITH 'Because you watched'"))
            .firstMatch.waitForExistence(timeout: 10)
        app.swipeUp()
        sleep(1)
        snap("2.1b-home-personalized")

        // Profile → Invoices (GST register; empty for a fresh guest).
        app.tabBars.buttons["Profile"].tap()
        button(app, containing: "Invoices").tap()
        _ = app.staticTexts["Invoices"].waitForExistence(timeout: 10)
        sleep(1)
        snap("4.8-invoices")

        // 4.1d: the root after popping a pushed screen — the large title must
        // come back rather than staying collapsed to the small inline one.
        app.navigationBars.buttons.firstMatch.tap()
        _ = app.staticTexts["You're browsing as a guest"].waitForExistence(timeout: 10)
        sleep(1)
        snap("4.1d-profile-after-pop")

        // Help → the in-app grievance form.
        button(app, containing: "Help & grievance").tap()
        wait(app, text: "File a grievance", 10)
        app.swipeUp()
        sleep(1)
        snap("4.6b-grievance-form")
    }

    private func text(_ app: XCUIApplication, containing s: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }

    private func openSearch(_ app: XCUIApplication) {
        let search = app.buttons["Search"].firstMatch
        _ = search.waitForExistence(timeout: 12)
        search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        if !app.staticTexts["Trending"].waitForExistence(timeout: 5), search.exists {
            search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            _ = app.staticTexts["Trending"].waitForExistence(timeout: 8)
        }
        _ = app.textFields.firstMatch.waitForExistence(timeout: 8)
    }

    // Screens added after the v0.3 board: packs sheet, continue-watching list,
    // people search, app language, forgot-PIN, reminders, help assistant,
    // player track picker. Same numbering scheme as the board sections.
    func test08_TourNewScreens() {
        // --- 4.9 Packs sheet: list, pending, failed ---
        let packs = launchApp(extra: ["KATHA_FAKE_IAP": "pending"])
        wait(packs, text: "Daily check-in", 20)
        packs.tabBars.buttons["Profile"].tap()
        button(packs, containing: "Wallet").tap()
        wait(packs, text: "Get coins", 10)
        snap("3.5a-wallet-empty")
        button(packs, containing: "All packs").tap()
        wait(packs, text: "Coin packs", 8)
        sleep(1)
        snap("4.9-packs-list")
        packs.buttons["pack.coins_starter_in"].tap()
        wait(packs, text: "You haven't been charged yet.", 8)
        sleep(1)
        snap("4.9b-packs-pending")
        packs.buttons["Done"].tap()

        let failed = launchApp(extra: ["KATHA_FAKE_IAP": "failed",
                                       "KATHA_AUTOPLAY": "kaanch-ka-mahal:11"])
        wait(failed, text: "Unlock E11", 20)
        failed.buttons["Get coins"].tap()
        wait(failed, text: "Coin packs", 8)
        failed.buttons["pack.coins_popular_in"].tap()
        _ = text(failed, containing: "Payment didn't go through").waitForExistence(timeout: 8)
        sleep(1)
        snap("4.9c-packs-failed")

        // --- 4.5 Continue watching list + 4.4 reminder bell ---
        let cw = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        waitPlayer(cw, "E1 · One face too many")
        sleep(3)
        revealChrome(cw)
        cw.navigationBars.buttons.firstMatch.tap()
        wait(cw, text: "Daily check-in", 15)
        if !cw.buttons["continue.seeAll"].waitForExistence(timeout: 8) {
            cw.tabBars.buttons["My list"].tap()
            cw.tabBars.buttons["Home"].tap()
        }
        _ = cw.buttons["continue.seeAll"].waitForExistence(timeout: 8)
        snap("2.1c-home-continue-row")
        cw.buttons["continue.seeAll"].tap()
        _ = cw.navigationBars["Continue watching"].waitForExistence(timeout: 10)
        sleep(1)
        snap("4.5-continue-watching-list")
        cw.navigationBars.buttons.firstMatch.tap()
        _ = button(cw, containing: "Kaanch Ka Mahal").waitForExistence(timeout: 10)
        button(cw, containing: "Kaanch Ka Mahal").tap()
        wait(cw, text: "U/A 13+", 12)
        cw.buttons["Save to My list"].tap()
        cw.buttons["Remind me"].tap()
        _ = cw.buttons["Reminder on"].waitForExistence(timeout: 6)
        snap("2.4b-series-reminder-on")
        cw.swipeUp()
        sleep(1)
        snap("2.4c-series-episodes-scrolled")
        cw.tabBars.buttons["My list"].tap()
        _ = cw.buttons["Reminder on"].waitForExistence(timeout: 10)
        sleep(1)
        snap("4.4b-my-list-reminder-on")

        // --- 2.3 Search: People section + person page ---
        let s = launchApp(extra: ["KATHA_STUB_SEARCH": "1"])
        wait(s, text: "Daily check-in", 20)
        openSearch(s)
        let field = s.textFields.firstMatch
        field.tap()
        field.typeText("aditi")
        wait(s, text: "People", 12)
        sleep(1)
        snap("2.3c-search-people")
        button(s, containing: "Aditi Rawal").tap()
        _ = s.navigationBars["Aditi Rawal"].waitForExistence(timeout: 10)
        sleep(1)
        snap("2.3d-person-page")
        s.navigationBars.buttons.firstMatch.tap()
        _ = s.textFields.firstMatch.waitForExistence(timeout: 8)
        s.buttons["Clear search"].tap()
        s.textFields.firstMatch.tap()
        s.textFields.firstMatch.typeText("zzzz")
        sleep(2)
        snap("2.3e-search-no-results")

        // --- 4.2 Settings: previews toggle, Hindi, forgot PIN, delete ---
        let app = launchApp()
        wait(app, text: "Daily check-in", 20)
        app.tabBars.buttons["Profile"].tap()
        _ = app.buttons["Sign in"].waitForExistence(timeout: 10)
        app.buttons["Sign in"].tap()
        wait(app, text: "Save your coins and your place", 8)
        let phone = app.textFields.firstMatch
        phone.tap()
        phone.typeText("9876501234")
        app.buttons["Get OTP"].tap()
        wait(app, text: "Enter the code", 10)
        let otp = app.textFields.firstMatch
        otp.tap()
        otp.typeText("4321")
        _ = app.buttons["Sign out"].waitForExistence(timeout: 15)
        button(app, containing: "Settings").tap()
        _ = app.switches["Data saver"].waitForExistence(timeout: 10)
        let previews = app.switches.containing(
            NSPredicate(format: "label CONTAINS 'Muted previews'")).firstMatch
        _ = previews.waitForExistence(timeout: 8)
        let knob = previews.switches.firstMatch.exists ? previews.switches.firstMatch : previews
        knob.tap()
        sleep(1)
        snap("4.2b-settings-previews-off")
        app.swipeUp()
        sleep(1)
        snap("4.2c-settings-bottom")
        app.swipeDown()
        app.segmentedControls.buttons["हिन्दी"].tap()
        _ = app.switches["डेटा सेवर"].waitForExistence(timeout: 8)
        sleep(1)
        snap("4.2d-settings-hindi")
        app.swipeUp()
        sleep(1)
        snap("4.2e-settings-hindi-bottom")
        app.tabBars.buttons["होम"].tap()
        sleep(2)
        snap("2.1d-home-hindi")
        app.tabBars.buttons["प्रोफ़ाइल"].tap()
        // The Profile tab keeps its Settings stack; pop to the root first.
        app.navigationBars.buttons.firstMatch.tap()
        _ = app.buttons["Sign out"].waitForExistence(timeout: 8)
        sleep(1)
        snap("4.1c-profile-hindi")
        // Profile is localised now; match either so the tour survives a rerun
        // that starts from English.
        app.buttons.containing(NSPredicate(
            format: "label CONTAINS 'Settings' OR label CONTAINS 'सेटिंग्स'")).firstMatch.tap()
        _ = app.switches["डेटा सेवर"].waitForExistence(timeout: 8)
        app.segmentedControls.buttons["English"].tap()
        _ = app.switches["Data saver"].waitForExistence(timeout: 8)

        app.buttons["Set parental lock"].tap()
        wait(app, text: "Set a parental PIN", 8)
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        wait(app, text: "Confirm the new PIN", 8)
        snap("4.3f-pin-confirm")
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
        _ = app.buttons["Change parental lock"].waitForExistence(timeout: 8)

        // PIN persisted → the gate on a 16+ title (test06 never confirms the PIN).
        let gated = launchApp(reset: false, extra: ["KATHA_AUTOPLAY": "dilli-6-ka-raaz:1"])
        wait(gated, text: "Parental lock", 20)
        sleep(1)
        snap("4.3h-pin-gate")
        for digit in ["9", "9", "9", "9"] { gated.buttons[digit].tap() }
        sleep(1)
        snap("4.3i-pin-gate-wrong")

        let app2 = launchApp(reset: false)
        wait(app2, text: "Daily check-in", 20)
        app2.tabBars.buttons["Profile"].tap()
        button(app2, containing: "Settings").tap()
        _ = app2.buttons["Change parental lock"].waitForExistence(timeout: 10)
        app2.buttons["Change parental lock"].tap()
        wait(app2, text: "Enter your current PIN", 8)
        snap("4.3g-pin-enter-current")
        app2.buttons["Forgot PIN?"].tap()
        wait(app2, text: "Reset the parental lock", 8)
        sleep(1)
        snap("4.3c-forgot-pin")
        app2.buttons["Send code"].tap()
        wait(app2, text: "Enter the code", 10)
        sleep(1)
        snap("4.3d-forgot-pin-code")
        let code = app2.textFields["pin.reset.code"]
        _ = code.waitForExistence(timeout: 5)
        code.tap()
        code.typeText("2468")
        wait(app2, text: "Parental lock removed", 10)
        snap("4.3e-pin-removed-toast")

        app2.swipeUp()
        _ = app2.buttons["Delete account"].waitForExistence(timeout: 8)
        app2.buttons["Delete account"].tap()
        wait(app2, text: "Delete your account?", 8)
        sleep(1)
        snap("4.7b-delete-account-sheet")

        // --- 4.6 Help assistant ---
        let help = launchApp()
        wait(help, text: "Daily check-in", 20)
        help.tabBars.buttons["Profile"].tap()
        button(help, containing: "Help & grievance").tap()
        _ = button(help, containing: "Chat with us").waitForExistence(timeout: 10)
        sleep(1)
        snap("4.6-help-top")
        button(help, containing: "Chat with us").tap()
        _ = text(help, containing: "Ask me about coins").waitForExistence(timeout: 10)
        sleep(1)
        snap("4.6c-assistant-empty")
        help.buttons["Refunds and cancellations"].tap()
        _ = text(help, containing: "reportaproblem.apple.com").waitForExistence(timeout: 8)
        let input = help.textFields["assistant.input"]
        _ = input.waitForExistence(timeout: 5)
        input.tap()
        input.typeText("paid but coins nahi mile")
        snap("4.6e-assistant-typing")
        help.buttons["assistant.send"].tap()
        _ = text(help, containing: "Restore purchases").waitForExistence(timeout: 8)
        sleep(1)
        snap("4.6d-assistant-chat")

        // --- 3.4 Player track picker, captions on, 2× pill ---
        let p = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        waitPlayer(p, "E1 · One face too many")
        revealChrome(p)
        p.buttons["player.cc"].tap()
        wait(p, text: "Subtitles", 8)
        sleep(1)
        snap("3.4-track-picker")
        if p.buttons["captions.hi"].waitForExistence(timeout: 3) {
            p.buttons["captions.hi"].tap()
            sleep(1)
            snap("3.4b-track-picker-hi-selected")
        }
        p.buttons["Done"].tap()
        sleep(3)
        revealChrome(p)
        snap("3.1c-player-captions-on")
        // The 2× pill only shows while the finger is down; XCUITest's press
        // blocks the (main-thread-only) API, so it cannot be captured here.
        let surface = p.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        surface.doubleTap()                                  // like → heart burst
        _ = p.buttons["Liked"].waitForExistence(timeout: 6)
        snap("3.1d-player-liked")
        p.swipeUp()
        waitPlayer(p, "E2 · The seventh plate")
        sleep(2)
        revealChrome(p)
        snap("3.1e-player-E2-after-swipe")
        // Idle: the controls auto-hide after a few seconds.
        sleep(8)
        snap("3.1f-player-controls-hidden")
        // 3.1g: scrub to the last seconds so the end card draws — it has to be
        // opaque and narrow, with the rail and scrubber out of its way.
        revealChrome(p)
        p.sliders.firstMatch.adjust(toNormalizedSliderPosition: 0.995)
        _ = p.buttons["Play next episode"].waitForExistence(timeout: 25)
        sleep(1)
        snap("3.1g-player-end-card")
    }
}
