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
        var env: [String: String] = [:]
        if reset { env["KATHA_RESET"] = "1" }
        if onboarded { env["KATHA_ONBOARDED"] = "1" }
        extra.forEach { env[$0] = $1 }
        app.launchEnvironment = env
        app.launch()
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

    func test01_TourOnboarding() {
        let app = launchApp(onboarded: false)
        snap("1.1-splash")                                   // best-effort: 1s window
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
        wait(app, text: "Trending in hi", 20)
        snap("2.1-home")

        app.tabBars.buttons["Browse"].tap()
        _ = app.buttons["Everything"].waitForExistence(timeout: 10)
        app.buttons["தமிழ்"].tap()
        _ = button(app, containing: "Kadhal Kanakku").waitForExistence(timeout: 8)
        snap("2.2-browse-tamil-filter")
        app.buttons["All"].tap()

        app.tabBars.buttons["Home"].tap()
        app.buttons["Search"].tap()
        let field = app.textFields.firstMatch          // inline 2.3 search bar
        _ = field.waitForExistence(timeout: 8)
        snap("2.3-search-empty")
        field.tap()
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
        wait(app, text: "E1 · One face too many", 20)
        sleep(2)                                             // let a frame decode
        snap("3.1-player-free")
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
        app.buttons["Unlock episode"].tap()
        wait(app, text: "E11 · The signature", 15)
        sleep(2)
        snap("3.1b-player-unlocked-E11")

        // back out to the wallet (history now shows purchase + unlock)
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

        let gated = launchApp(reset: false, extra: ["KATHA_AUTOPLAY": "dilli-6-ka-raaz:1"])
        wait(gated, text: "Parental lock", 20)
        snap("4.3b-pin-gate")

        // 5.1: backend unreachable
        let down = launchApp(extra: ["KATHA_API_BASE": "http://127.0.0.1:9"])
        wait(down, text: "Can't reach Katha", 20)
        snap("5.1-error-state")

        // 3.6: the in-app drop banner via the self-scheduled drip nudge
        let drop = launchApp(extra: ["KATHA_AUTOPLAY": "kaanch-ka-mahal:1"])
        wait(drop, text: "E1 · One face too many", 20)
        sleep(3)                                             // accrue progress
        drop.navigationBars.buttons.firstMatch.tap()         // back → progress reported
        let nudged = launchApp(reset: false, extra: ["KATHA_NUDGE_SECONDS": "4"])
        _ = nudged.buttons["Watch now"].waitForExistence(timeout: 25)
        snap("3.6-drop-banner")           // immediately — the banner lives 6 s
    }
}
