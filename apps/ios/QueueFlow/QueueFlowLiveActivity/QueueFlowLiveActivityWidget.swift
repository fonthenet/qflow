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
                                title: "Now",
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
                ZStack {
                    Circle()
                        .fill(statusAccent(for: context.state.status).opacity(0.22))
                        .frame(width: 22, height: 22)

                    Image(systemName: compactSymbol(for: context.state.status))
                        .font(.caption.weight(.bold))
                        .foregroundStyle(statusAccent(for: context.state.status))
                }
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
                } else {
                    Text(compactTicketLabel(for: context.attributes.ticketNumber))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusAccent(for: context.state.status))
                }
            } minimal: {
                Image(systemName: compactSymbol(for: context.state.status))
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

private struct QueueLiveActivityView: View {
    let context: ActivityViewContext<QueueLiveActivityAttributes>

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 0, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.05, green: 0.08, blue: 0.16),
                            Color(red: 0.08, green: 0.12, blue: 0.22)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            VStack(alignment: .leading, spacing: 10) {
                headerRow
                contentSection
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    private var headerRow: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(context.attributes.ticketNumber)
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(context.attributes.departmentName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.74))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                Circle()
                    .fill(statusAccent(for: context.state.status))
                    .frame(width: 8, height: 8)

                Text(statusPillText(for: context.state.status))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(statusAccent(for: context.state.status))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
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
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                liveMetric(
                    title: "Position",
                    value: context.state.position.map { "#\($0)" } ?? "—",
                    tint: statusAccent(for: "waiting")
                )
                liveMetric(
                    title: "Wait",
                    value: context.state.estimatedWaitMinutes.map { "\($0) min" } ?? "—",
                    tint: statusAccent(for: "called")
                )
                liveMetric(
                    title: "Now",
                    value: context.state.nowServing ?? "—",
                    tint: statusAccent(for: "serving")
                )
            }

            Text("We will alert you the moment the desk calls your number.")
                .font(.caption.weight(.medium))
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(2)
        }
    }

    private var calledSection: some View {
        HStack(alignment: .center, spacing: 12) {
            ZStack {
                Circle()
                    .fill(statusAccent(for: "called").opacity(0.18))
                    .frame(width: 44, height: 44)

                Image(systemName: "bell.fill")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(statusAccent(for: "called"))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Go to \(context.state.deskName ?? "your desk")")
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                HStack(spacing: 8) {
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

                Text("Show ticket \(context.attributes.ticketNumber) when you arrive.")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
    }

    private var servingSection: some View {
        HStack(spacing: 8) {
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
        Text("Thanks for visiting QueueFlow.")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white.opacity(0.86))
    }

    private func liveMetric(title: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.07))
        )
    }
}

private func islandMetric(title: String, value: String, tint: Color) -> some View {
    VStack(alignment: .leading, spacing: 3) {
        Text(title)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(tint)
        Text(value)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
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
    if trimmed.count <= 6 {
        return trimmed
    }
    return String(trimmed.suffix(6))
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
