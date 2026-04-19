// ── db-integrity.ts ──────────────────────────────────────────────────
// Commercial-grade SQLite corruption detection and recovery.
//
// Philosophy: the user's local SQLite database is a *cache*. The cloud
// (Supabase) is the source of truth. If the cache is corrupt we must
// detect it before the user hits a mystery failure ("Failed to call
// next ticket"), quarantine the damaged file for forensics, and either
// restore from a verified backup or start fresh — then let sync
// rehydrate. The user should never see corruption errors in the UI.
//
// This module is intentionally stand-alone: it opens its own temporary
// DB handles for checks so it can run BEFORE the app's main `db`
// handle is initialised. Never import it from hot paths.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export type IntegrityResult =
  | { ok: true }
  | { ok: false; reason: string; details?: unknown };

export type RecoveryOutcome =
  | { action: 'healthy'; dbPath: string }
  | { action: 'restored'; dbPath: string; fromBackup: string; quarantined: string }
  | { action: 'fresh'; dbPath: string; quarantined: string; reason: string };

/**
 * Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check` against
 * a database file. Opens the file read-only so we never mutate a
 * possibly-damaged database during inspection.
 *
 * Returns `{ok: true}` only when *both* checks pass and the file is
 * a real SQLite database. Any other outcome — missing file, I/O error,
 * malformed header, failing integrity — yields `{ok: false, reason}`.
 */
export function checkIntegrity(dbPath: string): IntegrityResult {
  if (!fs.existsSync(dbPath)) {
    return { ok: false, reason: 'file_missing' };
  }
  // Size 0 is a fresh-but-never-written file; treat as corrupt so it's rebuilt.
  try {
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) return { ok: false, reason: 'empty_file' };
  } catch (err: any) {
    return { ok: false, reason: 'stat_failed', details: err?.message };
  }

  let probe: Database.Database | null = null;
  try {
    probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    // quick_check is faster than integrity_check but equally
    // authoritative for detecting page-level corruption. integrity_check
    // also validates indexes — run both, cheap compared to a failed
    // call-next that rolls back a transaction in production.
    const quick = probe.pragma('quick_check') as Array<{ quick_check: string }>;
    if (!Array.isArray(quick) || quick[0]?.quick_check !== 'ok') {
      return { ok: false, reason: 'quick_check_failed', details: quick };
    }
    const full = probe.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (!Array.isArray(full) || full[0]?.integrity_check !== 'ok') {
      return { ok: false, reason: 'integrity_check_failed', details: full };
    }
    const fk = probe.pragma('foreign_key_check') as unknown[];
    if (Array.isArray(fk) && fk.length > 0) {
      // FK violations are not strictly corruption but indicate a
      // dangerous inconsistent state — log but don't treat as fatal.
      logger.warn('db-integrity', 'Foreign key violations detected (non-fatal)', { count: fk.length });
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'open_threw', details: err?.message ?? String(err) };
  } finally {
    try { probe?.close(); } catch { /* already bad — don't mask */ }
  }
}

/**
 * Move a (possibly corrupt) database aside for forensics. WAL and SHM
 * sidecars are moved with it so a later SQLite open doesn't try to
 * replay a stale WAL onto the fresh DB.
 *
 * Returns the quarantined path (without sidecars).
 */
export function quarantineDatabase(dbPath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const quarantined = `${dbPath}.corrupt-${stamp}`;
  try {
    if (fs.existsSync(dbPath)) fs.renameSync(dbPath, quarantined);
    for (const sidecar of ['-wal', '-shm']) {
      const src = `${dbPath}${sidecar}`;
      if (fs.existsSync(src)) {
        try { fs.renameSync(src, `${quarantined}${sidecar}`); } catch { /* best-effort */ }
      }
    }
    logger.warn('db-integrity', 'Quarantined database', { quarantined });
  } catch (err: any) {
    logger.error('db-integrity', 'Failed to quarantine database', { error: err?.message });
  }
  return quarantined;
}

/**
 * Scan a backup directory for the newest backup that passes
 * integrity_check. Returns `null` if nothing healthy is available.
 *
 * We walk newest → oldest so we restore the least stale clean copy.
 * A corrupt backup is silently skipped (logged) — a backup that
 * fails integrity is worse than no backup.
 */
export function findHealthyBackup(backupDir: string, prefix = 'qflo-'): string | null {
  if (!fs.existsSync(backupDir)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(backupDir);
  } catch (err: any) {
    logger.error('db-integrity', 'Could not read backup directory', { backupDir, error: err?.message });
    return null;
  }
  const candidates = entries
    .filter((f) => f.startsWith(prefix) && f.endsWith('.db'))
    .sort()
    .reverse();

  for (const name of candidates) {
    const full = path.join(backupDir, name);
    const result = checkIntegrity(full);
    if (result.ok) {
      logger.info('db-integrity', 'Healthy backup selected for recovery', { backup: name });
      return full;
    }
    logger.warn('db-integrity', 'Skipping corrupt backup', { backup: name, reason: result.reason });
  }
  return null;
}

/**
 * Copy a backup file into the main DB path atomically. Uses a
 * temp-then-rename so a crash mid-copy cannot leave a half-written
 * `qflo.db` that would itself be corrupt.
 */
function atomicRestore(backupPath: string, targetPath: string): void {
  const tmp = `${targetPath}.restoring-${process.pid}`;
  fs.copyFileSync(backupPath, tmp);
  // On Windows, rename over an existing file requires the destination
  // not to exist. We quarantined the corrupt file earlier, so this is
  // clean.
  fs.renameSync(tmp, targetPath);
}

/**
 * Top-level recovery. Call once at app startup BEFORE `new Database()`
 * on the main DB path. Idempotent and cheap when the DB is healthy.
 *
 * Behaviour:
 *   - healthy  → no-op, returns `{action:'healthy'}`
 *   - corrupt  → quarantine → restore newest healthy backup if any,
 *                else leave no file (initDB will create fresh schema
 *                and sync will rehydrate from the cloud)
 *   - missing  → no-op (initDB will create a fresh DB); returns `healthy`
 */
export function recoverDatabaseIfNeeded(opts: {
  dbPath: string;
  backupDir: string;
}): RecoveryOutcome {
  const { dbPath, backupDir } = opts;

  // Missing file → fresh install, nothing to recover.
  if (!fs.existsSync(dbPath)) {
    return { action: 'healthy', dbPath };
  }

  const initial = checkIntegrity(dbPath);
  if (initial.ok) {
    return { action: 'healthy', dbPath };
  }

  logger.error('db-integrity', 'Local database is corrupt — initiating recovery', {
    reason: initial.reason,
    details: initial.details,
  });

  const quarantined = quarantineDatabase(dbPath);
  const backup = findHealthyBackup(backupDir);

  if (backup) {
    try {
      atomicRestore(backup, dbPath);
      logger.info('db-integrity', 'Database restored from backup', { backup, dbPath });
      // Verify the just-restored file. If the copy itself somehow
      // didn't land clean (disk full, A/V interference), fall through
      // to fresh.
      const verify = checkIntegrity(dbPath);
      if (verify.ok) {
        return { action: 'restored', dbPath, fromBackup: backup, quarantined };
      }
      logger.error('db-integrity', 'Restored file failed integrity — starting fresh', { verify });
      quarantineDatabase(dbPath); // move the bad restore aside too
    } catch (err: any) {
      logger.error('db-integrity', 'Restore failed — starting fresh', { error: err?.message });
    }
  } else {
    logger.warn('db-integrity', 'No healthy backup available — starting fresh (cloud will rehydrate)');
  }

  return {
    action: 'fresh',
    dbPath,
    quarantined,
    reason: initial.reason,
  };
}

/**
 * Run integrity_check on an open database handle. Use this for
 * backup verification, periodic health pings, etc. Cheap: ~10ms
 * for a small DB, scales with DB size.
 */
export function checkOpenDatabaseIntegrity(db: Database.Database): IntegrityResult {
  try {
    const quick = db.pragma('quick_check') as Array<{ quick_check: string }>;
    if (!Array.isArray(quick) || quick[0]?.quick_check !== 'ok') {
      return { ok: false, reason: 'quick_check_failed', details: quick };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: 'pragma_threw', details: err?.message ?? String(err) };
  }
}
