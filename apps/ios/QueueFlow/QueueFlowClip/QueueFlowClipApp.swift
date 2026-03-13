import SwiftUI

/// App Clip entry point.
/// Extracts the ticket token from the invocation URL and shows the queue view.
@main
struct QueueFlowClipApp: App {
    @UIApplicationDelegateAdaptor(AppClipDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            Group {
                if let token = appState.ticketToken {
                    QueueView(token: token)
                } else {
                    LoadingView()
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .queueFlowOpenURL)) { notification in
                guard let urlString = notification.object as? String else { return }
                appState.handleNotificationURL(urlString)
            }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                guard let url = activity.webpageURL else { return }
                appState.handleURL(url)
            }
            .onOpenURL { url in
                appState.handleURL(url)
            }
            .onChange(of: scenePhase) { newPhase in
                if newPhase == .active {
                    APNsManager.shared.registerForNotifications()
                }
            }
        }
    }
}

/// Manages app-level state: ticket token extraction and APNs registration.
class AppState: ObservableObject {
    @Published var ticketToken: String?
    private let lastTicketTokenKey = "queueflow.lastTicketToken"
    private let lastTicketTokenSavedAtKey = "queueflow.lastTicketTokenSavedAt"
    private let savedTokenLifetime: TimeInterval = 8 * 60 * 60

    init() {
        restoreRecentTicketToken()
        // Register for ephemeral notifications immediately
        APNsManager.shared.registerForNotifications()
    }

    /// Extract ticket token from URL like https://domain.com/q/ABC123XYZ
    func handleURL(_ url: URL) {
        let path = url.pathComponents // ["/" , "q", "TOKEN"]
        if path.count >= 3 && path[1] == "q" {
            saveTicketToken(path[2])
        }
    }

    /// Handle relative URLs coming from push payloads, e.g. /q/ABC123XYZ.
    func handleNotificationURL(_ rawURL: String) {
        if let absoluteURL = URL(string: rawURL), absoluteURL.scheme != nil {
            handleURL(absoluteURL)
            return
        }

        let normalizedPath = rawURL.hasPrefix("/") ? rawURL : "/" + rawURL
        if let resolvedURL = URL(string: "https://qflow-sigma.vercel.app\(normalizedPath)") {
            handleURL(resolvedURL)
        }
    }

    private func restoreRecentTicketToken() {
        let defaults = UserDefaults.standard
        guard let savedAt = defaults.object(forKey: lastTicketTokenSavedAtKey) as? Date else {
            return
        }

        guard Date().timeIntervalSince(savedAt) <= savedTokenLifetime else {
            defaults.removeObject(forKey: lastTicketTokenKey)
            defaults.removeObject(forKey: lastTicketTokenSavedAtKey)
            return
        }

        ticketToken = defaults.string(forKey: lastTicketTokenKey)
    }

    private func saveTicketToken(_ token: String) {
        ticketToken = token
        let defaults = UserDefaults.standard
        defaults.set(token, forKey: lastTicketTokenKey)
        defaults.set(Date(), forKey: lastTicketTokenSavedAtKey)
    }
}

extension Notification.Name {
    static let queueFlowOpenURL = Notification.Name("queueflow.openURL")
}

/// Loading screen shown while waiting for URL.
struct LoadingView: View {
    var body: some View {
        ZStack {
            Color(red: 0.145, green: 0.388, blue: 0.922) // #2563eb
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Image(systemName: "person.2.badge.clock")
                    .font(.system(size: 48))
                    .foregroundColor(.white)

                Text("QueueFlow")
                    .font(.title.bold())
                    .foregroundColor(.white)

                ProgressView()
                    .tint(.white)

                Text("Loading your queue...")
                    .font(.subheadline)
                    .foregroundColor(.white.opacity(0.8))
            }
        }
    }
}
