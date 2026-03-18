import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printTicket: (data: any) => ipcRenderer.invoke('print-ticket', data),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getConfig: () => ipcRenderer.invoke('get-config'),

  offline: {
    getStatus: () => ipcRenderer.invoke('offline:status'),
    sync: () => ipcRenderer.invoke('offline:sync'),
    isOnline: () => ipcRenderer.invoke('offline:is-online'),

    // Queue operations (work offline via SQLite)
    createTicket: (params: any) => ipcRenderer.invoke('offline:create-ticket', params),
    callNext: (params: any) => ipcRenderer.invoke('offline:call-next', params),
    callTicket: (params: any) => ipcRenderer.invoke('offline:call-ticket', params),
    serve: (params: any) => ipcRenderer.invoke('offline:serve', params),
    complete: (params: any) => ipcRenderer.invoke('offline:complete', params),
    noShow: (params: any) => ipcRenderer.invoke('offline:no-show', params),
    cancel: (params: any) => ipcRenderer.invoke('offline:cancel', params),
    getQueue: (params: any) => ipcRenderer.invoke('offline:get-queue', params),

    // Config cache (departments, services, desks cached for offline use)
    cacheConfig: (params: any) => ipcRenderer.invoke('offline:cache-config', params),
    getCachedConfig: (params: any) => ipcRenderer.invoke('offline:get-cached-config', params),
  },

  // Desktop identity
  desktop: {
    setOffice: (officeInfo: any) => ipcRenderer.invoke('desktop:set-office', officeInfo),
    getMachineInfo: () => ipcRenderer.invoke('desktop:get-machine-info'),
  },

  // Event listeners
  onConnectionChange: (callback: (status: { online: boolean; pendingSyncs: number; lastSync: string | null }) => void) => {
    ipcRenderer.on('connection-status', (_event, status) => callback(status));
  },
  onSyncComplete: (callback: (result: { synced: number; failed: number }) => void) => {
    ipcRenderer.on('sync-complete', (_event, result) => callback(result));
  },
});
