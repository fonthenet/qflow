package com.queueflow.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
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
            description = "Live queue position and progress updates"
            setShowBadge(false)
        }

        val alertChannel = NotificationChannel(
            ALERT_CHANNEL_ID,
            "Queue Alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Urgent queue alerts, recalls, and buzzes"
            enableLights(true)
            enableVibration(true)
            vibrationPattern = longArrayOf(400, 180, 400, 180, 600)
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
                postCompletionNotification(context, payload)
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
            .setContentTitle(payload.title)
            .setContentText(payload.body)
            .setContentIntent(buildOpenIntent(context, payload))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVibrate(vibrationPattern)

        NotificationManagerCompat.from(context)
            .notify(alertNotificationId(payload.ticketId, payload.type), builder.build())
    }

    private fun postCompletionNotification(context: Context, payload: QueueLiveUpdatePayload) {
        val builder = NotificationCompat.Builder(context, LIVE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(payload.title)
            .setContentText(payload.body)
            .setContentIntent(buildOpenIntent(context, payload))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)

        NotificationManagerCompat.from(context)
            .notify(liveNotificationId(payload.ticketId), builder.build())
    }

    private fun cancelLiveUpdate(context: Context, ticketId: String) {
        NotificationManagerCompat.from(context).cancel(liveNotificationId(ticketId))
    }

    private fun buildOpenIntent(context: Context, payload: QueueLiveUpdatePayload): PendingIntent {
        val targetUrl = normalizeQueueUrl(
            payload.url?.takeIf { it.isNotBlank() },
            payload.qrToken
        )
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
            .setContentTitle(payload.title)
            .setContentText(payload.body)
            .setSubText(payload.ticketNumber?.let { "Ticket $it" })
            .setContentIntent(buildOpenIntent(context, payload))
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSilent(silent)
            .setRequestPromotedOngoing(Build.VERSION.SDK_INT >= 36)
            .setStyle(
                NotificationCompat.ProgressStyle()
                    .setStyledByProgress(true)
                    .setProgress(progressPercent(payload))
            )

        shortCriticalText(payload)?.let { builder.setShortCriticalText(it) }
        return builder.build()
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

    private fun liveNotificationId(ticketId: String): Int {
        return 1000 + (ticketId.hashCode().absoluteValue % 900000)
    }

    private fun alertNotificationId(ticketId: String, type: String): Int {
        return 2000000 + ((ticketId + type).hashCode().absoluteValue % 900000)
    }
}
