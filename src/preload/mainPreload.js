const { contextBridge, ipcRenderer } = require('electron');

const isProduction = process.env.KIOSK_RUNTIME === 'production';

contextBridge.exposeInMainWorld('kioskAPI', {
  isProduction,
  loadConfig: () => ipcRenderer.invoke('config:read'),
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config:updated', (_event, config) => {
      callback(config);
    });
  },
  openSettings: () => ipcRenderer.send('settings:show'),
  requestReset: () => ipcRenderer.send('kiosk:reset-flow'),
  generateQRCode: (text) => ipcRenderer.invoke('qrcode:generate', text),
  printPhoto: (dataUrl) => ipcRenderer.invoke('print:photo', dataUrl),
  onSheetsUpdate: (callback) => {
    ipcRenderer.on('printer:sheets', (_event, value) => callback(value));
  },
  onResetRequest: (callback) => {
    ipcRenderer.on('kiosk:reset-requested', () => {
      callback();
    });
  }
});
