import SwiftUI

enum TicketSessionStore {
    private static let lastTicketTokenKey = "queueflow.lastTicketToken"
    private static let lastTicketTokenSavedAtKey = "queueflow.lastTicketTokenSavedAt"
    private static let savedTokenLifetime: TimeInterval = 45 * 60

    static func save(token: String) {
        let defaults = UserDefaults.standard
        defaults.set(token, forKey: lastTicketTokenKey)
        defaults.set(Date(), forKey: lastTicketTokenSavedAtKey)
    }

    static func loadRecentToken() -> String? {
        let defaults = UserDefaults.standard
        guard let savedAt = defaults.object(forKey: lastTicketTokenSavedAtKey) as? Date else {
            return nil
        }

        guard Date().timeIntervalSince(savedAt) <= savedTokenLifetime else {
            clear()
            return nil
        }

        return defaults.string(forKey: lastTicketTokenKey)
    }

    static func clear() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: lastTicketTokenKey)
        defaults.removeObject(forKey: lastTicketTokenSavedAtKey)
    }
}

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
                if appState.isResolvingSavedTicket {
                    LoadingView()
                } else if let token = appState.ticketToken {
                    QueueView(token: token)
                } else {
                    NoActiveTicketView()
                }
            }
            .environmentObject(appState)
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
    @Published var isResolvingSavedTicket = true

    init() {
        if !restoreLaunchTicketTokenOverride() {
            Task {
                await restoreRecentTicketTokenIfValid()
            }
        } else {
            isResolvingSavedTicket = false
        }
        // Register for ephemeral notifications immediately
        APNsManager.shared.registerForNotifications()
    }

    /// Extract ticket token from URL like https://domain.com/q/ABC123XYZ
    func handleURL(_ url: URL) {
        let path = url.pathComponents // ["/" , "q", "TOKEN"]
        if path.count >= 3 && path[1] == "q" {
            let token = path[2]
            Task { @MainActor in
                await resetForIncomingTicket(token)
            }
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

    private func restoreRecentTicketTokenIfValid() async {
        guard let savedToken = TicketSessionStore.loadRecentToken() else {
            await MainActor.run {
                self.isResolvingSavedTicket = false
            }
            return
        }

        do {
            let ticket = try await SupabaseClient.shared.fetchTicket(token: savedToken)
            if Self.shouldPersist(ticketStatus: ticket.status) {
                await MainActor.run {
                    self.ticketToken = savedToken
                    self.isResolvingSavedTicket = false
                }
            } else {
                await clearPersistedTicketState()
            }
        } catch {
            await clearPersistedTicketState()
        }
    }

    private func restoreLaunchTicketTokenOverride() -> Bool {
        guard
            let rawURL = ProcessInfo.processInfo.environment["_XCAppClipURL"],
            !rawURL.isEmpty,
            let url = URL(string: rawURL)
        else {
            return false
        }

        handleURL(url)
        isResolvingSavedTicket = false
        return true
    }

    private func saveTicketToken(_ token: String) {
        ticketToken = token
        isResolvingSavedTicket = false
        TicketSessionStore.save(token: token)
    }

    @MainActor
    private func resetForIncomingTicket(_ token: String) async {
        TicketSessionStore.clear()
        await LiveActivityManager.shared.endAll()
        APNsManager.shared.ticketId = nil
        APNsManager.shared.tokenSentToServer = false
        saveTicketToken(token)
    }

    static func shouldPersist(ticketStatus: String) -> Bool {
        !["served", "no_show", "cancelled", "transferred"].contains(ticketStatus)
    }

    @MainActor
    func clearCurrentTicket() async {
        await clearPersistedTicketState()
    }

    private func clearPersistedTicketState() async {
        TicketSessionStore.clear()
        await LiveActivityManager.shared.endAll()
        await MainActor.run {
            self.ticketToken = nil
            self.isResolvingSavedTicket = false
            APNsManager.shared.ticketId = nil
            APNsManager.shared.tokenSentToServer = false
        }
    }
}

extension Notification.Name {
    static let queueFlowOpenURL = Notification.Name("queueflow.openURL")
    static let queueFlowBuzz = Notification.Name("queueflow.buzz")
    static let queueFlowRecall = Notification.Name("queueflow.recall")
    static let queueFlowCalled = Notification.Name("queueflow.called")
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

struct NoActiveTicketView: View {
    var body: some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97)
                .ignoresSafeArea()

            VStack(spacing: 14) {
                Image(systemName: "ticket")
                    .font(.system(size: 40))
                    .foregroundColor(Color(red: 0.145, green: 0.388, blue: 0.922))

                Text("No active ticket")
                    .font(.title3.bold())

                Text("Open your latest QueueFlow link to load your current visit.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
        }
    }
}
