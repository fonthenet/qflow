interface ElectronAPI {
  isElectron: boolean;
  printTicket: (data: {
    ticketNumber: string;
    qrCodeUrl: string;
    serviceName: string;
    departmentName: string;
    officeName: string;
    timestamp: string;
  }) => Promise<void>;
  getAppInfo: () => Promise<{ version: string; isElectron: boolean; isPortable?: boolean }>;
  getConfig: () => Promise<{
    supabaseUrl: string;
    supabaseAnonKey: string;
    appName: string;
    offlineOnly: boolean;
    isPortable: boolean;
  }>;
  offline: {
    getStatus: () => Promise<{ online: boolean; pendingSyncs: number }>;
    sync: () => Promise<void>;
  };
  onConnectionChange: (
    callback: (status: { online: boolean; pendingSyncs: number }) => void
  ) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
