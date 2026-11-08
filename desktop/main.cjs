const { app, BrowserWindow, ipcMain, Menu, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'mapstudio', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.MAPSTUDIO_TEST_PROFILE) app.setPath('userData', process.env.MAPSTUDIO_TEST_PROFILE);
app.whenReady().then(() => {
  const root = path.resolve(__dirname, '../dist');
  protocol.handle('mapstudio', request => {
    const url = new URL(request.url);
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (url.host !== 'editor' || !file.startsWith(root + path.sep)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    icon: path.join(__dirname, 'map-studio.png'),
    title: 'Мастерская карт', width: 1440, height: 920, minWidth: 840, minHeight: 580, backgroundColor: '#303136',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('mapstudio://editor/')) event.preventDefault(); });
  let readyToClose = false;
  window.on('close', event => {
    if (!readyToClose && !window.webContents.isLoading() && !window.webContents.isCrashed()) {
      event.preventDefault();
      window.webContents.send('mapstudio:flush');
    }
  });
  ipcMain.on('mapstudio:saved', event => {
    if (event.sender !== window.webContents) return;
    readyToClose = true;
    window.close();
  });
  ipcMain.handle('mapstudio:save-archive', async(event, filename, bytes)=>{
    if(event.sender!==window.webContents || event.senderFrame?.url!=='mapstudio://editor/') throw Error('Неизвестное окно.');
    if(!(bytes instanceof Uint8Array) || bytes.length>30*1024*1024)throw Error('Превышен размер архива.');
    const {dialog}=require('electron'),fs=require('node:fs/promises'),crypto=require('node:crypto');
    const {canceled,filePath}=await dialog.showSaveDialog(window,{title:'Сохранить архив карты',defaultPath:path.basename(filename),filters:[{name:'Архив карты',extensions:['zip']}]});
    if(canceled||!filePath)return false;
    const tmp=path.join(path.dirname(filePath),'mapstudio-'+crypto.randomUUID()+'.tmp');
    try{await fs.writeFile(tmp,bytes,{flag:'wx'});await fs.rename(tmp,filePath);}
    finally{await fs.unlink(tmp).catch(()=>{});}
    return true;
  });
  ipcMain.handle('mapstudio:mesh', (event, data) => {
    if(event.sender !== window.webContents || event.senderFrame?.url !== 'mapstudio://editor/') throw Error('Неизвестное окно.');
    return require('./mesh-session.cjs').start(window,data);
  });
  window.loadURL('mapstudio://editor/');
});
app.on('window-all-closed', () => app.quit());
