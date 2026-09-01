const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win;
let backend;

function createWindow(){
  win = new BrowserWindow({
    width: 1280, height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    icon: path.join(__dirname, '../public/icon.png'),
    title: 'Sovereign OS'
  });
  win.loadURL('http://localhost:3000');
  win.on('closed', ()=> win=null);
}

app.whenReady().then(()=>{
  // try to ensure backend is running (docker compose up if needed)
  // for now just open window, backend is expected via Docker Desktop
  createWindow();
  app.on('activate', ()=> { if(BrowserWindow.getAllWindows().length===0) createWindow(); });
});

app.on('window-all-closed', ()=>{
  if(process.platform!=='darwin') app.quit();
});
