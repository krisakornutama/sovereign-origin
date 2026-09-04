const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

function createWindow(){
  win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'Sovereign OS'
  });
  const outPath = path.join(__dirname, '../out/index.html');
  if(fs.existsSync(outPath)){
    win.loadFile(outPath);
  } else {
    win.loadURL('http://localhost:3000');
  }
  win.webContents.on('did-fail-load', (_e, code, desc, url)=>{
    console.error('load failed', code, desc, url);
    if(url.startsWith('http://localhost:3000') && fs.existsSync(outPath)) win.loadFile(outPath);
  });
  win.on('closed', ()=> win=null);
}

function startBackend(){
  try{
    const coreApiPath = path.join(__dirname, '../../sovereign-os/core-api/dist/server.js');
    if(fs.existsSync(coreApiPath)){
      backend = spawn('node', [coreApiPath], { env: { ...process.env, DATABASE_URL: 'file:' + path.join(app.getPath('userData'), 'data.db'), PORT: '3001' }, stdio: 'inherit', cwd: path.join(__dirname, '../../sovereign-os/core-api') });
      backend.on('error', e=> console.error('backend spawn error', e.message));
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
