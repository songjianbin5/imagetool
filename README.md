# 图片工具入口

本项目合并了两个 Web 工具：

- `/`：入口主页
- `/batch/`：图片处理工具，支持调整尺寸、转换格式、压缩图片大小
- `/ai/`：AI 图片工作台，支持 AI 抠图、AI 修图、AI 高清放大

## 启动

双击 `start.bat`，或在当前目录运行：

```powershell
python server.py
```

然后打开：

```text
http://127.0.0.1:8000/
```

## 目录结构

```text
public/
  index.html        入口主页
  home.css          入口主页样式
  ai/               AI 图片工作台
  batch/            批量图片处理工具
server.py           静态页面服务 + RunningHub API 代理
```

## RunningHub API Key

线上建议使用环境变量：

```powershell
$env:RUNNINGHUB_API_KEY="你的 API Key"
python server.py
```

AI 图片工作台会通过 `server.py` 代理 RunningHub 的上传、提交和查询接口。

## 线上部署

当前版本包含 Python 后端代理，不能只上传静态文件完成全部功能。

推荐：

- Render / Railway / Fly.io / VPS：直接运行 `python server.py`
- Cloudflare Pages：适合入口页和批量图片工具；AI 工作台需要额外改成 Pages Functions/Workers 代理 RunningHub API

环境变量：

```text
RUNNINGHUB_API_KEY=你的 API Key
PORT=平台提供的端口
```
