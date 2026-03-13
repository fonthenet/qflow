import SwiftUI

struct QueueView: View {
    let token: String

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

    @StateObject private var apnsManager = APNsManager.shared

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
                            officeName: ticket.department?.name ?? "Queue",
                            serviceName: ticket.service?.name ?? "Service",
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
        .task {
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
            if newPhase == .active {
                Task { await refreshData() }
            }
        }
        .confirmationDialog(
            "Stop tracking this visit?",
            isPresented: $showStopConfirmation,
            titleVisibility: .visible
        ) {
            Button("Stop Tracking", role: .destructive) {
                Task {
                    await stopTrackingAndClose()
                }
            }
            Button("Keep Tracking", role: .cancel) {}
        } message: {
            Text("This clears the current ticket from this App Clip and stops any remaining alerts or live updates.")
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

    private func waitingView(_ ticket: Ticket) -> some View {
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
                    actionHeader(
                        title: ticket.service?.name ?? "Queue",
                        subtitle: syncLabel,
                        accentText: ticket.status == "waiting" ? "Waiting in line" : "Active visit"
                    )

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

                                Text(ticket.department?.name ?? "Queue")
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

                    VStack(alignment: .leading, spacing: 14) {
                        Text("What happens next")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.white)

                        visitStepRow(
                            icon: "bell.badge.fill",
                            title: "We will alert you",
                            detail: "When the desk calls your number, the screen and lock screen update immediately."
                        )

                        visitStepRow(
                            icon: "arrow.clockwise",
                            title: "Refresh any time",
                            detail: "Use Refresh whenever you want an instant sync, just like pull to refresh."
                        )

                        visitStepRow(
                            icon: "xmark.circle",
                            title: "Finish when you are done",
                            detail: "Use End to clear this visit from the App Clip once service is complete."
                        )
                    }
                    .padding(20)
                    .background(glassCard(radius: 26))
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
                        title: ticket.service?.name ?? "Queue",
                        subtitle: syncLabel,
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

    private func actionHeader(title: String, subtitle: String, accentText: String) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Text("QueueFlow")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.68))
                    .textCase(.uppercase)

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

    private func sessionButton(title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.10))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.10), lineWidth: 1)
                        )
                )
                .foregroundStyle(.white)
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
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(accent)
                .textCase(.uppercase)

            Text(value)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.70)

            Text(detail)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.64))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
        .padding(16)
        .background(glassCard(radius: 24))
    }

    private func visitStepRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)

                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.68))
            }

            Spacer(minLength: 0)
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
                self.error = error.localizedDescription
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
        if let currentTicketId {
            await SupabaseClient.shared.stopTracking(ticketId: currentTicketId)
        }
        await appState.clearCurrentTicket()
    }
}
