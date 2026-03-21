'use client';

import { useState } from 'react';
import {
  Shield,
  Globe,
  Cog,
  Database,
  Key,
  Bell,
  Mail,
  Server,
  Lock,
  ExternalLink,
  Copy,
  CheckCircle,
} from 'lucide-react';

interface Props {
  platformDomain: string;
  superAdminEmail: string;
  totalOrgs: number;
  totalLicenses: number;
  dbRegion: string;
}

export function PlatformSettings({ platformDomain, superAdminEmail, totalOrgs, totalLicenses, dbRegion }: Props) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-[900px]">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Platform Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Global configuration and platform information</p>
      </div>

      {/* Super Admin Card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Super Administrator</h3>
            <p className="text-xs text-slate-500">Platform owner account</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <SettingRow label="Email" value={superAdminEmail} copyable onCopy={() => copy(superAdminEmail, 'email')} copied={copiedField === 'email'} />
          <SettingRow label="Role" value="Platform Owner (Super Admin)" />
          <SettingRow label="Access Level" value="Full platform access — all organizations, all data" />
        </div>
      </div>

      {/* Platform Info */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <Globe size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Platform</h3>
            <p className="text-xs text-slate-500">Qflo Queue Management System</p>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <InfoCard icon={Globe} label="Domain" value={platformDomain} link={`https://${platformDomain}`} />
            <InfoCard icon={Database} label="Database" value={`Supabase (${dbRegion})`} />
            <InfoCard icon={Server} label="Hosting" value="Vercel (Edge)" />
            <InfoCard icon={Lock} label="Auth" value="Supabase Auth + RLS" />
          </div>
        </div>
      </div>

      {/* Platform Stats */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
            <Cog size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Usage</h3>
            <p className="text-xs text-slate-500">Current platform usage overview</p>
          </div>
        </div>
        <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatBox label="Organizations" value={totalOrgs} />
          <StatBox label="Licenses" value={totalLicenses} />
          <StatBox label="Auth Provider" value="Supabase" isText />
          <StatBox label="Version" value="1.0.0" isText />
        </div>
      </div>

      {/* Security Settings */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
            <Lock size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Security</h3>
            <p className="text-xs text-slate-500">Platform security configuration</p>
          </div>
        </div>
        <div className="p-6 space-y-3">
          <SecurityRow label="Row-Level Security (RLS)" status="active" detail="All tables protected with organization-scoped policies" />
          <SecurityRow label="Ticket RLS" status="active" detail="Public updates restricted to qr_token capability tokens" />
          <SecurityRow label="License Verification" status="active" detail="Hardware fingerprint + cloud verification on every launch" />
          <SecurityRow label="Sync Encryption" status="active" detail="All sync traffic encrypted via HTTPS + JWT auth" />
          <SecurityRow label="Circuit Breaker" status="active" detail="Sync pauses after 5 consecutive failures, auto-recovers" />
        </div>
      </div>

      {/* Upcoming Features */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <Cog size={28} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm font-medium text-slate-600">More settings coming soon</p>
        <p className="text-xs text-slate-400 mt-1">Feature flags, maintenance mode, default plans, email templates, notification preferences</p>
      </div>
    </div>
  );
}

function SettingRow({ label, value, copyable, onCopy, copied }: { label: string; value: string; copyable?: boolean; onCopy?: () => void; copied?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-900">{value}</span>
        {copyable && (
          <button onClick={onCopy} className="p-1 rounded hover:bg-slate-100 transition-colors">
            {copied ? <CheckCircle size={13} className="text-emerald-500" /> : <Copy size={13} className="text-slate-400" />}
          </button>
        )}
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, label, value, link }: { icon: any; label: string; value: string; link?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} className="text-slate-400" />
        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{label}</p>
      </div>
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-slate-900">{value}</p>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, isText }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4 text-center">
      <p className={`${isText ? 'text-lg' : 'text-2xl'} font-bold text-slate-900`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mt-1">{label}</p>
    </div>
  );
}

function SecurityRow({ label, status, detail }: { label: string; status: string; detail: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{detail}</p>
      </div>
      <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
        status === 'active' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-100 text-slate-500'
      }`}>
        {status}
      </span>
    </div>
  );
}
