import { json, serverKeys, TOOLS } from "./_shared.js";

export async function onRequestGet({ env }) {
  return json({
    hasServerKey: serverKeys(env).length > 0,
    tools: Object.fromEntries(
      Object.entries(TOOLS).map(([key, value]) => [
        key,
        { name: value.name, endpoint: value.endpoint },
      ]),
    ),
  });
}
