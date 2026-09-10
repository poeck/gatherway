const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gatherway', { command: (name, payload) => ipcRenderer.invoke('gatherway:settings', name, payload) });
