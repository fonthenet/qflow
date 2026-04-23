# Business Continuity & Disaster Recovery Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** A1.2, A1.3, CC7.5  
**Review Cadence:** Annual; restore drill at least annually  
**Evidence Artifact:** `docs/compliance/evidence/backup-drills/YYYY.md`  

---

## Purpose

Ensure Qflo can recover from system failures, data loss events, and major incidents within defined recovery objectives.

## Recovery Objectives

| System | RTO (Recovery Time) | RPO (Recovery Point) |
|---|---|---|
| Qflo web app (Vercel) | < 1 hour (Vercel instant rollback) | N/A — stateless |
| Supabase database | < 4 hours | 24 hours (daily backup) |
| Qflo Station (on-prem) | < 8 hours (reinstall from latest installer) | Local SQLite: no cloud backup — data loss risk accepted for local-only data |

## Supabase Backup & Restore

- Supabase performs automated daily backups on paid plans.
- Point-in-time recovery (PITR) enabled on production project — confirm current plan includes PITR.
- Restore procedure: documented at `docs/compliance/evidence/backup-drills/restore-runbook.md` (to create).

## Annual Restore Drill

Each year the CTO:
1. Provisions a test Supabase project.
2. Restores from the most recent backup.
3. Verifies data integrity with a sample query set.
4. Documents the drill result (success/failure, duration, issues) at `docs/compliance/evidence/backup-drills/YYYY.md`.

## Vercel Rollback

In the event of a failed deployment, Vercel instant rollback is used:
- Access Vercel dashboard > Deployments > select prior deployment > Promote to Production.
- Target rollback time: < 15 minutes.

## Communication During Outage

- Status updates posted to internal Slack (or equivalent) every 30 minutes during P1 incidents.
- Customer communication template maintained in `docs/legal/breach-notification-templates/` (pending creation).

---

*To confirm with counsel: whether A1 availability commitments should be reflected in customer-facing SLA or Terms of Service.*
