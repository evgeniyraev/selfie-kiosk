(() => {
  const SETTINGS_HOLD_MS = 5000;
  const RETRY_LEAD_MS = 5000;
  const SHARE_UPLOAD_ENDPOINT =
    "https://interactivebulgaria.bg/server/upload.php";
  const SHARE_DEFAULT_STATUS = 'Tap "Show QR" to generate a download link.';

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
    overlayQueue: [],
    currentIdleVideo: "",
    currentMainVideo: null,
    settingsHoldTimer: null,
    qrVisible: false,
    shareUploadPromise: null,
    isProduction: Boolean(window.kioskAPI?.isProduction),
    lastOverlayPath: "",
  };

  const areArraysEqual = (a = [], b = []) => {
    if (a === b) {
      return true;
    }
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
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
    resultOverlay: document.getElementById("resultOverlay"),
    qrPreview: document.getElementById("qrPreview"),
    shareLink: document.getElementById("shareLink"),
    qrStatus: document.getElementById("qrStatus"),
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
    debugPreviewLayer: null,
    debugPreviewImage: null,
  };

  const setQRStatus = (message) => {
    if (elements.qrStatus) {
      elements.qrStatus.textContent = message || "";
    }
  };

  const updateShareLinkDisplay = (link) => {
    if (!elements.shareLink) {
      return;
    }
    if (link) {
      elements.shareLink.textContent = link;
      elements.shareLink.href = link;
    } else {
      elements.shareLink.textContent = "";
      elements.shareLink.removeAttribute("href");
    }
  };

  const clearQrPreview = () => {
    if (elements.qrPreview) {
      elements.qrPreview.removeAttribute("src");
    }
  };

  const resetShareState = () => {
    state.shareLink = "";
    state.shareUploadPromise = null;
    clearQrPreview();
    updateShareLinkDisplay("");
    setQRStatus(SHARE_DEFAULT_STATUS);
  };

  const updateResultOverlay = () => {
    if (!elements.resultOverlay) {
      return;
    }
    if (state.lastOverlayPath) {
      elements.resultOverlay.src = toFileSrc(state.lastOverlayPath);
      elements.resultOverlay.classList.remove("hidden");
    } else {
      elements.resultOverlay.removeAttribute("src");
      elements.resultOverlay.classList.add("hidden");
    }
  };

  const setQrButtonBusy = (isBusy, label) => {
    if (!elements.qrToggleBtn) {
      return;
    }
    elements.qrToggleBtn.disabled = isBusy;
    if (isBusy && label) {
      return;
    }
  };

  const backupPhotoLocally = async (imageDataUrl, reason) => {
    if (!imageDataUrl || !window.kioskAPI?.saveBackupPhoto) {
      return;
    }
    try {
      await window.kioskAPI.saveBackupPhoto(imageDataUrl, reason);
    } catch (error) {
      console.warn("Failed to save backup photo", reason, error);
    }
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
      elements.qrToggleBtn.addEventListener("click", () => {
        handleQrToggle();
      });
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
    const previousOverlays = state.config?.santaOverlays || [];
    const nextOverlays = config?.santaOverlays || [];
    const overlaysChanged = !areArraysEqual(previousOverlays, nextOverlays);
    state.config = config;
    state.pendingOverlayPath = "";
    resetShareState();
    if (overlaysChanged) {
      state.overlayQueue = [];
    }
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
    updatePaperAspectRatio();
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
    const { forceVideoPath } = options;
    if (!hasValidConfig(state.config)) {
      toggleMessage(true, "Configure sources before starting.");
      return;
    }

    clearTimers();
    if (!prepareMainVideoForFlow({ forcePath: forceVideoPath })) {
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
    const resumeMs =
      leadInMs > 0 ? Math.max(0, previewWindow.startMs - leadInMs) : 0;
    const resumeSeconds = resumeMs / 1000;
    seekMainVideo(resumeSeconds);
    elements.mainVideo.play().catch(() => {});

    const startDelayMs = Math.max(0, previewWindow.startMs - resumeMs);
    const endDelayMs = Math.max(0, previewWindow.endMs - resumeMs);

    state.previewShowTimer = setTimeout(() => {
      state.previewShowTimer = null;
      if (state.flow === "result") {
        return;
      }
      setFlow("capturing");
      setPreviewVisibility(true);
    }, startDelayMs);

    state.previewHideTimer = setTimeout(() => {
      state.previewHideTimer = null;
      capturePhoto();
    }, endDelayMs);
  };

  const resetFlow = () => {
    clearTimers();
    elements.mainVideo.pause();
    elements.mainVideo.currentTime = 0;
    state.lastPhotoDataUrl = null;
    state.lastOverlayPath = "";
    resetShareState();
    state.pendingOverlayPath = "";
    updatePreviewOverlay();
    updateResultOverlay();
    setPreviewVisibility(false);
    closeQRDrawer();
    prepareIdleVideo({ forceDifferent: true });
    setFlow("idle");
    updatePrintButtonState();
    setPrintStatus("");
  };

  const clearTimers = () => {
    if (state.previewShowTimer) {
      clearTimeout(state.previewShowTimer);
      state.previewShowTimer = null;
    }
    if (state.previewHideTimer) {
      clearTimeout(state.previewHideTimer);
      state.previewHideTimer = null;
    }
    clearAutoResetTimer();
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

    resetShareState();
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

    const { width: targetWidth, height: targetHeight } = getCaptureCanvasSize();
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    const shouldMirror = mirrorCameraEnabled();
    if (shouldMirror) {
      ctx.save();
      ctx.translate(targetWidth, 0);
      ctx.scale(-1, 1);
    }
    const scale = Math.min(
      targetWidth / (video.videoWidth || targetWidth),
      targetHeight / (video.videoHeight || targetHeight),
    );
    const drawWidth = (video.videoWidth || targetWidth) * scale;
    const drawHeight = (video.videoHeight || targetHeight) * scale;
    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;
    if (shouldMirror) {
      ctx.drawImage(
        video,
        targetWidth - offsetX - drawWidth,
        offsetY,
        drawWidth,
        drawHeight,
      );
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
        drawCoverImage(ctx, overlayImage, targetWidth, targetHeight);
      } catch (error) {
        console.warn("Unable to load overlay", overlayPath, error);
      }
    }
    state.lastOverlayPath = overlayPath || "";
    updateResultOverlay();
    state.lastPhotoDataUrl = canvas.toDataURL("image/png");
    if (hidePreview) {
      setPreviewVisibility(false);
    }
    await showResult();
  };

  const getRandomIndex = (max) => {
    if (!max || max <= 0) {
      return 0;
    }
    if (window.crypto?.getRandomValues) {
      const buffer = new Uint32Array(1);
      window.crypto.getRandomValues(buffer);
      return buffer[0] % max;
    }
    return Math.floor(Math.random() * max);
  };

  const shuffleList = (items) => {
    if (!Array.isArray(items)) {
      return [];
    }
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = getRandomIndex(i + 1);
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  };

  const pickOverlay = () => {
    if (!state.config?.santaOverlays?.length) {
      return "";
    }

    if (!state.overlayQueue.length) {
      state.overlayQueue = shuffleList(state.config.santaOverlays);
    }

    const nextOverlay = state.overlayQueue.shift();
    return nextOverlay || state.config.santaOverlays[0];
  };

  const getAutoResetDuration = () =>
    Math.max(5000, state.config?.resultScreen?.autoResetMs ?? 20000);

  const clearAutoResetTimer = () => {
    if (state.autoResetTimer) {
      clearTimeout(state.autoResetTimer);
      state.autoResetTimer = null;
    }
  };

  const scheduleAutoResetTimer = () => {
    clearAutoResetTimer();
    state.autoResetTimer = setTimeout(
      () => resetFlow(),
      getAutoResetDuration(),
    );
  };

  const restartAutoResetTimer = () => {
    if (state.flow === "result") {
      scheduleAutoResetTimer();
    }
  };

  const showResult = async () => {
    if (!state.lastPhotoDataUrl) {
      return;
    }

    resetShareState();
    elements.resultPhoto.src = state.lastPhotoDataUrl;
    closeQRDrawer();
    setFlow("result");
    updatePrintButtonState();
    scheduleAutoResetTimer();
  };

  const ensureShareLink = () => {
    if (state.shareLink) {
      return Promise.resolve(state.shareLink);
    }
    if (!state.lastPhotoDataUrl) {
      return Promise.reject(new Error("No captured photo available."));
    }
    if (state.shareUploadPromise) {
      return state.shareUploadPromise;
    }
    state.shareUploadPromise = uploadPhotoForShare().finally(() => {
      state.shareUploadPromise = null;
    });
    return state.shareUploadPromise;
  };

  const uploadPhotoForShare = async () => {
    try {
      await backupPhotoLocally(state.lastPhotoDataUrl, "qr");
      const response = await fetch(SHARE_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageData: state.lastPhotoDataUrl,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || `Upload failed (${response.status}).`;
        throw new Error(message);
      }
      if (!payload?.downloadUrl) {
        throw new Error("Server did not return a download link.");
      }
      state.shareLink = payload.downloadUrl;
      return state.shareLink;
    } catch (error) {
      state.shareLink = "";
      throw error;
    }
  };

  const renderShareArtifacts = async (shareLink) => {
    updateShareLinkDisplay(shareLink);
    try {
      const qrDataUrl = await window.kioskAPI.generateQRCode(shareLink);
      if (elements.qrPreview) {
        elements.qrPreview.src = qrDataUrl;
      }
    } catch (error) {
      console.warn("Failed to generate QR", error);
      setQRStatus("Link ready. Reopen to refresh the QR code.");
    }
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

    const quadPx = mapQuadToStage(quad, stageWidth, stageHeight);
    let appliedRectangle = false;
    if (isRectanglePreview()) {
      const bounds = getQuadBoundsPx(quadPx);
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        elements.previewRegion.classList.add("rectangular");
        elements.previewRegion.style.transform = "";
        elements.previewRegion.style.left = `${bounds.minX}px`;
        elements.previewRegion.style.top = `${bounds.minY}px`;
        elements.previewRegion.style.width = `${bounds.width}px`;
        elements.previewRegion.style.height = `${bounds.height}px`;
        appliedRectangle = true;
      }
    }
    if (appliedRectangle) {
      return;
    }
    elements.previewRegion.classList.remove("rectangular");

    elements.previewRegion.style.left = "0px";
    elements.previewRegion.style.top = "0px";
    elements.previewRegion.style.width = `${stageWidth}px`;
    elements.previewRegion.style.height = `${stageHeight}px`;

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

  const getPreviewShape = () =>
    state.config?.previewShape === "rectangle" ? "rectangle" : "free";

  const isRectanglePreview = () => getPreviewShape() === "rectangle";

  const clampUnit = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.min(Math.max(number, 0), 1);
  };

  const mapQuadToStage = (quad = [], stageWidth, stageHeight) =>
    quad.map((point) => ({
      x: clampUnit(point?.x) * stageWidth,
      y: clampUnit(point?.y) * stageHeight,
    }));

  const getQuadBoundsPx = (points = []) => {
    if (!Array.isArray(points) || points.length !== 4) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    points.forEach((point) => {
      if (!point) {
        return;
      }
      const x = Number(point.x) || 0;
      const y = Number(point.y) || 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxY)
    ) {
      return null;
    }
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  };

  const updateIdlePlayback = (shouldPlay) => {
    if (!elements.idleVideo || !elements.idleVideo.src) {
      return;
    }
    if (shouldPlay) {
      elements.idleVideo.loop = true;
      elements.idleVideo.muted = false;
      elements.idleVideo.volume = 1;
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

  const handleQrToggle = async () => {
    if (!state.lastPhotoDataUrl) {
      return;
    }
    restartAutoResetTimer();
    if (state.qrVisible) {
      closeQRDrawer();
      return;
    }

    setQrButtonBusy(true, "Uploading…");
    setQRStatus("Uploading photo…");
    try {
      const shareLink = await ensureShareLink();
      if (!shareLink) {
        throw new Error("Share link is unavailable.");
      }
      await renderShareArtifacts(shareLink);
      state.qrVisible = true;
      applyQRDrawerState();
      setQRStatus("Scan the code or tap the link to download.");
    } catch (error) {
      console.error("Failed to prepare QR link", error);
      const message =
        error?.message ||
        "Unable to upload photo. Check the internet connection and try again.";
      setQRStatus(message);
    } finally {
      setQrButtonBusy(false);
    }
  };

  const closeQRDrawer = () => {
    state.qrVisible = false;
    applyQRDrawerState();
  };

  const applyQRDrawerState = () => {
    if (elements.qrDrawer) {
      elements.qrDrawer.classList.toggle("hidden", !state.qrVisible);
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

  const prepareMainVideoForFlow = ({ forcePath } = {}) => {
    const pool = Array.isArray(state.config?.mainVideos)
      ? state.config.mainVideos
      : [];
    if (!pool.length) {
      state.currentMainVideo = null;
      setMediaSource(elements.mainVideo, "");
      return false;
    }

    let next = null;
    if (forcePath) {
      next =
        pool.find((item) => item?.path === forcePath) ||
        state.currentMainVideo ||
        null;
    }
    if (!next) {
      const excludePath =
        pool.length > 1 ? state.currentMainVideo?.path || null : null;
      next = pickRandomVideoEntry(pool, excludePath);
    }
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
      const showCount =
        typeof sheets === "number" && sheets > 0 && sheets <= 50;
      elements.sheetsLeft.textContent = showCount ? sheets : "--";
    }
  };

  const updatePrintButtonState = () => {
    const hasPrinter = Boolean(state.config?.printer?.deviceName);
    const hasPhoto = Boolean(state.lastPhotoDataUrl);
    elements.printBtn.disabled = !hasPrinter || !hasPhoto || state.isPrinting;
  };

  const updatePaperAspectRatio = () => {
    const width = Number(state.config?.printer?.paperWidthMm) || 150;
    const height = Number(state.config?.printer?.paperHeightMm) || 100;
    const ratio = Math.max(width / height, 0.1);
    document.documentElement.style.setProperty("--paper-aspect", ratio);
  };

  const handlePrint = async () => {
    if (!state.lastPhotoDataUrl || state.isPrinting) {
      return;
    }
    restartAutoResetTimer();
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
      await backupPhotoLocally(composition, "print");
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
    const currentVideoPath = state.currentMainVideo?.path || null;
    resetFlow();
    requestAnimationFrame(() =>
      startCaptureFlow({
        leadInMs: RETRY_LEAD_MS,
        forceVideoPath: currentVideoPath,
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
    const canvasWidth = height;
    const canvasHeight = width;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const photo = await loadImage(state.lastPhotoDataUrl);
    ctx.save();
    ctx.translate(canvasWidth / 2, canvasHeight / 2);
    ctx.rotate(Math.PI / 2);
    ctx.translate(-canvasHeight / 2, -canvasWidth / 2);
    drawCoverImage(ctx, photo, canvasHeight, canvasWidth);
    ctx.restore();

    if (!state.isProduction) {
      debugPrintComposition(canvas);
    }

    return canvas.toDataURL("image/png");
  };

  const debugPrintComposition = (canvas) => {
    if (!ensureDebugPreviewLayer()) {
      return;
    }
    if (elements.debugPreviewImage) {
      elements.debugPreviewImage.src = canvas.toDataURL("image/png");
    }
    elements.debugPreviewLayer.classList.remove("hidden");
  };

  const ensureDebugPreviewLayer = () => {
    if (elements.debugPreviewLayer && elements.debugPreviewImage) {
      return true;
    }
    if (!state.isProduction) {
      const layer = document.createElement("div");
      layer.id = "debugPrintPreview";
      layer.className = "debug-print-preview hidden";
      layer.innerHTML = `
        <div class="debug-print-card">
          <div class="debug-print-header">
            <strong>Print composition preview</strong>
            <button type="button" class="debug-print-close" aria-label="Close preview">&times;</button>
          </div>
          <img alt="Print preview" />
        </div>
      `;
      document.body.appendChild(layer);
      const image = layer.querySelector("img");
      const closeBtn = layer.querySelector(".debug-print-close");
      if (!image || !closeBtn) {
        return false;
      }
      closeBtn.addEventListener("click", () => {
        layer.classList.add("hidden");
      });
      layer.addEventListener("click", (event) => {
        if (event.target === layer) {
          layer.classList.add("hidden");
        }
      });
      elements.debugPreviewLayer = layer;
      elements.debugPreviewImage = image;
      return true;
    }
    return false;
  };

  const getPrinterDimensions = () => {
    const printer = state.config?.printer || {};
    const widthMm = printer.paperWidthMm || 150;
    const heightMm = printer.paperHeightMm || 100;
    return { widthMm, heightMm };
  };

  const getCaptureCanvasSize = () => {
    const { widthMm, heightMm } = getPrinterDimensions();
    const baseWidth = 3000;
    const baseHeight = Math.max(
      1000,
      Math.round((heightMm / widthMm) * baseWidth),
    );
    return { width: baseWidth, height: baseHeight };
  };

  const getPrintCanvasSize = () => {
    const { widthMm, heightMm } = getPrinterDimensions();
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

  const getImageDimensions = (image) => {
    if (!image) {
      return { width: 1, height: 1 };
    }
    const width = image.videoWidth || image.naturalWidth || image.width || 1;
    const height =
      image.videoHeight || image.naturalHeight || image.height || 1;
    return { width, height };
  };

  const drawCoverImage = (ctx, image, targetWidth, targetHeight) => {
    if (!ctx || !image) {
      return;
    }
    const { width: sourceWidth, height: sourceHeight } =
      getImageDimensions(image);
    const scale = Math.max(
      targetWidth / sourceWidth,
      targetHeight / sourceHeight,
    );
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;
    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  };

  const drawContainImage = (ctx, image, targetWidth, targetHeight) => {
    if (!ctx || !image) {
      return;
    }
    const { width: sourceWidth, height: sourceHeight } =
      getImageDimensions(image);
    const scale = Math.min(
      targetWidth / sourceWidth,
      targetHeight / sourceHeight,
    );
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;
    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  };

  const computePerspectiveMatrix = (points, width, height) => {
    if (!points || points.length !== 4) {
      return null;
    }

    const src = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
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
    return [a, d, 0, g, b1, e, 0, h, 0, 0, 1, 0, c, f, 0, 1];
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
