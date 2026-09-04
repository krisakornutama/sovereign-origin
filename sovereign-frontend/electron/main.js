const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

let win;
let backend;

function createWindow(){
  win = new BrowserWindow({
    width: 1280, height: 800,
    show: false,
    backgroundColor: '#020617',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'Sovereign OS'
  });
  win.once('ready-to-show', ()=> win.show());
  const loadWithRetry = (url, retries=60) => {
    const tryLoad = () => {
      http.get(url, res=>{
        if(res.statusCode && res.statusCode < 400){ win.loadURL(url); }
        else if(retries>0){ setTimeout(()=> loadWithRetry(url, retries-1), 1000); }
        else { win.loadURL(url); }
      }).on('error', ()=>{
        if(retries>0) setTimeout(()=> loadWithRetry(url, retries-1), 1000);
        else win.loadURL(url);
      });
    };
    // show loading placeholder first
    win.loadURL('data:text/html,<html><body style="background:#020617;color:#10b981;display:flex;align-items:center;justify-content:center;height:100vh;font-family:monospace">Sovereign OS กำลังโหลด... ('+retries+')</body></html>');
    setTimeout(tryLoad, 500);
  };
  loadWithRetry('http://localhost:3000');
  win.webContents.on('did-fail-load', (_e, code, desc, url)=>{
    console.error('load failed', code, desc, url);
  });
  win.on('closed', ()=> win=null);
}

function startBackend(){
  try{
    const isPackaged = app.isPackaged;
    const coreApiPath = isPackaged
      ? path.join(process.resourcesPath, 'core-api/dist/server.js')
      : path.join(__dirname, '../../sovereign-os/core-api/dist/server.js');
    const cwd = isPackaged ? path.join(process.resourcesPath, 'core-api') : path.join(__dirname, '../../sovereign-os/core-api');
    if(fs.existsSync(coreApiPath)){
      backend = spawn('node', [coreApiPath], { env: { ...process.env, DATABASE_URL: 'file:' + path.join(app.getPath('userData'), 'data.db'), PORT: '3001' }, stdio: 'inherit', cwd });
      backend.on('error', e=> console.error('backend spawn error', e.message));
    } else {
      console.error('coreApi not found at', coreApiPath);
    }
  }catch(e){ console.error('startBackend failed', e.message); }
}
app.whenReady().then(()=>{
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
  startBackend();
  createWindow();
  app.on('activate', ()=> { if(BrowserWindow.getAllWindows().length===0) createWindow(); });
});

ipcMain.handle('sovereign:pickFile', async ()=> {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'All', extensions: ['*'] }] });
  if(r.canceled) return null;
  const fp = r.filePaths[0];
  try{ const data = fs.readFileSync(fp); return { path: fp, size: data.length, name: path.basename(fp) }; }catch(e){ return { path: fp, error: e.message }; }
});
ipcMain.handle('sovereign:readDir', async (_e, dir)=> {
  try{ const list = fs.readdirSync(dir || 'C:\\', { withFileTypes: true }); return list.map(d=>({ name:d.name, isDir:d.isDirectory() })).slice(0,200); }catch(e){ return { error: e.message }; }
});

app.on('window-all-closed', ()=>{
  if(process.platform!=='darwin') app.quit();
});
