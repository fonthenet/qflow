import ActivityKit
import Foundation

@MainActor
final class LiveActivityManager {
    static let shared = LiveActivityManager()

    private var currentActivity: Activity<QueueLiveActivityAttributes>?
    private var pushTokenTasks: [String: Task<Void, Never>] = [:]
    private var lastRegisteredPushTokens: [String: String] = [:]

    private init() {}

    func sync(
        ticket: Ticket,
        position: Int?,
        estimatedWait: Int?,
        nowServing: String?
    ) async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return
        }

        let attributes = QueueLiveActivityAttributes(
            ticketId: ticket.id,
            ticketNumber: ticket.ticket_number,
            qrToken: ticket.qr_token,
            departmentName: ticket.department?.name ?? "Queue",
            serviceName: ticket.service?.name ?? ""
        )

        let state = QueueLiveActivityAttributes.ContentState(
            status: ticket.status,
            position: position,
            estimatedWaitMinutes: estimatedWait ?? ticket.estimated_wait_minutes,
            nowServing: nowServing,
            deskName: ticket.deskDisplayName == "—" ? nil : ticket.deskDisplayName,
            recallCount: ticket.recall_count ?? 0,
            calledAt: parseDate(ticket.called_at),
            updatedAt: Date()
        )

        if shouldEnd(for: ticket.status) {
            await end(state: state, immediate: ticket.status == "served")
            return
        }

        let content = ActivityContent(
            state: state,
            staleDate: Date().addingTimeInterval(15 * 60)
        )

        await endActivities(excluding: ticket.id)

        if let activity = activity(for: ticket.id) {
            startObservingPushTokenUpdates(for: activity, ticketId: ticket.id)
            try? await activity.update(content)
            currentActivity = activity
            return
        }

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: .token
            )
            currentActivity = activity
            startObservingPushTokenUpdates(for: activity, ticketId: ticket.id)
            print("[LiveActivity] Started for ticket \(ticket.ticket_number)")
        } catch {
            print("[LiveActivity] Failed to start: \(error)")
        }
    }

    func endAll() async {
        await end(state: nil, immediate: true)
    }

    private func shouldEnd(for status: String) -> Bool {
        status == "served" || status == "no_show" || status == "transferred"
    }

    private func activity(for ticketId: String) -> Activity<QueueLiveActivityAttributes>? {
        if let currentActivity, currentActivity.attributes.ticketId == ticketId {
            return currentActivity
        }

        return Activity<QueueLiveActivityAttributes>.activities.first {
            $0.attributes.ticketId == ticketId
        }
    }

    private func startObservingPushTokenUpdates(
        for activity: Activity<QueueLiveActivityAttributes>,
        ticketId: String
    ) {
        guard pushTokenTasks[activity.id] == nil else {
            return
        }

        pushTokenTasks[activity.id] = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()

                let shouldRegister = await MainActor.run { () -> Bool in
                    guard let self else { return false }
                    if self.lastRegisteredPushTokens[activity.id] == token {
                        return false
                    }

                    self.lastRegisteredPushTokens[activity.id] = token
                    return true
                }

                guard shouldRegister else {
                    continue
                }

                print("[LiveActivity] Push token updated for ticket \(ticketId): \(token.prefix(12))...")

                let success = await SupabaseClient.shared.registerAPNsToken(
                    ticketId: ticketId,
                    deviceToken: token,
                    kind: "liveactivity"
                )

                if success {
                    print("[LiveActivity] Push token registered with backend")
                } else {
                    print("[LiveActivity] Failed to register push token with backend")
                }
            }

            await MainActor.run {
                self?.pushTokenTasks.removeValue(forKey: activity.id)
                self?.lastRegisteredPushTokens.removeValue(forKey: activity.id)
            }
        }
    }

    private func end(
        state: QueueLiveActivityAttributes.ContentState?,
        immediate: Bool
    ) async {
        for task in pushTokenTasks.values {
            task.cancel()
        }
        pushTokenTasks.removeAll()
        lastRegisteredPushTokens.removeAll()

        for activity in Activity<QueueLiveActivityAttributes>.activities {
            if let state {
                let content = ActivityContent(state: state, staleDate: nil)
                try? await activity.end(
                    content,
                    dismissalPolicy: immediate ? .immediate : .default
                )
            } else {
                try? await activity.end(dismissalPolicy: immediate ? .immediate : .default)
            }
        }

        currentActivity = nil
    }

    private func endActivities(excluding ticketId: String) async {
        let staleActivities = Activity<QueueLiveActivityAttributes>.activities.filter {
            $0.attributes.ticketId != ticketId
        }

        guard !staleActivities.isEmpty else {
            return
        }

        for activity in staleActivities {
            pushTokenTasks[activity.id]?.cancel()
            pushTokenTasks.removeValue(forKey: activity.id)
            lastRegisteredPushTokens.removeValue(forKey: activity.id)
            await activity.end(dismissalPolicy: .immediate)
        }

        if currentActivity?.attributes.ticketId != ticketId {
            currentActivity = nil
        }
    }

    private func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = formatter.date(from: value) {
            return parsed
        }

        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}
