# 0x81 统一认证入口设计

日期：2026-10-02
状态：待确认
关联：`2026-10-02-rehearse-design.md`——本稿是它的前置依赖（Rehearse 的 auth 面由本稿决定）

> **修订记录**：本稿第一版设计的是「网关做认证 + 注入身份头」（下称方案 C）。2026-10-02 评审时改为**方案 A：统一登录入口 + 各服务自己验 token**。方案 C 被否的理由留档在 §2.3——**不要重新提它，除非 §2.3 里列的代价已经被接受**。

## 1. 目标与范围

### 1.1 要解决什么

**认证不能按产品各写一遍。** 现在认证全在 `moyan-backend` 里（892 行 `controllers/auth.rs`、8 个 handler）。Rehearse 作为独立后端，如果照搬一遍 Google 登录 + JWT 签发 + 建号，就等于把认证复制成两份——而**复制的认证就是复制的安全漏洞**。

这个风险已经有先例：`moyan-backend` 里那个 `ALLOW_LEGACY_TOKEN_AUTH` 兜底分支，会让任意 Bearer 值自动建号通过（2026-09-18 实测 `Authorization: Bearer garbage` → 200）。如果 Rehearse 也实现一遍认证，就得**再赌一次**它不会犯同样的错。

### 1.2 硬约束：抽象只能发生在服务边界上

后端语言不同——`moyan-backend` 是 Rust，`rehearse-backend` 是 Go。**共享库不可能跨语言。**

所以「把认证抽出来」不能是一个 import 的模块，只能是一条**服务边界**。

### 1.3 要做

- **登录（签发）只有一份**：留在 `moyan-backend`，暴露为中性域名 `auth.0x81.uk`
- **各业务后端只验 token**：不签发、不建号、不碰 OAuth
- `rehearse-app` 从第一天就用中性入口；`moyan-app` 一起切
- 为「将来抽独立 auth 服务」把入口域名先立起来

### 1.4 明确不做

- **网关不做认证**：`website-rs` 保持无状态纯代理（理由见 §2.3）
- **不抽独立 `auth-backend`**：v1 就是 `moyan-backend` 本身（触发条件见 §3.4）
- **不引入 RS256 / JWKS**：单一信任域，HS256 + 共享密钥够用
- **不做 Cookie / Session**：继续用 Bearer token
- **不做细粒度授权**（RBAC / 权限点）：本稿只解决「你是谁」
- **不改网关的路由结构**：仍是 Host-only，不升级为 Host+Path

## 2. 方案选择（留档）

### 2.1 三个候选

| | 形态 | 网关改动 | 后端改动 |
|---|---|---|---|
| **A** | 统一登录入口 + 各服务自己验 token | **加一条 Host 路由** | 各写一个验签中间件 |
| B | 现在就抽独立 `auth-backend` | 加一条 Host 路由 | 迁 892 行 auth 控制器 + 7 个调用点 |
| C | 网关做认证 + 注入身份头 | Host+Path 路由、头剥离、准入白名单、验签 | 只读 `X-User-Id` |

### 2.2 为什么选 A

**改动量最小，而且没有引入新的风险面。**

方案 A 的全部改动：

- 网关：`proxy_or_next` 里加一条 `else if host == "auth.0x81.uk"` 分支 + 一个环境变量
- DNS：加一条 `auth.0x81.uk` 记录（一层子域，被 Cloudflare Universal SSL 的 `*.0x81.uk` 覆盖，**不需要自有证书**）
- `moyan-backend`：**零改动**（它本来就验 JWT）
- `rehearse-backend`：一个约 40 行的验签中间件

对比方案 C 省下来的东西：不需要 Host+Path 路由、不需要头剥离、不需要准入白名单、不需要 `GATEWAY_TOKEN`、不需要 `GATEWAY_TRUST_MODE`、不需要动后端的身份解析——**而后端只省了 40 行**。收益与代价明显不成比例。

### 2.3 为什么不做 C（网关做认证 + 注入身份头）

方案 C 的收益是「后端完全不碰密码学」。但它有三个代价，第一个就足以否掉它：

**① 头剥离是致命的失败点。** `website-rs/src/main.rs:214-220` 的 `proxy_request` 会**转发所有非 hop-by-hop 头**。要让后端信任 `X-User-Id`，就必须先无条件剥离客户端自带的同前缀头——否则：

```
GET /api/decks HTTP/1.1
Authorization: Bearer <自己的合法 token>
X-User-Id: <别人的 id>
```

后端读到 `X-User-Id` 就当成那个人的身份，**任何人可以冒充任何人**。这比不加认证更危险，因为它让后端「有理由」不再自己验签。

这个剥离逻辑可以写对，但它是**新增的、唯一的、承载全量流量的安全边界**——而方案 A 根本不需要它。用「少 40 行 Go 代码」去换这条边界，不划算。

**② 网关从无状态纯代理变成有状态边界。** 它要拿 `JWT_SECRET`、要维护准入白名单、要成为 `/api/*` 的唯一入口。任何一个白名单漏项就是线上 401，任何一次验签 panic 就是全站 502。

**③ 还有连带的重构**：网关要升级为 Host+Path 路由；`moyan-web` / `moyan-admin` 的 Caddyfile `/api/*` 规则变成死代码；要新增 `GATEWAY_TOKEN` / `GATEWAY_TRUST_MODE` 两个环境变量；`dev-run.sh` 要改；`moyan-app` 的真机开发路径（靠 Expo `hostUri` 推 LAN IP 直连 `:4323`，见 `config.ts:13-22`）要重新设计。

### 2.4 为什么现在不抽独立 auth 服务（方案 B）

`controllers/auth.rs` 有 892 行、8 个 handler，迁它要连带改 7 个调用点（`moyan-web` 4 处 + `moyan-app` 3 处）+ Telegram mini app，还要处理 `moyan-web` 同源部署的路径问题。

**但方案 A 已经把这条路铺好了**：登录入口是 `auth.0x81.uk`，将来抽独立服务只需把网关那一条路由指过去，**所有客户端不用发版**。所以现在不做的成本是零。

## 3. 目标形态

### 3.1 路由与职责

```
                    Cloudflare
                        │
                        ▼
              website-rs  :80/:443   Axum 网关（仍是纯代理）
   ┌────────────────────┴─────────────────────────────────┐
   │ Host: 0x81.uk / www.0x81.uk  → 0xindex         :4320  │
   │ Host: tact.0x81.uk           → website         :4321  │
   │ Host: crab.0x81.uk           → crab-web        :4322  │
   │ Host: moyan.0x81.uk          → moyan-web       :5000  │
   │ Host: admin-moyan.0x81.uk    → moyan-admin     :5001  │
   │ Host: rehearse.0x81.uk       → rehearse-backend :4324 │  ★ 新增
   │ Host: auth.0x81.uk           → moyan-backend   :4323  │  ★ 新增（本稿唯一改动）
   └────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
  moyan-backend :4323            rehearse-backend :4324
  （Rust / Axum）                 （Go / net/http）
  ├─ 签发 JWT（= auth 服务）       └─ 只验 JWT
  ├─ 验 JWT
  └─ X-Admin-Token
        │                               │
        └───────────┬───────────────────┘
                    ▼
        /data/moyan-data/moyan.db
        ★ 同一个 SQLite 文件，两个进程都连
```

| 域名 | 上游 | 认证 |
|---|---|---|
| `auth.0x81.uk` | `moyan-backend:4323` | 签发（登录本身不需要 token） |
| `moyan.0x81.uk` | `moyan-web:5000`（其 Caddy 把 `/api/*` 转给 `moyan-backend`） | `moyan-backend` 验 JWT |
| `admin-moyan.0x81.uk` | `moyan-admin:5001`（同上） | `X-Admin-Token`（不走 JWT） |
| `rehearse.0x81.uk` | `rehearse-backend:4324` | `rehearse-backend` 验 JWT |

### 3.2 各客户端打哪里

| 客户端 | 登录 | 业务 | 备注 |
|---|---|---|---|
| `rehearse-app` | `https://auth.0x81.uk/api/auth/*` | `https://rehearse.0x81.uk/api/*` | 两个 base URL，显式 |
| `moyan-app` | `https://auth.0x81.uk/api/auth/*` | 现有后端地址 | 一起切 |
| `moyan-web` | **保持同源** `/api/auth/*` | 同源 `/api/*` | **不切**——见下 |
| `moyan-admin` | 不涉及 | 同源 `/api/*` + `X-Admin-Token` | 不受影响 |
| Telegram mini app | `/api/auth/telegram` | — | 独立项目，暂不动 |

⚠️ **`moyan-web` 故意不切到 `auth.0x81.uk`。**

已核实：`moyan-web` 的 `API_BASE` 是 `import.meta.env.VITE_API_URL || ""`（`backendMode.ts:22`）——**线上是空串，走相对路径**。它的登录调用（`authService.ts` 的 4 处）本来就是同源的 `/api/auth/*`，**没有硬编码任何产品名**。

把它改成绝对地址 `https://auth.0x81.uk` 会：

- 把同源请求变成**跨域**，需要 CORS + OPTIONS 预检
- 多一次 DNS 解析
- 换不来任何东西——它本来就不硬编码域名

**所以「统一入口」对 Web 是零收益、有成本。App 才需要中性入口**（它们必须硬编码一个 host）。

> 这一条与评审时选的「一起切到新入口」有出入。理由写在这里，可以否——否的话代价是 `moyan-web` 的跨域预检（`ALLOWED_ORIGINS` 里已经有 `https://moyan.0x81.uk`，所以放开本身不用改配置）。

### 3.3 一个域名，两种语义

`auth.0x81.uk` 和 `moyan.0x81.uk` 现在指向同一个后端。这不是冗余：

- `moyan.0x81.uk` 是**产品域名**——它服务于墨言这个产品
- `auth.0x81.uk` 是**能力域名**——它服务于「登录」这个跨产品能力

两者指向同一个进程只是**当前的实现**。将来 auth 抽成独立服务时，只需要把 `auth.0x81.uk` 指过去，`moyan.0x81.uk` 不动，客户端不发版。

### 3.4 抽独立 `auth-backend` 的触发条件

满足任一即抽：

1. 出现第三个产品
2. auth 逻辑需要独立发版（改 OAuth 流程不想动 `moyan-backend`）
3. `controllers/auth.rs` 继续膨胀（现在 892 行）
4. auth 的流量特征与业务差异大到需要独立扩缩容

抽取时只改网关一条路由 + 把 `users` 表的写权限搬过去。

## 4. 实现

### 4.1 网关：就一条路由

`website-rs/src/main.rs` 的 `proxy_or_next`（:157）加一条分支，与现有五条并列：

```rust
} else if host == "auth.0x81.uk" {
    let upstream = proxy_upstream_host("PROXY_UPSTREAM_AUTH");
    proxy_request(req, &upstream, 4323).await
}
```

新增环境变量 `PROXY_UPSTREAM_AUTH=moyan-backend`。

**不需要改的东西**：`proxy_request`、`is_hop_by_hop_header`、缓存头逻辑、CORS、路由结构（仍是 Host-only）。

⚠️ 路由没配之前，打到 `auth.0x81.uk` 的请求会落到网关的占位路由，**并且不报错**。已实测（2026-10-02，DNS 已加、路由未加）：

| 路径 | 现状 | 配好之后应该是 |
|---|---|---|
| `/` | **200** `{"status":"ok"}` | 同上（占位路由本来就有这个） |
| `/health` | **200** `{"status":"ok"}` | 同上 |
| `/api/auth/me` | **404** | **401** |

同时网关会打一条 `no upstream configured for host "auth.0x81.uk"` 的 warn（:184-186）——**看到这条 warn 就说明 DNS 或路由没配。**

注意：**只看 `/` 是分不出对错的**（两种状态下都是 200）。验收必须打 `/api/auth/me`，看它是 404 还是 401。

**顺手清理**（与本稿无关但同一批做）：删掉死脚手架 `/users` 路由 + `Database` stub + `get_user` / `create_user`（:68-92、:403-409）——从未被使用，且 `/users` 现在会被当作未匹配 Host。

### 4.2 `moyan-backend`：零改动

它现在就在验 JWT（`middleware/auth.rs:44` 的 `jwt_middleware`），签发逻辑也在它这里。**一行都不用改。**

它只是多了一个入口域名。`proxy_request` 会把 `Host` 改写成 `localhost:4323`，而后端不关心 `Host`。

### 4.3 `rehearse-backend`：一个验签中间件

这是 Rehearse 侧的**全部** auth 代码（约 40 行）：

1. 从 `Authorization: Bearer <token>` 取 token
2. 用共享密钥做 HS256 验签
3. 把 `sub` 放进请求上下文
4. 失败 → 401

**不做的**：签发、建号、OAuth、`find_or_create`、`ALLOW_LEGACY_TOKEN_AUTH` 那类兜底。

依赖：`github.com/golang-jwt/jwt/v5`（唯一新增的认证相关依赖）。

### 4.4 配置

| 键 | 值 | 注入给谁 |
|---|---|---|
| `PROXY_UPSTREAM_AUTH` | `moyan-backend` | `website-rs` |
| `JWT_SECRET` | 共享密钥（**必须 ASCII**） | `moyan-backend` + `rehearse-backend` |
| `ADMIN_TOKEN` | 共享 | `moyan-backend` + `rehearse-backend` |

compose 侧的键名沿用现有约定：容器内不带前缀（`JWT_SECRET`），compose 侧带 `MOYAN_` 前缀（`MOYAN_JWT_SECRET`）。Rehearse 稿 §7.7 建议把 compose 侧改成 `AUTH_JWT_SECRET`（跨产品语义），**但那是可选项**——不改也能跑，只是名字里留着「MOYAN」而已。

## 5. 认证契约（跨语言必须对齐的）

两个后端一个 Rust 一个 Go，验签逻辑各写一份。**这份契约是它们之间唯一的耦合面**，必须逐条对齐。

### 5.1 JWT claims

已核对 `moyan-backend/src/middleware/auth.rs:11`：

```rust
pub struct Claims {
    pub sub: String,   // user id
    pub email: String,
    pub name: String,
    pub exp: usize,    // 秒
    pub iat: usize,    // 秒
}
```

Go 侧用同一套结构、同一个密钥。⚠️ **`exp` / `iat` 必须是整数秒**，Go 的 `jwt/v5` 默认 `NumericDate` 序列化出来同样是整数，但要确认不是浮点——否则 Rust 侧 `decode::<Claims>` 会因为类型不匹配失败。

**互通必须有测试**：固定密钥 + 固定 payload，断言 Rust 签的 token Go 能验、Go 签的 Rust 能验。

### 5.2 密钥

HS256，`JWT_SECRET`。**必须 ASCII**——仓库里已经踩过这个坑（`X-Admin-Token` 含非 ASCII 时 `HeaderValue::to_str()` 恒 `Err`，服务端配了、客户端输对了，仍然恒 401）。

### 5.3 验签失败的响应

两个后端返回**同一个形状**，否则客户端要写两套错误处理：

```json
{ "success": false, "error": { "code": "unauthorized", "message": "..." } }
```

状态码 401。这是 §5 里除了 claims 之外唯一需要对齐的东西。

## 6. 迁移阶段

| 阶段 | 内容 | 影响面 |
|---|---|---|
| **1** | 加 DNS 记录 `auth.0x81.uk`；网关加 Host 分支 + `PROXY_UPSTREAM_AUTH` | 网关 + DNS |
| **2** | 验证：`curl -o /dev/null -w '%{http_code}' https://auth.0x81.uk/api/auth/me` 从 **404 变成 401**，且网关日志里不再有 `no upstream configured` 警告 | 无代码 |
| **3** | `moyan-app` 登录调用切到 `auth.0x81.uk`（3 处） | `moyan-app` |
| **4** | `rehearse-backend` 落地时直接用 `auth.0x81.uk` | 新增后端 |
| **5** | （可选）compose 侧 env 键改名 `MOYAN_JWT_SECRET` → `AUTH_JWT_SECRET` | compose + 服务器 `.env` |

**阶段 1 和 2 是零风险的**——网关只多了一条不冲突的 Host 分支，现有流量完全不变。阶段 3 是唯一动到现有客户端的一步，而且只改 3 个调用点。

阶段 2 的验证方式很关键：**`auth.0x81.uk` 配错的表现不是报错，而是静默落到网关的占位路由**。已实测，`/api/auth/me` 在路由缺失时返回 **404**（占位路由里只有 `/` 与 `/health`）。

所以断言要盯 `/api/auth/me` 的**状态码变化：404 → 401**。只看 `/` 是分不出对错的——两种状态下它都是 200 的 `{"status":"ok"}`。

## 7. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| **两套后端的认证基线漂移** | 中 | 契约只有三件事：claims、密钥、错误形状（§5）。Rehearse 侧**代码里不存在** legacy 兜底分支；契约对齐测试是硬门槛 |
| `auth.0x81.uk` 配错但**不报错** | 中 | 已实测：路由缺失时 `/api/auth/me` 返回 404（不是报错）。阶段 2 的断言盯 **404 → 401**；网关的 `no upstream configured` warn 是信号 |
| JWT 互通类型不匹配（`exp`/`iat` 浮点） | 中 | 固定密钥 + 固定 payload 的双向测试（§5.1） |
| `JWT_SECRET` 含非 ASCII → 恒 401 | 低 | 生成时用 `openssl rand -hex 32`；文档写明 |
| `moyan-backend` 同时是产品后端和认证服务 | 低 | 这是**当前实现**，不是设计意图。入口域名已经中立化，抽离时只改一条路由（§3.4） |
| `moyan-web` 不切入口导致「不统一」 | 低 | 它本来就用相对路径，没有硬编码域名。理由见 §3.2 |

## 8. 测试与验收

**网关**
- `auth.0x81.uk` 路由命中：`curl -s -o /dev/null -w '%{http_code}' https://auth.0x81.uk/api/auth/me` → **401**（改之前是 404）
- 网关日志无 `no upstream configured for host "auth.0x81.uk"`
- 其余五个 Host 路由行为不变（回归）

**认证契约（跨语言）**
- 固定密钥 + 固定 payload：Rust 签的 token Go 能验、Go 签的 Rust 能验（双向）
- `exp` / `iat` 序列化为整数秒
- 过期 token → 401；签名错误 → 401；缺 token → 401
- 两个后端的 401 响应体形状一致（§5.3）

**客户端**
- `moyan-app` 切入口后：Google 移动端登录、Kimi 设备码走通
- `moyan-web` **不切**，回归确认同源登录仍然正常（这条是「不改也要测」）
- `rehearse-app`：登录 → 业务接口全链路，且**代码里不出现任何 OAuth / 签发逻辑**
- 真机验证（模拟器不可靠）：iOS + Android 各一台

**Rehearse 侧代码审计**
- `rehearse-backend` 里不出现 OAuth、JWT 签发、`find_or_create`、任何兜底认证分支

## 9. 默认决策表

| 决策 | 默认 |
|---|---|
| 方案 | **A：统一登录入口 + 各服务自己验 token** |
| 网关职责 | 仍是**无状态纯代理**；只加一条 `auth.0x81.uk` Host 路由 |
| 网关路由结构 | 保持 **Host-only**，不升级为 Host+Path |
| 登录（签发）位置 | `moyan-backend`，暴露为 `auth.0x81.uk` |
| 抽独立 `auth-backend` | 触发条件见 §3.4，不预先做 |
| 算法 | HS256，共享密钥 |
| 各后端 | **自己验 token**，不签发 |
| `rehearse-backend` 的 auth | 一个约 40 行的验签中间件（§4.3） |
| `rehearse-app` | 两个 base URL：`auth.0x81.uk` + `rehearse.0x81.uk` |
| `moyan-app` | 登录切到 `auth.0x81.uk`（3 处调用） |
| `moyan-web` | **不切**，保持同源相对路径（§3.2） |
| `moyan-admin` | 不涉及——继续用 `X-Admin-Token` |
| 身份头 | **不引入**。不做头注入、不做头剥离、不需要 `GATEWAY_TOKEN` |
| 跨语言契约 | claims + 密钥 + 401 响应形状（§5），双向测试是硬门槛 |
| compose env 键改名 | 可选，不做也能跑 |
| 网关死脚手架 | 顺手删掉 `/users` 路由与 `Database` stub |

## 10. 待确认

1. **`moyan-web` 不切入口这条**——与评审时选的「一起切」有出入。理由见 §3.2（零收益 + 引入跨域预检），可以否
2. **compose 侧 env 键是否改名** `MOYAN_JWT_SECRET` → `AUTH_JWT_SECRET`——要动服务器上的手工部署件，不改也能跑
3. **是否给 `website-rs` 补 CI 门禁**——本稿对它的改动很小（一条分支），但顺手删死脚手架之后应该至少能编过
4. **`auth.0x81.uk` 是否要独立于 Cloudflare 的 Universal SSL**——一层子域被 `*.0x81.uk` 覆盖，不需要自有证书（同 `admin-moyan.0x81.uk` 的情况）。除非将来要做更严格的 TLS 策略

已在核对中确认的事实（留档）：

- ✅ `website-rs/src/main.rs` 共 409 行、单文件、**无状态**；`proxy_or_next`（:157）是 Host-only 的 if-else 链
- ✅ `proxy_request`（:214-220）转发所有非 hop-by-hop 头——**方案 A 下这不是问题**（没有身份头可伪造），这是方案 C 才需要处理的
- ✅ 网关有死脚手架：`/users` 路由 + `Database` stub + `get_user`/`create_user`（:68-92、:403-409）
- ✅ JWT claims 是 `{sub, email, name, exp, iat}` HS256（`middleware/auth.rs:11`）
- ✅ `moyan-backend` 里不带 `jwt_middleware` 的公开接口恰好 5 条（`main.rs:63-81` + 各 `routes/*.rs`）——**方案 A 下不需要白名单**（后端自己判断），这条留档只是备查
- ✅ `moyan-admin` 用 `X-Admin-Token`，不走用户 JWT，不受影响
- ✅ **`moyan-web` 的 `API_BASE` 是 `import.meta.env.VITE_API_URL || ""`（`backendMode.ts:22`），线上是空串走相对路径**——这是「Web 不切」的依据
- ✅ `moyan-web/src/services/authService.ts` 有 4 处 auth 调用、`moyan-app/src/lib/api.ts` 有 3 处，全部走 `API_BASE` 前缀
- ✅ `moyan-backend` 的 CORS 已包含 `https://moyan.0x81.uk`（`docker-compose.yml:46` 默认值）
- ✅ `argon2` 在代码里根本没被调用（`Cargo.toml` 注释写着 "for future local auth"）——认证全是 OAuth，没有密码哈希互通问题

**2026-10-02 实测（DNS 已加、网关路由未加）**：

- ✅ `auth.0x81.uk` 解析到 `172.67.222.124` / `104.21.70.97`（与 `moyan.0x81.uk` 同 IP，Cloudflare 代理）
- ✅ TLS 校验通过（`ssl_verify_result=0`），证书 `CN=0x81.uk`，SAN = `0x81.uk, *.0x81.uk` → **一层子域被 Universal SSL 覆盖，确实不需要自有证书**
- ✅ 占位路由行为：`/` 与 `/health` 返回 200 `{"status":"ok"}`；`/api/auth/me` 与 `/api/health` 返回 **404**
- ⚠️ 因此「配错的表现」对 `/` 是 200、对 `/api/auth/me` 是 **404**。验收必须打 `/api/auth/me`
