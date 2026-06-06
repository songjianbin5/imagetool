import {
  handleError,
  fileNameFromUrl,
  safeDownloadUrl,
} from "./_shared.js";

export async function onRequestGet({ request }) {
  try {
    const requestUrl = new URL(request.url);
    const targetUrl = safeDownloadUrl(requestUrl.searchParams.get("url"));
    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return new Response("下载图片失败", { status: upstream.status });
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileNameFromUrl(targetUrl))}`);
    headers.set("Cache-Control", "private, max-age=300");

    const contentLength = upstream.headers.get("Content-Length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return handleError(error);
  }
}
