'use client';

import { useState } from 'react';
import { Search, Users, Shield, UserCheck, UserX } from 'lucide-react';

interface User {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  organization_id: string;
  organization_name: string;
  created_at: string;
}

interface Org { id: string; name: string }

interface Props {
  users: User[];
  organizations: Org[];
}

const roleColors: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  branch_admin: 'bg-indigo-100 text-indigo-700',
  receptionist: 'bg-emerald-100 text-emerald-700',
  desk_operator: 'bg-cyan-100 text-cyan-700',
  floor_manager: 'bg-amber-100 text-amber-700',
  analyst: 'bg-pink-100 text-pink-700',
  agent: 'bg-slate-100 text-slate-700',
};

export function UsersManager({ users, organizations }: Props) {
  const [search, setSearch] = useState('');
  const [filterOrg, setFilterOrg] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');

  const roles = [...new Set(users.map(u => u.role))].sort();

  const filtered = users.filter(u => {
    if (search && !u.full_name.toLowerCase().includes(search.toLowerCase()) && !u.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterOrg && u.organization_id !== filterOrg) return false;
    if (filterRole && u.role !== filterRole) return false;
    if (filterActive === 'active' && !u.is_active) return false;
    if (filterActive === 'inactive' && u.is_active) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">All Users</h1>
        <p className="text-sm text-muted-foreground mt-1">{users.length} staff members across all organizations</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <select value={filterOrg} onChange={e => setFilterOrg(e.target.value)}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="">All Organizations</option>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="">All Roles</option>
          {roles.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value as any)}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Stats */}
      <div className="flex gap-3 text-sm">
        <span className="px-3 py-1.5 rounded-lg bg-background border border-border"><strong>{filtered.length}</strong> results</span>
        <span className="px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 text-green-700"><strong>{users.filter(u => u.is_active).length}</strong> active</span>
        <span className="px-3 py-1.5 rounded-lg bg-purple-50 border border-purple-200 text-purple-700"><strong>{users.filter(u => u.role === 'admin').length}</strong> admins</span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">User</th>
              <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Organization</th>
              <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Role</th>
              <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Status</th>
              <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3">
                  <div>
                    <p className="font-medium">{u.full_name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{u.organization_name}</td>
                <td className="px-5 py-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${roleColors[u.role] ?? 'bg-slate-100 text-slate-600'}`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {u.is_active ? (
                    <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><UserCheck size={13} /> Active</span>
                  ) : (
                    <span className="flex items-center gap-1 text-slate-400 text-xs font-medium"><UserX size={13} /> Inactive</span>
                  )}
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center text-muted-foreground">
            <Users size={32} className="mx-auto mb-2 opacity-30" />
            <p>No users match your filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
