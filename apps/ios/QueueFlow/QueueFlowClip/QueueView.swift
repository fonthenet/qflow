import SwiftUI

enum WaitingScreenVariant {
    case original
    case webInspired
}

private let waitingScreenVariant: WaitingScreenVariant = .webInspired

struct QueueView: View {
    let token: String
    private let previewWaitingVariant: WaitingScreenVariant?
    private let runningForPreviews: Bool

    @EnvironmentObject private var appState: AppState
    @Environment(\.scenePhase) private var scenePhase

    @State private var ticket: Ticket?
    @State private var position: Int?
    @State private var estimatedWait: Int?
    @State private var nowServing: String?
    @State private var error: String?
    @State private var isLoading = true
    @State private var isRefreshing = false
    @State private var lastUpdatedAt: Date?
    @State private var pollTimer: Timer?
    @State private var showBuzzFlash = false
    @State private var buzzFlashCount = 0
    @State private var showStopConfirmation = false
    @State private var stopErrorMessage: String?
    @State private var showCustomerInfo = false
    @State private var visitorInfoDraft: [String: CustomerDataValue] = [:]
    @State private var isSavingVisitorInfo = false
    @State private var visitorInfoSaveError: String?
    @FocusState private var focusedVisitorField: String?

    @StateObject private var apnsManager = APNsManager.shared

    init(
        token: String,
        previewTicket: Ticket? = nil,
        previewPosition: Int? = nil,
        previewEstimatedWait: Int? = nil,
        previewNowServing: String? = nil,
        previewWaitingVariant: WaitingScreenVariant? = nil
    ) {
        self.token = token
        self.previewWaitingVariant = previewWaitingVariant
        self.runningForPreviews = ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
        _ticket = State(initialValue: previewTicket)
        _position = State(initialValue: previewPosition)
        _estimatedWait = State(initialValue: previewEstimatedWait)
        _nowServing = State(initialValue: previewNowServing)
        _isLoading = State(initialValue: previewTicket == nil)
        _lastUpdatedAt = State(initialValue: previewTicket == nil ? nil : Date())
    }

    var body: some View {
        ZStack {
            Group {
                if isLoading {
                    loadingView
                } else if let error {
                    errorView(error)
                } else if let ticket {
                    switch ticket.status {
                    case "called":
                        YourTurnView(
                            ticket: ticket,
                            lastUpdatedAt: lastUpdatedAt,
                            isRefreshing: isRefreshing,
                            onRefresh: {
                                await manualRefresh()
                            },
                            onStopTracking: {
                                showStopConfirmation = true
                            }
                        )
                    case "serving":
                        servingView(ticket)
                    case "served":
                        FeedbackView(
                            ticket: ticket,
                            officeName: visitBusinessName(for: ticket),
                            serviceName: visitServiceName(for: ticket),
                            onFinish: {
                                await stopTrackingAndClose()
                            }
                        )
                    default:
                        waitingView(ticket)
                    }
                }
            }

            if showBuzzFlash {
                Color.red
                    .ignoresSafeArea()
                    .allowsHitTesting(false)

                VStack(spacing: 8) {
                    Text("\u{1f4f3}")
                        .font(.system(size: 60))
                    Text("BUZZ!")
                        .font(.system(size: 40, weight: .black, design: .rounded))
                        .foregroundColor(.white)
                }
                .allowsHitTesting(false)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            focusedVisitorField = nil
        }
        .task {
            guard !runningForPreviews else { return }
            APNsManager.shared.registerForNotifications()
            await loadTicket()
        }
        .onDisappear {
            pollTimer?.invalidate()
        }
        .onReceive(NotificationCenter.default.publisher(for: .queueFlowBuzz)) { _ in
            startBuzzStrobe()
        }
        .onReceive(NotificationCenter.default.publisher(for: .queueFlowRecall)) { _ in
            Task { await refreshData() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .queueFlowCalled)) { _ in
            Task { await refreshData() }
        }
        .onChange(of: scenePhase) { newPhase in
            guard !runningForPreviews else { return }
            if newPhase == .active {
                Task { await refreshData() }
            }
        }
        .confirmationDialog(
            "Leave this queue?",
            isPresented: $showStopConfirmation,
            titleVisibility: .visible
        ) {
            Button("Leave Queue", role: .destructive) {
                Task {
                    await stopTrackingAndClose()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the current ticket from the queue and stops any remaining alerts or live updates.")
        }
        .alert("Could not leave the queue", isPresented: Binding(
            get: { stopErrorMessage != nil },
            set: { if !$0 { stopErrorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(stopErrorMessage ?? "Please try again.")
        }
    }

    private var loadingView: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.07, blue: 0.14),
                    Color(red: 0.05, green: 0.11, blue: 0.24),
                    Color(red: 0.08, green: 0.16, blue: 0.32)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .tint(.white)
                    .scaleEffect(1.2)

                Text("Loading your visit...")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white.opacity(0.78))
            }
        }
    }

    private func errorView(_ message: String) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.07, blue: 0.14),
                    Color(red: 0.07, green: 0.10, blue: 0.20)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Color(red: 0.99, green: 0.70, blue: 0.30))

                Text("Something went wrong")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(.white)

                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.72))
                    .multilineTextAlignment(.center)

                Button("Try Again") {
                    isLoading = true
                    error = nil
                    Task { await loadTicket() }
                }
                .buttonStyle(.borderedProminent)
                .tint(.white)
                .foregroundStyle(Color(red: 0.02, green: 0.07, blue: 0.14))
            }
            .padding(24)
        }
    }

    private func visitBusinessName(for ticket: Ticket) -> String {
        ticket.office?.name
            ?? ticket.department?.name
            ?? "Current visit"
    }

    private func visitDepartmentName(for ticket: Ticket) -> String? {
        guard let departmentName = ticket.department?.name else { return nil }
        if departmentName == ticket.office?.name {
            return nil
        }
        return departmentName
    }

    private func visitServiceName(for ticket: Ticket) -> String {
        ticket.service?.name
            ?? visitDepartmentName(for: ticket)
            ?? visitBusinessName(for: ticket)
    }

    private func visitHeaderSubtitle(for ticket: Ticket, includeSync: Bool = true) -> String {
        var parts: [String] = []
        if let departmentName = visitDepartmentName(for: ticket) {
            parts.append(departmentName)
        }
        if includeSync {
            parts.append(syncLabel)
        }
        return parts.joined(separator: " • ")
    }

    private func servingElapsedText(for ticket: Ticket, now: Date = Date()) -> String {
        guard
            let rawStartedAt = ticket.serving_started_at,
            let startedAt = parseDate(rawStartedAt)
        else {
            return "Just started"
        }

        let elapsed = max(0, Int(now.timeIntervalSince(startedAt)))
        let hours = elapsed / 3600
        let minutes = (elapsed % 3600) / 60
        let seconds = elapsed % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }

        return String(format: "%02d:%02d", minutes, seconds)
    }

    private func parseDate(_ value: String) -> Date? {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFormatter.date(from: value) {
            return date
        }

        let fallbackFormatter = ISO8601DateFormatter()
        fallbackFormatter.formatOptions = [.withInternetDateTime]
        return fallbackFormatter.date(from: value)
    }

    private func waitingView(_ ticket: Ticket) -> some View {
        switch previewWaitingVariant ?? waitingScreenVariant {
        case .original:
            return AnyView(originalWaitingView(ticket))
        case .webInspired:
            return AnyView(webInspiredWaitingView(ticket))
        }
    }

    private func originalWaitingView(_ ticket: Ticket) -> some View {
        let waitValue = estimatedWait ?? ticket.estimated_wait_minutes

        return ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.03, green: 0.07, blue: 0.14),
                    Color(red: 0.06, green: 0.11, blue: 0.24),
                    Color(red: 0.10, green: 0.17, blue: 0.30)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack(alignment: .top, spacing: 14) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Ticket")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.white.opacity(0.66))
                                    .textCase(.uppercase)

                                Text(ticket.ticket_number)
                                    .font(.system(size: 42, weight: .heavy, design: .rounded))
                                    .foregroundStyle(.white)

                                Text(visitServiceName(for: ticket))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.white.opacity(0.86))
                            }

                            Spacer(minLength: 0)

                            VStack(alignment: .trailing, spacing: 8) {
                                Text(position.map { "#\($0)" } ?? "--")
                                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                                    .foregroundStyle(.white)

                                Text(position.map { $0 > 1 ? "\($0 - 1) ahead" : "Almost there" } ?? "Calculating")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.68))
                            }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Queue progress")
                                Spacer()
                                Text(position.map { "#\($0) in line" } ?? "Updating")
                            }
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white.opacity(0.68))

                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule()
                                        .fill(.white.opacity(0.08))

                                    Capsule()
                                        .fill(
                                            LinearGradient(
                                                colors: [
                                                    Color(red: 0.43, green: 0.84, blue: 0.99),
                                                    Color(red: 0.48, green: 0.94, blue: 0.72)
                                                ],
                                                startPoint: .leading,
                                                endPoint: .trailing
                                            )
                                        )
                                        .frame(width: geo.size.width * queueProgress(for: position))
                                }
                            }
                            .frame(height: 12)
                        }
                    }
                    .padding(20)
                    .background(glassCard(radius: 30))

                    HStack(spacing: 12) {
                        visitMetricCard(
                            title: "Wait",
                            value: waitValue.map { "\($0) min" } ?? "--",
                            detail: waitValue != nil ? "Approximate timing" : "Calculating time",
                            accent: Color(red: 0.39, green: 0.76, blue: 0.99)
                        )

                        visitMetricCard(
                            title: "Now serving",
                            value: nowServing ?? "--",
                            detail: "Current desk activity",
                            accent: Color(red: 0.49, green: 0.86, blue: 0.63)
                        )

                        visitMetricCard(
                            title: "Alerts",
                            value: apnsManager.tokenSentToServer ? "Ready" : "Pending",
                            detail: apnsManager.tokenSentToServer ? "Background alerts on" : "Keep this screen open",
                            accent: Color(red: 0.99, green: 0.75, blue: 0.30)
                        )
                    }

                    waitingMessageCard
                    .padding(20)
                    .background(glassCard(radius: 26))

                    if !editableVisitorInfo(for: ticket).isEmpty {
                        visitorInfoCard(ticket: ticket)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }
            .refreshable {
                await manualRefresh()
            }
        }
    }

    private func webInspiredWaitingView(_ ticket: Ticket) -> some View {
        let lineValue = position.map { "#\($0)" } ?? "--"
        let queueLabel = position.map { "#\($0) in line" } ?? "--"
        let statusText = position == 1
            ? "Almost there"
            : (position != nil && position! <= 3 ? "You are nearly up" : (position != nil ? "\(max(position! - 1, 0)) ahead of you" : "--"))
        let departmentLabel = visitBusinessName(for: ticket).uppercased()
        let serviceLabel = visitServiceName(for: ticket)
        let headerSubtitle = visitHeaderSubtitle(for: ticket)
        let accentLabel = ticket.status == "serving" ? "NOW AT DESK" : "WAITING IN LINE"
        let accentTextColor = ticket.status == "serving"
            ? Color(red: 0.78, green: 0.94, blue: 1.0)
            : Color(red: 0.98, green: 0.93, blue: 0.74)
        let accentFill = ticket.status == "serving"
            ? Color(red: 0.20, green: 0.48, blue: 0.68).opacity(0.24)
            : Color(red: 0.58, green: 0.46, blue: 0.16).opacity(0.24)

        return ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.09, blue: 0.17),
                    Color(red: 0.07, green: 0.14, blue: 0.24),
                    Color(red: 0.10, green: 0.09, blue: 0.16)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            RadialGradient(
                colors: [
                    Color(red: 0.22, green: 0.74, blue: 0.98).opacity(0.20),
                    .clear
                ],
                center: .top,
                startRadius: 20,
                endRadius: 320
            )
            .ignoresSafeArea()

            RadialGradient(
                colors: [
                    Color(red: 0.98, green: 0.50, blue: 0.18).opacity(0.16),
                    .clear
                ],
                center: UnitPoint(x: 0.8, y: 0.2),
                startRadius: 10,
                endRadius: 180
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 16) {
                    HStack(alignment: .top, spacing: 18) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(departmentLabel)
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .tracking(4.5)
                                .foregroundStyle(Color.white.opacity(0.38))

                            Text(serviceLabel)
                                .font(.system(size: 30, weight: .semibold, design: .rounded))
                                .foregroundStyle(.white)
                                .tracking(-0.5)
                                .lineLimit(3)

                            Text(headerSubtitle)
                                .font(.system(size: 14, weight: .regular, design: .rounded))
                                .foregroundStyle(Color.white.opacity(0.58))
                        }

                        Spacer(minLength: 0)

                        VStack(alignment: .trailing, spacing: 10) {
                            Text(accentLabel)
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .tracking(2.6)
                                .foregroundStyle(accentTextColor)
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 7)
                                .background(
                                    Capsule()
                                        .fill(accentFill)
                                )

                            HStack(spacing: 12) {
                                sessionButton(
                                    title: "Refresh",
                                    systemImage: "arrow.clockwise",
                                    tone: .primary,
                                    isAnimatingIcon: isRefreshing
                                ) {
                                    Task { await manualRefresh() }
                                }
                                .disabled(isRefreshing)

                                sessionButton(title: "End", systemImage: "xmark.circle", tone: .danger) {
                                    showStopConfirmation = true
                                }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 28) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("TICKET")
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .tracking(6)
                                    .foregroundStyle(Color.white.opacity(0.48))

                                Text(ticket.ticket_number)
                                    .font(.system(size: 56, weight: .black, design: .rounded))
                                    .foregroundStyle(.white)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.60)

                                Text(serviceLabel)
                                    .font(.system(size: 14, weight: .medium, design: .rounded))
                                    .foregroundStyle(Color.white.opacity(0.78))
                                    .lineLimit(1)
                            }

                            Spacer(minLength: 24)

                            VStack(alignment: .trailing, spacing: 10) {
                                Text(lineValue)
                                    .font(.system(size: 54, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white)

                                Text(statusText)
                                    .font(.system(size: 14, weight: .medium, design: .rounded))
                                    .foregroundStyle(Color.white.opacity(0.62))
                                    .multilineTextAlignment(.trailing)
                                }
                        }

                        VStack(alignment: .leading, spacing: 14) {
                            HStack {
                                Text("QUEUE PROGRESS")
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .tracking(4)
                                    .foregroundStyle(Color.white.opacity(0.48))

                                Spacer()

                                Text((ticket.status == "serving" ? "AT THE DESK" : queueLabel).uppercased())
                                    .font(.system(size: 11, weight: .bold, design: .rounded))
                                    .tracking(2.6)
                                    .foregroundStyle(Color(red: 0.16, green: 0.93, blue: 0.73))
                            }

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
                                        .frame(width: geo.size.width * queueProgress(for: position))
                                }
                            }
                            .frame(height: 12)
                        }
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 32, style: .continuous)
                            .fill(
                                Color.white.opacity(0.06)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 32, style: .continuous)
                                    .stroke(Color.white.opacity(0.10), lineWidth: 1)
                            )
                    )

                    HStack(spacing: 12) {
                        visitMetricCard(
                            title: "Wait",
                            value: estimatedWait != nil ? "\(estimatedWait!) min" : "--",
                            detail: estimatedWait != nil ? "Approximate timing" : "Calculating time",
                            accent: Color(red: 0.22, green: 0.73, blue: 1.0)
                        )

                        visitMetricCard(
                            title: "Now serving",
                            value: nowServing ?? "--",
                            detail: "Current desk activity",
                            accent: Color(red: 0.20, green: 0.88, blue: 0.55)
                        )

                        visitMetricCard(
                            title: "Alerts",
                            value: apnsManager.tokenSentToServer ? "Ready" : "Off",
                            detail: apnsManager.tokenSentToServer ? "Background alerts on" : "Turn alerts on",
                            accent: Color(red: 0.98, green: 0.72, blue: 0.26)
                        )
                    }

                    waitingMessageCard
                        .padding(20)
                        .background(glassCard(radius: 28))

                    if !editableVisitorInfo(for: ticket).isEmpty {
                        visitorInfoCard(ticket: ticket)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable {
                await manualRefresh()
            }
        }
    }

    private func webWaitingStat(
        label: String,
        value: String,
        detail: String,
        accent: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label)
                .font(.caption.weight(.bold))
                .foregroundStyle(accent)
                .textCase(.uppercase)
                .tracking(1.2)

            Text(value)
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.70)

            Text(detail)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.66))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func servingView(_ ticket: Ticket) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.07, blue: 0.14),
                    Color(red: 0.05, green: 0.11, blue: 0.24),
                    Color(red: 0.08, green: 0.16, blue: 0.32)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    actionHeader(
                        title: visitServiceName(for: ticket),
                        eyebrow: visitBusinessName(for: ticket),
                        section: visitDepartmentName(for: ticket),
                        subtitle: visitHeaderSubtitle(for: ticket),
                        accentText: "With staff now"
                    )

                    VStack(spacing: 18) {
                        Image(systemName: "person.2.fill")
                            .font(.system(size: 52))
                            .foregroundStyle(Color(red: 0.39, green: 0.76, blue: 0.99))

                        Text("You are being served")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)

                        Text("Stay with the staff member at \(ticket.deskDisplayName). Once your visit is complete, you can finish this session.")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.72))
                            .multilineTextAlignment(.center)

                        HStack(spacing: 12) {
                            visitMetricCard(
                                title: "Ticket",
                                value: ticket.ticket_number,
                                detail: "Keep this visible",
                                accent: Color(red: 0.39, green: 0.76, blue: 0.99)
                            )
                            visitMetricCard(
                                title: "Desk",
                                value: ticket.deskDisplayName,
                                detail: "Current service point",
                                accent: Color(red: 0.49, green: 0.86, blue: 0.63)
                            )
                        }

                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            HStack(spacing: 12) {
                                visitMetricCard(
                                    title: "With staff for",
                                    value: servingElapsedText(for: ticket, now: context.date),
                                    detail: "Live visit timer",
                                    accent: Color(red: 0.98, green: 0.78, blue: 0.31)
                                )
                                visitMetricCard(
                                    title: "Business",
                                    value: visitBusinessName(for: ticket),
                                    detail: visitDepartmentName(for: ticket) ?? "Current location",
                                    accent: Color(red: 0.68, green: 0.76, blue: 0.99)
                                )
                            }
                        }
                    }
                    .padding(24)
                    .background(glassCard(radius: 30))
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }
        }
    }

    private func actionHeader(title: String, eyebrow: String, section: String?, subtitle: String, accentText: String) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Text(eyebrow)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.68))
                    .textCase(.uppercase)
                    .tracking(4)

                if let section, !section.isEmpty {
                    Text(section)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color(red: 0.43, green: 0.84, blue: 0.99))
                }

                Text(title)
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)

                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.72))
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 10) {
                Text(accentText)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color(red: 0.43, green: 0.84, blue: 0.99))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.10), in: Capsule())

                HStack(spacing: 8) {
                    sessionButton(title: isRefreshing ? "Refreshing..." : "Refresh", systemImage: "arrow.clockwise") {
                        Task { await manualRefresh() }
                    }
                    .disabled(isRefreshing)

                    sessionButton(title: "End", systemImage: "xmark") {
                        showStopConfirmation = true
                    }
                }
            }
        }
    }

    private enum SessionButtonTone {
        case primary
        case danger
        case neutral
    }

    private func sessionButton(
        title: String,
        systemImage: String,
        tone: SessionButtonTone = .neutral,
        isAnimatingIcon: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        let fill: LinearGradient
        let stroke: Color

        switch tone {
        case .primary:
            fill = LinearGradient(
                colors: [
                    Color(red: 0.12, green: 0.42, blue: 0.72).opacity(0.42),
                    Color(red: 0.16, green: 0.55, blue: 0.86).opacity(0.28)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            stroke = Color(red: 0.29, green: 0.63, blue: 0.96).opacity(0.45)
        case .danger:
            fill = LinearGradient(
                colors: [
                    Color(red: 0.47, green: 0.18, blue: 0.31).opacity(0.34),
                    Color(red: 0.66, green: 0.22, blue: 0.36).opacity(0.24)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            stroke = Color(red: 0.90, green: 0.43, blue: 0.58).opacity(0.38)
        case .neutral:
            fill = LinearGradient(
                colors: [Color.white.opacity(0.12), Color.white.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            stroke = Color.white.opacity(0.12)
        }

        return Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .rotationEffect(.degrees(isAnimatingIcon ? 360 : 0))
                    .animation(
                        isAnimatingIcon
                            ? .linear(duration: 0.9).repeatForever(autoreverses: false)
                            : .default,
                        value: isAnimatingIcon
                    )

                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(minWidth: 88)
            .contentShape(Capsule())
            .foregroundStyle(.white)
            .background(
                Capsule()
                    .fill(fill)
                    .overlay(
                        Capsule()
                            .stroke(stroke, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private func glassCard(radius: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Color.white.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(Color.white.opacity(0.10), lineWidth: 1)
            )
    }

    private func queueProgress(for position: Int?) -> Double {
        guard let position else { return 0.08 }
        return max(0.08, min(0.98, Double(12 - min(position, 12)) / 12.0))
    }

    private func visitMetricCard(
        title: String,
        value: String,
        detail: String,
        accent: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(accent)
                .textCase(.uppercase)
                .lineLimit(1)

            Text(value)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.70)

            Text(detail)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.64))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 102, alignment: .topLeading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(glassCard(radius: 20))
    }

    private var waitingMessageCard: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "bell.badge.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(red: 0.98, green: 0.82, blue: 0.29))
                .frame(width: 30, height: 30)
                .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))

            Text("We will alert you when it's your turn.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func visitorInfoCard(ticket: Ticket) -> some View {
        let editableKeys = editableVisitorInfo(for: ticket).keys.sorted()

        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showCustomerInfo.toggle()
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "person")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.72))

                    Text("My Information")
                        .font(.system(size: 18, weight: .medium, design: .rounded))
                        .foregroundStyle(.white)

                    Spacer()

                    Image(systemName: "chevron.up")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.62))
                        .rotationEffect(.degrees(showCustomerInfo ? 0 : 180))
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 18)
            }
            .buttonStyle(.plain)

            if showCustomerInfo {
                Divider()
                    .overlay(Color.white.opacity(0.08))

                VStack(alignment: .leading, spacing: 14) {
                    ForEach(editableKeys, id: \.self) { key in
                        visitorFieldEditorRow(key: key)
                    }

                    if let visitorInfoSaveError {
                        Text(visitorInfoSaveError)
                            .font(.caption)
                            .foregroundStyle(Color.red.opacity(0.92))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        Task {
                            await saveVisitorInfo(ticketId: ticket.id)
                        }
                    } label: {
                        Text(isSavingVisitorInfo ? "Saving..." : "Save Changes")
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(Color(red: 0.10, green: 0.30, blue: 0.40))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .stroke(Color(red: 0.10, green: 0.50, blue: 0.65).opacity(0.75), lineWidth: 1)
                                    )
                            )
                            .foregroundStyle(Color(red: 0.90, green: 0.96, blue: 0.97))
                    }
                    .buttonStyle(.plain)
                    .disabled(isSavingVisitorInfo)
                }
                .padding(.horizontal, 18)
                .padding(.top, 16)
                .padding(.bottom, 18)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Color.white.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                )
        )
        .onAppear {
            if visitorInfoDraft.isEmpty || Set(visitorInfoDraft.keys) != Set(editableKeys) {
                visitorInfoDraft = editableVisitorInfo(for: ticket)
            }
        }
    }

    private func formatVisitorLabel(_ key: String) -> String {
        key
            .split(separator: "_")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    private func isRequiredVisitorField(_ key: String) -> Bool {
        let lowered = key.lowercased()
        return lowered.contains("name") || lowered.contains("phone") || lowered.contains("service")
    }

    private func editableVisitorInfo(for ticket: Ticket) -> [String: CustomerDataValue] {
        (ticket.customer_data ?? [:]).filter { _, value in
            switch value {
            case .string, .bool, .int, .double:
                return true
            case .object, .array, .null:
                return false
            }
        }
    }

    @ViewBuilder
    private func visitorFieldEditorRow(key: String) -> some View {
        let label = formatVisitorLabel(key)

        switch visitorInfoDraft[key] ?? .null {
        case .bool(let value):
            visitorFieldShell(label: label, isRequired: isRequiredVisitorField(key)) {
                Toggle(isOn: Binding(
                    get: { value },
                    set: { visitorInfoDraft[key] = .bool($0) }
                )) {
                    Text("")
                }
                .labelsHidden()
                .tint(Color(red: 0.18, green: 0.58, blue: 0.95))
            }
        case .string(let value):
            visitorFieldTextRow(
                key: key,
                label: label,
                text: Binding(
                    get: { value },
                    set: { visitorInfoDraft[key] = .string($0) }
                ),
                keyboardType: keyboardType(for: key)
            )
        case .int(let value):
            visitorFieldTextRow(
                key: key,
                label: label,
                text: Binding(
                    get: { String(value) },
                    set: { visitorInfoDraft[key] = .int(Int($0) ?? value) }
                ),
                keyboardType: .numberPad
            )
        case .double(let value):
            visitorFieldTextRow(
                key: key,
                label: label,
                text: Binding(
                    get: { String(value) },
                    set: { visitorInfoDraft[key] = .double(Double($0) ?? value) }
                ),
                keyboardType: .decimalPad
            )
        case .object, .array, .null:
            EmptyView()
        }
    }

    private func visitorFieldTextRow(
        key: String,
        label: String,
        text: Binding<String>,
        keyboardType: UIKeyboardType
    ) -> some View {
        visitorFieldShell(label: label, isRequired: isRequiredVisitorField(key)) {
            TextField("", text: text)
                .keyboardType(keyboardType)
                .textInputAutocapitalization(.words)
                .disableAutocorrection(true)
                .foregroundStyle(.white)
                .focused($focusedVisitorField, equals: key)
        }
    }

    private func visitorFieldShell<Content: View>(
        label: String,
        isRequired: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 2) {
                Text(label)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(Color.white.opacity(0.62))
                if isRequired {
                    Text("*")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.red.opacity(0.90))
                }
            }

            HStack {
                content()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                    )
            )
        }
    }

    private func keyboardType(for key: String) -> UIKeyboardType {
        let lowered = key.lowercased()
        if lowered.contains("email") {
            return .emailAddress
        }
        if lowered.contains("phone") || lowered.contains("mobile") {
            return .phonePad
        }
        return .default
    }

    private func saveVisitorInfo(ticketId: String) async {
        await MainActor.run {
            isSavingVisitorInfo = true
            visitorInfoSaveError = nil
        }

        let success = await SupabaseClient.shared.updateCustomerData(
            ticketId: ticketId,
            customerData: visitorInfoDraft
        )

        await MainActor.run {
            isSavingVisitorInfo = false
        }

        guard success else {
            await MainActor.run {
                visitorInfoSaveError = "We could not save your information right now. Please try again."
            }
            return
        }

        await refreshData()
        await MainActor.run {
            if let ticket {
                visitorInfoDraft = editableVisitorInfo(for: ticket)
            }
        }
    }

    private var syncLabel: String {
        if isRefreshing {
            return "Refreshing now"
        }

        if let lastUpdatedAt {
            return "Updated \(lastUpdatedAt.formatted(date: .omitted, time: .shortened))"
        }

        return "Syncing live updates"
    }

    private func loadTicket() async {
        await fetchSnapshot(showLoader: true)
        startPolling()
    }

    private func manualRefresh() async {
        await MainActor.run {
            isRefreshing = true
        }
        await refreshData()
        await MainActor.run {
            isRefreshing = false
        }
    }

    private func refreshData() async {
        await fetchSnapshot(showLoader: false)
    }

    private func fetchSnapshot(showLoader: Bool) async {
        if showLoader {
            await MainActor.run {
                isLoading = true
            }
        }

        do {
            let fetchedTicket = try await SupabaseClient.shared.fetchTicket(token: token)
            let currentPosition = fetchedTicket.status == "waiting"
                ? try await SupabaseClient.shared.fetchQueuePosition(ticketId: fetchedTicket.id)
                : nil
            let currentWait = fetchedTicket.status == "waiting"
                ? try await SupabaseClient.shared.fetchEstimatedWait(
                    departmentId: fetchedTicket.department_id,
                    serviceId: fetchedTicket.service_id
                )
                : fetchedTicket.estimated_wait_minutes
            let currentServing = await SupabaseClient.shared.fetchNowServing(
                departmentId: fetchedTicket.department_id,
                officeId: fetchedTicket.office_id
            )

            await LiveActivityManager.shared.sync(
                ticket: fetchedTicket,
                position: currentPosition,
                estimatedWait: currentWait,
                nowServing: currentServing
            )

            let shouldDismissTicket = ["cancelled", "no_show", "transferred"].contains(fetchedTicket.status)
            if shouldDismissTicket {
                await appState.clearCurrentTicket()
                await MainActor.run {
                    ticket = nil
                    error = nil
                    isLoading = false
                    lastUpdatedAt = Date()
                }
                return
            }

            if !AppState.shouldPersist(ticketStatus: fetchedTicket.status) {
                TicketSessionStore.clear()
                APNsManager.shared.ticketId = nil
                APNsManager.shared.tokenSentToServer = false
            } else {
                APNsManager.shared.ticketId = fetchedTicket.id
                APNsManager.shared.registerForNotifications()
            }

            await MainActor.run {
                ticket = fetchedTicket
                position = currentPosition
                estimatedWait = currentWait
                nowServing = currentServing
                error = nil
                isLoading = false
                lastUpdatedAt = Date()
            }
        } catch {
            if let supabaseError = error as? SupabaseError, supabaseError == .ticketNotFound {
                TicketSessionStore.clear()
                await LiveActivityManager.shared.endAll()
                await MainActor.run {
                    APNsManager.shared.ticketId = nil
                    APNsManager.shared.tokenSentToServer = false
                }
            }

            await MainActor.run {
                if ticket == nil || showLoader {
                    self.error = error.localizedDescription
                }
                isLoading = false
            }
        }
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task {
                await refreshData()
            }
        }
    }

    private func startBuzzStrobe() {
        guard !showBuzzFlash else { return }
        buzzFlashCount = 0
        showBuzzFlash = true

        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { timer in
            DispatchQueue.main.async {
                self.buzzFlashCount += 1
                if self.buzzFlashCount >= 15 {
                    timer.invalidate()
                    self.showBuzzFlash = false
                    return
                }
                self.showBuzzFlash.toggle()
            }
        }
    }

    private func stopTrackingAndClose() async {
        let currentTicketId = ticket?.id
        let currentStatus = ticket?.status
        if let currentTicketId {
            let result = await SupabaseClient.shared.stopTracking(ticketId: currentTicketId)
            guard result != nil else {
                await MainActor.run {
                    stopErrorMessage = ["waiting", "called", "serving", "issued"].contains(currentStatus ?? "")
                        ? "We could not leave the queue just yet. Please try again."
                        : "We could not finish this visit just yet. Please try again."
                }
                return
            }
        }
        await appState.clearCurrentTicket()
    }
}

#Preview("Waiting Screen") {
    QueueView(
        token: "preview-token",
        previewTicket: Ticket(
            id: "preview-ticket",
            qr_token: "preview-token",
            office_id: "preview-office",
            department_id: "preview-department",
            service_id: "preview-service",
            ticket_number: "CS-045",
            status: "waiting",
            desk_id: nil,
            called_at: nil,
            serving_started_at: nil,
            called_by_staff_id: nil,
            estimated_wait_minutes: 6,
            recall_count: 0,
            customer_data: [
                "name": .string("APNs Test"),
                "source": .string("preview")
            ],
            office: Ticket.Office(name: "Alfabits"),
            department: Ticket.Department(name: "Client Services", code: "CS"),
            service: Ticket.Service(name: "Mail & Packages"),
            desk: nil
        ),
        previewPosition: 3,
        previewEstimatedWait: 6,
        previewNowServing: "CS-042",
        previewWaitingVariant: .webInspired
    )
    .environmentObject(AppState())
}

#Preview("Waiting Screen Original") {
    QueueView(
        token: "preview-token",
        previewTicket: Ticket(
            id: "preview-ticket",
            qr_token: "preview-token",
            office_id: "preview-office",
            department_id: "preview-department",
            service_id: "preview-service",
            ticket_number: "CS-045",
            status: "waiting",
            desk_id: nil,
            called_at: nil,
            serving_started_at: nil,
            called_by_staff_id: nil,
            estimated_wait_minutes: 6,
            recall_count: 0,
            customer_data: [
                "name": .string("APNs Test"),
                "source": .string("preview")
            ],
            office: Ticket.Office(name: "Alfabits"),
            department: Ticket.Department(name: "Client Services", code: "CS"),
            service: Ticket.Service(name: "Mail & Packages"),
            desk: nil
        ),
        previewPosition: 3,
        previewEstimatedWait: 6,
        previewNowServing: "CS-042",
        previewWaitingVariant: .original
    )
    .environmentObject(AppState())
}
