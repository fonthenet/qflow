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
        ZStack {
            Color(red: 0.96, green: 0.96, blue: 0.97).ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    // Header
                    VStack(spacing: 4) {
                        Text(ticket.department?.name ?? "Queue")
                            .font(.subheadline.weight(.medium))
                            .foregroundColor(.white.opacity(0.8))
                        Text(ticket.service?.name ?? "")
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .padding(.bottom, 40)
                    .background(Color(red: 0.145, green: 0.388, blue: 0.922))

                    // Ticket number card (overlapping header)
                    VStack(spacing: 4) {
                        Text("Your Ticket")
                            .font(.caption.weight(.medium))
                            .foregroundColor(.secondary)
                        Text(ticket.ticket_number)
                            .font(.system(size: 48, weight: .heavy, design: .rounded))
                            .foregroundColor(Color(red: 0.145, green: 0.388, blue: 0.922))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 24)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(.white)
                            .shadow(color: .black.opacity(0.08), radius: 8, y: 4)
                    )
                    .padding(.horizontal, 20)
                    .offset(y: -32)

                    VStack(spacing: 12) {
                        // Position card
                        VStack(spacing: 8) {
                            Text("Your position")
                                .font(.caption.weight(.medium))
                                .foregroundColor(.secondary)

                            if let position = position {
                                Text("#\(position)")
                                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                                Text("in line")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            } else {
                                ProgressView()
                            }

                            // Progress bar
                            let progress = position.map { max(0.05, min(0.95, Double(10 - $0) / 10.0)) } ?? 0.05
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Color.gray.opacity(0.15))
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Color(red: 0.145, green: 0.388, blue: 0.922))
                                        .frame(width: geo.size.width * progress)
                                        .animation(.easeInOut(duration: 0.5), value: progress)
                                }
                            }
                            .frame(height: 8)

                            HStack {
                                Text("Joined")
                                Spacer()
                                Text("Your turn")
                            }
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        }
                        .padding(20)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(.white)
                                .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                        )

                        // Stats row
                        HStack(spacing: 12) {
                            // Estimated wait
                            VStack(spacing: 4) {
                                Text("Est. Wait")
                                    .font(.caption2.weight(.medium))
                                    .foregroundColor(.secondary)
                                if let wait = estimatedWait {
                                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                                        Text("\(wait)")
                                            .font(.title2.bold())
                                        Text("min")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                } else {
                                    Text("—")
                                        .font(.title2.weight(.semibold))
                                        .foregroundColor(.secondary)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(.white)
                                    .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                            )

                            // Now serving
                            VStack(spacing: 4) {
                                Text("Now Serving")
                                    .font(.caption2.weight(.medium))
                                    .foregroundColor(.secondary)
                                Text(nowServing ?? "—")
                                    .font(.title2.bold())
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(.white)
                                    .shadow(color: .black.opacity(0.04), radius: 4, y: 2)
                            )
                        }

                        // Notification status
                        if apnsManager.tokenSentToServer {
                            HStack(spacing: 8) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("You'll be notified when it's your turn")
                                    .font(.caption.weight(.medium))
                                    .foregroundColor(.green)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(Color.green.opacity(0.1))
                            )
                        }

                        // Waiting animation
                        VStack(spacing: 12) {
                            HStack(spacing: 6) {
                                ForEach(0..<3, id: \.self) { i in
                                    Circle()
                                        .fill(Color(red: 0.145, green: 0.388, blue: 0.922))
                                        .frame(width: 8, height: 8)
                                        .scaleEffect(animatingDot == i ? 1.3 : 1.0)
                                        .animation(
                                            .easeInOut(duration: 0.5)
                                                .repeatForever()
                                                .delay(Double(i) * 0.15),
                                            value: animatingDot
                                        )
                                }
                            }
                            Text("Waiting for your turn...")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            Text("We'll notify you — you can close this app")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        .padding(.top, 8)
                    }
                    .padding(.horizontal, 20)
                    .offset(y: -16)
                }
            }
        }
        .onAppear {
            withAnimation { animatingDot = 1 }
        }
    }

    @State private var animatingDot = 0

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

            isLoading = false
        } catch {
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
        guard let currentTicket = ticket else { return }

        do {
            let updated = try await SupabaseClient.shared.fetchTicket(token: token)
            await MainActor.run {
                ticket = updated
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
            }
        } catch {
            print("[Poll] Refresh failed: \(error)")
        }
    }
}
