import SwiftUI
import AVFoundation

enum CountdownPhase {
    case green, yellow, red

    var startColor: Color {
        switch self {
        case .green:  return Color(red: 0.32, green: 0.66, blue: 0.48)
        case .yellow: return Color(red: 0.96, green: 0.74, blue: 0.24)
        case .red:    return Color(red: 0.82, green: 0.24, blue: 0.22)
        }
    }

    var midColor: Color {
        switch self {
        case .green:  return Color(red: 0.12, green: 0.52, blue: 0.34)
        case .yellow: return Color(red: 0.83, green: 0.57, blue: 0.12)
        case .red:    return Color(red: 0.61, green: 0.14, blue: 0.14)
        }
    }

    var endColor: Color {
        switch self {
        case .green:  return Color(red: 0.04, green: 0.29, blue: 0.18)
        case .yellow: return Color(red: 0.57, green: 0.36, blue: 0.08)
        case .red:    return Color(red: 0.35, green: 0.08, blue: 0.09)
        }
    }

    var darkPanelColor: Color {
        switch self {
        case .green:  return Color(red: 0.05, green: 0.36, blue: 0.21)
        case .yellow: return Color(red: 0.50, green: 0.33, blue: 0.09)
        case .red:    return Color(red: 0.36, green: 0.09, blue: 0.09)
        }
    }

    var glowColor: Color {
        switch self {
        case .green:  return Color(red: 0.49, green: 0.89, blue: 0.67)
        case .yellow: return Color(red: 0.99, green: 0.84, blue: 0.37)
        case .red:    return Color(red: 0.98, green: 0.46, blue: 0.46)
        }
    }

    static func from(countdown: Int) -> CountdownPhase {
        if countdown > 30 { return .green }
        if countdown > 10 { return .yellow }
        return .red
    }

    var topGlowColor: Color {
        switch self {
        case .green:  return Color(red: 0.80, green: 0.95, blue: 0.86)
        case .yellow: return Color(red: 1.00, green: 0.92, blue: 0.63)
        case .red:    return Color(red: 1.00, green: 0.76, blue: 0.72)
        }
    }

    var sideGlowColor: Color {
        switch self {
        case .green:  return Color(red: 0.10, green: 0.78, blue: 0.53)
        case .yellow: return Color(red: 0.96, green: 0.62, blue: 0.18)
        case .red:    return Color(red: 0.90, green: 0.24, blue: 0.28)
        }
    }
}

#Preview("Calling Screen") {
    YourTurnView(
        ticket: Ticket(
            id: "preview-called-ticket",
            qr_token: "preview-token",
            office_id: "preview-office",
            department_id: "preview-department",
            service_id: "preview-service",
            ticket_number: "CS-045",
            status: "called",
            desk_id: "desk-1",
            called_at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-12)),
            serving_started_at: nil,
            called_by_staff_id: "staff-1",
            estimated_wait_minutes: 0,
            recall_count: 1,
            customer_data: [
                "full_name": .string("APNs Test"),
                "phone_number": .string("07 123 456 78")
            ],
            office: Ticket.Office(name: "Downtown Branch", organization: Ticket.Organization(name: "Alfabits")),
            department: Ticket.Department(name: "Client Services", code: "CS"),
            service: Ticket.Service(name: "Mail & Packages"),
            desk: Ticket.Desk(name: "Counter 1", display_name: "Counter 1")
        ),
        lastUpdatedAt: .now,
        isRefreshing: false,
        onRefresh: {},
        onStopTracking: {}
    )
}

struct YourTurnView: View {
    let ticket: Ticket
    let lastUpdatedAt: Date?
    let isRefreshing: Bool
    let onRefresh: () async -> Void
    let onStopTracking: () -> Void

    private let waitSeconds = 60

    @State private var countdown: Int = 60
    @State private var calledAt: Date = Date()
    @State private var recallCount: Int = 0
    @State private var phase: CountdownPhase = .green
    @State private var isAnimating = false
    @State private var pulseScale: CGFloat = 1.0
    @State private var redPulseOpacity: Double = 1.0
    @State private var showBuzzFlash = false
    @State private var buzzFlashCount = 0
    @State private var soundUnlocked = false

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var businessName: String {
        if let orgName = ticket.office?.organization?.name, !orgName.isEmpty {
            return orgName
        }
        return ticket.office?.name ?? ticket.department?.name ?? ticket.service?.name ?? "Business"
    }

    private var branchLine: String? {
        let biz = businessName
        // If org name shown, show office as branch
        if let orgName = ticket.office?.organization?.name, !orgName.isEmpty,
           let officeName = ticket.office?.name, !officeName.isEmpty,
           officeName != orgName {
            return officeName
        }
        // Otherwise show department if different
        if let deptName = ticket.department?.name, !deptName.isEmpty, deptName != biz {
            return deptName
        }
        return nil
    }

    private var serviceName: String {
        ticket.service?.name ?? ticket.department?.name ?? businessName
    }

    private var headerSubtitle: String {
        let updateText = syncLabel.replacingOccurrences(of: "Updated", with: "Last update:")
        if let branch = branchLine {
            return "\(branch) • \(updateText)"
        }
        return updateText
    }

    private var bellShouldRipple: Bool {
        countdown > 0
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [phase.startColor, phase.midColor, phase.endColor],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.7), value: phase)

            RadialGradient(
                colors: [phase.topGlowColor.opacity(0.24), .clear],
                center: .top,
                startRadius: 20,
                endRadius: 320
            )
            .ignoresSafeArea()

            RadialGradient(
                colors: [phase.sideGlowColor.opacity(0.18), .clear],
                center: UnitPoint(x: 0.82, y: 0.16),
                startRadius: 10,
                endRadius: 240
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    Color.white.opacity(0.10),
                    .clear,
                    Color.black.opacity(0.10)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            LinearGradient(
                colors: [
                    .clear,
                    phase.darkPanelColor.opacity(0.10),
                    phase.darkPanelColor.opacity(0.24),
                    phase.darkPanelColor.opacity(0.42),
                    phase.darkPanelColor.opacity(0.58)
                ],
                startPoint: UnitPoint(x: 0.5, y: 0.42),
                endPoint: .bottom
            )
            .ignoresSafeArea()

            RadialGradient(
                colors: [
                    .clear,
                    phase.darkPanelColor.opacity(0.18),
                    phase.darkPanelColor.opacity(0.30)
                ],
                center: UnitPoint(x: 0.5, y: 0.82),
                startRadius: 160,
                endRadius: 520
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    topBar

                    VStack(spacing: 18) {
                        bellHero

                        Text("Go to \(ticket.deskDisplayName)")
                            .font(.system(size: 34, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.center)

                        if recallCount > 0 {
                            recallBadge
                        }

                        countdownCard

                        Text(urgencyMessage)
                            .font(.subheadline.weight(.medium))
                            .foregroundColor(.white.opacity(0.86))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 30)

                        infoCard
                    }
                    .padding(.top, 10)

                    if !soundUnlocked {
                        Button {
                            unlockAlertsAndReplay()
                        } label: {
                            Label("Tap for sound and haptics", systemImage: "speaker.wave.2.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color(red: 0.03, green: 0.07, blue: 0.14))
                                .padding(.horizontal, 18)
                                .padding(.vertical, 14)
                                .background(
                                    Capsule()
                                        .fill(Color.white)
                                )
                        }
                    }

                    Text("Powered by QueueFlow")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundColor(.white.opacity(0.42))
                        .tracking(4)
                        .padding(.top, 8)
                        .padding(.bottom, 16)
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
            }

            if showBuzzFlash {
                Color.red
                    .ignoresSafeArea()
                    .overlay(
                        VStack(spacing: 8) {
                            Text("\u{1f4f3}")
                                .font(.system(size: 60))
                            Text("BUZZ!")
                                .font(.system(size: 40, weight: .black))
                                .foregroundColor(.white)
                        }
                    )
            }
        }
        .onAppear {
            setupInitialState()
            triggerEntryEffects()
        }
        .onReceive(timer) { _ in
            updateCountdown()
        }
        .onReceive(NotificationCenter.default.publisher(for: .queueFlowRecall)) { _ in
            handleRecall()
        }
        .onReceive(NotificationCenter.default.publisher(for: .queueFlowBuzz)) { _ in
            startBuzzStrobe()
        }
    }

    private var topBar: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(businessName)
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundColor(.white)
                    .lineLimit(2)

                if let branch = branchLine {
                    Text(branch)
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundColor(.white.opacity(0.70))
                }

                Text(isRefreshing ? "Refreshing…" : headerSubtitle)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundColor(.white.opacity(0.50))
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 8) {
                ticketBadge

                HStack(spacing: 8) {
                    actionPill(title: "Refresh", tone: .primary, isDisabled: isRefreshing) {
                        Task { await onRefresh() }
                    }

                    actionPill(title: "End", tone: .secondary, isDisabled: false) {
                        onStopTracking()
                    }
                }
            }
        }
    }

    private var bellHero: some View {
        ZStack {
            Circle()
                .fill(phase.glowColor.opacity(0.16))
                .frame(width: 138, height: 138)
                .scaleEffect(bellShouldRipple ? pulseScale : 1.0)
                .shadow(color: phase.glowColor.opacity(0.26), radius: 28)

            Circle()
                .fill(phase.glowColor.opacity(0.12))
                .frame(width: 98, height: 98)
                .scaleEffect(bellShouldRipple ? pulseScale * 0.92 : 1.0)

            Circle()
                .fill(Color.white.opacity(0.18))
                .frame(width: 68, height: 68)

            Image(systemName: "bell.fill")
                .font(.system(size: 34, weight: .bold))
                .foregroundColor(.white)
                .rotationEffect(.degrees(isAnimating ? 15 : -15))
                .animation(
                    .easeInOut(duration: 0.3)
                        .repeatCount(6, autoreverses: true),
                    value: isAnimating
                )
        }
    }

    private var countdownCard: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.16))
                .overlay(
                    Circle()
                        .stroke(Color.white.opacity(0.28), lineWidth: 1)
                )
                .frame(width: 154, height: 154)
                .shadow(
                    color: Color.black.opacity(0.12),
                    radius: 8
                )
                .opacity(phase == .red ? redPulseOpacity : 1.0)

            VStack(spacing: 3) {
                Text("\(countdown)")
                    .font(.system(size: 54, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
                    .contentTransition(.numericText())

                Text(countdown > 0 ? "seconds" : "EXPIRED")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.72))
                    .textCase(.uppercase)
                    .tracking(4)
            }
        }
    }

    private var infoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            infoRow(
                icon: "mappin.circle.fill",
                title: "Where to go",
                detail: ticket.deskDisplayName
            )

            infoRow(
                icon: "person.text.rectangle.fill",
                title: "What to show",
                detail: "Ticket \(ticket.ticket_number)"
            )

            infoRow(
                icon: "clock.badge.exclamationmark",
                title: "What to do now",
                detail: "Walk straight to the desk while the countdown is active."
            )
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Color.white.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        )
    }

    private func infoRow(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 40, height: 40)
                .background(
                    Circle()
                        .fill(.white.opacity(0.16))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white.opacity(0.64))

                Text(detail)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
            }

            Spacer(minLength: 0)
        }
    }

    private enum ActionPillTone {
        case primary
        case secondary
    }

    private func actionPill(
        title: String,
        tone: ActionPillTone,
        isDisabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        let background = tone == .primary ? Color.white : Color.white.opacity(0.14)
        let foreground = tone == .primary ? Color.black.opacity(0.88) : Color.white

        return Button(action: action) {
            Text(title)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundColor(foreground)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(background)
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(tone == .primary ? 0.0 : 0.14), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.6 : 1.0)
    }

    private var syncLabel: String {
        if let lastUpdatedAt {
            return "Updated \(lastUpdatedAt.formatted(date: .omitted, time: .shortened))"
        }

        return "Live queue sync"
    }

    private var urgencyMessage: String {
        if countdown == 0 {
            return "Time expired. Please hurry to the desk now."
        }
        if phase == .red {
            return "Staff is waiting for you. Head to the desk immediately."
        }
        return "Show this screen if staff asks for your number."
    }

    private func setupInitialState() {
        if let calledAtStr = ticket.called_at {
            calledAt = parseDate(calledAtStr) ?? Date()
        }

        recallCount = ticket.recall_count ?? 0
        updateCountdown()
    }

    private func triggerEntryEffects() {
        withAnimation {
            isAnimating = true
        }

        withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
            pulseScale = 1.16
        }

        let notification = UINotificationFeedbackGenerator()
        notification.notificationOccurred(.success)

        let heavy = UIImpactFeedbackGenerator(style: .heavy)
        heavy.prepare()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            heavy.impactOccurred(intensity: 1.0)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
            heavy.impactOccurred(intensity: 1.0)
        }

        TonePlayer.shared.playCalledTone()
        soundUnlocked = true
    }

    private func updateCountdown() {
        let elapsed = Int(Date().timeIntervalSince(calledAt))
        let remaining = max(0, waitSeconds - elapsed)

        withAnimation(.linear(duration: 0.3)) {
            countdown = remaining
            phase = CountdownPhase.from(countdown: remaining)
        }

        if remaining == 0 {
            isAnimating = false
            withAnimation(.easeOut(duration: 0.2)) {
                pulseScale = 1.0
            }
        } else if pulseScale == 1.0 {
            withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                pulseScale = 1.16
            }
        }

        if phase == .red && countdown > 0 {
            withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                redPulseOpacity = 0.7
            }
        } else {
            redPulseOpacity = 1.0
        }
    }

    private func handleRecall() {
        calledAt = Date()
        recallCount += 1

        isAnimating = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            withAnimation {
                isAnimating = true
            }
        }

        let notification = UINotificationFeedbackGenerator()
        notification.notificationOccurred(.warning)

        let heavy = UIImpactFeedbackGenerator(style: .heavy)
        heavy.prepare()
        for index in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(index) * 0.4) {
                heavy.impactOccurred(intensity: 1.0)
            }
        }

        TonePlayer.shared.playCalledTone()
        updateCountdown()
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

    private func unlockAlertsAndReplay() {
        let heavy = UIImpactFeedbackGenerator(style: .heavy)
        heavy.impactOccurred(intensity: 1.0)
        TonePlayer.shared.playCalledTone()
        soundUnlocked = true
    }

    private func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = formatter.date(from: value) {
            return parsed
        }

        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    private var ticketBadge: some View {
        Text("TICKET \(ticket.ticket_number)")
            .font(.system(size: 14, weight: .bold, design: .monospaced))
            .foregroundColor(.white.opacity(0.88))
            .tracking(2)
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(
                Capsule()
                    .fill(.white.opacity(0.14))
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(0.16), lineWidth: 1)
                    )
            )
    }

    private var recallBadge: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.counterclockwise")
            Text("Recalled \(recallCount) \(recallCount == 1 ? "time" : "times")")
        }
        .font(.system(size: 14, weight: .semibold, design: .rounded))
        .foregroundColor(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            Capsule()
                .fill(Color.black.opacity(0.12))
                .overlay(
                    Capsule()
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
        )
    }
}
