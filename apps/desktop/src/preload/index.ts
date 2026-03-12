import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printTicket: (data: any) => ipcRenderer.invoke('print-ticket', data),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  offline: {
    getStatus: () => ipcRenderer.invoke('offline:status'),
    sync: () => ipcRenderer.invoke('offline:sync'),
  },
  onConnectionChange: (callback: (status: { online: boolean; pendingSyncs: number }) => void) => {
    ipcRenderer.on('connection-status', (_event, status) => callback(status));
  },
});
