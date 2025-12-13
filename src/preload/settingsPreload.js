const { contextBridge, ipcRenderer } = require('electron');

const videoFilters = [
  { name: 'Video', extensions: ['mp4', 'mov', 'webm'] }
];

const imageFilters = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
];

contextBridge.exposeInMainWorld('settingsAPI', {
  loadConfig: () => ipcRenderer.invoke('config:read'),
  saveConfig: (payload) => ipcRenderer.invoke('config:write', payload),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  selectVideo: async () => {
    const [selection] = await ipcRenderer.invoke('dialog:select', {
      filters: videoFilters
    });
    return selection || '';
  },
  selectVideos: async () => {
    const selections = await ipcRenderer.invoke('dialog:select', {
      allowMultiple: true,
      filters: videoFilters
    });
    return selections || [];
  },
  selectImages: async () => {
    const selections = await ipcRenderer.invoke('dialog:select', {
      allowMultiple: true,
      filters: imageFilters
    });
    return selections || [];
  },
  selectDirectory: async () => {
    const selections = await ipcRenderer.invoke('dialog:select', {
      directory: true
    });
    return selections?.[0] || '';
  },
  getDefaultBackupDir: () => ipcRenderer.invoke('backup:getDefaultDir'),
  reopenKioskFlow: () => ipcRenderer.send('kiosk:reset-flow'),
  focusSettings: () => ipcRenderer.send('settings:show'),
  onSheetsUpdate: (callback) => {
    ipcRenderer.on('printer:sheets', (_event, value) => callback(value));
  }
});
