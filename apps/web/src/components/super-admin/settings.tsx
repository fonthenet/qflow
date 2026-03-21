'use client';

import { Shield, Globe, Cog } from 'lucide-react';

export function PlatformSettings() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Platform Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Global configuration for the Qflo platform</p>
      </div>

      <div className="rounded-xl border border-border bg-background p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center">
            <Shield size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold">Super Admin</h3>
            <p className="text-sm text-muted-foreground">f.onthenet@gmail.com</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <Globe size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-semibold">Platform</h3>
            <p className="text-sm text-muted-foreground">Qflo Queue Management System</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="rounded-lg bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Domain</p>
            <p className="text-sm font-medium">qflow-sigma.vercel.app</p>
          </div>
          <div className="rounded-lg bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Database</p>
            <p className="text-sm font-medium">Supabase (EU West)</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center">
        <Cog size={32} className="mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">More settings coming soon</p>
        <p className="text-xs text-muted-foreground mt-1">Feature flags, maintenance mode, default plans, and more</p>
      </div>
    </div>
  );
}
