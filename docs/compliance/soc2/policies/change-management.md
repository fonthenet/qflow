# Change Management Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** CC8.1  
**Review Cadence:** Annual  
**Evidence Artifact:** GitHub PR history; CI run logs; quarterly change sample at `docs/compliance/evidence/change-log/YYYY-QN.md`  

---

## Purpose

Ensure all changes to production systems are reviewed, tested, and approved before deployment, reducing the risk of unauthorized or error-prone changes.

## Scope

All changes to: application code, infrastructure configuration (Vercel, Supabase), database schema, CI/CD pipelines, and security-relevant dependencies.

## Controls

| Control | Implementation |
|---|---|
| No direct push to `main` | GitHub branch protection rule: require PR + 1 approving review |
| CI must pass | GitHub Actions required status checks block merge on failure |
| Dependency pinning | `package-lock.json` committed; Dependabot PRs reviewed before merge |
| Secrets never in code | GitHub secret scanning enabled; `.env` in `.gitignore` |
| Database migrations | Migration files committed to repo; applied via documented runbook; logged |
| Emergency hotfix | Allowed via CTO override; post-hoc review PR opened within 24h and noted in change log |

## Deployment Process

1. Feature branch opened from `main`.
2. PR created; CI runs (lint, type-check, tests).
3. One approval required (team size < 5 exception noted — LAWYER REVIEW REQUIRED to confirm auditor acceptance).
4. Merge to `main` triggers Vercel production deploy.
5. Deployer monitors Sentry for post-deploy error spike for 30 minutes.

## Quarterly Change Sampling

For audit evidence, a sample of 10 PRs per quarter is documented in `docs/compliance/evidence/change-log/YYYY-QN.md`, confirming each had a passing CI run and at least one review.

---

*To confirm with counsel: whether single-approver PRs are acceptable under CC8 for a startup-stage team, or whether compensating controls are required.*
