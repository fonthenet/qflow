---
name: add-locale
description: Seed a new locale translation pack (ES/DE/IT/PT/HI/ID/JA/KO/VI/etc.) across web and desktop apps. Adds file, marks every entry TODO, wires into i18n registry. Use when launching a region needing a new language.
argument-hint: <lang-code>
disable-model-invocation: true
---

Seed the locale `$ARGUMENTS` (e.g. `es`, `de`, `pt-BR`, `hi`, `id`, `ja`, `ko`, `vi`).

## Steps

1. **Delegate to `qflo-i18n-specialist`** agent with this brief:
   - Read `apps/desktop/src/lib/i18n.ts` as the master key list.
   - Create the new locale pack in both web and desktop.
   - Every entry seeded with English + `// TODO: $ARGUMENTS translator` comment.
   - Never silently copy English as if translated.
   - Wire locale into the i18n registry / locale picker.
   - Confirm `Intl.NumberFormat`, `Intl.DateTimeFormat`, and currency formatters resolve correctly for the new locale.
   - If RTL (Arabic, Hebrew, Persian): coordinate with `qflo-web-engineer` / `qflo-station-engineer` for layout audit.

2. **Typecheck**: run tsc to confirm no duplicate-key errors (TS1117) or missing-key errors.

3. **Report**: locale added, X keys pending translation, RTL status (if applicable), next step = hand off translator file to human translator.

Do NOT machine-translate production strings. The task is infrastructure + seeding, not translation.
