# moyan-admin 后台管理系统设计

日期：2026-07-22  
状态：已确认（待实现计划）

## 1. 目标与范围

为墨言（moyan）提供独立管理后台，目录为 `moyan-admin/`。

### 第一期要做

- **内容运营**：系统词库（系统卡组 / 卡片）CRUD；Excel 导入（`merge` / `replace_deck`）与导出；JSON 备份导出
- **用户管理**：列表（分页 + 模糊搜索）、启停、改 role、用户详情（卡组摘要 + 同步摘要，只读）
- **鉴权**：`ADMIN_TOKEN` + 请求头 `X-Admin-Token`；登录页填入 token

### 第一期明确不做

- 运营看板 / 统计图表
- 正式 OAuth 管理员登录
- 编辑用户个人卡片内容
- 导入时软删除「文件中未出现」的卡组或卡片（`merge` 模式）

## 2. 架构

独立 SPA + 扩 `moyan-backend` Admin API（方案 1）。

```
Browser
  ├─ moyan.0x81.uk      → moyan-web :5000
  │                         └─ /api/* (JWT) → moyan-backend :4323
  └─ admin.moyan.0x81.uk → moyan-admin :5001
                            └─ /api/admin/* (X-Admin-Token) → moyan-backend :4323
```

### 边界

| 单元 | 职责 | 依赖 |
|------|------|------|
| `moyan-admin/` | Ant Design 管理台 UI | `moyan-backend` Admin API |
| `moyan-backend` `/api/admin/*` | Admin 业务、Excel 解析、鉴权中间件 | 现有 Repository / 同库 |
| `website-rs` / Compose | Host 路由到 admin 静态站 | `moyan-admin` 容器 |

- Admin 路由与用户 JWT 路由隔离，同库同模型
- 系统词库操作 `owner = system` 的 decks/cards
- 用户详情只读摘要，不提供用户侧卡片写接口

## 3. 前端（moyan-admin）

### 技术栈

- React + Vite + TypeScript
- **Ant Design / Ant Design Pro** 布局、表格、表单、分页、上传
- 不要求与 `moyan-web`（shadcn）视觉对齐；后台优先开发效率

### 页面

| 页面 | 能力 |
|------|------|
| 登录 / 解锁 | 输入 ADMIN Token；校验 `GET /api/admin/ping`；存 `sessionStorage` |
| 系统卡组 | 列表（分页 + `q`）、新建、编辑元数据、启停、排序 |
| 卡组内卡片 | 列表（分页 + `q`）、增删改 front/back/发音/标签/例句 |
| 导入 / 导出 | 下载 Excel 模版；上传导入（选 mode）；导出 Excel / JSON |
| 用户列表 | 搜索、分页、启停、改 `role` |
| 用户详情 | 基本信息 + 卡组摘要 + 同步摘要（只读） |

### 登录行为

1. 未解锁时首屏为登录卡：密码型 Token 输入框（可切换显示）
2. 「进入后台」→ `GET /api/admin/ping`，Header `X-Admin-Token`
3. 成功：写入 `sessionStorage`；后续请求自动带该 Header
4. 任意接口 `401`：清 token，跳回登录页
5. 右上角「锁定」：手动登出

Token 不写 `localStorage`。

### 列表 UX

- Ant Design `Table` + `Pagination` + 搜索框（防抖）
- 统一查询：`q`、`page`（从 1）、`page_size`（默认 20，上限 100）、`sort`、`order`

## 4. Excel 模版与导入

### 模版格式：`.xlsx`，两个工作表

**Sheet `Decks`**

| 列 | 必填 | 说明 |
|----|------|------|
| name | 是 | 卡组名 |
| description | 是 | 描述 |
| color | 否 | 色值 |
| source_key | 否 | 稳定业务键；有则优先用于匹配 |

**Sheet `Cards`**

| 列 | 必填 | 说明 |
|----|------|------|
| deck_name | 是 | 对应 `Decks.name` |
| front | 是 | 正面 |
| back | 是 | 背面 |
| example | 否 | 例句文本；导入时映射为 `examples` 数组（单条或空） |
| pronunciation | 否 | 发音 |
| tags | 否 | 逗号分隔 |

后台提供「下载模版」（表头 + 一行示例）。导出 Excel 时，若卡片有多条 `examples`，合并为可读文本（实现时定一种稳定格式，如换行拼接）。

### 导入模式

| mode | 行为 |
|------|------|
| `merge`（默认） | 见下：upsert，不删文件外已有数据 |
| `replace_deck` | 对文件中出现的卡组：更新元数据后清空该卡组全部卡片，再按文件全量写入；未出现的卡组不动 |

UI：上传时单选 mode；选 `replace_deck` 需二次确认。

### `merge` 规则

**卡组**

1. 有 `source_key`：按 `source_key` 匹配系统卡组 → 更新 `name/description/color`；否则新建
2. 无 `source_key`：按 `name` 精确匹配 → 更新；否则新建（自动生成 `source_key`，如 slug）
3. 文件中未出现的已有卡组：**不删除**

**卡片**

1. 用 `deck_name` 解析目标卡组；找不到 → 该行失败
2. 同一卡组内按 `front` 精确匹配：存在则更新 `back/example/pronunciation/tags`，否则新建
3. 文件中未出现的已有卡片：**不删除**

### 事务与校验

- 任一行校验失败 → **整批回滚**，返回 `{ errors: [{ sheet, row, field, message }] }`
- 成功返回：`created_decks` / `updated_decks` / `created_cards` / `updated_cards`
- SQLite：单事务保证原子性；MongoDB 路径注明与现有架构一致的一致性差异，第一期优先保证 SQLite 正确

## 5. Admin API

前缀：`/api/admin/*`  
鉴权：`admin_token_middleware`，Header `X-Admin-Token`，环境变量 `ADMIN_TOKEN`  
`ADMIN_TOKEN` 未配置 → 全部 admin 接口 `503`（禁止空密钥放行）

### 鉴权与健康

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/ping` | 校验 token |

### 系统词库

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/decks` | 列表（分页 + `q`：name/description/source_key） |
| POST | `/api/admin/decks` | 新建 |
| PUT | `/api/admin/decks/{id}` | 改元数据 / 启停 / 排序 |
| DELETE | `/api/admin/decks/{id}` | 删除（级联卡片） |
| GET | `/api/admin/decks/{id}/cards` | 卡片列表（分页 + `q`：front/back/tags） |
| POST | `/api/admin/decks/{id}/cards` | 新建卡片 |
| PUT | `/api/admin/cards/{id}` | 更新卡片 |
| DELETE | `/api/admin/cards/{id}` | 删除卡片 |
| GET | `/api/admin/vocabulary/template.xlsx` | 下载 Excel 模版 |
| POST | `/api/admin/vocabulary/import` | multipart 上传；`mode=merge\|replace_deck` |
| GET | `/api/admin/vocabulary/export.xlsx` | 导出 Excel |
| GET | `/api/admin/vocabulary/export.json` | 导出 JSON 备份 |

### 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 列表；`q` 搜 email/name/id；可筛 `status`/`role`；分页 |
| GET | `/api/admin/users/{id}` | 详情 + 卡组摘要 + 同步摘要 |
| PATCH | `/api/admin/users/{id}` | 改 `status`（`active` / `disabled`）与/或 `role`（`user` / `admin`） |

### 列表响应形状

```json
{
  "items": [],
  "page": 1,
  "page_size": 20,
  "total": 0
}
```

### 后端分层

遵循现有 `route → controller → service → repository`：

- 新增 `routes/admin.rs`、`controllers/admin_*`、`services/admin.rs`（或拆分 vocabulary/users）
- 复用现有 Repository；不足则扩展契约（分页查询、系统卡组 upsert、用户列表等）
- Controller 不直接 SQL；Excel 解析在 Service 层

## 6. 错误处理与安全

| 情况 | 行为 |
|------|------|
| 缺/错 token | `401`；前端清 session 并跳登录 |
| `ADMIN_TOKEN` 未配置 | `503` |
| 导入/字段校验失败 | `400` + 行级 `errors` |
| 资源不存在 | `404` |

安全：

- Admin API 不暴露用户个人卡片写操作
- CORS：`ALLOWED_ORIGINS` 须包含 admin 前端 origin
- 生产可后置 IP 限制 / 基础鉴权（非第一期必做）

## 7. 部署

- `moyan-admin/`：Vite 构建静态资源，Compose 端口建议 `5001`
- 网关：`admin.moyan.0x81.uk` → `moyan-admin`；`/api` 反代 `moyan-backend :4323`
- 环境变量：`ADMIN_TOKEN`（必填）、`ALLOWED_ORIGINS`；前端 `VITE_API_URL`

改动面：

```
moyan-admin/          # 新建
moyan-backend/        # /api/admin/*、Excel、分页查询
website-rs / compose  # admin Host
docs/superpowers/...  # 本设计
```

## 8. 测试

**Backend**

- Token 中间件：缺 / 错 / 对；未配置 `ADMIN_TOKEN` → 503
- 卡组 / 卡片 CRUD
- 用户 PATCH（status/role）
- 列表分页 + `q` 模糊
- Excel import：`merge` 与 `replace_deck`；失败整批回滚

**Frontend**

- 登录解锁与 401 跳转
- 列表搜索 / 分页关键路径

## 9. 成功标准

1. 运维可用 ADMIN Token 登录后台并管理系统词库
2. 可用 Excel 模版导入（两种 mode）并导出备份
3. 可分页/搜索用户并启停、改角色；可查看用户只读摘要
4. 未配置或错误 token 无法访问 Admin API
