'use client';

import { useMemo, useState, useTransition } from 'react';
import { Search, Trash2, Users } from 'lucide-react';
import { deleteStaffMember, updateStaffRole } from '@/lib/actions/platform-actions';

interface Staff {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  organization: { id: string; name: string; slug: string } | null;
}

export function UsersClient({ staff: initial }: { staff: Staff[] }) {
  const [staff, setStaff] = useState(initial);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const roles = ['all', ...new Set(staff.map((member) => member.role))];
  const filtered = useMemo(
    () =>
      staff.filter((member) => {
        const matchesSearch =
          !search ||
          member.full_name.toLowerCase().includes(search.toLowerCase()) ||
          (member.email || '').toLowerCase().includes(search.toLowerCase()) ||
          (member.organization?.name || '').toLowerCase().includes(search.toLowerCase());
        const matchesRole = roleFilter === 'all' || member.role === roleFilter;
        return matchesSearch && matchesRole;
      }),
    [roleFilter, search, staff]
  );

  function handleRoleChange(staffId: string, newRole: string) {
    setError('');
    startTransition(async () => {
      const result = await updateStaffRole(staffId, newRole);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStaff((prev) => prev.map((member) => (member.id === staffId ? { ...member, role: newRole } : member)));
    });
  }

  function handleDelete(staffId: string, name: string) {
    if (!confirm(`Delete staff member "${name}"? This cannot be undone.`)) return;
    setError('');
    startTransition(async () => {
      const result = await deleteStaffMember(staffId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStaff((prev) => prev.filter((member) => member.id !== staffId));
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Owner console</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Users and signups</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              Review staff across every organization, update roles, and clean up accounts that should no longer have access.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Total users" value={staff.length.toString()} helper="Across the whole platform" />
            <MetricCard label="Organizations" value={new Set(staff.map((member) => member.organization?.id || '')).size.toString()} helper="Represented in this list" />
            <MetricCard label="Active filters" value={`${(search ? 1 : 0) + (roleFilter !== 'all' ? 1 : 0)}`} helper="Search plus role view" />
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-[260px] flex-1 xl:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, or organization"
              className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none focus:border-slate-950/30"
            />
          </div>

          <div className="inline-flex rounded-full border border-slate-200 bg-[#fbfaf8] p-1">
            {roles.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(role)}
                className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                  roleFilter === role ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {role.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-16 text-center shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
            <Users className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-4 text-base font-semibold text-slate-900">No users match this view.</p>
            <p className="mt-2 text-sm text-slate-500">Adjust the filters to see more accounts.</p>
          </div>
        ) : (
          filtered.map((member) => (
            <article key={member.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(15,23,42,0.04)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-slate-950">{member.full_name}</p>
                  <p className="mt-1 text-sm text-slate-500">{member.email || 'No email'}</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {member.organization?.name || 'No organization'}
                    {member.organization?.slug ? ` · /${member.organization.slug}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    member.role === 'admin'
                      ? 'bg-amber-50 text-amber-700'
                      : member.role === 'manager'
                        ? 'bg-sky-50 text-sky-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {member.role.replace('_', ' ')}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    member.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {member.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-sm text-slate-500">
                    Joined {new Date(member.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <select
                  value={member.role}
                  onChange={(event) => handleRoleChange(member.id, event.target.value)}
                  disabled={isPending}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none disabled:opacity-50"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="desk_agent">Desk agent</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleDelete(member.id, member.full_name)}
                  disabled={isPending}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete user
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}
