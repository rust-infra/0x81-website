# Defaults use Huawei SWR Docker Hub mirror (avoids docker.io / daocloud timeouts).
ARG RUST_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/rust:latest
ARG DEBIAN_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/debian:bookworm-slim

# Build stage (statically linked musl binary — avoids GLIBC version mismatch)
FROM ${RUST_IMAGE} AS builder

WORKDIR /app

# Install musl target for static linking
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y musl-tools \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add x86_64-unknown-linux-musl

COPY Cargo.toml Cargo.lock ./
COPY .cargo ./.cargo
COPY src ./src

RUN CARGO_HTTP_TIMEOUT=600 \
    CARGO_HTTP_LOW_SPEED_LIMIT=1 \
    CARGO_HTTP_MULTIPLEXING=false \
    CARGO_NET_RETRY=10 \
    cargo build --release --locked --target x86_64-unknown-linux-musl

# Runtime stage — 只装运行时依赖，不含源码、不含 Rust 工具链。
# 部署时用 shell 脚本在本地编译出二进制（scripts/build-rust.sh），
# 由 compose 挂载到 /app/website-rs，服务器不跑 cargo：
#   docker build --target runtime ./website-rs
FROM ${DEBIAN_IMAGE} AS runtime

WORKDIR /app

RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 80 443

CMD ["./website-rs"]

# 一体化镜像（二进制 COPY 进镜像），保留给不使用挂载的场景。
# 默认 stage 仍是它，因此 `docker build ./website-rs` 行为不变。
FROM runtime AS full

COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/website-rs /app/website-rs