const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const QRCode = require("qrcode");
const {
  loadConfig,
  saveConfig,
  resetConfig,
  hasRequiredSettings,
} = require("./configManager");

const isProductionBuild =
  app.isPackaged || process.env.NODE_ENV === "production";
const isDev = !isProductionBuild;
process.env.KIOSK_RUNTIME = isProductionBuild ? "production" : "development";

let mainWindow;
let settingsWindow;

const MAIN_ASPECT_RATIO = 9 / 16;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_WIDTH = Math.round(DEFAULT_HEIGHT * MAIN_ASPECT_RATIO);

const getDefaultBackupDir = () => {
  return path.join(app.getPath("userData"), "backups");
};

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const resolveBackupDir = () => {
  const config = loadConfig();
  const custom =
    typeof config.backupDirectory === "string"
      ? config.backupDirectory.trim()
      : "";
  const targetDir = custom || getDefaultBackupDir();
  try {
    ensureDir(targetDir);
    return targetDir;
  } catch (error) {
    console.warn("Failed to use custom backup directory", error);
    const fallback = getDefaultBackupDir();
    ensureDir(fallback);
    return fallback;
  }
};

const saveBackupPhotoToDisk = async (dataUrl, reason = "backup") => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("Invalid image data.");
  }
  const matches = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!matches) {
    throw new Error("Unsupported image format.");
  }
  const extension =
    matches[1].toLowerCase() === "jpeg" ? "jpg" : matches[1].toLowerCase();
  const buffer = Buffer.from(matches[2], "base64");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeReason =
    (reason || "backup")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "backup";
  const filename = `${timestamp}-${safeReason}.${extension}`;
  const targetPath = path.join(resolveBackupDir(), filename);
  await fs.promises.writeFile(targetPath, buffer);
  return targetPath;
};

const createMainWindow = () => {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    fullscreen: isProductionBuild,
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
  if (isProductionBuild) {
    mainWindow.setFullScreen(true);
  }

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

ipcMain.handle("config:reset", async () => {
  const fresh = resetConfig();
  if (mainWindow) {
    mainWindow.webContents.send("config:updated", fresh);
  }
  if (settingsWindow) {
    settingsWindow.webContents.send("config:updated", fresh);
  }
  return fresh;
});

ipcMain.handle("dialog:select", async (_event, options) => {
  const allowDirectory = options?.directory === true;
  const properties = [
    allowDirectory ? "openDirectory" : "openFile",
    ...(options?.allowMultiple ? ["multiSelections"] : []),
  ];
  const result = await dialog.showOpenDialog({
    properties,
    filters: allowDirectory ? undefined : options?.filters || [],
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

ipcMain.handle("print:photo", async (_event, imageDataUrl) => {
  if (!imageDataUrl) {
    throw new Error("No image data provided");
  }
  const config = loadConfig();
  const printer = config.printer || {};
  if (!printer.deviceName) {
    throw new Error("Printer device name is not configured.");
  }
  await printImage(imageDataUrl, printer);
  if (printer.sheetsRemaining > 0) {
    const updated = saveConfig({
      printer: {
        ...printer,
        sheetsRemaining: Math.max(0, printer.sheetsRemaining - 1),
      },
    });
    if (mainWindow) {
      mainWindow.webContents.send(
        "printer:sheets",
        updated.printer?.sheetsRemaining ?? 0,
      );
    }
    if (settingsWindow) {
      settingsWindow.webContents.send(
        "printer:sheets",
        updated.printer?.sheetsRemaining ?? 0,
      );
    }
  }
  return { success: true };
});

ipcMain.handle("backup:savePhoto", async (_event, payload = {}) => {
  const { imageData, reason } = payload;
  if (!imageData) {
    throw new Error("Missing image data for backup.");
  }
  return saveBackupPhotoToDisk(imageData, reason);
});

ipcMain.handle("backup:getDefaultDir", async () => {
  return getDefaultBackupDir();
});

ipcMain.on("settings:show", () => {
  ensureSettingsWindow();
});

ipcMain.on("kiosk:reset-flow", () => {
  if (mainWindow) {
    mainWindow.webContents.send("kiosk:reset-requested");
  }
});

const printImage = async (imageDataUrl, printer) => {
  const widthMm = printer.paperWidthMm || 150;
  const heightMm = printer.paperHeightMm || 100;

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
    },
  });

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: ${heightMm}mm ${widthMm}mm landscape; margin: 0;  }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        background: #000;
      }
      img {
        width: 100%;
        height: 100%;
        display: block;
      }
    </style>
  </head>
  <body>
    <img src="${imageDataUrl}" />
  </body>
</html>`;

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      printWindow.webContents.removeListener("did-fail-load", onFail);
      printWindow.webContents.removeListener("did-finish-load", onFinish);
    };
    const onFail = (_event, errorCode, errorDesc) => {
      cleanup();
      reject(
        new Error(
          `Print preview failed to load (${errorCode}): ${errorDesc || "Unknown error"}`,
        ),
      );
    };
    const onFinish = async () => {
      try {
        await printWindow.webContents.executeJavaScript(`
          document.open();
          document.write(${JSON.stringify(html)});
          document.close();
        `);
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    printWindow.webContents.once("did-fail-load", onFail);
    printWindow.webContents.once("did-finish-load", onFinish);
    printWindow.loadURL("about:blank").catch((error) => {
      cleanup();
      reject(error);
    });
  });

  await new Promise((resolve, reject) => {
    printWindow.webContents.print(
      {
        silent: true,
        deviceName: printer.deviceName,
        printBackground: true,
        landscape: widthMm >= heightMm,
        margins: {
          marginType: "none",
        },
        pageSize: {
          width: Math.round(widthMm * 1000),
          height: Math.round(heightMm * 1000),
        },
      },
      (success, failureReason) => {
        printWindow.close();
        if (success) {
          resolve();
        } else {
          reject(new Error(failureReason || "Print job failed"));
        }
      },
    );
  });
};
