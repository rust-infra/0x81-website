# moyan 打字训练进度与掌握度设计

日期：2026-08-01  
状态：已确认

## 1. 目标与范围

给 moyan-web 打字训练补上真实进度：训练统计能持久化、登录态下同步到云端、打字成绩影响单词掌握度与 SRS 复习排序。

### 要做（v1）

- 后端新增打字统计存储（SQLite）：
  - `type_entries`：每词明细（真实打字统计）
  - `type_sessions`：会话汇总
- 新增接口（独立路由模块，JWT 保护）：
  - `POST /api/type/sync`：批量上传 entries + session，按 id 幂等
  - `GET /api/type/stats`：最近会话、按天趋势、练过卡片的掌握分
- 打字记录流（仅登录 / 后端模式生效）：
  - 切词时统计该词真实打字数据；会话结束（练完 / 退出）批量同步
  - 离谱判定：**跳过 / 放弃，或该词正确率 < 70%**
- 掌握度与 SRS：
  - 每词掌握分（0–100），低分优先出题
  - 会话结束对“离谱”的词按 `again` 更新 SRS（复用现有 `upsertCardProgress` 与 `srs.ts` 的 again 参数）
- 统计页新增“打字训练”区块：最近会话列表 + 每日准确率 / WPM 趋势
- 顺手修复 `TypeTraining.tsx` 已有两处 tsc 报错（727 / 729 行）

### 明确不做（v1）

- 不做本地统计层：IndexedDB `typeHistory` 停止写入（表定义保留，不做 DB 版本迁移）
- 未登录 / 本地模式不记录统计（保留现有 localStorage 断点恢复）
- MongoDB 打字表实现：按 `collect_jobs` 惯例给 stub（当前部署为 sqlite）
- 打字成绩不反向影响背词以外的其它系统

## 2. 架构

```
moyan-web (登录态)
  └─ TypeTraining.tsx
       ├─ 会话内统计 → 结束批量 POST /api/type/sync
       ├─ 进入练习 → GET /api/type/stats（掌握分排序）
       └─ 离谱词 → 复用 upsertCardProgress(again)
  └─ Stats.tsx → GET /api/type/stats（打字区块）

moyan-backend /api/type/*
  ├─ POST /sync   → 写 type_entries / type_sessions（幂等）
  └─ GET  /stats  → 聚合最近会话 / 每日趋势 / 卡片掌握分
         │
         ├─ TypeService
         ├─ SqliteRepositories（type_entries / type_sessions）
         └─ MongoDbRepositories（stub：Configuration 错误，同 collect_jobs）
```

| 单元 | 职责 |
|------|------|
| `TypeService` | 校验、幂等写入、聚合统计 |
| `routes/type.rs` | `/api/type/*` 路由 + JWT 中间件 |
| `TypeTraining.tsx` | 收集打字统计、判定离谱、结束同步、掌握分排序 |
| `Stats.tsx` | 展示最近会话与趋势 |
| `srs.ts` + `upsertCardProgress` | 离谱词的 SRS 调整（复用） |

## 3. 数据模型

### `type_entries`（每词明细）

```sql
CREATE TABLE type_entries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  mode TEXT NOT NULL,              -- 'word' | 'sentence'
  correct_chars INTEGER NOT NULL,
  wrong_chars INTEGER NOT NULL,
  accuracy REAL NOT NULL,          -- 0..1
  wpm REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  egregious INTEGER NOT NULL DEFAULT 0,  -- 跳过/放弃 或 正确率 < 0.7
  created_at TEXT NOT NULL
);
CREATE INDEX idx_type_entries_user_created ON type_entries(owner_user_id, created_at);
CREATE INDEX idx_type_entries_card ON type_entries(owner_user_id, card_id);
```

- `card_id` / `deck_id` 不建外键：卡片删除后历史保留。
- `id` 前缀 `te_`（生成方式与现有 `cjob_` / `card_` 一致）。

### `type_sessions`（会话汇总）

```sql
CREATE TABLE type_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id TEXT,                    -- NULL = 全部词汇
  deck_name TEXT,
  mode TEXT NOT NULL,
  total_cards INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  egregious_count INTEGER NOT NULL DEFAULT 0,
  avg_accuracy REAL NOT NULL,
  avg_wpm REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_type_sessions_user_created ON type_sessions(owner_user_id, created_at);
```

- `id` 前缀 `ts_`。

## 4. 接口

### `POST /api/type/sync`

请求（单会话一次批量）：

```json
{
  "session": {
    "id": "ts_xxx", "deck_id": null, "deck_name": "全部词汇",
    "mode": "word", "total_cards": 30, "completed": 28, "skipped": 2,
    "egregious_count": 5, "avg_accuracy": 0.91, "avg_wpm": 34,
    "duration_ms": 600000, "created_at": "2026-08-01T08:00:00Z"
  },
  "entries": [
    {
      "id": "te_xxx", "card_id": "card_xxx", "deck_id": "deck_xxx",
      "mode": "word", "correct_chars": 10, "wrong_chars": 1,
      "accuracy": 0.91, "wpm": 30, "duration_ms": 4000,
      "egregious": false, "created_at": "2026-08-01T08:00:04Z"
    }
  ]
}
```

- 响应：`{ "saved_session": true, "saved_entries": 10 }`
- 幂等：`INSERT ... ON CONFLICT(id) DO NOTHING`（重复上传不产生重复）。
- 校验：`mode` ∈ {word, sentence}；`accuracy` ∈ [0,1]；`created_at` 为 RFC3339；`entries` 上限（如 2000 条/请求）。

### `GET /api/type/stats`

响应：

```json
{
  "recent_sessions": [
    { "id": "ts_xxx", "deck_id": "deck_xxx", "deck_name": "Rust语言核心",
      "mode": "word", "total_cards": 30, "completed": 28, "skipped": 2,
      "egregious_count": 5, "avg_accuracy": 0.91, "avg_wpm": 34,
      "duration_ms": 600000, "created_at": "2026-08-01T08:00:00Z" }
  ],
  "daily_trend": [
    { "date": "2026-08-01", "sessions": 3, "avg_accuracy": 0.88, "avg_wpm": 31 }
  ],
  "mastery": [
    { "card_id": "card_xxx", "accuracy": 0.6, "egregious_count": 2,
      "score": 30, "last_practiced_at": "2026-08-01T08:00:04Z" }
  ]
}
```

- `recent_sessions`：按 `created_at` 倒序，默认最近 20 条。
- `daily_trend`：按 **UTC 日**聚合（后端无用户时区信息，时间窗 30 天）。
- `mastery`：只返回**该用户练过**的卡片（有 `type_entries`），供排序，避免全量几千条。

## 5. 前端改动

### 打字统计收集（TypeTraining.tsx）

- 统一卡片标识：`cardKey` = 后端模式 `api:{card_id}`；本地模式 `local:{id}`（本地模式不落统计，仅用于现有排序兜底）。
- 切词时把该词真实统计暂存会话内存：`correctChars / wrongChars / accuracy / wpm / durationMs / egregious`。
- 离谱判定（切词时计算）：
  - 点“跳过”或放弃该词 → egregious = true；
  - 否则 `accuracy = correct / (correct + wrong)`，`accuracy < 0.7` → egregious = true。
- 会话结束：
  - 练完整个词库，或 `beforeunload`（防丢失）时，构造 session + entries，`POST /api/type/sync`；失败静默（不阻塞、不重试提示）。
- 进入练习排序：`GET /api/type/stats` → 按 `mastery.score` 升序（低分优先）；无记录卡片保持原顺序。

### SRS 联动

- 会话结束对 egregious 的卡片批量调用现有 `upsertCardProgress`，参数取自 `calculateSRS(card.srs, 'again')`（interval=0、status→learning/relearning、due=now），`Promise.allSettled`，失败静默。

### 统计页（Stats.tsx）

- 新增“打字训练”区块（仅登录态显示）：
  - 最近会话列表（日期 / 词库 / 模式 / 正确率 / WPM / 用时）
  - 每日准确率与 WPM 趋势（复用现有趋势图区域风格）
- 数据源：`GET /api/type/stats`。

## 6. 边界与错误处理

- 未登录 / 本地模式：不记录统计，保留现有 localStorage 断点，训练照常可用。
- 同步失败：静默保留（不弹错、不影响本次训练），下次会话再次尝试。
- 重复上传：按 id 幂等，不产生重复记录。
- 卡片 / 词库删除：`type_entries` / `type_sessions` 保留，统计聚合忽略缺失卡片。
- 超大会话：`entries` 请求体设上限（2000 条），超出则分批（前端按需分片）。

## 7. 测试

### 后端

- `type_sessions` / `type_entries` 幂等写入（同 id 重复上传不重复）
- `GET /api/type/stats` 聚合正确：recent_sessions 排序、daily_trend 按天、mastery 只含练过的卡
- 校验：非法 mode / accuracy 越界 → 400
- Mongo stub 返回 Configuration 错误

### 前端（vitest）

- 离谱判定：跳过 → egregious；正确率 0.69 → egregious；0.70 → 否；0.90 → 否
- 会话统计聚合：completed / skipped / egregious_count / avg_accuracy / avg_wpm 正确
- SRS 批量调用：对 egregious 卡调用 `upsertCardProgress`，参数与 `calculateSRS('again')` 一致
- `TypeTraining.tsx` tsc 报错修复后 `npm run check` 通过（该文件原有 2 处报错）

## 8. 后续（不在 v1）

- 未登录本地统计层（若未来需要离线完整统计）
- MongoDB 打字表实现
- 打字成绩与背词 SRS 双向融合（如准确率影响间隔系数）
