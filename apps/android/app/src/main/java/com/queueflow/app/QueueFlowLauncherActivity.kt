package com.queueflow.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import com.google.androidbrowserhelper.trusted.LauncherActivity

class QueueFlowLauncherActivity : LauncherActivity() {
    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        captureQueueIntent(intent)
        ensureNotificationPermission()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureQueueIntent(intent)
        ensureNotificationPermission()
    }

    private fun captureQueueIntent(intent: Intent?) {
        val data = intent?.data ?: return
        val qrToken = extractQrToken(data) ?: return
        QueueTrackingStore.saveTrackedTicket(this, qrToken, data.toString())
        AndroidRegistrationManager.registerCurrentTicket(this)
    }

    private fun extractQrToken(uri: Uri): String? {
        val segments = uri.pathSegments ?: return null
        if (segments.size < 2) return null
        return if (segments[0] == "q") segments[1] else null
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        if (
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        if (QueueTrackingStore.hasPromptedForNotifications(this)) {
            return
        }

        QueueTrackingStore.markNotificationPrompted(this)
        requestPermissions(
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            NOTIFICATION_PERMISSION_REQUEST_CODE
        )
    }
}
