---
name: add-vertical
description: Scaffold a new vertical overlay (e.g. pharmacy, veterinary, embassy) — label overrides, default settings, optional modules. Use when onboarding a new business vertical.
argument-hint: <vertical-slug>
disable-model-invocation: true
---

Add the vertical `$ARGUMENTS` (e.g. `pharmacy`, `veterinary`, `embassy`, `telecom-shop`, `public-service`, `bank`, `government`).

## Steps

1. **Delegate to `qflo-architect`** for design:
   - What label overrides does this vertical need? (e.g. `table` → `counter` for bank, `room` for clinic)
   - What optional modules? (medical record ID for clinic, service menu for salon, table map for restaurant)
   - What default settings? (default booking duration, default ticket fields)
   - Any vertical-specific analytics cards?

2. **Delegate to `qflo-migration-writer`**:
   - Add `$ARGUMENTS` to the `verticals` enum/registry if one exists, or create it.
   - Any vertical-specific optional tables (e.g. `medical_records` for clinic) — use nullable FK pattern, not separate schemas.

3. **Delegate to `qflo-web-engineer`** + **`qflo-station-engineer`**:
   - Wire vertical overlay rendering: labels, default settings, module visibility.
   - Coordinate with `qflo-i18n-specialist` for localized labels in all active locales.

4. **Delegate to `qflo-marketing-writer`**:
   - Draft a `/verticals/$ARGUMENTS` landing page section.

5. **Test**: create a test org with `vertical: $ARGUMENTS` and confirm:
   - Labels match overrides
   - Irrelevant modules hidden
   - Vertical-specific modules visible
   - Default settings applied

6. **Report** scope of changes + what was deferred.

Follow the invariant: one shared data model, vertical overlays only adjust labels/defaults/optional modules — never forked tables per vertical.
