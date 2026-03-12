# QueueFlow iOS — App Store Deployment Guide

> **No Mac needed.** Everything runs via GitHub Actions.

## Overview

The deployment pipeline uses:
- **XcodeGen** → generates .xcodeproj from project.yml
- **Fastlane Match** → manages code signing (certificates + provisioning profiles)
- **Fastlane** → builds, archives, and uploads to TestFlight/App Store
- **GitHub Actions** → runs everything on a macOS runner

## One-Time Setup (30 min)

### 1. Create App in App Store Connect

Go to [App Store Connect](https://appstoreconnect.apple.com):

1. Click **My Apps** → **+** → **New App**
2. Fill in:
   - **Platform**: iOS
   - **Name**: QueueFlow
   - **Primary Language**: English
   - **Bundle ID**: com.queueflow.app (register in Certificates portal first)
   - **SKU**: queueflow-app
3. Save — note the **Apple ID** (number) shown in App Information

### 2. Register Bundle IDs

Go to [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list):

1. Register `com.queueflow.app` (App ID, type: App)
   - Enable: Associated Domains, Push Notifications
2. Register `com.queueflow.app.QueueFlowClip` (App ID, type: App Clip)
   - Enable: Associated Domains, Push Notifications
   - Set parent app to `com.queueflow.app`

### 3. Create App Store Connect API Key

Go to [Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api):

1. Click **+** to generate a new key
2. Name: `GitHub Actions CI`
3. Access: **App Manager**
4. Download the `.p8` file — you'll need the:
   - **Key ID** (shown in the list)
   - **Issuer ID** (shown at the top)
   - **P8 file contents**

### 4. Create a Match Certificates Repo

Fastlane Match stores encrypted certificates in a private git repo:

1. Create a **private** GitHub repo: `your-username/queueflow-certs`
2. Generate a Personal Access Token (PAT) with `repo` scope:
   - GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Name: `fastlane-match`
   - Scope: `repo`
3. Base64 encode it: `echo -n "your-username:ghp_your_token" | base64`

### 5. Initialize Match Certificates (One-Time)

This needs to run once on any machine with Ruby/Fastlane:

**Option A: Run locally (if you have macOS access):**
```bash
cd apps/ios/QueueFlow
bundle install
MATCH_GIT_URL=https://github.com/your-username/queueflow-certs.git \
  bundle exec fastlane match appstore \
  --app_identifier "com.queueflow.app,com.queueflow.app.QueueFlowClip"
```

**Option B: Run via GitHub Actions:**
Create a one-time workflow dispatch to initialize match (the `sync_certs` lane handles this).

### 6. Set GitHub Secrets

Go to your repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|--------|-------|
| `ASC_KEY_ID` | App Store Connect API Key ID (from step 3) |
| `ASC_ISSUER_ID` | App Store Connect Issuer ID (from step 3) |
| `ASC_API_KEY_P8` | Contents of the .p8 file from step 3 |
| `MATCH_GIT_URL` | `https://github.com/your-username/queueflow-certs.git` |
| `MATCH_PASSWORD` | A passphrase to encrypt certificates (make one up, save it) |
| `MATCH_GIT_AUTH` | Base64 of `username:PAT` from step 4 |
| `KEYCHAIN_PASSWORD` | Any random string (CI keychain password) |
| `APP_APPLE_ID` | The Apple ID number from App Store Connect (step 1) |
| `APPLE_ID` | Your Apple Developer email |
| `ITC_TEAM_ID` | Your App Store Connect team ID |

### 7. Configure App Clip Experience

In App Store Connect → your app → **App Clip** section:

1. Click **Get Started** under App Clip Experiences
2. Add **Default App Clip Experience**:
   - Header image: your QueueFlow icon (1800×1200px recommended)
   - Subtitle: "Track your queue position"
   - Action: "Open"
3. Add **Advanced App Clip Experience**:
   - URL: `https://qflow-sigma.vercel.app/q/`
   - This matches your QR code URLs

## Deploying

### Upload to TestFlight
```
GitHub → Actions → "Deploy iOS to TestFlight" → Run workflow → beta
```

This builds, signs, and uploads to TestFlight. Your testers get notified automatically.

### Submit to App Store Review
```
GitHub → Actions → "Deploy iOS to TestFlight" → Run workflow → release
```

This submits the latest TestFlight build for App Store review.

## Verifying AASA

After deployment, verify your AASA file is accessible:
```
curl https://qflow-sigma.vercel.app/.well-known/apple-app-site-association
```

You can also use Apple's validator:
https://search.developer.apple.com/appsearch-validation-tool/

## Troubleshooting

### "No matching provisioning profiles"
Run the `sync_certs` lane to re-download profiles:
```
GitHub → Actions → use workflow_dispatch for sync_certs
```

### "The bundle identifier does not match"
Make sure both bundle IDs are registered in the Apple Developer Portal:
- `com.queueflow.app`
- `com.queueflow.app.QueueFlowClip`

### Build fails on CI
Check the build-ios.yml workflow first — it runs without signing and validates
that the Swift code compiles. Fix compile errors before attempting deployment.
