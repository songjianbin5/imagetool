# 煊原集团 - 内部图片工具

这个项目包含两个 Web 工具：

- `/`：入口主页
- `/batch/`：图片处理工具，支持调整尺寸、转换格式、压缩图片大小
- `/ai/`：AI 图片工作台，支持 AI 抠图、AI 修图、AI 高清放大

## Cloudflare Pages 部署

仓库可以直接部署到 Cloudflare Pages，例如：

```text
Production URL: https://imagetool-4yd.pages.dev/
Build command: 留空
Build output directory: public
Functions directory: functions
```

Pages Functions 会提供以下接口：

- `GET /api/config`
- `POST /api/process`
- `POST /api/query`

### 环境变量

在 Cloudflare Pages 的 Settings -> Environment variables 中配置：

```text
RUNNINGHUB_API_KEY=你的 RunningHub API Key
```

如果有多个 key，可以配置：

```text
RUNNINGHUB_API_KEYS=key1,key2,key3
```

多个 key 会随机调用。也可以用换行分隔。

## 本地开发

双击 `start.bat`，或运行：

```powershell
python server.py
```

然后打开：

```text
http://127.0.0.1:8000/
```

本地 Python 服务同样支持：

```powershell
$env:RUNNINGHUB_API_KEY="你的 RunningHub API Key"
python server.py
```

或多个 key：

```powershell
$env:RUNNINGHUB_API_KEYS="key1,key2,key3"
python server.py
```

## 目录结构

```text
public/              静态页面
  index.html         入口主页
  home.css
  ai/                AI 图片工作台
  batch/             图片处理工具
functions/api/       Cloudflare Pages Functions API 代理
server.py            本地开发服务器和 RunningHub API 代理
wrangler.toml        Cloudflare Pages 配置
```
