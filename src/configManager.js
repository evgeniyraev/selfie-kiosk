const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const CONFIG_FILE_NAME = "christmass-selfy-settings.json";

const defaultConfig = {
  idleVideo: "",
  mainVideo: "",
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
  },
  resultScreen: {
    autoResetMs: 20000,
  },
  capture: {
    captureAtMs: 8500,
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

  merged.santaOverlays = Array.isArray(partialConfig.santaOverlays)
    ? partialConfig.santaOverlays
    : [];
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

const hasRequiredSettings = (config = loadConfig()) => {
  const hasVideos = Boolean(config.idleVideo && config.mainVideo);
  const hasOverlay =
    Array.isArray(config.santaOverlays) && config.santaOverlays.length > 0;
  return hasVideos && hasOverlay;
};

module.exports = {
  defaultConfig,
  getConfigPath,
  loadConfig,
  saveConfig,
  hasRequiredSettings,
};
