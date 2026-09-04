import SwiftUI
import UserNotifications
import KathaKit

// Episode-drop notification (mockup 3.6). Title is the episode label, the body
// hooks without spoiling, and a tap deep-links straight into the player.
//
// Dev slice: provisional authorization (granted silently, delivers quietly) and
// a local drip nudge scheduled from continue-watching; production replaces the
// scheduler with APNs pushes carrying the same payload. Quiet hours 23:00–08:00
// IST and the 2/day · 1/series/day caps are delivery policy, enforced by the
// production scheduler server-side (PDD §8.6).

/// Payload contract shared with the server: {"katha": {"slug": "…", "episode": N}}.
struct DropAlert: Equatable {
    let slug: String
    let episode: Int
    let title: String
    let body: String
}

/// UNUserNotificationCenter delegate: foreground arrivals surface the in-app
/// drop banner; taps (from the banner or the system notification) route into
/// the player through AppModel.pendingRoute.
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    private let model: AppModel
    @MainActor init(model: AppModel) { self.model = model }

    static func parse(_ userInfo: [AnyHashable: Any]) -> (slug: String, episode: Int)? {
        guard let k = userInfo["katha"] as? [String: Any],
              let slug = k["slug"] as? String,
              let episode = k["episode"] as? Int else { return nil }
        return (slug, episode)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let content = notification.request.content
        let parsed = Self.parse(content.userInfo)
        let title = content.title
        let body = content.body
        if let parsed {
            let model = self.model          // AppModel is main-actor isolated (Sendable); self is not
            Task { @MainActor in
                model.incomingDrop = DropAlert(slug: parsed.slug, episode: parsed.episode,
                                               title: title, body: body)
            }
        }
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let parsed = Self.parse(response.notification.request.content.userInfo)
        if let parsed {
            let model = self.model
            Task { @MainActor in
                model.pendingRoute = EpisodeRoute(slug: parsed.slug, number: parsed.episode)
                model.incomingDrop = nil
            }
        }
        completionHandler()
    }
}

/// The in-app arrival card shown when a drop lands while the app is open —
/// same content as the lock-screen banner in the mock ("Katha · now").
struct DropBanner: View {
    let drop: DropAlert
    let watch: () -> Void
    let dismiss: () -> Void
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(Katha.Color.accent)
                    .frame(width: 18, height: 18)
                    .overlay {
                        Image(systemName: "play.fill")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.white)
                    }
                Text("Katha").font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Katha.Color.text2)
                Text("now").font(.system(size: 12)).foregroundStyle(Katha.Color.text2)
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Katha.Color.text2)
                        .accessibilityLabel("Dismiss")
                }
            }
            HStack(alignment: .top, spacing: Katha.Spacing.md) {
                CoverImage(url: model.coverURL(forSlug: drop.slug, wide: false))
                    .frame(width: 44, height: 62)
                    .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.sm,
                                                style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(drop.title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Katha.Color.text)
                    Text(drop.body)
                        .font(.system(size: 13))
                        .foregroundStyle(Katha.Color.text2)
                        .lineLimit(2)
                }
            }
            Button(action: watch) {
                Text("Watch now")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Katha.Color.text)
                    .padding(.horizontal, 14)
                    .frame(height: 30)
                    .background(Katha.Color.accent)
                    .clipShape(Capsule())
            }
            .buttonStyle(PressableStyle())
            .padding(.top, 2)
        }
        .padding(Katha.Spacing.md)
        .background(Katha.Color.surface)
        .clipShape(RoundedRectangle(cornerRadius: Katha.Radius.lg, style: .continuous))
        .shadow(color: .black.opacity(0.45), radius: 18, y: 8)
        .padding(.horizontal, Katha.Spacing.lg)
        .task {
            try? await Task.sleep(for: .seconds(6))
            dismiss()
        }
    }
}
