import SwiftUI

var isRunningForPreviews: Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
}

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
        guard !isRunningForPreviews else {
            isResolvingSavedTicket = false
            return
        }

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
            LinearGradient(
                colors: [
                    Color(red: 0.03, green: 0.08, blue: 0.16),
                    Color(red: 0.06, green: 0.12, blue: 0.24),
                    Color(red: 0.09, green: 0.15, blue: 0.28)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            RadialGradient(
                colors: [
                    Color(red: 0.34, green: 0.76, blue: 0.98).opacity(0.16),
                    .clear
                ],
                center: .top,
                startRadius: 20,
                endRadius: 260
            )
            .ignoresSafeArea()

            VStack(spacing: 22) {
                Spacer()

                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.08))
                        .frame(width: 128, height: 128)

                    Circle()
                        .fill(Color.white.opacity(0.12))
                        .frame(width: 92, height: 92)

                    Image(systemName: "ticket.fill")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(Color(red: 0.38, green: 0.76, blue: 0.98))
                }

                VStack(spacing: 10) {
                    Text("Visit finished")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundColor(.white)

                    Text("You're all set. To join again, scan the latest code or open a new queue link.")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.72))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 26)
                }

                VStack(alignment: .leading, spacing: 14) {
                    noTicketRow(
                        icon: "checkmark.circle.fill",
                        title: "Current visit closed",
                        detail: "Your previous ticket is no longer active on this device."
                    )

                    noTicketRow(
                        icon: "link",
                        title: "Join again anytime",
                        detail: "Scan again or open a new queue link whenever you need another visit."
                    )
                }
                .padding(20)
                .background(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .fill(Color.white.opacity(0.07))
                        .overlay(
                            RoundedRectangle(cornerRadius: 28, style: .continuous)
                                .stroke(Color.white.opacity(0.10), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 20)

                Spacer()

                Text("Powered by QueueFlow")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.40))
                    .tracking(4)
                    .padding(.bottom, 18)
            }
        }
    }

    private func noTicketRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 38, height: 38)
                .background(
                    Circle()
                        .fill(Color.white.opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)

                Text(detail)
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.68))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
    }
}
