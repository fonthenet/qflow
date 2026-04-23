# Qflo Performance Audit — 2026-04-23

Auditor: qflo-perf-engineer
Scope: web bundle, Supabase DB, Station SQLite, low-bandwidth readiness, React rendering, network

---

## Executive Summary

| Area | Verdict | Key Number |
|------|---------|------------|
| Web bundle | FAIL — over budget | Shared base 221 KB gz (target 150 KB for landing/booking); middleware 234 KB gz |
| Supabase DB | FAIL — critical | 505 advisors: 49 RLS initplan issues, 45 unindexed FKs, 379 multiple-permissive-policy rows |
| Station SQLite | MARGINAL | Indexes mostly present; services sync pull has no org filter (data privacy + perf risk) |
| Low-bandwidth mode | NOT IMPLEMENTED | Zero `NetworkInformation`/`effectiveType`/`saveData` checks anywhere in the codebase |
| React rendering | MARGINAL | Customers page loads all rows with SELECT *; no list virtualization anywhere |
| Network / caching | FAIL | No `revalidate`, no edge runtime on public routes; appointment booking makes 2 serial `offices` fetches |

---

## Metrics Baseline (captured 2026-04-23)

### Web bundle (raw / gzipped)

| Chunk | Raw | Gzipped |
|-------|-----|---------|
| `6294-9c01fdd7fcd95c32.js` | 412 KB | **126 KB** — Sentry SDK |
| `9106-d0bdbd3cb4bed0da.js` | 315 KB | 94 KB — unknown (large; no Supabase, minimal Sentry) |
| `1409-40febe95d11693c6.js` | 209 KB | 55 KB — Supabase SSR + auth-js |
| `10c22984-74f0df41bf52cc75.js` | 173 KB | 54 KB — date utilities + shared UI |
| `framework-0be311c41dba82e4.js` | 190 KB | 60 KB — React + React DOM |
| `main-546af066a9d11528.js` | 135 KB | 39 KB |
| `0479e0de-d9c5e0d1822e27e4.js` | 119 KB | 37 KB — Sentry overlap |
| `polyfills-*.js` | 113 KB | 40 KB |
| **First Load JS shared by all routes** | — | **221 KB** |
| `middleware.js` (server) | 611 KB | **234 KB** |

### Page-level First Load JS (from `next build` output)

| Page | First Load JS | vs target |
|------|--------------|-----------|
| `/book/[officeSlug]` | 400 KB | FAIL (target 150 KB) |
| `/q/[token]` (queue status) | 398 KB | FAIL |
| `/join/[token]` | 377 KB | FAIL |
| `/admin/customers` | 379 KB | FAIL (target 250 KB) |
| `/admin/analytics` | 327 KB | FAIL |
| `/admin/calendar` | 340 KB | FAIL |
| `/admin/bookings` | 330 KB | FAIL |
| `/admin/overview` | 232 KB | MARGINAL |

### Supabase performance advisors

| Advisor | Count |
|---------|-------|
| `multiple_permissive_policies` | 379 (34 tables) |
| `auth_rls_initplan` | 49 (24 tables) |
| `unindexed_foreign_keys` | 45 (24 tables) |
| `unused_index` | 29 indexes |
| `duplicate_index` | 2 |
| `auth_db_connections_absolute` | 1 |

---

## Findings — Top 10 by Impact

### F1. Shared bundle baseline 221 KB gz — Sentry SDK shipped client-side (chunk `6294`, 126 KB gz)

Sentry's client SDK is the single largest contributor to the shared bundle, landing in a chunk that loads on every page including the public booking and queue-status pages. A customer in Dakar on a 3G link (typical throughput 300–500 Kbps) downloads 126 KB just for error monitoring before a single byte of app code renders.

`@sentry/nextjs` wraps the build via `withSentryConfig` in `next.config.ts`. The `sentry.client.config.ts` file initialises the full SDK unconditionally. Sentry should be loaded lazily on error or deferred entirely on low-bandwidth connections.

The same Sentry instrumentation inflates the middleware bundle: `middleware.js` is 611 KB raw / 234 KB gz (reported as 234 KB in build output) because `withSentryConfig` wraps every edge function including the session-refresh middleware.

Files: `apps/web/next.config.ts`, `apps/web/sentry.client.config.ts`, `apps/web/sentry.edge.config.ts`

---

### F2. 49 RLS policies re-evaluate `auth.uid()` per row (auth_rls_initplan)

PostgreSQL cannot hoist a `current_setting()` or `auth.uid()` call that appears inline in a policy expression — it re-runs the function for every row scanned, turning an O(1) lookup into O(n). This affects 24 high-traffic tables including `tickets`, `appointments`, `organizations`, `offices`, `whatsapp_sessions`, `push_subscriptions`, `blocked_slots`, `office_holidays`, and `ticket_events`.

The fix is to wrap the auth call in a subquery: `(SELECT auth.uid())` instead of `auth.uid()`. Postgres then evaluates it once per query. Supabase documents this at https://supabase.com/docs/guides/database/database-linter?lint=0002_auth_rls_initplan

---

### F3. Customers page — `SELECT *` with no server-side pagination

`apps/web/src/app/(dashboard)/admin/customers/page.tsx` (line 8) fetches every customer in the organisation with `.select('*')`. A clinic with 10,000 patient records downloads the entire table — all columns — on every page load. No `LIMIT`, no cursor, no column narrowing. The payload goes over the wire, deserialises in the server component, and the full array is serialised into the RSC payload and sent to the browser again.

The `customers-client.tsx` has a `.limit(20)` for a sub-query but the initial page-level load is uncapped.

---

### F4. Station sync pulls ALL services with no organisation or department filter

`apps/desktop/electron/sync.ts` line 1851:

```
fetch(`.../rest/v1/services?select=id,name,department_id,estimated_service_time`)
```

No `organization_id`, no `department_id` filter. RLS will scope the result set at the Postgres layer but the query still performs a full index scan of the `services` table before RLS prunes rows, and Supabase must serialise and send every row the current JWT is allowed to see. On a multi-tenant platform this will grow with every new customer's service catalogue. This should be `department_id=in.(dept1,dept2,...)` or `organization_id=eq.{orgId}`.

---

### F5. 45 unindexed foreign keys — worst offenders on hot tables

Tables that take the heaviest write and read traffic with unindexed FKs:

- `tickets`: `tickets_customer_id_fkey`, `tickets_desk_id_fkey`, `tickets_service_id_fkey`, `tickets_called_by_staff_id_fkey`, `tickets_transferred_from_ticket_id_fkey`, `tickets_priority_category_id_fkey`
- `ticket_events`: `ticket_events_desk_id_fkey`, `ticket_events_staff_id_fkey`
- `appointments`: `appointments_department_id_fkey`, `appointments_service_id_fkey`, `appointments_staff_id_fkey`, `appointments_recurrence_parent_id_fkey`, `fk_appointment_ticket`
- `whatsapp_sessions`: `whatsapp_sessions_department_id_fkey`, `whatsapp_sessions_office_id_fkey`, `whatsapp_sessions_service_id_fkey`
- `offline_sync_queue`: `offline_sync_queue_ticket_id_fkey`, `offline_sync_queue_desk_id_fkey`, `offline_sync_queue_staff_id_fkey`

Every `JOIN` or `DELETE CASCADE` on these columns does a sequential scan. Given that `ticket_events` is written on every ticket state change, the missing indexes on `desk_id` and `staff_id` will degrade under load.

Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

---

### F6. 379 tables have multiple permissive RLS policies (34 tables)

PostgreSQL ORs all permissive policies together, meaning every policy in the list is evaluated for every row even if an earlier one already grants access. With multiple permissive policies per table, every query over `tickets`, `appointments`, `customers`, `offices`, `desks`, `departments`, `services`, `menu_items`, `menu_categories` etc. evaluates all policies in sequence. Consolidate into a single `USING` expression per role+action.

---

### F7. `createAppointment` fetches the `offices` table twice in sequence

`apps/web/src/lib/actions/appointment-actions.ts`:
- First fetch at line 53: `.from('offices').select('id, organization_id, organization:organizations(id, settings)')`
- Second fetch at line 118: `.from('offices').select('organization:organizations(timezone)')` for the same `officeId`

Both fetches happen serially (the second is inside a `try` block that awaits the first). The timezone is available from the `organizations` join already performed in the first fetch. This doubles the round-trip cost for every new booking — at 200 ms per Supabase RTT on a good connection, this is 400 ms on appointment creation alone.

---

### F8. Low-bandwidth mode does not exist

Zero instances of `NetworkInformation`, `connection.effectiveType`, `navigator.connection`, `saveData`, or `prefers-reduced-data` anywhere in `apps/web`, `apps/desktop`, or `apps/expo`. There is no automatic throttling of image quality, request batching, or deferred non-critical fetches based on connection speed. For 2G/3G markets (Senegal, Côte d'Ivoire, Nigeria, Kenya) this is a first-class gap: the booking flow downloads 400 KB of JS regardless of network quality.

---

### F9. Middleware bundle 234 KB gz on every non-static request

The session middleware (`apps/web/src/middleware.ts`) is 46 lines of logic. Its compiled bundle is 611 KB raw / 234 KB gz because `withSentryConfig` injects the full Sentry edge runtime. This middleware runs on every non-static request (per the `matcher` config). On Vercel Edge, this contributes to cold-start time and is downloaded on every request that isn't cached. The edge Sentry init only needs a tiny error forwarder, not the full SDK.

---

### F10. No cache directives on high-volume public API routes

No route in `apps/web/src/app/api` uses `export const runtime = 'edge'`. No public page uses `export const revalidate`. Routes like `/api/queue-status`, `/api/join-info`, `/api/kiosk-info` are called on every page load by low-bandwidth clients and are server-rendered on demand with no CDN caching. Several internal fetches explicitly set `cache: 'no-store'` even for data that changes at most every few seconds.

---

## Top 10 Easy Wins (1–2 hours each)

### E1. Add `import 'server-only'` to `lib/payments/providers/stripe.ts`

The Stripe provider file does not have a `server-only` guard. While it is currently only imported from API routes and server actions (confirmed — no client component imports it), one accidental import in a `'use client'` file would bundle `stripe@22` (heavy) client-side. Add `import 'server-only'` at line 1 as a hard compile-time barrier. Effort: 2 minutes.

File: `apps/web/src/lib/payments/providers/stripe.ts`

---

### E2. Fix the double `offices` fetch in `createAppointment`

The first fetch already joins `organization:organizations(id, settings)`. Add `timezone` to that join — `.select('id, organization_id, organization:organizations(id, settings, timezone)')` — and read `office.organization.timezone` directly. Remove the second `await supabase.from('offices')` block at lines 115–124. Saves one serial Supabase round-trip (typically 150–250 ms) on every booking creation. Effort: 20 minutes.

File: `apps/web/src/lib/actions/appointment-actions.ts`

---

### E3. Add department filter to Station services sync pull

Change line 1851 of `sync.ts` from:

```
/rest/v1/services?select=id,name,department_id,estimated_service_time
```

to:

```
/rest/v1/services?department_id=in.(${remoteDeptIds.join(',')})&select=id,name,department_id,estimated_service_time
```

`remoteDeptIds` is already populated from the departments pull earlier in the same function. If `remoteDeptIds` is empty, skip the fetch entirely. This scopes the pull to the current org's departments. Effort: 15 minutes.

File: `apps/desktop/electron/sync.ts` line 1851

---

### E4. Drop 29 unused Supabase indexes

Unused indexes cost write amplification and autovacuum time on every `INSERT`/`UPDATE`/`DELETE`. The following have zero recorded reads:

`idx_desktop_connections_support`, `idx_notification_jobs_status_created`, `idx_customers_tags`, `idx_offices_wilaya`, `idx_offices_city`, `idx_tickets_group`, `idx_group_message_recipients_msg`, `idx_group_message_recipients_status`, `idx_organizations_country`, `idx_organizations_vertical`, `idx_customers_city`, `idx_payment_events_status`, `idx_payment_events_provider`, `idx_organizations_stripe_customer_id`, `idx_organizations_stripe_subscription_id`, `idx_organizations_plan_id`, `idx_api_keys_key_hash`, `idx_billing_events_stripe_event_id`, `idx_webhook_deliveries_endpoint_id`, `idx_notification_jobs_pending`, `android_tokens_device_token_idx`, `audit_logs_entity_idx`, `idx_payment_events_purge_eligible`, `template_health_snapshots_template_created_idx`, `restaurant_tables_status_idx`, `idx_offline_sync_pending`, `idx_station_licenses_key`, `sheet_links_auto_sync_idx`, `idx_menu_items_category`

Also drop one of the two duplicate indexes on `google_connections` and `sheet_links`. Effort: 30 minutes to write the migration.

---

### E5. Narrow customers page `SELECT *` to explicit columns

`apps/web/src/app/(dashboard)/admin/customers/page.tsx` line 8. Replace `.select('*')` with only the columns rendered by `CustomersClient`. A `customers` row can have `customer_file` (rich text blob), `notes`, `tags[]`, and other heavy JSONB columns. Selecting only `id, full_name, phone, email, last_visit_at, visit_count, organization_id, status` would cut payload by 60–80% for typical rows. Effort: 30 minutes.

---

### E6. Add `revalidate` to read-heavy public API routes

`/api/queue-status` and `/api/kiosk-info` serve data that changes on ticket events (seconds to minutes). Add `export const revalidate = 5` to allow Vercel's CDN to cache responses for 5 seconds. On peak hours with 50 customers polling `/q/[token]` status, this turns 50 origin hits into 1. Effort: 15 minutes.

---

### E7. Add `export const runtime = 'edge'` to lightweight public API routes

`/api/join-info`, `/api/queue-status`, `/api/kiosk-info` do no file I/O and have no Node.js-only dependencies. Marking them as edge functions reduces cold-start time and routes requests to Vercel's edge PoPs, cutting latency for West Africa by ~80–150 ms compared to the default `iad1` (Virginia) region. Effort: 30 minutes with testing.

---

### E8. Add missing SQLite index on `tickets.appointment_id` for Station query

`main.ts` line 792 queries:

```sql
SELECT id, ticket_number FROM tickets WHERE appointment_id = ? AND status NOT IN ('cancelled','no_show') LIMIT 1
```

A partial unique index already exists (`idx_tickets_appointment_unique`), but it only covers `appointment_id IS NOT NULL AND status NOT IN ('cancelled','no_show')`. Confirm it covers this query path with `EXPLAIN QUERY PLAN`. If the `NOT IN` predicate prevents index use, add a simple `CREATE INDEX IF NOT EXISTS idx_tickets_appt_id ON tickets(appointment_id)` in the migrations section of `db.ts`. Effort: 20 minutes.

File: `apps/desktop/electron/db.ts`

---

### E9. Add missing SQLite indexes for Station hot queries not covered by compound indexes

The following queries run on every ticket operation but are not fully covered by existing indexes:

- `SELECT COUNT(*) FROM tickets WHERE office_id = ? AND status IN ('called','serving')` — covered by `idx_tickets_office_status` only if status is the leading column; verify with `EXPLAIN QUERY PLAN`
- `SELECT COALESCE(MAX(daily_sequence), 0) FROM tickets WHERE department_id = ?` — `idx_tickets_dept` covers `(department_id, status)`, max on a non-indexed expression; add `idx_tickets_dept_seq ON tickets(department_id, daily_sequence)`
- `SELECT COUNT(*) FROM tickets WHERE office_id = ? AND department_id = ? AND status = 'waiting' AND parked_at IS NULL` — the existing `idx_tickets_office_status` index doesn't include `department_id` or `parked_at`; add compound index `(office_id, department_id, status, parked_at)`

Effort: 30 minutes.

---

### E10. Sentry `disableLogger: true` is deprecated — switch to `treeshake.removeDebugLogging`

The build warns: `disableLogger is deprecated and will be removed in a future version`. This deprecation means the tree-shaking path is not guaranteed active. Switching to the supported option ensures Sentry debug logs are correctly excluded from production bundles, saving a few KB. Effort: 5 minutes.

File: `apps/web/next.config.ts`

---

## Gaps — Capabilities Not Implemented at All

### Gap 1: Low-bandwidth mode (HIGH PRIORITY for Africa markets)

No detection, no adaptation. A customer on a Senegal 2G connection (50–100 Kbps effective) downloads 400 KB of JS to view their queue position. Minimum viable implementation:

1. Detect via `navigator.connection.effectiveType` (`'slow-2g'` / `'2g'`) or `navigator.connection.saveData`.
2. When slow: skip loading Sentry client SDK, defer non-critical scripts, serve lower-quality images.
3. The booking and queue-status pages are the most critical targets — those are the pages real customers in West Africa open on mobile.

---

### Gap 2: Image optimisation on customer-facing pages

The web app does not use Next.js `<Image>` on any user-facing page. The only `<img>` tags found are for QR code data URLs (which are SVGs — fine). However, organisation logo URLs are loaded via raw `<img src={logoUrl}>` or inline CSS backgrounds in kiosk and display pages — no `srcset`, no WebP/AVIF, no lazy-load. On a 3G link a 200 KB PNG logo blocks the above-the-fold render. Missing: `next/image` with `priority={false}` below fold, `sizes` attribute, and WebP/AVIF format.

---

### Gap 3: Edge caching on public API routes

Every call to `/api/queue-status`, `/api/kiosk-info`, `/api/join-info` goes to a full Node.js Lambda cold-start in Virginia. These routes are hammered by:
- Customers polling their queue position (every 10–30 seconds)
- Kiosks loading on every tablet unlock
- Display boards refreshing

None have `export const revalidate`, `export const runtime = 'edge'`, or HTTP `Cache-Control` headers. Adding both edge runtime and stale-while-revalidate headers on these routes would be the highest-leverage single change for West African latency (Vercel has a Johannesburg PoP).

---

### Gap 4: List virtualisation

No react-window, react-virtual, or equivalent is installed or used anywhere. The customers page in the web dashboard passes the entire customer array (potentially thousands of rows) to the client component which renders all rows into the DOM. The Station `CustomersModal` also renders all customers with `.map()`. For clinics with thousands of patient records (a primary Qflo vertical), this causes jank on every scroll event and high memory usage on low-end Android devices used by operators.

---

### Gap 5: Supabase `multiple_permissive_policies` on 34 tables

No table has had its permissive policies consolidated. PostgreSQL evaluates all permissive policies with OR, meaning a table with three permissive SELECT policies runs three policy checks per row. With 379 instances across 34 tables, every dashboard query pays this tax. The mitigation is to merge the `USING` expressions into a single policy per role+action.

---

### Gap 6: Auth connection pool ceiling

The single `auth_db_connections_absolute` advisor reports the Supabase Auth server is capped at 10 connections. Scaling the instance without manually adjusting this value has no effect on Auth throughput. Under load (simultaneous logins from kiosk + web + mobile), Auth will queue. This needs a manual setting change in the Supabase Auth configuration.

---

## Notes on What is Working Well

- Station SQLite compound indexes cover the main hot paths: `(office_id, status)`, `(department_id, status)`, `sync_queue` partial index on pending rows.
- Sync engine has proper exponential backoff (2s → 5s → 15s), circuit breaker, and debounce on realtime events (line 377).
- Tickets pull is correctly scoped: active tickets fetched in full, historical limited to last 48 hours.
- Realtime subscriptions are cleaned up on unmount in all inspected components (`display-board.tsx`, `queue-status.tsx`, `group-status.tsx`, `booking-form.tsx`, `licenses.tsx`). No hoarded channels found.
- No client-side Stripe SDK leak found — `stripe.ts` is only imported from API routes and server actions.
- No moment.js, full lodash, or framer-motion found — clean dependency list.
- The `polyfills` chunk at 40 KB gz is expected for broad browser support.
- Overview page uses `Promise.all` for its 5 parallel queries — no waterfall there.
- Station sync services pull has `AbortSignal.timeout(10000)` protecting against hangs.
