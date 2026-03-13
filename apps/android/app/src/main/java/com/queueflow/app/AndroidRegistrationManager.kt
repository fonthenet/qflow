package com.queueflow.app

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

object AndroidRegistrationManager {
    private const val TAG = "AndroidRegister"
    private val executor = Executors.newSingleThreadExecutor()

    fun registerCurrentTicket(context: Context) {
        val trackedTicket = QueueTrackingStore.getTrackedTicket(context)
        val qrToken = trackedTicket.qrToken ?: return

        QueueFlowFirebase.fetchMessagingToken(context) { token ->
            if (token.isNullOrBlank()) {
                Log.w(TAG, "FCM token unavailable; skipping native live update registration")
                return@fetchMessagingToken
            }

            QueueTrackingStore.saveDeviceToken(context, token)

            executor.execute {
                postRegistration(context, qrToken, token)
            }
        }
    }

    private fun postRegistration(context: Context, qrToken: String, deviceToken: String) {
        try {
            val connection = URL("${BuildConfig.APP_BASE_URL.trimEnd('/')}/api/android-register")
                .openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.connectTimeout = 10000
            connection.readTimeout = 10000

            val payload = JSONObject()
                .put("qrToken", qrToken)
                .put("deviceToken", deviceToken)
                .put("packageName", BuildConfig.APPLICATION_ID)

            OutputStreamWriter(connection.outputStream).use { writer ->
                writer.write(payload.toString())
            }

            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }

            val responseText = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (connection.responseCode !in 200..299) {
                Log.e(TAG, "Registration failed ${connection.responseCode}: $responseText")
                connection.disconnect()
                return
            }

            val json = JSONObject(responseText)
            QueueTrackingStore.saveTicketIdentity(
                context,
                json.optString("ticketId").takeIf { it.isNotBlank() },
                json.optJSONObject("snapshot")?.optString("ticketNumber")?.takeIf { it.isNotBlank() }
            )

            val snapshot = json.optJSONObject("snapshot")
            if (snapshot != null) {
                QueueLiveUpdateNotifier.showState(
                    context,
                    QueueLiveUpdatePayload.fromJson(snapshot)
                )
            }

            connection.disconnect()
        } catch (error: Exception) {
            Log.e(TAG, "Android registration failed", error)
        }
    }
}
