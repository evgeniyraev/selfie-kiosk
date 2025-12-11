const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const CONFIG_FILE_NAME = "christmass-selfy-settings.json";

const defaultConfig = {
  idleVideo: "",
  mainVideo: "",
  idleVideos: [],
  mainVideos: [],
  shareBaseUrl: "https://example.com/events/christmas",
  previewQuad: [
    { x: 0.58, y: 0.18 },
    { x: 0.9, y: 0.2 },
    { x: 0.92, y: 0.58 },
    { x: 0.6, y: 0.62 },
  ],
  previewVisibility: {
    startMs: 4000,
    endMs: 7500,
    frameRate: 30,
  },
  resultScreen: {
    autoResetMs: 20000,
  },
  capture: {
    captureAtMs: 8500,
  },
  printer: {
    deviceName: "",
    paperWidthMm: 152,
    paperHeightMm: 102,
    sheetsRemaining: 0,
  },
  santaOverlays: [],
};

let cachedConfig;

const getConfigPath = () => {
  const userData = app.getPath("userData");
  return path.join(userData, CONFIG_FILE_NAME);
};

const readConfigFromDisk = () => {
  const filePath = getConfigPath();
  if (!fs.existsSync(filePath)) {
    return { ...defaultConfig };
  }

  try {
    const file = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(file);
    return mergeWithDefaults(parsed);
  } catch (error) {
    console.error("Failed to read config, falling back to defaults", error);
    return { ...defaultConfig };
  }
};

const mergeWithDefaults = (partialConfig = {}) => {
  const previewQuad = resolvePreviewQuad(partialConfig);

  const merged = {
    ...defaultConfig,
    ...partialConfig,
    previewQuad,
    previewVisibility: {
      ...defaultConfig.previewVisibility,
      ...(partialConfig.previewVisibility || {}),
    },
    resultScreen: {
      ...defaultConfig.resultScreen,
      ...(partialConfig.resultScreen || {}),
    },
    printer: {
      ...defaultConfig.printer,
      ...(partialConfig.printer || {}),
    },
    capture: {
      ...defaultConfig.capture,
      ...(partialConfig.capture || {}),
    },
  };

  if (!merged.previewVisibility.startMs && partialConfig.capture?.previewAtMs) {
    merged.previewVisibility.startMs = partialConfig.capture.previewAtMs;
  }

  merged.previewVisibility.endMs =
    merged.previewVisibility.endMs || merged.capture.captureAtMs;
  merged.previewVisibility.startMs = Math.max(
    0,
    merged.previewVisibility.startMs || 0,
  );
  merged.previewVisibility.endMs = Math.max(
    merged.previewVisibility.startMs + 250,
    merged.previewVisibility.endMs || merged.previewVisibility.startMs + 250,
  );
  const frameRate =
    Number(merged.previewVisibility.frameRate) ||
    Number(partialConfig.previewVisibility?.frameRate) ||
    defaultConfig.previewVisibility.frameRate;
  merged.previewVisibility.frameRate = clampNumber(frameRate, 1, 240);

  normalizeMediaList(merged, "idleVideos", "idleVideo");
  normalizeMediaList(merged, "mainVideos", "mainVideo");

  merged.santaOverlays = Array.isArray(partialConfig.santaOverlays)
    ? partialConfig.santaOverlays
    : [];
  merged.printer.sheetsRemaining = Math.max(
    0,
    Number(merged.printer.sheetsRemaining) || 0,
  );
  return merged;
};

const resolvePreviewQuad = (partialConfig) => {
  if (
    Array.isArray(partialConfig.previewQuad) &&
    partialConfig.previewQuad.length === 4
  ) {
    return normalizePreviewQuad(partialConfig.previewQuad);
  }

  if (partialConfig.previewRegion) {
    return normalizePreviewQuad(
      convertRegionToQuad(partialConfig.previewRegion),
    );
  }

  return normalizePreviewQuad(defaultConfig.previewQuad);
};

const convertRegionToQuad = (region) => {
  const { x = 0, y = 0, width = 1, height = 1 } = region;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
};

const normalizePreviewQuad = (quad) => {
  return quad.slice(0, 4).map((point, index) => ({
    x: clamp(
      typeof point?.x === "number"
        ? point.x
        : defaultConfig.previewQuad[index].x,
    ),
    y: clamp(
      typeof point?.y === "number"
        ? point.y
        : defaultConfig.previewQuad[index].y,
    ),
  }));
};

const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

const clampNumber = (value, min, max) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

const normalizeMediaList = (config, listKey, singleKey) => {
  const listValue = toStringArray(config[listKey]);
  const singleValue =
    typeof config[singleKey] === "string" && config[singleKey]
      ? [config[singleKey]]
      : [];
  const normalized = dedupeStrings([...singleValue, ...listValue]);
  config[listKey] = normalized;
  config[singleKey] = normalized[0] || "";
};

const toStringArray = (value) => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item);
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
};

const dedupeStrings = (list = []) => {
  const seen = new Set();
  const result = [];
  list.forEach((item) => {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  });
  return result;
};

const loadConfig = () => {
  if (!cachedConfig) {
    cachedConfig = readConfigFromDisk();
  }
  return cachedConfig;
};

const saveConfig = (partialConfig) => {
  const nextConfig = mergeWithDefaults({
    ...loadConfig(),
    ...partialConfig,
  });

  cachedConfig = nextConfig;
  fs.writeFileSync(
    getConfigPath(),
    JSON.stringify(nextConfig, null, 2),
    "utf-8",
  );
  return cachedConfig;
};

const resetConfig = () => {
  const filePath = getConfigPath();
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.warn("Failed to remove config file", error);
    }
  }
  cachedConfig = null;
  return loadConfig();
};

const hasRequiredSettings = (config = loadConfig()) => {
  const idlePool = Array.isArray(config.idleVideos)
    ? config.idleVideos.length
    : 0;
  const mainPool = Array.isArray(config.mainVideos)
    ? config.mainVideos.length
    : 0;
  const hasIdle = idlePool > 0 || Boolean(config.idleVideo);
  const hasMain = mainPool > 0 || Boolean(config.mainVideo);
  const hasOverlay =
    Array.isArray(config.santaOverlays) && config.santaOverlays.length > 0;
  return hasIdle && hasMain && hasOverlay;
};

module.exports = {
  defaultConfig,
  getConfigPath,
  loadConfig,
  saveConfig,
  resetConfig,
  hasRequiredSettings,
};
