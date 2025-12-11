(() => {
  const SETTINGS_HOLD_MS = 5000;
  const RETRY_LEAD_MS = 5000;

  const state = {
    config: null,
    flow: "idle",
    previewShowTimer: null,
    previewHideTimer: null,
    autoResetTimer: null,
    webcamStream: null,
    lastPhotoDataUrl: null,
    shareLink: null,
    previewVisible: false,
    isPrinting: false,
    pendingOverlayPath: "",
    currentIdleVideo: "",
    currentMainVideo: null,
    settingsHoldTimer: null,
    qrVisible: false,
    isProduction: Boolean(window.kioskAPI?.isProduction),
  };

  const elements = {
    body: document.body,
    videoStage: document.getElementById("videoStage"),
    idleVideo: document.getElementById("idleVideo"),
    mainVideo: document.getElementById("mainVideo"),
    previewRegion: document.getElementById("previewRegion"),
    webcamPreview: document.getElementById("webcamPreview"),
    previewOverlay: document.getElementById("previewOverlay"),
    resultPanel: document.getElementById("resultPanel"),
    resultPhoto: document.getElementById("resultPhoto"),
    qrPreview: document.getElementById("qrPreview"),
    shareLink: document.getElementById("shareLink"),
    printBtn: document.getElementById("printBtn"),
    retryBtn: document.getElementById("retryBtn"),
    qrToggleBtn: document.getElementById("qrToggleBtn"),
    qrDrawer: document.getElementById("qrDrawer"),
    cornerSettingsBtn: document.getElementById("cornerSettingsBtn"),
    messagePanel: document.getElementById("messagePanel"),
    messageText: document.getElementById("messageText"),
    messageSettingsBtn: document.getElementById("messageSettingsBtn"),
    sheetsLeft: document.getElementById("sheetsLeft"),
    printStatus: document.getElementById("printStatus"),
  };

  const init = async () => {
    attachEventListeners();
    const initialConfig = await window.kioskAPI.loadConfig();
    applyConfig(initialConfig);

    window.kioskAPI.onConfigUpdated((config) => {
      applyConfig(config);
    });

    if (window.kioskAPI.onSheetsUpdate) {
      window.kioskAPI.onSheetsUpdate((count) => {
        if (!state.config) {
          state.config = {};
        }
        state.config.printer = {
          ...(state.config.printer || {}),
          sheetsRemaining: count,
        };
        updateSheetDisplay();
      });
    }

    window.kioskAPI.onResetRequest(() => {
      resetFlow();
    });
  };

  const attachEventListeners = () => {
    elements.videoStage.addEventListener("pointerdown", () => {
      if (state.flow === "idle") {
        startCaptureFlow();
      }
    });

    elements.mainVideo.addEventListener("ended", () => {
      if (state.previewHideTimer) {
        clearTimeout(state.previewHideTimer);
        state.previewHideTimer = null;
      }
      if (state.flow !== "result") {
        capturePhoto();
      }
    });

    if (elements.retryBtn) {
      elements.retryBtn.addEventListener("click", () => handleRetry());
    }
    elements.printBtn.addEventListener("click", () => handlePrint());
    if (elements.qrToggleBtn) {
      elements.qrToggleBtn.addEventListener("click", () => toggleQRDrawer());
    }

    if (elements.cornerSettingsBtn) {
      elements.cornerSettingsBtn.addEventListener("pointerdown", (event) =>
        handleCornerPress(event),
      );
      ["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
        elements.cornerSettingsBtn.addEventListener(type, () => {
          clearSettingsHoldTimer();
        });
      });
    }
    elements.messageSettingsBtn.addEventListener("click", (event) =>
      openSettings(event),
    );
    window.addEventListener("resize", applyPreviewTransform);
    window.addEventListener("keydown", (event) => {
      handleAdminShortcut(event);
    });
  };

  const applyConfig = (config) => {
    state.config = config;
    state.pendingOverlayPath = "";
    state.currentIdleVideo = "";
    state.currentMainVideo = null;
    state.qrVisible = false;
    const ready = hasValidConfig(config);
    toggleMessage(
      !ready,
      "Please finish configuring videos and overlays to start.",
    );

    elements.mainVideo.muted = false;
    elements.mainVideo.volume = 1;
    applyPreviewTransform();
    updatePreviewOverlay();
    updateMirrorPreviewState();
    updateSheetDisplay();
    updatePrintButtonState();
    setPrintStatus(
      state.config?.printer?.deviceName
        ? ""
        : "Configure printer in Settings to enable printing.",
    );
    closeQRDrawer();
    resetFlow();

    if (ready) {
      ensureWebcamStream();
    }
  };

  const hasValidConfig = (config) => {
    if (
      !config ||
      !Array.isArray(config.santaOverlays) ||
      config.santaOverlays.length === 0
    ) {
      return false;
    }
    const idlePool = Array.isArray(config.idleVideos)
      ? config.idleVideos.length
      : 0;
    const mainPool = Array.isArray(config.mainVideos)
      ? config.mainVideos.length
      : 0;
    return idlePool > 0 && mainPool > 0;
  };

  const toggleMessage = (isVisible, text = "") => {
    if (isVisible) {
      elements.messagePanel.classList.remove("hidden");
      elements.messageText.textContent = text;
    } else {
      elements.messagePanel.classList.add("hidden");
    }
  };

  const setFlow = (nextFlow) => {
    state.flow = nextFlow;
    elements.body.dataset.flow = nextFlow;

    elements.idleVideo.classList.toggle("visible", nextFlow === "idle");
    elements.mainVideo.classList.toggle(
      "visible",
      nextFlow === "preparing" || nextFlow === "capturing",
    );

    elements.resultPanel.classList.toggle("hidden", nextFlow !== "result");
    if (nextFlow !== "result") {
      closeQRDrawer();
    }
    updateIdlePlayback(nextFlow === "idle");
  };

  const startCaptureFlow = (options = {}) => {
    if (!hasValidConfig(state.config)) {
      toggleMessage(true, "Configure sources before starting.");
      return;
    }

    clearTimers();
    if (!prepareMainVideoForFlow()) {
      toggleMessage(true, "Add at least one main experience video to start.");
      resetFlow();
      return;
    }
    setFlow("preparing");
    state.pendingOverlayPath = pickOverlay();
    updatePreviewOverlay();
    updateMirrorPreviewState();

    const previewWindow = getPreviewWindow();
    const leadInMs = Math.max(0, options.leadInMs || 0);
    const resumeSeconds =
      leadInMs > 0
        ? Math.max(0, previewWindow.startMs - leadInMs) / 1000
        : 0;
    seekMainVideo(resumeSeconds);
    elements.mainVideo.play().catch(() => {});

    const startWindowMs = previewWindow.startMs;
    const endWindowMs = previewWindow.endMs;

    state.previewShowTimer = setTimeout(() => {
      state.previewShowTimer = null;
      if (state.flow === "result") {
        return;
      }
      setFlow("capturing");
      setPreviewVisibility(true);
    }, startWindowMs);

    state.previewHideTimer = setTimeout(() => {
      state.previewHideTimer = null;
      capturePhoto();
    }, endWindowMs);
  };

  const resetFlow = () => {
    clearTimers();
    elements.mainVideo.pause();
    elements.mainVideo.currentTime = 0;
    state.lastPhotoDataUrl = null;
    state.pendingOverlayPath = "";
    updatePreviewOverlay();
    setPreviewVisibility(false);
    closeQRDrawer();
    prepareIdleVideo({ forceDifferent: true });
    setFlow("idle");
    updatePrintButtonState();
    setPrintStatus("");
  };

  const clearTimers = () => {
    [
      state.previewShowTimer,
      state.previewHideTimer,
      state.autoResetTimer,
    ].forEach((timer) => {
      if (timer) {
        clearTimeout(timer);
      }
    });

    state.previewShowTimer = null;
    state.previewHideTimer = null;
    state.autoResetTimer = null;
  };

  const ensureWebcamStream = async () => {
    if (state.webcamStream) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      state.webcamStream = stream;
      elements.webcamPreview.srcObject = stream;
      updateMirrorPreviewState();
    } catch (error) {
      console.error("Failed to access camera", error);
      toggleMessage(true, "Camera permission is required to continue.");
    }
  };

  const capturePhoto = async ({ hidePreview = true } = {}) => {
    if (state.flow === "result") {
      return;
    }

    if (state.previewShowTimer) {
      clearTimeout(state.previewShowTimer);
      state.previewShowTimer = null;
    }
    if (state.previewHideTimer) {
      clearTimeout(state.previewHideTimer);
      state.previewHideTimer = null;
    }
    elements.mainVideo.pause();

    if (!state.webcamStream) {
      await ensureWebcamStream();
      if (!state.webcamStream) {
        return;
      }
    }

    setFlow("capturing");

    const video = elements.webcamPreview;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const targetWidth = 1920;
    const targetHeight = 1080;
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const shouldMirror = mirrorCameraEnabled();
    if (shouldMirror) {
      ctx.save();
      ctx.translate(targetWidth, 0);
      ctx.scale(-1, 1);
    }
    const scale = Math.min(
      targetWidth / (video.videoWidth || targetWidth),
      targetHeight / (video.videoHeight || targetHeight)
    );
    const drawWidth = (video.videoWidth || targetWidth) * scale;
    const drawHeight = (video.videoHeight || targetHeight) * scale;
    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;
    if (shouldMirror) {
      ctx.drawImage(video, targetWidth - offsetX - drawWidth, offsetY, drawWidth, drawHeight);
      ctx.restore();
    } else {
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
    }

    const overlayPath = state.pendingOverlayPath || pickOverlay();
    state.pendingOverlayPath = "";
    updatePreviewOverlay();
    if (overlayPath) {
      try {
        const overlayImage = await loadImageFromPath(overlayPath);
        ctx.drawImage(overlayImage, 0, 0, canvas.width, canvas.height);
      } catch (error) {
        console.warn("Unable to load overlay", overlayPath, error);
      }
    }

    state.lastPhotoDataUrl = canvas.toDataURL("image/png");
    if (hidePreview) {
      setPreviewVisibility(false);
    }
    await showResult();
  };

  const pickOverlay = () => {
    if (!state.config?.santaOverlays?.length) {
      return "";
    }

    const index = Math.floor(Math.random() * state.config.santaOverlays.length);
    return state.config.santaOverlays[index];
  };

  const showResult = async () => {
    if (!state.lastPhotoDataUrl) {
      return;
    }

    elements.resultPhoto.src = state.lastPhotoDataUrl;
    const shareLink = buildShareLink();
    state.shareLink = shareLink;
    elements.shareLink.textContent = shareLink;
    elements.shareLink.href = shareLink;

    try {
      const qrDataUrl = await window.kioskAPI.generateQRCode(shareLink);
      elements.qrPreview.src = qrDataUrl;
    } catch (error) {
      console.warn("Failed to generate QR", error);
    }

    closeQRDrawer();
    setFlow("result");
    updatePrintButtonState();
    const autoResetMs = Math.max(
      5000,
      state.config?.resultScreen?.autoResetMs ?? 20000,
    );
    state.autoResetTimer = setTimeout(() => resetFlow(), autoResetMs);
  };

const buildShareLink = () => {
  const base = state.config?.shareBaseUrl || "https://example.com/selfy";
  const sanitizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${sanitizedBase}/${Date.now()}`;
};

const loadImageFromPath = (filePath) => {
  return loadImage(toFileSrc(filePath));
};

  const setMediaSource = (videoEl, filePath) => {
    if (!filePath) {
      videoEl.removeAttribute("src");
      videoEl.load();
      return;
    }
    const fileSrc = toFileSrc(filePath);
    if (videoEl.getAttribute("src") === fileSrc) {
      return;
    }
    videoEl.src = fileSrc;
    videoEl.load();
  };

  const seekMainVideo = (seconds) => {
    const clamped = Math.max(0, Number(seconds) || 0);
    if (!elements.mainVideo) {
      return;
    }
    if (elements.mainVideo.readyState > 0) {
      elements.mainVideo.currentTime = clamped;
      return;
    }
    const handler = () => {
      elements.mainVideo.removeEventListener("loadedmetadata", handler);
      elements.mainVideo.currentTime = clamped;
    };
    elements.mainVideo.addEventListener("loadedmetadata", handler, {
      once: true,
    });
  };

  const toFileSrc = (filePath) => {
    if (!filePath) {
      return "";
    }
    const normalized = filePath.replace(/\\/g, "/");
    return encodeURI(`file://${normalized}`);
  };

  const applyPreviewTransform = () => {
    const quad = getActivePreviewQuad();
    if (!quad) {
      return;
    }

    const { offsetWidth: stageWidth, offsetHeight: stageHeight } =
      elements.videoStage;
    if (!stageWidth || !stageHeight) {
      return;
    }

    elements.previewRegion.style.left = "0px";
    elements.previewRegion.style.top = "0px";
    elements.previewRegion.style.width = `${stageWidth}px`;
    elements.previewRegion.style.height = `${stageHeight}px`;

    const quadPx = quad.map((point) => ({
      x: point.x * stageWidth,
      y: point.y * stageHeight,
    }));

    const matrix = computePerspectiveMatrix(quadPx, stageWidth, stageHeight);
    if (matrix) {
      elements.previewRegion.style.transform = `matrix3d(${matrix.join(",")})`;
    } else {
      elements.previewRegion.style.transform = "";
    }
  };

  const getActivePreviewQuad = () => {
    if (
      Array.isArray(state.currentMainVideo?.previewQuad) &&
      state.currentMainVideo.previewQuad.length === 4
    ) {
      return state.currentMainVideo.previewQuad;
    }
    if (
      Array.isArray(state.config?.previewQuad) &&
      state.config.previewQuad.length === 4
    ) {
      return state.config.previewQuad;
    }
    return null;
  };

const updateIdlePlayback = (shouldPlay) => {
  if (!elements.idleVideo || !elements.idleVideo.src) {
    return;
  }
  if (shouldPlay) {
    elements.idleVideo.loop = true;
    elements.idleVideo.muted = true;
    elements.idleVideo.play().catch(() => {});
  } else {
    elements.idleVideo.pause();
  }
};

const getPreviewWindow = () => {
    const globalVisibility = state.config?.previewVisibility || {};
    const videoVisibility = state.currentMainVideo?.previewVisibility;
    const defaultStart =
      typeof globalVisibility.startMs === "number"
        ? globalVisibility.startMs
        : 4000;
    const startMsSource =
      typeof videoVisibility?.startMs === "number"
        ? videoVisibility.startMs
        : defaultStart;
    const startMs = Math.max(0, startMsSource);

    const fallbackEnd =
      typeof globalVisibility.endMs === "number"
        ? globalVisibility.endMs
        : startMs + 2000;
    const endMsSource =
      typeof videoVisibility?.endMs === "number"
        ? videoVisibility.endMs
        : fallbackEnd;
    const endMs = Math.max(startMs + 250, endMsSource);

    return { startMs, endMs };
  };

const setPreviewVisibility = (isVisible) => {
  state.previewVisible = isVisible;
  elements.previewRegion.classList.toggle("hidden", !isVisible);
  updatePreviewOverlay();
};

const updatePreviewOverlay = () => {
  if (!elements.previewOverlay) {
    return;
  }
  const hasOverlay =
    state.previewVisible && Boolean(state.pendingOverlayPath);
  if (!hasOverlay) {
    elements.previewOverlay.classList.add("hidden");
    elements.previewOverlay.removeAttribute("src");
    return;
  }
  elements.previewOverlay.src = toFileSrc(state.pendingOverlayPath);
  elements.previewOverlay.classList.remove("hidden");
};

const updateMirrorPreviewState = () => {
  if (!elements.webcamPreview) {
    return;
  }
  const mirrored = mirrorCameraEnabled();
  elements.webcamPreview.classList.toggle("mirrored", mirrored);
};

const mirrorCameraEnabled = () => state.config?.mirrorCamera !== false;

const toggleQRDrawer = () => {
  state.qrVisible = !state.qrVisible;
  applyQRDrawerState();
};

const closeQRDrawer = () => {
  state.qrVisible = false;
  applyQRDrawerState();
};

const applyQRDrawerState = () => {
  if (elements.qrDrawer) {
    elements.qrDrawer.classList.toggle("hidden", !state.qrVisible);
  }
  if (elements.qrToggleBtn) {
    elements.qrToggleBtn.textContent = state.qrVisible ? "Hide QR" : "Show QR";
  }
};

const prepareIdleVideo = ({ forceDifferent = false } = {}) => {
  const pool = Array.isArray(state.config?.idleVideos)
    ? state.config.idleVideos
    : [];
  if (!pool.length) {
    state.currentIdleVideo = "";
    setMediaSource(elements.idleVideo, "");
    return;
  }
  let next = state.currentIdleVideo;
  if (!next || (forceDifferent && pool.length > 1)) {
    next = pickRandomMediaPath(
      pool,
      forceDifferent ? state.currentIdleVideo : null,
    );
  }
  if (!next) {
    state.currentIdleVideo = "";
    setMediaSource(elements.idleVideo, "");
    return;
  }
  if (next !== state.currentIdleVideo) {
    state.currentIdleVideo = next;
    setMediaSource(elements.idleVideo, next);
  }
};

const prepareMainVideoForFlow = () => {
  const pool = Array.isArray(state.config?.mainVideos)
    ? state.config.mainVideos
    : [];
  if (!pool.length) {
    state.currentMainVideo = null;
    setMediaSource(elements.mainVideo, "");
    return false;
  }

  const excludePath =
    pool.length > 1 ? state.currentMainVideo?.path || null : null;
  const next = pickRandomVideoEntry(pool, excludePath);
  if (!next) {
    state.currentMainVideo = null;
    setMediaSource(elements.mainVideo, "");
    return false;
  }

  const shouldReload = next.path !== state.currentMainVideo?.path;
  state.currentMainVideo = next;
  if (shouldReload) {
    setMediaSource(elements.mainVideo, next.path);
  } else {
    elements.mainVideo.pause();
    elements.mainVideo.currentTime = 0;
  }
  applyPreviewTransform();
  return true;
};

const pickRandomVideoEntry = (pool = [], excludePath) => {
  if (!pool.length) {
    return null;
  }
  let candidates = pool;
  if (excludePath) {
    const filtered = pool.filter((item) => item?.path !== excludePath);
    if (filtered.length) {
      candidates = filtered;
    }
  }
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] || null;
};

const pickRandomMediaPath = (pool = [], exclude) => {
  if (!pool.length) {
    return "";
  }
  let candidates = pool;
  if (exclude) {
    const filtered = pool.filter((item) => item !== exclude);
    if (filtered.length) {
      candidates = filtered;
    }
  }
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] || "";
};

const updateSheetDisplay = () => {
  const sheets = state.config?.printer?.sheetsRemaining;
  if (elements.sheetsLeft) {
    elements.sheetsLeft.textContent =
      typeof sheets === "number" ? sheets : "--";
  }
};

const updatePrintButtonState = () => {
  const hasPrinter = Boolean(state.config?.printer?.deviceName);
  const hasPhoto = Boolean(state.lastPhotoDataUrl);
  elements.printBtn.disabled = !hasPrinter || !hasPhoto || state.isPrinting;
};

const handlePrint = async () => {
  if (!state.lastPhotoDataUrl || state.isPrinting) {
    return;
  }
  const hasPrinter = Boolean(state.config?.printer?.deviceName);
  if (!hasPrinter) {
    setPrintStatus("Configure the printer in Settings first.");
    return;
  }

  try {
    state.isPrinting = true;
    updatePrintButtonState();
    setPrintStatus("Sending to printer…");
    const composition = await createPrintComposition();
    await window.kioskAPI.printPhoto(composition);
    setPrintStatus("Print job sent.");
  } catch (error) {
    console.error("Print failed", error);
    setPrintStatus(
      error?.message || "Unable to print. Check printer connection.",
    );
  } finally {
    state.isPrinting = false;
    updatePrintButtonState();
  }
};

const setPrintStatus = (message) => {
  if (!elements.printStatus) {
    return;
  }
  elements.printStatus.textContent = message || "";
};

const handleRetry = () => {
  if (!hasValidConfig(state.config)) {
    toggleMessage(true, "Configure sources before starting.");
    return;
  }
  closeQRDrawer();
  resetFlow();
  requestAnimationFrame(() =>
    startCaptureFlow({
      leadInMs: RETRY_LEAD_MS,
    }),
  );
};

const handleCornerPress = (event) => {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (!state.isProduction) {
    openSettings(event);
    return;
  }
  startSettingsHoldTimer();
};

const startSettingsHoldTimer = () => {
  clearSettingsHoldTimer();
  state.settingsHoldTimer = setTimeout(() => {
    state.settingsHoldTimer = null;
    openSettings();
  }, SETTINGS_HOLD_MS);
};

const clearSettingsHoldTimer = () => {
  if (state.settingsHoldTimer) {
    clearTimeout(state.settingsHoldTimer);
    state.settingsHoldTimer = null;
  }
};

const createPrintComposition = async () => {
  const { width, height } = getPrintCanvasSize();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const photo = await loadImage(state.lastPhotoDataUrl);
  const scale = Math.max(width / photo.width, height / photo.height);
  const drawWidth = photo.width * scale;
  const drawHeight = photo.height * scale;
  const offsetX = (width - drawWidth) / 2;
  const offsetY = (height - drawHeight) / 2;

  ctx.drawImage(photo, offsetX, offsetY, drawWidth, drawHeight);

  return canvas.toDataURL("image/png");
};

const getPrintCanvasSize = () => {
  const printer = state.config?.printer || {};
  const widthMm = printer.paperWidthMm || 152;
  const heightMm = printer.paperHeightMm || 102;
  const mmToPx = 11.811; // approx 300 DPI
  return {
    width: Math.round(widthMm * mmToPx),
    height: Math.round(heightMm * mmToPx),
  };
};

const loadImage = (src) => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
};

const computePerspectiveMatrix = (points, width, height) => {
  if (!points || points.length !== 4) {
    return null;
  }

  const src = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];

  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: tx, y: ty } = points[i];

    A.push([x, y, 1, 0, 0, 0, -tx * x, -tx * y]);
    b.push(tx);
    A.push([0, 0, 0, x, y, 1, -ty * x, -ty * y]);
    b.push(ty);
  }

  const coeffs = solveLinearSystem(A, b);
  if (!coeffs) {
    return null;
  }

  const [a, b1, c, d, e, f, g, h] = coeffs;
  return [
    a,
    d,
    0,
    g,
    b1,
    e,
    0,
    h,
    0,
    0,
    1,
    0,
    c,
    f,
    0,
    1
  ];
};

const solveLinearSystem = (matrix, values) => {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [...row, values[i]]);

  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(augmented[j][i]) > Math.abs(augmented[pivot][i])) {
        pivot = j;
      }
    }

    if (Math.abs(augmented[pivot][i]) < 1e-10) {
      return null;
    }

    [augmented[i], augmented[pivot]] = [augmented[pivot], augmented[i]];

    const pivotVal = augmented[i][i];
    for (let k = i; k <= n; k++) {
      augmented[i][k] /= pivotVal;
    }

    for (let j = 0; j < n; j++) {
      if (j !== i) {
        const factor = augmented[j][i];
        for (let k = i; k <= n; k++) {
          augmented[j][k] -= factor * augmented[i][k];
        }
      }
    }
  }

  return augmented.map((row) => row[n]);
};

  init();
})();
const openSettings = (event) => {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (window.kioskAPI && typeof window.kioskAPI.openSettings === "function") {
    window.kioskAPI.openSettings();
  } else {
    console.warn("Settings bridge unavailable");
  }
};

function handleAdminShortcut(event) {
  const isModifier = event.shiftKey && (event.metaKey || event.ctrlKey);
  if (isModifier && event.code === "KeyS") {
    event.preventDefault();
    openSettings(event);
  }
}
