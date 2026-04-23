# Access Control Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** CC6.1, CC6.2, CC6.3, CC6.6, CC6.7  
**Review Cadence:** Quarterly access reviews; policy annually  
**Evidence Artifact:** `docs/compliance/evidence/access-reviews/YYYY-MM.md` (monthly)  

LAWYER REVIEW REQUIRED before first audit submission.

---

## Purpose

Ensure that access to Qflo production systems, databases, and code repositories is granted, reviewed, and revoked in a controlled, documented manner.

## Multi-Factor Authentication (MFA)

- MFA required for all personnel accessing: GitHub, Vercel dashboard, Supabase dashboard, Sentry, Stripe dashboard.
- Authenticator app (TOTP) or hardware key required. SMS-based MFA is not acceptable.
- Enforcement: organization-level MFA enforcement enabled in each provider's admin console.
- Evidence: monthly screenshot of MFA enforcement status per platform in `docs/compliance/evidence/access-reviews/`.

## Just-In-Time (JIT) Access

- Elevated database access (direct Postgres, Supabase Service Role key) is not granted persistently to individuals.
- Any break-glass access to production DB is requested, time-boxed (max 4 hours), approved by a second team member, and logged with the justification in the incident/access log.
- Supabase Row-Level Security (RLS) enforced on all customer-facing tables as the primary data access control layer.

## Provisioning

| System | Provisioning process |
|---|---|
| GitHub | CTO adds member; role = Maintainer minimum; no outside collaborators on private repos without approval |
| Vercel | CTO adds member; environment variable access restricted to Owners |
| Supabase | CTO adds member; dashboard access via project member invite; RLS enforced |
| Sentry | CTO adds member; project scoped |
| Stripe | CTO adds member; restricted keys only in production |

## Deprovisioning

Access must be revoked within 24 hours of employment termination or role change. Checklist maintained in offboarding runbook (to be created; evidence location: `docs/compliance/evidence/access-reviews/offboarding-log.md`).

## Quarterly Access Reviews

- Performed by CTO every quarter (January, April, July, October).
- Review covers: all systems above, confirming each user's access is still appropriate.
- Output filed at `docs/compliance/evidence/access-reviews/YYYY-MM.md`.
- Stale or excess access revoked immediately and noted in the review record.

---

*To confirm with counsel: whether quarterly cadence satisfies CC6 continuous monitoring requirement or if automated drift detection (Vanta/Drata) is also required.*
