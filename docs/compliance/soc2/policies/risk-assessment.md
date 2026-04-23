# Risk Assessment Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** CC3.1, CC3.2, CC3.3, CC4.1, CC4.2  
**Review Cadence:** Annual; ad-hoc on material change (new region, new vertical, new vendor)  
**Evidence Artifact:** `docs/compliance/evidence/risk-register-YYYY.md`  

---

## Purpose

Identify, assess, and treat risks to the confidentiality, integrity, and availability of Qflo systems and customer data.

## Risk Register Format

Each identified risk is recorded with:
- **Risk ID** — sequential (R-001, R-002, …)
- **Description** — what could go wrong
- **Likelihood** — Low / Medium / High
- **Impact** — Low / Medium / High
- **Inherent Risk** — Likelihood x Impact
- **Controls** — existing mitigations
- **Residual Risk** — after controls
- **Treatment** — Accept / Mitigate / Transfer / Avoid
- **Owner** — CTO or named role
- **Review date**

## Starter Risk Themes (to be expanded annually)

| Risk | Current Treatment |
|---|---|
| Supabase outage / data loss | Mitigate — daily backups, restore drill annually (see `business-continuity.md`) |
| Credential compromise | Mitigate — MFA on all systems, JIT access policy |
| Data residency violation (EU data leaving EU) | Mitigate — Supabase EU region locked; SCCs for Meta Cloud API |
| Regulatory non-compliance (new jurisdiction) | Mitigate — compliance checklist per region before first customer |
| Insider threat | Mitigate — access reviews, least privilege, offboarding runbook |
| Dependency vulnerability | Mitigate — Dependabot + CI block on high-severity CVEs |
| WhatsApp/Meta service discontinuation | Accept — contingency plan to add additional messaging channel |

## Monitoring

- Sentry alerts reviewed weekly by CTO.
- GitHub Dependabot alerts reviewed and remediated within 7 days (critical) / 30 days (high).
- Supabase anomaly logs reviewed monthly.
- External vulnerability scan: annually (pen test) — evidence at `docs/compliance/evidence/pen-tests/`.

---

*To confirm with counsel: whether this risk assessment cadence and format satisfies CC3/CC4 evidence requirements for the chosen audit firm.*
