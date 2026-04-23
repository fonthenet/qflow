---
name: add-integration
description: Scaffold a new third-party integration (Google Reserve, Zapier, Square, Toast, QuickBooks, Google Calendar, HubSpot, etc.) behind the Integration interface. Includes OAuth, webhook signing, rate limiting, dead-letter queue.
argument-hint: <provider-slug>
disable-model-invocation: true
---

Add integration `$ARGUMENTS` to Qflo.

## Steps

1. **Delegate to `qflo-integrations-engineer`**:
   - Read provider API docs (WebFetch).
   - Design entity mapping (Qflo → provider) and document in `docs/integrations/$ARGUMENTS.md`.
   - Implement behind the existing `Integration` interface. If the interface doesn't exist, flag to `qflo-architect` first — do NOT fork.
   - OAuth connect flow in settings.
   - Outbound webhook signing for events we push to customer webhooks.
   - Rate limit per provider's published limits.
   - Retry with backoff + dead-letter queue for permanent failures.
   - Country gating: does this provider only make sense in certain countries/verticals? If yes, UI surface gates on `org.country` + `org.vertical`.

2. **Delegate to `qflo-migration-writer`**: schema for `integration_config` / OAuth tokens (encrypted at rest).

3. **Delegate to `qflo-security-reviewer`**: audit credential storage + signature verification.

4. **Delegate to `qflo-qa-engineer`**: mock provider + assertion tests, end-to-end OAuth flow.

5. **Delegate to `qflo-marketing-writer`**: announce the integration on the marketing site.

## Rules

- OAuth over long-lived API keys where possible.
- Secrets encrypted at rest; short-lived tokens + refresh.
- Refund/rollback path for any integration that writes back.
- No SMS integrations (user directive).

Report: adapter shipped, OAuth flow working, tests passing, marketing page drafted.
