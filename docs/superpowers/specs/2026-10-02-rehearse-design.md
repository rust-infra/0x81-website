# Rehearse（职演）独立产品设计

日期：2026-10-02
状态：待确认
上游：`2026-09-27-moyan-ai-speaking-coach-design.md`（现有实现即出自此稿）
现状锚点：`4aecb07 feat(moyan): AI speaking coach — backend, mobile app, admin settings (#12)`

## 1. 决策摘要

把墨言的 AI 职场英语陪练拆成独立产品 **Rehearse / 职演**，定位从「英语口语陪练」升格为 **职场演练**：为一次具体的职场「演出」做准备——面试、晋升答辩、汇报、高压对话。语言（中文 / 英文）是场景的一个属性，不是产品定位。

| 决策 | 结论 |
|------|------|
| 是否拆 | **拆**。理由见 §2 |
| 定位 | 独立产品：职场演练，中英双语对等 |
| 平台 | **只做 App**（iOS + Android），不做 Web。材料校对的手机端摩擦在 App 内解决（§10） |
| 后端 | **独立服务 `rehearse-backend`，用 Go 重写**（2026-10-02 决定）。进程、语言、镜像都与墨言后端分开 |
| 数据库 | **共享同一个 SQLite 文件**，表按归属划分（§7.3） |
| 认证 | **Rehearse 只验 token，不签发**：登录入口统一为 `auth.0x81.uk`（§7.4，详见 `2026-10-02-gateway-auth-design.md`） |
| 账号 | 共享 0x81 账号体系：同一 `users` 表；建号逻辑只有认证服务一份（§9.1） |
| 仓库 | 同仓新增 `rehearse-app/` 与 `rehearse-backend/` |
| 墨言侧 | 删净 coach 代码（App 侧 + Rust 侧）与四个原生依赖；**撤销**上游稿 §6.1 的「词库移出 Tab」改动 |

## 2. 为什么拆

不是「太大了」这种体感判断，有四条硬理由。

### 2.1 两套用户、两套动机

| | 墨言 | Rehearse |
|---|---|---|
| 核心循环 | 每天背词 / 打字 | 为一次具体事件做准备 |
| 频率 | 高频、轻、碎片化 | 低频、重、有 deadline |
| 留存机制 | 连续天数、词汇量增长 | 结果焦虑（面试就在下周三） |
| 付费点 | 词库 / 去广告 / 沉浸时长 | 材料解析、模拟次数、复盘报告 |
| 通知策略 | 每日提醒「该练了」 | 倒计时「还有 3 天」 |

塞在一个 App 里，Tab 位、通知策略、付费点会持续互相打架。

### 2.2 设计已经被功能倒逼过一次

上游稿 §6.1 为了让陪练占 Tab 第 2 位，把词库移出 Tab 改成全屏页，还删掉了首页原有的选词库弹层。这是「一个 App 装不下」的典型信号——下次再加功能还得挪一次。

### 2.3 后端耦合极浅

coach 只依赖三样东西：`llm_client`（通用 chat）、`admin_settings` 的 `llm` 键、JWT 中间件。与词库 / 打字 / 错题本**零交集**。真正的共享面只有 LLM 配置和用户体系——这两样恰好也是 Rehearse 独立后必须自带的东西。

### 2.4 名字本身就是定位

「职演」= 职场演练。比「墨言 AI 陪练」精确，且能自然容纳面试、答辩、绩效沟通、周会汇报。挂着词汇 App 的牌子反而是天花板——用户不会为了模拟面试去装一个背单词软件。

### 2.5 体量事实

| 位置 | 体量 |
|------|------|
| `moyan-app` coach 相关 | **8,267 行 / ~45 文件**（9 路由 + 8 组件 + 28 lib 模块，含 14 个测试文件） |
| `moyan-backend` coach 相关 | **2,473 行 / 7 文件** + 迁移 `011_coach_usage` |
| `moyan-admin` | SettingsPage 一个区块 |
| 原生依赖 | `expo-speech-recognition`、`expo-image-picker`、`expo-image-manipulator` |
| 新增权限 | `CAMERA`、相册读取、`RECORD_AUDIO`、语音识别 |

合计 **~10.7k 行**，是一个完整产品的规模。

### 2.6 窗口期：现在拆最便宜

`moyan-app` 的 bundle id 仍是 `com.anonymous.moyanapp`（Expo 脚手架占位符），判断**尚未上架**；coach 功能当天刚合入 `main`。这意味着：

- **没有已发布客户端**，不存在版本兼容负担——路由、表名、字段名可以自由重命名，不需要双写或灰度
- 迁移成本只会随时间上升：一旦上架，`/api/coach/*` 就得长期保留别名，`coach_usage` 表就得一直叫这个名

**这是决定性的窗口。晚拆一个月，成本翻倍。**

## 3. 定位与边界

### 3.1 一句话

> 职演 Rehearse —— 在你真正开口之前，先演一遍。

### 3.2 与墨言的关系

```
                     0x81 账号体系（共享 users 表 / JWT）
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
   墨言 MoYan                      职演 Rehearse
   词汇 / 打字 / 播客               职场演练
        │                               │
        └── 首页导流卡 ────────────────►┘
            （不是 Tab，是引流位）
```

- **不共享 UI 代码**，只共享账号与后端进程
- 墨言首页放一张导流卡（「要去面试？去职演练一遍」），点击 deep link `rehearse://`，未安装则跳商店
- 反向：Rehearse 不做「去背单词」的导流——那不是它的用户旅程

### 3.3 要做（v1）

- 独立 App `rehearse-app`（iOS + Android），搬现有 coach 全部能力
- **中英双语对等**：每个场景可选手动切换演练语言（§4）
- 场景族从「程序员 / 远程协作」扩为四大族共 14 个预置场景（§5）
- 材料上下文从「面试专属」泛化为**任意场景可挂**（§5.3）
- 共享 0x81 账号，墨言用户装完直接登
- 管理后台独立区块，配额与 LLM 开关独立于墨言

### 3.4 明确不做（v1）

- **Web 端**（2026-10-02 明确不做，见 §10——材料导入的摩擦改为在 App 内解决）
- **Rehearse 不实现任何登录**：不写 OAuth、不签发 JWT、不建号。登录是 `auth.0x81.uk` 的事（§7.4）
- **墨言特有的登录入口不进 Rehearse 的视野**：Kimi 设备码、Telegram Mini App 都留在认证服务里，与 Rehearse 无关
- 视频 / 数字人 / 唇形同步（沿用上游稿结论，成本高一到两个数量级，只买沉浸感）
- 音素级发音评分
- 多人群面模拟（真人或 AI 多人）
- 社区分享 / 场景市场
- 跨设备同步演练历史（v1 仍只存本机）
- 摄像头（只用于拍摄纸质简历/材料，不做视频模拟）

## 4. 语言维度（最重要的模型改动）

### 4.1 现状是个焊死的假设

上游稿 §4.2 把口音塞在 `persona.locale` 里，并明确写：

> 关于 `zh-CN`：它表示「中文母语者说英文」，不是「AI 说中文」。
> 若要做「AI 直接用中文回答」，那是**语言**开关而非口音，v1 不做（见 §11）。

这条在「英语陪练」定位下是对的。但**职演的主场是中文**——国内求职者的面试、答辩、绩效沟通绝大部分用中文。语言必须是顶层开关。

### 4.2 拆成两个正交字段

```jsonc
{
  "language": "zh-CN",        // 顶层：决定 AI 说什么语言、STT 听什么、TTS 用什么音色
  "persona": {
    "name": "陈磊",
    "role": "技术总监",
    "accent": null,           // 仅 language 为英文时生效；null 表示不指定
    "tone": "direct"
  }
}
```

| 字段 | 取值 | 决定 |
|------|------|------|
| `language` | `zh-CN` / `en-US` / `en-GB` / `en-IN` / `en-AU` | LLM 回复语言、STT `lang`、TTS 音色、纠错解释语言 |
| `persona.accent` | 同上枚举 / `null` | 只影响 TTS 音色（`en-*` 时），`language=zh-CN` 时忽略 |

`persona.accent = "zh-CN"` 这种写法**废弃**——它把「口音」和「语言」混在一个字段里，是上游稿最别扭的一处。

### 4.3 连带改动

- **`reply_zh` 字段语义崩了。** 现在它是「AI 英文回复的中文对照」。`language=zh-CN` 时 AI 就说中文，这个字段多余。改为 `reply_translation`（可选，`null` 表示不需要）：
  - `language` 为英文 → AI 回复英文 + `reply_translation` 给中文对照（保留现有体验）
  - `language` 为中文 → AI 回复中文 + `reply_translation: null`
- **纠错维度按语言切换**：
  - 英文演练 → 语法 / 时态 / 搭配 / 地道说法（现有 prompt）
  - 中文演练 → 结构化表达 / 逻辑衔接 / 分寸感 / 该说与不该说（例：「这个需求做不了」→「这个优先级我认可，但排期上我建议我们先对齐范围」）
- **口音 TTS 映射**：`language=zh-CN` 用现有 `speech_zh_voice`；英文用 `speech_voice`
- **STT lang**：跟随 `language`，用户可在会话中切（现有 `coach-stt.ts` 已支持传 `lang`）

### 4.4 这不只是加个开关

中文演练的「纠错」和英文演练的「纠错」是两种不同的东西——前者纠的是**表达策略**，后者纠的是**语言正确性**。prompt 模板要分成两套，不是把 `language` 插进同一段模板。

这是 Rehearse 与墨言陪练最实质的分野，也是它作为独立产品能立住的支点。

## 5. 场景体系

### 5.1 场景族（`category` 重定义）

现有 `category` 是 `daily` / `engineering` / `high_stakes`——按「工作类型」分，对英语陪练够用，对职场演练太窄。改为按**演练目的**分族：

| 族 | 说明 | v1 场景数 |
|----|------|-----------|
| `interview` | 面试。求职、转岗、晋升面 | 4 |
| `pitch` | 汇报与答辩。周会、项目评审、晋升答辩 | 3 |
| `hard_talk` | 高压对话。拒绝需求、给负面反馈、承认失误、要资源 | 3 |
| `daily` | 日常协作。站会、code review、跨时区沟通、茶水间 | 4 |

共 **14 个预置场景**。

### 5.2 从现有 8 个场景映射

现有场景基本都能平移，但归属要重判——`incident_sync` 和 `scope_deadline` 现在挂在 `high_stakes`，实际上它们考的是「高压下怎么说」，归 `hard_talk` 更准。

| 现有 id | 新族 | 处置 |
|---------|------|------|
| `standup_update` | `daily` | 保留 |
| `code_review` | `daily` | 保留 |
| `design_discussion` | `pitch` | 改族 |
| `incident_sync` | `hard_talk` | 改族 |
| `scope_deadline` | `hard_talk` | 改族 |
| `ask_for_help` | `daily` | 保留 |
| `one_on_one` | `hard_talk` | 改族（反馈与成长诉求本质是高压对话） |
| `remote_small_talk` | `daily` | 保留 |

新增 6 个：`interview_hr`（HR 初筛）、`interview_behavioral`（行为面 STAR）、`interview_technical`（技术深挖）、`salary_negotiation`（薪资谈判）、`promotion_defense`（晋升答辩）、`bad_news`（承认失误）。

### 5.3 材料上下文泛化

上游稿 §4.7 把简历/JD 挂在「面试场景」下，接口叫 `/interview/*`。职演里材料是**通用上下文**——晋升答辩要挂绩效材料，项目评审要挂项目文档。

| 接口 | 现状 | 改为 |
|------|------|------|
| `POST /api/coach/interview/text` | 材料 → 纯文本 | `POST /api/rehearse/material/text` |
| `POST /api/coach/interview/profile` | 文本 → 紧凑档案 | `POST /api/rehearse/material/profile` |

`kind` 枚举 v1 **仍只保留 `resume` / `job`**（不扩 `project_doc` / `perf_review`），但接口命名先泛化，为将来留口子。

**其余逻辑原样保留**：三段式流程（识别 → 用户校对删敏感信息 → 生成档案）、图片比文档多耗 1 次配额、不落盘、`vision_not_supported` 错误映射、`kind` 为 `resume_job` 时的合并标记。上游稿 §4.7 与 §8.1 的隐私设计**一字不改地继承**——那是整份稿子里最扎实的部分。

⚠️ 但**「校对发生在手机上」这个前提变了**（上游稿默认电脑端），确认页需要重做以适配小屏，见 §10。

### 5.4 场景 × 语言是正交的

每个预置场景带一个 `language` 默认值（例如 `interview_hr` 默认 `zh-CN`，`remote_small_talk` 默认 `en-US`），用户在开始前可切换。这样 14 个场景实际覆盖 14 × 5 种组合，不需要为「中文面试」「英文面试」各建一套场景。

## 6. 仓库与部署拓扑

### 6.1 同仓，不另开仓库

```
0x81-website/
├── website-rs/        # 网关（加一条 Host 路由）
├── moyan-web/         # 墨言前端
├── moyan-admin/       # 墨言管理后台（加「职演」区块）
├── moyan-app/         # 墨言 App（删 coach）
├── moyan-backend/     # 墨言 API（Rust，删 coach）
├── rehearse-backend/  # ★ 新增：职演 API（Go）
├── rehearse-app/      # ★ 新增：职演 App（唯一客户端）
└── docker-compose.yml
```

理由：网关、compose、CI、证书、备份、共享数据库的挂载全在这。独立仓库要重复一整套部署管线，而 Rehearse 能不能活还不知道。`moyan-app` 已经在仓库里，先例在。**等它独立赚钱了再拆仓。**

### 6.2 服务拓扑

```
                    Cloudflare
                        │
                        ▼
        website-rs  :80/:443   Axum 网关（仍是纯代理，按 Host 路由）
   ┌────────┬───────────┬──────────┬─────────────┬──────────────┐
   ▼        ▼           ▼          ▼             ▼              ▼
moyan-web admin-moyan  auth.0x81  moyan-backend  rehearse-backend
 :5000     :5001       ★ 新增     :4323          :4324  ★ 新增
 （静态）  （静态）     → 4323     （Rust/Axum）  （Go/net/http）
                                  ├ 签发 JWT      └ 只验 JWT
                                  └ 验 JWT
                                        │              │
                                        └──────┬───────┘
                                               ▼
                                   /data/moyan-data/moyan.db
                                   ★ 同一个 SQLite 文件，两个进程都连
```

网关环境变量：`PROXY_UPSTREAM_HOST_REHEARSE=rehearse-backend`、`PROXY_UPSTREAM_AUTH=moyan-backend`。**网关只多两条 Host 分支，路由结构不变**（仍是 Host-only，不做 Host+Path）。

⚠️ `rehearse.0x81.uk` **不是网站**，是 App 的 API 入口。它不需要前端容器，只需要 DNS 记录 + 网关一条 Host 路由。App 业务打 `https://rehearse.0x81.uk/api`，登录打 `https://auth.0x81.uk/api`。

⚠️ `auth.0x81.uk` 与 `moyan.0x81.uk` 现在指向同一个后端，这不冗余——前者是**能力域名**（登录），后者是**产品域名**。将来 auth 抽成独立服务时只改前者。详见 `2026-10-02-gateway-auth-design.md` §3.3。

### 6.3 App 打哪个域名

**Rehearse App 有两个 base URL，都是显式的：**

| 用途 | 域名 | 对应函数 |
|---|---|---|
| 业务 API | `https://rehearse.0x81.uk/api` | `getApiBase()` |
| 登录 / 用户信息 | `https://auth.0x81.uk/api` | `getAuthBase()` |

墨言 App 已经用 `app.config.js` 的 `API_URL` 环境变量注入 base URL（`getApiBase()` 读 `Constants.expoConfig.extra.apiUrl`），Rehearse 照抄这个机制，再加一个 `AUTH_URL`：

```js
extra: {
  apiUrl: process.env.API_URL,    // https://rehearse.0x81.uk
  authUrl: process.env.AUTH_URL,  // https://auth.0x81.uk
}
```

**为什么是两个而不是一个**：业务域名属于产品，登录域名属于跨产品能力。把它们分开，将来 auth 抽成独立服务时业务侧完全不受影响（`gateway-auth-design.md` §3.3）。

好处：架构上不出现「职演的 App 打着墨言的域名」这种别扭；换后端实现（甚至换语言）只改网关一条路由。

### 6.4 管理后台怎么接

`moyan-admin` 复用（不新建后台），加一个「职演」区块。它的 `/api/admin/settings/rehearse` 请求需要打到 `rehearse-backend`，而其余 `/api/*` 仍归 `moyan-backend`——在 `moyan-admin` 的 Caddyfile 里按路径分流：

```
handle /api/admin/settings/rehearse* { reverse_proxy rehearse-backend:4324 }
handle /api/*                        { reverse_proxy moyan-backend:4323 }
```

**为什么不把这个接口留在 `moyan-backend`**：表虽然是共享的，但配置的读写语义属于 Rehearse。留在墨言侧会让 `moyan-backend` 需要理解 Rehearse 的配置 schema，是把已经拆开的耦合重新缝回去。Caddy 加两行更便宜。

两个服务共用同一个 `ADMIN_TOKEN`（§7.7）。

### 6.5 命名标识

| 项 | 值 | 备注 |
|---|---|---|
| 产品名 | Rehearse / 职演 | |
| Expo slug | `rehearse` | |
| URL scheme | `rehearse://` | 墨言导流 deep link 用 |
| iOS bundle id | `uk.0x81.rehearse` | |
| Android package | `uk.0x81.rehearse` | |
| 域名 | `rehearse.0x81.uk` | API 入口 |
| 后端目录 | `rehearse-backend/` | Go module `github.com/0x81/rehearse-backend`（待定） |
| 后端端口 | `4324` | 与 `moyan-backend` 的 4323 并列 |
| **顺手修正** | `moyan-app` 的 `com.anonymous.moyanapp` → `uk.0x81.moyan` | 现在是 Expo 占位符，**上架前必须改**，趁这次一起做 |

## 7. 后端（Go）

### 7.1 为什么用 Go 重写而不是把 Rust 拆出来

原始动机是**编译成本**。现状：

| | `moyan-backend`（Rust） | `rehearse-backend`（Go） |
|---|---|---|
| CI 构建 | `docker build` 走 `rust:latest` builder 段，`[profile.release]` 是 `lto=true` + `codegen-units=1`（最贵的组合），编完再 `docker cp` 提取 ELF | `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -trimpath` **直接出静态二进制，不需要 Docker builder** |
| 交叉编译 | 靠 Docker 保证工具链与 glibc 一致 | 原生支持，一条命令 |
| 运行镜像 | 必须 `debian:trixie-slim`（二进制要求 GLIBC ≥ 2.39，bookworm 只有 2.36） | `scratch` 或 `gcr.io/distroless/static`——**静态二进制，无 libc 依赖** |
| 运行时依赖 | ffmpeg + python3 + yt-dlp + libsqlite3-0（播客采集用） | **一个都不需要**（材料解析全在纯 Go 里做） |

这四条加起来，Rehearse 后端的镜像和构建时间与墨言后端**不在一个量级**。而且 Go 侧不需要 `lto`/`codegen-units` 这类以编译时间换运行时的调参——Go 的编译速度本来就是它的核心优势。

> ⚠️ 具体数字要实测，本稿不写。但机制是确定的：**不需要 Docker builder 层**这一条就省掉整个 CI 阶段。

### 7.2 技术选型

| 关注点 | 选型 | 理由 |
|---|---|---|
| HTTP | 标准库 `net/http` + `ServeMux`（Go 1.22+ 支持 `POST /api/rehearse/turn` 模式串） | 零第三方路由依赖 |
| SQLite 驱动 | **`modernc.org/sqlite`（纯 Go，无 cgo）** | 关键选型——只有它能让 `CGO_ENABLED=0` 成立，静态二进制与 `scratch` 镜像都依赖这一点 |
| 数据访问 | 标准库 `database/sql`，手写 SQL | Rehearse 只碰 1 张自己的表 + 读 2 张共享表，不需要 ORM 或 sqlc 代码生成 |
| JWT 验签 | `github.com/golang-jwt/jwt/v5` | HS256，claims 与 Rust 侧逐字段一致（§7.4）。**只验签，不签发** |
| Google OAuth / ID token | **不需要** | 登录是 `auth.0x81.uk` 的事，Rehearse 不碰 |
| PDF 抽文本 | `github.com/ledongthuc/pdf` | 纯 Go。Rust 侧用的是 `pdf-extract`（底层 `lopdf`，也是纯 Rust），所以能力对齐没有架构障碍 |
| DOCX | 标准库 `archive/zip` + `encoding/xml` | Rust 侧用 `zip` crate，同理 |
| LLM 调用 | 标准库 `net/http` + `encoding/json` | OpenAI 兼容协议，不需要 SDK |
| 日志 | 标准库 `log/slog` | 结构化日志 |
| 配置 | 标准库 `os.Getenv` | 与现有 compose 注入方式一致 |

**约束：任何引入 cgo 的依赖都要否决。** 一旦 `CGO_ENABLED=1`，静态二进制、`scratch` 镜像、免 Docker 构建这三条收益全部消失——那就失去了换 Go 的意义。

### 7.3 共享数据库（本设计最需要想清楚的一块）

#### 7.3.1 共享同一个 SQLite 文件

两个服务连**同一个文件**（生产 `/data/moyan-data/moyan.db`，即 compose 里 `MOYAN_DATA_DIR` 挂到容器 `/data` 的那个目录）。

已核对现状：`SqliteRepositories::connect` 只做了 `create_if_missing(true)` + `max_connections(5)`，**没有设 journal_mode，也没有显式 busy_timeout**（sqlx 默认 5 秒）。默认 journal mode 是 rollback journal。

**单进程时没问题，两个进程写同一个文件时会互相阻塞。** 所以这次必须改：

| 改动 | 值 | 说明 |
|---|---|---|
| `journal_mode` | **WAL** | 读写不互相阻塞；这是多进程共享 SQLite 的前提。它持久化在文件头，设一次就够，但两个服务都应在连接时设置以保证幂等 |
| `busy_timeout` | **5000 ms** | 写锁被占用时等待而非立刻 `SQLITE_BUSY`。显式设，不依赖驱动默认值 |

Rust 侧改 `SqliteConnectOptions`，Go 侧在 DSN 里带 `?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)`。

⚠️ **WAL 切换要在阶段 1 单独做一次并观察**，因为它改变的是已存在生产库的文件格式。README 里有每日热备（`moyan-db-backup`），切换前先手动跑一次 `moyan-db-backup --force`。

#### 7.3.2 表归属

| 表 | 归属 | 谁能写 |
|---|---|---|
| `users` | **共享契约表** | 两个服务都能写（注册、`find_or_create`、`touch_last_login`） |
| `admin_settings` | **共享契约表** | 各写各的键：`llm`（墨言写、两边读）、`rehearse`（Rehearse 写） |
| 墨言自己的表（`user_decks` / `user_cards` / `review_logs` / `type_*` / `collect_jobs` …） | 墨言独占 | 只有 `moyan-backend` |
| `rehearse_usage` | Rehearse 独占 | 只有 `rehearse-backend` |

**规则：独占表可以随便改；共享契约表的 schema 变更需要两边同时改代码。** 共享表只有 2 张，且都是很稳定的结构（`users` 自 001 迁移以来没动过主键），所以这个约束在实践中几乎不触发。

**不做跨服务的数据库外键。** `rehearse_usage` 不加 `REFERENCES users(id)`——SQLite 的外键约束在跨服务写入下没有意义，反而让迁移顺序变复杂。

#### 7.3.3 迁移所有权

**v1：`moyan-backend` 是唯一的迁移所有者。**

- 它现在就在启动时跑 `sqlx::migrate!("./migrations")`（`repositories/sqlite.rs:432`），这个行为不变
- 新增的 `rehearse_usage` 建表放在 `moyan-backend/migrations/012_*.sql`
- **`rehearse-backend` 不跑任何迁移**，启动时只做 **schema 断言**：检查自己需要的表和列存在，缺失就**报错退出**（fail fast，而不是自己去建）

> **为什么接受「Rehearse 的表由墨言的迁移目录管」这个别扭**：Rehearse v1 需要的新表**只有 1 张**（`rehearse_usage`），其余全是共享表。为一个表引入独立的迁移基础设施（共享 `db/migrations/` 目录 + 一次性迁移容器 + 兼容现有 `_sqlx_migrations` 表的 runner）是明显的过度设计。

**升级触发条件（满足任一就把 migrations 提为共享资源 + 独立迁移步骤）：**

1. Rehearse 需要第 3 次 schema 变更（第 1 次是建 `rehearse_usage`）
2. 出现第三个后端服务
3. `moyan-backend` 需要多副本部署（现在的启动迁移在多副本下会打架）

#### 7.3.4 升级路径：SQLite → Postgres

共享 SQLite 在个人学习类产品的量级下完全够用，但要留好退路。触发条件（满足任一）：

- `SQLITE_BUSY` 在日志里持续出现，或 P99 延迟因写锁劣化
- 需要把数据库放到独立机器
- 服务数量增加到 3 个以上

届时的路径：`moyan-backend` 的 repository trait 已经抽象了存储（`sqlite.rs` / `mongodb.rs` 两个实现），加一个 Postgres 实现是**已有模式内的扩展**，不是重构。Go 侧用 `pgx`。

> 注：仓库里其实**已经有 MongoDB 实现**（`DATABASE_BACKEND=mongodb` 可切），但生产跑的是 SQLite。本稿不把 MongoDB 作为共享方案——两套存储后端同时活跃会让「谁是权威」变得含糊。

### 7.4 认证：只验签，不签发

> **这一节在 2026-10-02 改过两轮。** 第一版让 Rehearse 在 Go 里移植一遍 Google 登录 + JWT 签发（把认证复制成两份）；第二版改成「网关做认证 + 注入身份头」。最终采用第三版：**统一登录入口 + 各服务自己验 token**。完整设计与方案取舍见 `2026-10-02-gateway-auth-design.md`，本节只写 Rehearse 侧的结论。

#### 7.4.1 登录归 `auth.0x81.uk`，Rehearse 只验签

```
登录：  rehearse-app ──► auth.0x81.uk ──► moyan-backend（签发 JWT）
业务：  rehearse-app ──► rehearse.0x81.uk ──► rehearse-backend（验 JWT）
```

**Rehearse 侧的全部 auth 代码是一个约 40 行的验签中间件**：

1. 从 `Authorization: Bearer <token>` 取 token
2. 用共享密钥做 HS256 验签
3. 把 `sub` 放进请求上下文
4. 失败 → 401

没有 OAuth、没有签发、没有建号、没有对 `users` 表的写操作。

#### 7.4.2 不做的东西

| 原本可能要做 | 现在 |
|---|---|
| 移植 `POST /api/auth/google/mobile` | **不做**——登录入口是 `auth.0x81.uk`，与 Rehearse 无关 |
| 移植 `GET /api/auth/me` | **不做**——Rehearse App 需要用户信息时打 `auth.0x81.uk/api/auth/me` |
| `google.golang.org/api/idtoken` 依赖 | **不需要**——不碰 OAuth |
| 复制 `find_or_create` / `find_by_provider` 逻辑 | **不需要**——建号归认证服务 |
| 复刻那个 `ALLOW_LEGACY_TOKEN_AUTH` 兜底后门 | **代码里不存在**。少一个后门就少一类事故 |

#### 7.4.3 跨语言契约：三个必须对齐的点

两个后端一个 Rust 一个 Go，验签逻辑各写一份。**这份契约是它们之间唯一的耦合面**（`gateway-auth-design.md` §5）：

1. **claims 结构**——`{ sub, email, name, exp, iat }`，HS256（`moyan-backend/src/middleware/auth.rs:11`）
2. **密钥**——同一个 `JWT_SECRET`，**必须 ASCII**（仓库里踩过 `X-Admin-Token` 含非 ASCII 恒 401 的坑）
3. **401 响应形状**——`{ success: false, error: { code: "unauthorized", message } }`，否则客户端要写两套错误处理

⚠️ **`exp` / `iat` 必须是整数秒**。Go 的 `jwt/v5` 默认用 `NumericDate`，序列化出来同样是整数，但要确认不是浮点——否则 Rust 侧 `decode::<Claims>` 会因为类型不匹配失败。

**互通必须有双向测试**：固定密钥 + 固定 payload，断言 Rust 签的 token Go 能验、Go 签的 Rust 能验。

#### 7.4.4 账号仍然是共享的

`users` 表有 `UNIQUE INDEX idx_users_provider ON users(provider, provider_id)`，建号逻辑只有认证服务一份。所以**同一个 Google 账号在墨言注册过，在 Rehearse 首次登录会命中同一条记录**——这正是共享数据库 + 统一认证换来的效果，Rehearse 侧不需要任何账号打通代码。

### 7.5 路由与 API

Rehearse 的所有接口从 `/api/coach/*` 改为 `/api/rehearse/*`。**因为尚无已发布客户端，直接改名，不保留别名**（§2.6 的窗口期）。

| 现在（`moyan-backend`） | 改为（`rehearse-backend`） |
|------|------|
| `GET  /api/coach/quota` | `GET  /api/rehearse/quota` |
| `GET  /api/coach/scenarios` | `GET  /api/rehearse/scenarios` |
| `POST /api/coach/scenario/draft` | `POST /api/rehearse/scenario/draft` |
| `POST /api/coach/turn` | `POST /api/rehearse/turn` |
| `POST /api/coach/summary` | `POST /api/rehearse/summary` |
| `POST /api/coach/interview/text` | `POST /api/rehearse/material/text` |
| `POST /api/coach/interview/profile` | `POST /api/rehearse/material/profile` |
| `GET|PUT /api/admin/settings/coach` | `GET|PUT /api/admin/settings/rehearse`（走 §6.4 的 Caddy 分流） |
| — | `GET /health` |

⚠️ **没有 `/api/auth/*`。** 登录入口是 `auth.0x81.uk`，由认证服务（`moyan-backend`）提供；Rehearse 后端不认识任何 auth 路径，它只验签（§7.4）。

`moyan-backend` 侧：**删除全部 coach 路由与代码**（`controllers/coach.rs`、`models/coach.rs`、`routes/coach.rs`、`services/coach*.rs`、`services/interview_*.rs`），以及 `main.rs` 里的 `.nest("/api/coach", ...)`。

⚠️ 删除时机：必须与 §11 阶段 3（App 搬家）同批。在那之前墨言 App 还在打 `/api/coach/*`。

### 7.6 字段改动清单

| 字段 | 改动 |
|------|------|
| `language` | **新增**（顶层，枚举见 §4.2） |
| `persona.accent` | **新增**，取代 `persona.locale`（后者删除） |
| `category` | 枚举重定义（§5.1），旧值 `engineering` / `high_stakes` 删除 |
| `reply_zh` | 改名 `reply_translation`，可空（§4.3） |
| `coach_mode` | 改名 `mode`，枚举不变 `feedback` / `immersion` |
| `scenario_id` | 不变 |
| `interview` | 改名 `material`（请求体字段），`kind` 枚举不变 |
| `mood` | 不变 |

响应信封不变：`{ success, data }` / `{ success, error: { code, message } }`，错误码沿用（`coach_quota_exceeded` → `rehearse_quota_exceeded`）。

### 7.7 环境变量

容器侧的键名**不带前缀**（`JWT_SECRET` / `ADMIN_TOKEN`），compose 侧用 `MOYAN_` 前缀注入。已核对 `docker-compose.yml:41-46`。

| 容器侧 | compose 侧（现在 → 改为） | 注入给谁 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | `MOYAN_DATABASE_URL` → **保持不变** | 两个后端 | 指向**同一个文件**：`sqlite:/data/moyan.db` |
| `JWT_SECRET` | `MOYAN_JWT_SECRET` → 改名**可选** | 两个后端 | 两个后端各自验签用，必须是同一个值。**必须 ASCII** |
| `ADMIN_TOKEN` | `MOYAN_ADMIN_TOKEN` → 改名**可选** | 两个后端 | 管理端 `X-Admin-Token` |
| `ALLOWED_ORIGINS` | `MOYAN_ALLOWED_ORIGINS` | 两个后端 | Rehearse 侧加上 `https://rehearse.0x81.uk`（没有 Web 客户端时其实用不上，RN 的 fetch 不带 `Origin`，加上只是留口子） |
| `GOOGLE_CLIENT_ID` | `MOYAN_GOOGLE_CLIENT_ID` | **只有认证服务** | Rehearse **不需要**——它不碰 OAuth（§7.4.2） |
| `PORT` | — | Rehearse | 固定 `4324` |

网关侧新增（`website-rs`）：`PROXY_UPSTREAM_HOST_REHEARSE`、`PROXY_UPSTREAM_AUTH`。**就这两个**——网关不验签、不注入身份（`gateway-auth-design.md` §4.1）。

⚠️ **不设回落逻辑。** 早先的稿子里我建议新键为空时回落到旧键——**后来改主意了**：回落会把「服务器上 `.env` 没改」这个问题静默吞掉，表现成「服务正常启动但所有 token 都验不过」，比启动失败难查得多。**改名就是改名，服务器上漏改 `.env` 就让它启动失败。**

服务器上的 `.env` 是**纯手工部署件**（不进 git、不进 release）。改完必须 `docker compose up -d`（不是 `restart`），并用 `docker compose config | grep -E 'JWT_SECRET|ADMIN_TOKEN'` 断言插值读到了非空值。

### 7.8 移植工作量

| Rust 模块 | 行数 | 移植动作 |
|---|---:|---|
| `services/coach.rs` | 941 | 重写（prompt 构造 + LLM 调用 + JSON 校验 + 护栏） |
| `services/coach_scenarios.rs` | 669 | **主体是数据**——14 个预置场景的文案与教学点。建议改为 Go 内嵌 JSON/`go:embed`，逻辑代码只剩查表 |
| `models/coach.rs` | 433 | 重写为 Go struct（大部分是 serde 类型定义） |
| `services/llm_client.rs` | 894 | **只取通用 chat 部分**（约三分之一）；其余是词汇提取，不移植 |
| `services/interview_ocr.rs` | 198 | 直译（视觉模型调用） |
| `services/interview_docs.rs` | 166 | 直译（PDF/DOCX 抽文本） |
| `services/interview_profile.rs` | 152 | 直译 |
| `services/coach_quota.rs` | 174 | 直译 |
| `controllers/coach.rs` | 162 | 重写为 `http.HandlerFunc` |
| `middleware/error.rs` | 145 | 重写错误信封（枚举 → 状态码映射） |
| `middleware/auth.rs` | 147 | **只取 JWT 部分**（约一半），去掉 legacy 兜底分支 |
| `middleware/admin_auth.rs` | 67 | 直译（`X-Admin-Token`，注意 ASCII 约束见 README） |
| `services/coach_settings.rs` | 65 | 直译 |
| `routes/coach.rs` | 29 | 重写为 `ServeMux` 注册 |
| **合计** | **约 4,240 行 Rust** | **预计 2,500–3,500 行 Go** |

**移植的验收门槛是「行为对齐」，不是「能跑」**：同一组输入（场景、历史、用户发言），Rust 与 Go 两版产出的**护栏判定与响应结构**必须一致。prompt 文本本身可以有细微差异（模型输出本来就非确定），但长度上限、轮数上限、枚举校验、配额计数、错误码这些**可判定的部分必须逐条对齐**。

**这条很重要**：换语言重写最大的风险不是写不出来，是**悄悄丢掉了原来那些护栏**——那些护栏是踩过坑才加上的（比如「超长 user_text 在调 LLM 之前就拒绝」）。移植时必须有一份对照清单，逐条确认。

## 8. App 端

### 8.1 搬什么

`rehearse-app/` 从 `moyan-app/` 复制骨架后整体搬迁：

| 类别 | 内容 |
|------|------|
| 路由（9） | `(tabs)/coach.tsx` → `(tabs)/rehearse.tsx`（且升为 Tab 第 1 位，见 §8.3）；`coach/{session,summary,editor,history,settings}.tsx`；`coach/interview/*` → `coach/material/*` |
| 组件（8） | `components/coach/*` → `components/rehearse/*`，改名不改逻辑 |
| lib（28） | `lib/coach-*` → `lib/rehearse-*`，含 14 个测试文件 |
| 依赖（4） | `expo-speech-recognition`、`expo-image-picker`、`expo-image-manipulator`、`expo-document-picker` |
| 权限 | `CAMERA`、相册、`RECORD_AUDIO`、语音识别（`app.json` plugins + permissions） |

**搬迁后 14 个测试文件必须全绿**——这是搬迁正确性的唯一客观证据。

已核对（2026-10-02）：这 4 个依赖在墨言里**只被 `lib/coach-files-runtime.ts` 引用**（`expo-document-picker` / `expo-image-picker` / `expo-image-manipulator`），`expo-speech-recognition` 只被 coach 的 STT 模块引用。所以墨言侧可以**四个全删**，不留尾巴。

### 8.2 留在墨言什么

| 保留 | 理由 |
|------|------|
| `expo-audio` | 播客要用 |
| `expo-speech` | 单词发音要用 |
| `expo-av` 相关音频会话配置 | 播客要用 |
| 主题 / i18n / ui 体系 | 墨言自身需要 |

**删掉（4 个依赖 + 4 项权限）**：`expo-speech-recognition`、`expo-image-picker`、`expo-image-manipulator`、`expo-document-picker`；`CAMERA` 权限、相册权限、语音识别权限、`RECORD_AUDIO`。

已核对（2026-10-02）：墨言非 coach 代码里 `expo-audio` 只有**播放**用途——`lib/speech.ts`（TTS 播放）与 `lib/podcast-player.ts`（播客播放）的 `setAudioModeAsync` 都只传 `playsInSilentMode` / `shouldPlayInBackground` / `interruptionMode`，**没有任何地方传 `allowsRecording: true`，也没有 recorder 实例**。录音能力完全来自 `lib/coach-recorder.ts` 与 `app/coach/session.tsx`，二者都搬走。

因此 `RECORD_AUDIO` 与 `app.json` 里 `expo-audio` 插件的 `microphonePermission` 选项**可以一起删**，`expo-audio` 本身保留（播客要用）。

删完墨言的权限面回到「背单词 App 该有的样子」：无相机、无相册、无麦克风、无语音识别。

### 8.3 墨言侧收尾：撤销 §6.1 的 Tab 改动

拆出 coach 后，墨言 Tab 从 5 个变 4 个（首页 / 播客 / 统计 / 设置）。上游稿 §6.1 的论证是「追加会变成 6 个 Tab，每项只剩 57px」——现在这个约束消失了。

**推荐：把词库放回 Tab 第 2 位，撤销「词库改全屏页」的改动。**

| 位置 | Tab |
|------|-----|
| 1 | 首页 |
| 2 | **词库**（回归） |
| 3 | 播客（条件显示） |
| 4 | 统计 |
| 5 | 设置 |

- 恢复老用户肌肉记忆（点第 2 个 Tab 是词库）
- 删除 `src/app/decks.tsx` 全屏页，恢复 `(tabs)/decks.tsx`
- 首页「选择词库」CTA 从「跳转全屏页」改回「打开选择弹层」——但上游稿删掉的 `showPicker` / `Modal` 代码需要**从 `4aecb07` 之前的历史里捞回来**（`git show 4aecb07^:moyan-app/src/...`）
- 「去职演」导流卡放**首页**，不占 Tab

> 这一条是可以否掉的：如果认为词库全屏页其实更好（少一个 Tab 更清爽），保留现状也行。但**默认按「回归 Tab」走**，因为它撤销了一次由他人功能倒逼的设计妥协。

### 8.4 共享代码策略：纯复制

两个 App 都是 Expo，理论上可以抽 npm workspaces 共享包；但 `rehearse-app` 将来要独立发版、独立迭代，共享包会把两边的升级节奏绑在一起。收益（~600 行基础设施）小于改造成本与耦合代价。

**策略：复制，但明确列出「允许漂移」与「必须同步」两张清单。**

| 模块 | 策略 |
|------|------|
| `lib/api.ts`（鉴权、错误信封、401 处理） | **必须同步**——鉴权逻辑分叉会导致安全策略不一致 |
| `lib/speech.ts`（TTS 多供应商） | 允许漂移（Rehearse 只留它用到的供应商） |
| `lib/theme.ts`（6 套主题） | 允许漂移（Rehearse 裁剪主题集） |
| `translations.ts` | 允许漂移（场景词汇完全不同） |
| `lib/ui.ts`（`screen.*`、`cardStyle()`） | 允许漂移 |

「必须同步」清单写在两个仓库各一份 `SYNC.md`，并在 PR 模板里加一条检查项。

**等第三个产品出现时再抽 shared 包。**

## 9. 账号与冷启动

### 9.1 共享账号

Rehearse 与墨言共用 `users` 表。**用户在墨言有账号，装 Rehearse 直接登，零摩擦**——不需要任何账号打通逻辑，靠的是共享库 + `users(provider, provider_id)` 唯一索引（§7.4.3）。

- **登录入口是 `auth.0x81.uk`**，Rehearse App 打它拿 JWT，业务请求打 `rehearse.0x81.uk`（§7.4.1）。Rehearse 后端只验签、不参与登录
- 登录方式沿用认证服务现有的：**Google 移动端登录**（`POST /api/auth/google/mobile`），复用同一个 Google OAuth client id
- **不做**邮箱密码登录——现有体系里根本没有（`argon2` 依赖在 `Cargo.toml` 里但从没被调用过）
- `moyan-app` 也在同一批次切到 `auth.0x81.uk`；**`moyan-web` 不切**（它线上走同源相对路径，没有硬编码域名，切过去只会引入跨域预检——理由见 `gateway-auth-design.md` §3.2）

### 9.2 冷启动是最大风险（不是技术问题）

留在墨言里能直接吃现有用户池；独立 App 要从零获客。

缓解措施，按性价比排序：

1. **墨言首页导流卡**——成本最低，覆盖全部现有用户。文案指向场景（「要去面试？先演一遍」），不是功能（「试试 AI 陪练」）
2. **共享账号**——装完不用注册，首次摩擦降到最低
3. **深链**——墨言导流卡点击 `rehearse://`，未安装跳商店
4. **不做**反向导流（Rehearse → 墨言），那不是它的用户旅程

### 9.3 账号绑定的代价（要认）

共享账号意味着 Rehearse 与 0x81 生态绑定。将来若 Rehearse 单独融资 / 出售，账号体系会有包袱。可接受——现在讨论退出为时过早，且共享账号带来的冷启动收益远大于此。

## 10. 材料导入的现实约束（没有 Web 兜底）

**2026-10-02 决定：不做 Web，只做 App。** 这直接决定了材料导入必须重新设计。

### 10.1 问题

上游稿 §4.7 把材料导入设计成三段式：

```
文件 / 图片 ──► 文本 ──►【用户校对 + 删除敏感信息】──► 结构化档案 ──► 面试
```

这个设计是对的——**图片上的敏感信息删不掉，转成文本才删得掉，这是唯一真正可行的隐私路径**。但它有一个隐含前提：校对发生在电脑上。

手机端的实际情况是：一份 800 字的简历，用户要在小屏上逐字核对姓名、时间、数字（恰恰是面试官会追问的东西），还要手动找出并删除手机号。**这个环节的流失率会很高。**

上游稿本来可以用 Web 兜底（简历和 JD 的原始形态就在电脑上），现在这条路没了，必须在 App 内补偿。

### 10.2 补偿手段（按性价比排序）

| 手段 | 说明 | 成本 | v1 |
|------|------|------|-----|
| **剪贴板优先** | 进入材料页时检测剪贴板，若含长文本则提示「检测到剪贴板内容，用它吗？」。用户可在电脑上复制简历 → 通过任意 IM 发到手机 → 粘贴。绕开「存文件 → 找文件 → 选文件」 | 低（`expo-clipboard`） | ✅ |
| **分段校对** | 确认页按「个人信息 / 经历 / 技能 / 其他」分段折叠，用户只展开要改的那段，不必通读全文 | 低（纯前端） | ✅ |
| **聚焦疑似错误** | 识别结果里高亮英文姓名、日期、数字（识别最易错的地方），支持「跳转到下一处」 | 中 | ✅ |
| **系统分享入口** | 让 Rehearse 出现在系统分享面板（iOS Share Extension / Android `ACTION_SEND`）。在电脑上看到 JD、或在微信里收到简历，直接分享到 Rehearse | 高（原生 target，CNG 下要自定义 config plugin） | ⏳ v2 |
| **弱化材料** | 材料导入定位为**可选增强**，不是必经路径；纯场景演练完全不需要材料 | 零 | ✅ |

**v1 做前四项里的前三项 + 弱化材料定位。** 系统分享入口价值最高但成本也最高（iOS Share Extension 是个独立 target，CNG 下比普通 config plugin 麻烦），放 v2。

### 10.3 一个要在真机验证阶段实测的备选方案

如果实测发现用户在材料确认页大量流失，备选方案是**把材料导入收窄为「粘贴文本」一条路径**——直接砍掉 PDF / DOCX / 图片三条，用最简单的方式保住隐私设计。

这个取舍的账是这样的：

- 砍掉三条路径 = 省掉 `expo-document-picker` / `expo-image-picker` / `expo-image-manipulator` 三个依赖、CAMERA 与相册两项权限、以及后端 `/material/text` 的整个文档与视觉分支
- 代价 = 用户得自己把简历转成文本（但**多数人本来就会做**——求职者手里通常有 Word 版简历，复制粘贴是一秒的事）
- 隐私上**反而更强**：没有图片上传，就没有「图片发给模型」这一步

**先按完整三条路径实现，真机验证后再决定是否收窄。** 不预先优化。

## 11. 迁移阶段

**前置**：`2026-10-02-gateway-auth-design.md` 的阶段 1–2 必须先完成（加 DNS + 网关 Host 分支）。那两步是零风险的，但 Rehearse 的 `AUTH_URL` 要指向它。

| 阶段 | 内容 | 影响面 |
|------|------|--------|
| **0** | 本 spec 定稿；名字、bundle id、域名、Go module 路径、env 键名定稿 | 无代码 |
| **1** | **共享数据库就位**：SQLite 切 WAL + 显式 `busy_timeout`；迁移 012 建 `rehearse_usage`；切换前先跑一次 `moyan-db-backup --force` | `moyan-backend` |
| **2** | **Go 服务骨架**：`rehearse-backend/` 起服务、连同一个库、**JWT 验签中间件（约 40 行）**、错误信封、`/health`、Dockerfile（`scratch`/distroless）+ CI 构建（无 Docker builder） | 新增后端 |
| **3** | **业务移植**：14 个场景目录、`/turn`、`/summary`、`/scenario/draft`、配额、管理设置、材料解析三条路径；**行为对齐测试**（§7.8） | 新增后端 + `moyan-admin` Caddy 分流 |
| **4** | **App 搬家 + 双向切换**：新建 `rehearse-app/`（搬 45 文件 + 4 依赖，`API_URL=https://rehearse.0x81.uk`、`AUTH_URL=https://auth.0x81.uk`）；墨言删 coach（App 侧 + Rust 侧）、撤销 Tab 改动、首页加导流卡；网关加 `rehearse.0x81.uk` 的 Host 分支 | App ×2 + 后端 ×2 + 网关 |
| **5** | **材料确认页适配小屏**：剪贴板优先 + 分段校对 + 聚焦疑似错误（§10.2） | App |
| **6** | （可选）独立迁移步骤 / 转 Postgres（触发条件见 §7.3.3、§7.3.4） | 后端 |

**阶段 1 必须先做**，因为它是唯一动到**已存在的生产库**的一步。WAL 切换改变文件格式，且两个服务都要用它——这一步没验证通过，后面全白搭。

**阶段 4 是唯一的原子切换点。** 在那之前，墨言 App 一直打 `/api/coach/*`（`moyan-backend` 照旧服务）；阶段 4 一次性完成「Rehearse App 上线 → 网关切路由 → 墨言删 coach」。**不要提前删 `moyan-backend` 的 coach 代码**——删早了墨言 App 立刻 404。

阶段 4 内部顺序：先起 `rehearse-backend` 并确认网关路由通 → 再发 Rehearse App → 最后删墨言侧 coach。因为墨言 App 未上架，中间态不是线上事故，但要按一个批次推进，不要停在中间。

**阶段 2 的冒烟验证**：Go 服务只实现 `/health` 和一个返回当前用户 id 的调试端点，用 curl 验证三件事——① 用 `moyan-backend` 签发的 token 能通过 Go 侧验签（跨语言互通，最容易出错）；② 无 token / 过期 token 被拒；③ 共享库能读写。

## 12. 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| **冷启动失败**（最大） | 高 | 墨言首页导流 + 共享账号（§9.2） |
| **材料确认页在手机上流失** | 高 | 剪贴板优先 + 分段校对 + 聚焦疑似错误；材料定位为可选增强（§10.2）。真机实测后若仍流失，收窄为「只粘贴文本」（§10.3） |
| **Go 重写悄悄丢掉护栏** | 高 | 移植验收门槛是**行为对齐**而非「能跑」：护栏判定与响应结构逐条对照（§7.8）。这是换语言重写最大的风险——不是写不出来，是漏掉那些踩坑才加上的限制 |
| **共享 SQLite 写竞争** | 中 | WAL + `busy_timeout=5000`；日志里监控 `SQLITE_BUSY`；触发条件转 Postgres（§7.3.4）。阶段 1 单独验证 |
| **WAL 切换动到生产库** | 中 | 切换前先跑 `moyan-db-backup --force`；切换后验证 `PRAGMA journal_mode` 与两服务读写 |
| **两套后端的认证基线漂移** | 中 | 契约只有三件事：claims、密钥、401 响应形状（§7.4.3）。Rehearse 侧**代码里不存在** legacy 兜底分支；双向验签测试是硬门槛 |
| JWT 跨语言互通失败 | 中 | `exp`/`iat` 必须整数秒而非浮点（否则 Rust 侧 `decode::<Claims>` 失败）；固定密钥 + 固定 payload 做双向测试 |
| 依赖 `auth.0x81.uk` 先就位 | 低 | 前置是 `gateway-auth-design.md` 阶段 1–2（加 DNS + 一条网关分支），零风险且不阻塞后端开发——`rehearse-backend` 可以先用 `moyan-backend` 签发的 token 做测试 |
| 迁移所有权耦合 | 低 | v1 只需 1 张新表；触发条件明确（§7.3.3） |
| 定位膨胀成大杂烩 | 中 | v1 锁死 4 族 14 场景，不加族；新族走评审 |
| 双份维护漂移 | 中 | 「必须同步」清单 + `SYNC.md` + PR 检查项（§8.4）。现在多了一层：Rust 与 Go 之间的**契约**（JWT claims、错误信封、DB schema）也需要同步清单 |
| 中文演练的 prompt 质量 | 中 | 中文「纠错」是另一套维度（表达策略 vs 语言正确性），需要单独设计 prompt 与评测集，不能复用英文模板（§4.4） |
| 搬迁回归 | 中 | 14 个测试文件全绿是硬门槛（§8.1） |
| env 键改名漏改服务器 `.env` | 低 | **故意不做回落**（§7.7）——漏改就让它启动失败，比静默吞掉好查 |
| 阶段 4 的原子切换 | 低 | 未上架，无线上影响；但删 `moyan-backend` 的 coach 代码不能早于 Rehearse App 可用 |

## 13. 测试与验收

**共享数据库**
- WAL 生效：`PRAGMA journal_mode` 返回 `wal`；两个服务同时连时都能读到对方的写入
- 写竞争：并发压测（两个进程同时写 `users` 与各自的表）下无 `SQLITE_BUSY` 泄漏到响应
- 迁移 012：`coach_usage` 数据完整搬到 `rehearse_usage`（行数与内容逐条比对）；`admin_settings` 的 `coach` 键改为 `rehearse`；`coach` 键不存在时迁移不报错
- schema 断言：故意删掉 `rehearse_usage` 表后启动 `rehearse-backend`，必须**报错退出**而不是自动建表
- 独占边界：`rehearse-backend` 的代码里不出现对墨言独占表（`user_decks` / `user_cards` / `type_*` / `collect_jobs` …）的任何 SQL

**认证（Rehearse 侧）**
- **跨语言互通（硬门槛）**：固定密钥 + 固定 payload，`moyan-backend` 签发的 token `rehearse-backend` 能验，反之亦然
- `exp` / `iat` 序列化为**整数秒**（不是浮点）
- 无 token / 过期 token / 签名错误 → 401，且**响应体形状与 `moyan-backend` 一致**（`{success:false, error:{code:"unauthorized"}}`）
- 有效 token → 请求上下文里拿到正确的 user id
- **代码审计**：`rehearse-backend` 里不出现任何 OAuth / JWT 签发 / `find_or_create` / 兜底认证逻辑（§7.4.2）
- 同一 Google 账号在墨言注册过，在 Rehearse 首次登录命中**同一条** `users` 记录（靠 `idx_users_provider` 唯一索引），不产生重复用户——**这条测在认证服务侧**，因为建号不在 Rehearse

**Go 后端功能**
- 行为对齐（§7.8）：同一组输入下，护栏判定与响应结构与 Rust 版逐条一致——长度上限、轮数上限、枚举校验、配额计数、错误码
- 新字段：`language` 枚举校验、`persona.accent` 校验、`category` 新枚举校验、`reply_translation` 可空
- 中文演练：`language=zh-CN` 时 prompt 走中文模板、`reply_translation` 为 `null`
- 配额：`0` 表示不限量、跨日按 UTC+8 重置、超限 429 且**不调用 LLM**
- 材料解析：DOCX 解压取文、文字版 PDF 抽取、文本量低于阈值置 `likely_scanned`；视觉请求 content parts 组装正确；上游报「不支持图片」映射为 422 `vision_not_supported`
- 隐私：`/material/text` 与 `/material/profile` 的日志中不含材料样本身份串
- 构建：`CGO_ENABLED=0` 下能编出静态二进制（`file` 显示 statically linked）；镜像能在 `scratch` 下起来

**App**
- `rehearse-app` 搬迁后 14 个测试文件全绿
- 现有 App 测试在墨言侧删除后，墨言测试套件仍全绿
- `app.json` 权限面检查：Rehearse 有 CAMERA + 相册 + RECORD_AUDIO + 语音识别；墨言**没有**这四项
- 依赖面检查：`expo-speech-recognition` / `expo-image-picker` / `expo-image-manipulator` / `expo-document-picker` 只出现在 `rehearse-app` 的 `package.json`，墨言的已删净
- 材料导入（§10.2 的新增项）：剪贴板含长文本时出现提示；分段折叠可展开/收起；疑似错误高亮能逐处跳转；超长剪贴板内容不卡顿
- 真机：Rehearse 冷启动 → 登录（共享账号）→ 选场景 → 语音演练 → 总结，全链路
- 真机：**材料导入全链路走一遍**，记录确认页的完成率与耗时（这是 §10.3 决策的依据）
- 墨言：词库 Tab 回归后选词库流程可用；播客播放不受影响（删 `expo-speech-recognition` 后的回归）

**视觉**
- Rehearse 与墨言各自在浅色 / 深色主题下截图，确认两套视觉同族但不互相依赖

## 14. 默认决策表

| 决策 | 默认 |
|------|------|
| 是否拆分 | 拆 |
| 平台 | **只做 App**（iOS + Android），不做 Web |
| 定位 | 职场演练（面试 / 汇报答辩 / 高压对话 / 日常协作） |
| 语言 | 顶层 `language` 字段，中英对等；口音独立为 `persona.accent` |
| 预置场景 | 4 族 14 个，只读，可复制为自定义 |
| 场景 × 语言 | 正交，场景带默认语言，用户可切 |
| 材料上下文 | 任意场景可挂；v1 `kind` 仍只有 `resume` / `job` |
| 材料导入 | 可选增强，非必经路径；v1 走完整三条路径（粘贴 / 文档 / 图片）+ 剪贴板优先 + 分段校对；真机实测后再决定是否收窄（§10.3） |
| 仓库 | 同仓新增 `rehearse-app/` 与 `rehearse-backend/` |
| 后端 | **独立服务，Go 重写**（`net/http` + `modernc.org/sqlite`，无 cgo） |
| 后端端口 | `4324` |
| App 域名 | 业务 `https://rehearse.0x81.uk`；登录 `https://auth.0x81.uk` |
| 运行镜像 | `scratch` / `distroless/static`（静态二进制，无运行时依赖） |
| CI 构建 | `CGO_ENABLED=0 go build` 直出，**不进 Docker builder** |
| 数据库 | **共享同一个 SQLite 文件**；切 WAL + `busy_timeout=5000` |
| 表归属 | `users` / `admin_settings` 共享契约；墨言表墨言独占；`rehearse_usage` Rehearse 独占 |
| 迁移所有权 | v1 由 `moyan-backend` 独占（012 建 `rehearse_usage`）；`rehearse-backend` 只断言 schema |
| **认证方案** | **A：统一登录入口 + 各服务自己验 token**（网关不做认证，`gateway-auth-design.md` §2.3 记录了为什么不选网关方案） |
| **Rehearse 的 auth 面** | 一个约 40 行的 **JWT 验签中间件**。不写 OAuth、不签发、不建号、不需要 `idtoken` |
| **登录入口** | `auth.0x81.uk`；`moyan-app` 同批切换，`moyan-web` **不切**（同源相对路径，切了只会引入跨域） |
| 账号 | 共享 `users` 表；建号逻辑只有认证服务一份 |
| 跨语言契约 | claims + 密钥 + 401 响应形状；双向验签测试是硬门槛 |
| JWT 密钥 | 两个后端读同一个 `JWT_SECRET`，**必须 ASCII**；compose 侧改名可选，不做也能跑 |
| 管理后台 | 复用 `moyan-admin`，Caddy 按路径分流 `/api/admin/settings/rehearse*` |
| bundle id | `uk.0x81.rehearse`；顺手把墨言改成 `uk.0x81.moyan` |
| `/api/coach/*` 别名 | 不保留（无已发布客户端） |
| 数据库改名 | 直接重命名 `coach_usage` → `rehearse_usage`，不双写 |
| 墨言 Tab | 词库回归第 2 位，撤销「全屏页」改动；导流卡放首页 |
| 共享代码 | 纯复制 + 「必须同步」清单；不抽 workspaces 共享包 |
| 系统分享入口 | v2（iOS Share Extension 成本高，§10.2） |
| 数字人 / 视频 | v1 不做（沿用上游稿结论） |
| 演练历史 | 只存本机，v1 不同步 |
| 每日额度 | 沿用现有默认 100 次 / 用户 / 天，UTC+8 重置；管理后台独立配置 |
| 摄像头 | 只用于拍摄纸质简历/材料，不做视频模拟 |

## 15. 待确认

0. **前置依赖**：`2026-10-02-gateway-auth-design.md` 的阶段 1–2 要先做（加 DNS + 网关一条 Host 分支，零风险）。该稿自己有 4 条待确认，其中「`moyan-web` 是否真的不切入口」与评审时的选择有出入
1. **中文演练的 prompt 设计**——§4.4 只给了方向（表达策略 vs 语言正确性），具体 prompt 与评测集需要单独一稿
2. **材料导入是否收窄为「只粘贴文本」**——§10.3 给了判据（真机实测确认页流失率），但不预先决定，实测后定
3. **墨言 Tab 是否真的让词库回归**——§8.3 给了推荐，但这是产品判断，可以否
4. **是否现在就改 env 键名**——§7.7 建议改且不做回落，但要动服务器上的手工部署件
5. **Rehearse 是否需要独立的设计稿**——上游稿的 `moyan-app/design/coach/index.html`（25 屏）能否直接改名复用，还是场景族扩张后需要重做
6. **`moyan-app/design/coach/` 与 `docs/superpowers/verification/2026-09-27-moyan-ai-coach-app.md` 的归属**——前者是 coach 的设计稿，搬迁后应跟着走还是留在墨言目录下
7. **Go module 路径**——`github.com/0x81/rehearse-backend`？仓库是 private，module 路径不影响构建（不需要 `go get`），但要定一个
8. **`rehearse-backend` 是否需要 `go.mod` 的依赖审计**——现有 CI 只做 Rust 的 fmt/clippy/test 门禁，Go 侧要补什么门禁（`go vet` / `golangci-lint` / `go test ./...`）需要定

已在核对中解决的问题（留档）：

- ✅ `RECORD_AUDIO` 在墨言可删（§8.2，已查代码确认）
- ✅ `expo-speech-recognition` / `expo-image-picker` / `expo-image-manipulator` / `expo-document-picker` 在墨言里只被 coach 代码引用，四个可全删（§8.1）
- ✅ `moyan-app/src/app/decks.tsx` 全屏页确实存在、`(tabs)/decks.tsx` 已不存在，§8.3 的撤销动作有明确落点
- ✅ 后端确实 `nest("/api/coach", ...)`（`main.rs:73`），管理端设置键确实是 `admin_settings.coach`（`COACH_SETTING_KEY`）
- ✅ JWT claims 是 `{sub, email, name, exp, iat}`（`middleware/auth.rs:11`），HS256——**Go 侧要复刻它做验签**（§7.4.3）
- ✅ **`argon2` 在代码里根本没被用到**（`Cargo.toml` 里注释写着「for future local auth」），所以没有密码哈希互通问题——auth 全是 OAuth
- ✅ `moyan-admin` 用 `X-Admin-Token`，不走用户 JWT，因此不受本稿任何改动影响
- ✅ `moyan-web` 的 `API_BASE` 是 `import.meta.env.VITE_API_URL || ""`（`backendMode.ts:22`），线上是空串走相对路径——这是「Web 不切登录入口」的依据
- ✅ `sqlx` 的 `SqliteConnectOptions` **没设 journal_mode、没显式设 busy_timeout**（`sqlite.rs:411-432`），共享前必须补（§7.3.1）
- ✅ `sqlx::migrate!("./migrations")` 在启动时无条件执行（`sqlite.rs:432`），这是迁移所有权的现状基础
- ✅ 容器侧 env 键名不带前缀，compose 侧带 `MOYAN_` 前缀（`docker-compose.yml:41-46`）
- ✅ App 的 base URL 来自 `app.config.js` 的 `API_URL` → `extra.apiUrl` → `getApiBase()`，Rehearse 照抄即可
- ✅ 本机 Go 版本 `go1.23.9`（够用，`ServeMux` 的 method+path 模式需要 ≥ 1.22）
