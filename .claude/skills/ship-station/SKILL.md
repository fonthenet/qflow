---
name: ship-station
description: Fast Station iteration loop — bump version, force-kill running Station, run build:dir (skips ~60s NSIS), relaunch unpacked exe. Use for quick testing during development, NOT for releases.
disable-model-invocation: true
allowed-tools: Bash(taskkill *) Bash(cd *) Bash(npm *) Bash(start *) Read Edit
---

Rebuild and relaunch the Qflo Station for quick iteration.

## Steps

1. **Bump version** in `apps/desktop/package.json` — increment patch (e.g. `1.17.87` → `1.17.88`). Always bump before rebuild (user rule).

2. **Force-kill** the running Station (do NOT ask user to close):
   ```
   taskkill /F /IM "Qflo Station.exe" 2>/dev/null || true
   ```

3. **Build (dir-only, fast)**:
   ```
   cd apps/desktop && npm run build:dir
   ```
   This skips the ~60s NSIS installer step. Use `build:installer` only for releases.

4. **Relaunch** the unpacked exe:
   ```
   start "" "apps/desktop/release/win-unpacked/Qflo Station.exe"
   ```

5. **Report**: new version, build duration, launch confirmed.

Never leave the Station unbuilt after changes. Never ask the user to close the app — force-kill yourself.
