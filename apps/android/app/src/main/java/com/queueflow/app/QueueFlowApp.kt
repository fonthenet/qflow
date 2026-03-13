package com.queueflow.app

import android.app.Application

class QueueFlowApp : Application() {
    override fun onCreate() {
        super.onCreate()
        QueueFlowFirebase.ensureInitialized(this)
        QueueLiveUpdateNotifier.ensureChannels(this)
        AndroidRegistrationManager.registerCurrentTicket(this)
    }
}
