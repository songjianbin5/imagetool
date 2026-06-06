from __future__ import annotations

import json
import mimetypes
import os
import re
import ssl
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
RUNNINGHUB_BASE = "https://www.runninghub.cn/openapi/v2"
MAX_UPLOAD_BYTES = 24 * 1024 * 1024


TOOLS: dict[str, dict[str, Any]] = {
    "cutout": {
        "name": "AI抠图",
        "endpoint": "/run/ai-app/1950866462321876993",
        "imageNode": {"nodeId": "64", "fieldName": "image", "description": "上传处理的图片"},
        "options": [
            {"nodeId": "50", "fieldName": "value", "fieldValue": "1", "description": "PNG透明=0 / 白底图=1"},
            {"nodeId": "69", "fieldName": "text", "fieldValue": "主体", "description": "抠图物品名称/元素(默认:主体)"},
            {"nodeId": "68", "fieldName": "value", "fieldValue": "1024", "description": "处理分辨率(默认:1024)"},
        ],
    },
    "retouch": {
        "name": "AI修图",
        "endpoint": "/run/ai-app/1993390141502930945",
        "imageNode": {"nodeId": "27", "fieldName": "image", "description": "上传原图"},
        "options": [],
    },
    "upscale": {
        "name": "高清放大",
        "endpoint": "/run/ai-app/1961636707420585985",
        "imageNode": {"nodeId": "3", "fieldName": "image", "description": "上传图像"},
        "options": [
            {"nodeId": "27", "fieldName": "select", "fieldValue": "2", "description": "修复后分辨率"},
        ],
    },
}


class ApiError(Exception):
    def __init__(self, status: int, message: str, details: Any | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.details = details


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def safe_join(path: str) -> Path:
    clean_path = unquote(path.split("?", 1)[0]).lstrip("/")
    if not clean_path:
        clean_path = "index.html"
    target = (PUBLIC / clean_path).resolve()
    public_root = PUBLIC.resolve()
    if target == public_root or public_root not in target.parents:
        raise ApiError(403, "无权访问该路径")
    if target.is_dir():
        target = target / "index.html"
    elif not target.exists() and (PUBLIC / clean_path / "index.html").resolve().is_file():
        target = (PUBLIC / clean_path / "index.html").resolve()
    return target


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length > MAX_UPLOAD_BYTES:
        raise ApiError(413, "请求体过大")
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError(400, "JSON 格式不正确") from exc
    if not isinstance(parsed, dict):
        raise ApiError(400, "请求体必须是 JSON 对象")
    return parsed


def parse_multipart(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    content_type = handler.headers.get("Content-Type", "")
    boundary_match = re.search(r"boundary=(?P<boundary>[^;]+)", content_type)
    if not boundary_match:
        raise ApiError(400, "缺少 multipart boundary")

    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        raise ApiError(400, "上传内容为空")
    if length > MAX_UPLOAD_BYTES:
        raise ApiError(413, "图片不能超过 24MB")

    boundary = boundary_match.group("boundary").strip().strip('"').encode("utf-8")
    body = handler.rfile.read(length)
    parts = body.split(b"--" + boundary)
    fields: dict[str, Any] = {}

    for part in parts:
        part = part.strip()
        if not part or part == b"--":
            continue
        if part.endswith(b"--"):
            part = part[:-2].strip()
        if b"\r\n\r\n" not in part:
            continue

        header_blob, content = part.split(b"\r\n\r\n", 1)
        content = content.removesuffix(b"\r\n")
        headers = header_blob.decode("utf-8", errors="replace").split("\r\n")
        disposition = next((h for h in headers if h.lower().startswith("content-disposition:")), "")
        name_match = re.search(r'name="([^"]+)"', disposition)
        if not name_match:
            continue
        field_name = name_match.group(1)
        filename_match = re.search(r'filename="([^"]*)"', disposition)
        if filename_match:
            filename = Path(filename_match.group(1)).name or f"upload-{uuid.uuid4().hex}.png"
            content_type_header = next((h for h in headers if h.lower().startswith("content-type:")), "")
            file_type = content_type_header.split(":", 1)[1].strip() if ":" in content_type_header else "application/octet-stream"
            fields[field_name] = {"filename": filename, "contentType": file_type, "content": content}
        else:
            fields[field_name] = content.decode("utf-8", errors="replace")

    return fields


def api_key_from(handler: BaseHTTPRequestHandler, payload: dict[str, Any] | None = None) -> str:
    header_key = handler.headers.get("X-RunningHub-Key", "").strip()
    body_key = str((payload or {}).get("apiKey", "")).strip()
    env_key = os.environ.get("RUNNINGHUB_API_KEY", "").strip()
    api_key = header_key or body_key or env_key
    if not api_key:
        raise ApiError(401, "请填写 RunningHub API Key，或设置 RUNNINGHUB_API_KEY 环境变量")
    return api_key


def request_runninghub(path: str, api_key: str, *, method: str = "POST", body: bytes | None = None, content_type: str = "application/json") -> dict[str, Any]:
    request = Request(f"{RUNNINGHUB_BASE}{path}", method=method)
    request.add_header("Authorization", f"Bearer {api_key}")
    if content_type:
        request.add_header("Content-Type", content_type)
    if body is not None:
        request.data = body

    try:
        with urlopen(request, timeout=90, context=ssl.create_default_context()) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ApiError(exc.code, "RunningHub 请求失败", detail) from exc
    except URLError as exc:
        raise ApiError(502, "无法连接 RunningHub", str(exc.reason)) from exc

    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ApiError(502, "RunningHub 返回了非 JSON 响应", raw.decode("utf-8", errors="replace")[:500]) from exc
    if not isinstance(parsed, dict):
        raise ApiError(502, "RunningHub 返回格式异常", parsed)
    return parsed


def upload_to_runninghub(file_part: dict[str, Any], api_key: str) -> dict[str, Any]:
    boundary = f"----rhpanel{uuid.uuid4().hex}"
    filename = file_part["filename"]
    content_type = file_part.get("contentType") or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    content = file_part["content"]
    body = b"".join(
        [
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode("utf-8"),
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
            content,
            b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
    )
    return request_runninghub(
        "/media/upload/binary",
        api_key,
        body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )


def upload_value(upload_response: dict[str, Any]) -> str:
    data = upload_response.get("data") if isinstance(upload_response.get("data"), dict) else upload_response
    candidates = [
        data.get("fileName"),
        data.get("filename"),
        data.get("download_url"),
        data.get("url"),
        data.get("fileUrl"),
        data.get("path"),
    ]
    value = next((str(item).strip() for item in candidates if item), "")
    if not value:
        raise ApiError(502, "上传成功但未找到文件地址", upload_response)
    return value


def build_node_info(tool_id: str, image_value: str, fields: dict[str, Any]) -> list[dict[str, str]]:
    tool = TOOLS[tool_id]
    image_node = dict(tool["imageNode"])
    image_node["fieldValue"] = image_value
    nodes = [image_node]

    if tool_id == "cutout":
        transparent = str(fields.get("cutoutMode", "white")).lower() == "transparent"
        subject = str(fields.get("subject", "主体") or "主体").strip()
        resolution = str(fields.get("resolution", "1024") or "1024").strip()
        nodes.extend(
            [
                {"nodeId": "50", "fieldName": "value", "fieldValue": "0" if transparent else "1", "description": "PNG透明=0 / 白底图=1"},
                {"nodeId": "69", "fieldName": "text", "fieldValue": subject, "description": "抠图物品名称/元素(默认:主体)"},
                {"nodeId": "68", "fieldName": "value", "fieldValue": resolution, "description": "处理分辨率(默认:1024)"},
            ]
        )
    elif tool_id == "upscale":
        repair_resolution = str(fields.get("repairResolution", "2") or "2").strip()
        if repair_resolution not in {"0", "1", "2", "3"}:
            repair_resolution = "2"
        nodes.append({"nodeId": "27", "fieldName": "select", "fieldValue": repair_resolution, "description": "修复后分辨率"})
    else:
        nodes.extend(dict(item) for item in tool["options"])

    return nodes


class RunningHubPanelHandler(BaseHTTPRequestHandler):
    server_version = "RunningHubPanel/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/config":
            self.send_json(
                {
                    "hasServerKey": bool(os.environ.get("RUNNINGHUB_API_KEY", "").strip()),
                    "tools": {key: {"name": value["name"], "endpoint": value["endpoint"]} for key, value in TOOLS.items()},
                }
            )
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/process":
                self.handle_process()
                return
            if parsed.path == "/api/query":
                self.handle_query()
                return
            raise ApiError(404, "接口不存在")
        except ApiError as exc:
            self.send_json({"ok": False, "message": exc.message, "details": exc.details}, exc.status)
        except Exception as exc:  # pragma: no cover - defensive boundary for local tool use.
            self.send_json({"ok": False, "message": "服务内部错误", "details": str(exc)}, 500)

    def handle_process(self) -> None:
        fields = parse_multipart(self)
        tool_id = str(fields.get("tool", "cutout"))
        if tool_id not in TOOLS:
            raise ApiError(400, "未知功能类型")
        file_part = fields.get("image")
        if not isinstance(file_part, dict) or not file_part.get("content"):
            raise ApiError(400, "请上传一张图片")
        api_key = api_key_from(self, fields)

        upload_response = upload_to_runninghub(file_part, api_key)
        image_value = upload_value(upload_response)
        payload = {
            "nodeInfoList": build_node_info(tool_id, image_value, fields),
            "instanceType": str(fields.get("instanceType", "default") or "default"),
            "usePersonalQueue": str(fields.get("usePersonalQueue", "false") or "false"),
        }
        run_response = request_runninghub(TOOLS[tool_id]["endpoint"], api_key, body=json_bytes(payload))
        self.send_json(
            {
                "ok": True,
                "tool": tool_id,
                "task": run_response,
                "upload": upload_response,
                "submitted": payload,
            }
        )

    def handle_query(self) -> None:
        payload = read_json_body(self)
        task_id = str(payload.get("taskId", "")).strip()
        if not task_id:
            raise ApiError(400, "缺少 taskId")
        api_key = api_key_from(self, payload)
        query_response = request_runninghub("/query", api_key, body=json_bytes({"taskId": task_id}))
        self.send_json({"ok": True, "task": query_response})

    def serve_static(self, request_path: str) -> None:
        try:
            target = safe_join(request_path)
            if not target.exists() or not target.is_file():
                target = PUBLIC / "index.html"
        except ApiError as exc:
            self.send_json({"ok": False, "message": exc.message}, exc.status)
            return

        stat = target.stat()
        etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return

        data = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif target.suffix in {".html", ".css", ".svg"}:
            content_type = f"{content_type}; charset=utf-8"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: Any, status: int = 200) -> None:
        data = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args: Any) -> None:
        stamp = time.strftime("%H:%M:%S")
        sys.stderr.write(f"[{stamp}] {self.address_string()} {fmt % args}\n")


def main() -> None:
    if not PUBLIC.exists():
        raise SystemExit("缺少 public 目录")
    httpd = ThreadingHTTPServer((HOST, PORT), RunningHubPanelHandler)
    print(f"RunningHub 面板已启动: http://{HOST}:{PORT}", flush=True)
    print("提示: 请设置 RUNNINGHUB_API_KEY 环境变量用于线上部署。", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止", flush=True)


if __name__ == "__main__":
    main()
