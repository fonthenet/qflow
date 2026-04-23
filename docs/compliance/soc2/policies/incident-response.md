# Incident Response Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** CC7.3, CC7.4, CC7.5  
**Review Cadence:** Annual; tested by tabletop exercise  
**Evidence Artifact:** `docs/compliance/evidence/incident-log/YYYY.md`  

LAWYER REVIEW REQUIRED — breach notification SLAs and notification templates must be reviewed by counsel before use.

---

## Purpose

Ensure Qflo can detect, contain, eradicate, and recover from security incidents, and meet regulatory breach-notification obligations across all active jurisdictions.

## Severity Classification

| Severity | Definition | Example |
|---|---|---|
| P1 — Critical | Confirmed data breach or service down >1h | Unauthorized DB access, prod outage |
| P2 — High | Suspected breach, partial outage, significant vulnerability | Anomalous API access, RLS misconfiguration found |
| P3 — Medium | Policy violation, non-exploited vulnerability | Leaked non-prod credential, failed MFA |
| P4 — Low | Near-miss, suspicious event | Port scan detected |

## Response Phases

1. **Detect** — Sentry alerts, Supabase anomaly logs, customer report. On-call: CTO.
2. **Contain** — Revoke affected credentials, enable maintenance mode if needed. Target: within 1 hour of detection for P1.
3. **Assess** — Determine scope of affected data (categories, record count, jurisdictions).
4. **Notify** — Trigger regulatory notifications per table below.
5. **Eradicate / Recover** — Root cause fixed, systems restored, post-mortem written.
6. **Post-mortem** — Filed within 5 business days at `docs/compliance/evidence/incident-log/`.

## Breach Notification SLAs

| Jurisdiction | Regulatory SLA | Authority | Customer Notice |
|---|---|---|---|
| EU / UK (GDPR) | 72 hours to DPA from awareness | Lead supervisory authority | Without undue delay if high risk to individuals |
| Algeria (Loi 18-07) | To confirm with counsel | ANPDP (to be established) | To confirm with counsel |
| Morocco (Loi 09-08) | To confirm with counsel | CNDP | To confirm with counsel |
| India (DPDP 2023) | To confirm with counsel — draft rules pending | DPBI | To confirm with counsel |
| US / California (CCPA) | Expedient / no fixed clock for regulator; 45 days to consumer | California AG | 45 days |

LAWYER REVIEW REQUIRED for Algeria, Morocco, India SLAs and notification template wording.

## Notification Template Location

Draft templates to be created at `docs/legal/breach-notification-templates/` (pending lawyer review).

## Tabletop Exercise

Annual tabletop exercise conducted by CTO + at least one other team member. Evidence filed at `docs/compliance/evidence/incident-log/tabletop-YYYY.md`.

---

*To confirm with counsel: whether "awareness" clock for GDPR 72h starts at first suspicion or confirmed determination.*
