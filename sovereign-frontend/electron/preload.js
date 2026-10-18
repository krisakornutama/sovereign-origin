const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sovereign', {
  pickFile: () => ipcRenderer.invoke('sovereign:pickFile'),
  readDir: (dir) => ipcRenderer.invoke('sovereign:readDir', dir),
  // แท็บ "📣 โพสต์": เลือกวิดีโอ (ได้แค่ metadata) + เปิดโฟลเดอร์ให้เห็นไฟล์
  pickVideo: () => ipcRenderer.invoke('sovereign:pickVideo'),
  showItemInFolder: (filePath) => ipcRenderer.invoke('sovereign:showItemInFolder', filePath),
  // แท็บ "📣 โพสต์" → อัปโหลดขึ้น YouTube อัตโนมัติ (OAuth อยู่ใน main เท่านั้น
  // ⚠ ห้ามส่ง client secret / refresh token ผ่านสะพานนี้เด็ดขาด — renderer ไม่ควรเห็นค่าลับ)
  youtubeStatus: () => ipcRenderer.invoke('sovereign:youtubeStatus'),
  youtubeImportDialog: () => ipcRenderer.invoke('sovereign:youtubeImportDialog'),
  youtubeImportText: (text) => ipcRenderer.invoke('sovereign:youtubeImportText', text),
  youtubeConnect: (opts) => ipcRenderer.invoke('sovereign:youtubeConnect', opts),
  youtubeDisconnect: () => ipcRenderer.invoke('sovereign:youtubeDisconnect'),
  youtubeUpload: (req) => ipcRenderer.invoke('sovereign:youtubeUpload', req),
  youtubeCancel: () => ipcRenderer.invoke('sovereign:youtubeCancel'),
  // คืนฟังก์ชันถอนการสมัคร — ไม่งั้นสลับแท็บไปมาแล้วฟังซ้อนกันหลายรอบ (progress กระโดดมั่ว)
  onYoutubeProgress: (cb) => {
    const h = (_e, p) => { try { cb(p); } catch { /* UI พังไม่ควรทำให้ main พัง */ } };
    ipcRenderer.on('sovereign:youtubeProgress', h);
    return () => { try { ipcRenderer.removeListener('sovereign:youtubeProgress', h); } catch { /* ไม่มีอะไรต้องทำ */ } };
  },
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
