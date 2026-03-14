import ActivityKit
import SwiftUI
import WidgetKit

struct QueueFlowLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: QueueLiveActivityAttributes.self) { context in
            QueueLiveActivityView(context: context)
                .widgetURL(queueURL(for: context))
                .activityBackgroundTint(Color(red: 0.05, green: 0.08, blue: 0.16))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 8) {
                        Circle()
                            .fill(statusAccent(for: context.state.status))
                            .frame(width: 10, height: 10)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(context.attributes.ticketNumber)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(.white)

                            Text(statusPillText(for: context.state.status))
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(statusAccent(for: context.state.status))
                        }
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 4) {
                        if context.state.status == "waiting", let position = context.state.position {
                            Text("#\(position)")
                                .font(.title3.weight(.heavy))
                                .foregroundStyle(statusAccent(for: context.state.status))
                        } else if context.state.status == "called", let range = countdownRange(for: context.state) {
                            Text(timerInterval: range, countsDown: true)
                                .font(.headline.weight(.heavy))
                                .foregroundStyle(statusAccent(for: context.state.status))
                                .monospacedDigit()
                        } else if let desk = context.state.deskName {
                            Text(desk)
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(statusAccent(for: context.state.status))
                                .lineLimit(1)
                        } else {
                            Image(systemName: compactSymbol(for: context.state.status))
                                .foregroundStyle(statusAccent(for: context.state.status))
                        }

                        Text(trailingSummary(for: context.state))
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.66))
                            .lineLimit(1)
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    switch context.state.status {
                    case "waiting":
                        HStack(spacing: 10) {
                            islandMetric(
                                title: "Position",
                                value: context.state.position.map { "#\($0)" } ?? "—",
                                tint: statusAccent(for: "waiting")
                            )
                            islandMetric(
                                title: "Wait",
                                value: context.state.estimatedWaitMinutes.map { "\($0)m" } ?? "—",
                                tint: statusAccent(for: "called")
                            )
                            islandMetric(
                                title: "Now Serving",
                                value: context.state.nowServing ?? "—",
                                tint: statusAccent(for: "serving")
                            )
                        }
                    case "called":
                        HStack(spacing: 10) {
                            statusChip(
                                title: "Desk",
                                value: context.state.deskName ?? "Your desk",
                                tint: statusAccent(for: "called")
                            )

                            if let range = countdownRange(for: context.state) {
                                countdownChip(range: range, tint: statusAccent(for: "called"))
                            }

                            if context.state.recallCount > 0 {
                                statusChip(
                                    title: "Recall",
                                    value: "\(context.state.recallCount)x",
                                    tint: statusAccent(for: "waiting")
                                )
                            }
                        }
                    case "serving":
                        HStack(spacing: 10) {
                            statusChip(
                                title: "Desk",
                                value: context.state.deskName ?? "Assigned",
                                tint: statusAccent(for: "serving")
                            )
                            statusChip(
                                title: "Status",
                                value: "With staff",
                                tint: .white.opacity(0.75)
                            )
                        }
                    default:
                        Text("Thanks for visiting QueueFlow")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                    }
                }
            } compactLeading: {
                Text(compactTicketLabel(for: context.attributes.ticketNumber))
                    .font(.system(size: 8, weight: .bold, design: .rounded))
                    .foregroundStyle(statusAccent(for: context.state.status))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(statusAccent(for: context.state.status).opacity(0.22))
                    )
            } compactTrailing: {
                if context.state.status == "waiting", let position = context.state.position {
                    Text("#\(position)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusAccent(for: context.state.status))
                } else if context.state.status == "called", let range = countdownRange(for: context.state) {
                    Text(timerInterval: range, countsDown: true)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusAccent(for: context.state.status))
                        .monospacedDigit()
                } else if let desk = context.state.deskName, context.state.status == "serving" {
                    Text(String(desk.prefix(3)).uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusAccent(for: context.state.status))
                } else {
                    Text(compactTicketLabel(for: context.attributes.ticketNumber))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusAccent(for: context.state.status))
                }
            } minimal: {
                Text(minimalCompactValue(for: context))
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .foregroundStyle(statusAccent(for: context.state.status))
            }
            .widgetURL(queueURL(for: context))
        }
    }

    private func queueURL(
        for context: ActivityViewContext<QueueLiveActivityAttributes>
    ) -> URL? {
        URL(string: "https://qflow-sigma.vercel.app/q/\(context.attributes.qrToken)")
    }
}

private func minimalCompactValue(
    for context: ActivityViewContext<QueueLiveActivityAttributes>
) -> String {
    switch context.state.status {
    case "waiting":
        return context.state.position.map { "#\($0)" } ?? "Q"
    case "called":
        return "!"
    case "serving":
        return "IN"
    case "served":
        return "OK"
    default:
        return "Q"
    }
}

private struct QueueLiveActivityView: View {
    let context: ActivityViewContext<QueueLiveActivityAttributes>

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.04, green: 0.08, blue: 0.15),
                    Color(red: 0.08, green: 0.12, blue: 0.22),
                    Color(red: 0.10, green: 0.10, blue: 0.18)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(alignment: .leading, spacing: 12) {
                headerRow
                contentSection
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
        }
    }

    private var headerRow: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(context.attributes.serviceName)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white.opacity(0.58))
                    .textCase(.uppercase)
                    .tracking(1.6)
                    .lineLimit(1)

                Text(syncSummary)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.white.opacity(0.74))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                Circle()
                    .fill(statusAccent(for: context.state.status))
                    .frame(width: 8, height: 8)

                Text(statusPillText(for: context.state.status))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(statusAccent(for: context.state.status))
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(statusAccent(for: context.state.status).opacity(0.12), in: Capsule())
            .overlay(
                Capsule()
                    .stroke(statusAccent(for: context.state.status).opacity(0.22), lineWidth: 1)
            )
        }
    }

    @ViewBuilder
    private var contentSection: some View {
        switch context.state.status {
        case "waiting":
            waitingSection
        case "called":
            calledSection
        case "serving":
            servingSection
        default:
            completedSection
        }
    }

    private var waitingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("QUEUE PROGRESS")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white.opacity(0.56))
                        .tracking(1.6)

                    Text(context.attributes.ticketNumber)
                        .font(.system(size: 34, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.60)
                }

                Spacer(minLength: 0)

                VStack(alignment: .trailing, spacing: 4) {
                    Text(context.state.position.map { "#\($0)" } ?? "—")
                        .font(.system(size: 34, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)

                    Text(waitingStatusText)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.74))
                        .lineLimit(1)
                }
            }

            HStack(spacing: 16) {
                inlineStat(
                    title: "Wait",
                    value: context.state.estimatedWaitMinutes.map { "\($0) min" } ?? "—",
                    tint: statusAccent(for: "called")
                )
                inlineStat(
                    title: "Now Serving",
                    value: context.state.nowServing ?? "—",
                    tint: statusAccent(for: "serving")
                )
                Spacer(minLength: 0)
            }

            progressBar(progress: queueProgress(for: context.state.position))
                .padding(.horizontal, 1)

            infoBanner(
                symbol: "bell.badge.fill",
                text: "We will alert you when it's your turn.",
                tint: statusAccent(for: "called")
            )
        }
    }

    private var calledSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                ZStack {
                    Circle()
                        .fill(statusAccent(for: "called").opacity(0.18))
                        .frame(width: 42, height: 42)

                    Image(systemName: "bell.fill")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(statusAccent(for: "called"))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Go to \(context.state.deskName ?? "your desk")")
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    Text("Show ticket \(context.attributes.ticketNumber) when you arrive.")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.74))
                        .lineLimit(1)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 10) {
                if let range = countdownRange(for: context.state) {
                    countdownChip(range: range, tint: statusAccent(for: "called"))
                }

                statusChip(
                    title: "Desk",
                    value: context.state.deskName ?? "Assigned",
                    tint: statusAccent(for: "called")
                )

                if context.state.recallCount > 0 {
                    statusChip(
                        title: "Recall",
                        value: "\(context.state.recallCount)x",
                        tint: statusAccent(for: "waiting")
                    )
                }
            }
        }
    }

    private var servingSection: some View {
        HStack(spacing: 10) {
            liveMetric(
                title: "Desk",
                value: context.state.deskName ?? "Assigned",
                tint: statusAccent(for: "serving")
            )
            liveMetric(
                title: "Status",
                value: "With staff",
                tint: .white.opacity(0.82)
            )
        }
    }

    private var completedSection: some View {
        infoBanner(
            symbol: "checkmark.circle.fill",
            text: "Thanks for visiting QueueFlow.",
            tint: statusAccent(for: "served")
        )
    }

    private func liveMetric(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.68)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.07))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func inlineStat(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2.weight(.bold))
                .foregroundStyle(tint)
                .tracking(1.2)
                .lineLimit(1)

            Text(value)
                .font(.system(size: 20, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.64)
        }
    }

    private var waitingStatusText: String {
        guard let position = context.state.position else { return "Fetching your place" }
        if position == 1 { return "Almost there" }
        if position <= 3 { return "You are nearly up" }
        return "\(position - 1) ahead of you"
    }

    private var syncSummary: String {
        "Updated \(context.state.updatedAt.formatted(date: .omitted, time: .shortened))"
    }

    private func progressBar(progress: Double) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.10))

                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.30, green: 0.79, blue: 0.91),
                                Color(red: 0.35, green: 0.87, blue: 0.77)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geo.size.width * progress)
            }
        }
        .frame(height: 12)
        .padding(.top, 2)
        .padding(.bottom, 6)
    }

    private func infoBanner(symbol: String, text: String, tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.caption.weight(.bold))
                .foregroundStyle(tint)
                .frame(width: 26, height: 26)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))

            Text(text)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.82))
                .lineLimit(2)
        }
    }
}

private func islandMetric(title: String, value: String, tint: Color) -> some View {
    VStack(alignment: .leading, spacing: 3) {
        Text(title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
        Text(value)
            .font(.system(size: 16, weight: .heavy, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.68)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(Color.white.opacity(0.06))
    )
}

private func statusChip(title: String, value: String, tint: Color) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        Text(title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
        Text(value)
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .lineLimit(1)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 7)
    .background(
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color.white.opacity(0.08))
    )
}

private func countdownChip(range: ClosedRange<Date>, tint: Color) -> some View {
    Text(timerInterval: range, countsDown: true)
        .font(.caption.weight(.heavy))
        .foregroundStyle(tint)
        .monospacedDigit()
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            Capsule()
                .fill(tint.opacity(0.14))
        )
}

private func compactTicketLabel(for ticketNumber: String) -> String {
    let trimmed = ticketNumber.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.count <= 8 {
        return trimmed
    }
    return String(trimmed.suffix(8))
}

private func compactSymbol(for status: String) -> String {
    switch status {
    case "called":
        return "bell.fill"
    case "serving":
        return "person.fill.checkmark"
    case "served":
        return "checkmark.circle.fill"
    default:
        return "list.number"
    }
}

private func statusPillText(for status: String) -> String {
    switch status {
    case "waiting": return "Waiting"
    case "called": return "Called now"
    case "serving": return "Serving"
    case "served": return "Completed"
    default: return status.capitalized
    }
}

private func statusAccent(for status: String) -> Color {
    switch status {
    case "waiting":
        return Color(red: 0.42, green: 0.84, blue: 0.98)
    case "called":
        return Color(red: 0.98, green: 0.76, blue: 0.28)
    case "serving":
        return Color(red: 0.47, green: 0.92, blue: 0.68)
    case "served":
        return Color(red: 0.77, green: 0.81, blue: 0.91)
    default:
        return .white.opacity(0.78)
    }
}

private func trailingSummary(for state: QueueLiveActivityAttributes.ContentState) -> String {
    switch state.status {
    case "waiting":
        return state.estimatedWaitMinutes.map { "~\($0) min" } ?? "Updating"
    case "called":
        return state.deskName ?? "Desk pending"
    case "serving":
        return "With staff"
    case "served":
        return "Done"
    default:
        return statusPillText(for: state.status)
    }
}

private func countdownRange(for state: QueueLiveActivityAttributes.ContentState) -> ClosedRange<Date>? {
    guard state.status == "called" else { return nil }
    let start = state.calledAt ?? state.updatedAt
    let end = start.addingTimeInterval(60)
    return start...end
}

private func queueProgress(for position: Int?) -> Double {
    guard let position else { return 0.08 }
    return max(0.08, min(0.98, Double(12 - min(position, 12)) / 12.0))
}

@available(iOSApplicationExtension 17.0, *)
#Preview("Live Activity Waiting", as: .content, using: QueueLiveActivityAttributes.preview) {
    QueueFlowLiveActivityWidget()
} contentStates: {
    QueueLiveActivityAttributes.ContentState.waitingPreview
}

@available(iOSApplicationExtension 17.0, *)
#Preview("Live Activity Called", as: .content, using: QueueLiveActivityAttributes.preview) {
    QueueFlowLiveActivityWidget()
} contentStates: {
    QueueLiveActivityAttributes.ContentState.calledPreview
}

@available(iOSApplicationExtension 17.0, *)
private extension QueueLiveActivityAttributes {
    static let preview = QueueLiveActivityAttributes(
        ticketId: "preview-ticket-id",
        ticketNumber: "CS-045",
        qrToken: "preview-token",
        departmentName: "Client Services",
        serviceName: "Mail & Packages"
    )
}

@available(iOSApplicationExtension 17.0, *)
private extension QueueLiveActivityAttributes.ContentState {
    static let waitingPreview = QueueLiveActivityAttributes.ContentState(
        status: "waiting",
        position: 2,
        estimatedWaitMinutes: 4,
        nowServing: "CS-043",
        deskName: nil,
        recallCount: 0,
        calledAt: nil,
        updatedAt: .now
    )

    static let calledPreview = QueueLiveActivityAttributes.ContentState(
        status: "called",
        position: nil,
        estimatedWaitMinutes: nil,
        nowServing: nil,
        deskName: "Counter 1",
        recallCount: 1,
        calledAt: .now,
        updatedAt: .now
    )
}
