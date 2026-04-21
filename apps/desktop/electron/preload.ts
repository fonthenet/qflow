import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('qf', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),

  // HTTP fetch (main process — bypasses CORS)
  httpFetchText: (url: string) => ipcRenderer.invoke('http:fetch-text', url),

  // Database operations
  db: {
    getTickets: (officeId: string, statuses: string[]) =>
      ipcRenderer.invoke('db:get-tickets', officeId, statuses),
    createTicket: (ticket: any) =>
      ipcRenderer.invoke('db:create-ticket', ticket),
    insertCloudTicket: (ticket: any) =>
      ipcRenderer.invoke('db:insert-cloud-ticket', ticket),
    updateTicket: (ticketId: string, updates: any) =>
      ipcRenderer.invoke('db:update-ticket', ticketId, updates),
    saveNotes: (ticketId: string, notes: string) =>
      ipcRenderer.invoke('db:save-notes', ticketId, notes),
    callNext: (officeId: string, deskId: string, staffId: string) =>
      ipcRenderer.invoke('db:call-next', officeId, deskId, staffId),
    query: (table: string, officeIds: string[]) =>
      ipcRenderer.invoke('db:query', table, officeIds),
    banCustomer: (ticketId: string, reason?: string) =>
      ipcRenderer.invoke('db:ban-customer', ticketId, reason),
    updateDesk: (deskId: string, updates: any) =>
      ipcRenderer.invoke('db:update-desk', deskId, updates),
    // Health & recovery
    recoveryStatus: () => ipcRenderer.invoke('db:recovery-status'),
    rebuildFromCloud: () => ipcRenderer.invoke('db:rebuild-from-cloud'),
  },

  // Local cache (survives auth failures — prevents data disappearance)
  cache: {
    saveAppointments: (officeId: string, data: string) =>
      ipcRenderer.invoke('cache:save-appointments', officeId, data),
    getAppointments: (officeId: string) =>
      ipcRenderer.invoke('cache:get-appointments', officeId),
  },

  // Sync
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:status'),
    forceSync: () => ipcRenderer.invoke('sync:force'),
    getPendingDetails: () => ipcRenderer.invoke('sync:pending-details'),
    discardItem: (id: string) => ipcRenderer.invoke('sync:discard-item', id),
    discardAll: () => ipcRenderer.invoke('sync:discard-all'),
    retryItem: (id: string) => ipcRenderer.invoke('sync:retry-item', id),
    // Org-scoped breakdown: how many pending items belong to the
    // active business vs. others. Lets diagnostics show orphaned
    // items from a previous sign-in separately.
    getPendingBreakdown: () => ipcRenderer.invoke('sync:pending-breakdown'),
    discardForeign: () => ipcRenderer.invoke('sync:discard-foreign'),
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
    refreshConfig: () => ipcRenderer.invoke('sync:refresh-config'),
    onConfigChanged: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('config:changed', handler);
      return () => ipcRenderer.removeListener('config:changed', handler);
    },
  },

  // Session
  session: {
    save: (session: any) => ipcRenderer.invoke('session:save', session),
    load: () => ipcRenderer.invoke('session:load'),
    clear: () => ipcRenderer.invoke('session:clear'),
    getStationToken: () => ipcRenderer.invoke('session:get-station-token'),
  },

  // Customer rich-text drafts — offline safety net for the Clients panel.
  customerDrafts: {
    save: (customerId: string, notes: string | null, customerFile: string | null) =>
      ipcRenderer.invoke('customer-drafts:save', customerId, notes, customerFile),
    get: (customerId: string) =>
      ipcRenderer.invoke('customer-drafts:get', customerId),
    clear: (customerId: string) =>
      ipcRenderer.invoke('customer-drafts:clear', customerId),
  },

  // Broadcast templates (local SQLite)
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    save: (title: string, bodyFr: string, bodyAr: string, shortcut: string) => ipcRenderer.invoke('templates:save', title, bodyFr, bodyAr, shortcut),
    delete: (id: string) => ipcRenderer.invoke('templates:delete', id),
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
    onOpenSettings: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:open-settings', handler);
      return () => ipcRenderer.removeListener('menu:open-settings', handler);
    },
    onOpenTeam: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:open-team', handler);
      return () => ipcRenderer.removeListener('menu:open-team', handler);
    },
    onOpenBusinessAdmin: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('menu:open-business-admin', handler);
      return () => ipcRenderer.removeListener('menu:open-business-admin', handler);
    },
  },

  // Connection
  isOnline: () => ipcRenderer.invoke('connection:status'),

  // Kiosk
  getKioskPort: () => ipcRenderer.invoke('kiosk:get-port'),

  // Main-process natural-voice announcement. Plays through the OS audio
  // stack — no browser CSP / autoplay / tab-reload problems.
  voice: {
    announce: (args: { text: string; language: string; gender: string; rate: number }) =>
      ipcRenderer.invoke('voice:announce', args),
    // Ask the main process to pre-warm the offline MP3 cache for a given
    // voice + rate. Idempotent — safe to call after every settings load
    // or save; the prewarmer short-circuits when already done.
    prewarm: (args: { voiceId?: string | null; language?: string; gender?: string; rate?: number }) =>
      ipcRenderer.invoke('voice:prewarm', args),
    // Pulls the chime + voice audio bytes without playing them. Used by
    // the renderer when routing to a specific audio output device via
    // HTMLAudioElement.setSinkId — the only way to hit a non-default
    // Windows sink from inside the sandbox.
    getAnnouncementAudio: (args: {
      text: string; language: string; gender: string; rate: number; voiceId?: string | null; includeChime?: boolean;
    }) => ipcRenderer.invoke('voice:get-announcement-audio', args),
  },

  // Chime is bundled with the app as the single source of truth. The
  // only API surface is `play()`, used when the admin disables Voice
  // announcements but leaves Announcement sound on — plays just the
  // chime with no TTS attached.
  chime: {
    play: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('chime:play'),
  },

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
    // Get a valid access token from main process (single source of truth)
    getToken: () => ipcRenderer.invoke('auth:get-token'),
    // Secure credential storage via Electron safeStorage (OS keychain encryption)
    saveCredentials: (email: string, password: string) =>
      ipcRenderer.invoke('auth:save-credentials', email, password),
    getCredentials: () => ipcRenderer.invoke('auth:get-credentials'),
    clearCredentials: () => ipcRenderer.invoke('auth:clear-credentials'),
    onSessionExpired: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('auth:session-expired', handler);
      return () => ipcRenderer.removeListener('auth:session-expired', handler);
    },
    onTokenRefreshed: (callback: (token: string, refreshToken?: string) => void) => {
      const handler = (_: any, token: string, refreshToken?: string) => callback(token, refreshToken);
      ipcRenderer.on('auth:token-refreshed', handler);
      return () => ipcRenderer.removeListener('auth:token-refreshed', handler);
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

  // Notification result events (from direct /api/ticket-transition call)
  notify: {
    onResult: (callback: (result: { ticketId: string; sent: boolean; channel?: string; error?: string }) => void) => {
      const handler = (_: any, result: any) => callback(result);
      ipcRenderer.on('notify:result', handler);
      return () => ipcRenderer.removeListener('notify:result', handler);
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

  // Ticket timeline
  ticketTimeline: {
    get: (ticketId: string) =>
      ipcRenderer.invoke('ticket:get-timeline', ticketId),
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
