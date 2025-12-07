const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kioskAPI', {
  loadConfig: () => ipcRenderer.invoke('config:read'),
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config:updated', (_event, config) => {
      callback(config);
    });
  },
  openSettings: () => ipcRenderer.send('settings:show'),
  requestReset: () => ipcRenderer.send('kiosk:reset-flow'),
  generateQRCode: (text) => ipcRenderer.invoke('qrcode:generate', text),
  onResetRequest: (callback) => {
    ipcRenderer.on('kiosk:reset-requested', () => {
      callback();
    });
  }
});
