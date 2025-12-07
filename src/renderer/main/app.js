(() => {
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
  };

  const elements = {
    body: document.body,
    videoStage: document.getElementById("videoStage"),
    idleVideo: document.getElementById("idleVideo"),
    mainVideo: document.getElementById("mainVideo"),
    previewRegion: document.getElementById("previewRegion"),
    webcamPreview: document.getElementById("webcamPreview"),
    resultPanel: document.getElementById("resultPanel"),
    resultPhoto: document.getElementById("resultPhoto"),
    qrPreview: document.getElementById("qrPreview"),
    shareLink: document.getElementById("shareLink"),
    printBtn: document.getElementById("printBtn"),
    restartBtn: document.getElementById("restartBtn"),
    cornerSettingsBtn: document.getElementById("cornerSettingsBtn"),
    messagePanel: document.getElementById("messagePanel"),
    messageText: document.getElementById("messageText"),
    messageSettingsBtn: document.getElementById("messageSettingsBtn"),
  };

  const init = async () => {
    attachEventListeners();
    const initialConfig = await window.kioskAPI.loadConfig();
    applyConfig(initialConfig);

    window.kioskAPI.onConfigUpdated((config) => {
      applyConfig(config);
    });

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

    elements.restartBtn.addEventListener("click", () => resetFlow());
    elements.printBtn.addEventListener("click", () => window.print());

    elements.cornerSettingsBtn.addEventListener("pointerdown", (event) =>
      openSettings(event),
    );
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
    const ready = hasValidConfig(config);
    toggleMessage(
      !ready,
      "Please finish configuring videos and overlays to start.",
    );

    setMediaSource(elements.idleVideo, config.idleVideo);
    setMediaSource(elements.mainVideo, config.mainVideo);
    elements.mainVideo.muted = false;
    elements.mainVideo.volume = 1;
    applyPreviewTransform();
    resetFlow();

    if (ready) {
      ensureWebcamStream();
    }
  };

  const hasValidConfig = (config) => {
    return Boolean(
      config &&
        config.idleVideo &&
        config.mainVideo &&
        Array.isArray(config.santaOverlays) &&
        config.santaOverlays.length > 0,
    );
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
    updateIdlePlayback(nextFlow === "idle");
  };

  const startCaptureFlow = () => {
    if (!hasValidConfig(state.config)) {
      toggleMessage(true, "Configure sources before starting.");
      return;
    }

    clearTimers();
    setFlow("preparing");
    elements.mainVideo.currentTime = 0;
    elements.mainVideo.play().catch(() => {});

    const previewWindow = getPreviewWindow();
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
    setPreviewVisibility(false);
    setFlow("idle");
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

    ctx.save();
    ctx.translate(targetWidth, 0);
    ctx.scale(-1, 1);

    const scale = Math.min(
      targetWidth / (video.videoWidth || targetWidth),
      targetHeight / (video.videoHeight || targetHeight)
    );
    const drawWidth = (video.videoWidth || targetWidth) * scale;
    const drawHeight = (video.videoHeight || targetHeight) * scale;
    const offsetX = (targetWidth - drawWidth) / 2;
    const offsetY = (targetHeight - drawHeight) / 2;
    ctx.drawImage(
      video,
      offsetX,
      offsetY,
      drawWidth,
      drawHeight
    );
    ctx.restore();

    const overlayPath = pickOverlay();
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

    setFlow("result");
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
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = toFileSrc(filePath);
    return new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
    });
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

  const toFileSrc = (filePath) => {
    if (!filePath) {
      return "";
    }
    const normalized = filePath.replace(/\\/g, "/");
    return encodeURI(`file://${normalized}`);
  };

  const applyPreviewTransform = () => {
    if (!state.config?.previewQuad) {
      return;
    }

    const { offsetWidth: stageWidth, offsetHeight: stageHeight } =
      elements.videoStage;
    if (!stageWidth || !stageHeight) {
      return;
    }

    elements.previewRegion.style.left = "0px";
    elements.previewRegion.style.top = "0px";
    // elements.previewRegion.style.width = `${stageWidth}px`;
    // elements.previewRegion.style.height = `${stageHeight}px`;

    const quad = state.config.previewQuad.map((point) => ({
      x: point.x * stageWidth,
      y: point.y * stageHeight,
    }));

    const matrix = computePerspectiveMatrix(quad, stageWidth, stageHeight);
    if (matrix) {
      elements.previewRegion.style.transform = `matrix3d(${matrix.join(",")})`;
    } else {
      elements.previewRegion.style.transform = "";
    }
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
    const visibility = state.config?.previewVisibility || {};
    const startMs = Math.max(0, visibility.startMs ?? 4000);
    const endMs = Math.max(
      startMs + 250,
      visibility.endMs ?? (visibility.startMs ?? 4000) + 2000,
    );
    return { startMs, endMs };
  };

  const setPreviewVisibility = (isVisible) => {
    state.previewVisible = isVisible;
    elements.previewRegion.classList.toggle("hidden", !isVisible);
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
