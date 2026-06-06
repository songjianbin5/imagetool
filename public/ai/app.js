const state = {
  tool: "cutout",
  cutoutMode: "white",
  items: [],
  history: [],
  selectedId: null,
  activePanel: "tasks",
  busy: false,
  hasServerKey: false,
};

const els = {
  apiKey: document.querySelector("#apiKey"),
  clearButton: document.querySelector("#clearButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  historyList: document.querySelector("#historyList"),
  historySummary: document.querySelector("#historySummary"),
  historyTemplate: document.querySelector("#historyItemTemplate"),
  instanceType: document.querySelector("#instanceType"),
  repairResolution: document.querySelector("#repairResolution"),
  queueCounter: document.querySelector("#queueCounter"),
  queueList: document.querySelector("#queueList"),
  resultEmpty: document.querySelector("#resultEmpty"),
  resultPreview: document.querySelector("#resultPreview"),
  selectedName: document.querySelector("#selectedName"),
  sourceEmpty: document.querySelector("#sourceEmpty"),
  sourcePreview: document.querySelector("#sourcePreview"),
  startButton: document.querySelector("#startButton"),
  subject: document.querySelector("#subject"),
  resolution: document.querySelector("#resolution"),
  taskSummary: document.querySelector("#taskSummary"),
  template: document.querySelector("#queueItemTemplate"),
};

const labels = {
  cutout: "AI抠图",
  retouch: "AI修图",
  upscale: "高清放大",
};

const API_KEY_STORAGE_KEY = "rhPanel.runningHubApiKey";
const RESULT_HISTORY_STORAGE_KEY = "rhPanel.resultHistory";
const RESULT_HISTORY_TTL = 24 * 60 * 60 * 1000;
const RESULT_HISTORY_LIMIT = 80;
const toolButtons = Array.from(document.querySelectorAll("[data-tool]"));
const panelButtons = Array.from(document.querySelectorAll("[data-panel]"));
const cutoutModeButtons = Array.from(document.querySelectorAll("[data-cutout-mode]"));
const optionBlocks = Array.from(document.querySelectorAll("[data-options]"));
const tabPanels = Array.from(document.querySelectorAll(".queue-tab-panel"));

async function boot() {
  bindEvents();
  restoreSavedApiKey();
  restoreResultHistory();
  render();
  try {
    const config = await fetchJson("/api/config");
    state.hasServerKey = Boolean(config.hasServerKey);
  } catch (error) {
    toast("本地服务未就绪");
  }
}

function bindEvents() {
  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextTool = button.dataset.tool;
      if (state.tool === nextTool) {
        return;
      }
      if (state.busy) {
        toast("处理中暂时不能切换功能");
        return;
      }
      if (queueHasResults()) {
        const confirmed = window.confirm("切换功能会清除当前任务列表中的处理结果，并将任务重置为等待处理，是否继续？");
        if (!confirmed) {
          return;
        }
        resetQueueResults(nextTool);
      }
      setTool(nextTool);
    });
  });

  panelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.activePanel = button.dataset.panel;
      render({ panels: true });
    });
  });

  cutoutModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.cutoutMode = button.dataset.cutoutMode;
      cutoutModeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    });
  });

  els.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
  els.clearButton.addEventListener("click", clearQueue);
  els.clearHistoryButton.addEventListener("click", clearResultHistory);
  els.startButton.addEventListener("click", processQueue);

  ["dragenter", "dragover"].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((type) => {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  });

  els.dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
}

function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  const nextItems = files.map((file) => ({
    id: crypto.randomUUID(),
    file,
    tool: state.tool,
    sourceUrl: URL.createObjectURL(file),
    resultUrl: "",
    taskId: "",
    status: "waiting",
    statusText: "等待处理",
    progress: 0,
  }));
  state.items.push(...nextItems);
  if (!state.selectedId && nextItems[0]) {
    state.selectedId = nextItems[0].id;
  }
  state.activePanel = "tasks";
  els.fileInput.value = "";
  render();
}

function clearQueue() {
  state.items.forEach((item) => URL.revokeObjectURL(item.sourceUrl));
  state.items = [];
  state.selectedId = null;
  render();
}

function removeQueueItem(id) {
  if (state.busy) {
    toast("处理中暂时不能移除任务");
    return;
  }
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) {
    return;
  }

  const [removed] = state.items.splice(index, 1);
  URL.revokeObjectURL(removed.sourceUrl);
  if (state.selectedId === id) {
    const nextSelected = state.items[index] || state.items[index - 1] || null;
    state.selectedId = nextSelected ? nextSelected.id : null;
  }
  render();
}

function queueHasResults() {
  return state.items.some((item) => item.resultUrl || item.status === "done");
}

function resetQueueResults(tool) {
  state.items.forEach((item) => {
    Object.assign(item, {
      resultUrl: "",
      taskId: "",
      status: "waiting",
      statusText: "等待处理",
      progress: 0,
      tool,
    });
  });
}

function setTool(tool) {
  state.tool = tool;
  toolButtons.forEach((item) => item.classList.toggle("is-active", item.dataset.tool === tool));
  optionBlocks.forEach((block) => {
    block.classList.toggle("is-hidden", block.dataset.options !== tool);
  });
  render();
}

function restoreSavedApiKey() {
  try {
    const savedKey = window.localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedKey) {
      els.apiKey.value = savedKey;
    }
  } catch (error) {
    // Some browser privacy modes can block localStorage.
  }
}

function currentApiKey() {
  return els.apiKey.value.trim();
}

function saveApiKey(key) {
  try {
    if (key) {
      window.localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch (error) {
    toast("浏览器阻止了本地保存");
  }
}

function restoreResultHistory() {
  try {
    const saved = window.localStorage.getItem(RESULT_HISTORY_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    state.history = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    state.history = [];
  }
  pruneResultHistory();
}

function pruneResultHistory() {
  const cutoff = Date.now() - RESULT_HISTORY_TTL;
  const nextHistory = state.history.filter((entry) => entry.createdAt > cutoff && entry.resultUrl);
  if (nextHistory.length !== state.history.length) {
    state.history = nextHistory;
    saveResultHistory();
  } else {
    state.history = nextHistory;
  }
}

function saveResultHistory() {
  try {
    window.localStorage.setItem(RESULT_HISTORY_STORAGE_KEY, JSON.stringify(state.history));
  } catch (error) {
    toast("浏览器阻止了处理结果保存");
  }
}

function addResultHistory(item) {
  const entry = {
    id: crypto.randomUUID(),
    fileName: item.file.name,
    tool: item.tool || state.tool,
    resultUrl: item.resultUrl,
    taskId: item.taskId,
    createdAt: Date.now(),
  };
  state.history = [entry, ...state.history.filter((historyItem) => historyItem.resultUrl !== entry.resultUrl)].slice(0, RESULT_HISTORY_LIMIT);
  pruneResultHistory();
  saveResultHistory();
  render({ history: true, summary: true });
}

function clearResultHistory() {
  state.history = [];
  saveResultHistory();
  render();
}

async function processQueue() {
  if (state.busy) return;
  if (!state.items.length) {
    toast("请先上传图片");
    return;
  }
  if (!state.hasServerKey && !currentApiKey()) {
    toast("缺少 RunningHub API Key");
    return;
  }

  state.busy = true;
  els.startButton.disabled = true;
  render({ queue: true, summary: true });

  for (const item of state.items) {
    if (item.status === "done") continue;
    await processItem(item);
  }

  state.busy = false;
  els.startButton.disabled = false;
  render({ queue: true, summary: true });
}

async function processItem(item) {
  state.selectedId = item.id;
  item.tool = state.tool;
  updateItem(item, { status: "uploading", statusText: "上传图片中", progress: 12 });

  const formData = new FormData();
  formData.append("image", item.file);
  formData.append("tool", item.tool);
  formData.append("apiKey", currentApiKey());
  formData.append("instanceType", els.instanceType.value);
  formData.append("cutoutMode", state.cutoutMode);
  formData.append("subject", els.subject.value.trim() || "主体");
  formData.append("resolution", els.resolution.value);
  formData.append("repairResolution", els.repairResolution.value);

  try {
    const submitted = await fetchJson("/api/process", { method: "POST", body: formData });
    const taskId = submitted.task?.taskId;
    if (!taskId) {
      throw new Error(submitted.task?.errorMessage || "RunningHub 未返回 taskId");
    }
    updateItem(item, { taskId, status: "running", statusText: `任务运行中 ${taskId}`, progress: 42 });
    await pollTask(item, taskId);
  } catch (error) {
    updateItem(item, { status: "error", statusText: error.message || "处理失败", progress: 100 });
  }
}

async function pollTask(item, taskId) {
  const startedAt = Date.now();
  const maxWaitMs = 12 * 60 * 1000;
  while (Date.now() - startedAt < maxWaitMs) {
    await delay(3000);
    const progress = Math.min(92, item.progress + 7);
    updateItem(item, { progress, statusText: "等待 RunningHub 返回结果" });

    const response = await fetchJson("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, apiKey: currentApiKey() }),
    });
    const task = response.task || {};

    if (task.status === "SUCCESS") {
      const result = firstResultUrl(task.results);
      if (!result) {
        throw new Error("任务成功但没有图片结果");
      }
      updateItem(item, {
        resultUrl: result,
        status: "done",
        statusText: "处理完成",
        progress: 100,
      });
      addResultHistory(item);
      return;
    }

    if (task.status === "FAILED") {
      throw new Error(task.errorMessage || "RunningHub 任务失败");
    }

    updateItem(item, {
      status: String(task.status || "running").toLowerCase(),
      statusText: statusText(task.status),
      progress,
    });
  }
  throw new Error("等待超时，请稍后用 taskId 查询");
}

function firstResultUrl(results) {
  if (!Array.isArray(results)) return "";
  const item = results.find((entry) => entry && entry.url);
  return item ? item.url : "";
}

function statusText(status) {
  const map = {
    QUEUED: "排队中",
    RUNNING: "运行中",
    SUCCESS: "处理完成",
    FAILED: "处理失败",
  };
  return map[status] || "处理中";
}

function updateItem(item, patch) {
  Object.assign(item, patch);
  render({ preview: true, queue: true, summary: true });
}

function render(parts = {}) {
  const shouldRenderAll = !Object.keys(parts).length;
  pruneResultHistory();
  if (shouldRenderAll || parts.preview) renderPreview();
  if (shouldRenderAll || parts.queue) renderQueue();
  if (shouldRenderAll || parts.history) renderHistory();
  if (shouldRenderAll || parts.panels) renderPanels();
  if (shouldRenderAll || parts.summary) renderSummary();
  els.startButton.disabled = state.busy;
}

function renderSummary() {
  els.queueCounter.textContent = `${state.items.length} 张`;
  const done = state.items.filter((item) => item.status === "done").length;
  els.taskSummary.textContent = `${done} / ${state.items.length} 完成`;
  els.historySummary.textContent = `${state.history.length} 条 · 近 24 小时`;
}

function renderPreview() {
  const selected = state.items.find((item) => item.id === state.selectedId);
  els.selectedName.textContent = selected ? selected.file.name : "未选择图片";
  setStage(els.sourcePreview, els.sourceEmpty, selected?.sourceUrl || "");
  setStage(els.resultPreview, els.resultEmpty, selected?.resultUrl || "");
}

function setStage(img, empty, url) {
  const stage = img.closest(".image-stage");
  if (url) {
    if (img.getAttribute("src") !== url) {
      img.src = url;
    }
    stage.classList.add("has-image");
    empty.hidden = true;
  } else {
    img.removeAttribute("src");
    stage.classList.remove("has-image");
    empty.hidden = false;
  }
}

function renderQueue() {
  els.queueList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  state.items.forEach((item) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.classList.toggle("is-active", item.id === state.selectedId);
    node.classList.toggle("is-done", item.status === "done");
    node.classList.toggle("is-error", item.status === "error");
    const image = node.querySelector("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.src = item.sourceUrl;
    node.querySelector("strong").textContent = item.file.name;
    const itemTool = item.status === "waiting" ? state.tool : item.tool || state.tool;
    node.querySelector("small").textContent = `${labels[itemTool]} · ${item.statusText}`;
    node.querySelector(".progress-track span").style.width = `${item.progress}%`;

    const download = node.querySelector(".download-link");
    if (item.resultUrl) {
      download.href = downloadProxyUrl(item.resultUrl);
      download.classList.add("is-visible");
    }

    const removeButton = node.querySelector(".queue-remove-button");
    removeButton.disabled = state.busy;
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeQueueItem(item.id);
    });

    node.querySelector(".thumb-button").addEventListener("click", () => {
      state.selectedId = item.id;
      render({ preview: true, queue: true });
    });
    fragment.appendChild(node);
  });
  els.queueList.appendChild(fragment);
}

function renderHistory() {
  els.historyList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  state.history.slice(0, RESULT_HISTORY_LIMIT).forEach((item) => {
    const node = els.historyTemplate.content.firstElementChild.cloneNode(true);
    const thumb = node.querySelector(".thumb-button");
    thumb.href = item.resultUrl;
    const image = node.querySelector("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.src = item.resultUrl;
    node.querySelector("strong").textContent = item.fileName;
    node.querySelector("small").textContent = `${labels[item.tool] || "AI处理"} · 可下载`;
    node.querySelector(".history-time").textContent = formatHistoryTime(item.createdAt);

    const download = node.querySelector(".download-link");
    download.href = downloadProxyUrl(item.resultUrl);
    fragment.appendChild(node);
  });
  els.historyList.appendChild(fragment);
}

function downloadProxyUrl(url) {
  return `/api/download?url=${encodeURIComponent(url)}`;
}

function renderPanels() {
  panelButtons.forEach((button) => {
    const isActive = button.dataset.panel === state.activePanel;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.id === `${state.activePanel}Panel`;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

function formatHistoryTime(timestamp) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(timestamp)} 生成`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const details = typeof data.details === "string" ? `：${data.details}` : "";
    throw new Error((data.message || `请求失败 ${response.status}`) + details);
  }
  return data;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toast(message) {
  let node = document.querySelector(".toast-message");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast-message";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("is-visible");
  window.setTimeout(() => {
    node.classList.remove("is-visible");
  }, 2600);
}

boot();
