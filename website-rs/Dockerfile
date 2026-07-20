# Defaults use Huawei SWR Docker Hub mirror (avoids docker.io / daocloud timeouts).
ARG RUST_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/rust:latest
ARG DEBIAN_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/debian:bookworm-slim

# Build stage
FROM ${RUST_IMAGE} AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY .cargo ./.cargo
COPY src ./src

RUN CARGO_HTTP_TIMEOUT=600 \
    CARGO_HTTP_LOW_SPEED_LIMIT=1 \
    CARGO_HTTP_MULTIPLEXING=false \
    CARGO_NET_RETRY=10 \
    cargo build --release --locked

# Runtime stage
FROM ${DEBIAN_IMAGE}

WORKDIR /app

RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/website-rs /app/website-rs

EXPOSE 80 443

CMD ["./website-rs"]
