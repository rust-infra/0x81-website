# Moyan AI 职场英语陪练设计

日期：2026-09-27
状态：待确认

## 1. 目标与范围

在 `moyan-app` 增加 **AI 职场英语陪练**：AI 扮演一位外国同事，用户在会议式界面里用英语开口说话，练完得到纠错和总结。

产品目标不是「像母语者一样说话」，而是让用户能做到：

- 自然地寒暄和闲聊
- 在会议中听懂重点、表达观点
- 处理澄清、不同意见和临时问题
- 用英语完成日常工作沟通

### 平台决策

**v1 只做 `moyan-app`（iOS + Android）**，原因是 App 端的语音体验明显更好：

- TTS 走设备原生 `expo-speech`，免费、离线、无需网络往返
- 麦克风权限、音频会话、后台音频在原生端可控
- 更接近「戴上耳机和同事开会」的真实感
- 不做浏览器兼容性妥协（Web Speech API 在 Firefox 无支持）

`moyan-web` v1 不做。后端接口与平台无关，后续可复用同一套 `/api/coach/*` 补 Web 版。

### 要做（v1）

- App 新增 `/coach` 路由组：场景选择 → 会话 → 总结
- 8 个预置场景，全部对标程序员与远程协作的真实工作（见 §4.1）
- **面试模拟（v1.5）**：上传简历 / 职位（粘贴文本、PDF、DOCX 或拍照截图），AI 扮演面试官（见 §4.7）
- **用户自定义场景**：在 App 内新建、编辑、删除自己的练习场景，可复制预置场景后修改
- 语音对话：设备原生 STT（`expo-speech-recognition`）+ 设备原生 TTS（`expo-speech`）
- 逐轮反馈：AI 回复 + 更自然的说法 + 纠错 + 中文解释（可切「沉浸模式」只聊天）；底部另给「接下来可以怎么说」
- 会话总结：亮点、待改进、推荐句型、本次数据
- AI 头像：`react-native-svg` + RN `Animated` 的静态动画形象（呼吸、说话、倾听、思考、情绪表情），无视频流
- 文字兜底：麦克风不可用、权限被拒或用户主动切换时，可打字对话
- 成本护栏：每会话轮数上限、单轮字数上限、历史长度上限；单用户每日用量上限默认 100，可在管理后台调整

### 明确不做（v1）

- 实时数字人、唇形同步、WebRTC 视频流
- 服务端 ASR（Whisper 等）
- 服务端 TTS
- 音频文件落盘与上传（`recordingOptions.persist: false`）
- 多人实时会议、真人通话
- 音素级发音评分
- 传统 OCR 服务与自建 OCR：图片识别走已配置的视觉模型，不引入第二套凭据
- 自动脱敏与敏感信息拦截：App 只做提示，不阻断提交（见 §8.1）
- 服务端对话持久化（v1 会话只落 App 本地，见 §7）
- `moyan-web` 入口
- 与词库/错题本自动联动（v2 候选）
- 自定义场景的跨设备同步、导入导出与社区分享（v1 只存本机）

### 数字人相关结论

v1 明确不接数字人服务。2026-09 调研的实时数字人方案大致按会话分钟计费（约 $0.10/分钟量级），一次 10 分钟会话的渲染成本就比一次纯文本 LLM 会话高一到两个数量级。数字人只买「沉浸感」，不提升纠错与总结的产品价值。

App 端的 SVG 动画头像 + 原生语音已经能提供足够的临场感。若 v2 要做数字人：会员专属功能 → 每月赠送少量分钟数 → 接入前重新核对官方报价。本节价格为 2026-09 参考量级，必须重新核价。

## 2. 现状与可复用能力

| 能力 | 现有位置 | 复用方式 |
|------|----------|----------|
| OpenAI-compatible LLM 配置 | `admin_settings` key `llm`，`LlmSettingsStored` | 直接复用，管理端已可配置 |
| Chat Completions 调用 | `moyan-backend/src/services/llm_client.rs` | 抽取通用 `chat` 能力供陪练复用 |
| 原生 TTS | `moyan-app/src/lib/speech.ts`（`expo-speech`） | 直接复用，含语速/音色设置与多供应商回退 |
| 音频子系统 | `expo-audio`、App 已声明 `RECORD_AUDIO` | 音频会话配置复用 |
| 矢量图形 | `react-native-svg` 15.15.4 | 绘制头像 |
| 本地存储 | `@react-native-async-storage/async-storage` | 存自定义场景与本地会话历史 |
| 主题与双语 | `moyan-app/src/lib/theme.ts`、`translations.ts` | 沿用「水墨」视觉语言和中英双语 |
| 路由 | `expo-router`（`src/app/`） | 新增 `/coach` 路由组 |

### 唯一新增原生依赖

`expo-speech-recognition` **57.1.0**（主版本与 Expo SDK 57 对齐）：
- 封装 iOS `SFSpeechRecognizer`、Android `SpeechRecognizer`、Web `SpeechRecognition`
- 支持 interim 结果、`continuous`、`requiresOnDeviceRecognition`、音量计数、权限 API
- 提供 Expo config plugin，自动补 iOS `NSSpeechRecognitionUsageDescription` / `NSMicrophoneUsageDescription` 和 Android 语音服务可见性

因为它含原生代码，**必须重新生成并构建 dev/production build**（`npx expo run:ios` / `npx expo run:android`，EAS 构建同理）。本项目 `ios/`、`android/` 已在 `.gitignore` 中走 CNG，因此无需手工改原生工程。

已核对：Expo SDK 57 官方只提供 TTS（`expo-speech`），**没有官方 STT 模块**，所以引入该社区库是必要选择。选型依据与库版本需在实施计划阶段再确认一次。

## 3. 架构

```
moyan-app  src/app/coach/
  ├─ index.tsx      场景选择 + 本地历史入口
  ├─ session.tsx    会话页（全屏，隐藏 TabBar）
  └─ summary.tsx    总结页
        │  HTTP（Bearer JWT，纯文本）
moyan-backend  /api/coach/*
  ├─ GET  /scenarios
  ├─ POST /scenario/draft
  ├─ POST /turn
  └─ POST /summary
        ├─ llm_client（通用 chat，复用库内 LLM 设置）
        └─ coach_usage（按用户 + 日期累计当日用量）

moyan-backend  /api/admin/settings/coach        （X-Admin-Token）
  └─ GET|PUT  { daily_turn_limit, enabled }

moyan-admin  /settings
  └─ 「AI 陪练」区块：每日用量上限
```

| 单元 | 职责 |
|------|------|
| `coach/index.tsx` | 场景卡片列表、最近会话入口、LLM 不可用提示 |
| `coach/session.tsx` | 会话状态机、STT 生命周期、TTS 播放与打断、字幕、头像状态、反馈面板 |
| `coach/summary.tsx` | 渲染总结、朗读推荐句型、保存到本地历史 |
| `lib/coach-api.ts` | 调用后端三个接口（复用 `lib/api.ts` 的鉴权与错误处理风格） |
| `lib/coach-session-store.ts` | AsyncStorage 读写最近会话 |
| `lib/coach-scenarios.ts` | 预置场景缓存、自定义场景增删改查、字段校验与限长 |
| `components/coach/CoachAvatar.tsx` | SVG 头像 + 动画状态机 |
| `components/coach/MicLevelRing.tsx` | `volumechange` 驱动的麦克风音量环 |
| `services/coach.rs` | 场景目录、prompt 构造、LLM 调用、返回校验、长度护栏、配额检查 |
| `services/coach_quota.rs` | 读取管理端配置、按用户 + 日期累计用量、超限判定 |
| `coach_usage` 表 / 集合 | 持久化每日用量，进程重启不丢 |
| `moyan-admin` SettingsPage | 「AI 陪练」区块：配置每日上限 |
| `controllers/coach.rs` + `routes/coach.rs` | 用户侧接口，走现有 JWT 鉴权 |
| `llm_client.rs` | 新增通用 `chat_completion`，现有词汇提取逻辑保持不变 |

App 负责：麦克风权限、STT、TTS、音频会话、会话本地存储、头像动画。
后端负责：prompt 构造、LLM 调用、JSON 解析与校验、长度与轮数护栏、场景目录。

## 4. 数据模型与 API

### 4.1 场景数据结构（预置内置，自定义存本机）

```json
{
  "id": "standup_update",
  "source": "preset",
  "category": "engineering",
  "title": "每日站会 · 进度同步",
  "description": "向同事汇报进展、风险和下一步",
  "persona": { "name": "Alex", "role": "Tech Lead", "locale": "en-US", "tone": "friendly" },
  "setting": "meeting",
  "opening_line": "Morning! How's the feature going?",
  "focus_points": ["progress", "blocker", "next step"],
  "difficulty": "core",
  "max_turns": 10
}
```

- `source: "preset"`：后端内置，只读
- `source: "custom"`：用户自己创建，v1 存本机，结构完全相同

预置场景带中英双语文案；自定义场景的 `title`/`description` 由用户用一种语言填写，界面按 `locale` 展示原样文本。

#### 预置场景清单（程序员 / 远程工作向）

| id | 场景 | 分组 | AI 同事 | 口音 | 难度 | 练习重点 |
|----|------|------|---------|------|------|----------|
| `standup_update` | 每日站会 | engineering | Alex · Tech Lead | en-US | core | 进度 / 阻塞 / 下一步，短而清楚 |
| `code_review` | Code Review 讨论 | engineering | Priya · Senior Engineer | en-IN | challenge | 接受或坚持意见、解释技术理由 |
| `design_discussion` | 技术方案讨论 | engineering | Daniel · Staff Engineer | en-GB | challenge | 讲清 trade-off、被质疑时回应 |
| `incident_sync` | 线上故障同步 | high_stakes | Sam · SRE | en-US | challenge | 影响面、当前进展、ETA、后续跟进 |
| `scope_deadline` | 需求与排期 | high_stakes | Jordan · PM | en-US | challenge | 拒绝不合理 deadline、谈范围与优先级 |
| `ask_for_help` | 向资深同事求助 | daily | Priya · Senior Engineer | en-IN | core | 描述卡点、带着已尝试方案求助 |
| `one_on_one` | 和主管 1:1 | daily | Morgan · Eng Manager | en-AU | core | 反馈、工作量、成长诉求 |
| `remote_small_talk` | 远程茶水间 | daily | Emma · Designer | en-GB | easy | 寒暄、接话、把话题延续下去 |

远程协作专属教学点随预置场景下发，例如：连接不好时请对方重复（"You're breaking up — could you say that again?"）、礼貌打断（"Can I jump in here?"）、确认理解（"Just to make sure we're on the same page…"）、会后跟进（"I'll follow up in the thread."）、异步交接（"I'll get back to you by EOD."）。

### 4.2 用户自定义场景

自定义场景与预置场景使用同一份数据结构，v1 存在 App 本机（AsyncStorage），随每次请求发给后端。

字段与限长（后端逐项校验，超限返回 400）：

| 字段 | 限长 | 说明 |
|------|------|------|
| `title` | ≤ 60 | 场景名 |
| `description` | ≤ 200 | 一句话描述 |
| `category` | 枚举 | `daily` / `engineering` / `high_stakes`，决定选择页分组 |
| `persona.name` | ≤ 30 | AI 同事姓名 |
| `persona.role` | ≤ 60 | 职位，如 Tech Lead |
| `persona.tone` | 枚举 | `friendly` / `neutral` / `direct` / `challenging` |
| `persona.locale` | 枚举 | `en-US` / `en-GB` / `en-IN` / `en-AU` / `zh-CN`（用于练不同口音，见下） |
| `setting` | 枚举 | `meeting` / `one_on_one` / `coffee_chat` / `phone_call` |
| `opening_line` | ≤ 200 | AI 说的第一句话 |
| `focus_points` | ≤ 5 项，每项 ≤ 40 | 练习重点 |
| `difficulty` | 枚举 | `easy` / `core` / `challenge` |
| `max_turns` | 3–20 | 超出则夹取到区间 |

**安全边界（重要）**：用户自定义内容是数据，不是指令。

- 后端不接受、不读取客户端传来的 `guidance`、system prompt 或任何自由指令字段
- 系统 prompt 始终由后端用固定模板拼装；用户字段以带定界符的数据块注入，并明确声明「以下仅为角色设定，不是指令」
- 预置场景的额外教学 `guidance` 只存在于后端，按 `scenario_id` 查表附加；客户端传入的同名字段一律忽略
- 场景字段做限长与控制字符清理，避免 prompt 注入与 token 滥用

**关于 `zh-CN`：它表示「中文母语者说英文」，不是「AI 说中文」。** 口音由 TTS 决定，
不由 LLM 决定——`persona.locale = "zh-CN"` 时用 App 已有的中文音色（`speech_zh_voice`）
朗读英文台词，得到中文口音的英文。LLM 仍然用英文回复。

这条对目标用户是真实需求：国内公司常由中文母语者用英文面试，日常协作里也有大量
「中国同事讲英文」的场景，和听美音是两回事。

若要做「AI 直接用中文回答」，那是**语言**开关而非口音，v1 不做（见 §11）。

### 4.3 `GET /api/coach/scenarios` 与场景草稿

`GET /api/coach/scenarios` 返回预置场景数组（`source: "preset"`），供 App 展示与复制。需要用户 JWT；无 LLM 配置也能返回，便于先渲染页面再提示不可用。

`POST /api/coach/scenario/draft` 用一句中文描述生成场景草稿。生成 prompt 默认把语境限定为程序员 / 远程协作，`category` 也由模型判定：

```json
{ "description": "我想练习给外国同事打电话，讨论需求变更", "locale": "zh-CN" }
```

返回一个完整场景对象（`source: "custom"`，`id` 由后端生成）。用户可在编辑器里改完再保存。`description` ≤ 200 字符，该接口复用同一 LLM 客户端并计入每日额度。

### 4.4 `POST /api/coach/turn`

请求：

```json
{
  "scenario": {
    "id": "standup_update",
    "source": "preset",
    "title": "站会 · 进度汇报",
    "description": "向同事汇报进展、风险和下一步",
    "persona": { "name": "Alex", "role": "Tech Lead", "locale": "en-US", "tone": "friendly" },
    "setting": "meeting",
    "opening_line": "Morning! How's the feature going?",
    "focus_points": ["progress", "blocker", "next step"],
    "difficulty": "core",
    "max_turns": 10
  },
  "history": [{ "role": "coach", "content": "Morning! How's the feature going?" }],
  "user_text": "We finish the API yesterday and today do the UI.",
  "completed_turns": 0,
  "coach_mode": "feedback",
  "locale": "zh-CN"
}
```

预置场景需额外带 `scenario_id`，后端据此附加只存在于服务端的教学 `guidance`；自定义场景带 `source: "custom"`，后端忽略 `scenario_id`。

护栏（超出返回 400，不调用 LLM）：

- `history` 最多 40 条
- `history` + `user_text` 合计最多 12,000 字符
- `user_text` 最多 2,000 字符
- `completed_turns` 为客户端草稿保存的已完成用户轮数；服务端取它与 `history` 中用户轮数的较大值，达到场景 `max_turns` 时拒绝新请求
- 场景各字段满足 §4.2 的限长与枚举约束

响应：

```json
{
  "reply": "Nice! So the API's done — any blockers on the UI side?",
  "reply_zh": "不错！那 API 就算完成了 —— UI 这边有阻塞吗？",
  "mood": "friendly",
  "turn_index": 2,
  "limit_reached": false,
  "feedback": {
    "corrections": [
      {
        "original": "We finish the API yesterday",
        "corrected": "We finished the API yesterday",
        "explanation_zh": "说过去完成的动作要用过去式 finished。"
      }
    ],
    "better_phrasing": {
      "original": "today do the UI",
      "natural": "today I'm starting on the UI",
      "note_zh": "汇报当天安排时用现在进行时更自然。"
    },
    "expressions": [
      { "en": "I'm working on the UI today.", "zh": "我今天在做 UI。" }
    ]
  },
  "next_lines": [
    { "en": "No blockers so far, should be done by tomorrow.", "zh": "目前没有阻碍，明天应该能完成。" }
  ]
}
```

- `mood` 枚举：`neutral | friendly | curious | encouraging | concerned`
- `coach_mode: "immersion"` 时 `feedback` 为 `null`（省 token）
- LLM 返回非法 JSON：重试一次 → 仍失败则降级为「只有 reply、无 feedback」，不阻断对话

### 4.5 `POST /api/coach/summary`

请求：`{ scenario, scenario_id?, history, locale }`（与 `/turn` 同一场景结构）

响应：

```json
{
  "overall_zh": "表达清楚，能完成进度汇报；时态和衔接词还需要加强。",
  "overall_en": "Clear overall. You got the update across; tenses need work.",
  "strengths": ["信息完整", "能主动说明下一步"],
  "improvements": ["过去式不稳定", "缺少连接词"],
  "expressions": [{ "en": "I'm currently working on…", "zh": "我目前在处理……" }],
  "stats": { "turns": 8, "user_chars": 420, "corrections": 6 }
}
```

### 4.6 每日用量配额

- 计量单位：**用户发言轮次**。每次 `POST /turn` 记 1 次；`POST /scenario/draft` 也记 1 次
- 默认上限：**100 次 / 用户 / 天**
- 超限返回 `429`，错误码 `coach_quota_exceeded`，响应附 `{ limit, used, resets_at }`
- 计数落库，进程重启不丢；表结构 `coach_usage(user_id, day, turns_used, updated_at)`，主键 `(user_id, day)`
- 每日按 **UTC+8 零点**重置；v1 固定时区，不按用户所在时区计算
- `daily_turn_limit = 0` 表示不限量

管理后台接口（`X-Admin-Token`）：

```json
GET  /api/admin/settings/coach
{ "daily_turn_limit": 100, "enabled": true }
```

```json
PUT  /api/admin/settings/coach
{ "daily_turn_limit": 100, "enabled": true }
```

App 启动场景页前读取当前用户用量（需用户 JWT）：

```json
GET /api/coach/quota
{
  "limit": 100,
  "used": 4,
  "remaining": 96,
  "resets_at": "2026-09-28T00:00:00+08:00",
  "enabled": true,
  "llm_configured": true
}
```

`enabled` 表示是否启用每日配额，`false` 不是关闭 AI 陪练；`enabled=false` 或 `limit=0` 都表示不限量，此时 `remaining=null`。`llm_configured=false` 时 App 禁用开始并提示管理员配置模型。

复用现有 `admin_settings` KV，新增键 `coach`；非法值夹取到 `0–100000`。

### 4.7 面试模拟与材料解析

面试不是新的「场景类型」，而是 **面试场景 × 材料上下文** 的组合：

| 上传内容 | 面试官行为 |
|----------|------------|
| 只有简历 | 深挖经历：项目细节、技术选型、自称「主导」的部分 |
| 只有职位 | 按岗位要求提问：能力项、场景题、匹配度 |
| 两者都有（推荐） | 针对该岗位面这个人，追问差距项 |

#### 三段式流程（为什么必须拆开）

材料导入不是「把材料喂给模型」，中间要留一道**用户校对与清理**的闸门：

```
文件 / 图片 ──► 文本 ──►【用户校对 + 删除敏感信息】──► 结构化档案 ──► 面试
```

拆开有两个理由：

1. **可校对**：照片和 PDF 的识别一定有错，英文姓名、时间、数字最容易错——而这些恰恰是面试官会追问的东西。
2. **可删除**：图片里的电话、邮箱无法在图片上剥离；但一旦识别成文本，用户自己一秒就能删掉。**这是唯一真正可行的隐私路径。**

代价是多一次 LLM 调用（识别一次 + 结构化一次）。导入一份材料约消耗 2 次配额，App 在开始前明示。

#### 接口一览

| 接口 | 输入 | 输出 | 配额 |
|------|------|------|------|
| `/interview/text` | multipart：`docs`（PDF/DOCX）或 `images`（JPEG/PNG） | 纯文本 | 文档 0 / 图片 1 |
| `/interview/profile` | 编辑后的文本 | 紧凑档案 | 1 |

只有两个接口。**图片不是一条独立管线，只是同一接口的另一个输入分支**——比上传文件多一次识别调用而已。

#### `POST /api/coach/interview/text`（multipart，配额按输入类型区分）

客户端只提交文件字节，**不自己做 base64**（省掉 33% 膨胀，也少一层 App 逻辑）：

| 字段 | 内容 | 配额 |
|------|------|------|
| `docs` | PDF / DOCX 文件 | 不耗 |
| `images` | JPEG / PNG，最多 5 张 | 1 |

- 输出：`{ text, char_count, likely_scanned, source }`，`source` ∈ `document` / `image`
- **文档路径**：纯文本抽取，不调用 LLM；`char_count` 低于阈值时置 `likely_scanned: true`，App 据此提示改用图片
- **图片路径**：走视觉模型，prompt 明确要求「逐字转录，不要总结、不要改写、不要补充」
- 两条路径产出**同一个东西**——待用户编辑的纯文本
- **不做服务端 PDF 转图片**（要引入 mupdf / pdfium，不值得）
- 文件只在内存中处理，不落盘
- 路由需要单独放开 Axum 的 `DefaultBodyLimit`（默认 2MB）

图片约束：最多 5 张，单张压缩后 ≤ 1MB，合计 ≤ 4MB；App 端压到长边 1600px、JPEG 质量 70。识别结果直接返回给用户编辑，**服务端不保存**。

#### `POST /api/coach/interview/profile`（JSON，**耗 1 次配额**）

```json
{ "kind": "resume", "text": "<用户确认过的文本>" }
```

- 输出：`{ profile }`；紧凑结构化档案（约 600–800 字：核心经历 / 技术栈 / 量化成果 / 待追问点）
- 走**文本模型**（不再需要视觉），输入是用户编辑后的文本
- `kind` 枚举：`resume` / `job`
- 文本上限 20,000 字符

**顺序很重要**：`profile` 收到的永远是用户确认过的文本。图片和原文在生成档案之后就不再参与任何环节。

#### 视觉请求格式（已核对 DeepSeek API 参考）

`content` 使用 OpenAI 兼容的 content parts 数组：

```json
{ "role": "user", "content": [
  { "type": "text", "text": "<prompt>" },
  { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,...", "detail": "high" } }
] }
```

- 支持格式：JPEG / PNG / GIF / WebP；App 统一压成 JPEG
- `detail` 用 `high`——`low` 会丢小字号文字，简历识别不能用
- 图片以 base64 内联传递，**不落对象存储**，避免把简历图片持久化

#### 视觉能力是模型相关的（重要）

已核对的 DeepSeek 现状：`deepseek-flash` 支持 Vision，`deepseek-v4-pro` **不支持**。

由于 `base_url` / `model` 由管理员配置，后端无法预知当前模型是否支持视觉，因此：

- 不新增 `vision_model` 配置项，也不硬编码模型名白名单
- 当上游返回「不支持图片内容」类错误时，映射为 `422` + `reason: "vision_not_supported"`，而不是笼统的 400
- App 据此提示：「当前模型不支持图片识别，可以改用粘贴文本，或让管理员换成支持视觉的模型（如 deepseek-flash）」

#### `/turn` 与 `/summary` 的面试上下文

两个接口增加可选字段：

```json
{ "scenario": {}, "interview": { "kind": "resume", "profile": "..." }, "history": [], "user_text": "..." }
```

- `interview` 可选；带上时给面试官 prompt 追加面试维度（STAR 追问、量化成果、技术细节）
- `kind` ∈ `resume` / `job` / `resume_job`；`resume_job` 表示 App 已把两份经用户确认的紧凑档案合并，后端只把它当数据标签
- `profile` 上限 3,000 字符；简历和目标职位都上传时，App 用 `[RESUME PROFILE]` / `[JOB PROFILE]` 标记合并，不发送原始材料
- **每轮只发紧凑档案，不发简历原文、不发图片**——省 token，也让图片只在提取阶段出现一次
- 面试总结额外评估：是否用了 STAR 结构、成果是否量化、哪些回答经不起追问

### 4.8 错误与鉴权

- 全部接口走现有用户 Bearer JWT 中间件
- 未配置 LLM：返回 `503`，App 显示「AI 陪练暂不可用，请联系管理员配置模型」
- 超出每日配额：返回 `429`，App 显示剩余次数与重置时间（见 §4.6）
- LLM 上游超时：返回 `504`，App 保留当前会话可重试
- 统一 `{ success, data }` 信封，与现有 API 一致

## 5. App 端技术实现

### 5.1 语音识别（STT）

内置两种可选引擎：

- **系统识别**：iOS `SFSpeechRecognizer` / Android `SpeechRecognizer`，无需密钥。
- **Google Cloud STT**：客户端 BYOK，用户粘贴自己的服务账号 JSON；App 本地签发短期 OAuth token，调用 Speech-to-Text V2 `recognize`。
- **Gemini 转写**：客户端 BYOK，用户填写自己的 Gemini API Key；App 录音后将短音频直接发送到 Gemini Interactions API 做逐字转写。密钥只保存在本机，不进入后端同步。

Google Cloud STT 不接受普通 API Key，只支持服务账号/OAuth。上述 Google 凭据都属于客户端密钥，无法对高级用户完全保密，因此界面会明确提示用户使用个人额度并自行管理。

以 `expo-speech-recognition@57.1.0` 为例：

```ts
ExpoSpeechRecognitionModule.start({
  lang: 'en-US',
  interimResults: true,
  continuous: false,
  addsPunctuation: true,
  requiresOnDeviceRecognition: false,
  volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
  iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'measurement' },
  recordingOptions: { persist: false },
});
```

要点：

- `interimResults: true` 用于实时字幕；`isFinal` 后作为用户发言提交
- `continuous: false` 让系统在说完后自然收敛（iOS 17- 静音 3 秒结束；iOS 18+/Android 收到 final 即结束）
- 额外提供手动停止按钮和「说完了」提交，避免系统不收敛
- `volumeChangeEventOptions` 的 `volumechange`（-2…10）驱动麦克风音量环，代表 App 在「听」
- `recordingOptions.persist: false` 确保不落音频文件
- `requiresOnDeviceRecognition` 默认 `false`（识别质量优先）；隐私模式下可开启，并用 `supportsOnDeviceRecognition()` 检测能力，不支持时回退并提示
- 用 `requestPermissionsAsync()` 预先请求；区分「麦克风权限」与「语音识别权限」两类拒绝，分别给引导文案

### 5.2 语音合成（TTS）

- 默认走已有 `moyan-app/src/lib/speech.ts`，底层是 `expo-speech`：**免费、设备端、无网络请求**
- 复用用户已有的语速/音色设置；若用户选了 ElevenLabs / Google / 阿里云，仍按现有逻辑走 HTTP 合成（用户自带 Key，不新增 Moyan 成本）
- **口音 → 音色映射**：`en-*` 用 `speech_voice`，`zh-CN` 用 `speech_zh_voice`。这就是「中文口音英文」的全部实现——不额外调 LLM，不额外花钱
- 播放前先 `setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })`，否则 iOS 静音开关会导致无声
- 打断：说话中点击麦克风调用 `Speech.stop()` 并立即进入 STT
- 用 `onDone` / `onStopped` / `onError` 回调驱动头像状态机和字幕高亮

### 5.3 会话状态机

```
idle → listening → thinking → speaking → listening
                  ↘ error → idle
```

- `listening`：STT 运行中，头像「倾听」状态 + 用户音量环
- `thinking`：请求 `/turn`，头像「思考」状态，显示省略号
- `speaking`：TTS 播放中，头像口型/波纹随播放推进
- 任意状态可「结束会话」进入总结
- 失败可重试本轮，不丢历史

### 5.4 头像

- `react-native-svg` 画半身扁平形象 + RN 内置 `Animated` 做动画（**不引入 reanimated/lottie，避免新增原生依赖**）
- 状态：呼吸（idle）、点头/侧耳（listening）、轻微停顿（thinking）、口型开合 + 声波（speaking）
- 情绪：`mood` 切换眉毛/眼角/嘴形，配合 `encouraging`、`concerned` 等
- `AccessibilityInfo.isReduceMotionEnabled()` 为真时关闭动画，只保留静态表情
- 形象后续可替换为插画资源，组件接口不变
- 视觉风格约束见 §6.6
- 组件接口预留可替换形象：`CoachAvatar` 接受 `svg`（v1）或 `video` 源，v2 可换成预渲染循环视频而不改调用方
- v2 可选：**预渲染状态循环视频**（idle / 倾听 / 思考 / 说话四段，风格化 2D，非写实），用 `expo-video@~57.0.5` 的 `useVideoPlayer` + `VideoView` 播放，`player.loop = true`、`player.muted = true`（声音仍由 `expo-speech` 出）。运行时零成本，成本只在一次性制作与 App 体积
- v2 视频头像**不做精确唇形同步**：预渲染循环无法匹配任意 TTS 文本，强行追求同步会进入「逐句生成视频」的昂贵路线

### 5.5 权限与原生工程

- 在 `app.json` 的 `plugins` 增加 `expo-speech-recognition`，配置 `microphonePermission` / `speechRecognitionPermission` 文案（中英）
- `ios/`、`android/` 为 gitignored，由 CNG 重新生成，不改原生工程文件
- 首次使用前请求权限；被拒后给出「去系统设置开启」的引导
- 需要在真机验证：iOS 模拟器与 Android 模拟器的语音识别能力都不完整

## 6. 前端 UX

### 6.1 入口与 Tab 结构

**AI 陪练占底部 Tab 的第 2 位，同时把词库移出 Tab**——Tab 总数保持 5 个，不新增。

| 位置 | Tab | 说明 |
|------|-----|------|
| 1 | 首页 | 不变 |
| 2 | **陪练** | 新增。**替换**原「词库」的位置，而不是追加 |
| 3 | 播客 | 不变（由 `podcast.app_enabled` 条件显示） |
| 4 | 统计 | 不变 |
| 5 | 设置 | 不变 |

**为什么把词库移出去**：直接追加会变成 6 个 Tab。390px 宽、左右各 24px 内边距下每项只剩约 57px，没有余量——以后任何一个标签变长或再加一个都会挤坏。移出词库后每项回到约 68px，与现状一致。

**词库去哪儿**：改成全屏路由 `/decks`（在 `(tabs)` 之外），入口是首页「每日必修」卡片上的「选择词库」。

这顺带消掉一个已有的重复：现在**选词库有两个入口**——首页 CTA 弹出的选择弹层，和词库 Tab 页。合并成一个全屏页面后：

- 删除 `HomeScreen` 里的 `showPicker` / `Modal` 相关代码
- 首页 CTA 从「打开弹层」改为「跳转 `/decks`」
- 全屏页面沿用现有 `(tabs)/decks.tsx` 的内容，加返回按钮

> **这是对现有信息架构的改动**，会影响老用户的肌肉记忆（点第 2 个 Tab 期望是词库，实际是陪练）。
>
> **2026-09-27 已确认采用方案 A（词库改为全屏页面）。** 被否掉的备选记录在此以备回溯：保留词库 Tab，把「统计」移出——首页已经展示核心统计（总词汇量、今日浸润、4 张统计卡），统计页更多是趋势详情。

- Tab 图标：说话气泡 + 小脸（沿用 `TabIcons.tsx` 的线条风格）。**不能复用播客的麦克风**——两个 Tab 图标相同会分不清
- Tab 根页就是场景选择页：页头用其他 Tab 根页的写法（`screen.header` + `screen.headerTitle`），**没有返回按钮**
- 今日次数从独立卡片收进页头（`今日 96 / 100` 胶囊）：底部有 Tab 栏，纵向空间更紧
- **首页不放入口卡**：Tab 已经是入口，两者并存是重复的，也会和「每日必修」主 CTA 抢层级

路由结构（会话等页面在 `(tabs)` 之外，推进时隐藏 Tab 栏——与 `/study/[deckId]` 的做法一致）：

```
src/app/(tabs)/coach.tsx        场景选择（Tab 根页）
src/app/decks.tsx               词库（全屏，从首页「选择词库」进入）
src/app/coach/session.tsx       会话（全屏）
src/app/coach/summary.tsx       总结（全屏）
src/app/coach/editor.tsx        场景编辑器（全屏）
src/app/coach/interview/*.tsx   面试入口 / 材料 / 档案 / 复盘（全屏）
src/app/coach/history.tsx       历史练习（全屏）
```

> 两端的入口结构不一样，不要照抄：
>
> | 功能 | `moyan-web` | `moyan-app` |
> |------|-------------|-------------|
> | 打字训练 | 首页卡片 | **App 没有这个功能** |
> | 播客 | 首页卡片 | **底部 Tab**（由 `podcast.app_enabled` 条件显示） |
> | 词库 | 顶部导航 | **全屏页面**，从首页进入（本次改动） |
> | AI 陪练 | —（v1 不做） | **底部 Tab + 全屏子页面**（本设计） |

App 为 `orientation: portrait`，所有布局按竖屏设计，不引入屏幕旋转依赖。

### 6.2 场景选择页

- 「预置场景」区：8 张卡片，按 **日常与协作 / 工程沟通 / 高压场景** 三组展示，标出难度、预计轮数和 AI 同事口音；可「复制为我的场景」
- 「我的场景」区：用户自定义场景；右上角「新建」，卡片可编辑 / 删除
- 底部「最近练习」列表（本地历史，只回看总结，不支持断点续聊）
- 顶部显示今日剩余次数与上限；用尽时禁用开始按钮并显示重置时间
- LLM 不可用时禁用开始按钮并显示原因

### 6.3 场景编辑器

两条创建路径：

- **AI 生成草稿（默认）**：输入一句中文描述（如「练一下线上故障时给美国同事同步进展」）→ 调 `/api/coach/scenario/draft` → 生成结构化字段 → 在表单里修改 → 保存
- **从模板开始**：内置程序员 / 远程协作模板（故障同步、需求估时、跨时区协作、和主管谈成长等），选一个再改
- **手动填写**：直接填标题、描述、AI 姓名 / 职位 / 语气、场景类型、开场白、练习重点（最多 5 个）、难度、轮数

其他规则：

- 预置场景只读，通过「复制为我的场景」进入编辑器
- 表单就地校验并提示限长；`max_turns` 夹取到 3–20
- 保存到本机（AsyncStorage），立即出现在「我的场景」
- 支持编辑与删除；删除场景不影响已保存的历史总结
- 界面提示：场景描述会发送给模型，不要写入公司机密或个人信息

### 6.4 材料确认页（面试场景）

不管是拍照、上传文件还是粘贴，**都汇到同一个可编辑文本框**再往下走：

1. 顶部：材料类型（简历 / 职位）
2. 文本编辑框：识别结果，可直接改；右下角显示字数
3. 敏感信息提示条：正则匹配到的疑似手机号 / 邮箱 / 身份证号列出来，右侧「一键删除这 N 处」——**点了才删，不自动处理，也不阻断继续**
4. 固定风险提示：「识别可能有误，请核对姓名、时间、数字。敏感信息检测为尽力而为，可能有遗漏。」
5. 底部主按钮「生成面试档案」；次要入口「重新识别」
6. 生成后进入档案预览（同样可编辑），确认后才开始面试

图片在这一步之后就删除；继续往下走的只有编辑过的文本。

### 6.5 会话页（竖屏）

- 顶部：场景名 + 本场剩余轮数 + 今日剩余次数 + 结束按钮
- 中部（约 55% 高度）：AI 同事头像磁贴；右下角小窗显示用户麦克风音量环
- 头像下方：当前 AI 字幕（可点「重听」）
- **AI 每句话下方跟一行中文对照**（`reply_zh` / 开场白用 `opening_line_zh`）：小一号、弱化色，朗读仍然只用英文原文；**用户自己说的话不翻译**（自己说的不用译）
- 用户区：实时识别文本（interim 用浅色，final 用常规色）
- 底部控制条：麦克风开关（主按钮）、键盘输入、反馈模式切换、静音/停止朗读
- 反馈面板：不再单列一块，改为**贴在用户那条消息气泡内部**（细分隔线 + 「更自然的说法」小标题），默认展开、可点标题折叠成一行预览；纠错/更自然的说法就在这里
- 底部面板：展示**「接下来可以怎么说」**——针对最新一条 AI 回复给出的 `next_lines`（最多两条，可直接照说、点一行朗读）。它讲的是下一句，不重复任何已经出现在消息里的内容。**反馈模式与沉浸模式都显示**（它是聊天辅助而不是纠错，所以不受「沉浸模式只聊天」那条约束）；面试模式下不显示
- 键盘弹出时保持头像磁贴可见，避免布局跳动

### 6.6 总结页

- 本次数据（轮数、纠错数、时长）
- 亮点 / 待改进 / 推荐句型（带朗读按钮）
- 「再来一次」「换个场景」「保存到本地历史」
- 支持同一场景 12 小时内的会话草稿恢复；未收到回复的最后一轮会显示为重试，不直接续写

### 6.7 视觉与交互一致性（硬约束）

`/coach` 必须看起来是 Moyan 原生的一部分，不是嵌进来的第三方功能。

**颜色**

- 所有颜色取自 `useTheme().theme.colors`，禁止硬编码色值（阴影除外）
- 必须在 6 套主题下走查：`xuanzhi`、`shenyemo`、`dailan`、`fense`、`ios`、`ios-dark`
- 页面底色分工：
  - 场景选择、场景编辑器、总结页 → `paper` / `card` / `ink` / `border`，与 Home、Decks 同族
  - 会话页 → `studyBg` / `studyCard` / `studyText` / `studyMuted`。Study 页已经在用这套深色沉浸面，所以它属于应用既有语言，不是为陪练新造的风格

**版式与组件**

- 复用 `moyan-app/src/lib/ui.ts`：`screen.container` / `screen.header` / `screen.headerTitle` / `screen.body`、`cardStyle()`、`roundButton`、`serif`
- 沿用现有尺寸：水平内边距 20–24、卡片圆角 16、卡片内边距 20、页头标题 24/700
- 页头统一「返回 + 标题 + 右侧操作」，与 Study、Podcast Player 等二级页一致
- 列表行、`Switch`、选择器等沿用 Settings 页既有样式，不新造控件体系

**图标与形象**

- 不引入图标库（当前 App 没有 `@expo/vector-icons` / lucide）。新增图标按 `TabIcons.tsx` 的手绘线条风格：24×24 viewBox、`strokeWidth 1.8`、圆头圆角
- AI 头像同样用水墨线条绘制，与图标共用一套笔触，不用写实人物或 emoji；延续现有图标里的「小脸」母题
- 表情只做眉 / 眼 / 嘴的线条变化，保证在深浅主题下都有足够对比

**动效**

- 只用 RN 内置 `Animated`，幅度克制，服务于状态反馈（倾听、思考、说话），不做常驻无意义晃动
- `AccessibilityInfo.isReduceMotionEnabled()` 为真时全部关闭，只保留静态表情

**文案与状态**

- 所有文案走现有 `useI18n()` / `translations.ts`，中英双语齐备，不出现硬编码中文
- 空态、加载态、错误态、禁用态与现有页面一致；提示复用 `lib/toast.tsx`
- 用词沿用应用既有称谓；新功能统一叫「场景」「练习」「纠错」

**设计稿**

- 页面设计稿：`moyan-app/design/coach/index.html`——单文件、25 屏，分六组：陪练 Tab 与基础流程 / 面试模拟 / 面试成果与导入异常 / 会话状态 / 历史与设置 / 状态与降级
- 可切 4 套主题（宣纸白 / 神野墨 / iOS / iOS Dark）、3 种会话状态（倾听 / 思考 / 说话），以及「对比度修正 前 / 后」对照
- 深链参数：`?theme=shenyemo&state=listening&contrast=after`；`?only=14` 只显示第 14 屏，便于放大评审单屏
- 实现前先在设计稿上确认版式，再按同一套 token 落到 App 代码

**验收**

- 交付前在浅色（`xuanzhi`）与深色（`shenyemo` 或 `ios-dark`）各截关键页面，与 Home / Study / Settings 并排比对

## 7. Prompt 与成本

- 系统 prompt 固定注入场景、人物设定、难度和输出 JSON schema；历史按轮次拼接
- 预置场景在服务端附带程序员 / 远程协作专属 `guidance`（如连接不良时如何请对方重复、如何礼貌打断、如何为估时争取范围），不随客户端下发
- 每轮只请求一次 LLM（回复 + 反馈合并为同一个 JSON），不做「先回复再单独纠错」的两次调用
- **TTS 与 STT 均为设备端，无服务端音频成本**
- 参考量级：10 轮会话，每轮输入约 1.5–2k tokens、输出约 300–500 tokens；按廉价模型估算，单次会话约为数字人方案的百分之一量级。具体金额按实际配置模型定价核算
- 成本护栏：轮数上限、字符上限、`max_tokens` 上限；单用户每日用量上限默认 100，管理后台可改（见 §4.6）
- **面试材料**：图片识别只在提取阶段发生一次，之后每轮只带紧凑档案，成本与普通场景相当。DeepSeek Flash 输入约 $0.15 / 1M tokens（off-peak cache miss）量级，单次简历提取远低于 1 分钱。价格需在接入前复核

## 8. 隐私与安全

- 不录制、不上传、不存储音频：`recordingOptions.persist: false`，App 端不留音频文件
- **注意**：`requiresOnDeviceRecognition: false` 时，音频由操作系统语音服务（Apple / Google）处理，可能离开设备；Moyan 服务端不接收音频。默认在首次使用时如实告知，隐私模式下可强制 `requiresOnDeviceRecognition: true`
- 对话文本只存本地；每次 `/turn` 仅把当前会话历史发给后端与 LLM
- 界面提示：不要输入公司机密或个人信息；自定义场景描述同样会发送给 LLM
- 后端日志只记长度、轮数、耗时、错误类型，不记完整对话内容
- 复用现有 LLM 配置的 `api_key`，不新增 App 可见密钥
- 单用户每日用量配额作为滥用保护（见 §4.6）

### 8.1 面试材料（简历 / 职位）

**App 只做提示，不做拦截。** 简历里的电话、邮箱、身份证无法可靠地在客户端剥离——图片里就是几个像素，文本里也总有各种写法。做「自动脱敏」只会给出虚假的安全感，本设计明确不做。

首次上传时如实告知，需用户确认：

- 简历内容或图片**会发送给模型服务**用于识别与提取
- 若材料含敏感信息，建议先把文字识别出来、自己删改；App 不会替你过滤

**可行的隐私路径**（三步，见 §6.4）：

1. 图片只用于识别，识别完立即删除本机图片（图片只是 `/interview/text` 的一个输入分支）
2. 识别结果以**可编辑文本**呈现，用户在这里自行删除敏感信息——这是唯一真正可行的时机，因为图片上删不掉、文本上很容易删
3. 档案由用户确认过的文本生成；图片和原文此后不再参与任何环节

App 提供「一键删除疑似手机号 / 邮箱 / 身份证号」，但**点了才删**，不自动执行、不阻断提交、不保证检测完整。

App 与后端**实际能保证**的部分（可执行、可测试）：

- 服务端不持久化上传文件与原文，`/interview/text` 只在内存中处理
- 服务端日志不记录材料内容，只记字节数、耗时、错误类型
- 图片以 base64 内联传给模型，不落对象存储
- 提取完成后立即删除本机图片文件，只保留结构化档案
- 档案只存本机，可一键删除
- 同时提供「粘贴文本」路径作为替代选择

可选、尽力而为的提示（不保证准确，**不阻断提交**）：粘贴文本时用正则匹配疑似手机号 / 邮箱并高亮「建议删除」，用户可直接忽略继续。

## 9. 测试策略

- Rust 单元测试：场景查找、prompt 构造、LLM 返回解析（含非法 JSON、缺字段、越界）、长度与轮数护栏
- Rust 场景校验测试：逐字段限长、`max_turns` 夹取、`focus_points` 数量上限、客户端伪造 `guidance` / prompt 字段被忽略、预置 `scenario_id` 覆盖逻辑
- Rust 路由测试：未鉴权 401、字段超限 400、消息超限 400、LLM 未配置 503、草稿生成解析失败时降级
- Rust 配额测试：当日计数累加、跨日按 UTC+8 重置、超限 429 且不调用 LLM、`0` 表示不限量
- Rust 管理端测试：`X-Admin-Token` 校验、读写 `coach` 设置、非法值夹取
- Rust 材料解析测试：DOCX 解压取文、文字版 PDF 抽取、文本量低于阈值时置 `likely_scanned`
- Rust 视觉请求测试：content parts 组装正确（文本 + 多张 `image_url` + `detail: high`）；上游报「不支持图片」时映射为 422 `vision_not_supported`
- Rust 隐私测试：`/interview/text` 与 `/interview/profile` 的日志中不含材料样本身份串
- App 材料测试：图片压到长边 ≤ 1600 且为 JPEG、超过 5 张报错、提取成功后删除本地图片
- App 单元测试：会话状态机、历史裁剪、STT 不可用/权限被拒降级、反馈渲染、本地历史读写、自定义场景增删改与限长校验
- 视觉一致性检查：新增页面无硬编码色值、6 套主题下走查对比度、浅色与深色主题各截关键页面
- 真机手工验证（模拟器不可靠）：iOS 与 Android 各一台，麦克风授权、识别准确度、TTS 在静音开关下可听、打断、蓝牙耳机、弱网超时重试
- 回归：确认新增 config plugin 后现有 podcast/study 的音频播放不受影响

## 10. 里程碑

1. **M1 后端**：`/scenarios`、`/scenario/draft`、`/turn`、`/summary` + 通用 chat + 场景校验 + 用量配额 + 测试
2. **M2 管理后台**：设置页新增「AI 陪练」区块，读写每日上限
3. **M3 App 文字版**：`/coach` 路由、场景选择、文字对话、逐轮反馈、总结页、配额展示
4. **M4 场景自定义**：场景编辑器、复制预置场景、本地存储、AI 生成草稿
5. **M5 语音与头像**：接入 `expo-speech-recognition`、TTS 播放与打断、SVG 头像、状态机、权限流程
6. **M6 打磨**：本地历史、i18n、真机验证、EAS 构建

M1+M3 完成后即可内测（文字版）；M5 是核心体验升级。M5 需要一次原生重建，需提前安排构建时间。

### 第二阶段：面试模拟（v1.5）

7. **M7 后端材料处理**：`/interview/text`（文档抽文本 / 图片走视觉识别，两条分支同一接口）+ `/interview/profile`（文本 → 档案）+ 视觉能力错误映射 + 测试
8. **M8 App 材料导入**：拍照 / 选图 / 选文件、压缩、**可编辑的材料确认页（含一键删除疑似敏感信息）**、档案预览与编辑、删除原图
9. **M9 面试场景**：3 个面试官预置场景（HR 初筛 / 行为面 STAR / 技术深挖）、`interview` 上下文注入 `/turn` 与 `/summary`、面试专属总结维度

M8 需要 `expo-image-picker` 与 `expo-image-manipulator`，和 M5 的 `expo-speech-recognition` 同批做原生重建，不额外增加构建次数。

## 11. 默认决策（评审时可改）

| 决策 | 默认 |
|------|------|
| 平台 | v1 只做 App（iOS + Android），不做 Web |
| 预置场景 | 8 个，程序员 / 远程协作向，只读，可复制为自定义 |
| 自定义场景 | v1 支持，存本机，可增删改 |
| 自定义场景同步 | v1 不同步，跨设备同步放 v2 |
| AI 生成场景草稿 | v1 支持，一次额外 LLM 调用 |
| 逐轮反馈 | 默认开启，可切「沉浸模式」 |
| 会话历史 | 只存 App 本地；进行中的会话支持短时草稿恢复，总结历史仅用于回看 |
| 用户摄像头 | v1 不启用，只显示麦克风音量 |
| 头像方案 | SVG + RN `Animated`，不引入 reanimated/lottie |
| 视觉风格 | 复用现有主题 token 与水墨线条母题，不引入新设计体系、不加图标库 |
| 端侧识别 | 默认关闭，隐私模式可强制开启 |
| 每日额度 | 默认 100 次 / 用户 / 天（按发言轮次计），管理后台可改，`0` 表示不限 |
| 配额重置 | UTC+8 每日零点 |
| 面试模拟 | v1.5，与基础陪练共用 `/turn`、`/summary` 管道 |
| 材料格式 | 粘贴文本 + PDF(文字版) + DOCX + 图片(JPEG 压缩后) |
| 图片识别 | 已配置的视觉模型，**只做逐字识别**；不引入传统 OCR 服务 |
| 材料导入流程 | 取文本 → 用户编辑确认 → 生成档案；图片比文档多一次识别调用（约 2 次配额） |
| 口音集合 | `en-US` / `en-GB` / `en-IN` / `en-AU` / `zh-CN`（后者=中文母语者说英文） |
| 陪练入口 | 底部 Tab 第 2 位（替换原词库位置），Tab 总数保持 5 |
| 词库入口 | 移出 Tab，改为全屏页面，从首页「选择词库」进入（已确认） |
| AI 说中文 | v1 不做。那是语言开关，不是口音，会改变整个产品定位 |
| 不支持视觉的模型 | 不预置白名单，运行时按上游错误映射为 `vision_not_supported`，App 给出替代方案 |
| 敏感信息 | App 提供高亮与「一键删除疑似项」，需用户点击；不自动、不阻断、不保证完整 |
| 简历原文与图片 | 服务端不持久化；提取后删除本机图片，只保留结构化档案 |
| 发音评分 | v1 不做 |
