import SwiftUI

/// Main queue status view — shows ticket number, position, wait time.
/// Polls for updates every 5 seconds (simpler than WebSocket for App Clip).
struct QueueView: View {
    let token: String

    @State private var ticket: Ticket?
    @State private var position: Int?
    @State private var estimatedWait: Int?
    @State private var nowServing: String?
    @State private var error: String?
    @State private var isLoading = true

    @StateObject private var apnsManager = APNsManager.shared

    // Timer for polling
    @State private var pollTimer: Timer?

    var body: some View {
        Group {
            if isLoading {
                loadingView
            } else if let error = error {
                errorView(error)
            } else if let ticket = ticket {
                if ticket.status == "called" {
                    YourTurnView(ticket: ticket)
                        .id("called-\(ticket.id)-\(ticket.called_at ?? "")-\(ticket.recall_count ?? 0)")
                } else if ticket.status == "serving" {
                    servingView
                } else if ticket.status == "served" {
                    servedView
                } else {
                    waitingView(ticket)
                }
            }
        }
        .task {
            APNsManager.shared.registerForNotifications()
            await loadTicket()
            startPolling()
        }
        .onDisappear {
            pollTimer?.invalidate()
        }
    }

    // MARK: - Loading

    private var loadingView: some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97).ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.2)
                Text("Loading your ticket...")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Error

    private func errorView(_ message: String) -> some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 40))
                    .foregroundColor(.orange)
                Text("Something went wrong")
                    .font(.headline)
                Text(message)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                Button("Try Again") {
                    isLoading = true
                    error = nil
                    Task { await loadTicket() }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }

    // MARK: - Waiting View (Main)

    private func waitingView(_ ticket: Ticket) -> some View {
        let accent = visitAccent(for: ticket.status)
        let waitValue = estimatedWait ?? ticket.estimated_wait_minutes

        return ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.07, blue: 0.14),
                    Color(red: 0.08, green: 0.11, blue: 0.22),
                    Color(red: 0.12, green: 0.18, blue: 0.32)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 18) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label("Active Visit", systemImage: "person.text.rectangle.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white.opacity(0.75))

                            Spacer()

                            Text(visitStatusText(for: ticket.status))
                                .font(.caption.weight(.bold))
                                .foregroundColor(accent)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(accent.opacity(0.18), in: Capsule())
                                .overlay(
                                    Capsule()
                                        .stroke(accent.opacity(0.35), lineWidth: 1)
                                )
                        }

                        HStack(alignment: .top, spacing: 16) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(ticket.ticket_number)
                                    .font(.system(size: 42, weight: .heavy, design: .rounded))
                                    .foregroundStyle(.white)

                                Text(ticket.department?.name ?? "Queue")
                                    .font(.headline.weight(.semibold))
                                    .foregroundStyle(.white.opacity(0.92))

                                if let serviceName = ticket.service?.name, !serviceName.isEmpty {
                                    Text(serviceName)
                                        .font(.subheadline)
                                        .foregroundStyle(.white.opacity(0.72))
                                }
                            }

                            Spacer(minLength: 0)

                            VStack(alignment: .trailing, spacing: 8) {
                                HStack(spacing: 6) {
                                    ForEach(0..<3, id: \.self) { i in
                                        Circle()
                                            .fill(accent)
                                            .frame(width: 8, height: 8)
                                            .scaleEffect(animatingDot == i ? 1.25 : 0.9)
                                            .opacity(animatingDot == i ? 1 : 0.55)
                                            .animation(
                                                .easeInOut(duration: 0.45)
                                                    .repeatForever()
                                                    .delay(Double(i) * 0.16),
                                                value: animatingDot
                                            )
                                    }
                                }

                                Text(position.map { "#\($0)" } ?? "--")
                                    .font(.system(size: 32, weight: .heavy, design: .rounded))
                                    .foregroundStyle(.white)

                                Text("Current spot")
                                    .font(.caption)
                                    .foregroundStyle(.white.opacity(0.62))
                            }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Queue progress")
                                Spacer()
                                Text(position.map { "\($0) ahead" } ?? "Calculating")
                            }
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.white.opacity(0.68))

                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule()
                                        .fill(.white.opacity(0.10))

                                    Capsule()
                                        .fill(
                                            LinearGradient(
                                                colors: [accent, accent.opacity(0.65)],
                                                startPoint: .leading,
                                                endPoint: .trailing
                                            )
                                        )
                                        .frame(width: geo.size.width * queueProgress(for: position))
                                        .animation(.easeInOut(duration: 0.45), value: position)
                                }
                            }
                            .frame(height: 12)
                        }

                        HStack(spacing: 14) {
                            Label("Updated \(Date().formatted(date: .omitted, time: .shortened))", systemImage: "clock")
                            Spacer()
                            if let recallCount = ticket.recall_count, recallCount > 0 {
                                Label("Recall \(recallCount)x", systemImage: "arrow.counterclockwise")
                            } else {
                                Label("Stay nearby", systemImage: "figure.walk")
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.68))
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .fill(Color.white.opacity(0.10))
                            .overlay(
                                RoundedRectangle(cornerRadius: 28, style: .continuous)
                                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
                            )
                    )

                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), spacing: 12),
                            GridItem(.flexible(), spacing: 12)
                        ],
                        spacing: 12
                    ) {
                        visitMetricCard(
                            title: "Position",
                            value: position.map { "#\($0)" } ?? "--",
                            detail: position.map { "\($0) ticket\($0 == 1 ? "" : "s") ahead" } ?? "Refreshing queue",
                            systemImage: "list.number",
                            accent: accent
                        )

                        visitMetricCard(
                            title: "Estimated wait",
                            value: waitValue.map { "\($0) min" } ?? "--",
                            detail: waitValue.map { $0 <= 1 ? "Almost there" : "Approximate wait" } ?? "Calculating time",
                            systemImage: "clock.badge",
                            accent: Color(red: 0.36, green: 0.73, blue: 0.99)
                        )

                        visitMetricCard(
                            title: "Now serving",
                            value: nowServing ?? "--",
                            detail: "Current counter activity",
                            systemImage: "person.3.sequence.fill",
                            accent: Color(red: 0.49, green: 0.86, blue: 0.63)
                        )

                        visitMetricCard(
                            title: "Alerts",
                            value: apnsManager.tokenSentToServer ? "Ready" : "Pending",
                            detail: apnsManager.tokenSentToServer
                                ? "Lock-screen alerts enabled"
                                : "Keep this screen open",
                            systemImage: apnsManager.tokenSentToServer ? "bell.badge.fill" : "bell.slash",
                            accent: apnsManager.tokenSentToServer
                                ? Color(red: 0.98, green: 0.76, blue: 0.28)
                                : Color(red: 0.72, green: 0.78, blue: 0.92)
                        )
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        Text("What happens next")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(.white)

                        visitStepRow(
                            icon: "bell.badge.fill",
                            title: "We will alert you",
                            detail: "A notification appears when the desk calls your number."
                        )

                        visitStepRow(
                            icon: "rectangle.portrait.and.arrow.right",
                            title: "You can close this app",
                            detail: "Your visit keeps tracking in the background after alerts are ready."
                        )

                        visitStepRow(
                            icon: "person.text.rectangle",
                            title: "Keep your ticket number handy",
                            detail: "Staff may ask for \(ticket.ticket_number) when you arrive at the desk."
                        )
                    }
                    .padding(20)
                    .background(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .fill(Color.white.opacity(0.08))
                            .overlay(
                                RoundedRectangle(cornerRadius: 24, style: .continuous)
                                    .stroke(Color.white.opacity(0.10), lineWidth: 1)
                            )
                    )
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }
        }
        .onAppear {
            withAnimation { animatingDot = 1 }
        }
    }

    @State private var animatingDot = 0

    private func visitAccent(for status: String) -> Color {
        switch status {
        case "called":
            return Color(red: 0.45, green: 0.95, blue: 0.62)
        case "serving":
            return Color(red: 0.36, green: 0.73, blue: 0.99)
        case "served":
            return Color(red: 0.72, green: 0.78, blue: 0.92)
        default:
            return Color(red: 0.98, green: 0.68, blue: 0.24)
        }
    }

    private func visitStatusText(for status: String) -> String {
        switch status {
        case "waiting":
            return "Waiting in queue"
        case "called":
            return "Your turn"
        case "serving":
            return "At the desk"
        case "served":
            return "Visit complete"
        default:
            return status.capitalized
        }
    }

    private func queueProgress(for position: Int?) -> Double {
        guard let position else { return 0.08 }
        return max(0.08, min(0.98, Double(12 - min(position, 12)) / 12.0))
    }

    @ViewBuilder
    private func visitMetricCard(
        title: String,
        value: String,
        detail: String,
        systemImage: String,
        accent: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(accent)

                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.72))
            }

            Text(value)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)

            Text(detail)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.62))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 128, alignment: .topLeading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                )
        )
    }

    @ViewBuilder
    private func visitStepRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 3) {
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

    // MARK: - Serving View

    private var servingView: some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 48))
                    .foregroundColor(Color(red: 0.145, green: 0.388, blue: 0.922))
                Text("Being Served")
                    .font(.title2.bold())
                Text("You are currently being attended to.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Served View

    private var servedView: some View {
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.green)
                Text("Visit Complete")
                    .font(.title2.bold())
                Text("Thank you for your visit!")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Data Loading

    private func loadTicket() async {
        do {
            let fetchedTicket = try await SupabaseClient.shared.fetchTicket(token: token)
            ticket = fetchedTicket

            if !AppState.shouldPersist(ticketStatus: fetchedTicket.status) {
                TicketSessionStore.clear()
            }

            // Register APNs token for this ticket
            APNsManager.shared.ticketId = fetchedTicket.id
            APNsManager.shared.registerForNotifications()

            // Fetch position and wait time
            let pos = try await SupabaseClient.shared.fetchQueuePosition(ticketId: fetchedTicket.id)
            position = pos

            let wait = try? await SupabaseClient.shared.fetchEstimatedWait(
                departmentId: fetchedTicket.department_id,
                serviceId: fetchedTicket.service_id
            )
            estimatedWait = wait

            let serving = await SupabaseClient.shared.fetchNowServing(
                departmentId: fetchedTicket.department_id,
                officeId: fetchedTicket.office_id
            )
            nowServing = serving

            await LiveActivityManager.shared.sync(
                ticket: fetchedTicket,
                position: pos,
                estimatedWait: wait,
                nowServing: serving
            )

            if !AppState.shouldPersist(ticketStatus: fetchedTicket.status) {
                APNsManager.shared.ticketId = nil
                APNsManager.shared.tokenSentToServer = false
            }

            isLoading = false
        } catch {
            if let supabaseError = error as? SupabaseError, supabaseError == .ticketNotFound {
                TicketSessionStore.clear()
                await LiveActivityManager.shared.endAll()
                await MainActor.run {
                    APNsManager.shared.ticketId = nil
                    APNsManager.shared.tokenSentToServer = false
                }
            }
            self.error = error.localizedDescription
            isLoading = false
        }
    }

    /// Poll for ticket updates every 5 seconds.
    private func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task {
                await refreshData()
            }
        }
    }

    private func refreshData() async {
        guard ticket != nil else { return }

        do {
            let updated = try await SupabaseClient.shared.fetchTicket(token: token)
            await MainActor.run {
                ticket = updated
            }

            if !AppState.shouldPersist(ticketStatus: updated.status) {
                TicketSessionStore.clear()
            }

            if updated.status == "waiting" {
                let pos = try await SupabaseClient.shared.fetchQueuePosition(ticketId: updated.id)
                let serving = await SupabaseClient.shared.fetchNowServing(
                    departmentId: updated.department_id,
                    officeId: updated.office_id
                )
                await MainActor.run {
                    position = pos
                    nowServing = serving
                }

                await LiveActivityManager.shared.sync(
                    ticket: updated,
                    position: pos,
                    estimatedWait: estimatedWait,
                    nowServing: serving
                )
            } else {
                await LiveActivityManager.shared.sync(
                    ticket: updated,
                    position: position,
                    estimatedWait: estimatedWait,
                    nowServing: nowServing
                )
            }

            if !AppState.shouldPersist(ticketStatus: updated.status) {
                await MainActor.run {
                    APNsManager.shared.ticketId = nil
                    APNsManager.shared.tokenSentToServer = false
                }
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
            print("[Poll] Refresh failed: \(error)")
        }
    }
}
