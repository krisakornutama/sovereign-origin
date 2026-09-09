const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sovereign', {
  pickFile: () => ipcRenderer.invoke('sovereign:pickFile'),
  readDir: (dir) => ipcRenderer.invoke('sovereign:readDir', dir),
  // สถานะระบบ + ปุ่มควบคุม (หน้า offline)
  getStatus: () => ipcRenderer.invoke('sovereign:getStatus'),
  startSystem: () => ipcRenderer.invoke('sovereign:startSystem'),
  openExternal: (url) => ipcRenderer.invoke('sovereign:openExternal', url),
  retryDashboard: () => ipcRenderer.invoke('sovereign:retryDashboard'),
  onStatus: (cb) => ipcRenderer.on('sovereign:status', (_e, st) => cb(st)),
});
