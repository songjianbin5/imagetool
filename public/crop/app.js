(function () {
  "use strict";

  const els = {
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
    imageMeta: document.getElementById("imageMeta"),
    stageTitle: document.getElementById("stageTitle"),
    clearImageButton: document.getElementById("clearImageButton"),
    stageCanvas: document.getElementById("stageCanvas"),
    emptyState: document.getElementById("emptyState"),
    magnifier: document.getElementById("magnifier"),
    magnifierCanvas: document.getElementById("magnifierCanvas"),
    magnifierText: document.getElementById("magnifierText"),
    modeButtons: Array.from(document.querySelectorAll(".mode-tab")),
    panes: Array.from(document.querySelectorAll(".tool-pane")),
    cropW: document.getElementById("cropW"),
    cropH: document.getElementById("cropH"),
    resetCropButton: document.getElementById("resetCropButton"),
    trimTransparentButton: document.getElementById("trimTransparentButton"),
    downloadCropButton: document.getElementById("downloadCropButton"),
    verticalGuides: document.getElementById("verticalGuides"),
    verticalGuideAdd: document.getElementById("verticalGuideAdd"),
    horizontalGuides: document.getElementById("horizontalGuides"),
    horizontalGuideAdd: document.getElementById("horizontalGuideAdd"),
    splitCols: document.getElementById("splitCols"),
    splitRows: document.getElementById("splitRows"),
    applySplitButton: document.getElementById("applySplitButton"),
    addGuideButton: document.getElementById("addGuideButton"),
    selectAllSlicesButton: document.getElementById("selectAllSlicesButton"),
    invertSlicesButton: document.getElementById("invertSlicesButton"),
    clearSlicesButton: document.getElementById("clearSlicesButton"),
    sliceMeta: document.getElementById("sliceMeta"),
    guideList: document.getElementById("guideList"),
    sliceList: document.getElementById("sliceList"),
    formatSelect: document.getElementById("formatSelect"),
    qualityRange: document.getElementById("qualityRange"),
    qualityValue: document.getElementById("qualityValue"),
    sliceFormatSelect: document.getElementById("sliceFormatSelect"),
    sliceQualityMirror: document.getElementById("sliceQualityMirror"),
    sliceQualityValue: document.getElementById("sliceQualityValue"),
    downloadZipButton: document.getElementById("downloadZipButton"),
    statusText: null,
  };

  const ctx = els.stageCanvas.getContext("2d", { alpha: true });
  const magCtx = els.magnifierCanvas.getContext("2d", { alpha: true });
  const sourceCanvas = document.createElement("canvas");
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const previewCanvas = document.createElement("canvas");
  const previewCtx = previewCanvas.getContext("2d", { alpha: true });
  const magSampleCanvas = document.createElement("canvas");
  magSampleCanvas.width = 24;
  magSampleCanvas.height = 24;
  const magSampleCtx = magSampleCanvas.getContext("2d", { alpha: true });

  const state = {
    fileName: "image",
    image: null,
    width: 0,
    height: 0,
    crop: { x: 0, y: 0, w: 0, h: 0 },
    guidesX: [],
    guidesY: [],
    slices: [],
    excludedSlices: new Set(),
    mode: "crop",
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    view: { zoom: 1, panX: 0, panY: 0, baseScale: 1, maxZoom: 10 },
    previewScale: 1,
    renderFrame: 0,
    controlsDisabled: null,
    activePointers: new Map(),
    pinch: null,
    panDrag: null,
    spacePressed: false,
    drag: null,
    guideDrag: null,
    lastPointer: null,
  };

  const minCropSize = 1;
  const handleRadius = 13;
  const lazyScriptPromises = new Map();
  const mimeExt = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function round(value) {
    return Math.round(Number.isFinite(value) ? value : 0);
  }

  function spinNumberInput(input, direction) {
    const step = Number(input.step) || 1;
    const min = input.min === "" ? -Infinity : Number(input.min);
    const max = input.max === "" ? Infinity : Number(input.max);
    const current = Number(input.value || input.placeholder || 0);
    const decimals = String(input.step || "").includes(".") ? String(input.step).split(".")[1].length : 0;
    const rawNext = (Number.isFinite(current) ? current : 0) + direction * step;
    const next = clamp(rawNext, min, max);
    input.value = decimals ? next.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "") : String(Math.round(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindNumberWheelControls() {
    document.querySelectorAll('input[type="number"]').forEach((input) => {
      input.addEventListener(
        "wheel",
        (event) => {
          if (input.disabled) return;
          event.preventDefault();
          event.stopPropagation();
          spinNumberInput(input, event.deltaY < 0 ? 1 : -1);
        },
        { passive: false },
      );
    });
  }

  function hasImage() {
    return Boolean(state.image && state.width > 0 && state.height > 0);
  }

  function setStatus(text) {
    if (els.statusText) {
      els.statusText.textContent = text;
    }
  }

  function resetView() {
    state.view.zoom = 1;
    state.view.panX = 0;
    state.view.panY = 0;
    state.view.baseScale = 1;
    state.activePointers.clear();
    state.pinch = null;
    state.panDrag = null;
  }

  function stagePadding(cssWidth) {
    return cssWidth < 520 ? 18 : 30;
  }

  function defaultStageHeight() {
    return window.matchMedia("(max-width: 720px)").matches ? 430 : 620;
  }

  function fittedStageHeight(cssWidth) {
    const fallback = defaultStageHeight();
    if (!hasImage()) {
      return fallback;
    }
    const pad = stagePadding(cssWidth);
    const availableWidth = Math.max(80, cssWidth - pad * 2);
    const fitScale = Math.max(availableWidth / state.width, 0.01);
    return Math.max(fallback, Math.round(state.height * fitScale + pad * 2));
  }

  function buildPreviewCanvas() {
    if (!hasImage()) {
      previewCanvas.width = 0;
      previewCanvas.height = 0;
      state.previewScale = 1;
      return;
    }
    const maxPreviewSide = 3200;
    const longestSide = Math.max(state.width, state.height);
    state.previewScale = Math.min(1, maxPreviewSide / longestSide);
    previewCanvas.width = Math.max(1, Math.round(state.width * state.previewScale));
    previewCanvas.height = Math.max(1, Math.round(state.height * state.previewScale));
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCtx.imageSmoothingEnabled = true;
    previewCtx.imageSmoothingQuality = "high";
    previewCtx.drawImage(sourceCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  function requestRender() {
    if (state.renderFrame) {
      return;
    }
    state.renderFrame = window.requestAnimationFrame(() => {
      state.renderFrame = 0;
      render();
    });
  }

  function loadScriptOnce(src, globalName) {
    if (globalName && window[globalName]) {
      return Promise.resolve(window[globalName]);
    }
    if (lazyScriptPromises.has(src)) {
      return lazyScriptPromises.get(src);
    }

    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-lazy-src="${src}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(globalName ? window[globalName] : undefined), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.defer = true;
      script.dataset.lazySrc = src;
      script.onload = () => resolve(globalName ? window[globalName] : undefined);
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });

    lazyScriptPromises.set(src, promise);
    return promise;
  }

  async function ensureZipLibrary() {
    await loadScriptOnce("/batch/vendor/jszip.min.js", "JSZip");
    if (!window.JSZip) {
      throw new Error("ZIP 打包依赖加载失败。");
    }
    return window.JSZip;
  }

  function setMode(mode) {
    state.mode = mode;
    els.modeButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    els.panes.forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.pane === mode);
    });
    render();
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("请选择图片文件");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = function () {
      URL.revokeObjectURL(url);
      state.fileName = file.name.replace(/\.[^.]+$/, "") || "image";
      state.image = image;
      state.width = image.naturalWidth;
      state.height = image.naturalHeight;
      sourceCanvas.width = state.width;
      sourceCanvas.height = state.height;
      sourceCtx.clearRect(0, 0, state.width, state.height);
      sourceCtx.drawImage(image, 0, 0);
      buildPreviewCanvas();
      state.crop = { x: 0, y: 0, w: state.width, h: state.height };
      state.guidesX = [];
      state.guidesY = [];
      state.excludedSlices = new Set();
      resetView();
      els.verticalGuides.value = "";
      els.horizontalGuides.value = "";
      els.verticalGuideAdd.value = "";
      els.horizontalGuideAdd.value = "";
      els.stageTitle.textContent = state.fileName;
      els.imageMeta.textContent = `${state.width} x ${state.height}`;
      els.emptyState.classList.add("hidden");
      els.clearImageButton.classList.add("visible");
      updateCropInputs();
      rebuildSlices();
      resizeStage();
      setStatus("已载入");
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      setStatus("图片读取失败");
    };
    image.src = url;
  }

  function clearImage() {
    state.fileName = "image";
    state.image = null;
    state.width = 0;
    state.height = 0;
    state.crop = { x: 0, y: 0, w: 0, h: 0 };
    state.guidesX = [];
    state.guidesY = [];
    state.slices = [];
    state.excludedSlices = new Set();
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    state.previewScale = 1;
    state.drag = null;
    state.guideDrag = null;
    resetView();
    els.fileInput.value = "";
    els.stageTitle.textContent = "上传图片";
    els.imageMeta.textContent = "未选择图片";
    els.emptyState.classList.remove("hidden");
    els.clearImageButton.classList.remove("visible");
    els.verticalGuides.value = "";
    els.horizontalGuides.value = "";
    els.verticalGuideAdd.value = "";
    els.horizontalGuideAdd.value = "";
    updateCropInputs();
    renderGuideList();
    renderSliceList();
    setStatus("待上传");
    render();
  }

  function resizeStage() {
    const wrap = els.stageCanvas.parentElement;
    const cssWidth = Math.max(320, Math.round(wrap.clientWidth));
    const cssHeight = fittedStageHeight(cssWidth);
    const ratio = window.devicePixelRatio || 1;
    els.stageCanvas.width = Math.round(cssWidth * ratio);
    els.stageCanvas.height = Math.round(cssHeight * ratio);
    els.stageCanvas.style.height = `${cssHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  }

  function computeTransform() {
    const cssWidth = els.stageCanvas.clientWidth;
    const cssHeight = els.stageCanvas.clientHeight;
    if (!hasImage()) {
      state.transform = { scale: 1, offsetX: 0, offsetY: 0 };
      return;
    }
    const pad = stagePadding(cssWidth);
    const fitScale = Math.max((cssWidth - pad * 2) / state.width, 0.01);
    state.view.baseScale = fitScale;
    const safeScale = fitScale * state.view.zoom;
    state.transform = {
      scale: safeScale,
      offsetX: (cssWidth - state.width * safeScale) / 2 + state.view.panX,
      offsetY: pad + state.view.panY,
    };
  }

  function imageToCanvas(point) {
    const t = state.transform;
    return {
      x: t.offsetX + point.x * t.scale,
      y: t.offsetY + point.y * t.scale,
    };
  }

  function canvasToImage(point) {
    const t = state.transform;
    return {
      x: clamp((point.x - t.offsetX) / t.scale, 0, state.width),
      y: clamp((point.y - t.offsetY) / t.scale, 0, state.height),
    };
  }

  function canvasToImageRaw(point) {
    const t = state.transform;
    return {
      x: (point.x - t.offsetX) / t.scale,
      y: (point.y - t.offsetY) / t.scale,
    };
  }

  function pointerPosition(event) {
    const rect = els.stageCanvas.getBoundingClientRect();
    const ratioX = els.stageCanvas.clientWidth ? els.stageCanvas.width / els.stageCanvas.clientWidth : 1;
    const ratioY = els.stageCanvas.clientHeight ? els.stageCanvas.height / els.stageCanvas.clientHeight : 1;
    const scaleX = ratioX / (window.devicePixelRatio || 1);
    const scaleY = ratioY / (window.devicePixelRatio || 1);
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      clientX: (a.clientX + b.clientX) / 2,
      clientY: (a.clientY + b.clientY) / 2,
    };
  }

  function setZoomAroundImagePoint(nextZoom, canvasPoint, imagePoint) {
    const zoom = clamp(nextZoom, 1, state.view.maxZoom);
    if (zoom <= 1.0001) {
      state.view.zoom = 1;
      state.view.panX = 0;
      state.view.panY = 0;
      requestRender();
      return;
    }

    state.view.zoom = zoom;
    computeTransform();
    const after = imageToCanvas(imagePoint);
    state.view.panX += canvasPoint.x - after.x;
    state.view.panY += canvasPoint.y - after.y;
    requestRender();
  }

  function zoomAt(canvasPoint, nextZoom) {
    if (!hasImage()) {
      return;
    }
    computeTransform();
    const imagePoint = canvasToImageRaw(canvasPoint);
    setZoomAroundImagePoint(nextZoom, canvasPoint, imagePoint);
  }

  function startPinch() {
    const points = Array.from(state.activePointers.values());
    if (points.length < 2 || !hasImage()) {
      return;
    }
    const first = points[0];
    const second = points[1];
    const center = midpoint(first, second);
    computeTransform();
    state.pinch = {
      distance: Math.max(distanceBetween(first, second), 1),
      zoom: state.view.zoom,
      imagePoint: canvasToImageRaw(center),
    };
    state.drag = null;
    state.guideDrag = null;
    hideMagnifier();
  }

  function movePinch() {
    const points = Array.from(state.activePointers.values());
    if (!state.pinch || points.length < 2) {
      return;
    }
    const first = points[0];
    const second = points[1];
    const center = midpoint(first, second);
    const factor = Math.max(distanceBetween(first, second), 1) / state.pinch.distance;
    setZoomAroundImagePoint(state.pinch.zoom * factor, center, state.pinch.imagePoint);
  }

  function wheelZoom(event) {
    if (!hasImage()) {
      return;
    }
    event.preventDefault();
    const point = pointerPosition(event);
    const factor = Math.exp(-event.deltaY * 0.0012);
    zoomAt(point, state.view.zoom * factor);
  }

  function isEditableTarget(target) {
    return Boolean(target && target.closest && target.closest("input, textarea, select, button, [contenteditable='true']"));
  }

  function shouldPanWithPointer(event) {
    return event.button === 1 || (state.spacePressed && event.button === 0);
  }

  function startPan(point) {
    state.panDrag = {
      startPoint: point,
      startPanX: state.view.panX,
      startPanY: state.view.panY,
    };
    state.drag = null;
    state.guideDrag = null;
    hideMagnifier();
    els.stageCanvas.style.cursor = "grabbing";
  }

  function movePan(point) {
    if (!state.panDrag) {
      return;
    }
    state.view.panX = state.panDrag.startPanX + point.x - state.panDrag.startPoint.x;
    state.view.panY = state.panDrag.startPanY + point.y - state.panDrag.startPoint.y;
    requestRender();
    els.stageCanvas.style.cursor = "grabbing";
  }

  function updateStageCursor(point) {
    if (!hasImage()) {
      els.stageCanvas.style.cursor = "";
      return;
    }
    if (state.panDrag) {
      els.stageCanvas.style.cursor = "grabbing";
      return;
    }
    if (state.spacePressed && pointInsideImage(point)) {
      els.stageCanvas.style.cursor = "grab";
      return;
    }
    if (state.mode === "slice") {
      const guide = hitTestGuide(point);
      if (guide) {
        els.stageCanvas.style.cursor = guide.axis === "x" ? "ew-resize" : "ns-resize";
      } else {
        els.stageCanvas.style.cursor = pointInsideImage(point) ? "default" : "crosshair";
      }
      return;
    }
    els.stageCanvas.style.cursor = cropCursor(hitTestCrop(point));
  }

  function render() {
    const cssWidth = els.stageCanvas.clientWidth || 1;
    const cssHeight = els.stageCanvas.clientHeight || 1;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    computeTransform();

    if (!hasImage()) {
      updateDisabledState();
      return;
    }

    const t = state.transform;
    ctx.imageSmoothingEnabled = true;
    const displaySource = previewCanvas.width && previewCanvas.height ? previewCanvas : sourceCanvas;
    ctx.drawImage(displaySource, t.offsetX, t.offsetY, state.width * t.scale, state.height * t.scale);

    if (state.mode === "slice") {
      drawSlices();
      drawGuides();
    } else {
      drawCropRect();
    }
    updateDisabledState();
  }

  function drawGuides() {
    const t = state.transform;
    ctx.save();
    ctx.strokeStyle = "rgba(10, 132, 255, 0.86)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);

    state.guidesX.forEach((x) => {
      const cx = t.offsetX + x * t.scale;
      ctx.beginPath();
      ctx.moveTo(cx, t.offsetY);
      ctx.lineTo(cx, t.offsetY + state.height * t.scale);
      ctx.stroke();
    });

    state.guidesY.forEach((y) => {
      const cy = t.offsetY + y * t.scale;
      ctx.beginPath();
      ctx.moveTo(t.offsetX, cy);
      ctx.lineTo(t.offsetX + state.width * t.scale, cy);
      ctx.stroke();
    });

    ctx.restore();
  }

  function drawSlices() {
    const t = state.transform;
    if (!state.slices.length) {
      return;
    }

    ctx.save();
    state.slices.forEach((slice) => {
      const x = t.offsetX + slice.x * t.scale;
      const y = t.offsetY + slice.y * t.scale;
      const w = slice.w * t.scale;
      const h = slice.h * t.scale;
      const excluded = state.excludedSlices.has(slice.id);
      ctx.fillStyle = excluded ? "rgba(239, 68, 68, 0.18)" : "rgba(10, 132, 255, 0.1)";
      ctx.strokeStyle = excluded ? "rgba(239, 68, 68, 0.8)" : "rgba(10, 132, 255, 0.78)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      if (excluded) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.moveTo(x + w, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
      }

      if (w > 42 && h > 30) {
        ctx.fillStyle = "#667085";
        ctx.font = "800 13px Inter, Segoe UI, sans-serif";
        ctx.fillText(slice.name, x + 8, y + 19);
      }
    });
    ctx.restore();
  }

  function drawCropRect() {
    const t = state.transform;
    const crop = state.crop;
    const x = t.offsetX + crop.x * t.scale;
    const y = t.offsetY + crop.y * t.scale;
    const w = crop.w * t.scale;
    const h = crop.h * t.scale;

    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.32)";
    ctx.beginPath();
    ctx.rect(t.offsetX, t.offsetY, state.width * t.scale, state.height * t.scale);
    ctx.rect(x, y, w, h);
    ctx.fill("evenodd");

    ctx.strokeStyle = "#0a84ff";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    getHandlePoints().forEach((handle) => {
      const point = imageToCanvas(handle);
      ctx.beginPath();
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#0a84ff";
      ctx.lineWidth = 2;
      ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function getHandlePoints() {
    const c = state.crop;
    const midX = c.x + c.w / 2;
    const midY = c.y + c.h / 2;
    return [
      { id: "nw", x: c.x, y: c.y },
      { id: "n", x: midX, y: c.y },
      { id: "ne", x: c.x + c.w, y: c.y },
      { id: "e", x: c.x + c.w, y: midY },
      { id: "se", x: c.x + c.w, y: c.y + c.h },
      { id: "s", x: midX, y: c.y + c.h },
      { id: "sw", x: c.x, y: c.y + c.h },
      { id: "w", x: c.x, y: midY },
    ];
  }

  function hitTestCrop(point) {
    const imagePoint = canvasToImage(point);
    const tolerance = handleRadius / state.transform.scale;
    let nearest = null;
    let nearestDistance = Infinity;
    getHandlePoints().forEach((handle) => {
      const distance = Math.hypot(handle.x - imagePoint.x, handle.y - imagePoint.y);
      if (distance < tolerance && distance < nearestDistance) {
        nearest = handle.id;
        nearestDistance = distance;
      }
    });
    if (nearest) {
      return nearest;
    }
    const c = state.crop;
    const nearLeft = Math.abs(imagePoint.x - c.x) < tolerance;
    const nearRight = Math.abs(imagePoint.x - (c.x + c.w)) < tolerance;
    const nearTop = Math.abs(imagePoint.y - c.y) < tolerance;
    const nearBottom = Math.abs(imagePoint.y - (c.y + c.h)) < tolerance;
    const withinX = imagePoint.x >= c.x - tolerance && imagePoint.x <= c.x + c.w + tolerance;
    const withinY = imagePoint.y >= c.y - tolerance && imagePoint.y <= c.y + c.h + tolerance;

    if (nearTop && withinX) {
      return "n";
    }
    if (nearBottom && withinX) {
      return "s";
    }
    if (nearLeft && withinY) {
      return "w";
    }
    if (nearRight && withinY) {
      return "e";
    }
    if (imagePoint.x >= c.x && imagePoint.x <= c.x + c.w && imagePoint.y >= c.y && imagePoint.y <= c.y + c.h) {
      return "move";
    }
    return null;
  }

  function cropCursor(action) {
    const cursors = {
      n: "ns-resize",
      s: "ns-resize",
      e: "ew-resize",
      w: "ew-resize",
      ne: "nesw-resize",
      sw: "nesw-resize",
      nw: "nwse-resize",
      se: "nwse-resize",
      move: "move",
    };
    return cursors[action] || "default";
  }

  function normalizeCrop(crop) {
    let x = crop.x;
    let y = crop.y;
    let w = crop.w;
    let h = crop.h;
    if (w < 0) {
      x += w;
      w = Math.abs(w);
    }
    if (h < 0) {
      y += h;
      h = Math.abs(h);
    }
    x = clamp(round(x), 0, Math.max(0, state.width - minCropSize));
    y = clamp(round(y), 0, Math.max(0, state.height - minCropSize));
    w = clamp(round(w), minCropSize, state.width - x);
    h = clamp(round(h), minCropSize, state.height - y);
    return { x, y, w, h };
  }

  function applyCrop(crop) {
    state.crop = normalizeCrop(crop);
    updateCropInputs();
    render();
  }

  function updateCropInputs() {
    els.cropW.value = state.crop.w;
    els.cropH.value = state.crop.h;
  }

  function readCropInputs() {
    if (!hasImage()) {
      return;
    }
    applyCrop({
      x: state.crop.x,
      y: state.crop.y,
      w: Number(els.cropW.value),
      h: Number(els.cropH.value),
    });
  }

  function startPointer(event) {
    if (!hasImage()) {
      return;
    }
    event.preventDefault();
    const point = pointerPosition(event);
    state.activePointers.set(event.pointerId, point);
    if (els.stageCanvas.setPointerCapture) {
      els.stageCanvas.setPointerCapture(event.pointerId);
    }
    if (state.activePointers.size >= 2) {
      startPinch();
      return;
    }
    if (shouldPanWithPointer(event)) {
      startPan(point);
      return;
    }
    const imagePoint = canvasToImage(point);
    state.lastPointer = imagePoint;

    if (state.mode === "slice") {
      state.guideDrag = hitTestGuide(point);
      if (state.guideDrag) {
        els.stageCanvas.style.cursor = state.guideDrag.axis === "x" ? "ew-resize" : "ns-resize";
      } else {
        state.guideDrag = {
          axis: null,
          startPoint: imagePoint,
          startCanvasPoint: point,
          moved: false,
          sliceId: findSliceAt(imagePoint)?.id || null,
        };
      }
      return;
    }

    const action = hitTestCrop(point);
    if (!action) {
      state.drag = null;
      return;
    }
    state.drag = {
      action,
      startPoint: imagePoint,
      startCrop: { ...state.crop },
    };

    showMagnifier(point, imagePoint);
  }

  function movePointer(event) {
    if (!hasImage()) {
      return;
    }
    const point = pointerPosition(event);
    if (state.activePointers.has(event.pointerId)) {
      state.activePointers.set(event.pointerId, point);
    }
    if (state.pinch) {
      event.preventDefault();
      movePinch();
      return;
    }
    if (state.panDrag) {
      event.preventDefault();
      movePan(point);
      return;
    }
    const imagePoint = canvasToImage(point);
    state.lastPointer = imagePoint;

    if (state.mode === "slice") {
      if (state.guideDrag) {
        event.preventDefault();
        moveGuideDrag(point);
      } else {
        updateStageCursor(point);
      }
      return;
    }

    if (!state.drag) {
      updateStageCursor(point);
      return;
    }

    event.preventDefault();
    const drag = state.drag;
    const start = drag.startCrop;
    const dx = imagePoint.x - drag.startPoint.x;
    const dy = imagePoint.y - drag.startPoint.y;
    let next = { ...start };

    if (drag.action === "move") {
      next.x = clamp(start.x + dx, 0, state.width - start.w);
      next.y = clamp(start.y + dy, 0, state.height - start.h);
    } else {
      next = resizeCropFromHandle(start, drag.action, dx, dy);
    }

    state.crop = normalizeCrop(next);
    updateCropInputs();
    requestRender();
    showMagnifier(point, imagePoint);
  }

  function endPointer(event) {
    if (event && state.activePointers.has(event.pointerId)) {
      state.activePointers.delete(event.pointerId);
    }
    if (state.pinch) {
      if (state.activePointers.size >= 2) {
        startPinch();
      } else {
        state.pinch = null;
      }
      state.drag = null;
      state.guideDrag = null;
      hideMagnifier();
      return;
    }
    if (state.panDrag) {
      state.panDrag = null;
    }
    if (state.guideDrag) {
      endGuideDrag();
    }
    state.drag = null;
    hideMagnifier();
  }

  function moveGuideDrag(point) {
    const drag = state.guideDrag;
    const raw = canvasToImageRaw(point);

    if (!drag.axis) {
      drag.moved = drag.moved || Math.hypot(point.x - drag.startCanvasPoint.x, point.y - drag.startCanvasPoint.y) > 5;
      return;
    }

    drag.moved = true;
    if (drag.axis === "x") {
      const value = round(raw.x);
      if (drag.index >= 0) {
        state.guidesX[drag.index] = value;
      } else if (value > 0 && value < state.width) {
        state.guidesX.push(value);
        drag.index = state.guidesX.length - 1;
        drag.created = true;
      }
    } else {
      const value = round(raw.y);
      if (drag.index >= 0) {
        state.guidesY[drag.index] = value;
      } else if (value > 0 && value < state.height) {
        state.guidesY.push(value);
        drag.index = state.guidesY.length - 1;
        drag.created = true;
      }
    }

    rebuildSlices(false);
    requestRender();
  }

  function endGuideDrag() {
    const drag = state.guideDrag;
    state.guideDrag = null;
    els.stageCanvas.style.cursor = "";

    if (!drag.axis) {
      if (!drag.moved && drag.sliceId) {
        toggleSlice(drag.sliceId);
      }
      return;
    }

    const source = drag.axis === "x" ? state.guidesX : state.guidesY;
    const limit = drag.axis === "x" ? state.width : state.height;
    const cleaned = source
      .map(round)
      .filter((value) => value > 0 && value < limit)
      .sort((a, b) => a - b);

    if (drag.axis === "x") {
      state.guidesX = Array.from(new Set(cleaned));
    } else {
      state.guidesY = Array.from(new Set(cleaned));
    }
    commitGuideChange();
  }

  function resizeCropFromHandle(start, handle, dx, dy) {
    const next = { ...start };
    if (handle.includes("w")) {
      next.x = start.x + dx;
      next.w = start.w - dx;
    }
    if (handle.includes("e")) {
      next.w = start.w + dx;
    }
    if (handle.includes("n")) {
      next.y = start.y + dy;
      next.h = start.h - dy;
    }
    if (handle.includes("s")) {
      next.h = start.h + dy;
    }
    return next;
  }

  function showMagnifier(pointer, imagePoint) {
    const size = 24;
    const half = size / 2;
    const centerX = clamp(round(imagePoint.x), 0, Math.max(0, state.width - 1));
    const centerY = clamp(round(imagePoint.y), 0, Math.max(0, state.height - 1));
    const sx = centerX - half;
    const sy = centerY - half;

    magSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
    magSampleCtx.clearRect(0, 0, size, size);
    magSampleCtx.imageSmoothingEnabled = false;
    magSampleCtx.drawImage(sourceCanvas, -sx, -sy);

    magCtx.clearRect(0, 0, els.magnifierCanvas.width, els.magnifierCanvas.height);
    magCtx.imageSmoothingEnabled = false;
    magCtx.drawImage(magSampleCanvas, 0, 0, size, size, 0, 0, els.magnifierCanvas.width, els.magnifierCanvas.height);
    magCtx.strokeStyle = "rgba(10, 132, 255, 0.9)";
    magCtx.lineWidth = 2;
    magCtx.beginPath();
    const center = els.magnifierCanvas.width / 2;
    magCtx.moveTo(center, 0);
    magCtx.lineTo(center, els.magnifierCanvas.height);
    magCtx.moveTo(0, center);
    magCtx.lineTo(els.magnifierCanvas.width, center);
    magCtx.stroke();
    els.magnifierText.textContent = `${centerX}, ${centerY}`;

    const wrapRect = els.stageCanvas.parentElement.getBoundingClientRect();
    const localX = pointer.clientX - wrapRect.left;
    const localY = pointer.clientY - wrapRect.top;
    const magWidth = els.magnifier.offsetWidth || 150;
    const magHeight = els.magnifier.offsetHeight || 166;
    const gap = 18;
    const preferRight = localX < wrapRect.width - magWidth - gap;
    const preferBelow = localY < magHeight + gap;
    const rawLeft = preferRight ? localX + gap : localX - magWidth - gap;
    const rawTop = preferBelow ? localY + gap : localY - magHeight - gap;
    const left = clamp(rawLeft, 8, Math.max(8, wrapRect.width - magWidth - 8));
    const top = clamp(rawTop, 8, Math.max(8, wrapRect.height - magHeight - 8));
    els.magnifier.style.left = `${left}px`;
    els.magnifier.style.top = `${top}px`;
    els.magnifier.classList.add("visible");
  }

  function hideMagnifier() {
    els.magnifier.classList.remove("visible");
  }

  function parseGuides(value, max) {
    return Array.from(new Set(String(value)
      .split(/[,，\s]+/)
      .map((item) => round(Number(item)))
      .filter((item) => item > 0 && item < max)))
      .sort((a, b) => a - b);
  }

  function clearGuides() {
    if (!hasImage()) {
      return;
    }
    state.guidesX = [];
    state.guidesY = [];
    state.excludedSlices = new Set();
    els.verticalGuides.value = "";
    els.horizontalGuides.value = "";
    els.verticalGuideAdd.value = "";
    els.horizontalGuideAdd.value = "";
    rebuildSlices();
    renderGuideList();
    render();
  }

  function commitGuideChange() {
    state.guidesX = Array.from(new Set(state.guidesX))
      .filter((value) => value > 0 && value < state.width)
      .sort((a, b) => a - b);
    state.guidesY = Array.from(new Set(state.guidesY))
      .filter((value) => value > 0 && value < state.height)
      .sort((a, b) => a - b);
    state.excludedSlices = new Set();
    rebuildSlices();
    renderGuideList();
    render();
  }

  function applyEqualSplit() {
    if (!hasImage()) {
      return;
    }
    const leftMargin = Math.max(0, round(Number(els.verticalGuides.value)));
    const rightMargin = Math.max(0, round(Number(els.verticalGuideAdd.value)));
    const topMargin = Math.max(0, round(Number(els.horizontalGuides.value)));
    const bottomMargin = Math.max(0, round(Number(els.horizontalGuideAdd.value)));
    const safeLeft = clamp(leftMargin, 0, Math.max(0, state.width - 1));
    const safeRight = clamp(rightMargin, 0, Math.max(0, state.width - safeLeft - 1));
    const safeTop = clamp(topMargin, 0, Math.max(0, state.height - 1));
    const safeBottom = clamp(bottomMargin, 0, Math.max(0, state.height - safeTop - 1));
    const innerLeft = safeLeft;
    const innerRight = state.width - safeRight;
    const innerTop = safeTop;
    const innerBottom = state.height - safeBottom;
    const colsValue = Number(els.splitCols.value);
    const rowsValue = Number(els.splitRows.value);
    const cols = Number.isFinite(colsValue) && colsValue > 1 ? clamp(round(colsValue), 1, 20) : 1;
    const rows = Number.isFinite(rowsValue) && rowsValue > 1 ? clamp(round(rowsValue), 1, 20) : 1;
    state.guidesX = [];
    state.guidesY = [];
    if (innerLeft > 0 && innerLeft < state.width) {
      state.guidesX.push(innerLeft);
    }
    if (innerRight > 0 && innerRight < state.width) {
      state.guidesX.push(innerRight);
    }
    if (innerTop > 0 && innerTop < state.height) {
      state.guidesY.push(innerTop);
    }
    if (innerBottom > 0 && innerBottom < state.height) {
      state.guidesY.push(innerBottom);
    }
    for (let i = 1; i < cols; i += 1) {
      state.guidesX.push(round(innerLeft + ((innerRight - innerLeft) * i) / cols));
    }
    for (let i = 1; i < rows; i += 1) {
      state.guidesY.push(round(innerTop + ((innerBottom - innerTop) * i) / rows));
    }
    state.guidesX = parseGuides(state.guidesX.join(","), state.width);
    state.guidesY = parseGuides(state.guidesY.join(","), state.height);
    state.excludedSlices = new Set();
    rebuildSlices();
    renderGuideList();
    render();
  }

  function rebuildSlices(updateLists = true) {
    if (!hasImage()) {
      state.slices = [];
      if (updateLists) {
        renderSliceList();
      }
      return;
    }

    const xs = [0, ...parseGuides(state.guidesX.join(","), state.width), state.width];
    const ys = [0, ...parseGuides(state.guidesY.join(","), state.height), state.height];
    const oldExcluded = new Set(state.excludedSlices);
    state.slices = [];
    let index = 1;
    for (let row = 0; row < ys.length - 1; row += 1) {
      for (let col = 0; col < xs.length - 1; col += 1) {
        const slice = {
          id: `${col}-${row}-${xs[col]}-${ys[row]}-${xs[col + 1]}-${ys[row + 1]}`,
          name: `切片 ${String(index).padStart(2, "0")}`,
          x: xs[col],
          y: ys[row],
          w: xs[col + 1] - xs[col],
          h: ys[row + 1] - ys[row],
        };
        if (slice.w > 0 && slice.h > 0) {
          state.slices.push(slice);
          index += 1;
        }
      }
    }
    state.excludedSlices = new Set(state.slices.filter((slice) => oldExcluded.has(slice.id)).map((slice) => slice.id));
    if (updateLists) {
      renderGuideList();
      renderSliceList();
    }
  }

  function renderGuideList() {
    if (!els.guideList) {
      return;
    }
    els.guideList.innerHTML = "";
    if (!hasImage()) {
      els.guideList.textContent = "上传图片后可添加参考线";
      return;
    }
    const guides = [
      ...state.guidesX.map((value) => ({ axis: "x", value, label: `竖向 X ${value}` })),
      ...state.guidesY.map((value) => ({ axis: "y", value, label: `横向 Y ${value}` })),
    ];
    if (!guides.length) {
      els.guideList.textContent = "暂无参考线";
      return;
    }
    guides.forEach((guide) => {
      const item = document.createElement("div");
      item.className = "guide-item";
      item.innerHTML = `<span>${guide.label}</span>`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "移除";
      button.addEventListener("click", () => removeGuide(guide.axis, guide.value));
      item.appendChild(button);
      els.guideList.appendChild(item);
    });
  }

  function removeGuide(axis, value) {
    if (axis === "x") {
      state.guidesX = state.guidesX.filter((item) => item !== value);
      els.verticalGuides.value = state.guidesX.join(", ");
    } else {
      state.guidesY = state.guidesY.filter((item) => item !== value);
      els.horizontalGuides.value = state.guidesY.join(", ");
    }
    state.excludedSlices = new Set();
    rebuildSlices();
    renderGuideList();
    render();
  }

  function renderSliceList() {
    const kept = state.slices.filter((slice) => !state.excludedSlices.has(slice.id)).length;
    els.sliceMeta.textContent = `${kept} / ${state.slices.length} 个切片`;
    els.sliceList.innerHTML = "";

    if (!hasImage()) {
      els.sliceList.textContent = "";
      return;
    }

    state.slices.forEach((slice) => {
      const item = document.createElement("div");
      const excluded = state.excludedSlices.has(slice.id);
      item.className = `slice-item${excluded ? " excluded" : ""}`;
      item.innerHTML = `<span class="slice-detail">${slice.name} · ${slice.w}x${slice.h}</span>`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = excluded ? "保留" : "不要";
      button.addEventListener("click", () => toggleSlice(slice.id));
      item.appendChild(button);
      els.sliceList.appendChild(item);
    });
  }

  function findSliceAt(point) {
    return state.slices.find((slice) => (
      point.x >= slice.x &&
      point.x <= slice.x + slice.w &&
      point.y >= slice.y &&
      point.y <= slice.y + slice.h
    ));
  }

  function imageBounds() {
    const t = state.transform;
    return {
      left: t.offsetX,
      top: t.offsetY,
      right: t.offsetX + state.width * t.scale,
      bottom: t.offsetY + state.height * t.scale,
    };
  }

  function pointInsideImage(point) {
    const bounds = imageBounds();
    return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
  }

  function hitTestGuide(point) {
    if (state.mode !== "slice") {
      return null;
    }
    const tolerance = Math.max(10 / state.transform.scale, 2);
    const raw = canvasToImageRaw(point);
    const inside = pointInsideImage(point);
    let nearest = null;
    let nearestDistance = Infinity;

    if (inside) {
      state.guidesX.forEach((value, index) => {
        const distance = Math.abs(raw.x - value);
        if (distance < tolerance && distance < nearestDistance) {
          nearest = { axis: "x", index, value };
          nearestDistance = distance;
        }
      });
      state.guidesY.forEach((value, index) => {
        const distance = Math.abs(raw.y - value);
        if (distance < tolerance && distance < nearestDistance) {
          nearest = { axis: "y", index, value };
          nearestDistance = distance;
        }
      });
      return nearest;
    }

    const bounds = imageBounds();
    if (point.y >= bounds.top && point.y <= bounds.bottom && (point.x < bounds.left || point.x > bounds.right)) {
      return { axis: "x", index: -1, value: null, created: false, external: true };
    }
    if (point.x >= bounds.left && point.x <= bounds.right && (point.y < bounds.top || point.y > bounds.bottom)) {
      return { axis: "y", index: -1, value: null, created: false, external: true };
    }
    return null;
  }

  function toggleSlice(id) {
    if (state.excludedSlices.has(id)) {
      state.excludedSlices.delete(id);
    } else {
      state.excludedSlices.add(id);
    }
    renderSliceList();
    render();
  }

  function setAllSlices(keep) {
    if (keep) {
      state.excludedSlices = new Set();
    } else {
      state.excludedSlices = new Set(state.slices.map((slice) => slice.id));
    }
    renderSliceList();
    render();
  }

  function invertSlices() {
    state.excludedSlices = new Set(state.slices.filter((slice) => !state.excludedSlices.has(slice.id)).map((slice) => slice.id));
    renderSliceList();
    render();
  }

  function trimTransparent() {
    if (!hasImage()) {
      return;
    }
    const imageData = sourceCtx.getImageData(0, 0, state.width, state.height).data;
    let minX = state.width;
    let minY = state.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const alpha = imageData[(y * state.width + x) * 4 + 3];
        if (alpha > 8) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      setStatus("没有可见像素");
      return;
    }

    applyCrop({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    setStatus("已裁切到透明边缘");
  }

  function createOutputCanvas(rect, type = els.formatSelect.value) {
    const output = document.createElement("canvas");
    const sx = clamp(round(rect.x), 0, Math.max(0, state.width - 1));
    const sy = clamp(round(rect.y), 0, Math.max(0, state.height - 1));
    const sw = clamp(round(rect.w), 1, state.width - sx);
    const sh = clamp(round(rect.h), 1, state.height - sy);
    output.width = sw;
    output.height = sh;
    const outputCtx = output.getContext("2d");
    if (type === "image/jpeg") {
      outputCtx.fillStyle = "#ffffff";
      outputCtx.fillRect(0, 0, output.width, output.height);
    }
    outputCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
    return output;
  }

  function canvasToBlob(canvas, type = els.formatSelect.value, qualityValue = els.qualityRange.value) {
    const quality = Number(qualityValue) / 100;
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, type === "image/png" ? undefined : quality);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadCrop() {
    if (!hasImage()) {
      return;
    }
    const output = createOutputCanvas(state.crop);
    const blob = await canvasToBlob(output);
    if (!blob) {
      setStatus("导出失败");
      return;
    }
    downloadBlob(blob, `${state.fileName}-crop.${mimeExt[els.formatSelect.value] || "png"}`);
    setStatus(formatSize(blob.size));
  }

  async function downloadZip() {
    if (!hasImage()) {
      return;
    }

    let ZipConstructor;
    try {
      ZipConstructor = await ensureZipLibrary();
    } catch (error) {
      setStatus("ZIP 组件未载入");
      console.error(error);
      return;
    }

    const kept = state.slices.filter((slice) => !state.excludedSlices.has(slice.id));
    if (!kept.length) {
      setStatus("请至少保留一个切片");
      return;
    }

    els.downloadZipButton.disabled = true;
    setStatus("正在打包");
    try {
      const zip = new ZipConstructor();
      const type = els.sliceFormatSelect.value;
      const quality = els.sliceQualityMirror.value;
      const ext = mimeExt[type] || "jpg";
      for (let i = 0; i < kept.length; i += 1) {
        const slice = kept[i];
        const output = createOutputCanvas(slice, type);
        const blob = await canvasToBlob(output, type, quality);
        zip.file(`${slice.name.replace(/\s+/g, "_")}_${slice.w}x${slice.h}.${ext}`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      downloadBlob(zipBlob, `${state.fileName}-slices.zip`);
      setStatus(`ZIP ${formatSize(zipBlob.size)}`);
    } catch (error) {
      setStatus("ZIP 导出失败");
      console.error(error);
    } finally {
      els.downloadZipButton.disabled = false;
    }
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function updateDisabledState() {
    const disabled = !hasImage();
    if (state.controlsDisabled === disabled) {
      return;
    }
    state.controlsDisabled = disabled;
    [
      els.cropW,
      els.cropH,
      els.resetCropButton,
      els.trimTransparentButton,
      els.downloadCropButton,
      els.verticalGuides,
      els.verticalGuideAdd,
      els.horizontalGuides,
      els.horizontalGuideAdd,
      els.splitCols,
      els.splitRows,
      els.applySplitButton,
      els.addGuideButton,
      els.selectAllSlicesButton,
      els.invertSlicesButton,
      els.clearSlicesButton,
      els.formatSelect,
      els.qualityRange,
      els.sliceFormatSelect,
      els.sliceQualityMirror,
      els.downloadZipButton,
      els.clearImageButton,
    ].forEach((el) => {
      el.disabled = disabled;
    });
  }

  function handleKeyDown(event) {
    if (event.code !== "Space" || isEditableTarget(event.target)) {
      return;
    }
    if (!state.spacePressed) {
      state.spacePressed = true;
      const lastPoint = state.lastPointer ? imageToCanvas(state.lastPointer) : null;
      if (lastPoint) {
        updateStageCursor(lastPoint);
      }
    }
    event.preventDefault();
  }

  function handleKeyUp(event) {
    if (event.code !== "Space") {
      return;
    }
    state.spacePressed = false;
    if (!state.panDrag) {
      const lastPoint = state.lastPointer ? imageToCanvas(state.lastPointer) : null;
      if (lastPoint) {
        updateStageCursor(lastPoint);
      } else {
        els.stageCanvas.style.cursor = "";
      }
    }
  }

  function bindEvents() {
    bindNumberWheelControls();

    els.fileInput.addEventListener("change", (event) => loadFile(event.target.files[0]));
    els.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragover");
    });
    els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("dragover"));
    els.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragover");
      loadFile(event.dataTransfer.files[0]);
    });
    els.clearImageButton.addEventListener("click", clearImage);

    els.modeButtons.forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    [els.cropW, els.cropH].forEach((input) => {
      input.addEventListener("change", readCropInputs);
    });

    els.resetCropButton.addEventListener("click", () => {
      applyCrop({ x: 0, y: 0, w: state.width, h: state.height });
      setStatus("已重置裁切区域");
    });
    els.trimTransparentButton.addEventListener("click", trimTransparent);
    els.downloadCropButton.addEventListener("click", downloadCrop);
    els.applySplitButton.addEventListener("click", applyEqualSplit);
    els.addGuideButton.addEventListener("click", clearGuides);
    els.selectAllSlicesButton.addEventListener("click", () => setAllSlices(true));
    els.clearSlicesButton.addEventListener("click", () => setAllSlices(false));
    els.invertSlicesButton.addEventListener("click", invertSlices);
    els.downloadZipButton.addEventListener("click", downloadZip);
    els.qualityRange.addEventListener("input", () => {
      els.qualityValue.textContent = `${els.qualityRange.value}%`;
    });
    els.sliceQualityMirror.addEventListener("input", () => {
      els.sliceQualityValue.textContent = `${els.sliceQualityMirror.value}%`;
    });
    els.stageCanvas.addEventListener("pointerdown", startPointer);
    els.stageCanvas.addEventListener("pointermove", movePointer);
    els.stageCanvas.addEventListener("pointerup", endPointer);
    els.stageCanvas.addEventListener("pointercancel", endPointer);
    els.stageCanvas.addEventListener("wheel", wheelZoom, { passive: false });
    els.stageCanvas.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    });
    els.stageCanvas.addEventListener("contextmenu", (event) => {
      if (state.panDrag) {
        event.preventDefault();
      }
    });
    els.stageCanvas.addEventListener("pointerleave", () => {
      if (!state.drag) {
        hideMagnifier();
      }
    });

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", () => {
      state.spacePressed = false;
      state.panDrag = null;
      els.stageCanvas.style.cursor = "";
    });
    window.addEventListener("resize", resizeStage);
  }

  bindEvents();
  updateDisabledState();
  renderGuideList();
  renderSliceList();
  resizeStage();
}());
