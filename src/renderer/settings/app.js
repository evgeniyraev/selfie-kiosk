(() => {
  const state = {
    config: null,
    isDraggingRegion: false,
    dragHandleIndex: null,
    toastTimeout: null,
    cameraStream: null
  };

  const qs = (selector) => document.querySelector(selector);
  const elements = {
    idleInput: qs('#idleVideoInput'),
    idleBrowse: qs('#idleVideoBrowse'),
    mainInput: qs('#mainVideoInput'),
    mainBrowse: qs('#mainVideoBrowse'),
    shareInput: qs('#shareBaseInput'),
    saveBtn: qs('#saveBtn'),
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
    playPauseBtn: qs('#playPauseBtn'),
    timelineRange: qs('#timelineRange'),
    currentTimeLabel: qs('#currentTimeLabel'),
    durationLabel: qs('#durationLabel'),
    setStartBtn: qs('#setStartBtn'),
    setEndBtn: qs('#setEndBtn'),
    autoResetInput: qs('#autoResetInput'),
    startCameraOverlayBtn: qs('#startCameraOverlayBtn'),
    stopCameraOverlayBtn: qs('#stopCameraOverlayBtn'),
    cameraOverlayStatus: qs('#cameraOverlayStatus'),
    cameraOverlay: qs('#settingsCameraOverlay'),
    cameraOverlayVideo: qs('#settingsCameraOverlayVideo')
  };

  const init = async () => {
    attachEvents();
    const config = await window.settingsAPI.loadConfig();
    state.config = config;
    ensurePreviewQuad();
    render();
  };

  const attachEvents = () => {
    elements.idleBrowse.addEventListener('click', async () => {
      if (!state.config) {
        return;
      }
      const filePath = await window.settingsAPI.selectVideo();
      if (filePath) {
        state.config.idleVideo = filePath;
        render();
      }
    });

    elements.mainBrowse.addEventListener('click', async () => {
      if (!state.config) {
        return;
      }
      const filePath = await window.settingsAPI.selectVideo();
      if (filePath) {
        state.config.mainVideo = filePath;
        render();
      }
    });

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

    elements.handles.forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => {
        if (!state.config) {
          return;
        }
        const index = Number(handle.dataset.index);
        startHandleDrag(event, index);
      });
    });

    elements.autoResetInput.addEventListener('input', (event) => {
      if (!state.config) {
        return;
      }
      const value = Math.max(5000, Number(event.target.value) || defaultAutoReset());
      state.config.resultScreen = {
        ...(state.config.resultScreen || {}),
        autoResetMs: value
      };
      event.target.value = value;
    });

    window.addEventListener('pointermove', (event) => {
      if (state.isDraggingRegion) {
        dragHandle(event);
      }
    });

    window.addEventListener('pointerup', () => {
      state.isDraggingRegion = false;
      state.dragHandleIndex = null;
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
  };

  const render = () => {
    ensurePreviewQuad();
    elements.idleInput.value = state.config.idleVideo || '';
    elements.mainInput.value = state.config.mainVideo || '';
    elements.shareInput.value = state.config.shareBaseUrl || '';
    renderOverlayList();
    renderQuad();
    renderPreviewVisibility();
    renderResultTimer();
    updateCameraOverlayControls();
    updateStageMedia();
    syncTimelineMeta();
  };

  const renderOverlayList = () => {
    const overlays = state.config?.santaOverlays || [];
    elements.overlayList.innerHTML = '';

    if (!overlays.length) {
      const placeholder = document.createElement('p');
      placeholder.textContent = 'No overlays selected yet.';
      placeholder.className = 'helper';
      elements.overlayList.appendChild(placeholder);
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

    updateCameraOverlayTransform(width, height);
  };

  const startHandleDrag = (event, index) => {
    event.preventDefault();
    state.isDraggingRegion = true;
    state.dragHandleIndex = index;
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
    elements.previewStartInput.value = visibility.startMs ?? '';
    elements.previewEndInput.value = visibility.endMs ?? '';
  };

  const renderResultTimer = () => {
    const value =
      state.config?.resultScreen?.autoResetMs !== undefined
        ? state.config.resultScreen.autoResetMs
        : defaultAutoReset();
    elements.autoResetInput.value = value;
  };

  const updatePreviewVisibility = () => {
    const startValue = Number(elements.previewStartInput.value) || 0;
    const endValue = Number(elements.previewEndInput.value) || startValue + 250;
    const startMs = Math.max(0, startValue);
    const endMs = Math.max(startMs + 250, endValue);

    state.config.previewVisibility = {
      ...(state.config.previewVisibility || {}),
      startMs,
      endMs
    };
    renderPreviewVisibility();
  };

  const updateStageMedia = () => {
    if (!state.config || !state.config.mainVideo) {
      elements.stageVideo.removeAttribute('src');
      elements.stageVideo.load();
      updatePlayButton();
      syncTimelineMeta();
      return;
    }

    const src = fileToSrc(state.config.mainVideo);
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

  const showToast = () => {
    elements.toast.classList.remove('hidden');
    if (state.toastTimeout) {
      clearTimeout(state.toastTimeout);
    }
    state.toastTimeout = setTimeout(() => {
      elements.toast.classList.add('hidden');
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
    if (!elements.cameraOverlay) {
      return;
    }
    elements.cameraOverlay.style.left = '0px';
    elements.cameraOverlay.style.top = '0px';
    elements.cameraOverlay.style.width = `${width}px`;
    elements.cameraOverlay.style.height = `${height}px`;

    const quad = state.config?.previewQuad;
    if (!quad) {
      return;
    }
    const quadPx = quad.map((point) => ({
      x: point.x * width,
      y: point.y * height
    }));
    const matrix = computePerspectiveMatrix(quadPx, width, height);
    if (matrix) {
      elements.cameraOverlay.style.transform = `matrix3d(${matrix.join(',')})`;
    } else {
      elements.cameraOverlay.style.transform = '';
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
    const currentMs = Math.max(0, Math.round((elements.stageVideo.currentTime || 0) * 1000));
    if (type === 'start') {
      elements.previewStartInput.value = currentMs;
    } else {
      elements.previewEndInput.value = currentMs;
    }
    updatePreviewVisibility();
  };

  const updateCueButtonsState = () => {
    const hasVideo = Boolean(state.config?.mainVideo);
    const paused = elements.stageVideo.paused;
    const disabled = !hasVideo || !paused;
    elements.setStartBtn.disabled = disabled;
    elements.setEndBtn.disabled = disabled;
  };

  init();
})();
