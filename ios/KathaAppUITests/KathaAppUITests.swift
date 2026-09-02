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
        var env: [String: String] = ["KATHA_ALLOW_CAPTURE": "1"]   // device runs are recorded
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
        search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        if !app.staticTexts["Trending"].waitForExistence(timeout: 5), search.exists {
            search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
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

        // set the PIN 1-2-3-4
        tapWhenReady(app.buttons["Set parental lock"])
        assertExists(app.staticTexts["Set a parental PIN"], 8)
        for digit in ["1", "2", "3", "4"] { app.buttons[digit].tap() }
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
}
