'use client';

import { useState, useTransition } from 'react';
import { Users, Search, Shield, Trash2 } from 'lucide-react';
import { updateStaffRole, deleteStaffMember } from '@/lib/actions/platform-actions';

interface Staff {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  organization: { id: string; name: string; slug: string } | null;
}

const roleColors: Record<string, string> = {
  admin: 'bg-purple-50 text-purple-700',
  manager: 'bg-blue-50 text-blue-700',
  desk_agent: 'bg-gray-100 text-gray-600',
  agent: 'bg-gray-100 text-gray-600',
};

export function UsersClient({ staff: initial }: { staff: Staff[] }) {
  const [staff, setStaff] = useState(initial);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const roles = ['all', ...new Set(staff.map(s => s.role))];

  const filtered = staff.filter((s) => {
    const matchesSearch =
      !search ||
      s.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (s.organization?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'all' || s.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  function handleRoleChange(staffId: string, newRole: string) {
    setError('');
    startTransition(async () => {
      const result = await updateStaffRole(staffId, newRole);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStaff(prev => prev.map(s => s.id === staffId ? { ...s, role: newRole } : s));
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
      setStaff(prev => prev.filter(s => s.id !== staffId));
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Users & Signups</h1>
        <p className="mt-1 text-sm text-gray-500">
          All staff members across every organization. {staff.length} total users.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or organization..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5">
          {roles.map((role) => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition ${
                roleFilter === role
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {role.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-gray-500">
        {filtered.length} user{filtered.length !== 1 ? 's' : ''}
        {search || roleFilter !== 'all' ? ' matching filters' : ''}
      </p>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">No users found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Organization</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.full_name}</p>
                      <p className="text-xs text-gray-400">{s.email || 'No email'}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-sm text-gray-700">{s.organization?.name || '—'}</p>
                    <p className="text-xs text-gray-400">/{s.organization?.slug}</p>
                  </td>
                  <td className="px-5 py-3">
                    <select
                      value={s.role}
                      onChange={(e) => handleRoleChange(s.id, e.target.value)}
                      disabled={isPending}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                      <option value="desk_agent">Desk Agent</option>
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-gray-500">
                      {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => handleDelete(s.id, s.full_name)}
                      disabled={isPending}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Delete user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
