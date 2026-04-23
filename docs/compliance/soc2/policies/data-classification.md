# Data Classification Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** C1.1, C1.2, CC6.1  
**Review Cadence:** Annual or when a new data field is collected  
**Evidence Artifact:** This document; updated on each new field addition  

---

## Purpose

Define how Qflo classifies data it processes, so that appropriate controls, retention, and handling rules can be applied consistently.

## Classification Tiers

### Tier 1 — Confidential (highest sensitivity)

Data that, if disclosed, could directly harm individuals or Qflo's legal standing.

| Data Element | Source | Storage | Retention |
|---|---|---|---|
| Customer full name + phone number | Booking / WhatsApp intake | Supabase (EU region, RLS-protected) | Deleted on erasure request or org offboarding |
| Appointment history | Booking flow | Supabase | 3 years default; per-jurisdiction overrides apply |
| Payment metadata (non-card) | Stripe webhook | Supabase | 7 years (tax / accounting obligation) |
| Auth tokens / session JWTs | Supabase Auth | Memory / short-lived cookie | Expiry 1 hour; no persistent storage in Station |
| WhatsApp / Messenger message content | Meta Cloud API webhook | Supabase (transient, for display only) | 90 days then purged |

### Tier 2 — Internal

Data used for operations, not directly identifying.

| Data Element | Examples |
|---|---|
| Aggregate queue metrics | Wait-time averages, throughput counts |
| System logs | Sentry error traces (PII scrubbed before ingestion) |
| Configuration | Org settings, station locale config |

### Tier 3 — Public

Data intentionally made public.

| Data Element | Examples |
|---|---|
| Organisation name | Displayed on kiosk welcome screen |
| Service list | Displayed to walk-in customers |

## Handling Rules

| Tier | Encryption at rest | Encryption in transit | Access control | Backup | Logging |
|---|---|---|---|---|---|
| 1 | Required (Supabase AES-256) | Required (TLS 1.2+) | RLS + least privilege | Daily backup | All access logged |
| 2 | Required | Required | Role-based | Daily backup | Selective |
| 3 | Standard | Required | Public | N/A | None required |

## New Field Addition Process

When any new personal data field is collected:
1. Add to Tier 1 table above.
2. Update Privacy Policy subprocessor / data map section.
3. Assess whether new field triggers additional consent or legal basis requirements.
4. Update DPA Annex I (data categories) before presenting DPA to new customers.

LAWYER REVIEW REQUIRED if new field involves special-category data (health, biometric, religion, etc.).

---

*To confirm with counsel: retention period of 3 years for appointment history — verify against shortest applicable jurisdiction statute.*
