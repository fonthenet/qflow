'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createOffice, updateOffice, deleteOffice } from '@/lib/actions/admin-actions';
import type { Database } from '@/lib/supabase/database.types';
import { useI18n } from '@/components/providers/locale-provider';

type Office = Database['public']['Tables']['offices']['Row'];

const TIMEZONE_OPTIONS = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'America/Toronto',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Algiers',
  'Africa/Casablanca',
  'Africa/Tunis',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Kuwait',
] as const;

const WEEK_DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
] as const;

function formatBranchTypeLabel(value: string | undefined, t: (key: string) => string) {
  switch (value) {
    case 'service_center':
      return t('Service Center');
    case 'branch_office':
      return t('Branch Office');
    case 'community_clinic':
      return t('Community Clinic');
    case 'restaurant_floor':
      return t('Restaurant Floor');
    case 'salon_shop':
      return t('Salon Shop');
    default:
      return '---';
  }
}

export function OfficesClient({ offices }: { offices: Office[] }) {
  const { t } = useI18n();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Office | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editingHours = ((editing?.operating_hours as Record<string, { open: string; close: string }> | null) ?? {}) as Record<
    string,
    { open: string; close: string }
  >;

  function openCreate() {
    setEditing(null);
    setError(null);
    setShowModal(true);
  }

  function openEdit(office: Office) {
    setEditing(office);
    setError(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
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
    if (!confirm(t('Are you sure you want to delete this office?'))) return;
    startTransition(async () => {
      const result = await deleteOffice(id);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Locations')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('Add and update the places where customers can be served.')}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('Add Location')}
        </button>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Name')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Branch Type')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Address')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Timezone')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Status')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {offices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('No locations found. Add your first location to get started.')}
                </td>
              </tr>
            )}
            {offices.map((office) => (
              <tr key={office.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{office.name}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {formatBranchTypeLabel(
                    (office.settings as Record<string, any> | null)?.branch_type as string | undefined,
                    t
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{office.address || '---'}</td>
                <td className="px-4 py-3 text-muted-foreground">{office.timezone || '---'}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      office.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {office.is_active ? t('Active') : t('Inactive')}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/departments?office=${office.id}`}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                    >
                      {t('Departments')}
                    </Link>
                    <button
                      onClick={() => openEdit(office)}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      {t('Edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(office.id)}
                      disabled={isPending}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      {t('Delete')}
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
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {editing ? t('Edit Location') : t('Create Location')}
            </h2>

            {error && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Name')} <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  required
                  defaultValue={editing?.name ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Address')}
                </label>
                <input
                  name="address"
                  defaultValue={editing?.address ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Timezone')}
                </label>
                <select
                  name="timezone"
                  defaultValue={editing?.timezone ?? 'America/Los_Angeles'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {TIMEZONE_OPTIONS.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Branch Type')}
                </label>
                <select
                  name="branch_type"
                  defaultValue={((editing?.settings as Record<string, any> | null)?.branch_type as string | undefined) ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t('Use template default')}</option>
                  <option value="service_center">{t('Service Center')}</option>
                  <option value="branch_office">{t('Branch Office')}</option>
                  <option value="community_clinic">{t('Community Clinic')}</option>
                  <option value="restaurant_floor">{t('Restaurant Floor')}</option>
                  <option value="salon_shop">{t('Salon Shop')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Operating Model')}
                </label>
                <select
                  name="platform_operating_model"
                  defaultValue={((editing?.settings as Record<string, any> | null)?.platform_operating_model as string | undefined) ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t('Use template default')}</option>
                  <option value="department_first">{t('Department First')}</option>
                  <option value="service_routing">{t('Service Routing')}</option>
                  <option value="appointments_first">{t('Appointments First')}</option>
                  <option value="waitlist">{t('Waitlist')}</option>
                </select>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="privacy_safe_display"
                  value="true"
                  defaultChecked={((editing?.settings as Record<string, any> | null)?.privacy_safe_display as boolean | undefined) ?? false}
                  className="h-4 w-4 rounded border-input"
                />
                <label className="text-sm font-medium text-foreground">
                  {t('Privacy-safe display mode')}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_active"
                  value="true"
                  defaultChecked={editing?.is_active ?? true}
                  className="h-4 w-4 rounded border-input"
                />
                <label className="text-sm font-medium text-foreground">{t('Active')}</label>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                <div className="mb-3">
                  <p className="text-sm font-medium text-foreground">{t('Work Schedule')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('Set the opening hours for this location. These hours are used for bookings and customer-facing availability.')}
                  </p>
                </div>
                <div className="space-y-3">
                  {WEEK_DAYS.map((day) => {
                    const hours = editingHours[day.key] ?? { open: '08:00', close: '17:00' };
                    const isClosed = hours.open === '00:00' && hours.close === '00:00';
                    return (
                      <div key={day.key} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
                        <label className="text-sm font-medium text-foreground">{t(day.label)}</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="time"
                            name={`${day.key}_open`}
                            defaultValue={isClosed ? '08:00' : hours.open}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                          />
                          <input
                            type="time"
                            name={`${day.key}_close`}
                            defaultValue={isClosed ? '17:00' : hours.close}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            name={`${day.key}_closed`}
                            value="true"
                            defaultChecked={isClosed}
                            className="h-4 w-4 rounded border-input"
                          />
                          {t('Closed')}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  {t('Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? t('Saving...') : editing ? t('Update') : t('Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
