# 钉住工具链版本，避免 rust:latest 漂移导致同一 commit 构建失败。
# 与 Cargo.toml 的 rust-version = "1.85" 对齐；CI 的 x402-checks.yml 也用同一个值。
ARG RUST_IMAGE=rust:1.85

FROM ${RUST_IMAGE} AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends musl-tools ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add x86_64-unknown-linux-musl

WORKDIR /src

COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src \
    && printf 'fn main() {}\n' > src/main.rs \
    && cargo build --release --target x86_64-unknown-linux-musl \
    && rm -rf src

COPY . .
RUN cargo build --release --target x86_64-unknown-linux-musl \
      --bin x402-gateway --bin migrate \
    && mkdir -p /src/data

FROM scratch

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /src/target/x86_64-unknown-linux-musl/release/x402-gateway /x402-gateway
COPY --from=build /src/target/x86_64-unknown-linux-musl/release/migrate /migrate
COPY --from=build --chown=65534:65534 /src/data /data

USER 65534:65534
VOLUME /data
EXPOSE 4330
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/x402-gateway", "-healthcheck"]
ENTRYPOINT ["/x402-gateway"]
