import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qf', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Database operations
  db: {
    getTickets: (officeId: string, statuses: string[]) =>
      ipcRenderer.invoke('db:get-tickets', officeId, statuses),
    createTicket: (ticket: any) =>
      ipcRenderer.invoke('db:create-ticket', ticket),
    updateTicket: (ticketId: string, updates: any) =>
      ipcRenderer.invoke('db:update-ticket', ticketId, updates),
    callNext: (officeId: string, deskId: string, staffId: string) =>
      ipcRenderer.invoke('db:call-next', officeId, deskId, staffId),
    query: (table: string, officeIds: string[]) =>
      ipcRenderer.invoke('db:query', table, officeIds),
  },

  // Sync
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:status'),
    forceSync: () => ipcRenderer.invoke('sync:force'),
    getPendingDetails: () => ipcRenderer.invoke('sync:pending-details'),
    discardItem: (id: string) => ipcRenderer.invoke('sync:discard-item', id),
    discardAll: () => ipcRenderer.invoke('sync:discard-all'),
    retryItem: (id: string) => ipcRenderer.invoke('sync:retry-item', id),
    onStatusChange: (callback: (status: string) => void) => {
      const handler = (_: any, status: string) => callback(status);
      ipcRenderer.on('sync:status-change', handler);
      return () => ipcRenderer.removeListener('sync:status-change', handler);
    },
    onProgress: (callback: (count: number) => void) => {
      const handler = (_: any, count: number) => callback(count);
      ipcRenderer.on('sync:progress', handler);
      return () => ipcRenderer.removeListener('sync:progress', handler);
    },
    onError: (callback: (error: { message: string; ticketNumber?: string; type: string }) => void) => {
      const handler = (_: any, error: any) => callback(error);
      ipcRenderer.on('sync:error', handler);
      return () => ipcRenderer.removeListener('sync:error', handler);
    },
  },

  // Session
  session: {
    save: (session: any) => ipcRenderer.invoke('session:save', session),
    load: () => ipcRenderer.invoke('session:load'),
    clear: () => ipcRenderer.invoke('session:clear'),
  },

  // Connection
  isOnline: () => ipcRenderer.invoke('connection:status'),

  // Auth events
  auth: {
    onSessionExpired: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('auth:session-expired', handler);
      return () => ipcRenderer.removeListener('auth:session-expired', handler);
    },
  },

  // Ticket change events (push-based, no polling needed)
  tickets: {
    onChange: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('tickets:changed', handler);
      return () => ipcRenderer.removeListener('tickets:changed', handler);
    },
  },

  // Activity log
  activity: {
    getRecent: (officeId: string, limit?: number) =>
      ipcRenderer.invoke('activity:get-recent', officeId, limit),
  },

  // License
  license: {
    getMachineId: () => ipcRenderer.invoke('license:machine-id'),
    getStatus: () => ipcRenderer.invoke('license:status'),
    activate: (key: string) => ipcRenderer.invoke('license:activate', key),
    checkApproval: () => ipcRenderer.invoke('license:check-approval'),
  },

  // Debug
  debug: {
    dbStats: () => ipcRenderer.invoke('debug:db-stats'),
  },

  // Kiosk
  kiosk: {
    getUrl: () => ipcRenderer.invoke('kiosk:url'),
    getLocalIP: () => ipcRenderer.invoke('kiosk:local-ip'),
  },

  // Org branding
  org: {
    getBranding: () => ipcRenderer.invoke('org:branding'),
  },
});
