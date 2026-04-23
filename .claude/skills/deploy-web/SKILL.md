---
name: deploy-web
description: Push web/migration changes to main (triggers Vercel deploy) — respects the batch-deploy rule (only push when web or migrations actually changed, since Vercel bills per deploy). Runs pre-release audit first.
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *) Read
---

Deploy web changes by pushing to main.

## Steps

1. **Verify scope** — check `git diff origin/main...HEAD --name-only`:
   - If only `apps/desktop/**`, `apps/mobile/**`, or `docs/**` changed → STOP. Don't push. Use `/ship-station` or `/release-station` for desktop; mobile has its own release; docs need no deploy. Vercel bills per deploy.
   - If `apps/web/**`, `supabase/**`, or shared packages changed → proceed.

2. **Pre-release audit** — invoke `/pre-release-audit`. HOLD on any blocking issue.

3. **Confirm migration was applied** — if this push includes SQL migration files, verify `qflo-migration-writer` already applied them (Supabase should be ahead of or equal to main, never behind).

4. **Push** to main:
   ```
   git push origin main
   ```

5. **Monitor** the Vercel deploy:
   - Delegate to `qflo-devops-engineer` for first 15 min after deploy.
   - Check Sentry + PostHog for spikes.

6. **Rollback plan**: if errors spike, Vercel has instant rollback — use it immediately, then diagnose.

7. **Report**: deploy URL, Vercel build status, Sentry baseline, what was deployed.

Never push to trigger Vercel when only desktop/docs changed. Batch your work.
