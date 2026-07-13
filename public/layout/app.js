(() => {
  const canvas = document.getElementById("layoutCanvas");
  const ctx = canvas.getContext("2d");
  const wrap = document.getElementById("canvasWrap");
  const SNAP_THRESHOLD = 8;
  const TEXT_TOP_INSET_RATIO = 0.32;
  const HISTORY_DEBOUNCE_MS = 450;
  const FONT_STACKS = {
    "Source Han Sans SC": '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
    "Source Han Serif SC": '"Source Han Serif SC", "Noto Serif CJK SC", "SimSun", serif',
  };

  const els = {
    textLayer: document.getElementById("textLayer"),
    snapLayer: document.getElementById("snapLayer"),
    floatingToolbar: document.getElementById("floatingToolbar"),
    floatingColorInput: document.getElementById("floatingColorInput"),
    floatingFontSizeInput: document.getElementById("floatingFontSizeInput"),
    floatingLetterSpacingInput: document.getElementById("floatingLetterSpacingInput"),
    floatingLineHeightInput: document.getElementById("floatingLineHeightInput"),
    floatingBoldButton: document.getElementById("floatingBoldButton"),
    floatingItalicButton: document.getElementById("floatingItalicButton"),
    floatingCenterButton: document.getElementById("floatingCenterButton"),
    floatingDeleteButton: document.getElementById("floatingDeleteButton"),
    floatingAlignButtons: Array.from(document.querySelectorAll(".align-float-button")),
    canvasTextToolButton: document.getElementById("canvasTextToolButton"),
    canvasClearElementsButton: document.getElementById("canvasClearElementsButton"),
    emptyState: document.getElementById("emptyState"),
    stageFileInput: document.getElementById("stageFileInput"),
    backgroundFileInput: document.getElementById("backgroundFileInput"),
    backgroundActionButton: document.getElementById("backgroundActionButton"),
    backgroundActionText: document.getElementById("backgroundActionText"),
    clearBackgroundButton: document.getElementById("clearBackgroundButton"),
    canvasMeta: document.getElementById("canvasMeta"),
    canvasWidthInput: document.getElementById("canvasWidthInput"),
    canvasHeightInput: document.getElementById("canvasHeightInput"),
    backgroundColorInput: document.getElementById("backgroundColorInput"),
    backgroundOpacityRange: document.getElementById("backgroundOpacityRange"),
    backgroundOpacityValue: document.getElementById("backgroundOpacityValue"),
    backgroundFitSelect: document.getElementById("backgroundFitSelect"),
    textPropertyCard: document.getElementById("textPropertyCard"),
    textContentInput: document.getElementById("textContentInput"),
    fontSizeInput: document.getElementById("fontSizeInput"),
    letterSpacingInput: document.getElementById("letterSpacingInput"),
    lineHeightInput: document.getElementById("lineHeightInput"),
    fontFamilySelect: document.getElementById("fontFamilySelect"),
    textColorInput: document.getElementById("textColorInput"),
    boldButton: document.getElementById("boldButton"),
    italicButton: document.getElementById("italicButton"),
    textCenterButton: document.getElementById("textCenterButton"),
    alignButtons: Array.from(document.querySelectorAll(".align-button")),
    exportFormatSelect: document.getElementById("exportFormatSelect"),
    qualityRange: document.getElementById("qualityRange"),
    qualityValue: document.getElementById("qualityValue"),
    exportButton: document.getElementById("exportButton"),
  };

  const textWrapCache = new WeakMap();
  let historyTimer = 0;
  let toolbarStateRaf = 0;

  const state = {
    canvasWidth: 1080,
    canvasHeight: 1080,
    backgroundColor: "#ffffff",
    backgroundOpacity: 1,
    backgroundImage: null,
    backgroundFileName: "",
    backgroundFit: "cover",
    textItems: [],
    imageItems: [],
    selectedId: null,
    editingId: null,
    selectedType: "",
    scale: 1,
    baseScale: 1,
    viewZoom: 1,
    panX: 0,
    panY: 0,
    offsetX: 0,
    offsetY: 0,
    cssWidth: 0,
    cssHeight: 0,
    drag: null,
    viewDrag: null,
    spaceDown: false,
    clipboardItem: null,
    savedRange: null,
    history: [],
    historyIndex: -1,
    restoringHistory: false,
    raf: 0,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function loadImageFromSrc(src) {
    const image = new Image();
    image.onload = scheduleRender;
    image.src = src;
    return image;
  }

  function snapshotState() {
    return {
      canvasWidth: state.canvasWidth,
      canvasHeight: state.canvasHeight,
      backgroundColor: state.backgroundColor,
      backgroundOpacity: state.backgroundOpacity,
      backgroundFileName: state.backgroundFileName,
      backgroundFit: state.backgroundFit,
      backgroundSrc: state.backgroundImage?.src || "",
      textItems: structuredClone(state.textItems),
      imageItems: state.imageItems.map(({ image, ...item }) => structuredClone(item)),
      selectedId: state.selectedId,
      selectedType: state.selectedType,
    };
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot) return;
    state.restoringHistory = true;
    state.canvasWidth = snapshot.canvasWidth;
    state.canvasHeight = snapshot.canvasHeight;
    state.backgroundColor = snapshot.backgroundColor;
    state.backgroundOpacity = snapshot.backgroundOpacity;
    state.backgroundFileName = snapshot.backgroundFileName;
    state.backgroundFit = snapshot.backgroundFit;
    state.backgroundImage = snapshot.backgroundSrc ? loadImageFromSrc(snapshot.backgroundSrc) : null;
    state.textItems = structuredClone(snapshot.textItems || []);
    state.imageItems = (snapshot.imageItems || []).map((item) => ({
      ...structuredClone(item),
      image: item.src ? loadImageFromSrc(item.src) : null,
    }));
    state.selectedId = snapshot.selectedId;
    state.selectedType = snapshot.selectedType;
    state.editingId = null;
    state.savedRange = null;
    els.canvasWidthInput.value = state.canvasWidth;
    els.canvasHeightInput.value = state.canvasHeight;
    els.backgroundColorInput.value = state.backgroundColor;
    els.backgroundFitSelect.value = state.backgroundFit;
    els.backgroundOpacityRange.value = Math.round(state.backgroundOpacity * 100);
    syncTextPanel();
    updateCanvasSize();
    state.restoringHistory = false;
  }

  function commitHistory() {
    if (state.restoringHistory) return;
    if (historyTimer) {
      window.clearTimeout(historyTimer);
      historyTimer = 0;
    }
    const snapshot = snapshotState();
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    if (state.history.length > 80) state.history.shift();
    state.historyIndex = state.history.length - 1;
  }

  function scheduleHistoryCommit() {
    if (state.restoringHistory) return;
    if (historyTimer) window.clearTimeout(historyTimer);
    historyTimer = window.setTimeout(() => {
      historyTimer = 0;
      commitHistory();
    }, HISTORY_DEBOUNCE_MS);
  }

  function flushHistoryCommit() {
    if (!historyTimer) return;
    window.clearTimeout(historyTimer);
    historyTimer = 0;
    commitHistory();
  }

  function recordHistory(mode = "immediate") {
    if (mode === false) return;
    if (mode === "defer") scheduleHistoryCommit();
    else commitHistory();
  }

  function undo() {
    flushHistoryCommit();
    if (state.historyIndex <= 0) return;
    state.historyIndex -= 1;
    restoreSnapshot(state.history[state.historyIndex]);
  }

  function redo() {
    flushHistoryCommit();
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex += 1;
    restoreSnapshot(state.history[state.historyIndex]);
  }

  function selectedText() {
    return state.selectedType === "text" ? state.textItems.find((item) => item.id === state.selectedId) || null : null;
  }

  function selectedImage() {
    return state.selectedType === "image" ? state.imageItems.find((item) => item.id === state.selectedId) || null : null;
  }

  function selectedItem() {
    return selectedText() || selectedImage();
  }

  function selectedNode() {
    return state.selectedId ? els.textLayer.querySelector(`[data-id="${state.selectedId}"]`) : null;
  }

  function selectedContentNode() {
    return selectedNode()?.querySelector(".text-box-content") || null;
  }

  function fontStack(fontFamily) {
    return FONT_STACKS[fontFamily] || FONT_STACKS["Source Han Sans SC"];
  }

  function textTopInset(item) {
    return Math.max(2, item.fontSize * TEXT_TOP_INSET_RATIO);
  }

  function keepTextContentAtTop(content) {
    if (!content) return;
    if (content.scrollTop !== 0) content.scrollTop = 0;
    if (content.scrollLeft !== 0) content.scrollLeft = 0;
  }

  function hasRichInlineHtml(html) {
    return /<(span|font|b|strong|i|em|u|s)\b|style=/i.test(html || "");
  }

  function scheduleFloatingToolbarState() {
    if (toolbarStateRaf) return;
    toolbarStateRaf = requestAnimationFrame(() => {
      toolbarStateRaf = 0;
      updateFloatingToolbarState();
    });
  }

  function screenX(x) {
    return state.offsetX + x * state.scale;
  }

  function screenY(y) {
    return state.offsetY + y * state.scale;
  }

  function artPoint(point) {
    return {
      x: (point.x - state.offsetX) / state.scale,
      y: (point.y - state.offsetY) / state.scale,
    };
  }

  function itemType(id) {
    if (state.textItems.some((item) => item.id === id)) return "text";
    if (state.imageItems.some((item) => item.id === id)) return "image";
    return "";
  }

  function findItem(id) {
    return state.textItems.find((item) => item.id === id) || state.imageItems.find((item) => item.id === id) || null;
  }

  function scheduleRender() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      render();
    });
  }

  function updateCanvasOffsets() {
    const artWidth = Math.round(state.canvasWidth * state.scale);
    const artHeight = Math.round(state.canvasHeight * state.scale);
    state.offsetX = Math.round((state.cssWidth - artWidth) / 2 + state.panX);
    state.offsetY = Math.round((state.cssHeight - artHeight) / 2 + state.panY);
  }

  function hasStageContent() {
    return Boolean(state.backgroundImage || state.textItems.length || state.imageItems.length);
  }

  function resetEmptyViewport() {
    if (hasStageContent()) return false;
    const changed = state.viewZoom !== 1 || state.panX !== 0 || state.panY !== 0;
    state.viewZoom = 1;
    state.panX = 0;
    state.panY = 0;
    return changed;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function plainTextToHtml(value) {
    return escapeHtml(value || "").replaceAll("\n", "<br>");
  }

  function normalizeRichHtml(value) {
    const temp = document.createElement("div");
    temp.innerHTML = value || "";
    temp.querySelectorAll("font").forEach((font) => {
      const span = document.createElement("span");
      const mappedSize = {
        1: 10,
        2: 13,
        3: 16,
        4: 20,
        5: 26,
        6: 34,
        7: 44,
      }[font.getAttribute("size")];
      if (mappedSize) span.style.fontSize = `${mappedSize}px`;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
    return temp.innerHTML;
  }

  function htmlToPlainText(html) {
    const temp = document.createElement("div");
    temp.innerHTML = html || "";
    return temp.innerText.replace(/\n$/, "");
  }

  function updateCanvasSize() {
    const panelWidth = Math.max(320, wrap.clientWidth || 900);
    const viewportHeight = Math.max(320, wrap.clientHeight || 620);
    const maxArtWidth = Math.max(220, panelWidth - 2);
    const baseScale = Math.min(1, maxArtWidth / state.canvasWidth);
    const scale = baseScale * state.viewZoom;
    const cssWidth = Math.max(320, panelWidth);
    const cssHeight = viewportHeight;
    const ratio = window.devicePixelRatio || 1;

    state.baseScale = baseScale;
    state.scale = scale;
    state.cssWidth = cssWidth;
    state.cssHeight = cssHeight;
    updateCanvasOffsets();

    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = "100%";
    els.textLayer.style.height = `${cssHeight}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    scheduleRender();
  }

  function canvasPointer(event) {
    const rect = wrap.getBoundingClientRect();
    const source = event.touches?.[0] || event.changedTouches?.[0] || event;
    return {
      x: source.clientX - rect.left,
      y: source.clientY - rect.top,
    };
  }

  function setZoomAt(point, nextZoom) {
    const before = artPoint(point);
    state.viewZoom = clamp(nextZoom, 0.12, 8);
    state.scale = state.baseScale * state.viewZoom;
    const nextArtWidth = state.canvasWidth * state.scale;
    const nextArtHeight = state.canvasHeight * state.scale;
    state.panX = point.x - before.x * state.scale - (state.cssWidth - nextArtWidth) / 2;
    state.panY = point.y - before.y * state.scale - (state.cssHeight - nextArtHeight) / 2;
    updateCanvasOffsets();
    scheduleRender();
  }

  function startViewPan(event) {
    const point = canvasPointer(event);
    state.viewDrag = {
      startX: point.x,
      startY: point.y,
      panX: state.panX,
      panY: state.panY,
    };
    wrap.classList.add("is-panning");
    event.preventDefault();
  }

  function handleViewPanMove(event) {
    if (!state.viewDrag) return false;
    const point = canvasPointer(event);
    state.panX = state.viewDrag.panX + point.x - state.viewDrag.startX;
    state.panY = state.viewDrag.panY + point.y - state.viewDrag.startY;
    updateCanvasOffsets();
    scheduleRender();
    event.preventDefault();
    return true;
  }

  function stopViewPan() {
    if (!state.viewDrag) return;
    state.viewDrag = null;
    wrap.classList.remove("is-panning");
  }

  function drawBackground(targetCtx) {
    targetCtx.save();
    targetCtx.fillStyle = state.backgroundColor;
    targetCtx.fillRect(0, 0, state.canvasWidth, state.canvasHeight);

    if (state.backgroundImage) {
      const img = state.backgroundImage;
      if (!img.complete || !(img.naturalWidth || img.width)) {
        targetCtx.restore();
        return;
      }
      let dx = 0;
      let dy = 0;
      let dw = state.canvasWidth;
      let dh = state.canvasHeight;
      let sx = 0;
      let sy = 0;
      let sw = img.naturalWidth || img.width;
      let sh = img.naturalHeight || img.height;

      if (state.backgroundFit === "contain") {
        const scale = Math.min(state.canvasWidth / sw, state.canvasHeight / sh);
        dw = sw * scale;
        dh = sh * scale;
        dx = (state.canvasWidth - dw) / 2;
        dy = (state.canvasHeight - dh) / 2;
      } else if (state.backgroundFit === "cover") {
        const scale = Math.max(state.canvasWidth / sw, state.canvasHeight / sh);
        const cropW = state.canvasWidth / scale;
        const cropH = state.canvasHeight / scale;
        sx = (sw - cropW) / 2;
        sy = (sh - cropH) / 2;
        sw = cropW;
        sh = cropH;
      }

      targetCtx.save();
      targetCtx.globalAlpha = state.backgroundOpacity;
      targetCtx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      targetCtx.restore();
    }

    targetCtx.restore();
  }

  function renderCanvas() {
    ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);
    ctx.save();
    ctx.fillStyle = "#636363";
    ctx.fillRect(0, 0, state.cssWidth, state.cssHeight);
    ctx.translate(state.offsetX, state.offsetY);
    ctx.scale(state.scale, state.scale);
    drawBackground(ctx);
    for (const item of state.imageItems) drawImageForExport(ctx, item);
    for (const item of state.textItems) {
      if (item.id !== state.editingId) drawTextForExport(ctx, item);
    }
    ctx.restore();
  }

  function renderTextLayer() {
    const activeElement = document.activeElement;
    const activeId = activeElement?.closest?.(".text-box")?.dataset.id || "";

    for (const item of state.textItems) {
      let node = els.textLayer.querySelector(`[data-id="${item.id}"]`);
      if (!node) {
        node = createTextNode(item);
        els.textLayer.appendChild(node);
      }
      syncTextNode(node, item, activeId === item.id);
    }

    for (const item of state.imageItems) {
      let node = els.textLayer.querySelector(`[data-id="${item.id}"]`);
      if (!node) {
        node = createImageNode(item);
        els.textLayer.appendChild(node);
      }
      syncImageNode(node, item);
    }

    els.textLayer.querySelectorAll(".text-box").forEach((node) => {
      if (!state.textItems.some((item) => item.id === node.dataset.id)) node.remove();
    });
    els.textLayer.querySelectorAll(".image-item").forEach((node) => {
      if (!state.imageItems.some((item) => item.id === node.dataset.id)) node.remove();
    });
  }

  function render() {
    renderTextLayer();
    renderCanvas();
    syncMeta();
    updateFloatingToolbar();
  }

  function syncMeta() {
    const hasBackground = Boolean(state.backgroundImage);
    els.emptyState.classList.toggle("hidden", hasBackground || state.textItems.length > 0 || state.imageItems.length > 0);
    els.clearBackgroundButton.disabled = !hasBackground;
    els.backgroundActionText.textContent = hasBackground ? "替换背景图" : "上传背景图";
    els.backgroundOpacityRange.disabled = !hasBackground;
    els.backgroundOpacityValue.textContent = `${Math.round(state.backgroundOpacity * 100)}%`;
    els.canvasMeta.textContent = `${state.canvasWidth} × ${state.canvasHeight}`;
  }

  function createTextNode(item) {
    const node = document.createElement("div");
    node.className = "text-box";
    node.dataset.id = item.id;

    const content = document.createElement("div");
    content.className = "text-box-content";
    content.contentEditable = "false";
    content.spellcheck = false;
    content.innerHTML = item.html;
    node.appendChild(content);

    ["nw", "ne", "se", "sw"].forEach((handle) => {
      const grip = document.createElement("span");
      grip.className = "resize-handle";
      grip.dataset.handle = handle;
      node.appendChild(grip);
    });

    ["n", "e", "s", "w"].forEach((handle) => {
      const grip = document.createElement("span");
      grip.className = "edge-handle";
      grip.dataset.handle = handle;
      node.appendChild(grip);
    });

    node.addEventListener("pointerdown", (event) => handleTextPointerDown(event, item.id));
    node.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      enterEditMode(item.id);
    });
    content.addEventListener("input", () => {
      const current = state.textItems.find((entry) => entry.id === item.id);
      if (!current) return;
      keepTextContentAtTop(content);
      current.html = normalizeRichHtml(content.innerHTML);
      current.text = content.innerText;
      els.textContentInput.value = current.text;
      scheduleRender();
      scheduleHistoryCommit();
    });
    content.addEventListener("scroll", () => keepTextContentAtTop(content));
    content.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") || "";
      insertPlainText(text);
    });
    content.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitEditMode();
      }
    });
    content.addEventListener("mouseup", scheduleFloatingToolbarState);
    content.addEventListener("keyup", scheduleFloatingToolbarState);
    content.addEventListener("blur", () => saveCurrentSelectionRange());

    return node;
  }

  function insertPlainText(text) {
    const item = selectedText();
    const content = selectedContentNode();
    if (!item || !content) return;
    const selection = window.getSelection();
    const value = String(text || "");
    if (!selection || selection.rangeCount === 0 || !content.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      content.focus();
      placeCaretAtEnd(content);
    }
    document.execCommand("insertText", false, value);
    keepTextContentAtTop(content);
    item.html = normalizeRichHtml(content.innerHTML);
    item.text = content.innerText;
    els.textContentInput.value = item.text;
    scheduleRender();
    scheduleHistoryCommit();
  }

  function syncTextNode(node, item, keepContent) {
    const content = node.querySelector(".text-box-content");
    node.classList.toggle("is-selected", state.selectedId === item.id);
    node.classList.toggle("is-editing", state.editingId === item.id);
    node.style.left = `${screenX(item.x)}px`;
    node.style.top = `${screenY(item.y)}px`;
    node.style.width = `${item.w * state.scale}px`;
    node.style.height = `${item.h * state.scale}px`;
    node.style.fontFamily = fontStack(item.fontFamily);
    node.style.fontSize = `${item.fontSize * state.scale}px`;
    node.style.lineHeight = String(item.lineHeight);
    node.style.letterSpacing = `${(item.letterSpacing || 0) * state.scale}px`;
    node.style.color = item.color;
    node.style.fontWeight = item.bold ? "700" : "400";
    node.style.fontStyle = item.italic ? "italic" : "normal";
    node.style.textAlign = item.align;
    content.style.transform = "none";
    content.style.height = "100%";
    content.style.paddingTop = `${textTopInset(item) * state.scale}px`;
    content.style.textAlign = item.align;
    content.style.textAlignLast = item.align === "justify" ? "left" : "auto";
    content.style.visibility = state.editingId === item.id ? "visible" : "hidden";
    content.contentEditable = state.editingId === item.id ? "true" : "false";
    content.style.cursor = state.editingId === item.id ? "text" : "move";
    if (!keepContent && content.innerHTML !== item.html) content.innerHTML = item.html;
    keepTextContentAtTop(content);
  }

  function createImageNode(item) {
    const node = document.createElement("div");
    node.className = "image-item";
    node.dataset.id = item.id;

    const image = document.createElement("img");
    image.alt = item.name || "图片";
    image.src = item.src;
    node.appendChild(image);

    ["nw", "ne", "se", "sw"].forEach((handle) => {
      const grip = document.createElement("span");
      grip.className = "resize-handle";
      grip.dataset.handle = handle;
      node.appendChild(grip);
    });

    ["n", "e", "s", "w"].forEach((handle) => {
      const grip = document.createElement("span");
      grip.className = "edge-handle";
      grip.dataset.handle = handle;
      node.appendChild(grip);
    });

    node.addEventListener("pointerdown", (event) => handleItemPointerDown(event, item.id));
    return node;
  }

  function syncImageNode(node, item) {
    node.classList.toggle("is-selected", state.selectedId === item.id);
    node.style.left = `${screenX(item.x)}px`;
    node.style.top = `${screenY(item.y)}px`;
    node.style.width = `${item.w * state.scale}px`;
    node.style.height = `${item.h * state.scale}px`;
  }

  function updateFloatingToolbar() {
    const item = selectedText();
    const node = selectedNode();
    if (!item || !node) {
      els.floatingToolbar.classList.add("hidden");
      return;
    }

    const toolbarWidth = els.floatingToolbar.offsetWidth || 360;
    const toolbarHeight = els.floatingToolbar.offsetHeight || 42;
    const rawX = screenX(item.x + item.w / 2);
    const rawY = screenY(item.y) - 8;
    const x = clamp(rawX, toolbarWidth / 2 + 8, state.cssWidth - toolbarWidth / 2 - 8);
    const y = clamp(rawY, toolbarHeight + 8, state.cssHeight - 8);
    els.floatingToolbar.style.left = `${x}px`;
    els.floatingToolbar.style.top = `${y}px`;
    els.floatingToolbar.classList.remove("hidden");
    updateFloatingToolbarState();
  }

  function syncFloatingNumberWidth(input) {
    if (!input) return;
    const text = input.value || input.placeholder || "0";
    const width = clamp(text.length * 8 + 22, 42, 108);
    input.style.width = `${width}px`;
  }

  function syncFloatingNumberWidths() {
    [els.floatingFontSizeInput, els.floatingLetterSpacingInput, els.floatingLineHeightInput].forEach(syncFloatingNumberWidth);
  }

  function parseNumberInput(input, fallback = 0) {
    if (!input) return fallback;
    const text = String(input.value ?? "").trim();
    if (text === "" || text === "-" || text === "." || text === "-.") return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function normalizeNumberValue(value, min, max, fallback, decimals = 0) {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) ? parsed : fallback;
    const clamped = clamp(safeValue, min, max);
    if (decimals > 0) return clamped.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
    return String(Math.round(clamped));
  }

  function normalizeNumberInput(input, min, max, fallback, decimals = 0) {
    const normalized = normalizeNumberValue(input.value, min, max, fallback, decimals);
    input.value = normalized;
    if (input.classList.contains("float-size")) syncFloatingNumberWidth(input);
    return Number(normalized);
  }

  function setInputValueUnlessFocused(input, value) {
    if (!input || document.activeElement === input) return;
    input.value = value;
    if (input.classList.contains("float-size")) syncFloatingNumberWidth(input);
  }

  function updateFloatingToolbarState() {
    const item = selectedText();
    const hasSelection = state.editingId && hasTextSelectionInsideSelected();
    els.floatingBoldButton.classList.toggle("active", hasSelection ? document.queryCommandState("bold") : Boolean(item?.bold));
    els.floatingItalicButton.classList.toggle("active", hasSelection ? document.queryCommandState("italic") : Boolean(item?.italic));
    els.floatingColorInput.value = item?.color || "#0f172a";
    setInputValueUnlessFocused(els.floatingFontSizeInput, getSelectionFontSize() || item?.fontSize || 48);
    setInputValueUnlessFocused(els.floatingLetterSpacingInput, item?.letterSpacing || 0);
    setInputValueUnlessFocused(els.floatingLineHeightInput, item?.lineHeight || 1.25);
    syncFloatingNumberWidths();
    els.floatingAlignButtons.forEach((button) => button.classList.toggle("active", button.dataset.align === item?.align));
  }

  function syncTextPanel() {
    const item = selectedText();
    const disabled = !item;
    [
      els.textContentInput,
      els.fontSizeInput,
      els.letterSpacingInput,
      els.lineHeightInput,
      els.fontFamilySelect,
      els.textColorInput,
      els.boldButton,
      els.italicButton,
      els.textCenterButton,
      els.floatingColorInput,
      els.floatingFontSizeInput,
      els.floatingLetterSpacingInput,
      els.floatingLineHeightInput,
      els.floatingBoldButton,
      els.floatingItalicButton,
      els.floatingCenterButton,
      els.floatingDeleteButton,
      ...els.alignButtons,
      ...els.floatingAlignButtons,
    ].forEach((el) => {
      el.disabled = disabled;
    });
    els.textPropertyCard.classList.toggle("hidden", disabled);

    if (!item) {
      els.textContentInput.value = "";
      els.boldButton.classList.remove("active");
      els.italicButton.classList.remove("active");
      els.alignButtons.forEach((button) => button.classList.toggle("active", button.dataset.align === "left"));
      els.floatingAlignButtons.forEach((button) => button.classList.toggle("active", button.dataset.align === "left"));
      els.floatingToolbar.classList.add("hidden");
      return;
    }

    els.textContentInput.value = item.text;
    setInputValueUnlessFocused(els.fontSizeInput, item.fontSize);
    setInputValueUnlessFocused(els.letterSpacingInput, item.letterSpacing || 0);
    setInputValueUnlessFocused(els.lineHeightInput, item.lineHeight);
    els.fontFamilySelect.value = item.fontFamily;
    els.textColorInput.value = item.color;
    els.boldButton.classList.toggle("active", item.bold);
    els.italicButton.classList.toggle("active", item.italic);
    els.alignButtons.forEach((button) => button.classList.toggle("active", button.dataset.align === item.align));
    els.floatingAlignButtons.forEach((button) => button.classList.toggle("active", button.dataset.align === item.align));
    els.floatingColorInput.value = item.color;
    setInputValueUnlessFocused(els.floatingFontSizeInput, item.fontSize);
    setInputValueUnlessFocused(els.floatingLetterSpacingInput, item.letterSpacing || 0);
    setInputValueUnlessFocused(els.floatingLineHeightInput, item.lineHeight);
    syncFloatingNumberWidths();
  }

  function selectText(id) {
    if (id !== state.editingId) exitEditMode(false);
    state.selectedId = id;
    state.selectedType = id ? "text" : "";
    syncTextPanel();
    scheduleRender();
  }

  function selectItem(id) {
    if (!id) {
      exitEditMode(false);
      state.selectedId = null;
      state.selectedType = "";
      syncTextPanel();
      scheduleRender();
      return;
    }
    const type = itemType(id);
    if (type !== "text" || id !== state.editingId) exitEditMode(false);
    state.selectedId = id;
    state.selectedType = type;
    syncTextPanel();
    scheduleRender();
  }

  function enterEditMode(id) {
    state.selectedId = id;
    state.selectedType = "text";
    state.editingId = id;
    syncTextPanel();
    scheduleRender();
    requestAnimationFrame(() => {
      const content = selectedContentNode();
      if (!content) return;
      content.focus();
      placeCaretAtEnd(content);
      keepTextContentAtTop(content);
      requestAnimationFrame(() => keepTextContentAtTop(content));
    });
  }

  function exitEditMode(shouldRender = true) {
    if (!state.editingId) return;
    flushHistoryCommit();
    const editingId = state.editingId;
    const content = els.textLayer.querySelector(`[data-id="${editingId}"] .text-box-content`);
    const item = state.textItems.find((entry) => entry.id === editingId);
    if (content && item) {
      item.html = normalizeRichHtml(content.innerHTML);
      item.text = content.innerText;
    }
    state.editingId = null;
    state.savedRange = null;
    if (shouldRender) scheduleRender();
  }

  function placeCaretAtEnd(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function hasTextSelectionInsideSelected() {
    const content = selectedContentNode();
    const selection = window.getSelection();
    if (!content || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    return content.contains(range.commonAncestorContainer);
  }

  function saveCurrentSelectionRange() {
    const content = selectedContentNode();
    const selection = window.getSelection();
    if (!content || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (content.contains(range.commonAncestorContainer)) state.savedRange = range.cloneRange();
  }

  function restoreSavedSelectionRange() {
    const content = selectedContentNode();
    if (!content || !state.savedRange || !content.contains(state.savedRange.commonAncestorContainer)) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(state.savedRange);
    return true;
  }

  function getSelectionFontSize() {
    const content = selectedContentNode();
    const selection = window.getSelection();
    if (!content || !selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) return 0;
    const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const size = Number.parseFloat(window.getComputedStyle(node).fontSize);
    return Number.isFinite(size) ? Math.round(size / state.scale) : 0;
  }

  function execTextCommand(command) {
    const item = selectedText();
    if (!item) return;

    if (state.editingId && (hasTextSelectionInsideSelected() || restoreSavedSelectionRange())) {
      selectedContentNode()?.focus();
      document.execCommand(command, false, null);
      const content = selectedContentNode();
      if (content) {
        item.html = normalizeRichHtml(content.innerHTML);
        item.text = content.innerText;
      }
    } else {
      if (command === "bold") item.bold = !item.bold;
      if (command === "italic") item.italic = !item.italic;
      scheduleRender();
    }
    commitHistory();
    syncTextPanel();
    updateFloatingToolbarState();
  }

  function applyInlineStyleToSelection(styles) {
    const item = selectedText();
    const content = selectedContentNode();
    if (!item || !content) return false;
    if (!hasTextSelectionInsideSelected() && !restoreSavedSelectionRange()) return false;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) return false;

    const span = document.createElement("span");
    Object.assign(span.style, styles);
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    state.savedRange = nextRange.cloneRange();

    item.html = normalizeRichHtml(content.innerHTML);
    item.text = content.innerText;
    els.textContentInput.value = item.text;
    commitHistory();
    return true;
  }

  function applyFontSize(value, options = {}) {
    const rawValue = Number(value);
    if (!Number.isFinite(rawValue)) return false;
    const fontSize = clamp(Math.round(rawValue), 8, 800);
    const item = selectedText();
    const relativeSize = item ? `${fontSize / item.fontSize}em` : `${fontSize}px`;
    if (state.editingId && applyInlineStyleToSelection({ fontSize: relativeSize })) {
      if (options.syncInputs !== false) {
        els.fontSizeInput.value = fontSize;
        els.floatingFontSizeInput.value = fontSize;
        syncFloatingNumberWidth(els.floatingFontSizeInput);
      }
      updateFloatingToolbarState();
      return true;
    }
    updateSelectedText({ fontSize }, options.history ?? "immediate");
    if (options.syncInputs !== false) {
      els.fontSizeInput.value = fontSize;
      els.floatingFontSizeInput.value = fontSize;
      syncFloatingNumberWidth(els.floatingFontSizeInput);
    }
    return true;
  }

  function applyLetterSpacing(value, options = {}) {
    const rawValue = Number(value);
    if (!Number.isFinite(rawValue)) return false;
    const letterSpacing = clamp(Math.round(rawValue), -100, 500);
    updateSelectedText({ letterSpacing }, options.history ?? "immediate");
    if (options.syncInputs !== false) {
      els.letterSpacingInput.value = letterSpacing;
      els.floatingLetterSpacingInput.value = letterSpacing;
      syncFloatingNumberWidth(els.floatingLetterSpacingInput);
    }
    return true;
  }

  function applyLineHeight(value, options = {}) {
    const rawValue = Number(value);
    if (!Number.isFinite(rawValue)) return false;
    const lineHeight = clamp(rawValue, 0.8, 3);
    updateSelectedText({ lineHeight }, options.history ?? "immediate");
    if (options.syncInputs !== false) {
      const normalized = normalizeNumberValue(lineHeight, 0.8, 3, 1.25, 2);
      els.lineHeightInput.value = normalized;
      els.floatingLineHeightInput.value = normalized;
      syncFloatingNumberWidth(els.floatingLineHeightInput);
    }
    return true;
  }

  function applyTextColor(value) {
    if (!value) return;
    if (state.editingId && applyInlineStyleToSelection({ color: value })) {
      els.textColorInput.value = value;
      els.floatingColorInput.value = value;
      updateFloatingToolbarState();
      return;
    }
    updateSelectedText({ color: value }, "defer");
    els.textColorInput.value = value;
    els.floatingColorInput.value = value;
  }

  function centerSelectedText() {
    const item = selectedText();
    if (!item) return;
    const content = selectedContentNode();
    let textCenterX = item.x + item.w / 2;

    if (content) {
      const textRects = [];
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        if (!textNode.nodeValue?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        textRects.push(...Array.from(range.getClientRects()));
        range.detach();
      }
      if (textRects.length) {
        const wrapRect = wrap.getBoundingClientRect();
        const left = Math.min(...textRects.map((rect) => rect.left));
        const right = Math.max(...textRects.map((rect) => rect.right));
        textCenterX = ((left + right) / 2 - wrapRect.left - state.offsetX) / state.scale;
      }
    }

    const delta = state.canvasWidth / 2 - textCenterX;
    item.x = clamp(item.x + delta, 0, Math.max(0, state.canvasWidth - item.w));
    syncTextPanel();
    commitHistory();
    scheduleRender();
  }

  function updateSelectedText(patch, historyMode = "immediate") {
    const item = selectedText();
    if (!item) return;
    Object.assign(item, patch);
    recordHistory(historyMode);
    syncTextPanel();
    scheduleRender();
  }

  function moveSelectedItem(dx, dy) {
    const item = selectedItem();
    if (!item || state.editingId) return false;
    item.x = clamp(item.x + dx, 0, Math.max(0, state.canvasWidth - item.w));
    item.y = clamp(item.y + dy, 0, Math.max(0, state.canvasHeight - item.h));
    clearSnapLines();
    scheduleHistoryCommit();
    scheduleRender();
    return true;
  }

  function addTextItem() {
    const id = `text-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    const width = Math.min(520, state.canvasWidth * 0.62);
    const height = Math.min(180, state.canvasHeight * 0.22);
    const fontSize = Math.max(28, Math.round(state.canvasWidth / 24));
    const item = {
      id,
      type: "text",
      x: Math.max(0, (state.canvasWidth - width) / 2),
      y: Math.max(0, (state.canvasHeight - height) / 2),
      w: width,
      h: height,
      text: "输入文字",
      html: "输入文字",
      fontFamily: "Source Han Sans SC",
      fontSize,
      lineHeight: 1.25,
      letterSpacing: 0,
      color: "#0f172a",
      bold: false,
      italic: false,
      align: "left",
      opacity: 1,
    };
    state.textItems.push(item);
    selectText(id);
    commitHistory();
  }

  function deleteSelectedText() {
    if (!state.selectedId) return;
    state.textItems = state.textItems.filter((item) => item.id !== state.selectedId);
    state.imageItems = state.imageItems.filter((item) => item.id !== state.selectedId);
    state.selectedId = null;
    state.editingId = null;
    state.selectedType = "";
    syncTextPanel();
    commitHistory();
    if (resetEmptyViewport()) {
      updateCanvasSize();
      return;
    }
    scheduleRender();
  }

  function clearCanvasElements() {
    if (!state.textItems.length && !state.imageItems.length) return;
    state.textItems = [];
    state.imageItems = [];
    state.selectedId = null;
    state.editingId = null;
    state.selectedType = "";
    state.clipboardItem = null;
    state.savedRange = null;
    syncTextPanel();
    commitHistory();
    if (resetEmptyViewport()) {
      updateCanvasSize();
      return;
    }
    scheduleRender();
  }

  function cloneTextItem(item, offset = 24) {
    return {
      ...structuredClone({
        ...item,
        id: undefined,
      }),
      id: `text-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      x: clamp(item.x + offset, 0, Math.max(0, state.canvasWidth - item.w)),
      y: clamp(item.y + offset, 0, Math.max(0, state.canvasHeight - item.h)),
    };
  }

  function cloneImageItem(item, offset = 24) {
    return {
      id: `image-${Date.now()}-${Math.round(Math.random() * 1000)}`,
      type: "image",
      name: item.name,
      src: item.src,
      image: item.image,
      x: clamp(item.x + offset, 0, Math.max(0, state.canvasWidth - item.w)),
      y: clamp(item.y + offset, 0, Math.max(0, state.canvasHeight - item.h)),
      w: item.w,
      h: item.h,
      opacity: item.opacity ?? 1,
    };
  }

  function copySelectedText() {
    const item = selectedItem();
    if (!item || state.editingId) return false;
    state.clipboardItem = item.type === "image" ? cloneImageItem(item, 0) : structuredClone(item);
    return true;
  }

  function pasteTextItem() {
    if (!state.clipboardItem || state.editingId) return false;
    if (state.clipboardItem.type === "image") {
      const item = cloneImageItem(state.clipboardItem);
      state.imageItems.push(item);
      selectItem(item.id);
      commitHistory();
      return true;
    }
    const item = cloneTextItem(state.clipboardItem);
    state.textItems.push(item);
    selectText(item.id);
    commitHistory();
    return true;
  }

  function addImageObjectFromFile(file) {
    if (!file || !file.type?.startsWith("image/")) return false;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxW = state.canvasWidth * 0.72;
        const maxH = state.canvasHeight * 0.72;
        const scale = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
        const w = Math.max(20, Math.round(image.naturalWidth * scale));
        const h = Math.max(20, Math.round(image.naturalHeight * scale));
        const item = {
          id: `image-${Date.now()}-${Math.round(Math.random() * 1000)}`,
          type: "image",
          name: file.name || "粘贴图片",
          src: reader.result,
          image,
          x: Math.max(0, (state.canvasWidth - w) / 2),
          y: Math.max(0, (state.canvasHeight - h) / 2),
          w,
          h,
          opacity: 1,
        };
        state.imageItems.push(item);
        selectItem(item.id);
        commitHistory();
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
    return true;
  }

  function addImageObjectFromDataUrl(src, name = "图片") {
    const image = new Image();
    image.onload = () => {
      const maxW = state.canvasWidth * 0.72;
      const maxH = state.canvasHeight * 0.72;
      const scale = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
      const w = Math.max(20, Math.round(image.naturalWidth * scale));
      const h = Math.max(20, Math.round(image.naturalHeight * scale));
      const item = {
        id: `image-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        type: "image",
        name,
        src,
        image,
        x: Math.max(0, (state.canvasWidth - w) / 2),
        y: Math.max(0, (state.canvasHeight - h) / 2),
        w,
        h,
        opacity: 1,
      };
      state.imageItems.push(item);
      selectItem(item.id);
      commitHistory();
    };
    image.src = src;
  }

  function handleClipboardPaste(event) {
    if (state.editingId) return;
    const files = Array.from(event.clipboardData?.files || []);
    const imageFile = files.find((file) => file.type.startsWith("image/"));
    if (imageFile && addImageObjectFromFile(imageFile)) {
      event.preventDefault();
      return;
    }
    const html = event.clipboardData?.getData("text/html") || "";
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match?.[1]) {
      event.preventDefault();
      addImageObjectFromDataUrl(match[1], "粘贴图片");
    }
  }

  function handleTextPointerDown(event, id) {
    handleItemPointerDown(event, id);
  }

  function handleItemPointerDown(event, id) {
    if (event.button === 1 || (state.spaceDown && event.button === 0)) {
      startViewPan(event);
      return;
    }
    const node = event.currentTarget;
    const handle = event.target.closest(".resize-handle, .edge-handle")?.dataset.handle || "";
    const item = findItem(id);
    if (!item) return;

    selectItem(id);

    if (state.selectedType === "text" && state.editingId === id && !handle) return;

    const point = canvasPointer(event);
    state.drag = {
      type: handle ? "resize" : "move",
      resizeChangesFont: state.selectedType === "text" && Boolean(event.target.closest(".resize-handle")),
      id,
      handle,
      startX: point.x,
      startY: point.y,
      startRect: { x: item.x, y: item.y, w: item.w, h: item.h, fontSize: item.fontSize },
    };
    node.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (handleViewPanMove(event)) return;
    if (!state.drag) return;
    const item = findItem(state.drag.id);
    if (!item) return;

    const point = canvasPointer(event);
    const dx = (point.x - state.drag.startX) / state.scale;
    const dy = (point.y - state.drag.startY) / state.scale;

    if (state.drag.type === "move") {
      const next = applySmartSnap(item, state.drag.startRect.x + dx, state.drag.startRect.y + dy);
      item.x = next.x;
      item.y = next.y;
    } else {
      resizeItem(item, dx, dy);
    }

    scheduleRender();
    event.preventDefault();
  }

  function resizeItem(item, dx, dy) {
    const minW = 34;
    const minH = 28;
    const start = state.drag.startRect;
    let { x, y, w, h } = start;
    const handle = state.drag.handle;

    if (handle.includes("e")) w += dx;
    if (handle.includes("s")) h += dy;
    if (handle.includes("w")) {
      x += dx;
      w -= dx;
    }
    if (handle.includes("n")) {
      y += dy;
      h -= dy;
    }

    if (w < minW) {
      if (handle.includes("w")) x -= minW - w;
      w = minW;
    }
    if (h < minH) {
      if (handle.includes("n")) y -= minH - h;
      h = minH;
    }

    x = clamp(x, 0, Math.max(0, state.canvasWidth - minW));
    y = clamp(y, 0, Math.max(0, state.canvasHeight - minH));
    w = clamp(w, minW, state.canvasWidth - x);
    h = clamp(h, minH, state.canvasHeight - y);

    if (state.drag.resizeChangesFont) {
      const scaleX = w / start.w;
      const scaleY = h / start.h;
      const fontScale = Math.max(0.2, Math.max(scaleX, scaleY));
      item.fontSize = clamp(Math.round(start.fontSize * fontScale), 8, 800);
      els.fontSizeInput.value = item.fontSize;
      els.floatingFontSizeInput.value = item.fontSize;
    }
    item.x = x;
    item.y = y;
    item.w = w;
    item.h = h;
  }

  function applySmartSnap(item, rawX, rawY) {
    let x = clamp(rawX, 0, Math.max(0, state.canvasWidth - item.w));
    let y = clamp(rawY, 0, Math.max(0, state.canvasHeight - item.h));
    const threshold = SNAP_THRESHOLD / state.scale;
    const lines = [];
    const moving = {
      left: x,
      centerX: x + item.w / 2,
      right: x + item.w,
      top: y,
      centerY: y + item.h / 2,
      bottom: y + item.h,
    };
    const xTargets = [
      { value: 0, kind: "left" },
      { value: state.canvasWidth / 2, kind: "centerX" },
      { value: state.canvasWidth, kind: "right" },
    ];
    const yTargets = [
      { value: 0, kind: "top" },
      { value: state.canvasHeight / 2, kind: "centerY" },
      { value: state.canvasHeight, kind: "bottom" },
    ];

    for (const other of [...state.textItems, ...state.imageItems]) {
      if (other.id === item.id) continue;
      xTargets.push(
        { value: other.x, kind: "left" },
        { value: other.x + other.w / 2, kind: "centerX" },
        { value: other.x + other.w, kind: "right" },
      );
      yTargets.push(
        { value: other.y, kind: "top" },
        { value: other.y + other.h / 2, kind: "centerY" },
        { value: other.y + other.h, kind: "bottom" },
      );
    }

    const snapX = findBestSnap(moving, xTargets, ["left", "centerX", "right"], threshold);
    const snapY = findBestSnap(moving, yTargets, ["top", "centerY", "bottom"], threshold);

    if (snapX) {
      x += snapX.delta;
      lines.push({ axis: "x", value: snapX.value });
    }
    if (snapY) {
      y += snapY.delta;
      lines.push({ axis: "y", value: snapY.value });
    }

    x = clamp(x, 0, Math.max(0, state.canvasWidth - item.w));
    y = clamp(y, 0, Math.max(0, state.canvasHeight - item.h));
    drawSnapLines(lines);
    return { x, y };
  }

  function findBestSnap(edges, targets, keys, threshold) {
    let best = null;
    for (const key of keys) {
      for (const target of targets) {
        const delta = target.value - edges[key];
        const distance = Math.abs(delta);
        if (distance <= threshold && (!best || distance < best.distance)) {
          best = { delta, distance, value: target.value };
        }
      }
    }
    return best;
  }

  function drawSnapLines(lines) {
    if (!els.snapLayer) return;
    els.snapLayer.innerHTML = "";
    for (const line of lines) {
      const node = document.createElement("span");
      if (line.axis === "x") {
        node.className = "snap-line vertical";
        node.style.left = `${screenX(line.value)}px`;
        node.style.top = `${state.offsetY}px`;
        node.style.height = `${state.canvasHeight * state.scale}px`;
      } else {
        node.className = "snap-line horizontal";
        node.style.left = `${state.offsetX}px`;
        node.style.top = `${screenY(line.value)}px`;
        node.style.width = `${state.canvasWidth * state.scale}px`;
      }
      els.snapLayer.appendChild(node);
    }
  }

  function clearSnapLines() {
    if (els.snapLayer) els.snapLayer.innerHTML = "";
  }

  function handlePointerUp(event) {
    stopViewPan();
    if (!state.drag) return;
    const node = els.textLayer.querySelector(`[data-id="${state.drag.id}"]`);
    node?.releasePointerCapture?.(event.pointerId);
    state.drag = null;
    clearSnapLines();
    commitHistory();
    scheduleRender();
  }

  function setBackgroundImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        state.backgroundImage = image;
        state.backgroundFileName = file.name;
        if (!state.textItems.length && !state.imageItems.length) {
          state.canvasWidth = image.naturalWidth || image.width;
          state.canvasHeight = image.naturalHeight || image.height;
          els.canvasWidthInput.value = state.canvasWidth;
          els.canvasHeightInput.value = state.canvasHeight;
        }
        updateCanvasSize();
        commitHistory();
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function clearBackground() {
    state.backgroundImage = null;
    state.backgroundFileName = "";
    state.clipboardItem = null;
    state.savedRange = null;
    els.stageFileInput.value = "";
    els.backgroundFileInput.value = "";
    commitHistory();
    if (resetEmptyViewport()) {
      updateCanvasSize();
      return;
    }
    scheduleRender();
  }

  function applyCanvasDimensions() {
    const width = clamp(Math.round(Number(els.canvasWidthInput.value) || 1080), 64, 12000);
    const height = clamp(Math.round(Number(els.canvasHeightInput.value) || 1080), 64, 12000);
    state.canvasWidth = width;
    state.canvasHeight = height;
    els.canvasWidthInput.value = width;
    els.canvasHeightInput.value = height;
    for (const item of [...state.textItems, ...state.imageItems]) {
      item.x = clamp(item.x, 0, Math.max(0, width - item.w));
      item.y = clamp(item.y, 0, Math.max(0, height - item.h));
      item.w = Math.min(item.w, width);
      item.h = Math.min(item.h, height);
    }
    updateCanvasSize();
    commitHistory();
  }

  function resetCanvas() {
    state.canvasWidth = 1080;
    state.canvasHeight = 1080;
    state.backgroundColor = "#ffffff";
    state.backgroundFit = "cover";
    state.backgroundOpacity = 1;
    state.backgroundImage = null;
    state.backgroundFileName = "";
    state.textItems = [];
    state.imageItems = [];
    state.selectedId = null;
    state.editingId = null;
    state.selectedType = "";
    state.viewZoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.clipboardItem = null;
    state.savedRange = null;
    els.canvasWidthInput.value = 1080;
    els.canvasHeightInput.value = 1080;
    els.backgroundColorInput.value = "#ffffff";
    els.backgroundFitSelect.value = "cover";
    els.backgroundOpacityRange.value = 100;
    els.backgroundOpacityValue.textContent = "100%";
    syncTextPanel();
    updateCanvasSize();
  }

  function drawTextForExport(targetCtx, item) {
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.rect(item.x, item.y, item.w, item.h);
    targetCtx.clip();

    const content = hasRichInlineHtml(item.html) ? els.textLayer.querySelector(`[data-id="${item.id}"] .text-box-content`) : null;
    if (content?.textContent.trim()) {
      const drawn = drawRichTextDomForExport(targetCtx, item, content);
      if (drawn) {
        targetCtx.restore();
        return;
      }
    }

    targetCtx.globalAlpha = item.opacity;
    targetCtx.font = `${item.italic ? "italic" : "normal"} ${item.bold ? "700" : "400"} ${item.fontSize}px ${fontStack(item.fontFamily)}`;
    if ("letterSpacing" in targetCtx) targetCtx.letterSpacing = `${item.letterSpacing || 0}px`;
    targetCtx.fillStyle = item.color;
    targetCtx.textBaseline = "top";
    targetCtx.textAlign = item.align === "justify" ? "left" : item.align;

    const maxWidth = Math.max(8, item.w);
    const lineHeight = item.fontSize * item.lineHeight;
    const lines = getWrappedTextLines(targetCtx, item, maxWidth);
    const x = item.align === "center" ? item.x + item.w / 2 : item.align === "right" ? item.x + item.w : item.x;
    let y = item.y + textTopInset(item);

    for (const line of lines) {
      if (y > item.y + item.h) break;
      targetCtx.fillText(line, x, y);
      y += lineHeight;
    }
    if ("letterSpacing" in targetCtx) targetCtx.letterSpacing = "0px";
    targetCtx.restore();
  }

  function drawImageForExport(targetCtx, item) {
    const image = item.image || new Image();
    if (!item.image && item.src) image.src = item.src;
    if (!image.complete) return;
    targetCtx.save();
    targetCtx.globalAlpha = item.opacity ?? 1;
    targetCtx.drawImage(image, item.x, item.y, item.w, item.h);
    targetCtx.restore();
  }

  function drawRichTextDomForExport(targetCtx, item, content) {
    const wrapRect = wrap.getBoundingClientRect();
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let drewAny = false;

    targetCtx.save();
    targetCtx.globalAlpha = item.opacity;
    targetCtx.textBaseline = "top";
    targetCtx.textAlign = "left";

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const sourceText = textNode.nodeValue || "";
      if (!sourceText) continue;

      const range = document.createRange();
      range.selectNodeContents(textNode);
      const rects = Array.from(range.getClientRects());
      range.detach();
      if (!rects.length) continue;

      const parent = textNode.parentElement || content;
      const style = window.getComputedStyle(parent);
      const fontStyle = style.fontStyle || (item.italic ? "italic" : "normal");
      const fontWeight = style.fontWeight || (item.bold ? "700" : "400");
      const color = style.color || item.color;
      targetCtx.fillStyle = color;
      const cssFontSize = Number.parseFloat(style.fontSize);
      const exportFontSize = Number.isFinite(cssFontSize) ? cssFontSize / state.scale : item.fontSize;
      targetCtx.font = `${fontStyle} ${fontWeight} ${exportFontSize}px ${fontStack(item.fontFamily)}`;
      const cssLetterSpacing = Number.parseFloat(style.letterSpacing);
      const exportLetterSpacing = Number.isFinite(cssLetterSpacing) ? cssLetterSpacing / state.scale : item.letterSpacing || 0;
      if ("letterSpacing" in targetCtx) targetCtx.letterSpacing = `${exportLetterSpacing}px`;

      const lineSegments = splitTextNodeByClientLines(textNode, sourceText);
      for (const { text, rect } of lineSegments) {
        if (!text || !rect) continue;
        const x = (rect.left - wrapRect.left - state.offsetX) / state.scale;
        const y = (rect.top - wrapRect.top - state.offsetY) / state.scale;
        targetCtx.fillText(text, x, y);
        drewAny = true;
      }
    }

    targetCtx.restore();
    if ("letterSpacing" in targetCtx) targetCtx.letterSpacing = "0px";
    return drewAny;
  }

  function splitTextNodeByClientLines(textNode, text) {
    const segments = [];
    let start = 0;

    while (start < text.length) {
      const firstRange = document.createRange();
      firstRange.setStart(textNode, start);
      firstRange.setEnd(textNode, start + 1);
      const firstRect = firstRange.getBoundingClientRect();
      firstRange.detach();

      let end = start + 1;
      while (end < text.length) {
        const range = document.createRange();
        range.setStart(textNode, end);
        range.setEnd(textNode, end + 1);
        const rect = range.getBoundingClientRect();
        range.detach();
        if (Math.abs(rect.top - firstRect.top) > 1) break;
        end += 1;
      }

      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      const rects = Array.from(range.getClientRects());
      range.detach();
      segments.push({
        text: text.slice(start, end),
        rect: rects[0] || firstRect,
      });
      start = end;
    }

    return segments;
  }

  function wrapTextLines(targetCtx, text, maxWidth) {
    const lines = [];
    const paragraphs = String(text || "").split("\n");
    for (const paragraph of paragraphs) {
      if (!paragraph) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const char of paragraph) {
        const testLine = line + char;
        if (targetCtx.measureText(testLine).width > maxWidth && line) {
          lines.push(line);
          line = char;
        } else {
          line = testLine;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  function getWrappedTextLines(targetCtx, item, maxWidth) {
    const cacheKey = [
      item.text,
      maxWidth,
      item.fontSize,
      item.fontFamily,
      item.bold ? 1 : 0,
      item.italic ? 1 : 0,
      item.letterSpacing || 0,
    ].join("|");
    const cached = textWrapCache.get(item);
    if (cached?.key === cacheKey) return cached.lines;
    const lines = wrapTextLines(targetCtx, item.text, maxWidth);
    textWrapCache.set(item, { key: cacheKey, lines });
    return lines;
  }

  function exportImage() {
    flushHistoryCommit();
    exitEditMode(false);
    const output = document.createElement("canvas");
    output.width = state.canvasWidth;
    output.height = state.canvasHeight;
    const outputCtx = output.getContext("2d");
    drawBackground(outputCtx);
    for (const item of state.imageItems) drawImageForExport(outputCtx, item);
    for (const item of state.textItems) drawTextForExport(outputCtx, item);

    const type = els.exportFormatSelect.value;
    const quality = Number(els.qualityRange.value) / 100;
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const filename = `layout-${state.canvasWidth}x${state.canvasHeight}.${ext}`;
    let settled = false;

    const fallbackDownload = () => {
      if (settled) return;
      settled = true;
      try {
        const url = output.toDataURL(type, type === "image/png" ? undefined : quality);
        downloadDataUrl(url, filename);
      } catch (error) {
        console.error("导出图片失败", error);
      }
    };

    try {
      output.toBlob(
        (blob) => {
          if (settled) return;
          if (!blob) {
            fallbackDownload();
            return;
          }
          settled = true;
          downloadBlob(blob, filename);
        },
        type,
        type === "image/png" ? undefined : quality,
      );
      window.setTimeout(fallbackDownload, 1200);
    } catch (error) {
      fallbackDownload();
    }
  }

  function downloadDataUrl(url, filename) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function handleDocumentKeydown(event) {
    const key = event.key.toLowerCase();
    const isFormField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    const isModifierCopy = event.ctrlKey || event.metaKey;

    if (isModifierCopy && !isFormField && !state.editingId && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }

    if (isModifierCopy && !isFormField && !state.editingId && key === "y") {
      event.preventDefault();
      redo();
      return;
    }

    if (event.code === "Space" && !isFormField && !state.editingId) {
      state.spaceDown = true;
      event.preventDefault();
      return;
    }

    if (isFormField) return;

    const arrowMoves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (arrowMoves[event.key] && state.selectedId && !state.editingId) {
      const multiplier = event.shiftKey ? 10 : 1;
      const [dx, dy] = arrowMoves[event.key];
      if (moveSelectedItem(dx * multiplier, dy * multiplier)) event.preventDefault();
      return;
    }

    if (isModifierCopy && key === "c") {
      if (copySelectedText()) event.preventDefault();
      return;
    }

    if (isModifierCopy && key === "v") {
      if (pasteTextItem()) event.preventDefault();
      return;
    }

    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (state.editingId) return;
    if (!state.selectedId) return;
    event.preventDefault();
    deleteSelectedText();
  }

  function spinNumberInput(input, direction) {
    const step = Number(input.step) || 1;
    const min = input.min === "" ? -Infinity : Number(input.min);
    const max = input.max === "" ? Infinity : Number(input.max);
    const current = Number(input.value || input.placeholder || 0);
    const decimals = String(input.step || "").includes(".") ? String(input.step).split(".")[1].length : 0;
    const next = clamp((Number.isFinite(current) ? current : 0) + direction * step, min, max);
    input.value = decimals ? next.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "") : String(Math.round(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindDeferredNumberInput(input, { min, max, fallback, decimals = 0, onInput }) {
    const applyCurrentValue = () => {
      const value = parseNumberInput(input, fallback);
      if (value === null) return false;
      onInput(clamp(value, min, max));
      return true;
    };

    input.addEventListener("input", () => {
      if (input.classList.contains("float-size")) syncFloatingNumberWidth(input);
      applyCurrentValue();
    });

    input.addEventListener("change", () => {
      const value = normalizeNumberInput(input, min, max, fallback, decimals);
      onInput(value);
      flushHistoryCommit();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
    });
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

  function bindEvents() {
    els.stageFileInput.addEventListener("change", (event) => setBackgroundImage(event.target.files?.[0]));
    els.backgroundFileInput.addEventListener("change", (event) => setBackgroundImage(event.target.files?.[0]));
    els.backgroundActionButton.addEventListener("click", () => els.backgroundFileInput.click());
    els.clearBackgroundButton.addEventListener("click", clearBackground);

    wrap.addEventListener("dragover", (event) => {
      event.preventDefault();
      wrap.classList.add("dragover");
    });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("dragover"));
    wrap.addEventListener("drop", (event) => {
      event.preventDefault();
      wrap.classList.remove("dragover");
      const file = event.dataTransfer?.files?.[0];
      if (file && state.backgroundImage) addImageObjectFromFile(file);
      else setBackgroundImage(file);
    });
    wrap.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (!hasStageContent()) {
          if (resetEmptyViewport()) updateCanvasSize();
          return;
        }
        const point = canvasPointer(event);
        const factor = event.deltaY < 0 ? 1.08 : 0.925;
        setZoomAt(point, state.viewZoom * factor);
      },
      { passive: false },
    );
    wrap.addEventListener("pointerdown", (event) => {
      if (event.button === 1 || (state.spaceDown && event.button === 0)) {
        startViewPan(event);
        return;
      }
      if (event.target === wrap || event.target === canvas || event.target === els.textLayer) {
        exitEditMode();
        selectItem(null);
      }
    });

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("keydown", handleDocumentKeydown);
    document.addEventListener("keyup", (event) => {
      if (event.code === "Space") state.spaceDown = false;
    });
    document.addEventListener("paste", handleClipboardPaste);
    document.addEventListener("selectionchange", () => {
      if (state.editingId) scheduleFloatingToolbarState();
    });

    els.canvasWidthInput.addEventListener("change", applyCanvasDimensions);
    els.canvasHeightInput.addEventListener("change", applyCanvasDimensions);
    els.backgroundColorInput.addEventListener("input", () => {
      state.backgroundColor = els.backgroundColorInput.value;
      scheduleRender();
      scheduleHistoryCommit();
    });
    els.backgroundColorInput.addEventListener("change", flushHistoryCommit);
    els.backgroundFitSelect.addEventListener("change", () => {
      state.backgroundFit = els.backgroundFitSelect.value;
      commitHistory();
      scheduleRender();
    });
    els.backgroundOpacityRange.addEventListener("input", () => {
      state.backgroundOpacity = clamp(Number(els.backgroundOpacityRange.value) || 0, 0, 100) / 100;
      els.backgroundOpacityValue.textContent = `${els.backgroundOpacityRange.value}%`;
      scheduleRender();
      scheduleHistoryCommit();
    });
    els.backgroundOpacityRange.addEventListener("change", flushHistoryCommit);

    els.canvasTextToolButton.addEventListener("click", addTextItem);
    els.canvasClearElementsButton.addEventListener("click", clearCanvasElements);
    els.textContentInput.addEventListener("input", () => {
      const html = plainTextToHtml(els.textContentInput.value);
      updateSelectedText({ text: els.textContentInput.value, html }, "defer");
    });
    bindDeferredNumberInput(els.fontSizeInput, {
      min: 8,
      max: 800,
      fallback: 48,
      onInput: (value) => applyFontSize(value, { syncInputs: false, history: "defer" }),
    });
    bindDeferredNumberInput(els.letterSpacingInput, {
      min: -100,
      max: 500,
      fallback: 0,
      onInput: (value) => applyLetterSpacing(value, { syncInputs: false, history: "defer" }),
    });
    bindDeferredNumberInput(els.lineHeightInput, {
      min: 0.8,
      max: 3,
      fallback: 1.25,
      decimals: 2,
      onInput: (value) => applyLineHeight(value, { syncInputs: false, history: "defer" }),
    });
    els.fontFamilySelect.addEventListener("change", () => updateSelectedText({ fontFamily: els.fontFamilySelect.value }));
    els.textColorInput.addEventListener("input", () => applyTextColor(els.textColorInput.value));
    els.boldButton.addEventListener("click", () => execTextCommand("bold"));
    els.italicButton.addEventListener("click", () => execTextCommand("italic"));
    els.floatingColorInput.addEventListener("input", () => applyTextColor(els.floatingColorInput.value));
    bindDeferredNumberInput(els.floatingFontSizeInput, {
      min: 8,
      max: 800,
      fallback: 48,
      onInput: (value) => applyFontSize(value, { syncInputs: false, history: "defer" }),
    });
    bindDeferredNumberInput(els.floatingLetterSpacingInput, {
      min: -100,
      max: 500,
      fallback: 0,
      onInput: (value) => applyLetterSpacing(value, { syncInputs: false, history: "defer" }),
    });
    bindDeferredNumberInput(els.floatingLineHeightInput, {
      min: 0.8,
      max: 3,
      fallback: 1.25,
      decimals: 2,
      onInput: (value) => applyLineHeight(value, { syncInputs: false, history: "defer" }),
    });
    els.floatingBoldButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      execTextCommand("bold");
    });
    els.floatingItalicButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      execTextCommand("italic");
    });
    els.floatingCenterButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      centerSelectedText();
    });
    els.textCenterButton.addEventListener("click", centerSelectedText);
    els.floatingDeleteButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      deleteSelectedText();
    });
    els.floatingAlignButtons.forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        updateSelectedText({ align: button.dataset.align });
        syncTextPanel();
      });
    });
    els.alignButtons.forEach((button) => {
      button.addEventListener("click", () => {
        updateSelectedText({ align: button.dataset.align });
        syncTextPanel();
      });
    });

    els.qualityRange.addEventListener("input", () => {
      els.qualityValue.textContent = `${els.qualityRange.value}%`;
    });
    els.exportButton.addEventListener("click", exportImage);

    window.addEventListener("resize", updateCanvasSize);
  }

  bindEvents();
  bindNumberWheelControls();
  syncTextPanel();
  updateCanvasSize();
  commitHistory();
})();
