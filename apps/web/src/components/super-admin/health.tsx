'use client';

import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Activity,
  Database,
  Monitor,
  Clock,
  Shield,
  RefreshCw,
  TicketCheck,
} from 'lucide-react';

interface HealthCheck {
  name: string;
  status: string;
  detail: string;
  metric: number;
}

interface Props {
  checks: HealthCheck[];
  overallStatus: string;
  staleTickets: { id: string; ticket_number: string; office_id: string; created_at: string }[];
  offlineDevices: any[];
  dbResponseTime: number;
}

const statusConfig = {
  healthy: { icon: CheckCircle, label: 'Healthy', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  warning: { icon: AlertTriangle, label: 'Warning', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  error: { icon: XCircle, label: 'Error', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500' },
};

export function SystemHealth({ checks, overallStatus, staleTickets, offlineDevices, dbResponseTime }: Props) {
  const overall = statusConfig[overallStatus as keyof typeof statusConfig] ?? statusConfig.healthy;
  const StatusIcon = overall.icon;

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">System Health</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time platform diagnostics</p>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${overall.bg} border ${overall.border}`}>
          <div className={`w-2.5 h-2.5 rounded-full ${overall.dot} ${overallStatus === 'healthy' ? 'animate-pulse' : ''}`} />
          <span className={`text-sm font-semibold ${overall.color}`}>{overall.label}</span>
        </div>
      </div>

      {/* Performance Meter */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity size={18} className="text-slate-600" />
          <h3 className="font-semibold text-slate-900 text-sm">Performance</h3>
        </div>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">DB Response</p>
            <p className={`text-2xl font-bold ${dbResponseTime < 500 ? 'text-emerald-600' : dbResponseTime < 1500 ? 'text-amber-600' : 'text-red-600'}`}>
              {dbResponseTime}ms
            </p>
            <div className="w-full h-1.5 rounded-full bg-slate-100 mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${dbResponseTime < 500 ? 'bg-emerald-500' : dbResponseTime < 1500 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min((dbResponseTime / 3000) * 100, 100)}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Stale Tickets</p>
            <p className={`text-2xl font-bold ${staleTickets.length === 0 ? 'text-emerald-600' : staleTickets.length < 5 ? 'text-amber-600' : 'text-red-600'}`}>
              {staleTickets.length}
            </p>
            <p className="text-xs text-slate-400 mt-1">Waiting &gt; 2 hours</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Offline Devices</p>
            <p className={`text-2xl font-bold ${offlineDevices.length === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {offlineDevices.length}
            </p>
            <p className="text-xs text-slate-400 mt-1">Last seen &gt; 1 hour</p>
          </div>
        </div>
      </div>

      {/* Health Checks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {checks.map(check => {
          const cfg = statusConfig[check.status as keyof typeof statusConfig] ?? statusConfig.healthy;
          const Icon = cfg.icon;
          return (
            <div key={check.name} className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <Icon size={16} className={cfg.color} />
                  <h4 className="font-semibold text-slate-900 text-sm">{check.name}</h4>
                </div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>
              <p className="text-xs text-slate-600">{check.detail}</p>
            </div>
          );
        })}
      </div>

      {/* Stale Tickets Detail */}
      {staleTickets.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
          <div className="px-5 py-4 border-b border-amber-200/50 flex items-center gap-2">
            <TicketCheck size={16} className="text-amber-600" />
            <h3 className="font-semibold text-amber-900 text-sm">Stale Tickets ({staleTickets.length})</h3>
          </div>
          <div className="divide-y divide-amber-200/30">
            {staleTickets.slice(0, 10).map(t => {
              const waitMinutes = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
              return (
                <div key={t.id} className="px-5 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <code className="text-xs font-mono font-bold text-amber-800">{t.ticket_number}</code>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-amber-700">
                    <Clock size={12} />
                    <span>Waiting {waitMinutes}min</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
