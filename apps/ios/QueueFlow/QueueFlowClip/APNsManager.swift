import Foundation
import UserNotifications
import UIKit

/// Manages APNs registration for the App Clip.
/// Uses ephemeral notification permission (8 hours, no user prompt required).
class APNsManager: NSObject, ObservableObject {
    static let shared = APNsManager()

    @Published var deviceToken: String?
    @Published var isRegistered = false
    @Published var tokenSentToServer = false

    /// Ticket ID to associate with this device token.
    var ticketId: String? {
        didSet {
            if ticketId != oldValue {
                tokenSentToServer = false
            }
            // Try to register whenever ticketId is set (token may arrive later)
            tryRegisterWithBackend()
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
        print("[APNs] Device token received: \(tokenString.prefix(12))...")

        DispatchQueue.main.async {
            self.deviceToken = tokenString
            self.isRegistered = true
            // Try to register — ticketId may already be set
            self.tryRegisterWithBackend()
        }
    }

    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[APNs] Registration failed: \(error)")
    }

    /// Try to send the token to the backend. Both ticketId AND deviceToken must be available.
    /// Retries up to 3 times on failure.
    private func tryRegisterWithBackend() {
        guard let ticketId = ticketId, let token = deviceToken else {
            if ticketId != nil && deviceToken == nil {
                print("[APNs] Waiting for device token before registering...")
            }
            if ticketId == nil && deviceToken != nil {
                print("[APNs] Waiting for ticket ID before registering...")
            }
            return
        }

        // Don't re-register if already sent successfully
        guard !tokenSentToServer else {
            print("[APNs] Token already sent to server, skipping")
            return
        }

        print("[APNs] Registering token with backend for ticket: \(ticketId)")

        Task {
            var success = false
            for attempt in 1...3 {
                let result = await SupabaseClient.shared.registerAPNsToken(
                    ticketId: ticketId,
                    deviceToken: token
                )
                if result {
                    print("[APNs] ✅ Token registered successfully (attempt \(attempt))")
                    await MainActor.run {
                        self.tokenSentToServer = true
                    }
                    success = true
                    break
                } else {
                    print("[APNs] ❌ Registration attempt \(attempt) failed, retrying...")
                    try? await Task.sleep(nanoseconds: UInt64(attempt) * 2_000_000_000) // 2s, 4s, 6s
                }
            }
            if !success {
                print("[APNs] ❌ All registration attempts failed")
            }
        }
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

        if let urlString = response.notification.request.content.userInfo["url"] as? String {
            NotificationCenter.default.post(name: .queueFlowOpenURL, object: urlString)
        }

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
