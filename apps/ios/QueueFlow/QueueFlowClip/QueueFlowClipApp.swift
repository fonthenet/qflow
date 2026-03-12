import SwiftUI

/// App Clip entry point.
/// Extracts the ticket token from the invocation URL and shows the queue view.
@main
struct QueueFlowClipApp: App {
    @UIApplicationDelegateAdaptor(AppClipDelegate.self) var appDelegate
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
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                guard let url = activity.webpageURL else { return }
                appState.handleURL(url)
            }
            .onOpenURL { url in
                appState.handleURL(url)
            }
        }
    }
}

/// Manages app-level state: ticket token extraction and APNs registration.
class AppState: ObservableObject {
    @Published var ticketToken: String?

    init() {
        // Register for ephemeral notifications immediately
        APNsManager.shared.registerForNotifications()
    }

    /// Extract ticket token from URL like https://domain.com/q/ABC123XYZ
    func handleURL(_ url: URL) {
        let path = url.pathComponents // ["/" , "q", "TOKEN"]
        if path.count >= 3 && path[1] == "q" {
            ticketToken = path[2]
        }
    }
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
