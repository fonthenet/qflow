---
name: pre-release-audit
description: Run security + QA + compliance + accessibility checks in parallel before any Station or web release. Blocks release on critical findings. Use before every version bump or deploy.
disable-model-invocation: true
---

Run a pre-release audit spawning specialist agents in parallel.

## Steps

Launch these agents concurrently (single message, multiple Agent tool calls):

1. **`qflo-security-reviewer`** — full checklist: auth, RLS, webhooks, payments, IPC, secrets, SQLi, XSS, dependencies.
2. **`qflo-qa-engineer`** — run full test suite + typecheck; verify critical UI flows via preview_* tools.
3. **`qflo-compliance-officer`** — check any regulatory blockers for currently targeted launch regions.
4. **`qflo-accessibility-auditor`** — WCAG 2.1 AA check on changed surfaces.
5. **`qflo-performance-engineer`** — bundle size + key query advisors.

## Consolidate

Collect each specialist's report. Produce a single release-gate document:

```
## Pre-release audit: <feature/version>

### Blocking issues (must fix before release)
- [severity] · [specialist] · [issue] · [file:line]

### Non-blocking concerns
- ...

### Passed checks
- qflo-security-reviewer: ...
- qflo-qa-engineer: ...
- ...

### Decision: SHIP / HOLD
```

If ANY blocking issue exists → decision is HOLD. Report the exact remediation path. Do not pressure-release.

Do not skip any specialist. Do not declare "ship" without all 5 reports.
