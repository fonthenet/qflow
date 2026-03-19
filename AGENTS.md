# Qflo Repo Rules

## End-to-End Wiring Rule

Every change must be fully wired end to end before it is considered complete.

This includes, whenever relevant:

- UI and user-facing flows
- server actions and business logic
- API handlers and route behavior
- Supabase reads, writes, queries, and schema expectations
- public URLs and navigation paths
- dashboard/admin entry points
- sandbox parity for mirrored features
- template-aware runtime resolution
- permissions and role behavior
- copy, labels, and empty states

Do not stop at a visual change or partial implementation.

If something is added, replaced, changed, modified, or removed, verify that all connected layers are updated too.

Examples:

- If a booking flow changes, make sure booking creation, edits, cancellation, tracking, sandbox, and related URLs still work.
- If a template changes, make sure onboarding, runtime resolution, sandbox, desk, kiosk, display, and public join stay aligned.
- If a new business rule is introduced, make sure dashboard behavior, public behavior, server enforcement, and Supabase data handling match.
- If a new route or action is added, make sure navigation, permissions, and failure states are handled.

## Sandbox Mirror Rule

Any business-facing or customer-facing runtime change should be mirrored in sandbox when that surface is supported there.

Current mirrored surfaces include:

- booking
- kiosk
- desk
- queue
- display

Sandbox should reuse the real runtime components whenever possible, with sandbox-safe data and actions instead of live writes.

## Completion Standard

A change is not complete unless:

- the real flow works
- the connected data layer works
- the relevant URL or route works
- the related business logic is enforced
- sandbox is updated where applicable
- validation has been run without disrupting the user's active dev server unnecessarily
