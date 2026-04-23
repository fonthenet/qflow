# Qflo Global Compliance Register

Last updated: 2026-04-23
Owner: Compliance Officer (qflo-compliance-officer agent)

> This is a living document. Update status after each sprint or compliance activity.

---

## Scope

Qflo operates across 13 seeded countries: Algeria (DZ), Morocco (MA), Tunisia (TN), France (FR), Egypt (EG), United Arab Emirates (AE), Saudi Arabia (SA), India (IN), Senegal (SN), Côte d'Ivoire (CI), Nigeria (NG), Kenya (KE), United States (US).

---

## Core Compliance Items

| Item | Status | Owner | Evidence / Notes |
|---|---|---|---|
| Privacy Policy (EN) | Done | Compliance | `/apps/web/src/app/(public)/privacy/page.tsx` |
| Privacy Policy (FR/AR translation keys) | Done | Compliance | `/src/lib/i18n/messages.ts` — privacy keys added |
| Cookie Banner (GDPR-compliant) | Done | Compliance | `/apps/web/src/components/CookieBanner.tsx` |
| Cookie consent respects analytics flag | Done | Compliance | Root layout gates Vercel Analytics on consent |
| DPA Template (EN) | Done — Lawyer review pending | Compliance | `/docs/legal/data-processing-agreement.md` |
| Admin Privacy Settings page | Done | Compliance | `/admin/settings/privacy` |
| Data Retention Policy documented | Done | Compliance | DPA Annex C; referenced in privacy policy |
| Sub-processor list documented | Done | Compliance | DPA Annex A |

## Country Addendums

| Country | Law | Status | File |
|---|---|---|---|
| Algeria | Loi 18-07 | Done | `/docs/legal/addendums/dz-loi-18-07.md` |
| Morocco | Loi 09-08 | Done | `/docs/legal/addendums/ma-loi-09-08.md` |
| Tunisia | Loi 2004-63 | Done | `/docs/legal/addendums/tn-loi-2004-63.md` |
| France | GDPR + CNIL | Done | `/docs/legal/addendums/fr-cnil.md` |
| Egypt | Law 151/2020 | Done | `/docs/legal/addendums/eg-data-protection-law.md` |
| UAE | PDPL 2021 | Done | `/docs/legal/addendums/ae-pdpl-2021.md` |
| Saudi Arabia | PDPL | Done | `/docs/legal/addendums/sa-pdpl.md` |
| India | DPDP Act 2023 | Done | `/docs/legal/addendums/in-dpdp-2023.md` |
| Senegal | Loi 2008-12 | Done | `/docs/legal/addendums/sn-loi-2008-12.md` |
| Côte d'Ivoire | Loi 2013-450 | Done | `/docs/legal/addendums/ci-loi-2013-450.md` |
| Nigeria | NDPA 2023 + NDPR | Done | `/docs/legal/addendums/ng-ndpr.md` |
| Kenya | DPA 2019 | Done | `/docs/legal/addendums/ke-dpa-2019.md` |
| United States | CCPA/CPRA + state patchwork | Done | `/docs/legal/addendums/us-ccpa-colo.md` |

## Open Lawyer-Review Items

1. DPA Annex A (SCCs) — SCCs must be separately executed as signed instruments; verify correct module per transfer scenario.
2. DPA governing law clause — must be tailored per customer jurisdiction.
3. Algeria cross-border transfer — ANPDP adequacy decision for EU not confirmed; local counsel required.
4. Egypt PDPC adequacy decisions — none published; cross-border transfer risk is material.
5. UAE PDPL adequacy list — not yet published; cross-border transfer safeguards needed.
6. KSA PDPL cross-border transfers — SDAIA approval required; local counsel required.
7. Nigeria NDPC adequacy list — not yet published; SCCs recommended.
8. India DPDP Rules — Rules not yet finalized as of April 2026; monitor MeitY publications.
9. UK IDTA — must be separately executed for UK data transfers (not in scope yet but flag for EU customers with UK operations).
10. Healthcare vertical (HIPAA) — deferred until first healthcare prospect in the US; BAA template needed at that point.

## Follow-up Actions (Non-blocking for v1 launch)

- [x] DPO contact email updated to `privacy@qflo.app` (Qflo SAS). Postal address still `{{COMPANY_ADDRESS}}` — see `docs/legal/README.md`.
- [x] Data export endpoint live at `/api/compliance/export` (30-day rate limit, org-scoped, JSON bundle). Delete endpoint at `/api/compliance/delete` (soft-delete + PII minimization, 14-day grace period).
- [ ] SOC 2 Type II audit initiation — target date TBD.
- [ ] Vanta / Drata integration for evidence collection.
- [ ] GPC (Global Privacy Control) signal detection for US Colorado compliance.
- [ ] Subject Access Request (SAR) intake workflow in dashboard.
- [ ] Invoice / VAT format compliance per country (separate track — see payment integrator).
- [ ] Payment processor licensing per country (Algeria BoC, Morocco BAM) — coordinate with payment integrator.
- [ ] CNIL DPO registration for French enterprise tenants at scale.
- [ ] NDPC (Nigeria) / ODPC (Kenya) processor registration.
