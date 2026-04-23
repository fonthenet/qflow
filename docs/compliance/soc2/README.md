# SOC 2 Type II — Kickoff Packet

**Product:** Qflo  
**Target audit period:** TBD (recommend 6-month window starting once controls are live)  
**Control framework:** AICPA Trust Services Criteria (2017)  
**Compliance tool (to decide):** Vanta or Drata — selection pending  
**Audit firm:** TBD — LAWYER REVIEW REQUIRED to engage a licensed CPA firm  

---

## Scope Boundary

| Component | In Scope |
|---|---|
| Qflo web app (Vercel) | Yes |
| Qflo Station (Electron, on-prem) | Yes |
| Supabase (Postgres + Auth + Storage) | Yes (subprocessor) |
| Stripe | Yes (subprocessor, PCI handled by Stripe) |
| Meta Cloud API | Yes (subprocessor) |
| Sentry | Yes (subprocessor) |
| Customer on-prem hardware (kiosk) | Out of scope |

## Criteria Targeted

- CC1 — Control Environment
- CC2 — Communication and Information
- CC3 — Risk Assessment
- CC4 — Monitoring
- CC5 — Control Activities
- CC6 — Logical and Physical Access
- CC7 — System Operations
- CC8 — Change Management
- CC9 — Risk Mitigation / Vendor Management
- A1 — Availability
- C1 — Confidentiality

## Policy Index

| Policy | File | TSC Criteria |
|---|---|---|
| Information Security | `policies/information-security.md` | CC1, CC2, C1 |
| Access Control | `policies/access-control.md` | CC6 |
| Incident Response | `policies/incident-response.md` | CC7 |
| Change Management | `policies/change-management.md` | CC8 |
| Vendor Management | `policies/vendor-management.md` | CC9 |
| Risk Assessment | `policies/risk-assessment.md` | CC3, CC4 |
| Business Continuity | `policies/business-continuity.md` | A1 |
| Data Classification | `policies/data-classification.md` | C1 |

## Evidence Folder Layout

```
docs/compliance/evidence/
  access-reviews/YYYY-MM.md   — monthly access review records
  pen-tests/YYYY.md           — annual penetration test results
  vendor-reviews/YYYY.md      — annual vendor security reviews
  incident-log/YYYY.md        — incident post-mortems
  change-log/YYYY-QN.md       — quarterly change sampling
  backup-drills/YYYY.md       — restore drill results
```

## Next Steps

1. Choose Vanta or Drata and connect integrations (GitHub, Vercel, Supabase, Sentry, Stripe).
2. Complete policy owner sign-off (CTO signature on each policy).
3. Run first access review (template: `docs/compliance/evidence/access-reviews/`).
4. Engage audit firm — LAWYER REVIEW REQUIRED.
5. Set audit period start date and freeze scope.
