#!/usr/bin/env bash
# 编译两个 Rust 服务的二进制，产出到 bin/。
#
# 主路径：CI（.github/workflows/release-rust-binaries.yml 在打 tag 时调用本脚本，
# 把产物作为 release 资产发布）。本地跑同一条命令只是后备手段，产物不再进版本
# 控制（bin/ 已 gitignore），服务器用 scripts/fetch-rust.sh 按 tag 下载。
#
# 部署时服务端只做三件事：下载二进制（fetch-rust.sh）+ 构建/拉取 runtime 镜像
# （仅运行时依赖）+ 启动，cargo / Rust 工具链不再出现在服务器上。见
# docker-compose.yml 里 website-rs / moyan-backend 的 build.target: runtime
# 与 ./bin 挂载。
#
# 只产出 Linux 二进制（docker build 本来也只能产出 Linux ELF），并且把架构
# 显式钉成 linux/amd64：否则在 arm64 机器（M 系列 Mac 等）上会编出 aarch64
# 二进制，扔到 x86_64 服务器上直接 Exec format error。
# 目标服务器是 arm64 时：PLATFORM=linux/arm64 scripts/build-rust.sh
# （发布 workflow 目前固定 amd64；arm64 服务器需要改 workflow 或走本地构建。）
#
# 为什么复用 Dockerfile 的 builder stage，而不是在宿主机直接 cargo build：
#   工具链版本、musl target、以及 glibc 匹配关系都钉在各项目的 Dockerfile 里
#   （moyan-backend 要求 GLIBC >= 2.39 才能跑在 trixie runtime 上，见其注释），
#   复用同一段构建才能真正保证"编出来的二进制跑得进 runtime 镜像"。
#
# 用法：
#   scripts/build-rust.sh                    # 两个都编
#   scripts/build-rust.sh website-rs         # 只编一个
set -euo pipefail

cd "$(dirname "$0")/.."

platform=${PLATFORM:-linux/amd64}
case "$platform" in
    linux/amd64) arch_key=amd64 ;;
    linux/arm64) arch_key=arm64 ;;
    *)
        arch_key=""
        echo "注意：PLATFORM=$platform 未内置架构校验，跳过二进制校验。" >&2
        ;;
esac

# 校验提取出来的确实是目标架构的 ELF，避免"编错了架构、部署时才炸"
# （判据与 scripts/fetch-rust.sh 共用同一份实现，见 scripts/lib/elf-arch.py）
check_arch() {
    local file=$1
    [ -n "$arch_key" ] || return 0
    if ! command -v python3 >/dev/null 2>&1; then
        echo "    跳过架构校验（宿主机没有 python3）"
        return 0
    fi
    python3 scripts/lib/elf-arch.py "$file" "$arch_key"
}

out=bin
mkdir -p "$out"

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
    targets=(website-rs moyan-backend)
fi

for name in "${targets[@]}"; do
    case "$name" in
        website-rs) bin_path=/app/target/x86_64-unknown-linux-musl/release/website-rs ;;
        moyan-backend) bin_path=/app/target/release/moyan-backend ;;
        *)
            echo "未知目标：$name（可选 website-rs / moyan-backend）" >&2
            exit 2
            ;;
    esac

    echo "==> 编译 $name（docker build --target builder --platform $platform）"
    docker build --platform "$platform" --target builder -t "0x81-${name}-builder:local" "./$name"

    echo "==> 提取 $bin_path"
    cid=$(docker create "0x81-${name}-builder:local")
    docker cp "$cid:$bin_path" "$out/$name"
    docker rm -v "$cid" >/dev/null
    chmod 0755 "$out/$name"
    check_arch "$out/$name"

    # 留一条"它是哪版源码编的"记录——否则没人分得清 bin/ 里的文件是新的还是
    # 上一版。dir 脏（有未提交的源码改动）时标 -dirty。随 release 一起发布。
    rev=$(git rev-parse --short HEAD)
    if [ -n "$(git status --porcelain -- "$name")" ]; then
        rev="${rev}-dirty"
    fi
    {
        echo "git ${rev}"
        echo "built $(date -Is)"
        echo "platform ${platform}"
    } >"${out}/${name}.rev"

    echo "==> 完成 $out/$name  ($(du -h "$out/$name" | cut -f1), git ${rev})"
done

cat <<'EOF'

下一步（本地构建时）：
  1) 直接从本机部署：docker compose up -d
  2) 或发布到服务器：把 bin/ 下的产物上传到目标机的仓库目录，让 fetch 脚本之外
     的路径也能拿到（scp/rsync），再 docker compose up -d
  3) 走 CI：commit + 打 tag（v*）→ workflow 编译并发布 release 资产 → 服务器
     scripts/fetch-rust.sh <tag> && docker compose up -d

服务端不跑 cargo，只构建 runtime 层（apt/pip，首次一两分钟，之后走缓存）。
若改动过 Dockerfile 的依赖列表，服务器上需要加 --build 重建 runtime 层。
回滚：scripts/fetch-rust.sh <旧 tag> 然后 docker compose up -d。
注意：runtime 层与二进制架构必须一致；服务器是 arm64 时用
PLATFORM=linux/arm64 跑本脚本（发布 workflow 目前只出 amd64）。
EOF
