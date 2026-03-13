import Foundation

/// Lightweight Supabase REST client for the App Clip.
/// No external dependencies — uses URLSession directly.
class SupabaseClient {
    static let shared = SupabaseClient()

    // MARK: - Configuration
    // These match your existing Supabase project
    private let baseURL = "https://ofyyzuocifigyyhqxxqw.supabase.co"
    private let anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meXl6dW9jaWZpZ3l5aHF4eHF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNjcwNDMsImV4cCI6MjA4ODg0MzA0M30.WzFn3aNgu7amI8ddplcnJJeD2Kilfy-HrsxrFTAWgeQ"

    // IMPORTANT: Replace with your production domain
    private let apiBaseURL = "https://qflow-sigma.vercel.app"

    private init() {}

    // MARK: - Ticket Fetching

    /// Fetch ticket by QR token from Supabase REST API.
    func fetchTicket(token: String) async throws -> Ticket {
        let urlString = "\(baseURL)/rest/v1/tickets?qr_token=eq.\(token)&select=*,department:departments(name,code),service:services(name),desk:desks(name,display_name)"
        guard let url = URL(string: urlString) else {
            throw SupabaseError.invalidURL
        }

        var request = URLRequest(url: url)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw SupabaseError.fetchFailed
        }

        let tickets = try JSONDecoder().decode([Ticket].self, from: data)
        guard let ticket = tickets.first else {
            throw SupabaseError.ticketNotFound
        }

        return ticket
    }

    /// Fetch queue position for a ticket via RPC.
    func fetchQueuePosition(ticketId: String) async throws -> Int {
        let urlString = "\(baseURL)/rest/v1/rpc/get_queue_position"
        guard let url = URL(string: urlString) else {
            throw SupabaseError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["p_ticket_id": ticketId])

        let (data, _) = try await URLSession.shared.data(for: request)

        if let position = try? JSONDecoder().decode(Int.self, from: data) {
            return position
        }
        return 0
    }

    /// Fetch estimated wait time for a department/service.
    func fetchEstimatedWait(departmentId: String, serviceId: String) async throws -> Int? {
        let urlString = "\(baseURL)/rest/v1/rpc/estimate_wait_time"
        guard let url = URL(string: urlString) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "p_department_id": departmentId,
            "p_service_id": serviceId
        ])

        let (data, _) = try await URLSession.shared.data(for: request)
        return try? JSONDecoder().decode(Int.self, from: data)
    }

    /// Register APNs device token with the backend. Returns true on success.
    func registerAPNsToken(ticketId: String, deviceToken: String) async -> Bool {
        guard let url = URL(string: "\(apiBaseURL)/api/apns-register") else {
            print("[APNs] Invalid registration URL")
            return false
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        let body: [String: String] = [
            "ticketId": ticketId,
            "deviceToken": deviceToken,
            "environment": isDebug ? "sandbox" : "production",
            "bundleId": appClipBundleIdentifier
        ]

        request.httpBody = try? JSONEncoder().encode(body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                print("[APNs] Token registration response: \(httpResponse.statusCode)")
                if httpResponse.statusCode == 200 {
                    return true
                }
                // Log error body for debugging
                if let errorBody = String(data: data, encoding: .utf8) {
                    print("[APNs] Registration error body: \(errorBody)")
                }
            }
            return false
        } catch {
            print("[APNs] Token registration network error: \(error)")
            return false
        }
    }

    /// Fetch the "now serving" ticket number for context.
    func fetchNowServing(departmentId: String, officeId: String) async -> String? {
        let urlString = "\(baseURL)/rest/v1/tickets?department_id=eq.\(departmentId)&office_id=eq.\(officeId)&status=in.(serving,called)&order=called_at.desc&limit=1&select=ticket_number"
        guard let url = URL(string: urlString) else { return nil }

        var request = URLRequest(url: url)
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            struct TicketNum: Codable { let ticket_number: String }
            let results = try JSONDecoder().decode([TicketNum].self, from: data)
            return results.first?.ticket_number
        } catch {
            return nil
        }
    }

    private var isDebug: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    private var appClipBundleIdentifier: String {
        Bundle.main.bundleIdentifier ?? "com.queueflow.app.QueueFlowClip"
    }
}

// MARK: - Models

struct Ticket: Codable, Identifiable {
    let id: String
    let qr_token: String
    let office_id: String
    let department_id: String
    let service_id: String
    let ticket_number: String
    let status: String
    let desk_id: String?
    let called_at: String?
    let estimated_wait_minutes: Int?
    let recall_count: Int?

    // Joined relations
    let department: Department?
    let service: Service?
    let desk: Desk?

    struct Department: Codable {
        let name: String
        let code: String
    }

    struct Service: Codable {
        let name: String
    }

    struct Desk: Codable {
        let name: String
        let display_name: String?
    }

    var deskDisplayName: String {
        desk?.display_name ?? desk?.name ?? "—"
    }
}

enum SupabaseError: Error, LocalizedError {
    case invalidURL
    case fetchFailed
    case ticketNotFound

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .fetchFailed: return "Failed to fetch data"
        case .ticketNotFound: return "Ticket not found"
        }
    }
}
