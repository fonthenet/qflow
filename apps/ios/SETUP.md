# QueueFlow iOS App Clip — Xcode Setup Guide

## Prerequisites
- macOS with Xcode 15+
- Apple Developer Program membership ($99/year)
- Your Apple Team ID (found at developer.apple.com > Account > Membership)

## Step 1: Create Xcode Project

1. Open Xcode → File → New → Project
2. Select **App** → Next
3. Configure:
   - Product Name: `QueueFlow`
   - Team: Select your team
   - Organization Identifier: `com.queueflow`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: None
   - Uncheck "Include Tests"
4. Save to `apps/ios/QueueFlow/`

## Step 2: Add App Clip Target

1. File → New → Target
2. Select **App Clip** → Next
3. Configure:
   - Product Name: `QueueFlowClip`
   - Bundle Identifier: `com.queueflow.app.Clip`
   - Embed in Application: `QueueFlow`
4. Activate the scheme when prompted

## Step 3: Add Source Files

### Companion App (`QueueFlow` target):
- Delete the auto-generated `ContentView.swift` and `QueueFlowApp.swift`
- Drag in from `QueueFlow/` folder:
  - `QueueFlowApp.swift`
  - `ContentView.swift`

### App Clip (`QueueFlowClip` target):
- Delete the auto-generated files
- Drag in from `QueueFlowClip/` folder:
  - `QueueFlowClipApp.swift`
  - `QueueView.swift`
  - `YourTurnView.swift`
  - `SupabaseClient.swift`
  - `APNsManager.swift`
- Copy `Info.plist` to the QueueFlowClip target (or merge contents)
- Copy `QueueFlowClip.entitlements` to the target

## Step 4: Configure Entitlements

### App Clip target:
1. Select QueueFlowClip target → Signing & Capabilities
2. Add **Associated Domains** capability
3. Add domain: `appclips:qflow-sigma.vercel.app` (or your production domain)
4. Add **Push Notifications** capability

### Companion App target:
1. Select QueueFlow target → Signing & Capabilities
2. Add **Associated Domains** capability
3. Add domain: `appclips:qflow-sigma.vercel.app`

## Step 5: Configure App Clip URL Handling

1. Select QueueFlowClip target → Info tab
2. Under **App Clip** section, ensure:
   - `NSAppClipRequestEphemeralUserNotification` = YES

## Step 6: Update Your Team ID

In `apps/web/public/.well-known/apple-app-site-association`:
- Replace `TEAM_ID` with your actual Apple Team ID

## Step 7: Generate APNs Key

1. Go to developer.apple.com → Certificates, Identifiers & Profiles → Keys
2. Create a new key with **Apple Push Notifications service (APNs)** enabled
3. Download the `.p8` file
4. Note the **Key ID** and your **Team ID**

Add to your Vercel environment variables:
```
APNS_KEY_ID=YOUR_KEY_ID
APNS_TEAM_ID=YOUR_TEAM_ID
APNS_BUNDLE_ID=com.queueflow.app.Clip
APNS_KEY_P8=-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----
```

## Step 8: Test in Simulator

1. Select the QueueFlowClip scheme
2. Edit Scheme → Run → Arguments → Environment Variables
3. Add: `_XCAppClipURL` = `https://qflow-sigma.vercel.app/q/YOUR_TEST_TOKEN`
4. Run on Simulator

## Step 9: Test on Physical Device

1. Connect your iPhone
2. Select it as the run destination
3. Build and run the QueueFlowClip scheme
4. Scan a QueueFlow QR code with the Camera app

## Step 10: Submit to App Store

1. In App Store Connect, create a new app with your bundle ID
2. Add an **App Clip Experience**:
   - URL: `https://yourdomain.com/q/`
   - Action: Open
   - Title: "QueueFlow"
   - Subtitle: "Track your queue position"
3. Upload both the app and App Clip via Xcode → Product → Archive
4. Submit for review

## Architecture

```
QR Scan → iOS checks AASA → Shows App Clip card → User taps "Open"
  ↓
App Clip launches → Extracts /q/TOKEN from URL
  ↓
Fetches ticket from Supabase REST API
  ↓
Registers for ephemeral push (8h, no prompt)
  ↓
Shows queue position (polls every 5s)
  ↓
When called → Shows "Your Turn!" + push notification on lock screen
```

## Troubleshooting

- **App Clip doesn't launch from QR**: Check AASA file is served with `Content-Type: application/json` and no redirect
- **No push notifications**: Verify APNs key is configured in Vercel env vars
- **"Ticket not found"**: Ensure the QR token in the URL matches a ticket in the database
- **Xcode signing errors**: Ensure both targets have the correct team and provisioning profiles
