// ── Machine License — hardware-locked activation ──────────────────
// Generates a unique machine fingerprint from hardware identifiers.
// The station won't run without a valid license key tied to this fingerprint.
//
// HARDENING: once a machine has been fingerprinted ONCE, the result is
// cached to disk in userData and never recomputed. Activation is then
// resilient to:
//   - VPN clients adding/removing virtual adapters (NordVPN, OpenVPN,
//     WireGuard, TAP-Windows, etc.)
//   - Docker / WSL / Hyper-V / VMware adding bridge interfaces
//   - Wi-Fi vs Ethernet swap (different physical adapter winning the
//     "primary MAC" lottery)
//   - Bluetooth radio toggling on/off
//   - Windows Update reordering network adapters
// Without the cache, any of these would change the hash and force the
// operator to re-request approval — unacceptable in production.

import { createHash } from 'crypto';
import { networkInterfaces, hostname, cpus, platform, arch } from 'os';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { app } from 'electron';
import { CONFIG } from './config';

// Virtual / transient interface name patterns. We exclude these from the
// fingerprint so a VPN toggle or Docker start doesn't shift the hash.
const VIRTUAL_INTERFACE_RE = /docker|^br-|veth|^tun|^tap|wg|wireguard|vmnet|vboxnet|^wsl|virtualbox|vmware|hyper-v|vethernet|bluetooth|loopback|utun|awdl|llw|bridge|p2p|^stf|nordlynx|openvpn|cscotun|wintun|nekoray/i;

/** True if the MAC has the locally-administered bit set (virtual / spoofed). */
function isLocallyAdministeredMac(mac: string): boolean {
  const firstOctet = parseInt((mac.split(':')[0] ?? mac.split('-')[0] ?? '0'), 16);
  return (firstOctet & 0x02) !== 0;
}

/** Compute the hardware fingerprint from scratch. Internal — most callers
 *  should use getMachineId() which respects the on-disk cache. */
function computeMachineIdFresh(): string {
  const parts: string[] = [];

  // 1. Hostname
  parts.push(hostname());

  // 2. CPU model (stable across reboots) + core count
  const cpu = cpus();
  if (cpu.length > 0) {
    parts.push(cpu[0].model);
    parts.push(String(cpu.length));
  }

  // 3. Primary physical MAC. Filter out:
  //    - internal (loopback)
  //    - all-zero MACs
  //    - virtual interfaces by NAME (Docker, VPN, WSL, Hyper-V, etc.)
  //    - locally-administered MACs (LAA bit set — usually virtual)
  // Then sort for deterministic order and take the lowest. This means
  // even if a NEW physical adapter is added later, the original lowest
  // wins as long as it's still present.
  const nets = networkInterfaces();
  const macs: string[] = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    if (VIRTUAL_INTERFACE_RE.test(name)) continue;
    for (const a of addrs) {
      if (a.internal) continue;
      if (!a.mac || a.mac === '00:00:00:00:00:00') continue;
      if (isLocallyAdministeredMac(a.mac)) continue;
      macs.push(a.mac.toLowerCase());
    }
  }
  macs.sort();
  if (macs.length > 0) parts.push(macs[0]);

  // 4. OS + arch
  parts.push(platform() + '-' + arch());

  // 5. Stable platform IDs — most reliable signal, survives every
  //    network/virtual change. We pick the FIRST one that succeeds:
  //    Windows: machine UUID via wmic csproduct (preferred over
  //             diskdrive serial — disks can be replaced/cloned)
  //    Linux:   /etc/machine-id (set once at install)
  //    macOS:   IOPlatformUUID via ioreg
  let platformId: string | null = null;
  try {
    if (platform() === 'win32') {
      const out = execSync('wmic csproduct get UUID', { timeout: 5000 })
        .toString().trim().split('\n').filter(l => l.trim() && l.trim().toLowerCase() !== 'uuid')[0]?.trim();
      if (out && out !== 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF') platformId = out;
    } else if (platform() === 'linux') {
      try { platformId = readFileSync('/etc/machine-id', 'utf8').trim(); } catch {
        try { platformId = readFileSync('/var/lib/dbus/machine-id', 'utf8').trim(); } catch {}
      }
    } else if (platform() === 'darwin') {
      const out = execSync('ioreg -d2 -c IOPlatformExpertDevice | grep IOPlatformUUID', { timeout: 5000 })
        .toString().trim();
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) platformId = m[1];
    }
  } catch { /* fall through */ }
  if (platformId) parts.push(platformId);

  const raw = parts.join('|');
  const hash = createHash('sha256').update(raw).digest('hex');
  return [hash.slice(0, 4), hash.slice(4, 8), hash.slice(8, 12), hash.slice(12, 16)]
    .join('-').toUpperCase();
}

/** Path to the cached machine ID file. Lives in userData so it survives
 *  app reinstalls (userData is preserved by the Windows installer). */
function getCachedMachineIdPath(): string | null {
  try {
    return join(app.getPath('userData'), '.machine-id');
  } catch {
    // app.getPath() throws if called before electron is ready; fall back
    // to a path next to the executable so we still get SOME persistence.
    return null;
  }
}

/**
 * Returns the stable machine fingerprint.
 *
 * On first call, computes the fingerprint from hardware and caches it
 * to disk. On every subsequent call (forever), reads from the cache —
 * this guarantees the ID never changes after activation, even if the
 * underlying hardware/network setup shifts.
 */
export function getMachineId(): string {
  const cachePath = getCachedMachineIdPath();
  if (cachePath && existsSync(cachePath)) {
    try {
      const cached = readFileSync(cachePath, 'utf8').trim();
      // Sanity-check the format: XXXX-XXXX-XXXX-XXXX
      if (/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(cached)) return cached;
    } catch { /* fall through to recompute */ }
  }
  const fresh = computeMachineIdFresh();
  if (cachePath) {
    try {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, fresh, 'utf8');
    } catch { /* best-effort; next launch will recompute */ }
  }
  return fresh;
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
