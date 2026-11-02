# syntax=docker/dockerfile:1

# 多阶段构建，一条 `docker build` 出成品镜像（§7.1）。
#
# 与 moyan-backend 的区别：那边是「CI 出二进制 → release 资产 → 服务器
# fetch → 挂载进 runtime 容器」，因为 Rust release 编译贵、且服务器明确不编译。
# Go 编译便宜到可以每次现场做，所以整条链路塌缩成这一条命令。

FROM golang:1.23-alpine AS build

# Alpine 基础镜像通常自带 ca-certificates-bundle，但显式装一次免得依赖
# 基础镜像的细节——下面 COPY 的那行会因缺文件而直接构建失败。
RUN apk add --no-cache ca-certificates

WORKDIR /src

# ⚠️ GOPROXY 必须是可覆盖的：默认的 `proxy.golang.org` 在部分网络下（含本机）
# 会超时，构建卡在 `go mod download` 上，而报错只是一句 context deadline exceeded。
# 不传就用官方默认值，CI 不用管。
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=${GOPROXY}

# 先只拷 go.mod / go.sum：依赖没变时这一层命中缓存，改代码不用重下依赖。
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 是硬要求（§7.2）：一旦引入 cgo，静态二进制、scratch 镜像、
# 「一条 docker build 出成品」这三条收益全部消失。
#
# ⚠️ SQLite 后端（§7.3.5）也守这条：驱动是 `modernc.org/sqlite`（纯 Go，
# 自带移植版 SQLite），**不是** `mattn/go-sqlite3`。代价是二进制大几 MB，
# 换来的是这一行不用改。
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rehearse ./cmd/rehearse && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate && \
    mkdir -p /out/data

FROM scratch

# ⚠️ 必须带 CA 证书，否则所有出站 HTTPS 都会失败。
#
# 这一条容易漏：scratch 里**一个文件都没有**，而本服务有两个 HTTPS 出口——
#   1. 连 Supabase Postgres（`sslmode=require`，§7.3.2）
#   2. 调 LLM（§7.3.2）
# 少了它，报错是 `x509: certificate signed by unknown authority`，
# 而容器里连个 shell 都没有，排查会很难受。
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

COPY --from=build /out/rehearse /rehearse
COPY --from=build /out/migrate /migrate

# SQLite 后端（§7.3.5）的默认数据目录。
#
# ⚠️ `--chown` 不是装饰：容器以 65534（nobody）运行，而 named volume 首次挂载
# 时 Docker 会把镜像里这个目录的**内容与属主**一起复制进卷——所以在这里
# chown 过，等于把卷也 chown 了。少了它，SQLite 打开文件会失败（EACCES），
# 而错误只有一句 `unable to open database file`。
#
# ⚠️ **bind mount**（`./data:/data`）走的是另一条路：属主由宿主机决定，
# 那种情况下要自己 `chown 65534:65534 ./data`。
COPY --from=build --chown=65534:65534 /out/data /data

# 用 Postgres 时这个卷是空的、没人碰；用 SQLite 时它保证数据不会随
# 容器重建一起消失。声明在这里是为了「忘了在 compose 里挂卷」也不至于丢数据
# ——Docker 会自动建一个匿名卷兜底。
VOLUME /data

# 非 root 运行。
#
# 可写目录只有 `/data`（给 SQLite 用）：迁移文件已 embed 进二进制，日志走 stdout。
#
# 也不需要 tzdata：配额按 UTC+8 自然日切，但那是用 time.FixedZone 在代码里
# 算的，不查系统时区。
USER 65534:65534

EXPOSE 4324

ENTRYPOINT ["/rehearse"]
