import SwiftUI
import AVFoundation

enum CountdownPhase {
    case green, yellow, red

    var backgroundColor: Color {
        switch self {
        case .green:  return Color(red: 0.13, green: 0.53, blue: 0.35)
        case .yellow: return Color(red: 0.92, green: 0.69, blue: 0.15)
        case .red:    return Color(red: 0.70, green: 0.15, blue: 0.15)
        }
    }

    var backgroundGradientEnd: Color {
        switch self {
        case .green:  return Color(red: 0.08, green: 0.42, blue: 0.28)
        case .yellow: return Color(red: 0.78, green: 0.55, blue: 0.10)
        case .red:    return Color(red: 0.55, green: 0.10, blue: 0.10)
        }
    }

    static func from(countdown: Int) -> CountdownPhase {
        if countdown > 30 { return .green }
        if countdown > 10 { return .yellow }
        return .red
    }
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

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [phase.backgroundColor, phase.backgroundGradientEnd],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.7), value: phase)

            if phase == .green {
                Circle()
                    .fill(Color.white.opacity(0.04))
                    .frame(width: 320, height: 320)
                    .scaleEffect(pulseScale * 1.08)

                Circle()
                    .fill(Color.white.opacity(0.06))
                    .frame(width: 250, height: 250)
                    .scaleEffect(pulseScale)
            }

            ScrollView(showsIndicators: false) {
                VStack(spacing: 22) {
                    topBar

                    VStack(spacing: 18) {
                        bellHero

                        Text("Go to \(ticket.deskDisplayName)")
                            .font(.system(size: 34, weight: .heavy, design: .rounded))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.center)

                        Text("Ticket \(ticket.ticket_number)")
                            .font(.system(size: 16, weight: .bold, design: .monospaced))
                            .foregroundColor(.white.opacity(0.92))
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .background(
                                Capsule()
                                    .fill(.white.opacity(0.16))
                            )

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
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.42))
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
            VStack(alignment: .leading, spacing: 8) {
                Text("Your turn")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white.opacity(0.66))
                    .textCase(.uppercase)

                Text(ticket.department?.name ?? "Queue")
                    .font(.caption.weight(.bold))
                    .foregroundColor(Color(red: 0.99, green: 0.79, blue: 0.30))
                    .textCase(.uppercase)

                Text(isRefreshing ? "Refreshing now" : syncLabel)
                    .font(.subheadline)
                    .foregroundColor(.white.opacity(0.78))
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 8) {
                HStack(spacing: 8) {
                    circleActionButton(systemImage: "arrow.clockwise", title: "Refresh", isDisabled: isRefreshing) {
                        Task { await onRefresh() }
                    }

                    circleActionButton(systemImage: "xmark", title: "End", isDisabled: false) {
                        onStopTracking()
                    }
                }

                if recallCount > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.counterclockwise")
                        Text("Recalled \(recallCount)x")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(.white.opacity(0.14)))
                }
            }
        }
    }

    private var bellHero: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(phase == .red ? 0.20 : 0.15))
                .frame(width: 138, height: 138)
                .scaleEffect(pulseScale)
                .shadow(color: phase == .red ? .red.opacity(0.4) : .clear, radius: 24)

            Circle()
                .fill(Color.white.opacity(0.22))
                .frame(width: 98, height: 98)

            Image(systemName: "bell.fill")
                .font(.system(size: 40))
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
                .fill(.white)
                .frame(width: 154, height: 154)
                .shadow(
                    color: phase == .red ? .red.opacity(0.42) : .white.opacity(0.26),
                    radius: phase == .red ? 22 : 10
                )
                .opacity(phase == .red ? redPulseOpacity : 1.0)

            VStack(spacing: 3) {
                Text("\(countdown)")
                    .font(.system(size: 54, weight: .bold, design: .monospaced))
                    .foregroundColor(phase == .red ? Color.red : Color(red: 0.12, green: 0.20, blue: 0.25))
                    .contentTransition(.numericText())

                Text(countdown > 0 ? "seconds" : "EXPIRED")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(countdown > 0 ? .gray : .red)
                    .textCase(.uppercase)
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
                .fill(.white.opacity(0.12))
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
                .frame(width: 32, height: 32)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(.white.opacity(0.10))
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

    private func circleActionButton(
        systemImage: String,
        title: String,
        isDisabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.12))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.12), lineWidth: 1)
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
        return "Proceed to the desk and keep this screen visible."
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
            pulseScale = 1.2
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
}
