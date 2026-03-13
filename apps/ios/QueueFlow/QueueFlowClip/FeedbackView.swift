import SwiftUI

struct FeedbackView: View {
    let ticket: Ticket
    let officeName: String
    let serviceName: String
    let onFinish: () async -> Void

    @State private var rating = 0
    @State private var comment = ""
    @State private var existingRating: Int?
    @State private var isSubmitting = false
    @State private var isFinishing = false
    @State private var isSubmitted = false
    @State private var errorMessage: String?
    @State private var showFinishConfirmation = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.07, blue: 0.14),
                    Color(red: 0.05, green: 0.12, blue: 0.24),
                    Color(red: 0.10, green: 0.20, blue: 0.28)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    headerCard

                    if isSubmitted {
                        completionCard
                    } else {
                        ratingCard
                        commentCard
                        actionsCard
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
                .padding(.bottom, 28)
            }
        }
        .task {
            if let existing = await SupabaseClient.shared.fetchExistingFeedback(ticketId: ticket.id) {
                existingRating = existing
                rating = existing
                isSubmitted = true
            }
        }
        .confirmationDialog(
            "Finish this visit?",
            isPresented: $showFinishConfirmation,
            titleVisibility: .visible
        ) {
            Button(isSubmitted ? "Finish Visit" : "Finish Without Feedback", role: .destructive) {
                Task {
                    await finishVisit()
                }
            }
            Button("Keep Tracking", role: .cancel) {}
        } message: {
            Text("This clears the current ticket from this device and stops any remaining alerts.")
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 8) {
                    Text(officeName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.70))
                        .textCase(.uppercase)

                    Text("Visit complete")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("Ticket \(ticket.ticket_number) • \(serviceName)")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.72))
                }

                Spacer(minLength: 0)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 42))
                    .foregroundStyle(Color(red: 0.55, green: 0.94, blue: 0.69))
            }

            Text("If you have a moment, tell us how the visit felt. You can also finish now and clear this ticket from the device.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.74))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(Color.white.opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 30, style: .continuous)
                        .stroke(Color.white.opacity(0.10), lineWidth: 1)
                )
        )
    }

    private var ratingCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("How was your experience?")
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)

            HStack(spacing: 10) {
                ForEach(1...5, id: \.self) { star in
                    Button {
                        rating = star
                    } label: {
                        Image(systemName: star <= rating ? "star.fill" : "star")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(star <= rating ? Color(red: 0.99, green: 0.79, blue: 0.30) : .white.opacity(0.28))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                }
            }

            if rating > 0 {
                Text(ratingLabel(for: rating))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.72))
            }
        }
        .padding(20)
        .background(cardBackground)
    }

    private var commentCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Anything we should know?")
                .font(.headline.weight(.semibold))
                .foregroundStyle(.white)

            Text("Optional notes help the team improve the next visit.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.68))

            TextEditor(text: $comment)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 120)
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color.black.opacity(0.20))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
                .foregroundStyle(.white)
        }
        .padding(20)
        .background(cardBackground)
    }

    private var actionsCard: some View {
        VStack(spacing: 14) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color(red: 1.0, green: 0.76, blue: 0.76))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task {
                    await submitFeedback()
                }
            } label: {
                HStack {
                    Spacer()
                    if isSubmitting {
                        ProgressView()
                            .tint(Color(red: 0.02, green: 0.07, blue: 0.14))
                    }
                    Text(isSubmitting ? "Submitting..." : "Submit feedback")
                        .font(.headline.weight(.semibold))
                    Spacer()
                }
                .padding(.vertical, 16)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color.white)
                )
                .foregroundStyle(Color(red: 0.02, green: 0.07, blue: 0.14))
            }
            .disabled(rating == 0 || isSubmitting)

            Button {
                showFinishConfirmation = true
            } label: {
                Text("Finish without feedback")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color.white.opacity(0.08))
                            .overlay(
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .stroke(Color.white.opacity(0.10), lineWidth: 1)
                            )
                    )
            }
            .disabled(isSubmitting)
        }
        .padding(20)
        .background(cardBackground)
    }

    private var completionCard: some View {
        VStack(spacing: 16) {
            VStack(spacing: 10) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(Color(red: 0.99, green: 0.79, blue: 0.30))

                Text("Thanks for the feedback")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)

                if let existingRating {
                    Text("\(existingRating) out of 5 recorded")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.70))
                }
            }

            Button {
                showFinishConfirmation = true
            } label: {
                HStack {
                    Spacer()
                    if isFinishing {
                        ProgressView()
                            .tint(Color(red: 0.02, green: 0.07, blue: 0.14))
                    }
                    Text(isFinishing ? "Finishing..." : "Done")
                        .font(.headline.weight(.semibold))
                    Spacer()
                }
                .padding(.vertical, 16)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color.white)
                )
                .foregroundStyle(Color(red: 0.02, green: 0.07, blue: 0.14))
            }
            .disabled(isFinishing)
        }
        .padding(20)
        .background(cardBackground)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
            .fill(Color.white.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(Color.white.opacity(0.10), lineWidth: 1)
            )
    }

    private func ratingLabel(for rating: Int) -> String {
        switch rating {
        case 1: return "Poor"
        case 2: return "Fair"
        case 3: return "Good"
        case 4: return "Very Good"
        case 5: return "Excellent"
        default: return ""
        }
    }

    private func submitFeedback() async {
        guard rating > 0 else { return }
        isSubmitting = true
        errorMessage = nil

        do {
            try await SupabaseClient.shared.submitFeedback(
                ticket: ticket,
                rating: rating,
                comment: comment
            )
            existingRating = rating
            isSubmitted = true
        } catch {
            errorMessage = error.localizedDescription
        }

        isSubmitting = false
    }

    private func finishVisit() async {
        isFinishing = true
        await onFinish()
        isFinishing = false
    }
}
