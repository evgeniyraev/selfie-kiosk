const path = require("path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const QRCode = require("qrcode");
const {
  loadConfig,
  saveConfig,
  hasRequiredSettings,
} = require("./configManager");

const isDev = process.env.NODE_ENV !== "production";

let mainWindow;
let settingsWindow;

const MAIN_ASPECT_RATIO = 9 / 16;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_WIDTH = Math.round(DEFAULT_HEIGHT * MAIN_ASPECT_RATIO);

const createMainWindow = () => {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    fullscreen: !isDev,
    resizable: isDev,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload", "mainPreload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "main", "index.html"));
  mainWindow.setAspectRatio(MAIN_ASPECT_RATIO);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
};

const createSettingsWindow = () => {
  if (settingsWindow) {
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Settings",
    backgroundColor: "#111111",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload", "settingsPreload.js"),
    },
  });

  settingsWindow.loadFile(
    path.join(__dirname, "renderer", "settings", "index.html"),
  );

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  return settingsWindow;
};

const ensureSettingsWindow = () => {
  const window = createSettingsWindow();
  window.show();
};

app.whenReady().then(() => {
  const config = loadConfig();
  createMainWindow();

  if (!hasRequiredSettings(config)) {
    ensureSettingsWindow();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("config:read", async () => {
  return loadConfig();
});

ipcMain.handle("config:write", async (_event, payload) => {
  const stored = saveConfig(payload);
  if (mainWindow) {
    mainWindow.webContents.send("config:updated", stored);
  }
  return stored;
});

ipcMain.handle("dialog:select", async (_event, options) => {
  const result = await dialog.showOpenDialog({
    properties: [
      "openFile",
      ...(options?.allowMultiple ? ["multiSelections"] : []),
    ],
    filters: options?.filters || [],
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

ipcMain.handle("qrcode:generate", async (_event, text) => {
  const value =
    typeof text === "string" && text.length
      ? text
      : "https://example.com/selfy";
  return QRCode.toDataURL(value);
});

ipcMain.on("settings:show", () => {
  ensureSettingsWindow();
});

ipcMain.on("kiosk:reset-flow", () => {
  if (mainWindow) {
    mainWindow.webContents.send("kiosk:reset-requested");
  }
});
