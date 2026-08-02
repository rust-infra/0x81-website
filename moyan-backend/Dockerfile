# Build stage
ARG RUST_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/rust:latest
# Runtime image must ship glibc >= what the rust:latest builder links against.
# rust:latest produces binaries requiring GLIBC_2.39; Debian bookworm only
# ships glibc 2.36, which caused "GLIBC_2.39 not found" crash loops at startup.
# Debian trixie ships glibc 2.41 and keeps the same package layout.
ARG DEBIAN_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/debian:trixie-slim
FROM ${RUST_IMAGE} AS builder

WORKDIR /app

# Install build dependencies
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g; s/security.debian.org/mirrors.aliyun.com/g' \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y \
    pkg-config \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests
COPY Cargo.toml ./
COPY .cargo ./.cargo

# Copy source code and compile-time assets
COPY src ./src
COPY migrations ./migrations
COPY data ./data

# Build release binary
RUN cargo build --release

# Runtime stage
FROM ${DEBIAN_IMAGE}

WORKDIR /app

# Install runtime dependencies
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g; s/security.debian.org/mirrors.aliyun.com/g' \
        /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y \
    ca-certificates \
    libsqlite3-0 \
    wget \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages --no-cache-dir yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/moyan-backend /app/moyan-backend

# Copy migrations
COPY --from=builder /app/migrations /app/migrations

# Create data directory
RUN mkdir -p /data

# Environment defaults
ENV PORT=4323
ENV DATABASE_URL=sqlite:/data/moyan.db
ENV RUST_LOG=info

# Expose port
EXPOSE 4323

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4323/api/health || exit 1

# Run
CMD ["/app/moyan-backend"]
