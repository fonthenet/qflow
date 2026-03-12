import SwiftUI

/// Companion app main screen.
/// Simple branding + link to web app.
struct ContentView: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.145, green: 0.388, blue: 0.922),
                    Color(red: 0.1, green: 0.3, blue: 0.8),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Logo area
                VStack(spacing: 16) {
                    Image(systemName: "person.2.badge.clock.fill")
                        .font(.system(size: 64))
                        .foregroundColor(.white)

                    Text("QueueFlow")
                        .font(.system(size: 36, weight: .heavy, design: .rounded))
                        .foregroundColor(.white)

                    Text("Smart Queue Management")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.8))
                }

                Spacer()

                // Feature highlights
                VStack(spacing: 12) {
                    featureRow(icon: "bell.badge.fill", text: "Real-time notifications")
                    featureRow(icon: "qrcode.viewfinder", text: "Scan QR to join queue")
                    featureRow(icon: "chart.bar.fill", text: "Track your position live")
                    featureRow(icon: "iphone.badge.checkmark", text: "Works on all devices")
                }

                Spacer()

                // Open web app button
                Button {
                    // Replace with your production domain
                    if let url = URL(string: "https://qflow-sigma.vercel.app") {
                        openURL(url)
                    }
                } label: {
                    HStack {
                        Image(systemName: "safari")
                        Text("Open QueueFlow")
                    }
                    .font(.headline)
                    .foregroundColor(Color(red: 0.145, green: 0.388, blue: 0.922))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(
                        RoundedRectangle(cornerRadius: 14)
                            .fill(.white)
                    )
                }

                Text("Manage your business queues at queueflow.app")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
                    .padding(.bottom, 16)
            }
            .padding(.horizontal, 24)
        }
    }

    private func featureRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(.white.opacity(0.9))
                .frame(width: 32)

            Text(text)
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.9))

            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(.white.opacity(0.1))
        )
    }
}
