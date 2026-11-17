# 本地数字人推理环境

这个目录跑 MuseTalk 1.5，用来把播客对话预渲染成带口型的 MP4。服务不参与 App 运行时，只负责离线生成和缓存。

## 已验证环境

- GPU: NVIDIA GeForce RTX 3080 Ti 12GB
- 内存: 31GB
- Python: 3.10.22
- PyTorch: 2.0.1 + CUDA 11.8
- MuseTalk: 1.5

## 安装

```bash
cd rehearse-backend/digital-human
./scripts/setup.sh
```

安装过程会下载约 4.4GB 权重。默认使用清华 PyPI 镜像、hf-mirror 和 ghfast.top，可以通过环境变量覆盖：

```bash
PYPI_MIRROR=https://pypi.org/simple \
HF_ENDPOINT=https://huggingface.co \
GH_MIRROR=https://github.com \
./scripts/setup.sh
```

## 跑样片

```bash
./scripts/run_demo.sh
```

输出在 `outputs/demo/v15/yongen_yongen.mp4`。实测 8 秒音频总耗时 59 秒，包含模型加载、关键点提取、口型推理和 ffmpeg 合成；输出为 704x1216、25fps。

也可以传入自己的素材：

```bash
./scripts/run_demo.sh /path/to/anchor.mp4 /path/to/line.wav my-line
```

## 生成服务

```bash
./scripts/run_service.sh
```

默认监听 `0.0.0.0:8765`，状态和片段落在 `state/`，不提交。

```bash
curl -s localhost:8765/v1/health

curl -s -X POST localhost:8765/v1/clips \
  -H 'Content-Type: application/json' \
  -d '{"text":"Alex, please introduce yourself."}'

curl -s localhost:8765/v1/clips/<key>
```

队列串行执行，避免多个任务同时抢 12GB 显存。首句会走 Piper TTS、MuseTalk 和 ffmpeg，之后按文本、音色和模型版本哈希命中缓存。

## App 接入

根 `.env` 配置：

```bash
DIGITAL_HUMAN_URL=http://127.0.0.1:8765
```

Go 后端暴露四个端点，App 只认业务域名：

```text
POST /api/rehearse/podcast/clips
GET  /api/rehearse/podcast/clips/:key
GET  /api/rehearse/podcast/clips/:key/video
GET  /api/rehearse/podcast/poster
```

App 播放一句时先请求片段。已缓存就直接播 MP4，未缓存就回退现有 TTS。播放本身不入队，生成完成后再播同一句会自动换成视频。视频请求带 JWT，Go 转发时保留 `Range`，支持拖动进度。海报接口返回主播静帧，用于盖住视频首帧渲染前的空表面。

播放本身不会入队。生成需要显式动作：App 里的“生成本集数字人”按钮，或下面的批量脚本。这样自动连播不会把整本书都塞进 GPU 队列。

```bash
cd rehearse-app
npm run prefetch:podcast -- --deck 第一册 --lesson 3 --limit 10 --wait
```

队列有上限，默认 500，可用 `DH_MAX_QUEUE` 覆盖。积压过多时可以清空待生成任务，已完成的片段不会删除：

```bash
curl -X POST localhost:8765/v1/queue/clear
```

默认使用 `assets/sun-anchor-720p.mp4`。它从仓库自带的 `sun.mp4` 裁成面部更大的半身构图，放大到 720×1080，并做了轻微降饱和和暗角。`./scripts/build_anchor.sh` 可以重建。素材仍只用于开发验证，上线前把 `DH_ANCHOR_VIDEO` 换成有商用授权的主播视频。切换主播时同时换一个 `DH_STATE_DIR`，避免复用旧人物的片段缓存。

TTS 默认使用 Piper `en_US-lessac-high`，比之前的 `medium` 更自然。服务端生成完成后会给 MP4 加 `faststart`，App 起播不用先等整个文件下完。

## 目录

- `scripts/setup.sh`: 建 Python 3.10 环境、装 CUDA PyTorch 和 MuseTalk 依赖、下载代码和权重。
- `scripts/download_weights.sh`: 只下载模型权重。
- `scripts/run_demo.sh`: 跑一条样片。
- `scripts/run_service.sh`: 启动 FastAPI 生成服务。
- `third_party/MuseTalk`: 第三方代码，不提交。
- `models`: 权重，不提交。
- `outputs`: 生成结果，不提交。
- `state`: 队列状态、音频和缓存的 MP4，不提交。

## 下一步

1. 换一段有商用授权的正面主播视频，替换仓库自带样片。
2. 把生成服务接进部署和监控，补失败重试与磁盘清理。
3. 评估云端 TTS，保留 Piper 作为离线兜底。

不要用未经授权的真人形象或声音做克隆。

