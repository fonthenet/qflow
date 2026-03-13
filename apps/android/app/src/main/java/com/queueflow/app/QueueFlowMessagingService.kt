package com.queueflow.app

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class QueueFlowMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        QueueFlowFirebase.ensureInitialized(this)
        QueueTrackingStore.saveDeviceToken(this, token)
        AndroidRegistrationManager.registerCurrentTicket(this)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        QueueFlowFirebase.ensureInitialized(this)
        if (message.data.isEmpty()) {
            Log.d("QueueFlowMessaging", "Ignoring FCM message with no data payload")
            return
        }

        QueueLiveUpdateNotifier.showState(
            this,
            QueueLiveUpdatePayload.fromMap(message.data)
        )
    }
}
