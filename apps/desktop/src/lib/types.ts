export interface Ticket {
  id: string;
  ticket_number: string;
  office_id: string;
  department_id?: string;
  service_id?: string;
  desk_id?: string;
  status: 'waiting' | 'called' | 'serving' | 'served' | 'no_show' | 'cancelled';
  priority: number;
  customer_data: Record<string, any>;
  created_at: string;
  called_at?: string;
  called_by_staff_id?: string;
  serving_started_at?: string;
  completed_at?: string;
  parked_at?: string;
  recall_count: number;
  notes?: string;
  is_remote: boolean;
  is_offline: boolean;
  appointment_id?: string;
}

export interface SyncStatus {
  isOnline: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  connectionQuality?: 'good' | 'slow' | 'flaky' | 'offline';
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'no_update' | 'error';
  version: string | null;
  progress: number | null;
  message: string | null;
}

export interface StaffSession {
  user_id: string;
  staff_id: string;
  email: string;
  full_name: string;
  role: string;
  office_id: string;
  office_name: string;
  department_id?: string;
  desk_id?: string;
  desk_name?: string;
  office_ids: string[];
  access_token?: string;
  refresh_token?: string;
  _pwd?: string; // transient: encrypted and stored separately for silent re-auth
}

// Extend window with our IPC bridge — keep in sync with preload.ts
declare global {
  interface Window {
    qf: any; // typed loosely so each screen can use its own sub-APIs
  }
}
