# Information Security Policy

**Version:** 1.0 — 2026-04-23  
**Control Owner:** CTO  
**TSC Criteria:** CC1.1, CC1.2, CC2.1, C1.1  
**Review Cadence:** Annual or on material change  
**Evidence Artifact:** This signed document + Vanta/Drata policy attestation record  

LAWYER REVIEW REQUIRED before first audit submission.

---

## Purpose

Define the minimum security baseline for all Qflo systems, personnel, and subprocessors to protect customer data confidentiality, integrity, and availability.

## Scope

All Qflo production systems, development tooling, CI/CD pipelines, and personnel with access to production or customer data.

## Principles

1. **Least privilege** — access granted only to the minimum set required for the role.
2. **Defense in depth** — multiple independent controls at network, application, and data layers.
3. **Encryption in transit and at rest** — TLS 1.2+ for all data in transit; AES-256 at rest (Supabase-managed).
4. **Audit trail** — all administrative actions logged and retained for 12 months.

## Key Controls

| Control | Implementation |
|---|---|
| Encryption in transit | TLS 1.2+ enforced by Vercel and Supabase |
| Encryption at rest | Supabase AES-256 managed keys |
| Secrets management | Environment variables in Vercel; no secrets in git |
| Dependency scanning | GitHub Dependabot + CI block on high-severity CVEs |
| Security training | Annual security awareness training for all employees (evidence: completion records) |
| Background checks | Performed on all employees with production access |

## Policy Violations

Violations must be reported to the CTO immediately and logged as an incident per `incident-response.md`.

---

*To confirm with counsel: classification of this policy as sufficient for CC1 "tone at the top" requirement.*
