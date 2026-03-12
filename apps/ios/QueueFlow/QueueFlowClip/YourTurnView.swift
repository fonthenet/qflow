import SwiftUI
import AVFoundation

/// Full-screen "Your Turn!" alert shown when the ticket is called.
/// Includes haptic feedback, system sound, and desk information.
struct YourTurnView: View {
    let ticket: Ticket

    @State private var isAnimating = false
    @State private var pulseScale: CGFloat = 1.0

    var body: some View {
        ZStack {
            // Animated gradient background
            LinearGradient(
                colors: [
                    Color(red: 0.13, green: 0.53, blue: 0.35),  // Emerald
                    Color(red: 0.08, green: 0.42, blue: 0.28),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                // Pulsing bell icon
                ZStack {
                    Circle()
                        .fill(.white.opacity(0.15))
                        .frame(width: 120, height: 120)
                        .scaleEffect(pulseScale)

                    Circle()
                        .fill(.white.opacity(0.25))
                        .frame(width: 88, height: 88)

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

                // Main text
                VStack(spacing: 8) {
                    Text("IT'S YOUR TURN!")
                        .font(.system(size: 32, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)

                    Text("Ticket \(ticket.ticket_number)")
                        .font(.title2.weight(.semibold))
                        .foregroundColor(.white.opacity(0.9))
                }

                // Desk card
                VStack(spacing: 8) {
                    Text("Please go to")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.7))

                    Text(ticket.deskDisplayName)
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .padding(.horizontal, 32)
                        .padding(.vertical, 16)
                        .background(
                            RoundedRectangle(cornerRadius: 16)
                                .fill(.white.opacity(0.2))
                        )
                }

                Spacer()

                // Recall count indicator
                if let recallCount = ticket.recall_count, recallCount > 0 {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.counterclockwise")
                        Text("Recalled \(recallCount) time\(recallCount > 1 ? "s" : "")")
                    }
                    .font(.caption.weight(.medium))
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(
                        Capsule()
                            .fill(.white.opacity(0.15))
                    )
                }

                Spacer()
                    .frame(height: 40)
            }
        }
        .onAppear {
            // Trigger animations
            withAnimation {
                isAnimating = true
            }

            // Pulse animation
            withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                pulseScale = 1.2
            }

            // Haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)

            // Play system sound
            AudioServicesPlaySystemSound(1005) // SMS received sound
        }
    }
}
