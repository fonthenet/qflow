---
name: new-migration
description: Create a new Supabase SQL migration file, apply it via MCP, regenerate TypeScript types, and remind to mirror in Station SQLite if needed. Use for every schema change.
argument-hint: <description-slug>
disable-model-invocation: true
---

Create migration `$ARGUMENTS` (e.g. `add_country_config_table`).

## Steps

1. **Delegate to `qflo-migration-writer`** agent:
   - Inspect current schema (`list_tables`).
   - Write migration file with timestamp prefix `YYYYMMDDHHMMSS_$ARGUMENTS.sql` in the project's migrations folder.
   - Use idempotent statements: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP INDEX IF EXISTS`.
   - Include RLS policies for new tables (default-deny + explicit allow).
   - Apply immediately via `apply_migration` to Supabase project `ofyyzuocifigyyhqxxqw`.
   - Regenerate TypeScript types and update the web app's types file.
   - Run `get_advisors` (security + performance) and report findings.

2. **If the new/changed table is used by Station**: delegate to `qflo-station-engineer` to add it BOTH to:
   - Initial schema block in `apps/desktop/src/lib/db.ts` (fresh installs)
   - `CREATE TABLE IF NOT EXISTS` migrations section (existing DBs)

3. **If RLS is non-trivial**: delegate to `qflo-security-reviewer` for policy review.

4. **Report**: migration ID applied, type file updated, advisor findings, Station SQLite status.

Never leave migrations unapplied. Never forget the Station SQLite mirror.
