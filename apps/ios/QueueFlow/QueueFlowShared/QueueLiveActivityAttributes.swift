import ActivityKit
import Foundation

struct QueueLiveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var status: String
        var position: Int?
        var estimatedWaitMinutes: Int?
        var nowServing: String?
        var deskName: String?
        var recallCount: Int
        var calledAt: Date?
        var servingStartedAt: Date?
        var updatedAt: Date
    }

    var ticketId: String
    var ticketNumber: String
    var qrToken: String
    var departmentName: String
    var serviceName: String
}
