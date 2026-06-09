const MIME_EXTENSION_MAP = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const SUPPORTED_EXPORT_TYPES = new Set(Object.keys(MIME_EXTENSION_MAP));
const FILE_READ_BATCH_SIZE = 4;
const SUPPORTS_OFFSCREEN_CANVAS = typeof OffscreenCanvas !== "undefined";
const GIF_DEFAULT_FRAME_DELAY = 100;
const GIF_MIN_FRAME_DELAY = 20;
const PRESET_STORAGE_KEY = "xuan-yuan-image-tool-user-presets-v1";
const RESIZE_MODE_MANUAL = "manual";
const RESIZE_MODE_TRIMMED_LONG_EDGE = "trimmed-long-edge";
const AUTO_LONG_EDGE_RESIZE_SIZE = 600;
const AUTO_LONG_EDGE_PRESET_NAMES = new Set([
  "800\u00d7800\u900f\u660e\u5e95png",
  "800\u00d7800\u767d\u5e95png",
  "800\u00d7800\u767d\u5e95jpg",
]);
const EMPTY_FILE_LIST_HTML = `
  <div class="empty-state">
    <strong>还没有图片</strong>
  </div>
`;
const EMPTY_RESULT_LIST_HTML = `
  <div class="empty-state">
    <strong>结果会显示在这里</strong>
  </div>
`;
const ANCHOR_MAP = {
  "top-left": [0, 0],
  "top-center": [0.5, 0],
  "top-right": [1, 0],
  "center-left": [0, 0.5],
  center: [0.5, 0.5],
  "center-right": [1, 0.5],
  "bottom-left": [0, 1],
  "bottom-center": [0.5, 1],
  "bottom-right": [1, 1],
};

const SYSTEM_PRESETS = [
  {
    id: "system-jpg-compress",
    name: "电商 JPG 压缩",
    source: "system",
    config: {
      trim: { enabled: false, alphaThreshold: 0 },
      resize: { enabled: false, width: "", height: "", lock: true },
      canvas: {
        enabled: false,
        width: "",
        height: "",
        anchor: "center",
        transparent: true,
        backgroundColor: "#ffffff",
      },
      output: {
        enabled: true,
        format: "image/jpeg",
        quality: 84,
        fillColor: "#ffffff",
      },
      overwrite: {
        enabled: false,
        overwriteExisting: true,
      },
    },
  },
  {
    id: "system-png-convert",
    name: "转 PNG格式",
    source: "system",
    config: {
      trim: { enabled: false, alphaThreshold: 0 },
      resize: { enabled: false, width: "", height: "", lock: true },
      canvas: {
        enabled: false,
        width: "",
        height: "",
        anchor: "center",
        transparent: true,
        backgroundColor: "#ffffff",
      },
      output: {
        enabled: true,
        format: "image/png",
        quality: 100,
        fillColor: "#ffffff",
      },
      overwrite: {
        enabled: false,
        overwriteExisting: true,
      },
    },
  },
  {
    id: "system-800-transparent-png",
    name: "800×800 透明底PNG",
    source: "system",
    config: {
      trim: { enabled: true, alphaThreshold: 0 },
      resize: {
        enabled: true,
        width: "",
        height: "",
        lock: true,
        mode: RESIZE_MODE_TRIMMED_LONG_EDGE,
        longEdge: AUTO_LONG_EDGE_RESIZE_SIZE,
      },
      canvas: {
        enabled: true,
        width: "800",
        height: "800",
        anchor: "center",
        transparent: true,
        backgroundColor: "#ffffff",
      },
      output: {
        enabled: true,
        format: "image/png",
        quality: 100,
        fillColor: "#ffffff",
      },
      overwrite: {
        enabled: false,
        overwriteExisting: true,
      },
    },
  },
  {
    id: "system-800-white-png",
    name: "800×800 白底PNG",
    source: "system",
    config: {
      trim: { enabled: true, alphaThreshold: 0 },
      resize: {
        enabled: true,
        width: "",
        height: "",
        lock: true,
        mode: RESIZE_MODE_TRIMMED_LONG_EDGE,
        longEdge: AUTO_LONG_EDGE_RESIZE_SIZE,
      },
      canvas: {
        enabled: true,
        width: "800",
        height: "800",
        anchor: "center",
        transparent: false,
        backgroundColor: "#ffffff",
      },
      output: {
        enabled: true,
        format: "image/png",
        quality: 100,
        fillColor: "#ffffff",
      },
      overwrite: {
        enabled: false,
        overwriteExisting: true,
      },
    },
  },
  {
    id: "system-800-white-jpg",
    name: "800×800 白底JPG",
    source: "system",
    config: {
      trim: { enabled: true, alphaThreshold: 0 },
      resize: {
        enabled: true,
        width: "",
        height: "",
        lock: true,
        mode: RESIZE_MODE_TRIMMED_LONG_EDGE,
        longEdge: AUTO_LONG_EDGE_RESIZE_SIZE,
      },
      canvas: {
        enabled: true,
        width: "800",
        height: "800",
        anchor: "center",
        transparent: false,
        backgroundColor: "#ffffff",
      },
      output: {
        enabled: true,
        format: "image/jpeg",
        quality: 92,
        fillColor: "#ffffff",
      },
      overwrite: {
        enabled: false,
        overwriteExisting: true,
      },
    },
  },
];

const state = {
  files: [],
  results: new Map(),
  activeId: null,
  resizeMode: RESIZE_MODE_MANUAL,
  resizeLongEdge: 0,
  resizeDriver: "width",
  processing: false,
  exporting: false,
  exportDirectoryHandle: null,
  exportDirectoryName: "",
  userPresets: [],
};

const elements = {};
const renderCache = {
  fileListHtml: "",
  resultListHtml: "",
  previewKey: "",
  summaryKey: "",
  statusText: "",
};
let gifWorkerBlobUrl = "";
const lazyScriptPromises = new Map();

function loadScriptOnce(src, globalName) {
  if (globalName && typeof window[globalName] !== "undefined") {
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
  if (typeof JSZip === "undefined") {
    throw new Error("ZIP 打包依赖加载失败。");
  }
}

async function ensureGifLibrary() {
  await loadScriptOnce("/batch/vendor/gif.js", "GIF");
  if (typeof GIF === "undefined") {
    throw new Error("GIF 导出依赖加载失败。");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  initializePresets();
  renderAll();
});

window.addEventListener("beforeunload", () => {
  if (gifWorkerBlobUrl) {
    URL.revokeObjectURL(gifWorkerBlobUrl);
  }
});

function cacheElements() {
  elements.fileInput = document.getElementById("fileInput");
  elements.dropzone = document.getElementById("dropzone");
  elements.clearFilesButton = document.getElementById("clearFilesButton");
  elements.fileList = document.getElementById("fileList");
  elements.fileCountPill = document.getElementById("fileCountPill");
  elements.referencePill = document.getElementById("referencePill");
  elements.presetCard = document.getElementById("presetCard");
  elements.enablePreset = document.getElementById("enablePreset");
  elements.presetSelect = document.getElementById("presetSelect");
  elements.presetNameInput = document.getElementById("presetNameInput");
  elements.savePresetButton = document.getElementById("savePresetButton");
  elements.deletePresetButton = document.getElementById("deletePresetButton");
  elements.trimCard = document.getElementById("trimCard");
  elements.enableTrim = document.getElementById("enableTrim");
  elements.trimAlphaThreshold = document.getElementById("trimAlphaThreshold");
  elements.resizeCard = document.getElementById("resizeCard");
  elements.enableResize = document.getElementById("enableResize");
  elements.resizeWidth = document.getElementById("resizeWidth");
  elements.resizeHeight = document.getElementById("resizeHeight");
  elements.lockRatio = document.getElementById("lockRatio");
  elements.resizeHint = document.getElementById("resizeHint");
  elements.canvasCard = document.getElementById("canvasCard");
  elements.enableCanvas = document.getElementById("enableCanvas");
  elements.canvasWidth = document.getElementById("canvasWidth");
  elements.canvasHeight = document.getElementById("canvasHeight");
  elements.anchorGrid = document.getElementById("anchorGrid");
  elements.transparentCanvas = document.getElementById("transparentCanvas");
  elements.canvasBgColor = document.getElementById("canvasBgColor");
  elements.outputCard = document.getElementById("outputCard");
  elements.enableOutput = document.getElementById("enableOutput");
  elements.outputFormat = document.getElementById("outputFormat");
  elements.outputFillColor = document.getElementById("outputFillColor");
  elements.qualityRange = document.getElementById("qualityRange");
  elements.qualityValue = document.getElementById("qualityValue");
  elements.overwriteCard = document.getElementById("overwriteCard");
  elements.enableOverwrite = document.getElementById("enableOverwrite");
  elements.overwriteExisting = document.getElementById("overwriteExisting");
  elements.pickExportFolderButton = document.getElementById("pickExportFolderButton");
  elements.exportFolderLabel = document.getElementById("exportFolderLabel");
  elements.overwriteHint = document.getElementById("overwriteHint");
  elements.processButton = document.getElementById("processButton");
  elements.downloadAllButton = document.getElementById("downloadAllButton");
  elements.overwriteExportButton = document.getElementById("overwriteExportButton");
  elements.statusPanel = document.getElementById("statusPanel");
  elements.previewTitle = document.getElementById("previewTitle");
  elements.previewMeta = document.getElementById("previewMeta");
  elements.originalPreview = document.getElementById("originalPreview");
  elements.processedPreview = document.getElementById("processedPreview");
  elements.originalPlaceholder = document.getElementById("originalPlaceholder");
  elements.processedPlaceholder = document.getElementById("processedPlaceholder");
  elements.originalMeta = document.getElementById("originalMeta");
  elements.processedMeta = document.getElementById("processedMeta");
  elements.resultSummary = document.getElementById("resultSummary");
  elements.totalOriginalSize = document.getElementById("totalOriginalSize");
  elements.totalOutputSize = document.getElementById("totalOutputSize");
  elements.totalDelta = document.getElementById("totalDelta");
  elements.resultList = document.getElementById("resultList");
}

function bindEvents() {
  elements.fileInput.addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);
    void handleSelectedFiles(files);
    event.target.value = "";
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("is-dragover");
    });
  });

  elements.dropzone.addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    void handleSelectedFiles(files);
  });

  elements.clearFilesButton.addEventListener("click", clearAllFiles);
  elements.presetSelect.addEventListener("change", handlePresetSelectionChange);
  elements.savePresetButton.addEventListener("click", saveCurrentPreset);
  elements.deletePresetButton.addEventListener("click", deleteSelectedPreset);
  elements.qualityRange.addEventListener("input", () => {
    elements.qualityValue.textContent = `${elements.qualityRange.value}%`;
  });

  elements.enablePreset.addEventListener("change", handleToolToggleChange);
  elements.enableTrim.addEventListener("change", handleToolToggleChange);
  elements.enableResize.addEventListener("change", handleToolToggleChange);
  elements.enableCanvas.addEventListener("change", handleToolToggleChange);
  elements.enableOutput.addEventListener("change", handleToolToggleChange);
  elements.enableOverwrite.addEventListener("change", handleToolToggleChange);
  elements.transparentCanvas.addEventListener("change", refreshCanvasColorState);

  elements.resizeWidth.addEventListener("input", () => {
    resetAutoResizeMode();
    syncResizeBy("width");
  });
  elements.resizeHeight.addEventListener("input", () => {
    resetAutoResizeMode();
    syncResizeBy("height");
  });
  elements.lockRatio.addEventListener("change", () => {
    resetAutoResizeMode();
    if (elements.lockRatio.checked) {
      syncResizeBy(state.resizeDriver);
    }
    updateResizeHint();
  });

  elements.anchorGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".anchor-button");
    if (!button) {
      return;
    }

    elements.anchorGrid.querySelectorAll(".anchor-button").forEach((node) => {
      node.classList.toggle("is-active", node === button);
    });
  });

  elements.processButton.addEventListener("click", () => void processAllImages());
  elements.downloadAllButton.addEventListener("click", () => void downloadAllResults());
  elements.pickExportFolderButton.addEventListener("click", () => void pickExportDirectory());
  elements.overwriteExisting.addEventListener("change", renderExportControls);
  elements.overwriteExportButton.addEventListener("click", () => void exportResultsToDirectory());
  elements.fileList.addEventListener("click", handleFileListClick);
  elements.fileList.addEventListener("keydown", handleFileListKeydown);
  elements.resultList.addEventListener("click", handleResultListClick);
  elements.resultList.addEventListener("keydown", handleResultListKeydown);
}

async function handleSelectedFiles(candidateFiles) {
  const validFiles = candidateFiles.filter((file) => file.type.startsWith("image/"));
  if (!validFiles.length) {
    setStatus("没有检测到可处理的图片文件。");
    return;
  }

  setStatus(`正在读取 ${validFiles.length} 张图片...`);

  const nextRecords = [];
  let failureCount = 0;

  for (let index = 0; index < validFiles.length; index += FILE_READ_BATCH_SIZE) {
    const batch = validFiles.slice(index, index + FILE_READ_BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map((file) => createFileRecord(file)));

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        nextRecords.push(result.value);
      } else {
        failureCount += 1;
        console.error(result.reason);
      }
    }

    setStatus(`正在读取 ${Math.min(index + FILE_READ_BATCH_SIZE, validFiles.length)} / ${validFiles.length} 张图片...`);
    await yieldToBrowser();
  }

  if (nextRecords.length) {
    state.files.push(...nextRecords);
    if (!state.activeId) {
      state.activeId = nextRecords[0].id;
    }
  }

  updateResizeHint();
  refreshCanvasColorState();
  renderAll();

  if (!nextRecords.length) {
    setStatus("图片读取失败，请检查文件是否损坏后重试。");
    return;
  }

  if (failureCount > 0) {
    setStatus(`已加入 ${nextRecords.length} 张图片，另有 ${failureCount} 张读取失败。`);
    return;
  }

  setStatus(`已加入 ${nextRecords.length} 张图片，准备处理。`);
}

function clearAllFiles() {
  for (const file of state.files) {
    URL.revokeObjectURL(file.sourceUrl);
  }

  revokeResultUrls();
  state.files = [];
  state.results.clear();
  state.activeId = null;
  state.processing = false;
  state.exporting = false;
  renderAll();
  setStatus("已清空图片列表。");
}

function revokeResultUrls() {
  for (const result of state.results.values()) {
    URL.revokeObjectURL(result.outputUrl);
  }
}

function initializePresets() {
  state.userPresets = loadUserPresets();
  renderPresetOptions();
  updatePresetActionsState();
}

function loadUserPresets() {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((preset) => preset && typeof preset.id === "string" && typeof preset.name === "string" && preset.config);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function persistUserPresets() {
  window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.userPresets));
}

function getAllPresets() {
  return [
    ...SYSTEM_PRESETS,
    ...state.userPresets.map((preset) => ({ ...preset, source: "user" })),
  ];
}

function renderPresetOptions(selectedValue = "") {
  const presets = getAllPresets();
  const optionsHtml = [
    `<option value="">选择预设</option>`,
    ...presets.map((preset) => `<option value="${preset.source}:${preset.id}">${escapeHtml(preset.name)}</option>`),
  ].join("");

  elements.presetSelect.innerHTML = optionsHtml;
  elements.presetSelect.value = selectedValue && presets.some((preset) => `${preset.source}:${preset.id}` === selectedValue)
    ? selectedValue
    : "";

  updatePresetActionsState();
}

function getSelectedPreset() {
  const selectedValue = elements.presetSelect.value;
  if (!selectedValue) {
    return null;
  }

  const [source, id] = selectedValue.split(":");
  return getAllPresets().find((preset) => preset.source === source && preset.id === id) || null;
}

function handlePresetSelectionChange() {
  const preset = getSelectedPreset();
  elements.presetNameInput.value = preset ? preset.name : "";
  if (preset) {
    applyPreset(preset);
  } else {
    resetCombinationActions();
    renderAll();
    setStatus("未选择预设，组合动作已关闭。");
  }
  updatePresetActionsState();
}

function updatePresetActionsState() {
  const preset = getSelectedPreset();
  elements.deletePresetButton.disabled = !preset || preset.source !== "user";
}

function applyPreset(preset) {
  applyPresetConfig(createConfigForPreset(preset));
  elements.presetNameInput.value = preset.name;
  renderAll();
  setStatus(`已应用预设：${preset.name}`);
}

function saveCurrentPreset() {
  const name = elements.presetNameInput.value.trim();
  if (!name) {
    setStatus("请输入预设名称。");
    return;
  }

  if (SYSTEM_PRESETS.some((preset) => preset.name === name)) {
    setStatus("内置预设名称不可覆盖。");
    return;
  }

  const existingIndex = state.userPresets.findIndex((preset) => preset.name === name);
  const nextPreset = {
    id: existingIndex >= 0 ? state.userPresets[existingIndex].id : createId(),
    name,
    config: readPresetSnapshot(),
  };

  if (existingIndex >= 0) {
    state.userPresets.splice(existingIndex, 1, nextPreset);
  } else {
    state.userPresets.push(nextPreset);
  }

  persistUserPresets();
  renderPresetOptions(`user:${nextPreset.id}`);
  elements.presetNameInput.value = nextPreset.name;
  setStatus(existingIndex >= 0 ? `已更新预设：${name}` : `已创建预设：${name}`);
}

function deleteSelectedPreset() {
  const preset = getSelectedPreset();
  if (!preset || preset.source !== "user") {
    setStatus("当前预设不可删除。");
    return;
  }

  state.userPresets = state.userPresets.filter((item) => item.id !== preset.id);
  persistUserPresets();
  renderPresetOptions();
  elements.presetNameInput.value = "";
  setStatus(`已删除预设：${preset.name}`);
}

function readPresetSnapshot() {
  return {
    trim: {
      enabled: elements.enableTrim.checked,
      alphaThreshold: elements.trimAlphaThreshold.value || "0",
    },
    resize: {
      enabled: elements.enableResize.checked,
      width: elements.resizeWidth.value,
      height: elements.resizeHeight.value,
      lock: elements.lockRatio.checked,
      mode: state.resizeMode,
      longEdge: state.resizeLongEdge || "",
      driver: state.resizeDriver,
    },
    canvas: {
      enabled: elements.enableCanvas.checked,
      width: elements.canvasWidth.value,
      height: elements.canvasHeight.value,
      anchor: getSelectedAnchor(),
      transparent: elements.transparentCanvas.checked,
      backgroundColor: elements.canvasBgColor.value,
    },
    output: {
      enabled: elements.enableOutput.checked,
      format: elements.outputFormat.value,
      quality: elements.qualityRange.value,
      fillColor: elements.outputFillColor.value,
    },
    overwrite: {
      enabled: elements.enableOverwrite.checked,
      overwriteExisting: elements.overwriteExisting.checked,
    },
  };
}

function createConfigForPreset(preset) {
  const config = { ...(preset?.config || {}) };
  if (!shouldUseAutoLongEdgePreset(preset?.name)) {
    return config;
  }

  return {
    ...config,
    trim: {
      ...(config.trim || {}),
      enabled: true,
    },
    resize: {
      ...(config.resize || {}),
      enabled: true,
      width: "",
      height: "",
      lock: true,
      mode: RESIZE_MODE_TRIMMED_LONG_EDGE,
      longEdge: AUTO_LONG_EDGE_RESIZE_SIZE,
    },
  };
}

function resetCombinationActions() {
  resetAutoResizeMode();
  elements.enableTrim.checked = false;
  elements.trimAlphaThreshold.value = "0";

  elements.enableResize.checked = false;
  elements.resizeWidth.value = "";
  elements.resizeHeight.value = "";
  elements.lockRatio.checked = true;
  state.resizeDriver = "width";

  elements.enableCanvas.checked = false;
  elements.canvasWidth.value = "";
  elements.canvasHeight.value = "";
  setSelectedAnchor("center");
  elements.transparentCanvas.checked = true;
  elements.canvasBgColor.value = "#ffffff";

  elements.enableOutput.checked = false;
  elements.outputFormat.value = "original";
  elements.qualityRange.value = "86";
  elements.qualityValue.textContent = `${elements.qualityRange.value}%`;
  elements.outputFillColor.value = "#ffffff";

  elements.enableOverwrite.checked = false;
  elements.overwriteExisting.checked = true;
}

function applyPresetConfig(config) {
  const nextConfig = mergePresetConfig(config);

  elements.enableTrim.checked = nextConfig.trim.enabled;
  elements.trimAlphaThreshold.value = nextConfig.trim.alphaThreshold;

  elements.enableResize.checked = nextConfig.resize.enabled;
  elements.resizeWidth.value = nextConfig.resize.width;
  elements.resizeHeight.value = nextConfig.resize.height;
  elements.lockRatio.checked = nextConfig.resize.lock;
  state.resizeMode = nextConfig.resize.mode;
  state.resizeLongEdge = nextConfig.resize.longEdge;
  state.resizeDriver = nextConfig.resize.driver;

  elements.enableCanvas.checked = nextConfig.canvas.enabled;
  elements.canvasWidth.value = nextConfig.canvas.width;
  elements.canvasHeight.value = nextConfig.canvas.height;
  setSelectedAnchor(nextConfig.canvas.anchor);
  elements.transparentCanvas.checked = nextConfig.canvas.transparent;
  elements.canvasBgColor.value = nextConfig.canvas.backgroundColor;

  elements.enableOutput.checked = nextConfig.output.enabled;
  elements.outputFormat.value = nextConfig.output.format;
  elements.qualityRange.value = nextConfig.output.quality;
  elements.qualityValue.textContent = `${elements.qualityRange.value}%`;
  elements.outputFillColor.value = nextConfig.output.fillColor;

  elements.enableOverwrite.checked = nextConfig.overwrite.enabled;
  elements.overwriteExisting.checked = nextConfig.overwrite.overwriteExisting;
}

function mergePresetConfig(config) {
  return {
    trim: {
      enabled: Boolean(config?.trim?.enabled),
      alphaThreshold: `${clampAlphaThreshold(config?.trim?.alphaThreshold)}`,
    },
    resize: {
      enabled: Boolean(config?.resize?.enabled),
      width: `${config?.resize?.width ?? ""}`,
      height: `${config?.resize?.height ?? ""}`,
      lock: config?.resize?.lock !== false,
      mode: config?.resize?.mode === RESIZE_MODE_TRIMMED_LONG_EDGE ? RESIZE_MODE_TRIMMED_LONG_EDGE : RESIZE_MODE_MANUAL,
      longEdge: toPositiveInt(config?.resize?.longEdge),
      driver: config?.resize?.driver === "height" ? "height" : "width",
    },
    canvas: {
      enabled: Boolean(config?.canvas?.enabled),
      width: `${config?.canvas?.width ?? ""}`,
      height: `${config?.canvas?.height ?? ""}`,
      anchor: ANCHOR_MAP[config?.canvas?.anchor] ? config.canvas.anchor : "center",
      transparent: config?.canvas?.transparent !== false,
      backgroundColor: normalizeColorValue(config?.canvas?.backgroundColor, "#ffffff"),
    },
    output: {
      enabled: Boolean(config?.output?.enabled),
      format: SUPPORTED_EXPORT_TYPES.has(config?.output?.format) || config?.output?.format === "original"
        ? config.output.format
        : "original",
      quality: `${clampPercent(config?.output?.quality, 100)}`,
      fillColor: normalizeColorValue(config?.output?.fillColor, "#ffffff"),
    },
    overwrite: {
      enabled: Boolean(config?.overwrite?.enabled),
      overwriteExisting: config?.overwrite?.overwriteExisting !== false,
    },
  };
}

async function createFileRecord(file) {
  const sourceUrl = URL.createObjectURL(file);

  try {
    const { width, height } = await getImageDimensions(file, sourceUrl);
    return {
      id: createId(),
      file,
      name: file.name,
      type: normalizeMimeType(file.type),
      size: file.size,
      width,
      height,
      sourceUrl,
      status: "ready",
      error: "",
    };
  } catch (error) {
    URL.revokeObjectURL(sourceUrl);
    const nextError = new Error(`读取图片失败：${file.name}`);
    nextError.cause = error;
    throw nextError;
  }
}

function renderAll() {
  if (!state.activeId && state.files.length > 0) {
    state.activeId = state.files[0].id;
  }

  renderToolCards();
  renderFileList();
  renderResults();
  renderPreview();
  renderSummary();
  renderExportControls();
  updateResizeHint();
  refreshCanvasColorState();
  updateControlsState();
}

function renderToolCards() {
  syncToolCard(elements.presetCard, elements.enablePreset.checked);
  syncToolCard(elements.trimCard, elements.enableTrim.checked);
  syncToolCard(elements.resizeCard, elements.enableResize.checked);
  syncToolCard(elements.canvasCard, elements.enableCanvas.checked);
  syncToolCard(elements.outputCard, elements.enableOutput.checked);
  syncToolCard(elements.overwriteCard, elements.enableOverwrite.checked);
}

function handleToolToggleChange() {
  if (!elements.enableResize.checked) {
    resetAutoResizeMode();
  }
  renderToolCards();
  renderExportControls();
  updateControlsState();
}

function syncToolCard(card, expanded) {
  if (!card) {
    return;
  }

  card.classList.toggle("is-collapsed", !expanded);
}

function renderFileList() {
  elements.fileCountPill.textContent = `${state.files.length} 张`;

  const nextHtml = !state.files.length
    ? EMPTY_FILE_LIST_HTML
    : state.files.map((file) => `
      <article class="file-item${file.id === state.activeId ? " is-active" : ""}" tabindex="0" role="button" data-file-id="${file.id}">
        <button
          class="file-remove-button"
          type="button"
          data-remove-id="${file.id}"
          aria-label="删除 ${escapeHtml(file.name)}"
          ${state.processing || state.exporting ? "disabled" : ""}
        >
          ×
        </button>
        <div class="thumb">
          <img src="${file.sourceUrl}" alt="${escapeHtml(file.name)}" loading="lazy" decoding="async">
        </div>
        <div class="item-meta">
          <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
          <span>${file.width} × ${file.height} · ${formatBytes(file.size)}</span>
          <small>${describeMime(file.type)}</small>
        </div>
        <span class="status-dot status-${file.status}">${getStatusLabel(file.status)}</span>
      </article>
    `).join("");

  if (renderCache.fileListHtml === nextHtml) {
    return;
  }

  renderCache.fileListHtml = nextHtml;
  elements.fileList.innerHTML = nextHtml;
}

function renderResults() {
  const orderedResults = state.files
    .map((file) => state.results.get(file.id))
    .filter(Boolean);

  const nextHtml = !orderedResults.length
    ? EMPTY_RESULT_LIST_HTML
    : orderedResults.map((result) => {
      const deltaText = formatDelta(result.outputSize, result.originalSize);
      return `
        <article class="result-item${result.id === state.activeId ? " is-active" : ""}" tabindex="0" role="button" data-result-id="${result.id}">
          <div class="thumb">
            <img src="${result.outputUrl}" alt="${escapeHtml(result.outputName)}" loading="lazy" decoding="async">
          </div>
          <div class="item-meta">
            <strong title="${escapeHtml(result.outputName)}">${escapeHtml(result.outputName)}</strong>
            <span>${result.width} × ${result.height} · ${formatBytes(result.outputSize)} (${deltaText})</span>
            <small>${describeMime(result.outputType)} · 原始 ${formatBytes(result.originalSize)}</small>
            ${result.note ? `<small>${escapeHtml(result.note)}</small>` : ""}
            ${result.savedAs ? `<small class="result-note">已写回 ${escapeHtml(result.savedAs)}</small>` : ""}
          </div>
          <div class="result-actions">
            <button class="download-button" type="button" data-download-id="${result.id}">下载</button>
            <small>${result.outputExt.toUpperCase()}</small>
          </div>
        </article>
      `;
    }).join("");

  if (renderCache.resultListHtml === nextHtml) {
    return;
  }

  renderCache.resultListHtml = nextHtml;
  elements.resultList.innerHTML = nextHtml;
}

function handleFileListClick(event) {
  const removeButton = event.target.closest("[data-remove-id]");
  if (removeButton) {
    removeFileById(removeButton.dataset.removeId);
    return;
  }

  const button = event.target.closest(".file-item[data-file-id]");
  if (!button) {
    return;
  }

  setActiveSelection(button.dataset.fileId);
}

function handleFileListKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  if (event.target.closest("[data-remove-id]")) {
    return;
  }

  const button = event.target.closest(".file-item[data-file-id]");
  if (!button) {
    return;
  }

  event.preventDefault();
  setActiveSelection(button.dataset.fileId);
}

function handleResultListClick(event) {
  const downloadButton = event.target.closest("[data-download-id]");
  if (downloadButton) {
    const result = state.results.get(downloadButton.dataset.downloadId);
    if (result) {
      downloadBlob(result.outputUrl, result.outputName);
    }
    return;
  }

  const item = event.target.closest(".result-item[data-result-id]");
  if (!item) {
    return;
  }

  setActiveSelection(item.dataset.resultId);
}

function handleResultListKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  if (event.target.closest("[data-download-id]")) {
    return;
  }

  const item = event.target.closest(".result-item[data-result-id]");
  if (!item) {
    return;
  }

  event.preventDefault();
  setActiveSelection(item.dataset.resultId);
}

function setActiveSelection(id) {
  if (!id || state.activeId === id) {
    return;
  }

  state.activeId = id;
  updateResizeHint();
  renderPreview();
  renderFileList();
  renderResults();
}

function removeFileById(id) {
  if (!id || state.processing || state.exporting) {
    return;
  }

  const index = state.files.findIndex((file) => file.id === id);
  if (index === -1) {
    return;
  }

  const [removedFile] = state.files.splice(index, 1);
  URL.revokeObjectURL(removedFile.sourceUrl);

  const removedResult = state.results.get(id);
  if (removedResult) {
    URL.revokeObjectURL(removedResult.outputUrl);
    state.results.delete(id);
  }

  if (state.activeId === id) {
    const nextActive = state.files[index] || state.files[index - 1] || null;
    state.activeId = nextActive ? nextActive.id : null;
  }

  renderAll();
  setStatus(`已移除 ${removedFile.name}`);
}

function renderPreview() {
  const activeFile = getActiveFile();
  const result = activeFile ? state.results.get(activeFile.id) : null;
  const nextPreviewKey = activeFile
    ? `${activeFile.id}|${activeFile.sourceUrl}|${result?.outputUrl || ""}|${result?.outputSize || 0}`
    : "empty";

  if (renderCache.previewKey === nextPreviewKey) {
    return;
  }

  renderCache.previewKey = nextPreviewKey;

  if (!activeFile) {
    showImage(elements.originalPreview, elements.originalPlaceholder, "", true);
    showImage(elements.processedPreview, elements.processedPlaceholder, "", true);
    elements.previewTitle.textContent = "未选择图片";
    elements.previewMeta.textContent = "-";
    elements.originalMeta.textContent = "-";
    elements.processedMeta.textContent = "-";
    return;
  }

  elements.previewTitle.textContent = activeFile.name;
  elements.previewMeta.textContent = `${activeFile.width} × ${activeFile.height}`;
  elements.originalMeta.textContent = `${describeMime(activeFile.type)} · ${formatBytes(activeFile.size)}`;
  showImage(elements.originalPreview, elements.originalPlaceholder, activeFile.sourceUrl, false);

  if (result) {
    elements.processedMeta.textContent = `${describeMime(result.outputType)} · ${result.width} × ${result.height} · ${formatBytes(result.outputSize)}`;
    showImage(elements.processedPreview, elements.processedPlaceholder, result.outputUrl, false);
  } else {
    elements.processedMeta.textContent = "未处理";
    showImage(elements.processedPreview, elements.processedPlaceholder, "", true);
  }
}

function renderSummary() {
  const totalCount = state.files.length;
  const doneCount = state.files.filter((file) => file.status === "done").length;
  const totalOriginal = state.files.reduce((sum, file) => sum + file.size, 0);
  const totalOutput = Array.from(state.results.values()).reduce((sum, result) => sum + result.outputSize, 0);
  const delta = totalOriginal > 0 && totalOutput > 0
    ? `${((totalOutput - totalOriginal) / totalOriginal * 100).toFixed(1)}%`
    : "0%";

  const nextSummaryKey = `${doneCount}|${totalCount}|${totalOriginal}|${totalOutput}|${delta}`;
  if (renderCache.summaryKey === nextSummaryKey) {
    return;
  }

  renderCache.summaryKey = nextSummaryKey;
  elements.resultSummary.textContent = `${doneCount} / ${totalCount} 完成`;

  elements.totalOriginalSize.textContent = formatBytes(totalOriginal);
  elements.totalOutputSize.textContent = formatBytes(totalOutput);
  elements.totalDelta.textContent = delta;
}

function updateControlsState() {
  const hasFiles = state.files.length > 0;
  const busy = state.processing || state.exporting;
  const supportsWriteBack = supportsDirectoryExport();
  const overwriteEnabled = elements.enableOverwrite.checked;
  const selectedPreset = getSelectedPreset();

  elements.presetSelect.disabled = busy;
  elements.presetNameInput.disabled = busy;
  elements.savePresetButton.disabled = busy;
  elements.deletePresetButton.disabled = busy || !selectedPreset || selectedPreset.source !== "user";
  elements.clearFilesButton.disabled = busy || !hasFiles;
  elements.processButton.disabled = busy || !hasFiles;
  elements.downloadAllButton.disabled = busy || state.results.size === 0;
  elements.pickExportFolderButton.disabled = busy || !overwriteEnabled || !supportsWriteBack;
  elements.overwriteExisting.disabled = busy || !overwriteEnabled || !supportsWriteBack;
  elements.overwriteExportButton.disabled = busy || !overwriteEnabled || state.results.size === 0 || !supportsWriteBack || !state.exportDirectoryHandle;
}

function refreshCanvasColorState() {
  const disabled = elements.transparentCanvas.checked;
  elements.canvasBgColor.disabled = disabled;
  elements.canvasBgColor.style.opacity = disabled ? "0.45" : "1";
}

function renderExportControls() {
  const supportsWriteBack = supportsDirectoryExport();
  const overwriteEnabled = elements.enableOverwrite.checked;

  elements.exportFolderLabel.textContent = state.exportDirectoryName || "未选择";
  elements.exportFolderLabel.classList.toggle("is-empty", !state.exportDirectoryName);

  if (!overwriteEnabled) {
    elements.overwriteHint.textContent = "";
    return;
  }

  if (!supportsWriteBack) {
    elements.overwriteHint.textContent = "当前浏览器不支持覆盖写回，请使用最新版 Chrome / Edge，并在本地或 HTTPS 环境打开。";
    return;
  }

  if (!state.exportDirectoryHandle) {
    elements.overwriteHint.textContent = "";
    return;
  }

  if (elements.overwriteExisting.checked) {
    elements.overwriteHint.textContent = `写入 ${state.exportDirectoryName}，同名覆盖`;
    return;
  }

  elements.overwriteHint.textContent = `写入 ${state.exportDirectoryName}，同名避让`;
}

function updateResizeHint() {
  const activeFile = getActiveFile();
  if (!activeFile) {
    elements.referencePill.textContent = "未选参考图";
    elements.resizeHint.textContent = state.resizeMode === RESIZE_MODE_TRIMMED_LONG_EDGE
      ? `裁切后长边 ${state.resizeLongEdge || AUTO_LONG_EDGE_RESIZE_SIZE}`
      : "";
    return;
  }

  elements.referencePill.textContent = `参考 ${activeFile.width} × ${activeFile.height}`;
  elements.resizeHint.textContent = state.resizeMode === RESIZE_MODE_TRIMMED_LONG_EDGE
    ? `裁切后长边 ${state.resizeLongEdge || AUTO_LONG_EDGE_RESIZE_SIZE}`
    : `比例 ${formatRatio(activeFile.width, activeFile.height)}`;

  if (elements.lockRatio.checked && state.resizeMode !== RESIZE_MODE_TRIMMED_LONG_EDGE) {
    if (state.resizeDriver === "width" && toPositiveInt(elements.resizeWidth.value)) {
      syncResizeBy("width", false);
    }
    if (state.resizeDriver === "height" && toPositiveInt(elements.resizeHeight.value)) {
      syncResizeBy("height", false);
    }
  }
}

function syncResizeBy(driver, updateDriver = true) {
  if (!elements.lockRatio.checked) {
    if (updateDriver) {
      state.resizeDriver = driver;
    }
    return;
  }

  const activeFile = getActiveFile();
  if (!activeFile) {
    return;
  }

  const aspect = activeFile.width / activeFile.height;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return;
  }

  if (updateDriver) {
    state.resizeDriver = driver;
  }

  if (driver === "width") {
    const widthValue = toPositiveInt(elements.resizeWidth.value);
    if (!widthValue) {
      elements.resizeHeight.value = "";
      return;
    }

    elements.resizeHeight.value = `${Math.max(1, Math.round(widthValue / aspect))}`;
    return;
  }

  const heightValue = toPositiveInt(elements.resizeHeight.value);
  if (!heightValue) {
    elements.resizeWidth.value = "";
    return;
  }

  elements.resizeWidth.value = `${Math.max(1, Math.round(heightValue * aspect))}`;
}

async function processAllImages() {
  if (!state.files.length || state.processing) {
    return;
  }

  const settings = readSettings();
  const hasOutputAction = settings.output.enabled && (
    settings.output.format !== "original" ||
    settings.output.quality < 1
  );

  if (!settings.trim.enabled && !settings.resize.enabled && !settings.canvas.enabled && !hasOutputAction) {
    setStatus("当前没有启用任何处理动作，请至少开启一个功能或调整输出格式/压缩质量。");
    flashMissingActionAreas(settings, hasOutputAction);
    return;
  }

  revokeResultUrls();
  state.results.clear();
  state.processing = true;
  state.files.forEach((file) => {
    file.status = "ready";
    file.error = "";
  });
  renderAll();

  const total = state.files.length;
  let completed = 0;

  for (const file of state.files) {
    try {
      file.status = "processing";
      renderFileList();
      updateControlsState();
      if (file.id === state.activeId) {
        renderPreview();
      }
      setStatus(`正在处理 ${completed + 1} / ${total}：${file.name}`);
      await yieldToBrowser();

      const result = await processSingleFile(file, settings);
      state.results.set(file.id, result);
      file.status = "done";
      completed += 1;

      if (!state.activeId) {
        state.activeId = file.id;
      }
    } catch (error) {
      file.status = "error";
      file.error = error instanceof Error ? error.message : "处理失败";
      console.error(error);
    }

    renderFileList();
    renderResults();
    renderSummary();
    updateControlsState();
    if (file.id === state.activeId) {
      renderPreview();
    }
    await yieldToBrowser();
  }

  state.processing = false;
  renderAll();

  const errorCount = state.files.filter((file) => file.status === "error").length;
  if (errorCount > 0) {
    setStatus(`处理完成，其中 ${errorCount} 张图片失败，请检查浏览器控制台或重新尝试。`);
  } else {
    setStatus(`全部处理完成，共输出 ${state.results.size} 张图片。`);
  }
}

function flashMissingActionAreas(settings, hasOutputAction) {
  const invalidEnabledTargets = [];

  if (elements.enableTrim.checked && settings.trim.alphaThreshold < 0) {
    invalidEnabledTargets.push(elements.trimAlphaThreshold);
  }

  if (elements.enableResize.checked && !settings.resize.enabled && state.resizeMode !== RESIZE_MODE_TRIMMED_LONG_EDGE) {
    invalidEnabledTargets.push(elements.resizeWidth, elements.resizeHeight);
  }

  if (elements.enableCanvas.checked && !settings.canvas.enabled) {
    invalidEnabledTargets.push(elements.canvasWidth, elements.canvasHeight);
  }

  if (elements.enableOutput.checked && !hasOutputAction) {
    invalidEnabledTargets.push(elements.outputFormat, elements.qualityRange);
  }

  if (invalidEnabledTargets.length > 0) {
    applyAttentionFlash(invalidEnabledTargets);
    return;
  }

  if (!elements.enableTrim.checked && !elements.enableResize.checked && !elements.enableCanvas.checked && !elements.enableOutput.checked) {
    applyAttentionFlash([
      elements.enableTrim.nextElementSibling,
      elements.enableResize.nextElementSibling,
      elements.enableCanvas.nextElementSibling,
      elements.enableOutput.nextElementSibling,
    ]);
  }
}

function applyAttentionFlash(nodes) {
  const uniqueNodes = [...new Set(nodes.filter(Boolean))];
  if (!uniqueNodes.length) {
    return;
  }

  for (const node of uniqueNodes) {
    node.classList.remove("attention-flash");
    node.classList.add("attention-flash-target");
    void node.offsetWidth;
    node.classList.add("attention-flash");
  }

  window.setTimeout(() => {
    for (const node of uniqueNodes) {
      node.classList.remove("attention-flash");
      node.classList.remove("attention-flash-target");
    }
  }, 260);
}

function resetAutoResizeMode() {
  state.resizeMode = RESIZE_MODE_MANUAL;
  state.resizeLongEdge = 0;
}

function shouldUseAutoLongEdgePreset(name) {
  return AUTO_LONG_EDGE_PRESET_NAMES.has(normalizePresetName(name));
}

function normalizePresetName(name) {
  return String(name || "")
    .replace(/\s+/g, "")
    .replace(/[Xx*＊]/g, "\u00d7")
    .toLowerCase();
}

async function processSingleFile(fileRecord, settings) {
  const originalMime = normalizeMimeType(fileRecord.type);
  const outputMime = settings.output.enabled && settings.output.format !== "original"
    ? normalizeMimeType(settings.output.format)
    : normalizeMimeType(originalMime);

  const hasOutputAction = settings.output.enabled && (
    settings.output.format !== "original" ||
    settings.output.quality < 1
  );

  let note = "";

  if (shouldCompressAnimatedGif(fileRecord, settings, originalMime, outputMime, hasOutputAction)) {
    try {
      const gifResult = await exportAnimatedGif(fileRecord.file, settings.output.quality, settings.output.fillColor);
      const outputUrl = URL.createObjectURL(gifResult.blob);
      const outputName = buildOutputName(fileRecord.name, outputMime);
      const outputExt = MIME_EXTENSION_MAP[outputMime] || "gif";

      return {
        id: fileRecord.id,
        outputName,
        outputExt,
        outputType: outputMime,
        outputSize: gifResult.blob.size,
        originalSize: fileRecord.size,
        outputUrl,
        width: gifResult.width || fileRecord.width,
        height: gifResult.height || fileRecord.height,
        blob: gifResult.blob,
        note: describeAnimatedGifCompression(gifResult),
      };
    } catch (error) {
      console.warn("Animated GIF compression failed, falling back to static GIF export.", error);
      note = "当前浏览器无法逐帧压缩 GIF，已导出静态 GIF。";
    }
  }

  const source = await decodeImageSource(fileRecord.file, fileRecord.sourceUrl);
  let canvas;
  let hasVisualChange = false;

  try {
    canvas = drawImageToCanvas(source);
  } finally {
    disposeImageSource(source);
  }

  if (settings.trim.enabled) {
    const trimmedResult = trimTransparentEdges(canvas, settings.trim.alphaThreshold);
    if (trimmedResult.canvas !== canvas) {
      disposeRenderingSurface(canvas);
      canvas = trimmedResult.canvas;
      hasVisualChange = true;
    }
    if (trimmedResult.note) {
      note = trimmedResult.note;
    }
  }

  if (settings.resize.enabled) {
    const nextSize = calculateResizeDimensions(canvas.width, canvas.height, settings.resize);
    if (nextSize.width !== canvas.width || nextSize.height !== canvas.height) {
      const resizedCanvas = resizeCanvas(canvas, nextSize.width, nextSize.height);
      disposeRenderingSurface(canvas);
      canvas = resizedCanvas;
      hasVisualChange = true;
    }
  }

  if (settings.canvas.enabled) {
    const nextCanvas = applyCanvasChanges(canvas, settings.canvas);
    if (nextCanvas.width !== canvas.width || nextCanvas.height !== canvas.height || settings.canvas.backgroundApplied) {
      disposeRenderingSurface(canvas);
      canvas = nextCanvas;
      hasVisualChange = true;
    } else {
      disposeRenderingSurface(canvas);
      canvas = nextCanvas;
    }
  }

  const shouldReuseOriginal = !hasVisualChange && !hasOutputAction;
  let blob;
  let finalCanvas = canvas;
  let finalMime = outputMime;

  if (shouldReuseOriginal) {
    blob = fileRecord.file;
    finalMime = originalMime;
  } else {
    if (requiresOpaqueBackground(outputMime)) {
      finalCanvas = flattenCanvas(canvas, settings.output.fillColor);
      if (finalCanvas !== canvas) {
        disposeRenderingSurface(canvas);
      }
    }

    if (outputMime === "image/gif") {
      const gifCanvas = ensureHtmlCanvasSurface(finalCanvas);
      try {
        blob = await exportGif(gifCanvas, settings.output.quality, settings.output.fillColor);
      } finally {
        if (gifCanvas !== finalCanvas) {
          disposeRenderingSurface(gifCanvas);
        }
      }
    } else {
      blob = await surfaceToBlob(finalCanvas, outputMime, shouldPassQuality(outputMime) ? settings.output.quality : undefined);
    }

    finalMime = outputMime;
  }

  const finalWidth = finalCanvas.width;
  const finalHeight = finalCanvas.height;
  const outputUrl = URL.createObjectURL(blob);
  const outputName = buildOutputName(fileRecord.name, finalMime);
  const outputExt = MIME_EXTENSION_MAP[finalMime] || "png";

  disposeRenderingSurface(finalCanvas);
  if (finalCanvas !== canvas) {
    disposeRenderingSurface(canvas);
  }

  return {
    id: fileRecord.id,
    outputName,
    outputExt,
    outputType: finalMime,
    outputSize: blob.size,
    originalSize: fileRecord.size,
    outputUrl,
    width: finalWidth,
    height: finalHeight,
    blob,
    note,
  };
}

function readSettings() {
  return {
    trim: {
      enabled: elements.enableTrim.checked,
      alphaThreshold: clampAlphaThreshold(elements.trimAlphaThreshold.value),
    },
    resize: {
      enabled: elements.enableResize.checked && (
        state.resizeMode === RESIZE_MODE_TRIMMED_LONG_EDGE ||
        toPositiveInt(elements.resizeWidth.value) ||
        toPositiveInt(elements.resizeHeight.value)
      ),
      width: toPositiveInt(elements.resizeWidth.value),
      height: toPositiveInt(elements.resizeHeight.value),
      lock: elements.lockRatio.checked,
      driver: state.resizeDriver,
      mode: state.resizeMode,
      longEdge: state.resizeLongEdge || AUTO_LONG_EDGE_RESIZE_SIZE,
    },
    canvas: {
      enabled: elements.enableCanvas.checked && (
        toPositiveInt(elements.canvasWidth.value) ||
        toPositiveInt(elements.canvasHeight.value) ||
        !elements.transparentCanvas.checked
      ),
      width: toPositiveInt(elements.canvasWidth.value),
      height: toPositiveInt(elements.canvasHeight.value),
      anchor: getSelectedAnchor(),
      transparent: elements.transparentCanvas.checked,
      backgroundColor: elements.canvasBgColor.value,
      backgroundApplied: !elements.transparentCanvas.checked,
    },
    output: {
      enabled: elements.enableOutput.checked,
      format: elements.enableOutput.checked ? elements.outputFormat.value : "original",
      quality: elements.enableOutput.checked ? Number(elements.qualityRange.value) / 100 : 1,
      fillColor: elements.outputFillColor.value,
    },
  };
}

function calculateResizeDimensions(currentWidth, currentHeight, settings) {
  if (settings.mode === RESIZE_MODE_TRIMMED_LONG_EDGE) {
    return calculateLongEdgeResizeDimensions(currentWidth, currentHeight, settings.longEdge);
  }

  const width = settings.width;
  const height = settings.height;

  if (!settings.lock) {
    return {
      width: width || currentWidth,
      height: height || currentHeight,
    };
  }

  if (settings.driver === "height" && height) {
    return {
      height,
      width: Math.max(1, Math.round(height * currentWidth / currentHeight)),
    };
  }

  if (width) {
    return {
      width,
      height: Math.max(1, Math.round(width * currentHeight / currentWidth)),
    };
  }

  if (height) {
    return {
      height,
      width: Math.max(1, Math.round(height * currentWidth / currentHeight)),
    };
  }

  return { width: currentWidth, height: currentHeight };
}

function calculateLongEdgeResizeDimensions(currentWidth, currentHeight, longEdgeSize) {
  const longEdge = toPositiveInt(longEdgeSize) || AUTO_LONG_EDGE_RESIZE_SIZE;
  if (currentWidth > currentHeight) {
    return {
      width: longEdge,
      height: Math.max(1, Math.round(longEdge * currentHeight / currentWidth)),
    };
  }

  if (currentHeight > currentWidth) {
    return {
      width: Math.max(1, Math.round(longEdge * currentWidth / currentHeight)),
      height: longEdge,
    };
  }

  return {
    width: longEdge,
    height: longEdge,
  };
}

function resizeCanvas(sourceCanvas, width, height) {
  const nextCanvas = createRenderingSurface(width, height);
  const context = getRenderingContext(nextCanvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, width, height);
  return nextCanvas;
}

function applyCanvasChanges(sourceCanvas, settings) {
  const width = settings.width || sourceCanvas.width;
  const height = settings.height || sourceCanvas.height;
  const nextCanvas = createRenderingSurface(width, height);
  const context = getRenderingContext(nextCanvas);
  const [anchorX, anchorY] = ANCHOR_MAP[settings.anchor] || ANCHOR_MAP.center;
  const dx = Math.round((width - sourceCanvas.width) * anchorX);
  const dy = Math.round((height - sourceCanvas.height) * anchorY);

  if (!settings.transparent) {
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(sourceCanvas, dx, dy);
  return nextCanvas;
}

function drawImageToCanvas(image) {
  const canvas = createRenderingSurface(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const context = getRenderingContext(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0);
  return canvas;
}

function flattenCanvas(sourceCanvas, fillColor) {
  const nextCanvas = createRenderingSurface(sourceCanvas.width, sourceCanvas.height);
  const context = getRenderingContext(nextCanvas);
  context.fillStyle = fillColor;
  context.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  context.drawImage(sourceCanvas, 0, 0);
  return nextCanvas;
}

function trimTransparentEdges(sourceCanvas, alphaThreshold) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const context = getRenderingContext(sourceCanvas);
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return {
      canvas: sourceCanvas,
      note: "图片全透明，未裁切",
    };
  }

  if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) {
    return {
      canvas: sourceCanvas,
      note: "",
    };
  }

  const trimmedWidth = maxX - minX + 1;
  const trimmedHeight = maxY - minY + 1;
  const nextCanvas = createRenderingSurface(trimmedWidth, trimmedHeight);
  const nextContext = getRenderingContext(nextCanvas);
  nextContext.drawImage(
    sourceCanvas,
    minX,
    minY,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight,
  );

  return {
    canvas: nextCanvas,
    note: "",
  };
}

function createRenderingSurface(width, height, preferOffscreen = true) {
  if (preferOffscreen && SUPPORTS_OFFSCREEN_CANVAS) {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getRenderingContext(surface) {
  const context = surface.getContext("2d", {
    alpha: true,
    desynchronized: true,
  });

  if (!context) {
    throw new Error("浏览器未能创建画布上下文。");
  }

  return context;
}

function ensureHtmlCanvasSurface(surface) {
  if (typeof HTMLCanvasElement !== "undefined" && surface instanceof HTMLCanvasElement) {
    return surface;
  }

  const nextCanvas = createRenderingSurface(surface.width, surface.height, false);
  const context = getRenderingContext(nextCanvas);
  context.drawImage(surface, 0, 0);
  return nextCanvas;
}

function disposeRenderingSurface(surface) {
  if (!surface || typeof surface !== "object") {
    return;
  }

  if ("width" in surface) {
    surface.width = 0;
  }

  if ("height" in surface) {
    surface.height = 0;
  }
}

async function downloadAllResults() {
  if (state.results.size === 0) {
    setStatus("还没有可下载的结果。");
    return;
  }

  if (state.results.size === 1) {
    const [singleResult] = state.results.values();
    downloadBlob(singleResult.outputUrl, singleResult.outputName);
    return;
  }

  try {
    await ensureZipLibrary();
  } catch (error) {
    console.error(error);
    setStatus("批量打包依赖未加载，浏览器将逐张触发下载。");
    for (const result of state.results.values()) {
      downloadBlob(result.outputUrl, result.outputName);
      await sleep(120);
    }
    return;
  }

  setStatus("正在打包 ZIP 文件...");

  const zip = new JSZip();
  const reservedNames = new Set();
  for (const result of state.results.values()) {
    const zipName = reserveNameInMemory(result.outputName, reservedNames);
    zip.file(zipName, result.blob);
  }

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const zipUrl = URL.createObjectURL(zipBlob);
  downloadBlob(zipUrl, `image-flow-${Date.now()}.zip`);
  setTimeout(() => URL.revokeObjectURL(zipUrl), 2000);
  setStatus("ZIP 打包完成。");
}

async function pickExportDirectory() {
  if (!supportsDirectoryExport()) {
    setStatus("当前浏览器不支持覆盖写回，请改用 Chrome / Edge 并在本地或 HTTPS 环境打开。");
    return;
  }

  try {
    const handle = await window.showDirectoryPicker();
    state.exportDirectoryHandle = handle;
    state.exportDirectoryName = handle.name || "已选择文件夹";
    renderAll();
    setStatus(`已选择输出文件夹：${state.exportDirectoryName}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }

    console.error(error);
    setStatus("选择输出文件夹失败。");
  }
}

async function exportResultsToDirectory() {
  if (!elements.enableOverwrite.checked) {
    setStatus("请先开启覆盖替换。");
    return;
  }

  if (!supportsDirectoryExport()) {
    setStatus("当前浏览器不支持覆盖写回，请改用 Chrome / Edge 并在本地或 HTTPS 环境打开。");
    return;
  }

  if (state.results.size === 0) {
    setStatus("请先处理图片，再执行覆盖写回。");
    return;
  }

  if (!state.exportDirectoryHandle) {
    await pickExportDirectory();
    if (!state.exportDirectoryHandle) {
      return;
    }
  }

  const orderedResults = state.files
    .map((file) => state.results.get(file.id))
    .filter(Boolean);

  if (elements.overwriteExisting.checked) {
    const duplicates = getDuplicateOutputNames(orderedResults);
    if (duplicates.length > 0) {
      const sample = duplicates.slice(0, 3).join("、");
      const suffix = duplicates.length > 3 ? " 等" : "";
      setStatus(`当前结果中存在重名文件：${sample}${suffix}。覆盖写回会让它们互相覆盖，请分批处理或关闭“覆盖同名文件”。`);
      return;
    }
  }

  const granted = await ensureDirectoryPermission(state.exportDirectoryHandle);
  if (!granted) {
    setStatus("没有获得输出文件夹的写入权限。");
    return;
  }

  state.exporting = true;
  renderAll();

  try {
    const overwriteExisting = elements.overwriteExisting.checked;
    const reservedNames = new Set();

    for (let index = 0; index < orderedResults.length; index += 1) {
      const result = orderedResults[index];
      const targetName = overwriteExisting
        ? result.outputName
        : await resolveTargetName(state.exportDirectoryHandle, result.outputName, reservedNames);

      await writeBlobToDirectory(state.exportDirectoryHandle, targetName, result.blob);
      reservedNames.add(targetName.toLowerCase());
      result.savedAs = targetName;
      result.savedToFolder = state.exportDirectoryName;
      setStatus(`正在写回 ${index + 1} / ${orderedResults.length}：${targetName}`);
    }

    renderResults();
    setStatus(`已写回 ${orderedResults.length} 个文件到“${state.exportDirectoryName}”${elements.overwriteExisting.checked ? "，同名文件已覆盖。" : "，同名文件已自动避让。"} `);
  } catch (error) {
    console.error(error);
    setStatus("覆盖写回失败，请检查文件夹权限或稍后重试。");
  } finally {
    state.exporting = false;
    renderAll();
  }
}

function downloadBlob(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function supportsDirectoryExport() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

async function ensureDirectoryPermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function" || typeof handle.requestPermission !== "function") {
    return true;
  }

  const options = { mode: "readwrite" };
  const currentState = await handle.queryPermission(options);
  if (currentState === "granted") {
    return true;
  }

  const nextState = await handle.requestPermission(options);
  return nextState === "granted";
}

async function writeBlobToDirectory(directoryHandle, filename, blob) {
  const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function resolveTargetName(directoryHandle, filename, reservedNames) {
  const normalized = filename.toLowerCase();
  if (!reservedNames.has(normalized) && !await directoryContainsFile(directoryHandle, filename)) {
    return filename;
  }

  const { stem, ext } = splitFilename(filename);
  let index = 1;

  while (index < 10000) {
    const candidate = `${stem} (${index})${ext}`;
    const candidateKey = candidate.toLowerCase();
    if (!reservedNames.has(candidateKey) && !await directoryContainsFile(directoryHandle, candidate)) {
      return candidate;
    }
    index += 1;
  }

  throw new Error("无法生成可用的输出文件名。");
}

async function directoryContainsFile(directoryHandle, filename) {
  try {
    await directoryHandle.getFileHandle(filename);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return false;
    }

    if (error instanceof DOMException && error.name === "TypeMismatchError") {
      return true;
    }

    throw error;
  }
}

function getDuplicateOutputNames(results) {
  const seen = new Set();
  const duplicates = new Set();

  for (const result of results) {
    const key = result.outputName.toLowerCase();
    if (seen.has(key)) {
      duplicates.add(result.outputName);
    } else {
      seen.add(key);
    }
  }

  return Array.from(duplicates);
}

function reserveNameInMemory(filename, reservedNames) {
  const normalized = filename.toLowerCase();
  if (!reservedNames.has(normalized)) {
    reservedNames.add(normalized);
    return filename;
  }

  const { stem, ext } = splitFilename(filename);
  let index = 1;

  while (index < 10000) {
    const candidate = `${stem} (${index})${ext}`;
    const candidateKey = candidate.toLowerCase();
    if (!reservedNames.has(candidateKey)) {
      reservedNames.add(candidateKey);
      return candidate;
    }
    index += 1;
  }

  throw new Error("无法生成可用的压缩包文件名。");
}

function splitFilename(filename) {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    return { stem: filename, ext: "" };
  }

  return {
    stem: filename.slice(0, lastDotIndex),
    ext: filename.slice(lastDotIndex),
  };
}

function getSelectedAnchor() {
  return elements.anchorGrid.querySelector(".anchor-button.is-active")?.dataset.anchor || "center";
}

function setSelectedAnchor(anchor) {
  const nextAnchor = ANCHOR_MAP[anchor] ? anchor : "center";
  elements.anchorGrid.querySelectorAll(".anchor-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.anchor === nextAnchor);
  });
}

function getActiveFile() {
  return state.files.find((file) => file.id === state.activeId) || state.files[0] || null;
}

function getStatusLabel(status) {
  switch (status) {
    case "processing":
      return "处理中";
    case "done":
      return "完成";
    case "error":
      return "失败";
    default:
      return "就绪";
  }
}

function setStatus(message) {
  if (renderCache.statusText === message) {
    return;
  }

  renderCache.statusText = message;
  elements.statusPanel.textContent = message;
}

function showImage(imageElement, placeholderElement, src, hidePlaceholder) {
  if (!src) {
    imageElement.classList.add("is-hidden");
    imageElement.removeAttribute("src");
    placeholderElement.classList.remove("is-hidden");
    return;
  }

  imageElement.src = src;
  imageElement.classList.remove("is-hidden");
  placeholderElement.classList.toggle("is-hidden", hidePlaceholder ? false : true);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDelta(nextValue, baseValue) {
  if (!baseValue) {
    return "0%";
  }
  const ratio = (nextValue - baseValue) / baseValue * 100;
  const prefix = ratio > 0 ? "+" : "";
  return `${prefix}${ratio.toFixed(1)}%`;
}

function describeMime(type) {
  return (MIME_EXTENSION_MAP[type] || type.replace("image/", "")).toUpperCase();
}

function formatRatio(width, height) {
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function gcd(a, b) {
  let x = a;
  let y = b;
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

function toPositiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clampAlphaThreshold(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.min(255, Math.max(0, number));
}

function clampPercent(value, fallback = 100) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(100, Math.max(10, number));
}

function normalizeColorValue(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : fallback;
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildOutputName(filename, mimeType) {
  const extension = MIME_EXTENSION_MAP[mimeType] || "png";
  const stem = filename.replace(/\.[^.]+$/, "");
  return `${stem}.${extension}`;
}

function normalizeMimeType(type) {
  if (SUPPORTED_EXPORT_TYPES.has(type)) {
    return type;
  }
  if (type === "image/jpg") {
    return "image/jpeg";
  }
  return "image/png";
}

function requiresOpaqueBackground(mimeType) {
  return mimeType === "image/jpeg" || mimeType === "image/gif";
}

function shouldPassQuality(mimeType) {
  return mimeType === "image/jpeg" || mimeType === "image/webp";
}

function shouldCompressAnimatedGif(fileRecord, settings, originalMime, outputMime, hasOutputAction) {
  const isOriginalGif = originalMime === "image/gif" || /\.gif$/i.test(fileRecord.name || "");
  return isOriginalGif &&
    outputMime === "image/gif" &&
    hasOutputAction &&
    !settings.trim.enabled &&
    !settings.resize.enabled &&
    !settings.canvas.enabled;
}

function gifEncoderQuality(quality) {
  return Math.max(1, Math.min(30, Math.round((1 - quality) * 29) + 1));
}

function gifFrameStep(quality) {
  if (quality >= 0.85) {
    return 1;
  }
  if (quality >= 0.65) {
    return 2;
  }
  if (quality >= 0.45) {
    return 3;
  }
  if (quality >= 0.25) {
    return 4;
  }
  return 5;
}

function describeAnimatedGifCompression(result) {
  if (result.frameStep > 1) {
    return `GIF 已重编码并降低帧数：${result.outputFrames} / ${result.frameCount} 帧`;
  }
  return result.frameCount > 1 ? "GIF 已逐帧重编码压缩" : "GIF 已重编码压缩";
}

function surfaceToBlob(surface, mimeType, quality) {
  if (typeof surface.convertToBlob === "function") {
    const options = { type: mimeType };
    if (quality !== undefined) {
      options.quality = quality;
    }
    return surface.convertToBlob(options);
  }

  return new Promise((resolve, reject) => {
    surface.toBlob((blob) => {
      if (!blob) {
        reject(new Error("浏览器未能生成输出文件。"));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

async function exportGif(canvas, quality, fillColor) {
  await ensureGifLibrary();

  return new Promise((resolve, reject) => {
    if (typeof GIF === "undefined") {
      reject(new Error("GIF 导出依赖未加载。"));
      return;
    }

    const gif = new GIF({
      workers: 2,
      quality: gifEncoderQuality(quality),
      width: canvas.width,
      height: canvas.height,
      workerScript: getGifWorkerScript(),
      background: fillColor,
    });

    gif.addFrame(canvas, { copy: true, delay: 200 });
    gif.on("finished", (blob) => resolve(blob));
    gif.on("abort", () => reject(new Error("GIF 导出中断。")));
    gif.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
    gif.render();
  });
}

async function exportAnimatedGif(file, quality, fillColor) {
  await ensureGifLibrary();
  if (typeof GIF === "undefined") {
    throw new Error("GIF 导出依赖未加载。");
  }

  const frameStep = gifFrameStep(quality);
  const fillRgb = parseHexColor(fillColor);
  let gif = null;
  let width = 0;
  let height = 0;
  let pendingDelay = 0;
  let outputFrames = 0;
  let lastSkippedFrameData = null;

  const frameSet = await decodeGifFramesFromBuffer(await file.arrayBuffer(), async (frame, frameIndex, meta) => {
    if (!gif) {
      width = meta.width;
      height = meta.height;
      gif = new GIF({
        workers: 2,
        quality: gifEncoderQuality(quality),
        width,
        height,
        workerScript: getGifWorkerScript(),
        background: fillColor,
      });
    }

    pendingDelay += frame.delay;

    if (frameIndex % frameStep === 0) {
      addCompositedGifFrame(gif, frame.data, width, height, fillRgb, pendingDelay);
      pendingDelay = 0;
      outputFrames += 1;
      lastSkippedFrameData = null;
    } else {
      lastSkippedFrameData = frame.data;
    }
  });

  if (!gif) {
    throw new Error("GIF 没有可导出的帧。");
  }

  if (lastSkippedFrameData && pendingDelay > 0) {
    addCompositedGifFrame(gif, lastSkippedFrameData, width, height, fillRgb, pendingDelay);
    outputFrames += 1;
  }

  if (!outputFrames) {
    throw new Error("GIF 没有可导出的帧。");
  }

  const blob = await renderGif(gif);
  return {
    blob,
    width,
    height,
    frameCount: frameSet.frameCount,
    outputFrames,
    frameStep,
  };
}

function addCompositedGifFrame(gif, sourceData, width, height, fillRgb, delay) {
  gif.addFrame(createCompositedImageData(sourceData, width, height, fillRgb), {
    delay: Math.max(GIF_MIN_FRAME_DELAY, Math.round(delay)),
  });
}

function parseHexColor(color) {
  const normalized = normalizeColorValue(color, "#ffffff");
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function createCompositedImageData(sourceData, width, height, fillRgb) {
  for (let offset = 0; offset < sourceData.length; offset += 4) {
    const alpha = sourceData[offset + 3] / 255;
    if (alpha < 1) {
      const inverseAlpha = 1 - alpha;
      sourceData[offset] = Math.round(sourceData[offset] * alpha + fillRgb.r * inverseAlpha);
      sourceData[offset + 1] = Math.round(sourceData[offset + 1] * alpha + fillRgb.g * inverseAlpha);
      sourceData[offset + 2] = Math.round(sourceData[offset + 2] * alpha + fillRgb.b * inverseAlpha);
      sourceData[offset + 3] = 255;
    }
  }

  return new ImageData(sourceData, width, height);
}

async function decodeGifFramesFromBuffer(buffer, onFrame) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  const shouldCollectFrames = typeof onFrame !== "function";

  const readByte = () => {
    if (offset >= bytes.length) {
      throw new Error("GIF 文件不完整。");
    }
    return bytes[offset++];
  };

  const readUint16 = () => readByte() | (readByte() << 8);

  const readString = (length) => {
    let value = "";
    for (let index = 0; index < length; index += 1) {
      value += String.fromCharCode(readByte());
    }
    return value;
  };

  const readColorTable = (length) => {
    const byteLength = length * 3;
    if (offset + byteLength > bytes.length) {
      throw new Error("GIF 颜色表不完整。");
    }
    const table = bytes.subarray(offset, offset + byteLength);
    offset += byteLength;
    return table;
  };

  const readSubBlocks = () => {
    const chunks = [];
    let totalLength = 0;

    for (;;) {
      const size = readByte();
      if (size === 0) {
        break;
      }
      if (offset + size > bytes.length) {
        throw new Error("GIF 数据块不完整。");
      }
      chunks.push(bytes.subarray(offset, offset + size));
      offset += size;
      totalLength += size;
    }

    const output = new Uint8Array(totalLength);
    let writeOffset = 0;
    for (const chunk of chunks) {
      output.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }
    return output;
  };

  const skipSubBlocks = () => {
    for (;;) {
      const size = readByte();
      if (size === 0) {
        break;
      }
      if (offset + size > bytes.length) {
        throw new Error("GIF 数据块不完整。");
      }
      offset += size;
    }
  };

  const header = readString(6);
  if (header !== "GIF87a" && header !== "GIF89a") {
    throw new Error("不是有效的 GIF 文件。");
  }

  const width = readUint16();
  const height = readUint16();
  if (!width || !height) {
    throw new Error("未能读取 GIF 尺寸。");
  }

  const packed = readByte();
  const hasGlobalColorTable = (packed & 0x80) !== 0;
  const globalColorTableSize = 1 << ((packed & 0x07) + 1);
  readByte();
  readByte();

  const globalColorTable = hasGlobalColorTable ? readColorTable(globalColorTableSize) : null;
  const frames = shouldCollectFrames ? [] : null;
  let frameCount = 0;
  let canvas = new Uint8ClampedArray(width * height * 4);
  let graphicControl = createDefaultGifGraphicControl();

  while (offset < bytes.length) {
    const blockId = readByte();
    if (blockId === 0x3B) {
      break;
    }

    if (blockId === 0x21) {
      const extensionLabel = readByte();
      if (extensionLabel === 0xF9) {
        const blockSize = readByte();
        if (blockSize !== 4) {
          offset += blockSize;
          readByte();
          continue;
        }
        const extensionPacked = readByte();
        const delayCentiseconds = readUint16();
        const transparentIndex = readByte();
        readByte();
        graphicControl = {
          disposal: (extensionPacked >> 2) & 0x07,
          delay: delayCentiseconds > 0 ? Math.max(GIF_MIN_FRAME_DELAY, delayCentiseconds * 10) : GIF_DEFAULT_FRAME_DELAY,
          transparentIndex: (extensionPacked & 0x01) !== 0 ? transparentIndex : null,
        };
      } else {
        skipSubBlocks();
      }
      continue;
    }

    if (blockId !== 0x2C) {
      throw new Error("GIF 数据包含未知块。");
    }

    const left = readUint16();
    const top = readUint16();
    const frameWidth = readUint16();
    const frameHeight = readUint16();
    const imagePacked = readByte();
    const hasLocalColorTable = (imagePacked & 0x80) !== 0;
    const isInterlaced = (imagePacked & 0x40) !== 0;
    const localColorTableSize = 1 << ((imagePacked & 0x07) + 1);
    const colorTable = hasLocalColorTable ? readColorTable(localColorTableSize) : globalColorTable;
    if (!colorTable) {
      throw new Error("GIF 缺少颜色表。");
    }

    const lzwMinCodeSize = readByte();
    const imageData = readSubBlocks();
    const expectedPixels = frameWidth * frameHeight;
    const decodedIndices = lzwDecodeGifData(lzwMinCodeSize, imageData, expectedPixels);
    const frameIndices = isInterlaced
      ? deinterlaceGifIndices(decodedIndices, frameWidth, frameHeight)
      : decodedIndices;
    const previousCanvas = graphicControl.disposal === 3 ? new Uint8ClampedArray(canvas) : null;

    for (let y = 0; y < frameHeight; y += 1) {
      const targetY = top + y;
      if (targetY < 0 || targetY >= height) {
        continue;
      }

      for (let x = 0; x < frameWidth; x += 1) {
        const targetX = left + x;
        if (targetX < 0 || targetX >= width) {
          continue;
        }

        const colorIndex = frameIndices[y * frameWidth + x];
        if (colorIndex === graphicControl.transparentIndex) {
          continue;
        }

        const colorOffset = colorIndex * 3;
        const targetOffset = (targetY * width + targetX) * 4;
        canvas[targetOffset] = colorTable[colorOffset] || 0;
        canvas[targetOffset + 1] = colorTable[colorOffset + 1] || 0;
        canvas[targetOffset + 2] = colorTable[colorOffset + 2] || 0;
        canvas[targetOffset + 3] = 255;
      }
    }

    const frame = {
      delay: graphicControl.delay,
      data: new Uint8ClampedArray(canvas),
    };

    if (shouldCollectFrames) {
      frames.push(frame);
    } else {
      await onFrame(frame, frameCount, { width, height });
    }
    frameCount += 1;

    if (frameCount % 8 === 0) {
      await yieldToBrowser();
    }

    if (graphicControl.disposal === 2) {
      clearGifFrameRegion(canvas, width, height, left, top, frameWidth, frameHeight);
    } else if (graphicControl.disposal === 3 && previousCanvas) {
      canvas = previousCanvas;
    }

    graphicControl = createDefaultGifGraphicControl();
  }

  if (!frameCount) {
    throw new Error("GIF 没有可导出的帧。");
  }

  return shouldCollectFrames ? { width, height, frames } : { width, height, frameCount };
}

function createDefaultGifGraphicControl() {
  return {
    disposal: 0,
    delay: GIF_DEFAULT_FRAME_DELAY,
    transparentIndex: null,
  };
}

function clearGifFrameRegion(canvas, canvasWidth, canvasHeight, left, top, width, height) {
  for (let y = 0; y < height; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= canvasHeight) {
      continue;
    }

    for (let x = 0; x < width; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= canvasWidth) {
        continue;
      }

      const targetOffset = (targetY * canvasWidth + targetX) * 4;
      canvas[targetOffset] = 0;
      canvas[targetOffset + 1] = 0;
      canvas[targetOffset + 2] = 0;
      canvas[targetOffset + 3] = 0;
    }
  }
}

function lzwDecodeGifData(minCodeSize, data, expectedLength) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dictionary = [];
  let bitOffset = 0;
  const output = new Uint8Array(expectedLength);
  let outputOffset = 0;

  const resetDictionary = () => {
    dictionary = [];
    for (let index = 0; index < clearCode; index += 1) {
      dictionary[index] = [index];
    }
    dictionary[clearCode] = [];
    dictionary[endCode] = null;
    codeSize = minCodeSize + 1;
    nextCode = endCode + 1;
  };

  const readCode = (size) => {
    let code = 0;
    for (let bit = 0; bit < size; bit += 1) {
      if (bitOffset >= data.length * 8) {
        return null;
      }
      if ((data[bitOffset >> 3] & (1 << (bitOffset & 7))) !== 0) {
        code |= 1 << bit;
      }
      bitOffset += 1;
    }
    return code;
  };

  resetDictionary();
  let previousEntry = null;

  for (;;) {
    const code = readCode(codeSize);
    if (code === null || code === endCode) {
      break;
    }

    if (code === clearCode) {
      resetDictionary();
      previousEntry = null;
      continue;
    }

    let entry;
    if (dictionary[code]) {
      entry = dictionary[code].slice();
    } else if (code === nextCode && previousEntry) {
      entry = previousEntry.concat(previousEntry[0]);
    } else {
      break;
    }

    for (const value of entry) {
      output[outputOffset] = value;
      outputOffset += 1;
      if (outputOffset >= expectedLength) {
        break;
      }
    }

    if (previousEntry) {
      dictionary[nextCode] = previousEntry.concat(entry[0]);
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize += 1;
      }
    }

    previousEntry = entry;
    if (outputOffset >= expectedLength) {
      break;
    }
  }

  return outputOffset === expectedLength ? output : output.slice(0, outputOffset);
}

function deinterlaceGifIndices(indices, width, height) {
  const output = new Uint8Array(indices.length);
  const passes = [
    { start: 0, step: 8 },
    { start: 4, step: 8 },
    { start: 2, step: 4 },
    { start: 1, step: 2 },
  ];
  let sourceOffset = 0;

  for (const pass of passes) {
    for (let y = pass.start; y < height; y += pass.step) {
      const row = indices.subarray(sourceOffset, sourceOffset + width);
      output.set(row, y * width);
      sourceOffset += width;
    }
  }

  return output;
}

function renderGif(gif) {
  return new Promise((resolve, reject) => {
    gif.on("finished", (blob) => resolve(blob));
    gif.on("abort", () => reject(new Error("GIF 导出中断。")));
    gif.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
    gif.render();
  });
}

function getGifWorkerScript() {
  if (gifWorkerBlobUrl) {
    return gifWorkerBlobUrl;
  }

  return "/batch/vendor/gif.worker.js";
}

async function decodeImageSource(source, fallbackUrl = "") {
  if (source instanceof Blob && typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(source);
    } catch (error) {
      console.warn("createImageBitmap failed, falling back to HTMLImageElement.", error);
    }
  }

  const url = typeof source === "string" ? source : fallbackUrl;
  if (!url) {
    throw new Error("缺少可用的图片地址。");
  }

  return loadImage(url);
}

function disposeImageSource(source) {
  if (source && typeof source.close === "function") {
    source.close();
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败。"));
    image.src = url;
  });
}

async function getImageDimensions(source, fallbackUrl = "") {
  const decodedSource = await decodeImageSource(source, fallbackUrl);

  try {
    return {
      width: decodedSource.naturalWidth || decodedSource.width,
      height: decodedSource.naturalHeight || decodedSource.height,
    };
  } finally {
    disposeImageSource(decodedSource);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }

    window.requestAnimationFrame(() => resolve());
  });
}
