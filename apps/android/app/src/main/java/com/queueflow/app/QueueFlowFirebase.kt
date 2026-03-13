package com.queueflow.app

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging

object QueueFlowFirebase {
    private const val TAG = "QueueFlowFirebase"

    private fun isConfigured(): Boolean {
        return BuildConfig.FIREBASE_PROJECT_ID.isNotBlank() &&
            BuildConfig.FIREBASE_APP_ID.isNotBlank() &&
            BuildConfig.FIREBASE_API_KEY.isNotBlank() &&
            BuildConfig.FIREBASE_SENDER_ID.isNotBlank()
    }

    fun ensureInitialized(context: Context): Boolean {
        if (FirebaseApp.getApps(context).isNotEmpty()) {
            return true
        }

        if (!isConfigured()) {
            Log.w(TAG, "Firebase client config is missing; native Android live updates are disabled")
            return false
        }

        val options = FirebaseOptions.Builder()
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build()

        FirebaseApp.initializeApp(context, options)
        return FirebaseApp.getApps(context).isNotEmpty()
    }

    fun fetchMessagingToken(context: Context, onResult: (String?) -> Unit) {
        if (!ensureInitialized(context)) {
            onResult(null)
            return
        }

        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token -> onResult(token) }
            .addOnFailureListener { error ->
                Log.e(TAG, "Failed to fetch FCM token", error)
                onResult(null)
            }
    }
}
