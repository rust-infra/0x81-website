# 0x81-website

Host 分流网关 + 多个 Astro 静态站点：

| 域名 | 服务 | 说明 |
|------|------|------|
| `0x81.uk` / `www.0x81.uk` | `0xindex` | 产品索引站（`ai.0x81`） |
| `tact.0x81.uk` | `website` | tact 产品落地页 |
| `crab.0x81.uk` | `crab-web` | CrabBridge 产品落地页 |
| `moyan.0x81.uk` | `moyan-web` | 墨言（词汇 / 打字训练） |
| `admin-moyan.0x81.uk` | `moyan-admin` | 墨言管理后台（网关也认旧名 `admin.moyan.0x81.uk`，两者都路由到 5001；**旧名已无 DNS 记录**，实测见「管理后台的域名与 TLS」） |

## 架构

```
Browser / CDN
      │
      ▼
website-rs :80/:443     Axum 网关
      ├─ Host: 0x81.uk / www.0x81.uk  →  0xindex :4320
      ├─ Host: tact.0x81.uk           →  website :4321
      ├─ Host: crab.0x81.uk           →  crab-web :4322
      ├─ Host: moyan.0x81.uk          →  moyan-web :5000（/api → moyan-backend :4323）
      ├─ Host: admin-moyan.0x81.uk    →  moyan-admin :5001（/api → moyan-backend :4323）
      │  （旧名 admin.moyan.0x81.uk 网关也收、同样路由到 5001，但它已无 DNS 记录，
      │    现状见「管理后台的域名与 TLS」）
      └─ 其它 Host                      →  本地路由（/health 等）
              │
              ▼
         Caddy 静态服务（各站 dist/）
```

基础镜像默认走华为云 SWR 转发的 Docker Hub（`swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/...`），避免直连 docker.io / DaoCloud 超时或 401。

### 仓库结构

```
0x81-website/
├── website-rs/       # 入口网关（Rust / Axum :80）
├── 0xindex/          # 主站 ai.0x81（Astro → Bun :4320）
├── website/          # tact 站（Astro → Bun :4321）
├── crab-web/         # CrabBridge 站（Astro → Bun :4322）
├── moyan-web/        # 墨言前端（Vite → Caddy :5000）
├── moyan-admin/      # 墨言管理后台（Vite → Caddy :5001）
├── moyan-backend/    # 墨言 API（Axum :4323）
├── docs/             # 设计稿与实现计划
└── docker-compose.yml
```

### 请求路径

1. 流量进入 `website-rs:80`
2. `proxy_or_next` 按 `Host` 反代到对应上游
3. 转发时将 `Host` 改写为 `localhost:<port>`
4. 回写响应时注入 `Cache-Control`，并经 gzip（`CompressionLayer`）与 CORS（`CorsLayer`）

Compose 环境变量：

- `PROXY_UPSTREAM_HOST_INDEX=0xindex`
- `PROXY_UPSTREAM_HOST_TACT=website`
- `PROXY_UPSTREAM_HOST_CRAB=crab-web`
- `PROXY_UPSTREAM_HOST_MOYAN=moyan-web`
- `PROXY_UPSTREAM_HOST_MOYAN_ADMIN=moyan-admin`

### 网关横切能力

| 能力 | 说明 |
|------|------|
| Host 路由 | `0x81.uk` → 4320，`tact` → 4321，`crab` → 4322，`moyan` → 5000，`admin-moyan` → 5001。**HTTP/1.1 看 `Host` 头、HTTP/2 看 URI authority（h2 没有 `Host` 头）**——只读其一会让整条 HTTPS 流量静默落到本地占位路由（见「细节与约束」） |
| TLS | rustls 监听 443（`TLS_CERT_PATH` / `TLS_KEY_PATH`，Cloudflare Origin Certificate）；未配置则仅 HTTP |
| 压缩 | `CompressionLayer` |
| CORS | `CorsLayer::permissive()` |
| 缓存头 | `/_astro/*` 一年 `immutable`；HTML `max-age=60, must-revalidate`；图片/字体一天；错误 `no-store` |
| 健康检查 | `GET /health` |

### HTTPS（Cloudflare Full (strict)）

1. Cloudflare → SSL/TLS → **Origin Server** → Create Certificate，覆盖 `0x81.uk, *.0x81.uk`
2. 证书存为 `certs/origin.pem`，私钥存为 `certs/origin-key.pem`（`certs/` 已 gitignore，不入库）。
   Cloudflare 下载页给的两个文件默认叫 `example.com.pem` / `example.com.key`，要**按内容**改名：
   `example.com.pem` → `certs/origin.pem`，`example.com.key` → `certs/origin-key.pem`
   （私钥以 `-----BEGIN PRIVATE KEY-----` 开头；**别把 pem 改名成 key**）
3. 放上服务器（证书和仓库根 `.env` 一样是**纯手工部署件**：不进 git、也不进 release 资产，
   见「环境变量（仓库根 `.env`）」）。
   本仓库在这台服务器上的部署目录就是 `/root/Projects/0x81-website`，compose 只挂它的
   `./certs`，所以证书必须落在**那个**目录的 `certs/` 里：
   ```bash
   scp certs/origin.pem certs/origin-key.pem <server>:/root/Projects/0x81-website/certs/
   ssh <server> 'chmod 600 /root/Projects/0x81-website/certs/origin-key.pem'
   ssh <server> 'cd /root/Projects/0x81-website && docker compose restart website-rs'
   ```
   ⚠️ 路径写错**不会**报错：docker 会把不存在的宿主目录新建出来，证书静静躺在没人挂载的地方。
   只重启 `docker compose up -d` 也不够——挂载内容变化不触发重建，要 `restart website-rs`。
4. `docker compose up -d` 后网关同时监听 80/443，然后**跑一次自检**：`scripts/check-tls.sh`
   （本地开发不需要证书，用 `--allow-http` 让它只告警）
5. Cloudflare SSL/TLS 加密模式切到 **Full (strict)**，并开启 **Always Use HTTPS**

Cloudflare Origin Certificate 有效期最长 15 年，**不需要续期自动化**，只有换证书时才走上面第 3 步。

⚠️ 缺证书时网关**只 warn 不报错**，静默退回仅 HTTP（443 直接连不上）；更阴的是 compose 挂载
一个不存在的宿主目录时 docker 会自己建一个 root 所有的空目录，所以"`certs/` 目录存在"**不代表**
"证书在里面"。第三种是"两个文件都在、内容却不对"——例如把 `origin.pem` 复制成了
`origin-key.pem`（换证书时极易发生），或只换了配对中的一个：内容是坏/错的情况下网关直接
panic 重启，而不是退回 HTTP。`scripts/check-tls.sh` 把这三件事分开指出（宿主侧文件是否存在 →
`openssl` 校验确实是私钥且与证书配对 → 容器状态 → 启动日志 → 容器内 https 探针），并给出对应修法。

## 前端应用

构建模式相同：**Docker 多阶段 = `npm install` → `astro build` → Caddy 直接托管 `dist/`**。

Dockerfile 默认使用官方镜像名（前端 `node:20-alpine` / `caddy:2-alpine`，Rust 服务 `rust:latest` + 对应的 Debian：`website-rs` 是 `debian:bookworm-slim`、`moyan-backend` 是 `debian:trixie-slim`）。如果本机 Docker 已配置阿里云等镜像加速器，会自动生效；如需指定自定义镜像源，也可通过 build args 覆盖。

⚠️ `DEBIAN_IMAGE` 不要跨服务统一覆盖：`moyan-backend` 用 `rust:latest` 编出的二进制要求 **GLIBC ≥ 2.39**，而 `bookworm` 只有 2.36 —— 镜像能构建成功，一启动就 `version 'GLIBC_2.39' not found`。`.github/workflows/docker-build.yml` 因此是按服务分别传这个参数的。

### `0xindex`（产品索引）

```
0xindex/src/
├── pages/index.astro      # /    EN
├── pages/zh/index.astro   # /zh  ZH
├── data/products.ts       # 产品目录
├── i18n/{en,zh}.json      # 文案
└── components/            # Nav · Hero · ProductMatrixIDE · Footer
```

- 品牌：`ai.0x81`，matrix-first（青黑 IDE）
- tact / crab 外链到各自产品站
- 改产品需同步：`products.ts` + `en.json` + `zh.json`（`products.<id>.blurb`）

### `website`（tact）

- 琥珀 CRT / TUI 产品落地页，端口 `4321`
- Astro 静态 + Bun `server.ts`

### `crab-web`（CrabBridge）

- 与 tact **同款**琥珀 TUI 视觉与组件结构，端口 `4322`
- 产品：[rust-infra/crab-bridge-rs](https://github.com/rust-infra/crab-bridge-rs) — Codex ↔ DeepSeek / Kimi Responses 代理
- 设计说明：`docs/superpowers/specs/2026-07-14-crab-web-design.md`

### `moyan-web` / `moyan-admin` / `moyan-backend`（墨言）

- 前端：Vite 构建 + Caddy，主机映射 `5000:5000`，域名 `moyan.0x81.uk`
- 前端是**服务端为权威**模式：`docker-compose.yml` 给 `moyan-web` 传构建参数 `VITE_SERVER_MODE=1`（判断逻辑集中在 `moyan-web/src/services/backendMode.ts`）。线上是**同源部署**——`VITE_API_URL` 故意留空、请求走相对路径 `/api` 由 Caddy 反代，所以**不能**再用「`VITE_API_URL` 是否为空」判断后端是否可用：那样前端会静默退回 IndexedDB 本地模式，表现是「管理后台导入的词库在 `/decks` 永远看不到」（2026-09-18 踩过）。开关只影响构建产物，改完必须 `docker compose build moyan-web && docker compose up -d moyan-web`（`up -d` 不会重建镜像）。副作用：服务端模式下 `/decks` 等页面要求登录，浏览器里旧的本地牌组/进度不再显示
- 管理后台：Vite 构建 + Caddy，主机映射 `5001:5001`，域名 **`https://admin-moyan.0x81.uk`**（网关也认旧名 `admin.moyan.0x81.uk`，但该名已无 DNS 记录；现状见「管理后台的域名与 TLS」）；登录页输入 `X-Admin-Token`（Compose 环境变量 `MOYAN_ADMIN_TOKEN` → 后端 `ADMIN_TOKEN`）。**这个 token 必须写在服务器根 `.env` 里**，留空则 `/api/admin/*` 一律 503——怎么放见「环境变量（仓库根 `.env`）」
- 后端：Axum API `:4323`；Caddy 将 `/api/*` 反代到 `moyan-backend`（保留 `/api` 前缀）
- 后端鉴权：Bearer **JWT（HS256，密钥 `MOYAN_JWT_SECRET`）**。⚠️ 这个键**必须**在根 `.env` 里设（`openssl rand -hex 32`）：留空会回落到 compose 里公开的 `change-me-in-production`，等于任何人都能自签 token（2026-09-18 已换掉线上默认值）。另有非 JWT 的 legacy 兜底认证（`ALLOW_LEGACY_TOKEN_AUTH`）：**默认关闭**，只有 `moyan-backend/dev-run.sh` 打开——它会把任意 Bearer 值按哈希自动建号放行，线上开着就是无鉴权入口
- Google OAuth 生产回调建议设为 `https://moyan.0x81.uk/api/auth/google/callback`（`MOYAN_GOOGLE_REDIRECT_URL`）
- CORS 允许来源：`MOYAN_ALLOWED_ORIGINS`（默认含 `https://moyan.0x81.uk` 与 `https://admin-moyan.0x81.uk`，另保留了旧名 `https://admin.moyan.0x81.uk`——旧名已无 DNS，这条留着只是无害的兼容）

## Rust 服务的构建与部署（CI 编译，服务器只运行）

`website-rs` 与 `moyan-backend` 的镜像**只含运行时依赖**：二进制在 CI 里编译成 GitHub Release
资产，服务器按 tag 下载后挂载进容器。服务器上没有 cargo / Rust 工具链，`git pull` 也不再搬运
二进制（历史提交里还有旧的，git 不会回收，也不会自动删除）。

### 一次发布 + 一次部署

```text
[开发机]  git tag v0.1.0 && git push origin v0.1.0
      │
      ▼
[GitHub Actions]  Release Rust Binaries（ubuntu-latest，tag 触发）
      ├─ PLATFORM=linux/amd64 scripts/build-rust.sh
      │    ├ 两个服务各自 Dockerfile 的 builder 段编译（工具链/glibc 与本地一致）
      │    ├ docker cp 提取 ELF → elf-arch.py 校验架构 → 写 bin/<service>.rev
      │    └ cd bin && sha256sum website-rs moyan-backend > SHA256SUMS
      └─ 发布 release 资产：website-rs · moyan-backend · *.rev · SHA256SUMS
      │
      ▼
[服务器]  git pull                        ← 只更新源码 + compose + scripts，不含二进制
      ├─ scripts/fetch-rust.sh v0.1.0      ← 需要 GH_TOKEN，走 api.github.com
      │    └ 下到临时目录 → 校验 sha256 + ELF 架构 → bin/x.new → rename 覆盖
      └─ docker compose up -d              ← 只建 runtime 层（apt/pip，之后走缓存）
           └ 7 个容器起来：2 个 Rust 服务挂载 bin/，5 个前端照常构建
```

### 服务器上的落盘与容器拓扑

```text
 /root/Projects/0x81-website/   ← 服务器上的部署目录（既是开发 checkout 也是 compose 目录；
                                    git pull 只更新到这里）
 ├── docker-compose.yml
 ├── scripts/{build-rust.sh, fetch-rust.sh, lib/elf-arch.py}
 ├── .env                       ← 手工放的密钥文件（不进 git、也不进 release），chmod 600
 │      MOYAN_ADMIN_TOKEN=…        → 容器内 ADMIN_TOKEN；留空则 /api/admin/* 一律 503
 │      MOYAN_JWT_SECRET=…         → 登录态签名（留空回落到 change-me-in-production）
 │      GH_TOKEN=github_pat_xxx    → fine-grained，Contents: Read（fetch-rust.sh 拉 release 资产）
 ├── certs/{origin.pem, origin-key.pem}
 └── bin/                       ← 唯一由 fetch-rust.sh 填充，不在版本控制里
      ├── website-rs        10.3 MB / 0755   →  挂进 /app/website-rs（:ro,Z）
      ├── website-rs.rev    git 50adf90 · built 2026-09-17T… · linux/amd64
      ├── moyan-backend     18.2 MB / 0755   →  挂进 /app/moyan-backend（:ro,Z）
      └── moyan-backend.rev

 docker compose up -d 之后的容器：

   website-rs      :80 :443   0x81/website-rs-runtime:local（只装 ca-certificates, curl）
                     ├ /app/website-rs  ← bin/website-rs
                     ├ /certs           ← ./certs
                     └ healthcheck GET /health

   moyan-backend   :4323      0x81/moyan-backend-runtime:local（另加 ffmpeg python3 yt-dlp libsqlite3-0）
                     ├ /app/moyan-backend ← bin/moyan-backend
                     ├ /data              ← ${MOYAN_DATA_DIR:-./moyan-backend/data}（SQLite）
                     │                       dev 默认在仓库里；生产在 .env 里指向数据盘
                     │                       （本机 MOYAN_DATA_DIR=/data/moyan-data，/data 是 /dev/vdb1）
                     └ healthcheck GET /api/health

   前端 5 个      0xindex:4320 · website:4321 · crab-web:4322 · moyan-web:5000 · moyan-admin:5001
                     └ 常规多阶段构建（node 构建 → Caddy 托管 dist），与 Rust 二进制无关

 流量：Cloudflare → website-rs:80/443 →（按 Host 反代，规则见上面「架构」）→ 5 个前端
                                                            └ /api → moyan-backend:4323
```

### 三条常用路径

| 场景 | 命令 | 说明 |
|------|------|------|
| **首次部署** | `git clone` → `cp .env.example .env` 后填 `MOYAN_ADMIN_TOKEN` / `MOYAN_JWT_SECRET` / `GH_TOKEN`（`chmod 600 .env`）→ `scripts/fetch-rust.sh <tag>` → scp 两个证书文件（见「HTTPS」）→ `docker compose up -d --build` → `scripts/check-tls.sh` | 必须先 fetch：否则 compose 会把不存在的 `./bin/<service>` 建成空目录。自检不通过就是证书没就位或没生效。漏写 `MOYAN_ADMIN_TOKEN` 的表现是后台登录一直 503 |
| **日常更新** | `git pull` → `scripts/fetch-rust.sh <tag>` → `docker compose up -d` | 只重启容器、只建 runtime 层；只有改过 Dockerfile 的依赖列表才加 `--build`。证书没换就不用动 |
| **换证书** | `scp` 新证书到 `<server>:/root/Projects/0x81-website/certs/`（两个文件都换，别只换一个）→ `chmod 600 origin-key.pem` → `docker compose restart website-rs` → `scripts/check-tls.sh` | 证书是纯手工部署件之一（另一个是根 `.env`），不进 git / 不进 release；Cloudflare Origin 证书最长 15 年，无需续期自动化。自检会校验"确实是私钥且与证书配对"，配错文件当场报错 |
| **回滚** | `scripts/fetch-rust.sh <旧 tag> && docker compose up -d` | 版本锚点是 tag，不用碰 git 历史 |

后备手段（CI 挂了 / 服务器连不上 GitHub）：在开发机 `scripts/build-rust.sh` 编出**同样的两个
文件**，`scp` 到服务器 `bin/`，再 `docker compose up -d`。compose 只关心 `bin/<service>` 里
是什么，不关心它怎么来的。

> **从"二进制随仓库提交"切到本流程时的第一次部署**：`bin/*` 之前是被跟踪的，删除它们的那个
> `git pull` 会**连带删掉服务器工作区里的旧二进制**。所以这次必须
> `git pull` → `scripts/fetch-rust.sh <tag>`（或先从开发机 scp）→ 才能 `docker compose up -d`，
> 不能只 `git pull`。缺失时 compose 会把 `./bin/<service>` 建成的空目录挂进容器，表现为
> 容器起不来、日志里全是 exec 失败。

### 生产库备份（每日热备 + Google Drive）

墨言的 SQLite 生产库（`/data/moyan-data/moyan.db`，见 `MOYAN_DATA_DIR`）由宿主脚本每天热备一次并
上传到 Google Drive。**不下载服务账号密钥**（Google 明确不推荐：长期、可移植、泄露后可在 GCP 里
横向使用），也不自建 OIDC 签发者——用你自己的 Google 账号做一次**设备码授权**，本机只保存一枚
**refresh token**：作用域是 `drive.file`（只能看/管本应用创建的文件）、可在 Google 账号里随时撤销、
不做任何 GCP 资源级授权。

| 组件 | 位置 |
|------|------|
| 备份脚本 | `scripts/backup-moyan-db.py`（软链到 `/usr/local/bin/moyan-db-backup`） |
| 配置 | `/etc/moyan-db-backup.conf`（文件夹名 / 保留天数；**不含**密钥） |
| OAuth 凭据 | `/etc/moyan-backup/google-oauth.json`（`client_id`/`client_secret`/`refresh_token`，0600） |
| Drive 目录 | 你的网盘里名为 `moyan-backups` 的文件夹（首次上传自动创建） |
| 定时器 | `moyan-db-backup.timer`（本机时区 UTC → 每天 03:30 UTC = 北京 11:30，`Persistent=true`） |
| 本地暂存 | `/var/backups/moyan/moyan-YYYYmmdd-HHMMSS.db.gz`（默认留 7 天，0600） |
| 日志 | `journalctl -u moyan-db-backup` |

常用命令：

```bash
moyan-db-backup --authorize      # 一次性授权：打印 URL + 用户码，你同意后落盘 refresh token
moyan-db-backup --check          # 自检：刷新令牌 + 打印 Drive 账号与配额
systemctl start moyan-db-backup.service          # 立刻备份一次（含上传与校验）
journalctl -u moyan-db-backup -n 20 --no-pager
moyan-db-backup --no-upload      # 只做本地热备（演练）
```

首次配置（Google Cloud 控制台，约 3 分钟）：

1. 建项目（如 `moyan-backup`）→ **API 和服务 → 库** → 启用 **Google Drive API**。
2. **OAuth 同意屏幕**：User type 选 External；填应用名与支持邮箱；**Scopes 只需加
   `https://www.googleapis.com/auth/drive.file`**；测试用户里加上你自己的 Google 账号。
3. **凭据 → 创建凭据 → OAuth 客户端 ID**：应用类型必须选
   **「电视和受限输入设备」（TVs and Limited Input devices）**——只有这种类型支持设备码流程。
   拿到 **client_id / client_secret**。
4. 在服务器写凭据骨架并授权（服务端不会把密钥回显到日志）：

   ```bash
   install -d -m 700 /etc/moyan-backup
   install -m 600 /dev/null /etc/moyan-backup/google-oauth.json
   cat > /etc/moyan-backup/google-oauth.json <<'JSON'
   { "client_id": "<你的 client_id>", "client_secret": "<你的 client_secret>" }
   JSON
   moyan-db-backup --authorize      # 按提示在浏览器里输入用户码
   moyan-db-backup --check          # 打印出你的邮箱 = 授权生效
   ```

5. 授权成功后把 `/etc/moyan-db-backup.conf` 里的 `MOYAN_BACKUP_REQUIRE_UPLOAD=1` 打开
   （此后"缺凭据/刷新失败"会让 systemd 单元变成 failed，能第一时间发现云备份断了）。
   手动跑一次 `systemctl start moyan-db-backup.service`，日志里出现
   "已上传 Drive：moyan-backups/…（md5 与字节数校验通过）" 即完成。

⚠️ **最容易踩的坑：OAuth 同意屏幕停留在「测试」状态时，refresh token 只有 7 天有效期**，
一周后备份会开始报 `invalid_grant`。把发布状态改成**「生产」**即可长期有效（`drive.file` 不是
敏感/受限作用域，无需提交审核；只是首次授权会多一个"未验证应用"提示，走"高级 → 继续访问"）。
脚本遇到 `invalid_grant` 会直接提示这两点并给出重授权命令。

设计取舍（都不改容器、不需要停后端）：

- **热备而非冷备**：用 python3 内置 `sqlite3` 的 backup API 从**正在被后端写入**的库取一致性
  快照，随后对快照跑 `PRAGMA integrity_check`，不 ok 就拒绝上传。
- **上传即校验**：比对本地 gzip 的 md5 与 Drive 返回的 `md5Checksum` 及字节数，不一致当失败。
- **失败不丢**：上传失败保留本地文件并返回非 0，下次运行补传（对象名带时间戳，不互相覆盖）。
- **只备份数据库**：`system_vocabulary.json` 在 git 里、`.env` 是密钥，都不上云；库内有用户
  邮箱/昵称，所以本地文件 0600、Drive 里也只放这一个文件夹。
- 未授权阶段（`MOYAN_BACKUP_REQUIRE_UPLOAD` 未开）只警告不报错，本地备份照常每天跑。

恢复：Drive 里下载 `moyan-*.db.gz` → `gunzip` → 停后端 → 替换 `MOYAN_DATA_DIR` 指向目录里的
`moyan.db` → `docker compose up -d`。回滚旧库前先备份当前文件。

撤销授权：Google 账号 → 安全 → 「第三方应用和您授予的访问权限」里移除该应用即可（
`drive.file` 作用域只能看到它自己上传的文件）。

### 细节与约束

- `GH_TOKEN` 需要 fine-grained PAT、权限 `Contents: Read`（仓库是 private，release 资产
  必须走 API 下载；`github.com/.../releases/download/...` 直链在私有仓库下不带凭证会 404）。
  它和其它密钥一样写在**仓库根** `.env` 里（`scripts/fetch-rust.sh` 就从那里读，见下一节），
  脚本不会把它写进任何产物。
- 两个 Dockerfile 都拆成 `runtime`（仅运行时依赖）与 `full`（把二进制 COPY 进镜像）两段。
  compose 用 `build.target: runtime` + 挂载 `./bin/<service>`；
  `docker build ./website-rs` 的默认行为仍是 `full`，不受影响。
- `0x81/website-rs-runtime:local` / `0x81/moyan-backend-runtime:local` 这两个镜像**只存在于
  本机**（本机构建产物，不在任何 registry）。compose 里给了 `pull_policy: build`，所以它不会
  去 registry 找它们：`docker compose pull` 会把这 7 个服务全报成
  `Skipped` / `No image to be pulled`（这是正常的），`up` 则在镜像缺失时自动补建。
  如果看到 `pull access denied for 0x81/website-rs-runtime, repository does not exist or may
  require 'docker login'`，说明 compose 版本较旧或镜像还没构建过 —— 别把 `docker compose pull`
  放进部署流程，用 `docker compose up -d`（需要时加 `--build`）即可。
- 编译复用各项目 Dockerfile 的 `builder` 段，以保证工具链与 glibc 匹配
  （`moyan-backend` 的二进制要求 GLIBC ≥ 2.39，只能跑在 trixie runtime 上）；CI 与本地
  跑的是同一条命令，所以产物一致。
- 产出的都是 **Linux 二进制**，发布 workflow 固定 `linux/amd64`；`scripts/fetch-rust.sh`
  下载后会校验 sha256 与 ELF 架构，不符直接失败（避免部署时才 `Exec format error`）。
  服务器是 arm64 时，改 workflow 的 `PLATFORM` 与服务器侧 `PLATFORM=linux/arm64`，并保证
  runtime 层也是同架构。
- 落盘是"先下到临时目录 → 校验 sha256 与 ELF 架构 → 在 `bin/` 内写 `.new` 再 rename 覆盖"，
  所以下载中断、校验失败或磁盘写满都不会让 compose 挂上半个二进制，旧版本仍可跑。
- `bin/<service>.rev` 记录该二进制的来源提交、编译时间与架构，是判断"它是哪版源码编的"
  的依据；`cat bin/*.rev` 可查。
- 与二进制无关但同样要就位的是 TLS 证书：`./certs:/certs:ro,Z`（`:Z` 与其它挂载一致；SELinux
  enforcing 的机器上不加会读不到，而网关只 warn 并退回仅 HTTP）。部署后用
  `scripts/check-tls.sh` 断言 443 真的在服务，别只看容器"起来了"。
- **网关取主机名要同时看 `Host` 头与 URI authority**：HTTP/2 **没有 `Host` 头**（authority 在
  `:authority`，hyper 把它放进 URI，URI 成绝对形式 `https://host/path`），而 Cloudflare 回源默认
  走 h2；HTTP/1.1 则反过来只有 `Host` 头、URI 是 origin-form。只读其一的后果很阴：h2 请求匹配
  不到任何上游，直接落到网关自己的占位路由（`/`、`/health` 返回 200 的 `{"status":"ok"}`），
  表现成"整站变成一段 JSON 但处处 200"。`website-rs` 的 `request_host()` 同时处理两种形式，
  没匹配上上游时还会打 `no upstream configured for host ...` 告警——看到这条就说明有请求打到了
  没配置的 Host 名。
- 管理后台的域名现状见下面「管理后台的域名与 TLS」——**走 `https://admin-moyan.0x81.uk`，
  https 已通**。

### 管理后台的域名与 TLS（2026-09-18 更新）

网关（`website-rs/src/main.rs:170`）两个名字都收，差别全在 Cloudflare 那一侧：

| 名字 | DNS 记录 | HTTP | HTTPS |
|---|---|---|---|
| `admin-moyan.0x81.uk` | ✓ Cloudflare（172.67.222.124 / 104.21.70.97） | ✓ 200（**不跳转**，见下） | ✓ **200，证书校验通过** |
| `admin.moyan.0x81.uk`（旧名） | ✗ **NXDOMAIN**（记录已不存在） | — | — |

（查 DNS 用 Cloudflare DoH：`curl -sS -H 'accept: application/dns-json'
"https://cloudflare-dns.com/dns-query?name=<name>&type=A"`，NXDOMAIN 回 `"Status":3`。）

- `admin-moyan.0x81.uk` **只有一层子域**，正好被 Cloudflare Universal SSL 的 `*.0x81.uk`
  覆盖（实测证书 `CN=0x81.uk`，SAN 只有 `0x81.uk` / `*.0x81.uk`，Google Trust Services 签发），
  所以补一条 DNS 记录就够了，**不需要任何自有证书**——`https://…/login` 直接 200、校验通过。
- ⚠️ **Always Use HTTPS 仍未生效**：`http://admin-moyan.0x81.uk/login` 返回 200 而不是 301，
  即用 `http://` 书签时 `X-Admin-Token` 仍会明文过网。要去 Cloudflare 打开**区域级**的
  Always Use HTTPS（这是 CF 控制台设置，不在仓库里）。
- 旧名 `admin.moyan.0x81.uk` 是**两级子域**：`*.0x81.uk` 覆盖不到，边缘直接握手失败，
  即便放行也会在 Full (strict) 下 526。它现在连 DNS 记录都没有（NXDOMAIN）；网关里的路由
  仍然保留（零成本兼容），要恢复可用必须重新加记录 **并且** 配一张自有证书。
- 名字没解析/记录没生效的表现是 `Name or service not known`（走本地代理时是 502），
  **不是**网关或容器故障。

### 环境变量（仓库根 `.env`）

```bash
cd /root/Projects/0x81-website
cp .env.example .env          # 模板在仓库根，列了 compose 会插值的全部键
$EDITOR .env                  # 至少填 MOYAN_ADMIN_TOKEN / MOYAN_JWT_SECRET / GH_TOKEN
chmod 600 .env
docker compose config | grep -i admin_token   # 能打出非空值 = 插值读到了
docker compose up -d                          # 改完 .env 要重建，只 restart 不够
```

- **位置只有一个**：与 `docker-compose.yml` 同级的 `.env`（compose 的"项目目录"）。服务器上是
  `/root/Projects/0x81-website/.env`；`scripts/fetch-rust.sh` 先 `cd` 到仓库根再读同一个文件，
  两处一致。`moyan-backend/.env`、`moyan-web/.env` 等**子目录** `.env` 只服务本地
  `dev-run.sh` / `vite dev`，compose 完全不看它们。
- **键名必须带 `MOYAN_` 前缀**：compose 里写的是 `ADMIN_TOKEN=${MOYAN_ADMIN_TOKEN:-}` 这种映射，
  直接写 `ADMIN_TOKEN=` 不会进容器。
- **`MOYAN_DATA_DIR` = SQLite 数据目录（宿主侧，挂到容器 `/data`）**：不设 = `./moyan-backend/data`
  （仓库内，dev 默认）；生产建议指到独立数据盘，本机填 `/data/moyan-data`（`/data` 是 `/dev/vdb1`，
  与系统盘 `/dev/vda1` 分开）。⚠️ 改这个键**等于换挂载源**：只有
  `docker compose up -d`（重建容器）才生效，`restart` 只会重新解析**同一个**源路径；
  且必须先把旧的 `moyan.db` 拷进新目录，否则新目录是空库看起来像"数据丢了"。
  校验：`docker exec 0x81-website-moyan-backend-1 stat -c %i /data` 与宿主目标目录 inode 相同。
- **`MOYAN_ADMIN_TOKEN` 不能空**：它是管理后台登录页要填的 `X-Admin-Token`；空值下后端对
  `/api/admin/*` 一律回 503（`"ADMIN_TOKEN is not configured"`，设计上禁止空密钥放行）。
- **后台登不上，先按状态码分流**（不用登服务器，`moyan-backend/src/middleware/admin_auth.rs:7-12`）：
  `GET /api/admin/ping` 返回 **503** = 容器里 `ADMIN_TOKEN` 是空串（没配）；返回 **401** =
  已配置但请求头的值不相等。拿到 401 时按顺序怀疑：改完 `.env` 只 `restart` 而没重建容器（值不会
  生效，要 `up -d`）；`.env` 的值带 `\r`（CRLF 文件）/引号/尾随空格——登录页会对**你输入的值**
  `trim()`，带杂质的服务端值永远匹配不上（用 `sed -n 's/^MOYAN_ADMIN_TOKEN=//p' .env | od -c` 看）；
  记的串和服务器上的不是同一个；**值含非 ASCII 字符**（如 `£`、中文）——这种最阴：服务端配了、
  你输的也一字不差，仍然恒 401，因为 `admin_auth.rs:26` 用 `HeaderValue::to_str()`，
  而它只接受可见 ASCII（0x20-0x7E），值里有 `£` 时 `to_str()` 直接 `Err`，中间件把请求当成
  "没带 token"；更糟的是浏览器 `fetch` 会按 ByteString 把它编成单字节，与 `.env` 里的 UTF-8
  永远不等。**token 只用 ASCII**（`openssl rand -hex 20`），要换就得连登录页一起换。
- 它**不进 git**（`.gitignore` 里有 `.env`，历史里也从未提交过）、**不进 release 资产**，
  所以换服务器必须手工重建，`git clone` 拿不到——这是继 `certs/` 之后第二个纯手工部署件。
- ⚠️ **别把 `.env` 放进前端目录**：`moyan-web/` / `moyan-admin/` 的 Dockerfile 是 `COPY . .`
  后 `npm run build`，Vite 会在构建期把 `VITE_*` 固化进镜像——本地调试用的
  `VITE_API_URL=http://localhost:4323` 会被原样打进线上产物。两个 `.dockerignore` 已加 `.env*`
  兜底；要给镜像注入 `VITE_*` 请走构建参数。
- ⚠️ 模板里代理那几行（`HTTP_PROXY` 等）**故意注释着**：compose 会把 `.env` 的键也注入自己的
  进程环境，而 docker CLI 读 `HTTP(S)_PROXY` 去拉镜像——激活后宿主的 `docker pull` 会去连
  `host.docker.internal:17890`（宿主上通常解析不到）而失败。

## 本地运行

```bash
scripts/build-rust.sh     # 首次需要：生成 bin/ 下的两个二进制（Rust 服务挂载用）
docker compose up -d --build
```

服务：

| 服务 | 端口 | 说明 |
|------|------|------|
| `website-rs` | `80` / `443` | 网关入口 |
| `0xindex` | `4320` | 主站（也可直接访问） |
| `website` | `4321` | tact（也可直接访问） |
| `crab-web` | `4322` | CrabBridge（也可直接访问） |
| `moyan-backend` | `4323` | 墨言 API |
| `moyan-web` | `5000` | 墨言前端（Caddy；`/api` 反代到 backend） |
| `moyan-admin` | `5001` | 墨言管理后台（Caddy；`/api` 反代到 backend） |

本地按 Host 访问时，需把 `0x81.uk` / `tact.0x81.uk` / `crab.0x81.uk` / `moyan.0x81.uk` / `admin-moyan.0x81.uk` 指到本机（`/etc/hosts` 或本地 DNS）。

单独开发前端：

```bash
cd 0xindex && bun install && bun run dev
# 或
cd website && bun install && bun run dev
# 或
cd crab-web && bun install && bun run dev
```

## 相关文档

- 主站设计：`docs/superpowers/specs/2026-07-14-0xindex-main-site-design.md`
- 主站实现计划：`docs/superpowers/plans/2026-07-14-0xindex-main-site.md`
- CrabBridge 站设计：`docs/superpowers/specs/2026-07-14-crab-web-design.md`
