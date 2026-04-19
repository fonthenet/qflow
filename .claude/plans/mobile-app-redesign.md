# QFlo Mobile App — UX + Architecture Redesign

## Executive Summary

The Expo app grew feature-by-feature (walk-in scan → kiosk flow → future booking → appointments → staff portal → call alerts). Each feature was bolted on in its own screen with its own types, its own status mapping, its own empty state, and its own copy. The result: duplicated surfaces, a misnamed tab, three entry points for the same action, and a layout that feels "off" because nothing shares a visual system.

### Top 5 Problems

1. **Duplicated appointment surfaces** — `app/appointments/index.tsx` and `app/(tabs)/history.tsx` render near-identical appointment cards, with two copies of `refreshAppointments`, two copies of the status pill, two copies of the "check-in disabled" branch. They drift.
2. **"Queue" tab is misnamed and state-leaky** — It's the live-visit tab (walk-in ticket *or* checked-in appointment), but labelled "Queue" with a scan button. The `tabPress` listener used to nuke the active ticket; it's now patched but the concept is still wrong.
3. **Three book-for-later entry points** — Places card, queue-peek screen, and kiosk-info screen each have their own "Book" button with different styling and different prop-passing. Easy for one to drift from the intake-field contract.
4. **Kiosk home vs queue-peek overlap** — Scanning a QR lands on `/kiosk/[slug]` which immediately forwards to queue-peek for most orgs. The kiosk home step is a dead-end most of the time.
5. **Intake flow drift** — Walk-in (`join/[token].tsx`) and future booking (`book-appointment/[slug].tsx`) each reimplement the dynamic intake form. Recent fix to read from raw settings had to be applied twice.

### Top 5 Proposed Changes

1. **Rename "Queue" → "Active"** (icon: pulse/dot). This tab shows the currently-running visit (walk-in *or* checked-in appointment). Scan button moves to Home.
2. **Collapse 5 tabs → 4**: Home, Places, Activity, Profile. Station leaves the tab bar (moves into Profile entry).
3. **Single `<IntakeForm />` component** — one source of truth for intake rendering. Walk-in and future-booking screens both mount it.
4. **Delete the kiosk home step** — QR scan resolves org → queue-peek (with Book CTA if enabled). No intermediate menu.
5. **Onboarding + unified settings home** — first-launch sets name/phone/language; settings screen consolidates profile + theme + language + notifications.

---

## Proposed 4-Tab IA

| Tab | Route | Purpose |
|-----|-------|---------|
| Home | `(tabs)/index.tsx` | Scan, recent place shortcuts, "your next appointment" card, active-visit hero if one exists |
| Places | `(tabs)/places.tsx` | Saved places, pins, wait alerts, search |
| Active | `(tabs)/active.tsx` (renamed from today's Queue/index) | Live visit detail (walk-in ticket or checked-in appointment). Shown empty-state when nothing active. |
| Activity | `(tabs)/activity.tsx` (renamed from history) | Past tickets + all appointments (upcoming/past), filterable |
| Profile | `(tabs)/profile.tsx` | Name/phone, language, theme, notifications, staff/Station entry |

Station moves out of the tab bar into Profile.

---

## Screen Inventory

### Add
- `app/visit/[id].tsx` — unified detail for a Visit (walk-in or appointment)
- `app/(tabs)/active.tsx` — renamed from index; live visit hero
- `app/onboarding.tsx` — first-launch profile setup

### Delete
- `app/appointments/index.tsx` (folded into Activity)
- `app/ticket/[token].tsx` (folded into `visit/[id].tsx`)
- `app/(tabs)/station.tsx` as a tab (link from Profile)
- `app/kiosk/[slug].tsx` intermediate home step (scan → queue-peek directly)

### Rename
- `app/(tabs)/index.tsx` → `app/(tabs)/active.tsx`
- `app/(tabs)/history.tsx` → `app/(tabs)/activity.tsx`

---

## Component System

Extract to `apps/expo/components/visit/`:

- `<Visit.Card />` — one card style for ticket and appointment rows (Activity list + Places recent)
- `<Visit.StatusPill />` — single status→color map
- `<Visit.Detail />` — hero used in Active tab and visit/[id] screen
- `<IntakeForm />` — renders `getEnabledIntakeFields(settings)` with prefill + validation
- `<BookCTA place={} />` — single Book button wired to intake contract
- `<EmptyState />` — icon + copy + CTA (used in Active, Places empty, Activity empty)
- `<PlaceHeader />` — logo + name + vertical chip (used in queue-peek, kiosk-info, detail screens)

Shared types in `apps/expo/lib/visit.ts`:
```ts
export type VisitKind = 'ticket' | 'appointment';
export type VisitStatus = 'waiting' | 'called' | 'serving' | 'served' | 'cancelled' | 'no_show' | 'pending' | 'confirmed' | 'checked_in' | 'completed';
export const TERMINAL: VisitStatus[] = ['served', 'cancelled', 'no_show', 'completed'];
export const UPCOMING: VisitStatus[] = ['pending', 'confirmed'];
```

---

## Theme Tokens

Add to `lib/theme.ts`:
- `statusColors` map (waiting/called/serving/served/etc.)
- Semantic spacing (`sp.card`, `sp.section`)
- Semantic radius (`r.card`, `r.pill`)
- Dark-mode contrast audit on pills (currently some fail AA on dark)

RTL: ensure all extracted components respect `I18nManager.isRTL` for icon placement and row direction.

---

## Flow Before/After

### Walk-in scan
- **Before**: Scan → `/kiosk/[slug]` → intermediate home → queue-peek → (optional) Book
- **After**: Scan → queue-peek with `<BookCTA />` inline

### Book appointment
- **Before**: Three entry points, each wiring their own intake
- **After**: All call `router.push('/book-appointment/[slug]')`; screen mounts `<IntakeForm />`

### Active visit
- **Before**: Queue tab with scan button; active ticket may or may not restore; appointment with linked ticket lives in separate screen
- **After**: Active tab always shows current Visit (kind=ticket or kind=appointment); empty-state prompts Home scan; auto-recovery already in place

### Appointment → check-in → ticket
- **Before**: User sees appointment card in history, separate screen. After check-in, ticket appears in Queue tab but appointment card doesn't show the number until a poll.
- **After**: Single Visit object; check-in by staff upgrades it in place; Active tab promotes automatically; Activity card shows ticket number as soon as linked.

---

## Phased Rollout

### Phase 1 — Dedup (1-2 weeks, 5 deletes + 7 edits, no server changes)
1. Delete `apps/expo/app/appointments/index.tsx` — redirect callers to Activity
2. Delete `apps/expo/app/ticket/[token].tsx` — callers go to Active tab
3. Rename `history.tsx` → `activity.tsx`
4. Remove `(tabs)/station.tsx` tab; add Profile → Station link
5. Extract `lib/visit.ts` (types + TERMINAL/UPCOMING sets)
6. Extract `<Visit.StatusPill />`
7. Extract `<BookCTA place={} />`

### Phase 2 — Flow unification (2-3 weeks)
- Extract `<IntakeForm />`, mount in walk-in + future-booking
- Rename Queue tab → Active; move scan button to Home
- Delete kiosk intermediate step
- Create `app/visit/[id].tsx`
- Refactor calendar API consumers behind `useVisit(id)` hook

### Phase 3 — Home + onboarding (2 weeks)
- New Home tab: scan hero, "next appointment" card, recent places row
- First-launch onboarding (name/phone/language)
- Unified Profile/settings screen

### Phase 4 — Polish (1-2 weeks)
- Dark-mode audit, RTL sweep, a11y labels
- Animations on status transitions
- Call-alert iOS Critical Alerts entitlement wiring

---

## Critical Files for Phase 1

- `apps/expo/app/(tabs)/_layout.tsx` — remove Station tab, rename Queue label
- `apps/expo/app/(tabs)/history.tsx` → `activity.tsx`
- `apps/expo/app/appointments/index.tsx` — delete
- `apps/expo/app/ticket/[token].tsx` — delete
- `apps/expo/app/(tabs)/station.tsx` — delete from tabs, keep as `app/station/index.tsx` if needed
- `apps/expo/lib/visit.ts` — NEW
- `apps/expo/components/visit/StatusPill.tsx` — NEW
- `apps/expo/components/BookCTA.tsx` — NEW
- `apps/expo/app/(tabs)/index.tsx` — consume new StatusPill
- `apps/expo/app/place/[id].tsx` — consume `<BookCTA />`
- `apps/expo/app/kiosk-info/[slug].tsx` — consume `<BookCTA />`
- `apps/expo/app/queue-peek/[slug].tsx` — consume `<BookCTA />`
