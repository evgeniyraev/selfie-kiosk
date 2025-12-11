(() => {
  const DEFAULT_FRAME_RATE = 30;

  const state = {
    config: null,
    isDraggingRegion: false,
    dragHandleIndex: null,
    toastTimeout: null,
    cameraStream: null,
    previewVideoPath: "",
    activePointerId: null,
    activeHandleEl: null,
    isAdjustingQuad: false
  };

  const qs = (selector) => document.querySelector(selector);
  const elements = {
    shareInput: qs('#shareBaseInput'),
    previewFPSInput: qs('#previewFPSInput'),
    idleVideoList: qs('#idleVideoList'),
    mainVideoList: qs('#mainVideoList'),
    addIdleVideosBtn: qs('#addIdleVideosBtn'),
    addMainVideosBtn: qs('#addMainVideosBtn'),
    saveBtn: qs('#saveBtn'),
    resetBtn: qs('#resetBtn'),
    previewFlowBtn: qs('#previewFlowBtn'),
    addOverlayBtn: qs('#addOverlayBtn'),
    overlayList: qs('#overlayList'),
    toast: qs('#saveToast'),
    stageWrapper: qs('#stageWrapper'),
    stageVideo: qs('#stageVideo'),
    quadPolygon: qs('#quadPolygon'),
    previewStartInput: qs('#previewStartInput'),
    previewEndInput: qs('#previewEndInput'),
    handles: Array.from(document.querySelectorAll('.corner-handle')),
    handlesLayer: qs('#handlesLayer'),
    playPauseBtn: qs('#playPauseBtn'),
    timelineRange: qs('#timelineRange'),
    currentTimeLabel: qs('#currentTimeLabel'),
    durationLabel: qs('#durationLabel'),
    setStartBtn: qs('#setStartBtn'),
    setEndBtn: qs('#setEndBtn'),
    autoResetInput: qs('#autoResetInput'),
    printerNameInput: qs('#printerNameInput'),
    paperWidthInput: qs('#paperWidthInput'),
    paperHeightInput: qs('#paperHeightInput'),
    sheetsInput: qs('#sheetsInput'),
    startCameraOverlayBtn: qs('#startCameraOverlayBtn'),
    stopCameraOverlayBtn: qs('#stopCameraOverlayBtn'),
    cameraOverlayStatus: qs('#cameraOverlayStatus'),
    cameraOverlay: qs('#settingsCameraOverlay'),
    cameraOverlayVideo: qs('#settingsCameraOverlayVideo'),
    stageOverlayImage: qs('#stageOverlayImage'),
    toggleQuadEditBtn: qs('#toggleQuadEditBtn')
  };
  const defaultToastMessage = elements.toast?.textContent?.trim() || 'Settings saved';

  const init = async () => {
    attachEvents();
    const config = await window.settingsAPI.loadConfig();
    state.config = config;
    state.previewVideoPath = Array.isArray(config.mainVideos)
      ? config.mainVideos[0] || ''
      : '';
    ensurePreviewQuad();
    render();
    if (window.settingsAPI.onSheetsUpdate) {
      window.settingsAPI.onSheetsUpdate((count) => {
        if (!state.config) {
          return;
        }
        const printer = {
          ...(state.config.printer || {})
        };
        printer.sheetsRemaining = Math.max(0, Number(count) || 0);
        state.config.printer = printer;
        renderPrinterConfig();
      });
    }
  };

  const attachEvents = () => {
    if (elements.addIdleVideosBtn) {
      elements.addIdleVideosBtn.addEventListener('click', () => {
        handleAddVideos('idle');
      });
    }

    if (elements.addMainVideosBtn) {
      elements.addMainVideosBtn.addEventListener('click', () => {
        handleAddVideos('main');
      });
    }

    elements.shareInput.addEventListener('input', (event) => {
      if (!state.config) {
        return;
      }
      state.config.shareBaseUrl = event.target.value;
    });

    elements.addOverlayBtn.addEventListener('click', async () => {
      if (!state.config) {
        return;
      }
      const files = await window.settingsAPI.selectImages();
      if (files?.length) {
        const overlays = new Set(state.config.santaOverlays || []);
        files.forEach((file) => overlays.add(file));
        state.config.santaOverlays = Array.from(overlays);
        renderOverlayList();
      }
    });

    elements.saveBtn.addEventListener('click', async () => {
      if (!state.config) {
        return;
      }
      state.config = await window.settingsAPI.saveConfig(state.config);
      render();
      showToast();
    });

    elements.resetBtn.addEventListener('click', async () => {
      if (!window.confirm('Reset all saved settings?')) {
        return;
      }
      state.config = await window.settingsAPI.resetConfig();
      state.previewVideoPath = '';
      ensurePreviewQuad();
      render();
      showToast('Settings reset to defaults');
    });

    elements.previewFlowBtn.addEventListener('click', async () => {
      if (!state.config) {
        return;
      }
      state.config = await window.settingsAPI.saveConfig(state.config);
      render();
      window.settingsAPI.reopenKioskFlow();
    });

    elements.previewStartInput.addEventListener('input', () => {
      if (!state.config) {
        return;
      }
      updatePreviewVisibility();
    });

    elements.previewEndInput.addEventListener('input', () => {
      if (!state.config) {
        return;
      }
      updatePreviewVisibility();
    });

    if (elements.previewFPSInput) {
      elements.previewFPSInput.addEventListener('input', () => {
        if (!state.config) {
          return;
        }
        const fps = clamp(
          Number(elements.previewFPSInput.value) || DEFAULT_FRAME_RATE,
          1,
          240
        );
        state.config.previewVisibility = {
          ...(state.config.previewVisibility || {}),
          frameRate: fps
        };
        renderPreviewVisibility();
      });
    }

    elements.printerNameInput.addEventListener('input', (event) => {
      if (!state.config) {
        return;
      }
      state.config.printer = {
        ...(state.config.printer || {}),
        deviceName: event.target.value
      };
    });

    ['paperWidthInput', 'paperHeightInput', 'sheetsInput'].forEach((key) => {
      elements[key].addEventListener('input', (event) => {
        if (!state.config) {
          return;
        }
        const printer = state.config.printer || {};
        const value = Number(event.target.value) || 0;
        if (key === 'paperWidthInput') {
          printer.paperWidthMm = Math.max(50, value);
        } else if (key === 'paperHeightInput') {
          printer.paperHeightMm = Math.max(50, value);
        } else {
          printer.sheetsRemaining = Math.max(0, value);
        }
        state.config.printer = printer;
        renderPrinterConfig();
      });
    });

    elements.handles.forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => {
        if (!state.config || !state.isAdjustingQuad) {
          return;
        }
        const index = Number(handle.dataset.index);
        startHandleDrag(event, index, handle);
      });
    });

    elements.autoResetInput.addEventListener('input', (event) => {
      if (!state.config) {
        return;
      }
      const seconds = Math.max(
        5,
        Number(event.target.value) || secondsFromMs(defaultAutoReset())
      );
      state.config.resultScreen = {
        ...(state.config.resultScreen || {}),
        autoResetMs: seconds * 1000
      };
      event.target.value = seconds;
    });

    window.addEventListener('pointermove', (event) => {
      if (state.isDraggingRegion) {
        dragHandle(event);
      }
    });

    window.addEventListener('pointerup', () => {
      if (state.activeHandleEl && state.activePointerId !== null) {
        state.activeHandleEl.releasePointerCapture?.(state.activePointerId);
      }
      state.isDraggingRegion = false;
      state.dragHandleIndex = null;
      state.activePointerId = null;
      state.activeHandleEl = null;
    });

    elements.startCameraOverlayBtn.addEventListener('click', () => {
      startCameraOverlay();
    });

    elements.stopCameraOverlayBtn.addEventListener('click', () => {
      stopCameraOverlay();
    });

    window.addEventListener('beforeunload', () => {
      stopCameraOverlay();
    });

    window.addEventListener('resize', () => {
      renderQuad();
    });

    elements.playPauseBtn.addEventListener('click', () => {
      togglePlayback();
    });

    elements.timelineRange.addEventListener('input', () => {
      seekVideo(Number(elements.timelineRange.value));
    });

    elements.stageVideo.addEventListener('loadedmetadata', () => {
      syncTimelineMeta();
    });

    elements.stageVideo.addEventListener('timeupdate', () => {
      updateTimelinePosition();
    });

    elements.stageVideo.addEventListener('play', () => updatePlayButton());
    elements.stageVideo.addEventListener('pause', () => updatePlayButton());
    elements.stageVideo.addEventListener('ended', () => {
      elements.stageVideo.pause();
      updateTimelinePosition();
      updatePlayButton();
    });

    elements.setStartBtn.addEventListener('click', () => setPreviewTimeFromCurrent('start'));
    elements.setEndBtn.addEventListener('click', () => setPreviewTimeFromCurrent('end'));

    if (elements.toggleQuadEditBtn) {
      elements.toggleQuadEditBtn.addEventListener('click', toggleQuadEditing);
    }
  };

  const render = () => {
    ensurePreviewQuad();
    if (elements.shareInput) {
      elements.shareInput.value = state.config.shareBaseUrl || '';
    }
    ensurePreviewVideoSelection();
    renderVideoList('idle');
    renderVideoList('main');
    renderOverlayList();
    renderQuad();
    renderPreviewVisibility();
    renderResultTimer();
    renderPrinterConfig();
    updateCameraOverlayControls();
    updateStageMedia();
    syncTimelineMeta();
    updateQuadEditState();
  };

  const renderOverlayList = () => {
    const overlays = state.config?.santaOverlays || [];
    elements.overlayList.innerHTML = '';

    if (!overlays.length) {
      const placeholder = document.createElement('p');
      placeholder.textContent = 'No overlays selected yet.';
      placeholder.className = 'helper';
      elements.overlayList.appendChild(placeholder);
      renderOverlayPreview();
      return;
    }

    overlays.forEach((path, index) => {
      const card = document.createElement('div');
      card.className = 'overlay-card';

      const img = document.createElement('img');
      img.src = fileToSrc(path);
      img.alt = `Overlay ${index + 1}`;
      card.appendChild(img);

      const name = document.createElement('div');
      name.textContent = path.split(/[/\\]/).pop();
      card.appendChild(name);

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        state.config.santaOverlays.splice(index, 1);
        renderOverlayList();
      });
      card.appendChild(removeBtn);

      elements.overlayList.appendChild(card);
    });

    renderOverlayPreview();
  };

  const renderVideoList = (type) => {
    const listEl =
      type === 'idle' ? elements.idleVideoList : elements.mainVideoList;
    if (!listEl || !state.config) {
      return;
    }
    const key = type === 'idle' ? 'idleVideos' : 'mainVideos';
    const videos = Array.isArray(state.config[key]) ? state.config[key] : [];
    listEl.innerHTML = '';

    if (!videos.length) {
      const placeholder = document.createElement('p');
      placeholder.className = 'helper';
      placeholder.textContent =
        type === 'idle'
          ? 'No idle videos selected yet.'
          : 'No main experience videos selected yet.';
      listEl.appendChild(placeholder);
      return;
    }

    videos.forEach((path, index) => {
      listEl.appendChild(createMediaCard(type, path, index));
    });
  };

  const createMediaCard = (type, path, index) => {
    const card = document.createElement('div');
    card.className = 'media-card';

    const name = document.createElement('div');
    name.className = 'media-name';
    name.textContent = path.split(/[/\\]/).pop();
    card.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'media-path';
    meta.textContent = path;
    card.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'media-actions';

    if (type === 'main') {
      const isActive = path === state.previewVideoPath;
      const previewBtn = document.createElement('button');
      previewBtn.textContent = isActive ? 'Previewing' : 'Show in preview';
      previewBtn.disabled = isActive;
      previewBtn.addEventListener('click', () => setPreviewVideo(path));
      actions.appendChild(previewBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeVideoAtIndex(type, index));
    actions.appendChild(removeBtn);

    card.appendChild(actions);
    return card;
  };

  const handleAddVideos = async (type) => {
    if (!state.config || !window.settingsAPI?.selectVideos) {
      return;
    }
    const files = await window.settingsAPI.selectVideos();
    if (!files?.length) {
      return;
    }
    const key = type === 'idle' ? 'idleVideos' : 'mainVideos';
    const current = Array.isArray(state.config[key]) ? state.config[key] : [];
    state.config[key] = mergeMediaLists(current, files);
    if (type === 'main') {
      ensurePreviewVideoSelection();
    }
    renderVideoList(type);
    if (type === 'main') {
      updateStageMedia();
    }
  };

  const mergeMediaLists = (current = [], additions = []) => {
    const next = Array.isArray(current) ? [...current] : [];
    additions.forEach((file) => {
      if (typeof file === 'string' && file && !next.includes(file)) {
        next.push(file);
      }
    });
    return next;
  };

  const removeVideoAtIndex = (type, index) => {
    if (!state.config) {
      return;
    }
    const key = type === 'idle' ? 'idleVideos' : 'mainVideos';
    const list = Array.isArray(state.config[key]) ? state.config[key] : [];
    if (index < 0 || index >= list.length) {
      return;
    }
    list.splice(index, 1);
    state.config[key] = list;
    if (type === 'main') {
      ensurePreviewVideoSelection();
    }
    renderVideoList(type);
    if (type === 'main') {
      updateStageMedia();
    }
  };

  const ensurePreviewVideoSelection = () => {
    const pool = Array.isArray(state.config?.mainVideos)
      ? state.config.mainVideos
      : [];
    if (!pool.length) {
      state.previewVideoPath = '';
      return;
    }
    if (!state.previewVideoPath || !pool.includes(state.previewVideoPath)) {
      state.previewVideoPath = pool[0];
    }
  };

  const setPreviewVideo = (path) => {
    if (!path || path === state.previewVideoPath) {
      return;
    }
    state.previewVideoPath = path;
    updateStageMedia();
    updatePlayButton();
  };

  const renderOverlayPreview = () => {
    if (!elements.stageOverlayImage) {
      return;
    }
    const overlayPath = state.config?.santaOverlays?.[0];
    if (!overlayPath) {
      elements.stageOverlayImage.classList.add('hidden');
      elements.stageOverlayImage.removeAttribute('src');
      return;
    }
    elements.stageOverlayImage.src = fileToSrc(overlayPath);
    elements.stageOverlayImage.classList.remove('hidden');
  };

  const renderQuad = () => {
    const quad = state.config?.previewQuad;
    if (!quad) {
      return;
    }

    const rect = elements.stageWrapper.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (!width || !height) {
      requestAnimationFrame(renderQuad);
      return;
    }

    const polygonPoints = quad.map((point) => `${point.x * width},${point.y * height}`).join(' ');
    elements.quadPolygon.setAttribute('points', polygonPoints);

    elements.handles.forEach((handle, index) => {
      const point = quad[index];
      if (!handle || !point) {
        return;
      }
      handle.style.left = `${point.x * 100}%`;
      handle.style.top = `${point.y * 100}%`;
    });

    const quadPx = quad.map((point) => ({
      x: point.x * width,
      y: point.y * height
    }));
    applyPreviewTransformToElement(elements.cameraOverlay, quadPx, width, height);
    applyPreviewTransformToElement(elements.stageOverlayImage, quadPx, width, height);
  };

  const startHandleDrag = (event, index, handleEl) => {
    event.preventDefault();
    if (!state.isAdjustingQuad) {
      return;
    }
    state.isDraggingRegion = true;
    state.dragHandleIndex = index;
    state.activePointerId = event.pointerId;
    state.activeHandleEl = handleEl;
    handleEl?.setPointerCapture?.(event.pointerId);
    dragHandle(event);
  };

  const dragHandle = (event) => {
    event.preventDefault();
    if (state.dragHandleIndex === null || !state.config?.previewQuad) {
      return;
    }

    const rect = elements.stageWrapper.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);

    state.config.previewQuad[state.dragHandleIndex] = { x, y };
    renderQuad();
  };

  const renderPreviewVisibility = () => {
    const visibility = state.config?.previewVisibility || {};
    const startFrames = msToFrames(visibility.startMs ?? 0);
    const endFrames = msToFrames(visibility.endMs ?? 0);
    elements.previewStartInput.value = startFrames;
    elements.previewEndInput.value = endFrames;
    if (elements.previewFPSInput) {
      elements.previewFPSInput.value = getPreviewFrameRate();
    }
  };

  const renderResultTimer = () => {
    const value =
      state.config?.resultScreen?.autoResetMs !== undefined
        ? state.config.resultScreen.autoResetMs
        : defaultAutoReset();
    elements.autoResetInput.value = secondsFromMs(value);
  };

  const renderPrinterConfig = () => {
    const printer = state.config?.printer || {};
    elements.printerNameInput.value = printer.deviceName || '';
    elements.paperWidthInput.value = printer.paperWidthMm ?? 152;
    elements.paperHeightInput.value = printer.paperHeightMm ?? 102;
    elements.sheetsInput.value = printer.sheetsRemaining ?? 0;
  };

  const updatePreviewVisibility = () => {
    const fps = getPreviewFrameRate();
    const startFrames = Math.max(0, Number(elements.previewStartInput.value) || 0);
    const endFrames = Math.max(
      startFrames + 1,
      Number(elements.previewEndInput.value) || startFrames + 1
    );
    const startMs = framesToMs(startFrames);
    const endMs = framesToMs(endFrames);
    state.config.previewVisibility = {
      ...(state.config.previewVisibility || {}),
      startMs,
      endMs,
      frameRate: fps
    };
    elements.previewStartInput.value = startFrames;
    elements.previewEndInput.value = endFrames;
  };

  const getPreviewFrameRate = () => {
    const fps =
      Number(state.config?.previewVisibility?.frameRate) || DEFAULT_FRAME_RATE;
    return clamp(fps, 1, 240);
  };

  const framesToMs = (frames) => {
    const fps = getPreviewFrameRate();
    return Math.round(Math.max(0, frames || 0) * (1000 / fps));
  };

  const msToFrames = (ms) => {
    const fps = getPreviewFrameRate();
    return Math.round((Math.max(0, ms || 0) * fps) / 1000);
  };

  const secondsFromMs = (ms) => Math.round(Math.max(0, ms || 0) / 1000);

  const updateStageMedia = () => {
    if (!state.previewVideoPath) {
      elements.stageVideo.removeAttribute('src');
      elements.stageVideo.load();
      updatePlayButton();
      syncTimelineMeta();
      return;
    }

    const src = fileToSrc(state.previewVideoPath);
    if (elements.stageVideo.getAttribute('src') !== src) {
      elements.stageVideo.src = src;
      elements.stageVideo.pause();
      elements.stageVideo.currentTime = 0;
    }
    updatePlayButton();
    syncTimelineMeta();
  };

  const fileToSrc = (filePath) => {
    const normalized = filePath.replace(/\\/g, '/');
    return encodeURI(`file://${normalized}`);
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

  const ensurePreviewQuad = () => {
    if (!Array.isArray(state.config?.previewQuad) || state.config.previewQuad.length !== 4) {
      state.config.previewQuad = [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 }
      ];
    }
  };

  const defaultAutoReset = () => 20000;

  const showToast = (message) => {
    if (message && elements.toast) {
      elements.toast.textContent = message;
    }
    elements.toast.classList.remove('hidden');
    if (state.toastTimeout) {
      clearTimeout(state.toastTimeout);
    }
    state.toastTimeout = setTimeout(() => {
      elements.toast.classList.add('hidden');
      elements.toast.textContent = defaultToastMessage;
    }, 2000);
  };

  const startCameraOverlay = async () => {
    if (state.cameraStream) {
      return;
    }
    updateCameraOverlayStatus('Requesting camera access…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      state.cameraStream = stream;
      elements.cameraOverlayVideo.srcObject = stream;
      elements.cameraOverlay.classList.remove('hidden');
      const rect = elements.stageWrapper.getBoundingClientRect();
      updateCameraOverlayTransform(rect.width, rect.height);
      updateCameraOverlayStatus('Camera overlay active.');
      updateCameraOverlayControls();
    } catch (error) {
      console.error('Failed to start camera overlay', error);
      updateCameraOverlayStatus('Unable to access camera. Check permissions.');
      updateCameraOverlayControls();
    }
  };

  const stopCameraOverlay = () => {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((track) => track.stop());
      state.cameraStream = null;
    }
    if (elements.cameraOverlayVideo) {
      elements.cameraOverlayVideo.srcObject = null;
    }
    if (elements.cameraOverlay) {
      elements.cameraOverlay.classList.add('hidden');
      elements.cameraOverlay.style.transform = '';
    }
    updateCameraOverlayStatus('Camera overlay is off.');
    updateCameraOverlayControls();
  };

  const updateCameraOverlayControls = () => {
    const active = Boolean(state.cameraStream);
    elements.startCameraOverlayBtn.disabled = active;
    elements.stopCameraOverlayBtn.disabled = !active;
  };

  const updateCameraOverlayStatus = (message) => {
    if (elements.cameraOverlayStatus) {
      elements.cameraOverlayStatus.textContent = message;
    }
  };

  const updateCameraOverlayTransform = (width, height) => {
    const quad = state.config?.previewQuad;
    if (!quad || !elements.cameraOverlay) {
      return;
    }
    const quadPx = quad.map((point) => ({
      x: point.x * width,
      y: point.y * height
    }));
    applyPreviewTransformToElement(elements.cameraOverlay, quadPx, width, height);
  };

  const applyPreviewTransformToElement = (element, quadPx, width, height) => {
    if (!element || !quadPx || !width || !height) {
      return;
    }
    element.style.left = '0px';
    element.style.top = '0px';
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    const matrix = computePerspectiveMatrix(quadPx, width, height);
    if (matrix) {
      element.style.transform = `matrix3d(${matrix.join(',')})`;
    } else {
      element.style.transform = '';
    }
  };

  const togglePlayback = () => {
    if (elements.stageVideo.paused) {
      elements.stageVideo.play().catch(() => {});
    } else {
      elements.stageVideo.pause();
    }
  };

  const seekVideo = (value) => {
    const duration = elements.stageVideo.duration || 0;
    const clamped = clamp(value, 0, duration || 0);
    elements.stageVideo.currentTime = clamped;
  };

  const syncTimelineMeta = () => {
    const duration = elements.stageVideo.duration || 0;
    elements.timelineRange.max = duration;
    elements.timelineRange.value = elements.stageVideo.currentTime || 0;
    elements.currentTimeLabel.textContent = formatTime(elements.stageVideo.currentTime || 0);
    elements.durationLabel.textContent = duration ? formatTime(duration) : '0:00';
    updatePlayButton();
  };

  const updateTimelinePosition = () => {
    elements.timelineRange.value = elements.stageVideo.currentTime || 0;
    elements.currentTimeLabel.textContent = formatTime(elements.stageVideo.currentTime || 0);
  };

  const updatePlayButton = () => {
    if (elements.stageVideo.paused) {
      elements.playPauseBtn.textContent = 'Play';
      elements.playPauseBtn.classList.remove('playing');
    } else {
      elements.playPauseBtn.textContent = 'Pause';
      elements.playPauseBtn.classList.add('playing');
    }
    updateCueButtonsState();
  };

  const formatTime = (seconds) => {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const setPreviewTimeFromCurrent = (type) => {
    if (!state.config || !state.config.previewVisibility) {
      return;
    }
    const currentSeconds = Math.max(0, elements.stageVideo.currentTime || 0);
    const frames = Math.round(currentSeconds * getPreviewFrameRate());
    if (type === 'start') {
      elements.previewStartInput.value = frames;
    } else {
      elements.previewEndInput.value = frames;
    }
    updatePreviewVisibility();
  };

  const toggleQuadEditing = () => {
    state.isAdjustingQuad = !state.isAdjustingQuad;
    updateQuadEditState();
  };

  const updateQuadEditState = () => {
    if (elements.toggleQuadEditBtn) {
      elements.toggleQuadEditBtn.textContent = state.isAdjustingQuad
        ? 'Lock handles'
        : 'Enable handles';
    }
    if (elements.handlesLayer) {
      elements.handlesLayer.classList.toggle('locked', !state.isAdjustingQuad);
    }
  };

  const updateCueButtonsState = () => {
    const hasVideo = Boolean(state.previewVideoPath);
    const paused = elements.stageVideo.paused;
    const disabled = !hasVideo || !paused;
    elements.setStartBtn.disabled = disabled;
    elements.setEndBtn.disabled = disabled;
  };

  init();
})();
