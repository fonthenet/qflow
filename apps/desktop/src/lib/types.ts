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
}

// Extend window with our IPC bridge
declare global {
  interface Window {
    qf: {
      getConfig: () => Promise<{ supabaseUrl: string; supabaseAnonKey: string }>;
      db: {
        getTickets: (officeId: string, statuses: string[]) => Promise<any[]>;
        createTicket: (ticket: any) => Promise<any>;
        updateTicket: (ticketId: string, updates: any) => Promise<any>;
        callNext: (officeId: string, deskId: string, staffId: string) => Promise<any>;
      };
      sync: {
        getStatus: () => Promise<SyncStatus>;
        forceSync: () => Promise<void>;
        onStatusChange: (cb: (status: string) => void) => () => void;
        onProgress: (cb: (count: number) => void) => () => void;
      };
      session: {
        save: (session: any) => Promise<void>;
        load: () => Promise<StaffSession | null>;
        clear: () => Promise<void>;
      };
      isOnline: () => Promise<boolean>;
    };
  }
}
