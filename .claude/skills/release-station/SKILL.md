---
name: release-station
description: Full Station installer release — version bump, full test suite, pre-release audit, build signed NSIS installer (x64 + ia32), publish to GitHub Releases for electron-updater pickup. Use for actual releases to customers, NOT iteration (use /ship-station for that).
disable-model-invocation: true
allowed-tools: Bash(taskkill *) Bash(cd *) Bash(npm *) Bash(gh *) Bash(start *) Read Edit
---

Release a new Station version to customers.

## Steps

1. **Pre-release audit** — invoke `/pre-release-audit` first. If decision is HOLD, stop here. Do not proceed with blocking issues.

2. **Version bump**: `apps/desktop/package.json` — bump minor or patch per scope of changes.

3. **Force-kill** any running dev Station: `taskkill /F /IM "Qflo Station.exe" 2>/dev/null || true`.

4. **Run full test suite**: `cd apps/desktop && npm test`. Must be green.

5. **Build all architectures**: `cd apps/desktop && npm run build:all-arch` (x64 + ia32 NSIS installers).

6. **Code sign** the installers (confirm signing cert env var set; error out if missing).

7. **Delegate to `qflo-devops-engineer`** to:
   - Publish installers to GitHub Releases (owner: `fonthenet`, repo: `qflow` per `package.json` publish config).
   - Draft release notes from commits since last release.
   - Tag the release.

8. **Monitor first hour** via Sentry — any spike in errors = immediate rollback decision.

9. **Report**: version shipped, installer URLs, release notes, Sentry baseline vs post-release.

Do not skip the pre-release audit. Do not publish unsigned installers. Always have a rollback plan.
