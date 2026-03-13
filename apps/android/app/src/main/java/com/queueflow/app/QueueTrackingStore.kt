package com.queueflow.app

import android.content.Context

data class TrackedQueueTicket(
    val qrToken: String?,
    val ticketUrl: String?,
    val ticketId: String?,
    val ticketNumber: String?,
    val deviceToken: String?
)

object QueueTrackingStore {
    private const val PREFS_NAME = "queueflow_live_updates"
    private const val KEY_QR_TOKEN = "tracked_qr_token"
    private const val KEY_TICKET_URL = "tracked_ticket_url"
    private const val KEY_TICKET_ID = "tracked_ticket_id"
    private const val KEY_TICKET_NUMBER = "tracked_ticket_number"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_NOTIFICATIONS_PROMPTED = "notifications_prompted"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun saveTrackedTicket(context: Context, qrToken: String, ticketUrl: String) {
        prefs(context).edit()
            .putString(KEY_QR_TOKEN, qrToken)
            .putString(KEY_TICKET_URL, ticketUrl)
            .remove(KEY_TICKET_ID)
            .remove(KEY_TICKET_NUMBER)
            .apply()
    }

    fun saveTicketIdentity(context: Context, ticketId: String?, ticketNumber: String?) {
        prefs(context).edit()
            .putString(KEY_TICKET_ID, ticketId)
            .putString(KEY_TICKET_NUMBER, ticketNumber)
            .apply()
    }

    fun saveDeviceToken(context: Context, token: String) {
        prefs(context).edit()
            .putString(KEY_DEVICE_TOKEN, token)
            .apply()
    }

    fun hasPromptedForNotifications(context: Context): Boolean {
        return prefs(context).getBoolean(KEY_NOTIFICATIONS_PROMPTED, false)
    }

    fun markNotificationPrompted(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_NOTIFICATIONS_PROMPTED, true)
            .apply()
    }

    fun getTrackedTicket(context: Context): TrackedQueueTicket {
        val prefs = prefs(context)
        return TrackedQueueTicket(
            qrToken = prefs.getString(KEY_QR_TOKEN, null),
            ticketUrl = prefs.getString(KEY_TICKET_URL, null),
            ticketId = prefs.getString(KEY_TICKET_ID, null),
            ticketNumber = prefs.getString(KEY_TICKET_NUMBER, null),
            deviceToken = prefs.getString(KEY_DEVICE_TOKEN, null)
        )
    }
}
