# 如需使用国内 Docker Hub 镜像，可传入例如 docker.mirrors.ustc.edu.cn/library/
ARG REGISTRY=

# Build stage
FROM ${REGISTRY}rust:1-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY .cargo ./.cargo
COPY src ./src

RUN cargo build --release

# Runtime stage
ARG REGISTRY
FROM ${REGISTRY}debian:bookworm-slim

WORKDIR /app

RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/website-rs /app/website-rs

EXPOSE 80 443

CMD ["./website-rs"]
