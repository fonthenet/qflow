# Qflo Mobile Release Checklist

Applies to `apps/mobile` (Expo / EAS). Run through every section in order before submitting to App Store or Play Console.

---

## 1. EAS Secret Setup

All secrets are stored at the EAS project scope so they are available in every build profile without being committed to the repo.

Install the EAS CLI first:
```
npm install -g eas-cli
eas login
```

Then create each secret. Replace the `…` with the real value.

```bash
# Supabase — required by all build profiles
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL \
  --value "https://ofyyzuocifigyyhqxxqw.supabase.co"

eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value "…"

# App Store submission (production profile only)
eas secret:create --scope project --name APPLE_ID \
  --value "your-apple-id@example.com"

eas secret:create --scope project --name ASC_APP_ID \
  --value "1234567890"   # App Store Connect numeric app ID

eas secret:create --scope project --name APPLE_TEAM_ID \
  --value "XXXXXXXXXX"   # 10-character Team ID — see Section 2

# Environment tag (controls feature flags in app.config.ts)
# Set separately per profile if needed; EAS env.EXPO_PUBLIC_APP_ENV
# in eas.json already overrides this at build time.
```

Verify secrets are registered:
```bash
eas secret:list
```

---

## 2. Fill `{{APPLE_TEAM_ID}}` in `apple-app-site-association`

File: `apps/web/public/.well-known/apple-app-site-association`

Current placeholders:
- `"{{APPLE_TEAM_ID}}.com.qflo.app.QfloClip"` (appclips)
- `"{{APPLE_TEAM_ID}}.com.qflo.app"` (applinks)

**Where to find your Team ID:**
1. Sign in at https://developer.apple.com
2. Click your name (top-right) → **Membership details**
3. Copy the **Team ID** (10 uppercase alphanumeric characters, e.g. `A1B2C3D4E5`)

**Apply it:**
```bash
# In apps/web/public/.well-known/apple-app-site-association
# Replace both occurrences of {{APPLE_TEAM_ID}} with the real value, e.g.:
# "A1B2C3D4E5.com.qflo.app"
# "A1B2C3D4E5.com.qflo.app.QfloClip"
```

Also replace the same placeholder in `apps/mobile/eas.json` under `submit.production.ios.appleTeamId`.

---

## 3. Fill `{{ANDROID_SHA256_FINGERPRINT}}` in `assetlinks.json`

File: `apps/web/public/.well-known/assetlinks.json`

Two fingerprints are needed — the file currently accepts an array under `sha256_cert_fingerprints`.

### 3a. Debug fingerprint (local dev / ad-hoc APK)

```bash
# From the debug keystore (created automatically by Android tooling)
keytool -list -v \
  -keystore ~/.android/debug.keystore \
  -alias androiddebugkey \
  -storepass android -keypass android \
  | grep "SHA256:"
# Output example: SHA256: AA:BB:CC:...
```

### 3b. Production fingerprint (EAS-managed or Play Console)

**EAS-managed signing (recommended):**
```bash
eas credentials --platform android
# Select your app → Upload/Download → View SHA-256 certificate fingerprint
```

**Play Console (if you uploaded your own keystore):**
1. Open Play Console → your app → **Setup** → **App signing**
2. Copy the SHA-256 fingerprint under **App signing key certificate**

### 3c. Apply both fingerprints

```json
{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.qflo.app",
    "sha256_cert_fingerprints": [
      "AA:BB:CC:...",
      "DD:EE:FF:..."
    ]
  }
}
```

The first entry is debug, the second is production. Android verifies any matching fingerprint.

---

## 4. Verification Commands

Run these after deploying the updated `.well-known` files to production.

### Apple App Site Association
```bash
# Must return JSON with no redirect and Content-Type: application/json
curl -sI https://qflo.app/.well-known/apple-app-site-association
curl -s  https://qflo.app/.well-known/apple-app-site-association | python3 -m json.tool

# Apple's hosted validator (browser):
# https://app-site-association.cdn-apple.com/a/v1/qflo.app
```

### Android Asset Links
```bash
# Must return 200 and include your package name + fingerprint
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list\
?source.web.site=https://qflo.app\
&relation=delegate_permission/common.handle_all_urls" | python3 -m json.tool
```

### EAS Preview Build (iOS)
```bash
# Triggers a build on EAS servers — does not push to App Store
eas build --profile preview --platform ios --non-interactive
```

### EAS Preview Build (Android APK)
```bash
eas build --profile preview --platform android --non-interactive
```

---

## 5. Store Submission Prerequisites

### App Store Connect (iOS)

- [ ] App record created at https://appstoreconnect.apple.com (bundle ID `com.qflo.app`)
- [ ] Age rating questionnaire completed
- [ ] Privacy policy URL set (https://qflo.app/privacy)
- [ ] App Review contact info filled in
- [ ] At least one screenshot per required device size:
  - iPhone 6.9" (iPhone 16 Pro Max) — 1320 × 2868 px
  - iPhone 6.5" (iPhone 14 Plus) — 1242 × 2688 px
  - iPad Pro 12.9" — 2048 × 2732 px (required if `supportsTablet: true`)
- [ ] App clip record added (if shipping the clip)
- [ ] `APPLE_TEAM_ID` placeholder resolved in `apple-app-site-association` and deployed
- [ ] Universal links verified (Apple CDN validator returns correct JSON)
- [ ] `eas submit --platform ios --profile production` run after build completes

### Google Play Console (Android)

- [ ] App created in Play Console (package `com.qflo.app`) — Internal testing track
- [ ] SHA-256 fingerprint copied from **App signing** and added to `assetlinks.json`
- [ ] `assetlinks.json` deployed and verified via Digital Asset Links API
- [ ] Store listing complete: icon, feature graphic, description (FR + AR + EN)
- [ ] Content rating questionnaire completed
- [ ] Screenshots uploaded per device tier:
  - Phone: min 2, recommended 8, 16:9 or 9:16
  - 7" tablet (optional but recommended)
  - 10" tablet (optional)
- [ ] App Bundle (.aab) built with `eas build --profile production --platform android`
- [ ] `eas submit --platform android --profile production` run, or upload AAB manually

---

## 6. Rollback Notes

- **iOS**: if a release has a critical bug, use App Store Connect → your version → **Pause Rollout** or **Remove from Sale**. EAS builds are immutable; re-submit the previous build by promoting it from TestFlight.
- **Android**: Play Console → **Release** → **Rollout** → **Halt rollout**. Re-activate a previous release from the track's release history.
- **Deep links**: if `.well-known` files are reverted, Android re-verification takes up to 24 h; iOS CDN caches for ~1 h.
