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
    val officeName: String?,
    val departmentName: String?,
    val serviceName: String?,
    val servingStartedAt: String?,
    val recallCount: Int,
    val status: String?,
    val silent: Boolean
) {
    companion object {
        fun fromMap(data: Map<String, String>): QueueLiveUpdatePayload {
            return QueueLiveUpdatePayload(
                type = data["type"].orEmpty().ifBlank { "position_update" },
                title = data["title"].orEmpty().ifBlank { "Current visit" },
                body = data["body"].orEmpty(),
                ticketId = data["ticketId"].orEmpty(),
                ticketNumber = data["ticketNumber"],
                qrToken = data["qrToken"],
                url = data["url"],
                position = data["position"]?.toIntOrNull(),
                estimatedWait = data["estimatedWait"]?.toIntOrNull(),
                nowServing = data["nowServing"]?.takeIf { it.isNotBlank() },
                deskName = data["deskName"]?.takeIf { it.isNotBlank() },
                officeName = data["officeName"]?.takeIf { it.isNotBlank() },
                departmentName = data["departmentName"]?.takeIf { it.isNotBlank() },
                serviceName = data["serviceName"]?.takeIf { it.isNotBlank() },
                servingStartedAt = data["servingStartedAt"]?.takeIf { it.isNotBlank() },
                recallCount = data["recallCount"]?.toIntOrNull() ?: 0,
                status = data["status"],
                silent = data["silent"] == "1"
            )
        }

        fun fromJson(json: org.json.JSONObject): QueueLiveUpdatePayload {
            return QueueLiveUpdatePayload(
                type = json.optString("type", "position_update"),
                title = json.optString("title", "Current visit"),
                body = json.optString("body"),
                ticketId = json.optString("ticketId"),
                ticketNumber = json.optString("ticketNumber").takeIf { it.isNotBlank() },
                qrToken = json.optString("qrToken").takeIf { it.isNotBlank() },
                url = json.optString("url").takeIf { it.isNotBlank() },
                position = json.optInt("position").takeIf { json.has("position") },
                estimatedWait = json.optInt("estimatedWait").takeIf { json.has("estimatedWait") },
                nowServing = json.optString("nowServing").takeIf { it.isNotBlank() },
                deskName = json.optString("deskName").takeIf { it.isNotBlank() },
                officeName = json.optString("officeName").takeIf { it.isNotBlank() },
                departmentName = json.optString("departmentName").takeIf { it.isNotBlank() },
                serviceName = json.optString("serviceName").takeIf { it.isNotBlank() },
                servingStartedAt = json.optString("servingStartedAt").takeIf { it.isNotBlank() },
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
            context.getString(R.string.queue_live_updates_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = context.getString(R.string.queue_live_updates_channel_desc)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val alertChannel = NotificationChannel(
            ALERT_CHANNEL_ID,
            context.getString(R.string.queue_alerts_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.queue_alerts_channel_desc)
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
            .setContentTitle(alertTitle(context, payload))
            .setContentText(alertBody(context, payload))
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(alertBody(context, payload))
                    .setBigContentTitle(alertTitle(context, payload))
                    .setSummaryText(
                        payload.ticketNumber?.let { context.getString(R.string.ticket_label, it) }
                            ?: (payload.serviceName ?: payload.officeName ?: context.getString(R.string.current_visit))
                    )
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
                context.getString(R.string.open),
                buildOpenIntent(context, payload)
            )

        NotificationManagerCompat.from(context)
            .notify(alertNotificationId(payload.ticketId, payload.type), builder.build())
    }

    private fun postCompletionNotification(context: Context, payload: QueueLiveUpdatePayload) {
        val builder = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(completionTitle(context, payload))
            .setContentText(completionBody(context, payload))
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(completionBody(context, payload))
                    .setBigContentTitle(completionTitle(context, payload))
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
            .setContentTitle(liveTitle(context, payload))
            .setContentText(liveBody(context, payload))
            .setSubText(liveSubtext(context, payload))
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
                context.getString(R.string.open),
                buildOpenIntent(context, payload)
            )

        if (payload.type == "called" || payload.type == "recall") {
            builder
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis() + 60_000)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
        } else if (payload.type == "serving") {
            parseEpochMillis(payload.servingStartedAt)?.let { startedAt ->
                builder
                    .setShowWhen(true)
                    .setWhen(startedAt)
                    .setUsesChronometer(true)
                    .setChronometerCountDown(false)
            }
        }

        shortCriticalText(context, payload)?.let { builder.setShortCriticalText(it) }
        return builder.build()
    }

    private fun liveTitle(context: Context, payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "called" -> context.getString(R.string.go_to_desk, payload.deskName ?: context.getString(R.string.your_desk))
            "recall" -> context.getString(R.string.return_to_desk, payload.deskName ?: context.getString(R.string.your_desk))
            "serving" -> payload.serviceName ?: context.getString(R.string.with_staff_now)
            else ->
                payload.serviceName
                    ?: payload.departmentName
                    ?: payload.officeName
                    ?: payload.ticketNumber?.let { context.getString(R.string.ticket_label, it) }
                    ?: context.getString(R.string.current_visit)
        }
    }

    private fun liveBody(context: Context, payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "called" -> payload.ticketNumber?.let { context.getString(R.string.show_screen_on_arrival, it) }
                ?: context.getString(R.string.proceed_now)
            "recall" -> payload.ticketNumber?.let { context.getString(R.string.return_to_desk_now, it) }
                ?: context.getString(R.string.staff_waiting_now)
            "serving" -> payload.deskName?.let { context.getString(R.string.at_desk, it) }
                ?: context.getString(R.string.staff_helping)
            else -> buildString {
                payload.officeName?.let { append(it) }
                if (payload.position != null) {
                    if (isNotEmpty()) append(" • ")
                    append(context.getString(R.string.line_position, payload.position))
                }
                if (payload.estimatedWait != null) {
                    if (isNotEmpty()) append(" • ")
                    append(context.getString(R.string.approx_wait, payload.estimatedWait))
                }
                if (!payload.nowServing.isNullOrBlank()) {
                    if (isNotEmpty()) append(" • ")
                    append(context.getString(R.string.now_serving, payload.nowServing))
                }
                if (isEmpty()) append(context.getString(R.string.waiting_for_turn))
            }
        }
    }

    private fun liveSubtext(context: Context, payload: QueueLiveUpdatePayload): String? {
        return when (payload.type) {
            "called", "recall" -> payload.ticketNumber?.let { context.getString(R.string.ticket_label, it) }
            "serving" -> listOf(payload.officeName, payload.ticketNumber?.let { context.getString(R.string.ticket_label, it) }).filterNotNull().joinToString(" • ").ifBlank { null }
            else -> payload.departmentName ?: payload.status?.replaceFirstChar { it.uppercase() }
        }
    }

    private fun alertTitle(context: Context, payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "buzz" -> context.getString(R.string.buzz_alert)
            "recall" -> context.getString(R.string.reminder_your_turn)
            else -> context.getString(R.string.its_your_turn)
        }
    }

    private fun alertBody(context: Context, payload: QueueLiveUpdatePayload): String {
        val desk = payload.deskName ?: context.getString(R.string.your_desk)
        val ticketNumber = payload.ticketNumber.orEmpty()
        return when (payload.type) {
            "buzz" -> payload.body.ifBlank {
                context.getString(R.string.please_go_to_desk_now, ticketNumber, desk)
            }
            "recall" -> context.getString(R.string.return_to_desk_immediately, ticketNumber, desk)
            else -> context.getString(R.string.please_go_to_desk_now, ticketNumber, desk)
        }
    }

    private fun completionTitle(context: Context, payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "no_show" -> context.getString(R.string.visit_status_updated)
            else -> context.getString(R.string.visit_complete)
        }
    }

    private fun completionBody(context: Context, payload: QueueLiveUpdatePayload): String {
        return when (payload.type) {
            "no_show" -> context.getString(R.string.ticket_marked_missed)
            else -> context.getString(R.string.thanks_for_visiting_feedback)
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

    private fun shortCriticalText(context: Context, payload: QueueLiveUpdatePayload): String? {
        return when (payload.type) {
            "position_update" -> payload.position?.let { "#$it" }
            "called", "recall", "buzz" -> context.getString(R.string.now_short)
            "serving" -> payload.deskName ?: context.getString(R.string.desk_short)
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

    private fun parseEpochMillis(rawDate: String?): Long? {
        if (rawDate.isNullOrBlank()) return null
        return runCatching {
            java.time.Instant.parse(rawDate).toEpochMilli()
        }.getOrNull()
    }
}
