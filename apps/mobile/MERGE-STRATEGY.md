# apps/mobile vs apps/expo — Merge Strategy

## What each contains

| Area | apps/expo | apps/mobile |
|---|---|---|
| Routing | Expo Router (tabs + admin + operator + auth groups) | Expo Router v4 (customer group only) |
| Native targets | iOS App Clip, Live Activity (Swift) | None |
| Kiosk | No dedicated kiosk route | No kiosk route |
| Auth | Full role-select + org context | Biometric + Supabase session |
| State | operator-store, realtime queue hooks | Offline cache (AsyncStorage) |
| Push | Not wired | expo-notifications wired |
| i18n | Partial | FR/AR/EN per ticket.locale |
| QR scanning | Not wired | Camera + scan screen |
| Target users | Staff (operator, admin) + station kiosk | Customer-facing only |

## Recommendation: Keep both, harden ownership split

Merging into one app creates a single binary that ships kiosk/staff UI to the App Store customer listing — bad for review and security. The split is intentional:

- `apps/expo` = **Staff app** (operator tablet, admin desk, kiosk mode). Rename slug to `qflo-staff` to make this explicit. Not submitted to public stores; distributed via internal TestFlight/internal track.
- `apps/mobile` = **Customer app** (`com.qflo.app`). This is the public App Store / Play Store binary.

## Concrete next steps

1. Rename `apps/expo` slug to `qflo-staff` in its `app.json`; create a separate `eas.json` there with `distribution: internal` only — never `submit`.
2. Move kiosk-related deeplink paths (`/kiosk/*`) out of `apps/mobile` intent filters if kiosk is staff-only. Keep them if the kiosk flow starts from a customer QR scan (current design keeps them).
3. Backport `expo-notifications` wiring and offline cache from `apps/mobile` into `apps/expo` for the staff app.
4. Deprecate any overlapping customer screens in `apps/expo` (profile, ticket status) — those live in `apps/mobile` only.
5. Share business logic exclusively through `packages/` — neither app may duplicate Supabase query logic.

## Placeholders that MUST be filled before production release

- `{{APPLE_TEAM_ID}}` in `apple-app-site-association` and `eas.json` submit config
- `{{ANDROID_SHA256_FINGERPRINT}}` in `assetlinks.json` (obtain from Play Console or `keytool` on the release keystore)
- `{{EAS_PROJECT_ID}}` in `app.config.ts` extra block (run `eas init` once)
- EAS secrets: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `appleId`, `ascAppId`
