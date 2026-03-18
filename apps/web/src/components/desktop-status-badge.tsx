'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface DesktopConnection {
  id: string;
  machine_name: string;
  machine_id: string;
  app_version: string | null;
  os_info: string | null;
  is_online: boolean;
  last_ping: string;
  pending_syncs: number;
  last_sync_at: string | null;
  ip_address: string | null;
}

export function DesktopStatusBadge({ organizationId }: { organizationId: string }) {
  const [connections, setConnections] = useState<DesktopConnection[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!organizationId) return;

    const supabase = createClient();

    async function fetchStatus() {
      const { data } = await supabase
        .from('desktop_connections')
        .select('*')
        .eq('organization_id', organizationId)
        .order('last_ping', { ascending: false });

      if (data) setConnections(data as DesktopConnection[]);
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [organizationId]);

  const onlineCount = connections.filter((c) => c.is_online).length;
  const totalPending = connections.reduce((sum, c) => sum + (c.pending_syncs || 0), 0);
  const hasConnections = connections.length > 0;

  const statusColor = !hasConnections
    ? 'bg-gray-400'
    : onlineCount === connections.length
      ? 'bg-green-500'
      : onlineCount > 0
        ? 'bg-yellow-500'
        : 'bg-red-500';

  const statusLabel = !hasConnections
    ? 'No desktop app'
    : onlineCount === connections.length
      ? `${onlineCount} PC${onlineCount > 1 ? 's' : ''} connected`
      : onlineCount > 0
        ? `${onlineCount}/${connections.length} online`
        : 'All PCs offline';

  function formatAgo(dateStr: string): string {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors text-sm w-full"
      >
        <span className={`w-2.5 h-2.5 rounded-full ${statusColor} ${hasConnections && onlineCount > 0 ? 'animate-pulse' : ''}`} />
        <span className="text-gray-700 font-medium truncate">{statusLabel}</span>
        {totalPending > 0 && (
          <span className="ml-auto bg-yellow-100 text-yellow-700 text-xs font-bold px-1.5 py-0.5 rounded-full">
            {totalPending} pending
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && connections.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Desktop Connections
          </h4>
          <div className="space-y-2">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className={`p-2 rounded-lg border ${
                  conn.is_online ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${conn.is_online ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="font-semibold text-sm text-gray-800">{conn.machine_name}</span>
                  {conn.app_version && (
                    <span className="text-xs text-gray-500 ml-auto">v{conn.app_version}</span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                  <span>Last ping: {formatAgo(conn.last_ping)}</span>
                  {conn.pending_syncs > 0 && (
                    <span className="text-yellow-600 font-medium">{conn.pending_syncs} pending sync</span>
                  )}
                  {conn.last_sync_at && (
                    <span>Synced: {formatAgo(conn.last_sync_at)}</span>
                  )}
                </div>
                {conn.os_info && (
                  <div className="text-xs text-gray-400 mt-0.5">{conn.os_info}</div>
                )}
              </div>
            ))}
          </div>
          {!hasConnections && (
            <p className="text-xs text-gray-500 text-center py-2">
              No desktop app installed. Install the QueueFlow desktop app for offline support.
            </p>
          )}
        </div>
      )}

      {expanded && connections.length === 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
          <p className="text-xs text-gray-500 text-center">
            No desktop app detected. Install the QueueFlow desktop app for offline queue management.
          </p>
        </div>
      )}
    </div>
  );
}
