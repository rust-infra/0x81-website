# moyan-admin YouTube 数据采集设计

日期：2026-07-22  
状态：已确认

## 1. 目标与范围

在 `moyan-admin` 增加 **数据采集** 能力：运营粘贴 YouTube 视频链接，后端拉取字幕，用 LLM 整理成词汇卡片草稿，经预览勾选/编辑后导入系统词库。

### 要做（v1）

- Admin 菜单：**数据采集**、**设置（LLM）**
- 流水线分三步短请求（前端编排进度 + **采集耗时**跑表）
  1. 拉字幕 / 标题
  2. LLM 提取候选卡片
  3. 确认导入（默认新建系统卡组，可改选已有）
- LLM 参数在 Admin **设置页**配置并**存库**：`base_url`、`api_key`、`model`（及可选 `temperature`）
- 字幕来源：`yt-dlp`（Docker 运行时安装）；无字幕返回友好错误
- 鉴权：现有 `X-Admin-Token`

### 明确不做（v1）

- SSE / 异步任务表
- 音视频 ASR（Whisper 等）
- 用户侧（moyan-web）采集入口
- API Key 进阶加密（依赖 Admin Token + 库访问控制；GET 脱敏展示）
- 自动翻译整段字幕为课文（只产出词汇卡片）

## 2. 架构

```
moyan-admin
  ├─ /collect     粘贴 URL → 三步请求 + 步骤进度 + 耗时 → 预览 → 导入
  └─ /settings    LLM base_url / api_key / model

moyan-backend /api/admin/*
  ├─ GET|PUT /settings/llm
  ├─ POST /collect/youtube/captions
  ├─ POST /collect/youtube/extract
  └─ POST /collect/youtube/import
         │
         ├─ yt-dlp (subprocess)
         ├─ OpenAI-compatible Chat Completions
         └─ 现有 AdminService 建卡组 / 建卡片
```

| 单元 | 职责 |
|------|------|
| `CollectPage` | 编排三步、步骤 UI、耗时、预览表、导入目标 |
| `SettingsPage` | LLM 配置读写 |
| `AdminCollectService` | 字幕抓取、LLM 调用、组导入 payload |
| `admin_settings` 表 | 持久化 LLM 配置 |
| Dockerfile | 安装 `yt-dlp` + 运行时依赖 |

## 3. 前端 UX

### 3.1 数据采集

1. 输入框：YouTube URL（`youtube.com/watch`、`youtu.be`）
2. 「开始采集」：
   - 启动耗时计时（`mm:ss`，到候选就绪或失败停止）
   - 步骤条：`解析链接` → `拉取字幕` → `LLM 整理` → `候选就绪`
   - 顺序调用 captions → extract；任一步失败停在该步并展示错误
3. 预览区：
   - 目标：默认「新建卡组」，名称预填视频标题；可切换「合并到已有系统卡组」+ 下拉
   - 表格：勾选、front、back、pronunciation、tags、例句（可行内编辑）
   - 「确认导入」→ import；成功跳转该卡组卡片页或提示成功
4. 导入不计入「采集耗时」（耗时仅 captions+extract）；可另显示「导入中」

### 3.2 设置

- 表单字段：`base_url`、`api_key`、`model`、可选 `temperature`（默认 0.3）
- 加载时 `api_key` 若已配置显示掩码（如 `sk-***xxxx`），留空提交表示不改 key；提供「清除 Key」
- 「测试连接」可选（v1 可后置）；至少保存成功提示

## 4. API

均需 `X-Admin-Token`。统一成功信封 `{ success, data }`。

### 4.1 LLM 设置

`GET /api/admin/settings/llm`

```json
{
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "api_key_set": true,
  "api_key_masked": "sk-***abcd"
}
```

`PUT /api/admin/settings/llm`

```json
{
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "clear_api_key": false
}
```

- `api_key` 省略或 `null`：保留原 key  
- `clear_api_key: true`：清空 key  
- 可选启动时：若库中无配置，用环境变量 `MOYAN_LLM_BASE_URL` / `MOYAN_LLM_API_KEY` / `MOYAN_LLM_MODEL` 作只读默认（首次 GET 可返回，不自动写库，直到用户保存）

### 4.2 字幕

`POST /api/admin/collect/youtube/captions`

```json
{ "url": "https://www.youtube.com/watch?v=LqG1q5NpOBE" }
```

响应：

```json
{
  "video_id": "LqG1q5NpOBE",
  "title": "...",
  "duration_sec": 600,
  "language": "en",
  "caption_text": "....",
  "source_url": "https://www.youtube.com/watch?v=LqG1q5NpOBE"
}
```

错误：无效 URL → 400；无字幕 → 400（明确文案）；yt-dlp 失败 → 502/500 友好信息。

### 4.3 提取

`POST /api/admin/collect/youtube/extract`

```json
{
  "video_id": "LqG1q5NpOBE",
  "title": "...",
  "caption_text": "..."
}
```

- 未配置 LLM → 400「请先在设置中配置 LLM」
- 字幕过长：截断到合理上限（如 24k 字符）并在响应带 `truncated: true`
- LLM 返回严格 JSON 数组卡片；解析失败 → 502

响应：

```json
{
  "draft_cards": [
    {
      "front": "word",
      "back": "释义",
      "pronunciation": "/…/",
      "tags": ["youtube", "LqG1q5NpOBE"],
      "examples": [
        { "sentence_en": "...", "translation_zh": "..." }
      ]
    }
  ],
  "truncated": false
}
```

卡片字段与现有系统卡片对齐（含 `examples`）。

### 4.4 导入

`POST /api/admin/collect/youtube/import`

```json
{
  "target": { "mode": "create", "name": "视频标题", "description": "from YouTube …", "source_key": "yt_LqG1q5NpOBE" },
  "cards": [ /* 勾选后的草稿，结构同 CreateCard */ ]
}
```

或 `"target": { "mode": "merge", "deck_id": "deck_…" }`。

- `create`：新建系统卡组后批量建卡；`source_key` 建议 `yt_<video_id>`，冲突则后缀时间戳
- `merge`：向已有系统卡组追加卡片（按 front 去重可选：同 front 跳过并计数）
- 响应：`{ deck_id, created_cards, skipped_cards }`

## 5. 存储

迁移 `004_admin_settings.sql`：

```sql
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

LLM 配置以 JSON 存 `key = 'llm'`（value 含 base_url、api_key、model、temperature）。Mongo 实现同步提供同等 KV（若 admin 仅 sqlite 部署，mongo stub 返回未实现或同构集合）。

## 6. 字幕与 LLM 实现要点

- `yt-dlp`：`--skip-download --write-auto-sub --write-sub --sub-langs en.*,en --sub-format vtt/srt --print` 元数据；解析 VTT 去时间轴为纯文本
- 语言优先：人工英文字幕 → 英文自动字幕 → 其它可用字幕（记录 `language`）
- LLM：`POST {base_url}/chat/completions`，system prompt 要求输出 JSON；user 提供标题+字幕片段
- Prompt 目标：英语学习向（front 英文词/短语，back 中文，带例句）；过滤极常见功能词；数量建议上限（如 40）

## 7. 部署

- `moyan-backend` Dockerfile runtime 安装 `yt-dlp`（pip 或官方二进制）与 `ffmpeg` 仅若需要（v1 只要字幕可不装 ffmpeg）
- 本地开发：机器需可执行 `yt-dlp`；路径可用 `MOYAN_YTDLP_PATH` 覆盖，默认 `yt-dlp`

## 8. 测试

- 单元：URL 解析、VTT 清洗、LLM JSON 解析、设置脱敏
- 集成：captions（真实视频 [LqG1q5NpOBE](https://www.youtube.com/watch?v=LqG1q5NpOBE)）、extract（需配置 LLM）、import 后 admin 列表可见
- 页面：Settings 保存 → Collect 全流程 → 卡组卡片页可见

## 9. 风险

- YouTube / 代理限制导致 yt-dlp 失败：错误信息需可操作
- LLM 费用与超时：单请求超时建议 120s；字幕截断
- API Key 明文存库：仅 admin 可读写；文档提醒生产加固
