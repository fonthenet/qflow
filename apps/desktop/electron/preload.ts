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
    banCustomer: (ticketId: string, reason?: string) =>
      ipcRenderer.invoke('db:ban-customer', ticketId, reason),
    updateDesk: (deskId: string, updates: any) =>
      ipcRenderer.invoke('db:update-desk', deskId, updates),
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

  // Broadcast templates (local SQLite)
  templates: {
    list: (orgId: string) => ipcRenderer.invoke('templates:list', orgId),
    save: (orgId: string, title: string, bodyFr: string, bodyAr: string, shortcut: string) => ipcRenderer.invoke('templates:save', orgId, title, bodyFr, bodyAr, shortcut),
    delete: (id: string, orgId: string) => ipcRenderer.invoke('templates:delete', id, orgId),
  },

  // Settings
  settings: {
    getLocale: () => ipcRenderer.invoke('settings:get-locale'),
    setLocale: (locale: string) => ipcRenderer.invoke('settings:set-locale', locale),
    onLocaleChange: (callback: (locale: string) => void) => {
      const handler = (_: any, locale: string) => callback(locale);
      ipcRenderer.on('settings:locale-changed', handler);
      return () => ipcRenderer.removeListener('settings:locale-changed', handler);
    },
  },

  // Connection
  isOnline: () => ipcRenderer.invoke('connection:status'),

  // Kiosk
  getKioskPort: () => ipcRenderer.invoke('kiosk:get-port'),

  // Updater
  updater: {
    getStatus: () => ipcRenderer.invoke('update:get-status'),
    checkForUpdates: () => ipcRenderer.invoke('update:check'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    onStatusChange: (callback: (status: any) => void) => {
      const handler = (_: any, status: any) => callback(status);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },

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

  // Port change notification (default port was in use)
  onPortChanged: (callback: (info: { requested: number; actual: number }) => void) => {
    const handler = (_: any, info: any) => callback(info);
    ipcRenderer.on('port-changed', handler);
    return () => ipcRenderer.removeListener('port-changed', handler);
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

  links: {
    getPublic: () => ipcRenderer.invoke('links:public'),
  },

  // Org branding
  org: {
    getBranding: () => ipcRenderer.invoke('org:branding'),
  },

  // Remote Support
  support: {
    // RustDesk (internet remote control)
    rustdesk: {
      status: () => ipcRenderer.invoke('support:rustdesk-status'),
      start: () => ipcRenderer.invoke('support:rustdesk-start'),
      stop: () => ipcRenderer.invoke('support:rustdesk-stop'),
      download: () => ipcRenderer.invoke('support:rustdesk-download'),
      onDownloadProgress: (cb: (p: { percent: number; status: string }) => void) => {
        const handler = (_: any, p: any) => cb(p);
        ipcRenderer.on('support:download-progress', handler);
        return () => ipcRenderer.removeListener('support:download-progress', handler);
      },
    },
  },
});
