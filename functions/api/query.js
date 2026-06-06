import {
  ApiError,
  apiKeyFrom,
  handleError,
  json,
  readJson,
  requestRunningHub,
} from "./_shared.js";

export async function onRequestPost({ request, env }) {
  try {
    const payload = await readJson(request);
    const taskId = String(payload.taskId || "").trim();
    if (!taskId) {
      throw new ApiError(400, "缺少 taskId");
    }

    const apiKey = apiKeyFrom(request, env, payload);
    const task = await requestRunningHub("/query", apiKey, { body: { taskId } });
    return json({ ok: true, task });
  } catch (error) {
    return handleError(error);
  }
}
