#!/usr/bin/env bash
# 在本地（开发机或 CI）编译两个 Rust 服务的二进制，产出到 bin/。
#
# 部署时服务端只做两件事：构建/拉取 runtime 镜像（仅运行时依赖）+ 启动，
# cargo / Rust 工具链不再出现在服务器上。见 docker-compose.yml 里
# website-rs / moyan-backend 的 build.target: runtime 与 ./bin 挂载。
#
# 只产出 Linux 二进制（docker build 本来也只能产出 Linux ELF），并且把架构
# 显式钉成 linux/amd64：否则在 arm64 机器（M 系列 Mac 等）上会编出 aarch64
# 二进制，扔到 x86_64 服务器上直接 Exec format error。
# 目标服务器是 arm64 时：PLATFORM=linux/arm64 scripts/build-rust.sh
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
    linux/amd64) want_em=62 ;;
    linux/arm64) want_em=183 ;;
    *)
        want_em=""
        echo "注意：PLATFORM=$platform 未内置架构校验，跳过二进制校验。" >&2
        ;;
esac

# 校验提取出来的确实是目标架构的 ELF，避免"编错了架构、部署时才炸"
check_arch() {
    local file=$1
    [ -n "$want_em" ] || return 0
    if ! command -v python3 >/dev/null 2>&1; then
        echo "    跳过架构校验（宿主机没有 python3）"
        return 0
    fi
    python3 - "$file" "$want_em" <<'PY'
import sys

path, want = sys.argv[1], int(sys.argv[2])
with open(path, "rb") as fh:
    head = fh.read(20)
if head[:4] != b"\x7fELF":
    sys.exit(f"{path}: 不是 ELF 文件")
machine = int.from_bytes(head[18:20], "little")
names = {62: "x86-64", 183: "aarch64"}
if machine != want:
    sys.exit(
        f"{path}: 架构是 {names.get(machine, machine)}，期望 {names.get(want, want)}"
        f"（PLATFORM 与目标服务器不一致，这个二进制在服务器上会 Exec format error）"
    )
print(f"    架构校验通过：Linux ELF {names.get(machine, machine)}")
PY
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

    # 二进制要随仓库提交，所以必须留下"它是哪版源码编的"——否则没人分得清
    # bin/ 里的文件是新的还是上一版。dir 脏（有未提交的源码改动）时标 -dirty。
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

下一步：把 bin/ 连同源码一起提交（二进制与 .rev 都在版本控制里），服务器上
    git pull && docker compose up -d
即可——服务端不跑 cargo，只构建 runtime 层（apt/pip，首次一两分钟，之后走缓存）。
若改动过 Dockerfile 的依赖列表，服务器上需要加 --build 重建 runtime 层。
回滚：git checkout <旧提交> -- bin/<service> 然后 docker compose up -d。
注意：runtime 层是按服务器自身架构构建的，所以它必须与上面 PLATFORM 一致；
服务器是 arm64 时用 PLATFORM=linux/arm64 跑本脚本。
EOF
