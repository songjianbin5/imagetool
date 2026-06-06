const state = {
  tool: "cutout",
  cutoutMode: "white",
  items: [],
  selectedId: null,
  busy: false,
  hasServerKey: false,
};

const els = {
  apiKey: document.querySelector("#apiKey"),
  clearButton: document.querySelector("#clearButton"),
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
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

async function boot() {
  bindEvents();
  restoreSavedApiKey();
  render();
  try {
    const config = await fetchJson("/api/config");
    state.hasServerKey = Boolean(config.hasServerKey);
  } catch (error) {
    toast("本地服务未就绪");
  }
}

function bindEvents() {
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.tool === button.dataset.tool) {
        return;
      }
      clearQueue();
      state.tool = button.dataset.tool;
      document.querySelectorAll("[data-tool]").forEach((item) => item.classList.toggle("is-active", item === button));
      document.querySelectorAll("[data-options]").forEach((block) => {
        block.classList.toggle("is-hidden", block.dataset.options !== state.tool);
      });
      render();
    });
  });

  document.querySelectorAll("[data-cutout-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cutoutMode = button.dataset.cutoutMode;
      document.querySelectorAll("[data-cutout-mode]").forEach((item) => item.classList.toggle("is-active", item === button));
    });
  });

  els.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
  els.clearButton.addEventListener("click", clearQueue);
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
  els.fileInput.value = "";
  render();
}

function clearQueue() {
  state.items.forEach((item) => URL.revokeObjectURL(item.sourceUrl));
  state.items = [];
  state.selectedId = null;
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
  render();

  for (const item of state.items) {
    if (item.status === "done") continue;
    await processItem(item);
  }

  state.busy = false;
  els.startButton.disabled = false;
  render();
}

async function processItem(item) {
  state.selectedId = item.id;
  updateItem(item, { status: "uploading", statusText: "上传图片中", progress: 12 });

  const formData = new FormData();
  formData.append("image", item.file);
  formData.append("tool", state.tool);
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
  render();
}

function render() {
  renderPreview();
  renderQueue();
  els.queueCounter.textContent = `${state.items.length} 张`;
  const done = state.items.filter((item) => item.status === "done").length;
  els.taskSummary.textContent = `${done} / ${state.items.length} 完成`;
  els.startButton.disabled = state.busy;
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
    img.src = url;
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
  state.items.forEach((item) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.classList.toggle("is-active", item.id === state.selectedId);
    node.classList.toggle("is-done", item.status === "done");
    node.classList.toggle("is-error", item.status === "error");
    node.querySelector("img").src = item.sourceUrl;
    node.querySelector("strong").textContent = item.file.name;
    node.querySelector("small").textContent = `${labels[state.tool]} · ${item.statusText}`;
    node.querySelector(".progress-track span").style.width = `${item.progress}%`;

    const download = node.querySelector(".download-link");
    if (item.resultUrl) {
      download.href = item.resultUrl;
      download.classList.add("is-visible");
    }

    node.querySelector(".thumb-button").addEventListener("click", () => {
      state.selectedId = item.id;
      render();
    });
    els.queueList.appendChild(node);
  });
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
