package com.queueflow.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlin.math.absoluteValue

data class QueueLiveUpdatePayload(
    val type: String,
    val title: String,
    val body: String,
    val ticketId: String,
    val ticketNumber: String?,
    val qrToken: String?,
    val url: String?,
    val position: Int?,
    val estimatedWait: Int?,
    val nowServing: String?,
    val deskName: String?,
    val recallCount: Int,
    val status: String?,
    val silent: Boolean
) {
    companion object {
        fun fromMap(data: Map<String, String>): QueueLiveUpdatePayload {
            return QueueLiveUpdatePayload(
                type = data["type"].orEmpty().ifBlank { "position_update" },
                title = data["title"].orEmpty().ifBlank { "QueueFlow" },
                body = data["body"].orEmpty(),
                ticketId = data["ticketId"].orEmpty(),
                ticketNumber = data["ticketNumber"],
                qrToken = data["qrToken"],
                url = data["url"],
                position = data["position"]?.toIntOrNull(),
                estimatedWait = data["estimatedWait"]?.toIntOrNull(),
                nowServing = data["nowServing"]?.takeIf { it.isNotBlank() },
                deskName = data["deskName"]?.takeIf { it.isNotBlank() },
                recallCount = data["recallCount"]?.toIntOrNull() ?: 0,
                status = data["status"],
                silent = data["silent"] == "1"
            )
        }

        fun fromJson(json: org.json.JSONObject): QueueLiveUpdatePayload {
            return QueueLiveUpdatePayload(
                type = json.optString("type", "position_update"),
                title = json.optString("title", "QueueFlow"),
                body = json.optString("body"),
                ticketId = json.optString("ticketId"),
                ticketNumber = json.optString("ticketNumber").takeIf { it.isNotBlank() },
                qrToken = json.optString("qrToken").takeIf { it.isNotBlank() },
                url = json.optString("url").takeIf { it.isNotBlank() },
                position = json.optInt("position").takeIf { json.has("position") },
                estimatedWait = json.optInt("estimatedWait").takeIf { json.has("estimatedWait") },
                nowServing = json.optString("nowServing").takeIf { it.isNotBlank() },
                deskName = json.optString("deskName").takeIf { it.isNotBlank() },
                recallCount = json.optInt("recallCount", 0),
                status = json.optString("status").takeIf { it.isNotBlank() },
                silent = json.optBoolean("silent", false)
            )
        }
    }
}

object QueueLiveUpdateNotifier {
    private const val LIVE_CHANNEL_ID = "queue_live_updates"
    private const val ALERT_CHANNEL_ID = "queue_alerts"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = context.getSystemService(NotificationManager::class.java)

        val liveChannel = NotificationChannel(
            LIVE_CHANNEL_ID,
            "Queue Live Updates",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Live queue progress and ticket status"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val alertChannel = NotificationChannel(
            ALERT_CHANNEL_ID,
            "Queue Alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Urgent queue calls, recalls, and buzzes"
            enableLights(true)
            lightColor = Color.RED
            enableVibration(true)
            vibrationPattern = longArrayOf(400, 180, 400, 180, 600)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        manager.createNotificationChannel(liveChannel)
        manager.createNotificationChannel(alertChannel)
    }

    fun showState(context: Context, payload: QueueLiveUpdatePayload) {
        ensureChannels(context)

        when (payload.type) {
            "called", "recall" -> {
                postLiveUpdate(context, payload, silent = true)
                postUrgentAlert(context, payload)
            }
            "buzz" -> postUrgentAlert(context, payload)
            "served", "no_show" -> {
                cancelLiveUpdate(context, payload.ticketId)
                cancelAlertNotifications(context, payload.ticketId)
                QueueTrackingStore.clearTrackedTicket(context)
                postCompletionNotification(context, payload)
            }
            "stop_tracking" -> {
                cancelLiveUpdate(context, payload.ticketId)
                cancelAlertNotifications(context, payload.ticketId)
                QueueTrackingStore.clearTrackedTicket(context)
            }
            else -> postLiveUpdate(context, payload, silent = payload.silent)
        }
    }

    private fun postLiveUpdate(context: Context, payload: QueueLiveUpdatePayload, silent: Boolean) {
        val notification = buildLiveNotification(context, payload, silent)
        NotificationManagerCompat.from(context)
            .notify(liveNotificationId(payload.ticketId), notification)
    }

    private fun postUrgentAlert(context: Context, payload: QueueLiveUpdatePayload) {
        val vibrationPattern = if (payload.type == "buzz") {
            longArrayOf(0, 800, 200, 800, 200, 800)
        } else {
            longArrayOf(0, 400, 160, 400, 160, 600)
        }

        val builder = NotificationCompat.Builder(context, ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(alertTitle(payload))
            .setContentText(alertBody(payload))
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(alertBody(payload))
                    .setBigContentTitle(alertTitle(payload))
                    .setSummaryText(payload.ticketNumber?.let { "Ticket $it" } ?: "QueueFlow")
            )
            .setContentIntent(buildOpenIntent(context, payload))
            .setCategory(if (payload.type == "buzz") NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVibrate(vibrationPattern)
            .setColor(accentColor(payload.type))
            .setColorized(true)
            .addAction(
                R.drawable.ic_notification,
                "Open",
                buildOpenIntent(context, payload)
            )

        NotificationManagerCompat.from(context)
            .notify(alertNotificationId(payload.ticketId, payload.type), builder.build())
    }

    private fun postCompletionNotification(context: Context, payload: QueueLiveUpdatePayload) {
        val builder = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(completionTitle(payload))
            .setContentText(completionBody(payload))
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(completionBody(payload))
                    .setBigContentTitle(completionTitle(payload))
            )
            .setContentIntent(buildOpenIntent(context, payload))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setTimeoutAfter(120_000)
            .setColor(accentColor(payload.type))
            .setColorized(true)

        NotificationManagerCompat.from(context)
            .notify(liveNotificationId(payload.ticketId), builder.build())
    }

    private fun cancelLiveUpdate(context: Context, ticketId: String) {
        NotificationManagerCompat.from(context).cancel(liveNotificationId(ticketId))
    }

    private fun cancelAlertNotifications(context: Context, ticketId: String) {
        val manager = NotificationManagerCompat.from(context)
        manager.cancel(alertNotificationId(ticketId, "called"))
        manager.cancel(alertNotificationId(ticketId, "recall"))
        manager.cancel(alertNotificationId(ticketId, "buzz"))
    }

    private fun buildOpenIntent(context: Context, payload: QueueLiveUpdatePayload): PendingIntent {
        val targetUrl = normalizeQueueUrl(payload.url?.takeIf { it.isNotBlank() }, payload.qrToken)
            ?: payload.qrToken?.let { "${BuildConfig.APP_BASE_URL.trimEnd('/')}/q/$it" }
            ?: BuildConfig.APP_BASE_URL

        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl)).apply {
            setPackage(context.packageName)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        return PendingIntent.getActivity(
            context,
            liveNotificationId(payload.ticketId),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun buildLiveNotification(
        context: Context,
        payload: QueueLiveUpdatePayload,
        silent: Boolean
    ): Notification {
        val builder = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(liveTitle(payload))
            .setContentText(liveBody(payload))
            .setSubText(liveSubtext(payload))
            .setContentIntent(buildOpenIntent(context, payload))
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSilent(silent)
            .setColor(accentColor(payload.type))
            .setColorized(true)
            .setRequestPromotedOngoing(Build.VERSION.SDK_INT >= 36)
            .setStyle(
                NotificationCompat.ProgressStyle()
                    .setStyledByProgress(true)
                    .setProgress(progressPercent(payload))
            )
            .addAction(
                R.drawable.ic_notification,
                "Open",
                buildOpenIntent(context, payload)
            )

        if (payload.type == "called" || payload.type == "recall") {
            builder
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis() + 60_000)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        }

        shortCriticalText(payload)?.let { builder.setShortCriticalText(it) }
        return builder.build()
    }

    private fun liveTitle(payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "called" -> "Go to ${payload.deskName ?: "your desk"}"
            "recall" -> "Return to ${payload.deskName ?: "your desk"}"
            "serving" -> "You are being served"
            else -> payload.ticketNumber?.let { "QueueFlow • Ticket $it" } ?: "QueueFlow"
        }
    }

    private fun liveBody(payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "called" -> payload.ticketNumber?.let { "Ticket $it • Show this screen when you arrive." }
                ?: "Proceed now. Countdown is active."
            "recall" -> payload.ticketNumber?.let { "Ticket $it • Please return to the desk now." }
                ?: "Staff is waiting for you right now."
            "serving" -> payload.deskName?.let { "At $it" } ?: "A staff member is helping you."
            else -> buildString {
                if (payload.position != null) append("#${payload.position} in line")
                if (payload.estimatedWait != null) {
                    if (isNotEmpty()) append(" • ")
                    append("~${payload.estimatedWait} min")
                }
                if (!payload.nowServing.isNullOrBlank()) {
                    if (isNotEmpty()) append(" • ")
                    append("Now ${payload.nowServing}")
                }
                if (isEmpty()) append("Waiting for your turn")
            }
        }
    }

    private fun liveSubtext(payload: QueueLiveUpdatePayload): String? {
        return when (payload.type) {
            "called", "recall" -> payload.ticketNumber?.let { "Ticket $it" }
            "serving" -> payload.ticketNumber?.let { "Ticket $it" }
            else -> payload.status?.replaceFirstChar { it.uppercase() }
        }
    }

    private fun alertTitle(payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "buzz" -> "Buzz from QueueFlow"
            "recall" -> "Reminder: your turn"
            else -> "It's your turn"
        }
    }

    private fun alertBody(payload: QueueLiveUpdatePayload): String {
        val desk = payload.deskName ?: "your desk"
        return when (payload.type) {
            "buzz" -> payload.body.ifBlank {
                "Ticket ${payload.ticketNumber ?: ""} • Please go to $desk now"
            }
            "recall" -> "Ticket ${payload.ticketNumber ?: ""} • Return to $desk immediately"
            else -> "Ticket ${payload.ticketNumber ?: ""} • Go to $desk now"
        }
    }

    private fun completionTitle(payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "no_show" -> "Visit status updated"
            else -> "Visit complete"
        }
    }

    private fun completionBody(payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "no_show" -> "This ticket was marked as missed."
            else -> "Thanks for visiting. Tap to leave feedback."
        }
    }

    private fun normalizeQueueUrl(url: String?, qrToken: String?): String? {
        if (!url.isNullOrBlank()) {
            return when {
                url.startsWith("https://") || url.startsWith("http://") -> url
                url.startsWith("/") -> "${BuildConfig.APP_BASE_URL.trimEnd('/')}$url"
                else -> "${BuildConfig.APP_BASE_URL.trimEnd('/')}/$url"
            }
        }

        return qrToken?.let { "${BuildConfig.APP_BASE_URL.trimEnd('/')}/q/$it" }
    }

    private fun progressPercent(payload: QueueLiveUpdatePayload): Int {
        return when (payload.type) {
            "called", "recall", "serving" -> 100
            else -> {
                val position = payload.position ?: return 5
                (100 - ((position - 1) * 12)).coerceIn(5, 95)
            }
        }
    }

    private fun shortCriticalText(payload: QueueLiveUpdatePayload): String? {
        return when (payload.type) {
            "position_update" -> payload.position?.let { "#$it" }
            "called", "recall", "buzz" -> "NOW"
            "serving" -> payload.deskName ?: "DESK"
            else -> null
        }
    }

    private fun accentColor(type: String): Int {
        return when (type) {
            "called", "recall" -> Color.parseColor("#F2B633")
            "serving" -> Color.parseColor("#38BDF8")
            "served", "stop_tracking" -> Color.parseColor("#94A3B8")
            "buzz" -> Color.parseColor("#F43F5E")
            else -> Color.parseColor("#67D0F8")
        }
    }

    private fun liveNotificationId(ticketId: String): Int {
        return 1000 + (ticketId.hashCode().absoluteValue % 900000)
    }

    private fun alertNotificationId(ticketId: String, type: String): Int {
        return 2_000_000 + ((ticketId + type).hashCode().absoluteValue % 900000)
    }
}
