import {
  ApiError,
  TOOLS,
  apiKeyFrom,
  buildNodeInfo,
  formText,
  handleError,
  json,
  requestRunningHub,
  uploadToRunningHub,
  uploadValue,
} from "./_shared.js";

export async function onRequestPost({ request, env }) {
  try {
    const formData = await request.formData();
    const toolId = formText(formData, "tool", "cutout");
    if (!TOOLS[toolId]) {
      throw new ApiError(400, "未知功能类型");
    }

    const image = formData.get("image");
    const apiKey = apiKeyFrom(request, env, Object.fromEntries(formData.entries()));
    const upload = await uploadToRunningHub(image, apiKey);
    const imageValue = uploadValue(upload);
    const submitted = {
      nodeInfoList: buildNodeInfo(toolId, imageValue, formData),
      instanceType: formText(formData, "instanceType", "plus") || "plus",
      usePersonalQueue: formText(formData, "usePersonalQueue", "false") || "false",
    };
    const task = await requestRunningHub(TOOLS[toolId].endpoint, apiKey, { body: submitted });
    return json({ ok: true, tool: toolId, task, upload, submitted });
  } catch (error) {
    return handleError(error);
  }
}
