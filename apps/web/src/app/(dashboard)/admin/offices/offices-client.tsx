'use client';

import { useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import {
  createOffice,
  updateOffice,
  deleteOffice,
  createOfficeHoliday,
  deleteOfficeHoliday,
  getOfficeHolidays,
} from '@/lib/actions/admin-actions';
import {
  isOfficeOpen,
  capitalizeDay,
  DEFAULT_OPERATING_HOURS,
  type OperatingHours,
  type DayHours,
} from '@queueflow/shared';
import type { Database } from '@/lib/supabase/database.types';

type Office = Database['public']['Tables']['offices']['Row'];

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

// ── Operating Hours Editor ───────────────────────────────────────
function OperatingHoursEditor({
  value,
  onChange,
}: {
  value: OperatingHours;
  onChange: (hours: OperatingHours) => void;
}) {
  function setDay(day: string, field: 'open' | 'close', val: string) {
    onChange({ ...value, [day]: { ...value[day], [field]: val } });
  }

  function toggleClosed(day: string) {
    const current = value[day];
    if (current && current.open === '00:00' && current.close === '00:00') {
      // Re-open with defaults
      onChange({ ...value, [day]: { open: '08:00', close: '17:00' } });
    } else {
      onChange({ ...value, [day]: { open: '00:00', close: '00:00' } });
    }
  }

  return (
    <div className="space-y-2">
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Operating Hours
      </label>
      <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1.5">
        {DAYS.map((day) => {
          const hours = value[day] || { open: '00:00', close: '00:00' };
          const isClosed = hours.open === '00:00' && hours.close === '00:00';
          return (
            <div key={day} className="flex items-center gap-2 text-sm">
              <span className="w-20 font-medium text-foreground">{capitalizeDay(day).slice(0, 3)}</span>
              {isClosed ? (
                <span className="flex-1 text-muted-foreground text-xs">Closed</span>
              ) : (
                <>
                  <input
                    type="time"
                    value={hours.open}
                    onChange={(e) => setDay(day, 'open', e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                  />
                  <span className="text-muted-foreground text-xs">to</span>
                  <input
                    type="time"
                    value={hours.close}
                    onChange={(e) => setDay(day, 'close', e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                  />
                </>
              )}
              <button
                type="button"
                onClick={() => toggleClosed(day)}
                className={`ml-auto rounded-lg px-2 py-0.5 text-[10px] font-bold transition-colors ${
                  isClosed
                    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                    : 'bg-success/10 text-success hover:bg-success/20'
                }`}
              >
                {isClosed ? 'Closed' : 'Open'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Holidays Manager ─────────────────────────────────────────────
function HolidaysManager({ officeId }: { officeId: string }) {
  const [holidays, setHolidays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getOfficeHolidays(officeId).then((res) => {
      setHolidays(res.data ?? []);
      setLoading(false);
    });
  }, [officeId]);

  function handleAdd(formData: FormData) {
    formData.set('office_id', officeId);
    startTransition(async () => {
      const result = await createOfficeHoliday(formData);
      if (!result.error) {
        setShowAdd(false);
        const res = await getOfficeHolidays(officeId);
        setHolidays(res.data ?? []);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Remove this holiday?')) return;
    startTransition(async () => {
      await deleteOfficeHoliday(id);
      const res = await getOfficeHolidays(officeId);
      setHolidays(res.data ?? []);
    });
  }

  if (loading) return <div className="text-xs text-muted-foreground py-2">Loading holidays...</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Holidays & Closures
        </label>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs font-medium text-primary hover:text-primary/80"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <form action={handleAdd} className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex gap-2">
            <input
              name="holiday_date"
              type="date"
              required
              className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
            />
            <input
              name="name"
              placeholder="Holiday name"
              required
              className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'Adding...' : 'Add Holiday'}
          </button>
        </form>
      )}

      {holidays.length === 0 ? (
        <div className="text-xs text-muted-foreground py-1">No holidays configured.</div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/20 divide-y divide-border">
          {holidays.map((h: any) => (
            <div key={h.id} className="flex items-center justify-between px-3 py-2 text-xs">
              <div>
                <span className="font-medium text-foreground">{h.name}</span>
                <span className="ml-2 text-muted-foreground">{h.holiday_date}</span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(h.id)}
                disabled={isPending}
                className="text-destructive hover:text-destructive/80 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Open/Closed Status Badge ─────────────────────────────────────
function OfficeStatusBadge({ office }: { office: Office }) {
  const hours = office.operating_hours as OperatingHours | null;
  if (!hours || Object.keys(hours).length === 0) return null;

  const result = isOfficeOpen(hours, office.timezone || 'UTC');

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold ${
        result.isOpen
          ? 'bg-green-500/10 text-green-600'
          : 'bg-red-500/10 text-red-500'
      }`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${result.isOpen ? 'bg-green-500' : 'bg-red-500'}`} />
      {result.isOpen ? 'Open Now' : 'Closed'}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────
export function OfficesClient({ offices }: { offices: Office[] }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Office | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [operatingHours, setOperatingHours] = useState<OperatingHours>(DEFAULT_OPERATING_HOURS);

  function openCreate() {
    setEditing(null);
    setError(null);
    setOperatingHours(DEFAULT_OPERATING_HOURS);
    setShowModal(true);
  }

  function openEdit(office: Office) {
    setEditing(office);
    setError(null);
    const hours = office.operating_hours as OperatingHours | null;
    setOperatingHours(hours && Object.keys(hours).length > 0 ? hours : DEFAULT_OPERATING_HOURS);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    formData.set('operating_hours', JSON.stringify(operatingHours));
    startTransition(async () => {
      const result = editing
        ? await updateOffice(editing.id, formData)
        : await createOffice(formData);

      if (result?.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setEditing(null);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this office?')) return;
    startTransition(async () => {
      const result = await deleteOffice(id);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Add and update the places where customers can be served.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90"
        >
          Add Location
        </button>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Branch Type</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hours</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {offices.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No locations found. Add your first location to get started.
                </td>
              </tr>
            )}
            {offices.map((office) => (
              <tr key={office.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3.5">
                  <div className="font-medium text-foreground">{office.name}</div>
                  <div className="text-xs text-muted-foreground">{office.address || '---'}</div>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground">
                  {((office.settings as Record<string, any> | null)?.branch_type as string | undefined)?.replace(/_/g, ' ') ?? '---'}
                </td>
                <td className="px-5 py-3.5">
                  <OfficeStatusBadge office={office} />
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                      office.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {office.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/departments?office=${office.id}`}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                    >
                      Departments
                    </Link>
                    <button
                      onClick={() => openEdit(office)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(office.id)}
                      disabled={isPending}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border/60 bg-card p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {editing ? 'Edit Location' : 'Create Location'}
            </h2>

            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  required
                  defaultValue={editing?.name ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Address
                </label>
                <input
                  name="address"
                  defaultValue={editing?.address ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Timezone
                </label>
                <div className="flex gap-2">
                  <select
                    name="timezone"
                    id="tz-select"
                    defaultValue={editing?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                    className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                  >
                    {(() => {
                      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
                      const common = [
                        detected,
                        'Africa/Algiers', 'Africa/Cairo', 'Africa/Casablanca', 'Africa/Tunis', 'Africa/Lagos',
                        'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo',
                        'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore',
                        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Istanbul', 'Europe/Moscow',
                        'Australia/Sydney', 'Pacific/Auckland',
                        'UTC',
                      ];
                      const unique = [...new Set(common)];
                      return unique.map(tz => (
                        <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}{tz === detected ? ' (detected)' : ''}</option>
                      ));
                    })()}
                  </select>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Auto-detected from your browser. Change if office is in a different timezone.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Branch Type
                  </label>
                  <select
                    name="branch_type"
                    defaultValue={((editing?.settings as Record<string, any> | null)?.branch_type as string | undefined) ?? ''}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                  >
                    <option value="">Use default</option>
                    <option value="service_center">Service Center</option>
                    <option value="branch_office">Branch Office</option>
                    <option value="community_clinic">Community Clinic</option>
                    <option value="restaurant_floor">Restaurant Floor</option>
                    <option value="salon_shop">Salon Shop</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Operating Model
                  </label>
                  <select
                    name="platform_operating_model"
                    defaultValue={((editing?.settings as Record<string, any> | null)?.platform_operating_model as string | undefined) ?? ''}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                  >
                    <option value="">Use default</option>
                    <option value="department_first">Department First</option>
                    <option value="service_routing">Service Routing</option>
                    <option value="appointments_first">Appointments First</option>
                    <option value="waitlist">Waitlist</option>
                  </select>
                </div>
              </div>

              {/* Operating Hours Editor */}
              <OperatingHoursEditor value={operatingHours} onChange={setOperatingHours} />

              {/* Holidays — only when editing */}
              {editing && <HolidaysManager officeId={editing.id} />}

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="privacy_safe_display"
                    value="true"
                    defaultChecked={((editing?.settings as Record<string, any> | null)?.privacy_safe_display as boolean | undefined) ?? false}
                    className="h-4 w-4 rounded border-input"
                  />
                  <label className="text-sm font-medium text-foreground">Privacy-safe display</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="is_active"
                    value="true"
                    defaultChecked={editing?.is_active ?? true}
                    className="h-4 w-4 rounded border-input"
                  />
                  <label className="text-sm font-medium text-foreground">Active</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
