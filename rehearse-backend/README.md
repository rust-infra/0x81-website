# rehearse-backend

Rehearse（职演）的 API 服务。Go + `net/http`，独立于墨言后端。

设计稿：`docs/superpowers/specs/2026-10-02-rehearse-design.md`

## 三条硬约束

**1. 只验签，不签发。** 登录入口是 `auth.0x81.uk`（由认证服务提供）。
本服务不实现 OAuth、不签发 token、不建号、**不读也不写 `users` 表**。
用户身份来自 JWT 的 `sub`。

⚠️ 也**没有** legacy token 兜底分支（moyan-backend 有个 `ALLOW_LEGACY_TOKEN_AUTH`
开关，线上必须关闭）。那个分支的存在本身就是「随手编一个 Bearer 就能读到自己名下
数据」的洞，所以这边从第一天起就不带它。

**2. 自己的库，不共享任何表。** 连外部托管的 Postgres（Supabase，只当 PG 用），
只有 `rehearse_usage` 与 `rehearse_settings` 两张表。迁移由本仓库自己管，
与墨言的 SQLite 迁移**没有顺序依赖**。

**3. 跨语言契约必须逐字段对齐。** 与 `moyan-backend` 共享的只有四件事：
JWT claims（含 `status`）、HS256 密钥、错误信封形状、`status` 判定语义。
任何一处不一致，客户端就得写两套错误处理。

## 本地跑起来

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

## 常用命令

```sh
make check        # 提交前跑：fmt-check + vet + lint + test-race + build
make test         # 快跑测试（不带 race）
make docker       # docker compose build rehearse-backend
make migrate-up
```

## 目录结构

见设计稿 §7.9。几个刻意的选择：

- **按领域分包**（`internal/coach`、`scenarios`、`material`、`llm`、`store`…），
  不镜像 Rust 的 `services/` `models/` `controllers/`
- **`internal/coach/guards.go` 单独一个文件**——护栏集中在一处，
  code review 只盯一个文件
- **`scenarios/data/*.json` + `go:embed`**——场景文案是数据，不是代码
- **两个二进制**（`cmd/rehearse` + `cmd/migrate`）——server 运行时不带 DDL 权限

## 镜像

`scratch`，多阶段构建，一条 `docker build` 出成品——不走 moyan-backend 那套
「CI 出二进制 → release 资产 → fetch 脚本」（Go 编译便宜，不需要）。

⚠️ 镜像里**没有 shell / wget / curl**，所以容器 healthcheck 用的是
`/rehearse -healthcheck`（二进制自探）。另见 Dockerfile 里关于 CA 证书的注释：
`scratch` 里一个文件都没有，而本服务有两个 HTTPS 出口。

## 当前进度

**阶段 2（服务骨架）已完成**：`/health`、`/api/rehearse/whoami`、JWT 验签中间件、
错误信封、迁移、Dockerfile、CI 门禁。

**阶段 3 待做**：业务移植（`/turn`、`/summary`、`/scenario/draft`、配额、
材料解析、`/api/admin/settings/rehearse`）。路由表见设计稿 §7.5，
模块对照表见 §7.9。
