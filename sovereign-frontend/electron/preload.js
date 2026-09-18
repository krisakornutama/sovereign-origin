const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sovereign', {
  pickFile: () => ipcRenderer.invoke('sovereign:pickFile'),
  readDir: (dir) => ipcRenderer.invoke('sovereign:readDir', dir),
  // สถานะระบบ + ปุ่มควบคุม (หน้า offline)
  getStatus: () => ipcRenderer.invoke('sovereign:getStatus'),
  startSystem: () => ipcRenderer.invoke('sovereign:startSystem'),
  isAutoStarted: () => ipcRenderer.invoke('sovereign:isAutoStarted'),
  openExternal: (url) => ipcRenderer.invoke('sovereign:openExternal', url),
  retryDashboard: () => ipcRenderer.invoke('sovereign:retryDashboard'),
  // setup wizard + อัปเดต
  openWizard: (focus) => ipcRenderer.invoke('sovereign:openWizard', focus),
  pickInstallDir: () => ipcRenderer.invoke('sovereign:pickInstallDir'),
  checkEnv: () => ipcRenderer.invoke('sovereign:checkEnv'),
  getSetupDir: () => ipcRenderer.invoke('sovereign:getSetupDir'),
  beginSetup: (dir) => ipcRenderer.invoke('sovereign:beginSetup', dir),
  checkUpdates: () => ipcRenderer.invoke('sovereign:checkUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('sovereign:downloadUpdate'),
  onUpdate: (cb) => ipcRenderer.on('sovereign:update', (_e, r) => cb(r)),
  onWizardFocus: (cb) => ipcRenderer.on('sovereign:wizardFocus', (_e, f) => cb(f)),
  onStatus: (cb) => ipcRenderer.on('sovereign:status', (_e, st) => cb(st)),
  onAutostart: (cb) => ipcRenderer.on('sovereign:autostart', (_e, r) => cb(r)),
});
