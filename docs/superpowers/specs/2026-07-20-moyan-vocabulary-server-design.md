# Moyan 词库服务端化设计

## 目标

将词库、卡片和学习进度迁移到服务端，支持按用户隔离数据，并为后续系统词库管理后台提供稳定边界。

本期不支持用户导入 Anki 或 CSV 词库，不处理旧本地数据迁移。

## 设计决策

- `decks` 同时保存系统词库和用户自建词库。
- `decks.ownerUserId = "system"` 表示系统词库；其他值必须为真实用户 ID。
- `cards` 只以 `deckId` 关联词库，不重复保存 `ownerUserId` 或来源字段。
- 卡片例句使用 `examples` JSON 数组，不建立 `card_examples` 表。
- 用户学习状态独立存入 `card_progress`，复习历史独立存入 `review_logs`。
- 系统词库只读，后续仅允许管理员通过管理后台维护。

## 数据模型

### users

保留现有身份字段，并新增：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | `active`、`disabled`，默认 `active` |
| `role` | string | `user`、`admin`，默认 `user` |
| `lastLoginAt` | datetime | 最近一次成功登录时间 |
| `systemDecksInitializedAt` | datetime | 首次完成系统词库可用性检查的时间 |

### decks

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 词库 ID |
| `ownerUserId` | string | `"system"` 或用户 ID |
| `sourceKey` | string? | 系统词库的稳定唯一键；用户词库为空 |
| `name` | string | 词库名称 |
| `description` | string | 描述 |
| `color` | string? | 前端展示颜色 |
| `version` | integer | 系统词库内容版本，默认 `1` |
| `sortOrder` | integer | 同类词库排序，默认 `0` |
| `isActive` | boolean | 是否向普通用户展示，默认 `true` |
| `createdAt` | datetime | 创建时间 |
| `updatedAt` | datetime | 更新时间 |

约束：系统词库的 `(ownerUserId, sourceKey)` 唯一；用户词库只允许拥有者读写。

### cards

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 卡片 ID |
| `deckId` | string | 所属词库 ID |
| `front` | string | 正面，单词或问题 |
| `back` | string | 背面，释义或答案 |
| `pronunciation` | string? | 音标或读音提示 |
| `tags` | JSON array | 标签数组，默认 `[]` |
| `examples` | JSON array | 结构化例句数组，默认 `[]` |
| `createdAt` | datetime | 创建时间 |
| `updatedAt` | datetime | 更新时间 |

`examples` 的每一项为：

```json
{
  "id": "ex_01J...",
  "sentenceEn": "Redis uses eviction policies when the memory limit is reached.",
  "translationZh": "Redis 在达到内存限制时使用淘汰策略。"
}
```

数组顺序即展示顺序。例句 ID 用于管理后台和用户词库的精确修改、删除；`sentenceEn` 与 `translationZh` 均为必填非空字符串。

MongoDB 将 `tags`、`examples` 以 BSON 数组存储。SQLite 开发实现以 JSON 文本存储，并在仓储层完成序列化与反序列化，保证 API 类型一致。

### card_progress

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 进度 ID |
| `ownerUserId` | string | 学习用户 ID |
| `cardId` | string | 卡片 ID |
| `srsStatus` | string | `new`、`learning`、`review`、`relearning` |
| `interval` | number | 当前复习间隔 |
| `repetitions` | integer | 连续成功次数 |
| `easeFactor` | number | 容易度因子 |
| `dueDate` | datetime | 下次复习时间 |
| `lastReviewedAt` | datetime? | 最近复习时间 |
| `createdAt` | datetime | 创建时间 |
| `updatedAt` | datetime | 更新时间 |

对 `(ownerUserId, cardId)` 建立唯一约束。同一系统卡片可被多个用户分别学习。

### review_logs

保留复习记录的用户、卡片、词库、评级、耗时与复习时间。`deckId` 保留用于按词库统计与历史查询。

## 初始化与访问控制

系统词库只在平台侧保存一份，不复制到用户名下。

1. 用户登录成功后，后端确保系统词库已存在且可用。
2. 后端写入 `users.systemDecksInitializedAt`，该写入仅表示检查完成，不创建词库副本。
3. 词库列表接口同时返回活跃系统词库与当前用户自建词库。
4. 用户首次学习某张卡时，创建自己的 `card_progress`；之后按 `(ownerUserId, cardId)` 更新。

权限由服务端从认证上下文确定，客户端请求中的 `ownerUserId` 一律不可信。

- 系统词库和卡片：普通用户只读，管理员经 `/api/admin/*` 管理。
- 用户词库和卡片：仅拥有者可读写。
- 他人资源：统一返回 `404`，避免泄露资源存在性。
- 系统词库下架：停止向普通用户展示，不删除既有卡片、进度或日志。

## API

### 用户端

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/decks` | 获取系统词库和我的词库 |
| `POST` | `/api/decks` | 创建我的词库 |
| `PUT` | `/api/decks/:deckId` | 更新我的词库 |
| `DELETE` | `/api/decks/:deckId` | 删除我的词库与其卡片 |
| `GET` | `/api/decks/:deckId/cards` | 获取词库卡片与 `examples` |
| `POST` | `/api/decks/:deckId/cards` | 向我的词库创建卡片 |
| `PUT` | `/api/cards/:cardId` | 更新我的卡片 |
| `DELETE` | `/api/cards/:cardId` | 删除我的卡片 |
| `GET` | `/api/decks/:deckId/study-cards` | 获取卡片与当前用户学习进度 |
| `PUT` | `/api/card-progress/:cardId` | 创建或更新当前用户进度 |
| `POST` | `/api/review-logs` | 写入当前用户复习记录 |

### 管理端（后续）

`/api/admin/decks` 与 `/api/admin/cards` 仅向 `role = "admin"` 开放，用于维护 `ownerUserId = "system"` 的词库和卡片，包括创建、编辑、上下架、排序及版本发布。

## 前端改造

- 词库列表拆分“系统词库”和“我的词库”，删除 Anki/CSV 导入入口。
- 系统词库详情页只读，不展示卡片或词库编辑、删除、导出操作。
- 用户词库详情页保留编辑能力，例句编辑器以中英文配对的可增删列表呈现。
- 学习页改用 `study-cards` 接口，不再把 SRS 状态写入卡片数据。
- 卡片 API 统一接收和返回 `examples: []`，不再使用旧 `example` 单字符串字段。

## 验收标准

- 新用户无需导入操作即可看到系统词库。
- 两个用户学习同一系统卡片时，复习状态和日志互不影响。
- 普通用户无法编辑、删除或下架系统词库与卡片。
- 用户无法读取或修改其他用户的词库、卡片和进度。
- 系统与用户词库中的卡片均可保存多条例句，每条例句有完整英文和中文翻译。
- MongoDB 与 SQLite 对外返回相同的 `tags`、`examples` JSON 类型。
