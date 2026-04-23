---
name: a11y-audit
description: Run an accessibility audit (WCAG 2.1 AA) across customer-facing surfaces — web, Station kiosk, mobile. Especially for kiosk mode (US ADA litigation risk) and EU Accessibility Act.
argument-hint: [surface]
disable-model-invocation: true
---

Run an accessibility audit on `$ARGUMENTS` (e.g. "kiosk", "booking page", "customer mobile app", or "all" for full sweep).

## Steps

1. **Delegate to `qflo-accessibility-auditor`** with the scope:
   - Full WCAG 2.1 AA checklist (keyboard, screen reader, contrast, ARIA, touch, semantic HTML, RTL).
   - Run axe-core or equivalent via `preview_eval`.
   - Keyboard-only walkthrough of all interactive elements.
   - Contrast check on light + dark themes.
   - RTL check on Arabic locale.

2. **Review findings**:
   - Blocking: WCAG AA violations → must fix before any release that touches affected surfaces.
   - Advisory: AAA nice-to-haves → backlog.

3. **Delegate fixes** back to the owning engineer:
   - Web surfaces → `qflo-web-engineer`.
   - Station / kiosk → `qflo-station-engineer`.
   - Mobile → `qflo-mobile-engineer`.

4. **Re-audit after fixes** — never close a finding without re-running the check.

5. **Report**: blocking count / advisory count, remediation PRs / commits, residual risk.

US kiosk mode has ADA lawsuit precedent — do not ship without passing.
