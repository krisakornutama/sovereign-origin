const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sovereign', {
  pickFile: ()=> ipcRenderer.invoke('sovereign:pickFile'),
  readDir: (dir)=> ipcRenderer.invoke('sovereign:readDir', dir)
});
