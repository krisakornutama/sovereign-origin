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
  win.loadURL('http://localhost:3000');
  win.on('closed', ()=> win=null);
}

app.whenReady().then(()=>{
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
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
