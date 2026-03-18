import Database from 'better-sqlite3';

type StatusCallback = (status: 'online' | 'offline' | 'syncing' | 'connecting') => void;
type ProgressCallback = (pendingCount: number) => void;

export class SyncEngine {
  private db: Database.Database;
  private supabaseUrl: string;
  private supabaseKey: string;
  private onStatus: StatusCallback;
  private onProgress: ProgressCallback;
  private interval: ReturnType<typeof setInterval> | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  public isOnline = false;
  public lastSyncAt: string | null = null;
  public pendingCount = 0;

  constructor(
    db: Database.Database,
    supabaseUrl: string,
    supabaseKey: string,
    onStatus: StatusCallback,
    onProgress: ProgressCallback,
  ) {
    this.db = db;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.onStatus = onStatus;
    this.onProgress = onProgress;
  }

  start() {
    // Check connectivity every 10s
    this.healthInterval = setInterval(() => this.checkHealth(), 10_000);
    this.checkHealth();

    // Try to sync pending items every 15s
    this.interval = setInterval(() => this.syncNow(), 15_000);

    // Pull cloud data every 30s when online
    setInterval(() => {
      if (this.isOnline) this.pullLatest();
    }, 30_000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.healthInterval) clearInterval(this.healthInterval);
  }

  private async checkHealth() {
    try {
      const res = await fetch(`${this.supabaseUrl}/rest/v1/offices?select=id&limit=1`, {
        method: 'GET',
        headers: { apikey: this.supabaseKey, Authorization: `Bearer ${this.supabaseKey}` },
        signal: AbortSignal.timeout(5000),
      });
      const wasOffline = !this.isOnline;
      this.isOnline = res.ok;

      if (wasOffline && this.isOnline) {
        this.onStatus('syncing');
        await this.syncNow();
        await this.pullLatest();
      }

      this.onStatus(this.isOnline ? 'online' : 'offline');
    } catch {
      this.isOnline = false;
      this.onStatus('offline');
    }

    this.updatePendingCount();
  }

  public updatePendingCount() {
    const row = this.db.prepare(
      "SELECT COUNT(*) as count FROM sync_queue WHERE synced_at IS NULL"
    ).get() as any;
    this.pendingCount = row?.count ?? 0;
    this.onProgress(this.pendingCount);
  }

  async syncNow() {
    if (!this.isOnline) return;

    const pending = this.db.prepare(
      "SELECT * FROM sync_queue WHERE synced_at IS NULL AND attempts < 5 ORDER BY created_at ASC LIMIT 50"
    ).all() as any[];

    if (pending.length === 0) return;

    this.onStatus('syncing');

    // Get session for auth token
    const sessionRow = this.db.prepare(
      "SELECT value FROM session WHERE key = 'current'"
    ).get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    const authToken = session?.access_token ?? this.supabaseKey;

    for (const item of pending) {
      try {
        await this.replayMutation(item, authToken);
        this.db.prepare(
          "UPDATE sync_queue SET synced_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), item.id);
      } catch (err: any) {
        this.db.prepare(
          "UPDATE sync_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?"
        ).run(err.message ?? 'Unknown error', item.id);
      }
    }

    this.lastSyncAt = new Date().toISOString();
    this.updatePendingCount();
    this.onStatus('online');

    // Clean up old synced items (> 24h)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare("DELETE FROM sync_queue WHERE synced_at IS NOT NULL AND synced_at < ?").run(cutoff);

    // Auto-discard items that failed 5+ times (unrecoverable)
    const discarded = this.db.prepare(
      "DELETE FROM sync_queue WHERE synced_at IS NULL AND attempts >= 5"
    ).run();
    if (discarded.changes > 0) {
      console.warn(`Auto-discarded ${discarded.changes} sync items after 5 failed attempts`);
      this.updatePendingCount();
    }
  }

  private async replayMutation(item: any, authToken: string) {
    const payload = JSON.parse(item.payload);
    const headers: Record<string, string> = {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    };

    const baseUrl = `${this.supabaseUrl}/rest/v1/${item.table_name}`;

    switch (item.operation) {
      case 'INSERT': {
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok && res.status !== 409) {
          throw new Error(`INSERT failed: ${res.status}`);
        }
        break;
      }

      case 'UPDATE':
      case 'CALL': {
        const res = await fetch(`${baseUrl}?id=eq.${item.record_id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok && res.status !== 409) {
          throw new Error(`UPDATE failed: ${res.status}`);
        }
        break;
      }
    }
  }

  // Pull latest data from cloud to local cache
  async pullLatest() {
    if (!this.isOnline) return;

    const sessionRow = this.db.prepare(
      "SELECT value FROM session WHERE key = 'current'"
    ).get() as any;
    const session = sessionRow ? JSON.parse(sessionRow.value) : null;
    if (!session?.office_ids?.length) return;

    const headers: Record<string, string> = {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${session.access_token ?? this.supabaseKey}`,
    };

    try {
      const officeIds = session.office_ids as string[];
      const officeFilter = officeIds.map((id: string) => `id.eq.${id}`).join(',');
      const officeInFilter = officeIds.map((id: string) => `office_id.eq.${id}`).join(',');

      // Pull offices, departments, services, desks in parallel
      const [officesRes, deptsRes, svcsRes, desksRes] = await Promise.all([
        fetch(`${this.supabaseUrl}/rest/v1/offices?or=(${officeFilter})&select=id,name,address,organization_id,settings,operating_hours`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/departments?or=(${officeInFilter})&select=id,name,code,office_id`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/services?select=id,name,department_id,estimated_service_time`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${this.supabaseUrl}/rest/v1/desks?or=(${officeInFilter})&select=id,name,department_id,office_id,is_active,current_staff_id`, { headers, signal: AbortSignal.timeout(10000) }),
      ]);

      const now = new Date().toISOString();

      if (officesRes.ok) {
        const offices = await officesRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO offices (id, name, address, organization_id, settings, operating_hours, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const o of offices) {
          stmt.run(o.id, o.name, o.address, o.organization_id, JSON.stringify(o.settings ?? {}), JSON.stringify(o.operating_hours ?? {}), now);
        }
      }

      if (deptsRes.ok) {
        const depts = await deptsRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO departments (id, name, code, office_id, updated_at) VALUES (?, ?, ?, ?, ?)`);
        for (const d of depts) {
          stmt.run(d.id, d.name, d.code, d.office_id, now);
        }
      }

      if (svcsRes.ok) {
        const svcs = await svcsRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO services (id, name, department_id, estimated_service_time, updated_at) VALUES (?, ?, ?, ?, ?)`);
        for (const s of svcs) {
          stmt.run(s.id, s.name, s.department_id, s.estimated_service_time ?? 10, now);
        }
      }

      if (desksRes.ok) {
        const desks = await desksRes.json();
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO desks (id, name, department_id, office_id, is_active, current_staff_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const d of desks) {
          stmt.run(d.id, d.name, d.department_id, d.office_id, d.is_active ? 1 : 0, d.current_staff_id, now);
        }
      }

      // Pull today's tickets
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      for (const officeId of officeIds) {
        const res = await fetch(
          `${this.supabaseUrl}/rest/v1/tickets?office_id=eq.${officeId}&created_at=gte.${todayISO}&order=created_at.asc`,
          { headers, signal: AbortSignal.timeout(15000) }
        );

        if (res.ok) {
          const tickets = await res.json();
          const upsert = this.db.prepare(`
            INSERT OR REPLACE INTO tickets
            (id, ticket_number, office_id, department_id, service_id, desk_id, status, priority,
             customer_data, created_at, called_at, called_by_staff_id, serving_started_at,
             completed_at, cancelled_at, parked_at, recall_count, notes, is_remote, appointment_id, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const bulkUpsert = this.db.transaction((rows: any[]) => {
            for (const t of rows) {
              upsert.run(
                t.id, t.ticket_number, t.office_id, t.department_id, t.service_id,
                t.desk_id, t.status, t.priority ?? 0,
                JSON.stringify(t.customer_data ?? {}),
                t.created_at, t.called_at, t.called_by_staff_id, t.serving_started_at,
                t.completed_at, t.cancelled_at, t.parked_at, t.recall_count ?? 0,
                t.notes, t.is_remote ? 1 : 0, t.appointment_id,
                new Date().toISOString()
              );
            }
          });

          bulkUpsert(tickets);

          // Remap L- ticket numbers: find synced offline tickets that still have L- prefix
          // and update them to their cloud number
          for (const t of tickets) {
            if (!t.ticket_number.startsWith('L-')) {
              // Check if we have a local L- version of this ticket
              const local = this.db.prepare(
                "SELECT ticket_number FROM tickets WHERE id = ? AND ticket_number LIKE 'L-%'"
              ).get(t.id) as any;
              if (local) {
                // The cloud has a proper number — update our local copy
                this.db.prepare("UPDATE tickets SET ticket_number = ? WHERE id = ?").run(t.ticket_number, t.id);
              }
            }
          }
        }
      }
    } catch {
      // Silently fail — offline mode will use cached data
    }
  }
}
