const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const CONFIG_FILE_NAME = "christmass-selfy-settings.json";

const DEFAULT_STAGE_WIDTH = 1080;
const DEFAULT_STAGE_HEIGHT = 1920;
const DEFAULT_RECTANGLE_WIDTH_RATIO = 0.9;
const DEFAULT_RECTANGLE_HEIGHT_RATIO = 0.75;
const DEFAULT_RECTANGLE_TOP_PX = 157;
const STAGE_RATIO = DEFAULT_STAGE_WIDTH / DEFAULT_STAGE_HEIGHT;

const DEFAULT_PRINTER = {
  deviceName: "",
  paperWidthMm: 150,
  paperHeightMm: 100,
  sheetsRemaining: 0,
};

const FALLBACK_PRINTER_ASPECT =
  DEFAULT_PRINTER.paperWidthMm / DEFAULT_PRINTER.paperHeightMm;

const clampNormalized = (value, min = 0, max = 1) =>
  Math.min(Math.max(value, min), max);

const getPrinterAspectRatioValue = (printer = DEFAULT_PRINTER) => {
  const width = Number(printer?.paperWidthMm);
  const height = Number(printer?.paperHeightMm);
  if (width > 0 && height > 0) {
    return width / height;
  }
  return FALLBACK_PRINTER_ASPECT;
};

const computeDefaultPreviewQuad = (printer = DEFAULT_PRINTER) => {
  const aspect = Math.max(getPrinterAspectRatioValue(printer), 0.01);
  const normalizedAspect = aspect / STAGE_RATIO;
  const topNormalized = clampNormalized(
    DEFAULT_RECTANGLE_TOP_PX / DEFAULT_STAGE_HEIGHT,
    0,
    0.95,
  );
  const maxHeight = 1 - topNormalized;
  let heightNormalized = Math.min(
    clampNormalized(DEFAULT_RECTANGLE_HEIGHT_RATIO),
    maxHeight,
  );
  let widthNormalized = heightNormalized * normalizedAspect;
  if (widthNormalized > 1) {
    const scale = 1 / widthNormalized;
    widthNormalized = 1;
    heightNormalized = Math.min(heightNormalized * scale, maxHeight);
  }
  const leftNormalized = clampNormalized((1 - widthNormalized) / 2);
  const rightNormalized = clampNormalized(leftNormalized + widthNormalized);
  const bottomNormalized = clampNormalized(topNormalized + heightNormalized);
  return [
    { x: leftNormalized, y: topNormalized },
    { x: rightNormalized, y: topNormalized },
    { x: rightNormalized, y: bottomNormalized },
    { x: leftNormalized, y: bottomNormalized },
  ];
};

const defaultConfig = {
  idleVideo: "",
  mainVideo: "",
  idleVideos: [],
  mainVideos: [],
  backupDirectory: "",
  previewShape: "rectangle",
  previewQuad: computeDefaultPreviewQuad(DEFAULT_PRINTER),
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
    ...DEFAULT_PRINTER,
  },
  mirrorCamera: true,
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
  merged.mainVideos = normalizeMainVideos(merged);
  merged.mainVideo = merged.mainVideos[0]?.path || "";
  merged.mirrorCamera =
    typeof partialConfig.mirrorCamera === "boolean"
      ? partialConfig.mirrorCamera
      : defaultConfig.mirrorCamera;

  merged.santaOverlays = Array.isArray(partialConfig.santaOverlays)
    ? partialConfig.santaOverlays
    : [];
  merged.backupDirectory =
    typeof partialConfig.backupDirectory === "string"
      ? partialConfig.backupDirectory.trim()
      : "";
  const requestedShape = partialConfig.previewShape;
  if (requestedShape === "rectangle" || requestedShape === "free") {
    merged.previewShape = requestedShape;
  } else {
    merged.previewShape = defaultConfig.previewShape;
  }
  merged.printer.sheetsRemaining = Math.max(
    0,
    Number(merged.printer.sheetsRemaining) || 0,
  );
  if ("shareBaseUrl" in merged) {
    delete merged.shareBaseUrl;
  }
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

  return normalizePreviewQuad(
    computeDefaultPreviewQuad({
      paperWidthMm:
        partialConfig?.printer?.paperWidthMm ?? DEFAULT_PRINTER.paperWidthMm,
      paperHeightMm:
        partialConfig?.printer?.paperHeightMm ?? DEFAULT_PRINTER.paperHeightMm,
    }),
  );
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

const normalizeMainVideos = (config) => {
  const fallbackVisibility =
    config.previewVisibility || defaultConfig.previewVisibility;
  const list = Array.isArray(config.mainVideos) ? config.mainVideos : [];
  const normalized = [];
  const seen = new Map();

  const addEntry = (item) => {
    const entry = buildVideoEntry(item, fallbackVisibility);
    if (!entry) {
      return;
    }
    if (seen.has(entry.path)) {
      const index = seen.get(entry.path);
      normalized[index] = mergeVideoEntries(normalized[index], entry);
    } else {
      seen.set(entry.path, normalized.length);
      normalized.push(entry);
    }
  };

  list.forEach(addEntry);

  if (typeof config.mainVideo === "string" && config.mainVideo) {
    addEntry(config.mainVideo);
  }

  return normalized;
};

const buildVideoEntry = (item, fallbackVisibility) => {
  if (!item) {
    return null;
  }
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed ? { path: trimmed } : null;
  }
  if (typeof item !== "object") {
    return null;
  }
  const path = typeof item.path === "string" ? item.path.trim() : "";
  if (!path) {
    return null;
  }
  const entry = { path };
  if (Array.isArray(item.previewQuad) && item.previewQuad.length === 4) {
    entry.previewQuad = normalizePreviewQuad(item.previewQuad);
  }
  const visibility = normalizePreviewWindow(
    item.previewVisibility,
    fallbackVisibility,
  );
  if (visibility) {
    entry.previewVisibility = visibility;
  }
  return entry;
};

const mergeVideoEntries = (base, incoming) => {
  const next = { ...base };
  if (incoming.previewQuad) {
    next.previewQuad = incoming.previewQuad;
  }
  if (incoming.previewVisibility) {
    next.previewVisibility = incoming.previewVisibility;
  }
  return next;
};

const normalizePreviewWindow = (value, fallback = {}) => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const hasStart = typeof value.startMs === "number";
  const hasEnd = typeof value.endMs === "number";
  if (!hasStart && !hasEnd) {
    return undefined;
  }

  const baseStart =
    typeof fallback.startMs === "number"
      ? fallback.startMs
      : defaultConfig.previewVisibility.startMs;
  let startMs = hasStart
    ? clampNumber(value.startMs, 0, Number.MAX_SAFE_INTEGER)
    : baseStart;

  const minEnd = startMs + 250;
  const fallbackEnd =
    typeof fallback.endMs === "number"
      ? Math.max(fallback.endMs, minEnd)
      : minEnd;
  let endMs = hasEnd
    ? clampNumber(value.endMs, minEnd, Number.MAX_SAFE_INTEGER)
    : fallbackEnd;

  return { startMs, endMs };
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
