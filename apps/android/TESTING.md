# Android Live Update Test Checklist

Use this checklist after the Firebase and server credentials in `SETUP.md` are configured and the `android_tokens` migration is applied.

## Build and install

1. From `apps/android`, run `./gradlew assembleDebug`.
2. Install `app/build/outputs/apk/debug/app-debug.apk` on a physical Android device.
3. Confirm the app opens the QueueFlow TWA home page successfully.

## Initial registration

1. Open a real queue link like `https://qflow-sigma.vercel.app/q/TOKEN`.
2. On Android 13+, allow notifications when prompted.
3. Confirm the backend inserts a row in `public.android_tokens` for that ticket.
4. Confirm the app immediately shows the current queue state as an ongoing notification.

## Live queue progression

1. Create 3 to 4 tickets in the same office and department.
2. Track one of the later tickets in the Android app.
3. Call or serve the tickets ahead of it.
4. Confirm the ongoing notification updates in place with:
   - latest position
   - estimated wait
   - current `now serving` number

## Alert states

1. Trigger `call next`.
2. Confirm:
   - an urgent alert notification appears
   - the ongoing live notification remains pinned
   - tapping the alert opens the exact `/q/TOKEN` page
3. Trigger `recall`.
4. Confirm the alert notification updates again and the live notification still reflects the called state.
5. Trigger `buzz`.
6. Confirm a separate urgent buzz alert appears without replacing the live progress notification.

## Completion states

1. Trigger `start serving`.
2. Confirm the ongoing notification reflects `Being Served`.
3. Trigger `mark served`.
4. Confirm the ongoing notification is dismissed and replaced by a completion message.
5. Repeat with `mark no_show` and confirm the same cleanup behavior.

## Token and routing resilience

1. Kill the app and reopen the same `/q/TOKEN` link.
2. Confirm the tracked ticket stays correct and no stale ticket identity is reused.
3. Clear app data, reopen a queue link, and verify registration works from a clean state.

## Android 16 promotion check

1. Test on an Android 16 device if available.
2. Confirm the ongoing queue notification is eligible for the promoted live update treatment.
3. If it is not promoted, verify:
   - `POST_PROMOTED_NOTIFICATIONS` is granted by the system
   - the notification still renders correctly as an ongoing progress notification
   - the app is built with the latest Android module toolchain from this repo
