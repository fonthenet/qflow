# Android Live Updates Setup

Qflo's Android wrapper now supports native queue live updates on top of the TWA experience.

## 1. Firebase client config for the Android app

Add these keys to `apps/android/local.properties` or export them as environment variables before building:

```properties
QUEUEFLOW_FIREBASE_PROJECT_ID=your-firebase-project-id
QUEUEFLOW_FIREBASE_APP_ID=1:1234567890:android:abcdef123456
QUEUEFLOW_FIREBASE_API_KEY=your-android-firebase-api-key
QUEUEFLOW_FIREBASE_SENDER_ID=1234567890
```

Optional release signing keys:

```properties
QUEUEFLOW_ANDROID_KEYSTORE=../android.keystore
QUEUEFLOW_ANDROID_STORE_PASSWORD=your-store-password
QUEUEFLOW_ANDROID_KEY_ALIAS=queueflow
QUEUEFLOW_ANDROID_KEY_PASSWORD=your-key-password
```

## 2. FCM server auth for the web backend

Set one of these on the web/server side:

```env
FCM_SERVICE_ACCOUNT_JSON={...}
```

Or:

```env
FCM_PROJECT_ID=your-firebase-project-id
FCM_CLIENT_EMAIL=firebase-adminsdk-xxxx@your-project-id.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

## 3. Apply the Supabase migration

Run the migration that adds `public.android_tokens`:

`supabase/migrations/20260313161000_add_android_tokens.sql`

## 4. Build

From `apps/android`:

```bash
./gradlew assembleDebug
```

This Android module now targets Android 16 APIs using AGP 8.13.x, Gradle 8.13, and JDK 17.

## 5. Test flow

1. Install the Android app.
2. Open a queue link like `https://qflo.net/q/TOKEN` in the app.
3. The app registers its FCM token with `/api/android-register`.
4. Queue actions send native Android updates through FCM.
5. Follow the full regression checklist in `TESTING.md`.
