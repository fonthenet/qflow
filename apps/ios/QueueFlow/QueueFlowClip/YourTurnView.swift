import SwiftUI
import AVFoundation

// MARK: - Countdown Phase

enum CountdownPhase {
    case green, yellow, red

    var backgroundColor: Color {
        switch self {
        case .green:  return Color(red: 0.13, green: 0.53, blue: 0.35)  // Emerald
        case .yellow: return Color(red: 0.92, green: 0.69, blue: 0.15)  // Amber
        case .red:    return Color(red: 0.70, green: 0.15, blue: 0.15)  // Red-700
        }
    }

    var backgroundGradientEnd: Color {
        switch self {
        case .green:  return Color(red: 0.08, green: 0.42, blue: 0.28)
        case .yellow: return Color(red: 0.78, green: 0.55, blue: 0.10)
        case .red:    return Color(red: 0.55, green: 0.10, blue: 0.10)
        }
    }

    var countdownNumberColor: Color {
        switch self {
        case .green:  return Color(red: 0.06, green: 0.44, blue: 0.29)
        case .yellow: return Color(red: 0.72, green: 0.53, blue: 0.04)
        case .red:    return Color(red: 0.70, green: 0.15, blue: 0.15)
        }
    }

    static func from(countdown: Int) -> CountdownPhase {
        if countdown > 30 { return .green }
        if countdown > 10 { return .yellow }
        return .red
    }
}

// MARK: - YourTurnView

/// Full-screen "Your Turn!" alert with 60-second countdown timer,
/// color phase transitions (green -> yellow -> red), recall handling, and tone audio.
struct YourTurnView: View {
    let ticket: Ticket

    private let waitSeconds = 60

    // Timer state
    @State private var countdown: Int = 60
    @State private var calledAt: Date = Date()
    @State private var recallCount: Int = 0
    @State private var phase: CountdownPhase = .green

    // Animation state
    @State private var isAnimating = false
    @State private var pulseScale: CGFloat = 1.0
    @State private var redPulseOpacity: Double = 1.0

    // Buzz flash
    @State private var showBuzzFlash = false
    @State private var buzzFlashCount = 0

    // Timer publisher (1 second interval)
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            // Phase-based gradient background
            LinearGradient(
                colors: [phase.backgroundColor, phase.backgroundGradientEnd],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.7), value: phase)

            // Pulsing rings (green phase only)
            if phase == .green {
                Circle()
                    .fill(Color.white.opacity(0.04))
                    .frame(width: 300, height: 300)
                    .scaleEffect(pulseScale * 1.1)

                Circle()
                    .fill(Color.white.opacity(0.06))
                    .frame(width: 240, height: 240)
                    .scaleEffect(pulseScale)
            }

            VStack(spacing: 20) {
                Spacer()

                // Bell icon with pulse ring
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(phase == .red ? 0.2 : 0.15))
                        .frame(width: 110, height: 110)
                        .scaleEffect(pulseScale)
                        .shadow(color: phase == .red ? .red.opacity(0.4) : .clear, radius: 20)

                    Circle()
                        .fill(Color.white.opacity(0.25))
                        .frame(width: 80, height: 80)

                    Image(systemName: "bell.fill")
                        .font(.system(size: 36))
                        .foregroundColor(.white)
                        .rotationEffect(.degrees(isAnimating ? 15 : -15))
                        .animation(
                            .easeInOut(duration: 0.3)
                                .repeatCount(6, autoreverses: true),
                            value: isAnimating
                        )
                }

                // Main heading
                Text("YOUR TURN!")
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.2), radius: 4, y: 2)

                // Ticket number in white card
                Text(ticket.ticket_number)
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .foregroundColor(phase.countdownNumberColor)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(.white)
                    )

                // Desk card
                VStack(spacing: 4) {
                    Text("Please go to")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.7))

                    HStack(spacing: 6) {
                        Image(systemName: "mappin.circle.fill")
                            .font(.title2)
                        Text(ticket.deskDisplayName)
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(.white.opacity(0.2))
                    )
                }

                // Recall badge
                if recallCount > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.counterclockwise")
                        Text("Recalled \(recallCount) time\(recallCount > 1 ? "s" : "")")
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(
                        Capsule()
                            .fill(.white.opacity(0.2))
                    )
                }

                // ── COUNTDOWN CIRCLE ──
                VStack(spacing: 6) {
                    ZStack {
                        Circle()
                            .fill(.white)
                            .frame(width: 130, height: 130)
                            .shadow(
                                color: phase == .red ? .red.opacity(0.4) : .white.opacity(0.3),
                                radius: phase == .red ? 20 : 8
                            )
                            .opacity(phase == .red ? redPulseOpacity : 1.0)

                        VStack(spacing: 2) {
                            Text("\(countdown)")
                                .font(.system(size: 48, weight: .bold, design: .monospaced))
                                .foregroundColor(phase.countdownNumberColor)
                                .contentTransition(.numericText())

                            Text(countdown > 0 ? "seconds" : "EXPIRED")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(countdown > 0 ? .gray : .red)
                                .textCase(.uppercase)
                        }
                    }
                }
                .padding(.top, 4)

                // Urgency message
                Text(urgencyMessage)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.white.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .animation(.easeInOut(duration: 0.3), value: phase)

                Spacer()

                // Footer
                Text("Powered by QueueFlow")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.4))
                    .padding(.bottom, 16)
            }

            // ── BUZZ FLASH OVERLAY (rapid strobe) ──
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
        // ── LIFECYCLE ──
        .onAppear {
            setupInitialState()
            triggerEntryEffects()
        }
        // 1-second timer tick
        .onReceive(timer) { _ in
            updateCountdown()
        }
        // Recall notification from APNsManager
        .onReceive(NotificationCenter.default.publisher(for: .queueFlowRecall)) { _ in
            handleRecall()
        }
        // Buzz notification
        .onReceive(NotificationCenter.default.publisher(for: .queueFlowBuzz)) { _ in
            startBuzzStrobe()
        }
    }

    // MARK: - Computed

    private var urgencyMessage: String {
        if countdown == 0 {
            return "Time expired \u{2014} please hurry to the desk!"
        }
        if phase == .red {
            return "Hurry! Time is running out!"
        }
        return "Please proceed to the desk now"
    }

    // MARK: - State Setup

    private func setupInitialState() {
        // Parse called_at from ticket
        if let calledAtStr = ticket.called_at {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let parsed = formatter.date(from: calledAtStr) {
                calledAt = parsed
            } else {
                formatter.formatOptions = [.withInternetDateTime]
                if let parsed = formatter.date(from: calledAtStr) {
                    calledAt = parsed
                }
            }
        }

        recallCount = ticket.recall_count ?? 0
        updateCountdown()
    }

    private func triggerEntryEffects() {
        // Bell animation
        withAnimation {
            isAnimating = true
        }

        // Pulse ring
        withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
            pulseScale = 1.2
        }

        // Haptics: success + 2 heavy impacts
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

        // Play ascending tone
        TonePlayer.shared.playCalledTone()
    }

    // MARK: - Timer

    private func updateCountdown() {
        let elapsed = Int(Date().timeIntervalSince(calledAt))
        let remaining = max(0, waitSeconds - elapsed)

        withAnimation(.linear(duration: 0.3)) {
            countdown = remaining
            phase = CountdownPhase.from(countdown: remaining)
        }

        // Red phase pulsing
        if phase == .red && countdown > 0 {
            withAnimation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true)) {
                redPulseOpacity = 0.7
            }
        } else {
            redPulseOpacity = 1.0
        }
    }

    // MARK: - Recall

    private func handleRecall() {
        // Reset timer to now
        calledAt = Date()
        recallCount += 1

        // Re-trigger bell animation
        isAnimating = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            withAnimation {
                isAnimating = true
            }
        }

        // Haptics
        let notification = UINotificationFeedbackGenerator()
        notification.notificationOccurred(.warning)

        let heavy = UIImpactFeedbackGenerator(style: .heavy)
        heavy.prepare()
        for i in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.4) {
                heavy.impactOccurred(intensity: 1.0)
            }
        }

        // Re-play tone
        TonePlayer.shared.playCalledTone()

        // Immediate countdown update
        updateCountdown()
    }

    // MARK: - Buzz Strobe

    private func startBuzzStrobe() {
        guard !showBuzzFlash else { return }
        buzzFlashCount = 0

        // Rapid toggle every 200ms for 3 seconds (15 flashes)
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
}
