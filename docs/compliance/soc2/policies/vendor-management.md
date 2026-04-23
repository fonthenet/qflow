# Vendor Management Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** CC9.1, CC9.2  
**Review Cadence:** Annual vendor security review  
**Evidence Artifact:** `docs/compliance/evidence/vendor-reviews/YYYY.md`  

LAWYER REVIEW REQUIRED — DPA / BAA status for each vendor must be verified by counsel.

---

## Purpose

Ensure that subprocessors and critical vendors meet Qflo's security and privacy standards and that appropriate contractual protections are in place.

## Critical Vendor Register

| Vendor | Role | Data Processed | DPA / Contract Status | SOC 2 / Cert |
|---|---|---|---|---|
| **Supabase** | Database, Auth, Storage (EU region) | All customer PII, queue data, org data | DPA accepted via Supabase ToS — LAWYER REVIEW REQUIRED to confirm adequacy for GDPR Art. 28 | SOC 2 Type II (verify currency annually) |
| **Vercel** | Web hosting, CDN, serverless functions | Request logs, session tokens | DPA available — confirm signed/accepted | SOC 2 Type II |
| **Stripe** | Payment processing | Payment card data (Stripe-tokenised, not stored by Qflo) | Stripe MSA + DPA; PCI DSS Level 1 | PCI DSS L1 + SOC 2 |
| **Meta (Facebook)** | WhatsApp Cloud API, Messenger | Message content, customer phone numbers | Meta Cloud API ToS + Data Processing Terms — LAWYER REVIEW REQUIRED | ISO 27001 |
| **Sentry** | Error monitoring | Stack traces, partial request data; PII scrubbing config required | DPA available — confirm signed | SOC 2 Type II |

## Vendor Onboarding Requirements

Before adding a new subprocessor that will process customer PII:
1. Verify the vendor holds SOC 2 Type II (or equivalent) certification.
2. Execute a signed DPA or confirm ToS-incorporated DPA is adequate (LAWYER REVIEW REQUIRED for the latter).
3. Add to the register above.
4. Update Qflo Privacy Policy subprocessor list.
5. Notify existing customers if the DPA requires subprocessor change notification.

## Annual Review

Each January, the CTO reviews:
- Current SOC 2 / certification status for each vendor (pull latest audit report).
- Any material changes to vendor ToS or data handling practices.
- Whether any vendor is being replaced or added.

Results documented at `docs/compliance/evidence/vendor-reviews/YYYY.md`.

---

*To confirm with counsel: whether Supabase ToS-incorporated DPA is sufficient for GDPR Art. 28, or whether a separately-signed DPA is required.*
