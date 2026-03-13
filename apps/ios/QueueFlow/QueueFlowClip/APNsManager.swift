import Foundation
import UserNotifications
import UIKit

/// Manages APNs registration for the App Clip.
/// Uses ephemeral notification permission (8 hours, no user prompt required).
class APNsManager: NSObject, ObservableObject {
    static let shared = APNsManager()

    @Published var deviceToken: String?
    @Published var isRegistered = false

    /// Ticket ID to associate with this device token.
    var ticketId: String? {
        didSet {
            if let ticketId = ticketId, let token = deviceToken {
                Task {
                    await SupabaseClient.shared.registerAPNsToken(
                        ticketId: ticketId,
                        deviceToken: token
                    )
                }
            }
        }
    }

    override private init() {
        super.init()
    }

    /// Request ephemeral notification permission and register with APNs.
    /// On App Clips, this grants 8 hours of push without a user prompt.
    func registerForNotifications() {
        let center = UNUserNotificationCenter.current()

        // Set delegate so notifications show even when app is in foreground
        center.delegate = self

        // Request authorization — App Clips get ephemeral permission automatically
        // if NSAppClipRequestEphemeralUserNotification is true in Info.plist
        // Do NOT use .provisional — it delivers silently (no lock screen, no sound).
        // App Clips with NSAppClipRequestEphemeralUserNotification get full authorization
        // automatically without prompting the user, so .alert/.sound/.badge is enough.
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("[APNs] Authorization error: \(error)")
                return
            }

            print("[APNs] Authorization granted: \(granted)")

            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    /// Called by AppDelegate when APNs token is received.
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02x", $0) }.joined()
        print("[APNs] Device token: \(tokenString)")

        DispatchQueue.main.async {
            self.deviceToken = tokenString
            self.isRegistered = true

            // If we already have a ticket ID, register immediately
            if let ticketId = self.ticketId {
                Task {
                    await SupabaseClient.shared.registerAPNsToken(
                        ticketId: ticketId,
                        deviceToken: tokenString
                    )
                }
            }
        }
    }

    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[APNs] Registration failed: \(error)")
    }
}

// MARK: - Foreground Notification Display

extension APNsManager: UNUserNotificationCenterDelegate {
    /// Show notifications even when the App Clip is in the foreground.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show banner + sound + badge even when app is open
        completionHandler([.banner, .sound, .badge])
    }

    /// Handle notification tap — user tapped the notification banner.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        print("[APNs] Notification tapped: \(response.notification.request.content.title)")
        completionHandler()
    }
}

// MARK: - AppDelegate for APNs callbacks

/// App Clips need an AppDelegate to receive APNs device tokens.
/// SwiftUI's @UIApplicationDelegateAdaptor bridges this.
class AppClipDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        APNsManager.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        APNsManager.shared.didFailToRegisterForRemoteNotifications(error: error)
    }
}
