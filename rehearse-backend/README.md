# rehearse-backend

Rehearse（职演）的 API 服务。Go + gin，独立于墨言后端。

设计稿：`docs/superpowers/specs/2026-10-02-rehearse-design.md`

## 三条硬约束

**1. 只验签，不签发。** 登录入口是 `auth.0x81.uk`（由认证服务提供）。
本服务不实现 OAuth、不签发 token、不建号、**不读也不写 `users` 表**。
用户身份来自 JWT 的 `sub`。

⚠️ 也**没有** legacy token 兜底分支（moyan-backend 有个 `ALLOW_LEGACY_TOKEN_AUTH`
开关，线上必须关闭）。那个分支的存在本身就是「随手编一个 Bearer 就能读到自己名下
数据」的洞，所以这边从第一天起就不带它。

**2. 自己的库，不共享任何表。** 只有 `rehearse_usage` 与 `rehearse_settings`
两张表。迁移由本仓库自己管，与墨言的迁移**没有顺序依赖**。

后端**由 `DATABASE_URL` 的 scheme 选**（`internal/store/open.go`）：

| DSN | 后端 | 用在哪 |
|---|---|---|
| `postgres://…` | 托管 Postgres（Supabase，只当 PG 用） | **生产**。要 pooler 端口 + `sslmode=require` |
| `sqlite:<path>` | 本地 SQLite 文件 | 单机自托管、本地开发、测试 |

⚠️ 只认显式 scheme，裸路径会被拒绝——打错一个字母就静默在别处新建一个空库，
比启动失败难查得多。
⚠️ **SQLite 只用于单副本**：多进程写同一文件靠文件锁，跨容器 / 网络卷会**静默**失效。

**3. 跨语言契约必须逐字段对齐。** 与 `moyan-backend` 共享的只有四件事：
JWT claims（含 `status`）、HS256 密钥、错误信封形状、`status` 判定语义。
任何一处不一致，客户端就得写两套错误处理。

## 本地跑起来

**不依赖任何外部数据库**（SQLite，默认）：

```sh
export JWT_SECRET='dev-only-any-ascii-value'
make run-sqlite          # 建 data/ → 跑迁移 → 起服务
```

也可以不写 `make run-sqlite`，直接：

```sh
export JWT_SECRET='dev-only-any-ascii-value'
go run ./cmd/rehearse   # DATABASE_URL 未设置时自动回落到 sqlite:./data/rehearse.db
```

**连 Postgres**：

```sh
export DATABASE_URL='postgres://...:6543/postgres?sslmode=require'   # 见下
export JWT_SECRET='与 moyan-backend 相同的值'
go run ./cmd/migrate up
go run ./cmd/rehearse
```

然后：

```sh
curl localhost:4324/health
curl -H "Authorization: Bearer $TOKEN" localhost:4324/api/rehearse/whoami
```

### `DATABASE_URL` 必须是 pooler 安全的

连 Supabase 要用 **pooler 端口 6543**（transaction 模式）。该模式**不支持
prepared statement**，所以 DSN 里要带：

```
?sslmode=require&default_query_exec_mode=exec
```

`default_query_exec_mode` **不写也会被自动补成 `exec`**（见
`internal/store/postgres.go` 的 `EnsurePoolerSafeDSN`）——本地 PG 上没有 pooler，
写错模式照样跑得好好的，只有连到 Supabase 才炸，所以这件事做成了代码约束
而不是文档提醒。

⚠️ 参数名是 `default_query_exec_mode`，**不是** v4 时代的 `statement_cache_mode`。
网上大量「用 `statement_cache_mode=describe`」的建议是 v4 写法，照抄会静默不生效；
而且它对应的 v5 模式 `describe_exec` 恰恰是 transaction pooler 下**不能**用的那个
（它要 2 次 round trip，而 pooler 会在两次之间切换连接）。

### 用 SQLite 时要注意的几件事

- **目录不会自动创建。** SQLite 不替调用方建父目录，缺了直接
  `unable to open database file`。`make run-sqlite` / `make migrate-up-sqlite`
  会先 `mkdir -p`；手工起的话自己建。
  （代码**刻意不做**自动 mkdir——容器里自动建目录会把「卷没挂上」变成静默的数据丢失。）
- **容器里必须挂卷。** compose 已加 `rehearse-data:/data`；Dockerfile 里 `/data`
  已 `chown 65534`（named volume 首次挂载会把镜像里该目录的属主一起复制进卷，
  否则非 root 进程写不进去）。
- **PRAGMA 是代码补的，不用自己写。** `store.EnsureSQLiteDSN` 会追加
  `busy_timeout(5000)` / `journal_mode(WAL)` / `synchronous(NORMAL)` /
  `foreign_keys(1)`，且追加在已有参数之后（冲突时以本服务的值为准）。
  忘了 WAL 在单进程下看不出来，只有并发起来才暴露，症状是随机的 `database is locked`。
- **两套迁移按方言分目录**：`migrations/postgres/` 与 `migrations/sqlite/`，
  **版本号必须对齐**。`cmd/migrate` 按方言自己挑，不用管。

## 依赖

**能用库就不手写**（2026-10-04 定）。现在的直接依赖：

| 依赖 | 用途 | 为什么不用标准库手写 |
|---|---|---|
| `gin-gonic/gin` | HTTP 框架 | 路由分组、中间件链、请求体绑定、multipart、404 兜底——手写是几百行样板，而且漏挂一个鉴权中间件不会编译失败 |
| `jackc/pgx/v5` | Postgres | 纯 Go，无 cgo |
| `modernc.org/sqlite` | SQLite | 纯 Go（自带移植版 SQLite）。⚠️ **不能换成 `mattn/go-sqlite3`**——那个要 cgo，会直接推翻「静态二进制 + `scratch` 镜像 + 一条 `docker build` 出成品」三条收益。代价是二进制 +3.4 MB（12.5 → 15.9 MB，`-s -w`） |
| `golang-jwt/jwt/v5` | JWT 验签 | 只验签、不签发 |
| `rs/cors` | CORS | ⚠️ 空 `AllowedOrigins` 的语义是**允许所有来源**，见 `internal/middleware/cors.go` 的分叉 |
| `google/uuid` | 自定义场景 id | v4 的版本位/变体位不用自己设 |
| `ledongthuc/pdf` | PDF 抽文本 | 纯 Go，不引 cgo（运行镜像是 `scratch`） |
| `stretchr/testify` | 测试断言 | 680 处断言点，`require`/`assert` 取代 `if … { t.Fatalf(…) }` 样板 |

⚠️ `go.mod` 末尾**显式钉住**了三个只出现在测试依赖链里的模块（`kr/pretty` /
`kr/text` / `rogpeppe/go-internal`）。不钉的话 `go mod tidy` 会把
`rogpeppe/go-internal` 解析到 v1.16.0，而它要求 go >= 1.25，与本仓的 go 1.23
冲突，tidy 直接失败。

## 常用命令

```sh
make check              # 提交前跑：fmt-check + vet + lint + test-race + build
make test               # 快跑测试（不带 race；SQLite 后端默认跑）
make test-postgres      # 额外在真 Postgres 上跑一致性测试（要 REHEARSE_TEST_DATABASE_URL）
make docker             # docker compose build rehearse-backend
make run-sqlite         # 本地起服务，SQLite 后端
make migrate-up         # 按 $DATABASE_URL 跑迁移
make migrate-pending    # 只打印待应用的版本（dry-run）
```

## 目录结构

见设计稿 §7.9。几个刻意的选择：

- **按领域分包**（`internal/coach`、`scenarios`、`material`、`llm`、`store`…），
  不镜像 Rust 的 `services/` `models/` `controllers/`
- **`internal/coach/guards.go` 单独一个文件**——护栏集中在一处，
  code review 只盯一个文件
- **`scenarios/data/*.json` + `go:embed`**——场景文案是数据，不是代码
- **两个二进制**（`cmd/rehearse` + `cmd/migrate`）——server 运行时不带 DDL 权限；
  迁移逻辑在 `internal/migrate`（不在 `cmd/migrate` 里），因为**测试也要建表**
- **存储按后端分文件、接口只有一份**——`store.Store` 的 7 个方法不变，
  `postgres*.go` 与 `sqlite*.go` 各实现一遍，语义一致性由
  `store_conformance_test.go`（同一组用例跑两个后端）保证

## 镜像

`scratch`，多阶段构建，一条 `docker build` 出成品——不走 moyan-backend 那套
「CI 出二进制 → release 资产 → fetch 脚本」（Go 编译便宜，不需要）。

⚠️ 镜像里**没有 shell / wget / curl**，所以容器 healthcheck 用的是
`/rehearse -healthcheck`（二进制自探）。另见 Dockerfile 里关于 CA 证书的注释：
`scratch` 里一个文件都没有，而本服务有两个 HTTPS 出口。

## 当前进度

**阶段 2（服务骨架）已完成**：`/health`、`/api/rehearse/whoami`、JWT 验签中间件、
错误信封、迁移、Dockerfile、CI 门禁。

**阶段 3（业务移植）已完成**（英文侧）。§7.5 的路由表全部落地：

| 端点 | 说明 |
|---|---|
| `GET /api/rehearse/quota` | 配额快照 + `llm_configured` |
| `GET /api/rehearse/scenarios` | 14 个预置场景（`language` 参数非法回 400） |
| `POST /api/rehearse/turn` | 一轮对话（失败重试一次，解析失败走降级） |
| `POST /api/rehearse/summary` | 复盘（不计额度、不重试） |
| `POST /api/rehearse/scenario/draft` | 场景草稿（强制 `source=custom`） |
| `POST /api/rehearse/material/text` | PDF / DOCX / 图片 → 文本 |
| `POST /api/rehearse/material/profile` | 文本 → 紧凑面试档案 |
| `GET\|PUT /api/admin/settings/rehearse` | 配额 + LLM 配置（`X-Admin-Token`） |
| `GET /health`、`GET /api/rehearse/whoami` | 后者是阶段 2 的冒烟端点，**不在 §7.5 表里** |

**已知限制：中文演练属阶段 7。** 选 `language: "zh-CN"` 会拿到 400（中文
prompt 模板还没做，见 `internal/coach/prompts.go` 的 `ErrChinesePromptNotReady`）。
预置场景里有 2 个的默认语言是 `zh-CN`——客户端在开始会话时把 `language`
覆盖成 `en-*` 即可继续演练，不覆盖就会撞上这个 400。阶段 7 落地后这条消失。

**阶段 3 尚未验证的部分**：真实 Supabase 的连通性（含 pooler 冒烟）——那一类差异
只在真 Supabase 上才测得出（本地 PG 没有 pooler）。

`rehearse_usage` 的并发原子性**已经能验了**（2026-10-10）：`internal/store/`
里那组一致性测试是后端无关的，**SQLite 那一半默认就跑**（`go test ./...` 里），
Postgres 那一半由 `REHEARSE_TEST_DATABASE_URL` 门控：

```sh
make test-postgres                                   # 需要真库
REHEARSE_TEST_DATABASE_URL='postgres://...' make test-postgres
```

两个后端跑的是**同一组用例**（`store_conformance_test.go`）——只测一边的话，
另一边写错了没有任何信号，而错法（把原子操作拆成「先读再写」）在单线程测试里
**照样通过**。

**下一步是阶段 4**（App 搬家 + 双向切换），那是唯一的原子切换点：
先起 `rehearse-backend` 并确认网关路由通 → 再发 Rehearse App → 最后删墨言侧 coach。
⚠️ 要排在 UTC+8 零点之后做（§11）。
