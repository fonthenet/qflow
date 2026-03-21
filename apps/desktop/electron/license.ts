// ── Machine License — hardware-locked activation ──────────────────
// Generates a unique machine fingerprint from hardware identifiers.
// The station won't run without a valid license key tied to this fingerprint.

import { createHash } from 'crypto';
import { networkInterfaces, hostname, cpus, platform, arch } from 'os';
import { execSync } from 'child_process';
import { CONFIG } from './config';

/** Generate a stable machine fingerprint from hardware identifiers */
export function getMachineId(): string {
  const parts: string[] = [];

  // 1. Hostname
  parts.push(hostname());

  // 2. CPU model (stable across reboots)
  const cpu = cpus();
  if (cpu.length > 0) {
    parts.push(cpu[0].model);
    parts.push(String(cpu.length)); // core count
  }

  // 3. Primary MAC address (non-internal, non-virtual)
  const nets = networkInterfaces();
  const macs: string[] = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const a of addrs) {
      if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') {
        macs.push(a.mac);
      }
    }
  }
  macs.sort(); // stable order
  if (macs.length > 0) parts.push(macs[0]);

  // 4. OS + arch
  parts.push(platform() + '-' + arch());

  // 5. Windows: disk serial number (very stable identifier)
  if (platform() === 'win32') {
    try {
      const serial = execSync('wmic diskdrive get serialnumber', { timeout: 5000 })
        .toString().trim().split('\n').filter(l => l.trim() && l.trim() !== 'SerialNumber')[0]?.trim();
      if (serial) parts.push(serial);
    } catch { /* ignore */ }
  }

  // Hash all parts into a short fingerprint
  const raw = parts.join('|');
  const hash = createHash('sha256').update(raw).digest('hex');
  // Return first 16 chars in groups of 4 for readability: XXXX-XXXX-XXXX-XXXX
  return [hash.slice(0, 4), hash.slice(4, 8), hash.slice(8, 12), hash.slice(12, 16)]
    .join('-').toUpperCase();
}

/** Verify a license key against the machine ID */
export async function verifyLicense(licenseKey: string, machineId: string): Promise<{ valid: boolean; error?: string; org?: string }> {
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/station_licenses?license_key=eq.${licenseKey}&select=*`, {
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return { valid: false, error: 'Could not verify license. Check internet connection.' };

    const rows = await res.json();
    if (!rows.length) return { valid: false, error: 'Invalid license key.' };

    const license = rows[0];

    // Check if license is active
    if (license.status !== 'active') {
      return { valid: false, error: `License is ${license.status}.` };
    }

    // Check expiry
    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return { valid: false, error: 'License has expired.' };
    }

    // Check machine binding
    if (license.machine_id && license.machine_id !== machineId) {
      return { valid: false, error: 'This license is bound to a different machine.' };
    }

    // First activation — bind to this machine
    if (!license.machine_id) {
      await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/station_licenses?id=eq.${license.id}`, {
        method: 'PATCH',
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          machine_id: machineId,
          activated_at: new Date().toISOString(),
          machine_name: hostname(),
        }),
        signal: AbortSignal.timeout(10000),
      });
    }

    return { valid: true, org: license.organization_name || license.organization_id };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'License verification failed.' };
  }
}

/** Register this machine as pending activation (so super admin sees it) */
export async function registerPendingDevice(machineId: string): Promise<void> {
  try {
    // Upsert — if already registered, just update the timestamp
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/pending_device_activations`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        machine_id: machineId,
        machine_name: hostname(),
        requested_at: new Date().toISOString(),
        status: 'pending',
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Silently fail — not critical
  }
}

/** Check if super admin has approved this machine */
export async function checkApproval(machineId: string): Promise<{ approved: boolean; licenseKey?: string }> {
  try {
    // Check if there's a license already bound to this machine
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/station_licenses?machine_id=eq.${machineId}&status=eq.active&select=license_key,organization_name`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return { approved: false };
    const rows = await res.json();
    if (rows.length > 0) {
      return { approved: true, licenseKey: rows[0].license_key };
    }
    return { approved: false };
  } catch {
    return { approved: false };
  }
}

/** Check if a license is stored locally */
export function getStoredLicense(db: any): { key: string; machineId: string } | null {
  try {
    const row = db.prepare("SELECT value FROM session WHERE key = 'license'").get() as any;
    if (row) return JSON.parse(row.value);
  } catch { /* */ }
  return null;
}

/** Store a verified license locally */
export function storeLicense(db: any, key: string, machineId: string) {
  db.prepare("INSERT OR REPLACE INTO session (key, value) VALUES ('license', ?)").run(
    JSON.stringify({ key, machineId, activatedAt: new Date().toISOString() })
  );
}
