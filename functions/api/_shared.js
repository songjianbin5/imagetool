const RUNNINGHUB_BASE = "https://www.runninghub.cn/openapi/v2";
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

export const TOOLS = {
  cutout: {
    name: "AI抠图",
    endpoint: "/run/ai-app/1950866462321876993",
    imageNode: { nodeId: "64", fieldName: "image", description: "上传处理的图片" },
    options: [
      { nodeId: "50", fieldName: "value", fieldValue: "1", description: "PNG透明=0 / 白底图=1" },
      { nodeId: "69", fieldName: "text", fieldValue: "主体", description: "抠图物品名称/元素" },
      { nodeId: "68", fieldName: "value", fieldValue: "1024", description: "处理分辨率" },
    ],
  },
  retouch: {
    name: "AI修图",
    endpoint: "/run/ai-app/1993390141502930945",
    imageNode: { nodeId: "27", fieldName: "image", description: "上传原图" },
    options: [],
  },
  upscale: {
    name: "高清放大",
    endpoint: "/run/ai-app/1961636707420585985",
    imageNode: { nodeId: "3", fieldName: "image", description: "上传图像" },
    options: [
      { nodeId: "27", fieldName: "select", fieldValue: "2", description: "修复后分辨率" },
    ],
  },
};

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function handleError(error) {
  if (error instanceof ApiError) {
    return json({ ok: false, message: error.message, details: error.details }, error.status);
  }
  return json({ ok: false, message: "服务内部错误", details: String(error?.message || error) }, 500);
}

export function serverKeys(env) {
  return [env.RUNNINGHUB_API_KEY, env.RUNNINGHUB_API_KEYS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[\n\r,;]+/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function randomKey(keys) {
  if (!keys.length) return "";
  const data = new Uint32Array(1);
  crypto.getRandomValues(data);
  return keys[data[0] % keys.length];
}

export function apiKeyFrom(request, env, payload = {}) {
  const headerKey = request.headers.get("X-RunningHub-Key")?.trim() || "";
  const bodyKey = String(payload.apiKey || "").trim();
  const envKey = randomKey(serverKeys(env));
  const apiKey = headerKey || bodyKey || envKey;
  if (!apiKey) {
    throw new ApiError(401, "请设置 RunningHub API Key，或在 Cloudflare Pages 环境变量中配置 RUNNINGHUB_API_KEY / RUNNINGHUB_API_KEYS");
  }
  return apiKey;
}

export async function readJson(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ApiError(400, "请求体必须是 JSON 对象");
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "JSON 格式不正确");
  }
}

export function formText(formData, name, fallback = "") {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function buildNodeInfo(toolId, imageValue, fields) {
  const tool = TOOLS[toolId];
  const imageNode = { ...tool.imageNode, fieldValue: imageValue };
  const nodes = [imageNode];

  if (toolId === "cutout") {
    const transparent = formText(fields, "cutoutMode", "white").toLowerCase() === "transparent";
    nodes.push(
      { nodeId: "50", fieldName: "value", fieldValue: transparent ? "0" : "1", description: "PNG透明=0 / 白底图=1" },
      { nodeId: "69", fieldName: "text", fieldValue: formText(fields, "subject", "主体"), description: "抠图物品名称/元素" },
      { nodeId: "68", fieldName: "value", fieldValue: formText(fields, "resolution", "1024"), description: "处理分辨率" },
    );
    return nodes;
  }

  if (toolId === "upscale") {
    let repairResolution = formText(fields, "repairResolution", "2");
    if (!["0", "1", "2", "3"].includes(repairResolution)) {
      repairResolution = "2";
    }
    nodes.push({ nodeId: "27", fieldName: "select", fieldValue: repairResolution, description: "修复后分辨率" });
    return nodes;
  }

  nodes.push(...tool.options.map((item) => ({ ...item })));
  return nodes;
}

export async function requestRunningHub(path, apiKey, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${apiKey}`);

  const requestInit = {
    method: init.method || "POST",
    headers,
  };

  if (init.body instanceof FormData) {
    requestInit.body = init.body;
  } else if (init.body !== undefined) {
    headers.set("Content-Type", init.contentType || "application/json");
    requestInit.body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  }

  const response = await fetch(`${RUNNINGHUB_BASE}${path}`, requestInit);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new ApiError(502, "RunningHub 返回了非 JSON 响应", text.slice(0, 500));
  }

  if (!response.ok) {
    throw new ApiError(response.status, "RunningHub 请求失败", data || text);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError(502, "RunningHub 返回格式异常", data);
  }
  return data;
}

export async function uploadToRunningHub(file, apiKey) {
  if (!(file instanceof File) || file.size <= 0) {
    throw new ApiError(400, "请上传一张图片");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, "图片不能超过 24MB");
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "upload.png");
  return requestRunningHub("/media/upload/binary", apiKey, { body: formData });
}

export function uploadValue(uploadResponse) {
  const data = uploadResponse?.data && typeof uploadResponse.data === "object" ? uploadResponse.data : uploadResponse;
  const candidates = [
    data?.fileName,
    data?.filename,
    data?.download_url,
    data?.url,
    data?.fileUrl,
    data?.path,
  ];
  const value = candidates.find((item) => item && String(item).trim());
  if (!value) {
    throw new ApiError(502, "上传成功但未找到文件地址", uploadResponse);
  }
  return String(value).trim();
}
