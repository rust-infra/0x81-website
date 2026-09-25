# Moyan 业务逻辑梳理

> 本文以 `moyan-web` / `moyan-backend` 当前实现为准。最后核对：2026-07-20。

## 1. 产品定位

Moyan 是一个以英语词汇记忆为核心的 Web 应用。

当开启**服务端为权威**模式时，词库与学习进度以**服务端为权威**：系统词库共享一份（`owner_user_id = "system"`），用户自建词库与 `card_progress` / `review_logs_v2` 按用户隔离；登录成功后后端会确保系统词库可用。关闭时仍可走 IndexedDB 本地模式（不含 Anki/CSV 导入）。

开关只看 `VITE_SERVER_MODE` / `VITE_API_URL` / 是否生产构建（实现见 `moyan-web/src/services/backendMode.ts`），**不再**把「`VITE_API_URL` 非空」当作唯一依据：线上同源部署时该变量故意为空，旧判断会让前端静默退回本地模式。

用户闭环：

1. 登录后查看系统词库与自建词库（后端模式）。
2. 学习页通过 `study-cards` 拉取卡片与进度，评分后写回 `card-progress` 与 `review-logs`。
3. 用户词库可编辑卡片与多条例句（`examples: [{sentence_en, translation_zh}]`）；系统词库只读。
4. 打字训练与语音播放仍可用；后端模式下按牌组从 API 拉卡。

```mermaid
flowchart LR
  SEED[system vocabulary seed] --> DECKS[(decks/cards)]
  LOGIN[login] --> SEED
  UI[Decks/Study] --> API[/api/decks study-cards card-progress]
  API --> DECKS
  API --> PROG[(card_progress)]
  API --> LOGS[(review_logs_v2)]
```

## 2. 用户入口与页面职责

| 路由 | 页面职责 | 主要业务行为 |
| --- | --- | --- |
| `/` | 首页 | 后端模式下列出服务端词库；本地模式初始化内置词库并统计到期卡。 |
| `/study`、`/study?deck=<id>` | 词卡学习 | 后端模式需指定牌组，调用 `study-cards` + 进度/日志 API。 |
| `/type`、`/type?deck=<id>` | 打字训练 | 后端模式从 API 拉卡；例句优先用 `examples[0].sentence_en`。 |
| `/decks` | 牌组管理 | 系统词库 / 我的词库；创建/删除自建词库；**无** Anki/CSV 导入。 |
| `/decks/:id` | 卡片管理 | 系统只读；用户词库可编辑，例句为中英配对列表。 |
| `/stats` | 学习统计 | 展示当日汇总等（本地统计仍主要来自 IndexedDB）。 |
| `/settings` | 偏好与数据管理 | 语言、主题、语音、全量备份/恢复、清空数据、全牌组 Anki 导出、登录状态。 |
| `/login` | 可选登录 | 支持 Google 与 Kimi 登录，也允许跳过。 |

底部导航仅覆盖首页、牌组、统计和设置；学习与训练是从首页/牌组进入的沉浸式流程。

## 3. 核心数据模型与存储

数据库名称为 `MoyanDB`，由 Dexie 管理 IndexedDB。业务主数据如下。

| 实体 | 关键字段 | 用途 |
| --- | --- | --- |
| `Deck` | `name`、`description`、`cardCount`、`color`、创建/更新时间 | 牌组元数据。 |
| `Card` | `deckId`、`front`、`back`、`example`、`pronunciation`、`tags`、`srs` | 一张词卡；正面通常是英文单词，背面通常是释义。 |
| `SRSData` | `interval`、`repetitions`、`easeFactor`、`dueDate`、`status` | 卡片记忆状态和下一次到期时间。 |
| `ReviewLog` | `cardId`、`deckId`、`rating`、评分耗时、前后间隔/难度因子 | 每次词卡评分的审计数据，也是统计来源。 |
| `StudyHistory` | `rating`、总用时、翻面前用时、学习方向 | 用于学习页智能排序与体验指标。 |
| `TypeHistory` | 模式、正确/错误字符、准确率、WPM、时长 | 用于打字训练排序与训练记录。 |
| `AppSettings` | `key`、`value` | 已建表，但当前主要偏好仍写入 `localStorage`。 |

除 IndexedDB 外，`localStorage` 保存学习/训练断点、学习方向、登录令牌与用户资料、语音配置、主题语言等轻量偏好；音频缓存位于运行时内存。

## 4. 词库与牌组生命周期

### 4.1 内置词库初始化

首页加载时会请求 `/vocabulary.json` 并执行 `initVocabularyDecks()`：

1. 若本地无相同名称的词库牌组，则创建牌组和所有词卡；新卡的初始状态为 `new`、间隔 0、难度因子 2.5、立即到期。
2. 若已有卡片，只按“`deckId + front`”补充缺少的词卡，不覆盖现有卡的 SRS 状态。
3. 若检测到历史的“第 N 天”牌组，会删除这些旧牌组和卡片后重建“30 天词汇”。
4. 若检测到不属于当前内置词库的旧牌组，当前实现会清空牌组、卡片和复习日志后重新初始化。

**注意：** 第 4 条与“自定义/导入牌组应长期保留”的直觉有冲突，是当前实现中最需要谨慎对待的数据规则。

### 4.2 手工管理与导入

- 新建牌组只要求非空名称；初始卡片数为 0。
- 新增卡片要求正面和背面非空，初始为立即到期的新卡；编辑卡片保留原有 SRS 状态。
- 删除牌组会删除其关联卡片；删除单卡会同步减少 `cardCount`。
- CSV 导入创建一个以文件名命名的新牌组，将前五列解析为 `front`、`back`、`pronunciation`、`example`、`tags`。
- Anki 导入读取 `.apkg` 中的 `collection.anki2`，最多处理 1,000 条 note；首个 Anki 牌组名作为 Moyan 牌组名，同名牌组会拒绝导入。

### 4.3 导出与备份

- 单牌组可导出简化的 `.apkg` 或 CSV；设置页可逐个下载全部牌组的 `.apkg`。
- 全量 JSON 备份包含 `decks`、`cards`、`reviewLogs`；恢复时会先清空这三类表再批量写入。
- 全量备份和同步均未包含 `StudyHistory`、`TypeHistory`、语音配置、学习断点或主题/语言偏好。

## 5. 词卡学习与间隔重复

### 5.1 选卡与排序

学习页接收可选的 `deck` 参数：

- 指定牌组：读取该牌组全部卡片，不按到期时间过滤。
- 未指定牌组：读取到期卡；若没有到期卡，则取最多 20 张新卡。

之后执行确定性的“智能排序”：从 `StudyHistory` 汇总每张卡的历史，未练过的新卡优先级为 1000；已练卡的权重为 `错误次数 × 100 - 正确次数 × 30 + 距上次练习天数 × 5`。权重高者先出现，同分按卡片 ID 升序。该排序影响本次呈现顺序，但不替代 SRS 到期判断。

学习方向可以选择英译中（默认）或中译英，保存在 `moyan_study_mode`。翻面后可自动依次朗读正反面和例句；离开前会保存当前卡的断点，完成当前队列后清除断点。

### 5.2 评分与 SRS 状态迁移

用户评分后，系统同时更新卡片 SRS、写入 `ReviewLog` 和 `StudyHistory`，再在 400ms 后进入下一张。

| 评分 | 重复次数与间隔 | 难度因子 | 状态 |
| --- | --- | --- | --- |
| `again` | 重复次数归零，间隔 1 天 | 最低 1.3，当前值减 0.2 | `relearning` |
| `hard` | 第 1 次为 1 天，第 2 次为 3 天，其后为旧间隔 × 1.2 | 最低 1.3，当前值减 0.15 | `review` |
| `good` | 第 1 次为 1 天，第 2 次为 3 天，其后为旧间隔 × 旧难度因子 | 不变 | `review` |
| `easy` | 第 1 次为 3 天，第 2 次为 5 天，其后为旧间隔 × 旧难度因子 × 1.3 | 当前值加 0.15 | `review` |

所有评分的 `dueDate` 均设置为“当前时间 + 新间隔天数”，并记录 `lastReviewed`。到期判定使用 `dueDate <= 当前时刻`。

**实现说明：** 代码注释称该算法为 SM-2，但它是简化变体，并未实现学习阶段的分钟级队列、每日新卡上限、上限间隔或 Anki 完整的 lapse 规则。`learning` 状态已定义但当前评分逻辑不会产生该状态。

## 6. 打字训练

打字训练与复习 SRS 独立，不会改变卡片的到期时间。

- 可以在单词模式输入 `front`，或在例句模式输入例句；若例句不含该单词，则目标文本为“释义（单词）”。
- 例句模式只要求输入目标单词所在字符，其余字符预先视为完成。
- 每次按键都记录正确/错误，退格可回退到上一个需输入字符；空格在当前目标不需要空格时会播放单词，Enter 跳过当前卡。
- 完成一张（未跳过）卡会写入 `TypeHistory`；当前实现调用时传入的正确率、WPM、时长均为 0，因此单条历史记录没有完整指标。
- 排序规则为未训练卡优先；已训练卡按 `-训练次数 × 30 + 距上次训练天数 × 5` 排序。训练会保存断点，结束时展示本次 WPM、准确率、完成数和耗时。

## 7. 统计口径

统计只基于 `ReviewLog`，不包含打字训练。

- **今日复习量：** 本地当天 00:00 至次日 00:00 的日志数。
- **今日正确率：** `good` 与 `easy` 日志数 / 今日日志数；`again` 与 `hard` 均视为不正确。
- **待复习量：** 全部 `dueDate <= 当前时刻` 的卡数。
- **总卡与新卡：** 分别为所有卡片数、`status = new` 的卡片数。
- **近七日：** 每个自然日的日志数。
- **连续学习天数：** 从今天起向前检查，只要当天有至少一条复习日志就累加，遇到没有记录的日期即停止。

首页“记忆进度”不是 SRS 掌握率，而是 `status != new` 的卡片占总卡片数；其展示的“连续”数实际使用当日复习数量。

## 8. 账号、同步与外部服务

### 8.1 登录

登录是可选项。Google 使用 Google Identity Services 取得用户资料；Kimi 使用 OAuth Device Flow，在新窗口完成授权后轮询令牌。当前用户资料和令牌写在 `localStorage`，页面通过内存监听器广播登录状态。

当开启服务端模式时（见 §1 的开关说明），Kimi 令牌会换取后端令牌；另有 Rust 后端的 Google 回调和“当前用户”接口实现。关闭后端时，Kimi 会在前端尝试解析令牌，Google 仅取得用户资料。

后端只接受通过 HS256 校验的 JWT（密钥 `JWT_SECRET` / compose 的 `MOYAN_JWT_SECRET`）。无法通过校验的 Bearer 值**默认直接 401**；只有显式设 `ALLOW_LEGACY_TOKEN_AUTH=1`（`moyan-backend/dev-run.sh` 在本地开发时设）才会回落到「按 token 哈希自动建号」的 legacy 兜底——那是开发便利，线上开等于没有鉴权。

### 8.2 同步

同步由 `moyan:sync-upload` 和 `moyan:sync-download` 浏览器事件触发，UI 在用户菜单中派发事件。

| 条件 | 上传 | 下载/恢复 |
| --- | --- | --- |
| 配置 `VITE_API_URL` | 携带 Bearer token，POST `/api/sync/upload` | GET `/api/sync/download`，携带 Bearer token |
| 未配置后端 | 将序列化数据写到按用户区分的 `localStorage` | 从同一浏览器的 `localStorage` 读取 |

同步内容仅为牌组、卡片和复习日志。下载采用合并策略：不存在的牌组/卡片/日志会新增；已存在卡片通过“同牌组 + 相同正面”识别，并保留本地 SRS；日志以“相同卡片 + 相同复习时间”去重。

**限制/注意：** 无后端时的“同步”只是同一浏览器存储中的备份，并不能跨设备。合并还依赖本地数据库 ID 及卡面文本，跨设备新建的牌组/卡片可能出现 ID 冲突、重复或关联不一致；它不是严格的双向冲突解决方案。

### 8.3 语音

默认使用浏览器 Web Speech API。用户可在本地配置 ElevenLabs、Google Cloud TTS 或阿里云百炼的 API Key、音色与语速。中英混合文本会按语言片段顺序播放；第三方服务调用失败时会降级为浏览器语音。生成的音频可驻留在内存缓存中，不写入数据库。

**安全注意：** 第三方语音 API Key 目前保存于浏览器 `localStorage`，并从前端直接发往服务商；不适合放置共享、高权限或生产级密钥。

## 9. 模块边界与代码入口

| 模块 | 责任 | 主要文件 |
| --- | --- | --- |
| 路由与全局 Provider | 页面分发、主题、同步事件和通知 | `moyan-web/src/App.tsx`、`components/SyncProvider.tsx` |
| 本地数据层 | Dexie 表定义、到期卡和汇总统计 | `moyan-web/src/db.ts` |
| 学习引擎 | SRS 计算、学习会话、学习历史排序 | `services/srs.ts`、`pages/Study.tsx` |
| 训练引擎 | 打字交互、训练排序、断点和训练历史 | `pages/TypeTraining.tsx` |
| 内容管理 | 词库初始化、牌组/卡片 CRUD、Anki/CSV 编解码 | `services/vocabularyLoader.ts`、`services/anki.ts`、`pages/Decks.tsx`、`pages/DeckDetail.tsx` |
| 账号与同步 | OAuth、令牌/用户状态、后端或本地备份同步 | `services/authService.ts`、`services/syncService.ts` |
| 语音 | 配置、TTS 服务适配、混合语言播放、缓存 | `services/speechService.ts`、`components/SpeechSettingsPanel.tsx` |
| 展示与偏好 | 首页、统计、设置、主题和国际化 | `pages/Home.tsx`、`pages/Stats.tsx`、`pages/Settings.tsx`、`theme.ts`、`i18n/` |

## 10. 建议优先确认的产品规则

以下结论来自当前实现，建议在后续需求或后端联调前明确：

1. 内置词库初始化是否允许清空用户导入的牌组与复习数据。
2. 指定牌组学习是否应只取到期卡，还是保持“全量练习”的当前语义。
3. 学习状态是否需要补齐 `learning` 队列、每日新卡上限和更完整的复习策略。
4. 全量备份/同步是否应覆盖学习历史、打字历史和偏好设置。
5. 多设备同步是否需要稳定的全局 ID、删除墓碑和明确的冲突规则。
6. 第三方语音密钥是否应迁移到后端代理或浏览器安全存储策略。

## 11. 代码依据

- 数据模型、到期规则与汇总统计：`moyan-web/src/db.ts`
- 间隔重复计算：`moyan-web/src/services/srs.ts`
- 词卡会话和历史排序：`moyan-web/src/pages/Study.tsx`
- 打字训练：`moyan-web/src/pages/TypeTraining.tsx`
- 词库、导入导出：`moyan-web/src/services/vocabularyLoader.ts`、`moyan-web/src/services/anki.ts`
- 同步和认证：`moyan-web/src/services/syncService.ts`、`moyan-web/src/services/authService.ts`
- 语音：`moyan-web/src/services/speechService.ts`
- 牌组、统计、设置页面：`moyan-web/src/pages/Decks.tsx`、`moyan-web/src/pages/DeckDetail.tsx`、`moyan-web/src/pages/Stats.tsx`、`moyan-web/src/pages/Settings.tsx`
