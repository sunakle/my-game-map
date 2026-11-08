const { ipcRenderer, contextBridge } = require('electron');
contextBridge.exposeInMainWorld('mapWindow', {
  saveArchive(filename, bytes) { return ipcRenderer.invoke('mapstudio:save-archive', filename, bytes); },
  editMesh(data) { return ipcRenderer.invoke('mapstudio:mesh', data); },
  beforeClose(callback) {
    const listener = async () => { if (await callback()) ipcRenderer.send('mapstudio:saved'); };
    ipcRenderer.on('mapstudio:flush', listener);
    return () => ipcRenderer.removeListener('mapstudio:flush', listener);
  }
});
