import ActivityKit
import SwiftUI
import WidgetKit

struct QueueFlowLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: QueueLiveActivityAttributes.self) { context in
            QueueLiveActivityView(context: context)
                .widgetURL(queueURL(for: context))
                .activityBackgroundTint(Color(red: 0.06, green: 0.09, blue: 0.17))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(context.attributes.ticketNumber)
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)
                        Text(statusPillText(for: context.state.status))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.68))
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 4) {
                        if context.state.status == "waiting", let position = context.state.position {
                            Text("#\(position)")
                                .font(.title3.weight(.heavy))
                                .foregroundStyle(statusColor(for: context.state.status))
                        } else if context.state.status == "called", let range = countdownRange(for: context.state) {
                            Text(timerInterval: range, countsDown: true)
                                .font(.headline.weight(.heavy))
                                .foregroundStyle(statusColor(for: context.state.status))
                                .monospacedDigit()
                        } else if let desk = context.state.deskName {
                            Text(desk)
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(statusColor(for: context.state.status))
                                .lineLimit(1)
                        } else {
                            Text(statusPillText(for: context.state.status))
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(statusColor(for: context.state.status))
                        }

                        Text(trailingSummary(for: context.state))
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.66))
                            .lineLimit(1)
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(context.attributes.departmentName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)

                        if context.state.status == "waiting" {
                            HStack(spacing: 14) {
                                islandMetric(title: "Position", value: context.state.position.map { "#\($0)" } ?? "—")
                                islandMetric(title: "Wait", value: context.state.estimatedWaitMinutes.map { "\($0)m" } ?? "—")
                                islandMetric(title: "Now", value: context.state.nowServing ?? "—")
                            }
                        } else if context.state.status == "called" {
                            Text("Go to \(context.state.deskName ?? "your desk") now")
                                .font(.headline.weight(.bold))
                                .foregroundStyle(statusColor(for: context.state.status))
                        } else if context.state.status == "serving" {
                            Text("A staff member is helping you at \(context.state.deskName ?? "your desk")")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                        } else {
                            Text("Thanks for visiting QueueFlow")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.white)
                        }
                    }
                }
            } compactLeading: {
                Text(compactTicketLabel(for: context.attributes.ticketNumber))
                    .font(.caption2.weight(.bold))
            } compactTrailing: {
                if context.state.status == "waiting", let position = context.state.position {
                    Text("#\(position)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusColor(for: context.state.status))
                } else if context.state.status == "called", let range = countdownRange(for: context.state) {
                    Text(timerInterval: range, countsDown: true)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(statusColor(for: context.state.status))
                        .monospacedDigit()
                } else {
                    Image(systemName: compactSymbol(for: context.state.status))
                        .foregroundStyle(statusColor(for: context.state.status))
                }
            } minimal: {
                Image(systemName: compactSymbol(for: context.state.status))
                    .foregroundStyle(statusColor(for: context.state.status))
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
                            Color(red: 0.06, green: 0.09, blue: 0.17),
                            Color(red: 0.09, green: 0.14, blue: 0.24)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            VStack(alignment: .leading, spacing: 12) {
                headerRow
                contentSection
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
    }

    private var headerRow: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(context.attributes.ticketNumber)
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(context.attributes.departmentName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.86))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Text(statusPillText(for: context.state.status))
                .font(.caption.weight(.bold))
                .foregroundStyle(statusColor(for: context.state.status))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(statusColor(for: context.state.status).opacity(0.16), in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(statusColor(for: context.state.status).opacity(0.28), lineWidth: 1)
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
            HStack(spacing: 10) {
                liveCard(title: "Position", value: context.state.position.map { "#\($0)" } ?? "—")
                liveCard(title: "Wait", value: context.state.estimatedWaitMinutes.map { "\($0) min" } ?? "—")
            }

            HStack(spacing: 8) {
                Image(systemName: "bell.badge.fill")
                    .foregroundStyle(statusColor(for: context.state.status))
                Text("We will alert you the moment the desk calls your number.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
            }

            if let nowServing = context.state.nowServing {
                Text("Now serving \(nowServing)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.68))
            }
        }
    }

    private var calledSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Go to \(context.state.deskName ?? "your desk")")
                .font(.system(size: 24, weight: .heavy, design: .rounded))
                .foregroundStyle(statusColor(for: context.state.status))
                .lineLimit(2)

            HStack(spacing: 12) {
                if let range = countdownRange(for: context.state) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Respond in")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.62))
                        Text(timerInterval: range, countsDown: true)
                            .font(.headline.weight(.heavy))
                            .foregroundStyle(.white)
                            .monospacedDigit()
                    }
                }

                if context.state.recallCount > 0 {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Recall")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.62))
                        Text("\(context.state.recallCount)x")
                            .font(.headline.weight(.heavy))
                            .foregroundStyle(.white)
                    }
                }
            }

            Text("Show ticket \(context.attributes.ticketNumber) when you arrive.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
        }
    }

    private var servingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("You are being served")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)

            if let desk = context.state.deskName {
                Text("At \(desk)")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(statusColor(for: context.state.status))
            }

            Text("A staff member is currently helping you.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.74))
        }
    }

    private var completedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Visit complete")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)

            Text("Thanks for visiting QueueFlow.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.74))
        }
    }

    private func liveCard(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.60))
            Text(value)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.08))
        )
    }
}

private func islandMetric(title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        Text(title)
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.60))
        Text(value)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
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
    case "called": return "Called"
    case "serving": return "Serving"
    case "served": return "Completed"
    default: return status.capitalized
    }
}

private func statusColor(for status: String) -> Color {
    switch status {
    case "called":
        return Color(red: 0.47, green: 0.94, blue: 0.63)
    case "serving":
        return Color(red: 0.38, green: 0.75, blue: 0.99)
    case "served":
        return Color(red: 0.72, green: 0.78, blue: 0.92)
    default:
        return Color(red: 0.99, green: 0.69, blue: 0.26)
    }
}

private func trailingSummary(for state: QueueLiveActivityAttributes.ContentState) -> String {
    switch state.status {
    case "waiting":
        return state.estimatedWaitMinutes.map { "~\($0) min" } ?? "Updating"
    case "called":
        return state.deskName ?? "Desk pending"
    case "serving":
        return "Being helped"
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
