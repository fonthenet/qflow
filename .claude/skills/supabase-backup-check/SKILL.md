---
name: supabase-backup-check
description: Verify Supabase backup health and optionally run a quarterly restore drill to a branch project. Use monthly for health check, quarterly for full drill.
disable-model-invocation: true
---

Verify Supabase backups are healthy and restorable.

## Steps

1. **Delegate to `qflo-devops-engineer`**:
   - Via Supabase MCP: check project `ofyyzuocifigyyhqxxqw` latest backup timestamp and size.
   - Confirm daily backup cadence is running without gaps.
   - Check retention window matches our policy.

2. **Monthly health check** (cheap):
   - Backup recent? (within last 24h)
   - Backup size reasonable? (not 0, not 10x average)
   - No failure alerts in project logs?

3. **Quarterly restore drill** (if $ARGUMENTS contains "drill"):
   - Create a branch project via Supabase MCP (`create_branch`).
   - Restore the latest backup into the branch.
   - Verify row counts on top 5 tables match expectations.
   - Run a sample query against restored data.
   - Delete the branch project.
   - Document the drill result in `docs/devops/restore-drills.md`.

4. **Report**: backup status (green/yellow/red), last drill date, any remediation needed.

Backups are useless until proven restorable. Drill quarterly, no exceptions.
