import type { StaffSession, SyncStatus } from '../lib/types';

interface Props {
  session: StaffSession | null;
  syncStatus: SyncStatus;
  onLogout: () => void;
}

export function StatusBar({ session, syncStatus, onLogout }: Props) {
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span className="app-logo">Q</span>
        <span className="app-name">QueueFlow Station</span>
      </div>

      <div className="status-bar-center">
        <div className={`connection-badge ${syncStatus.isOnline ? 'online' : 'offline'}`}>
          <span className="connection-dot" />
          <span>{syncStatus.isOnline ? 'Connected' : 'Offline Mode'}</span>
        </div>
        {syncStatus.pendingCount > 0 && (
          <span className="pending-badge">{syncStatus.pendingCount} pending sync</span>
        )}
      </div>

      <div className="status-bar-right">
        {session && (
          <>
            <span className="operator-name">{session.full_name}</span>
            <span className="operator-role">{session.role}</span>
            {session.desk_name && (
              <span className="desk-badge">{session.desk_name}</span>
            )}
            <button className="btn-logout" onClick={onLogout}>Sign Out</button>
          </>
        )}
      </div>
    </div>
  );
}
