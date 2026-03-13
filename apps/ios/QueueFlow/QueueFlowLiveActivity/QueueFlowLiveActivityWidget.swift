import ActivityKit
import SwiftUI
import WidgetKit

struct QueueFlowLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: QueueLiveActivityAttributes.self) { context in
            QueueLiveActivityView(context: context)
                .widgetURL(queueURL(for: context))
                .activityBackgroundTint(Color(red: 0.08, green: 0.10, blue: 0.18))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.ticketNumber)
                            .font(.headline)
                            .foregroundStyle(.white)
                        Text(shortStatus(for: context.state.status))
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.white.opacity(0.68))
                    }
                }

                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        if let position = context.state.position,
                           context.state.status == "waiting" {
                            Text("#\(position)")
                                .font(.headline)
                        } else if let deskName = context.state.deskName,
                                  context.state.status == "called" {
                            Text(deskName)
                                .font(.headline)
                                .lineLimit(1)
                        } else {
                            Text(shortStatus(for: context.state.status))
                                .font(.headline)
                        }

                        if let wait = context.state.estimatedWaitMinutes,
                           context.state.status == "waiting" {
                            Text("\(wait) min")
                                .font(.caption2)
                                .foregroundStyle(.white.opacity(0.68))
                        }
                    }
                }

                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.attributes.departmentName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                        Text(context.attributes.serviceName)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.70))

                        if context.state.status == "waiting" {
                            HStack(spacing: 12) {
                                metric(title: "Position", value: context.state.position.map { "#\($0)" } ?? "—")
                                metric(title: "Now Serving", value: context.state.nowServing ?? "—")
                                metric(title: "Wait", value: context.state.estimatedWaitMinutes.map { "\($0)m" } ?? "—")
                            }
                        } else if context.state.status == "called" {
                            Text("Go to \(context.state.deskName ?? "your desk")")
                                .font(.headline)
                                .foregroundStyle(.green)
                        } else {
                            Text(shortStatus(for: context.state.status))
                                .font(.headline)
                        }
                    }
                }
            } compactLeading: {
                Text(compactTicketLabel(for: context.attributes.ticketNumber))
                    .font(.caption2.weight(.bold))
            } compactTrailing: {
                if let position = context.state.position,
                   context.state.status == "waiting" {
                    Text("#\(position)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(activityAccent(for: context.state.status))
                } else if context.state.status == "called" {
                    Image(systemName: "bell.fill")
                        .foregroundStyle(activityAccent(for: context.state.status))
                } else {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(activityAccent(for: context.state.status))
                }
            } minimal: {
                Image(systemName: minimalSymbol(for: context.state.status))
                    .foregroundStyle(activityAccent(for: context.state.status))
            }
            .widgetURL(queueURL(for: context))
        }
    }

    private func queueURL(
        for context: ActivityViewContext<QueueLiveActivityAttributes>
    ) -> URL? {
        URL(string: "https://qflow-sigma.vercel.app/q/\(context.attributes.qrToken)")
    }

    private func shortStatus(for status: String) -> String {
        switch status {
        case "waiting": return "Waiting"
        case "called": return "Your Turn"
        case "serving": return "Serving"
        case "served": return "Done"
        default: return status.capitalized
        }
    }

    private func compactTicketLabel(for ticketNumber: String) -> String {
        let trimmed = ticketNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count <= 6 {
            return trimmed
        }

        return String(trimmed.suffix(6))
    }

    private func minimalSymbol(for status: String) -> String {
        switch status {
        case "called":
            return "bell.fill"
        case "served":
            return "checkmark.circle.fill"
        default:
            return "list.number"
        }
    }

    private func activityAccent(for status: String) -> Color {
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

    @ViewBuilder
    private func metric(title: String, value: String) -> some View {
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
}

private struct QueueLiveActivityView: View {
    let context: ActivityViewContext<QueueLiveActivityAttributes>

    var body: some View {
        ViewThatFits(in: .vertical) {
            standardLayout
            compactLayout
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private var standardLayout: some View {
        VStack(alignment: .leading, spacing: 10) {
            headerRow
            serviceRow
            Divider()
                .overlay(Color.white.opacity(0.10))
            metricsRow
            actionRow(lineLimit: 2)
        }
    }

    @ViewBuilder
    private var compactLayout: some View {
        VStack(alignment: .leading, spacing: 8) {
            compactHeaderRow
            compactMetaRow
            actionRow(lineLimit: 1)
        }
    }

    @ViewBuilder
    private var headerRow: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Visit number")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.62))

                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(context.attributes.ticketNumber)
                        .font(.system(size: 36, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)

                    Text(lineSummary)
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                        .foregroundStyle(statusColor)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }
            }

            Spacer(minLength: 0)

            Text(statusPillText)
                .font(.caption.weight(.bold))
                .foregroundStyle(statusColor)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(statusColor.opacity(0.16), in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(statusColor.opacity(0.28), lineWidth: 1)
                )
        }
    }

    @ViewBuilder
    private var compactHeaderRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(context.attributes.ticketNumber)
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Text(lineSummary)
                .font(.headline.weight(.bold))
                .foregroundStyle(statusColor)
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Spacer(minLength: 0)

            Text(statusPillText)
                .font(.caption2.weight(.bold))
                .foregroundStyle(statusColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(statusColor.opacity(0.16), in: Capsule())
        }
    }

    @ViewBuilder
    private var serviceRow: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(context.attributes.departmentName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.90))
                    .lineLimit(1)

                if !context.attributes.serviceName.isEmpty {
                    Text(context.attributes.serviceName)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.66))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if !trailingSummary.isEmpty {
                Text(trailingSummary)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.70))
                    .lineLimit(1)
            }
        }
    }

    @ViewBuilder
    private var compactMetaRow: some View {
        HStack(spacing: 8) {
            Text(context.attributes.departmentName)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(1)

            if !primaryCompactMetric.isEmpty {
                Text("•")
                    .foregroundStyle(.white.opacity(0.38))

                Text(primaryCompactMetric)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }

            if !secondaryCompactMetric.isEmpty {
                Text("•")
                    .foregroundStyle(.white.opacity(0.38))

                Text(secondaryCompactMetric)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var metricsRow: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(metricItems.enumerated()), id: \.offset) { index, item in
                if index > 0 {
                    Rectangle()
                        .fill(Color.white.opacity(0.10))
                        .frame(width: 1)
                        .padding(.vertical, 3)
                        .padding(.horizontal, 12)
                }

                metricColumn(title: item.title, value: item.value)
            }
        }
    }

    @ViewBuilder
    private func actionRow(lineLimit: Int) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: secondaryRowIcon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(statusColor)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
                Text(actionTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.60))

                Text(actionText)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(lineLimit)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func metricColumn(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.60))

            Text(value)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusText: String {
        switch context.state.status {
        case "waiting": return "Waiting in queue"
        case "called": return "It's your turn"
        case "serving": return "Now serving"
        case "served": return "Visit complete"
        default: return context.state.status.capitalized
        }
    }

    private var statusColor: Color {
        switch context.state.status {
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

    private var statusPillText: String {
        switch context.state.status {
        case "waiting":
            return "Waiting"
        case "called":
            return "Called"
        case "serving":
            return "Serving"
        case "served":
            return "Completed"
        default:
            return context.state.status.capitalized
        }
    }

    private var lineSummary: String {
        switch context.state.status {
        case "waiting":
            if let position = context.state.position {
                return "#\(position) in line"
            }
            return "Line updating"
        case "called":
            return "Called now"
        case "serving":
            return "At desk"
        case "served":
            return "Visit complete"
        default:
            return "Queue update"
        }
    }

    private var trailingSummary: String {
        switch context.state.status {
        case "waiting":
            return context.state.estimatedWaitMinutes.map { "~\($0) min wait" } ?? ""
        case "called", "serving":
            return context.state.deskName ?? "Desk pending"
        case "served":
            return "Completed"
        default:
            return ""
        }
    }

    private var metricItems: [(title: String, value: String)] {
        switch context.state.status {
        case "waiting":
            return [
                ("In line", context.state.position.map { "#\($0)" } ?? "—"),
                ("Wait", context.state.estimatedWaitMinutes.map { "\($0) min" } ?? "—"),
                ("Now serving", context.state.nowServing ?? "Updating")
            ]
        case "called":
            return [
                ("Go to", context.state.deskName ?? "Desk"),
                ("Now serving", context.attributes.ticketNumber),
                ("Recall", context.state.recallCount > 0 ? "\(context.state.recallCount)x" : "Live")
            ]
        case "serving":
            return [
                ("At desk", context.state.deskName ?? "Desk"),
                ("Status", "In service"),
                ("Ticket", context.attributes.ticketNumber)
            ]
        case "served":
            return [
                ("Visit", "Done"),
                ("Ticket", context.attributes.ticketNumber),
                ("Status", "Completed")
            ]
        default:
            return [
                ("Ticket", context.attributes.ticketNumber),
                ("Status", statusText)
            ]
        }
    }

    private var actionTitle: String {
        switch context.state.status {
        case "waiting":
            return "Heads up"
        case "called":
            return "Next step"
        case "serving":
            return "Visit status"
        case "served":
            return "Visit update"
        default:
            return "Update"
        }
    }

    private var secondaryRowIcon: String {
        switch context.state.status {
        case "waiting":
            return "person.3.sequence.fill"
        case "called":
            return "bell.badge.fill"
        case "serving":
            return "person.fill.checkmark"
        case "served":
            return "checkmark.circle.fill"
        default:
            return "clock.fill"
        }
    }

    private var actionText: String {
        switch context.state.status {
        case "waiting":
            return "We will alert you as soon as your number is called."
        case "called":
            return "Please go to \(context.state.deskName ?? "your desk") right now."
        case "serving":
            return "A staff member is currently helping you."
        case "served":
            return "Your visit is complete. Thanks for coming."
        default:
            return statusText
        }
    }

    private var primaryCompactMetric: String {
        switch context.state.status {
        case "waiting":
            return context.state.estimatedWaitMinutes.map { "~\($0) min wait" } ?? "Wait updating"
        case "called", "serving":
            return context.state.deskName ?? "Desk pending"
        case "served":
            return "Visit complete"
        default:
            return ""
        }
    }

    private var secondaryCompactMetric: String {
        switch context.state.status {
        case "waiting":
            return context.state.nowServing.map { "Now \(String($0))" } ?? ""
        case "called":
            return "Proceed now"
        case "serving":
            return "Being served"
        case "served":
            return ""
        default:
            return ""
        }
    }
}
