const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  
  // File operations
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('file:write', { filePath, data }),
  
  // App info
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  
  // Menu events
  onMenuImportPdf: (callback) => ipcRenderer.on('menu-import-pdf', callback),
  onMenuExport: (callback) => ipcRenderer.on('menu-export', callback),
  
  // Platform detection
  platform: process.platform,
  isElectron: true
});

// Log that preload script has loaded
console.log('VoterAlign Pro - Electron Preload Loaded');
