#!/usr/bin/env bash
# 服务器侧：从 GitHub Release 把 Rust 二进制拉到 bin/，供 docker-compose 挂载进
# runtime 镜像。本脚本不编译、不需要 Rust 工具链、不需要 docker。
#
# 产物由 .github/workflows/release-rust-binaries.yml 在打 tag（v*）时调用
# scripts/build-rust.sh 生成并按 tag 发布。本地 build-rust.sh 的产物也可用
# scp/rsync 直接放到 bin/，两条路互不影响。
#
# 用法：
#   scripts/fetch-rust.sh                     # 取 latest release，两个服务都更新
#   scripts/fetch-rust.sh v1.2.3              # 指定 tag（回滚就是拉旧 tag）
#   scripts/fetch-rust.sh v1.2.3 website-rs   # 只更新其中一个
#
# 凭证：仓库是 public，匿名就能读 release，通常不需要 token。只有把 REPO
# 指向私有仓库时才需要：fine-grained PAT，权限 Contents: Read，放在环境变量
# GH_TOKEN / GITHUB_TOKEN，或仓库根目录 .env 里的 GH_TOKEN=... 一行。
#
# 无效 token 比不带更糟：GitHub 对坏凭证连公开资源也回 401。所以带了 token
# 就先验一次，401 就丢掉改走匿名。token 不会被写进任何产物。
#
# 落盘是"先下到临时目录 → 校验 sha256 与 ELF 架构 → 在 bin/ 内改名为 .new 再
# rename 覆盖"：下载或校验失败不会留下半个二进制让 compose 挂上去，旧版本仍可用。
set -euo pipefail

cd "$(dirname "$0")/.."

repo=${REPO:-rust-infra/0x81-website}
platform=${PLATFORM:-linux/amd64}
case "$platform" in
    linux/amd64) arch_key=amd64 ;;
    linux/arm64) arch_key=arm64 ;;
    *)
        arch_key=""
        echo "注意：PLATFORM=$platform 未内置架构校验，跳过二进制校验。" >&2
        ;;
esac

tag=${1:-}
shift || true
services=("$@")
if [ ${#services[@]} -eq 0 ]; then
    services=(website-rs moyan-backend)
fi

for name in "${services[@]}"; do
    case "$name" in
        website-rs | moyan-backend) ;;
        *)
            echo "未知目标：$name（可选 website-rs / moyan-backend）" >&2
            exit 2
            ;;
    esac
done

# token 可选。取值顺序：环境变量 > 仓库根 .env 里的 GH_TOKEN 行
token=${GH_TOKEN:-${GITHUB_TOKEN:-}}
if [ -z "$token" ] && [ -f .env ]; then
    token=$(sed -n 's/^GH_TOKEN=//p' .env | tail -1)
fi

if [ -n "$token" ]; then
    probe=$(curl -sS -o /dev/null -w '%{http_code}' \
        -H "Authorization: Bearer $token" \
        -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/${repo}") || probe=000
    if [ "$probe" = "401" ]; then
        echo "注意：GH_TOKEN 无效（HTTP 401），本次改用匿名访问" >&2
        token=""
    fi
fi

# bash 3.2（macOS 自带）在 set -u 下展开空数组会报 unbound variable，
# 所以下面一律用 ${auth[@]+"${auth[@]}"} 这种写法。
auth=()
if [ -n "$token" ]; then
    auth=(-H "Authorization: Bearer $token")
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "缺少 python3（用于解析 release 资产列表与校验架构）" >&2
    exit 1
fi

api() {
    curl -fsSL --retry 3 --retry-all-errors \
        ${auth[@]+"${auth[@]}"} \
        -H "Accept: application/vnd.github+json" \
        "$@"
}

if [ -n "$tag" ]; then
    release_url="https://api.github.com/repos/${repo}/releases/tags/${tag}"
else
    release_url="https://api.github.com/repos/${repo}/releases/latest"
fi
if ! release_json=$(api "$release_url"); then
    echo "拉取 release 失败：${release_url}" >&2
    echo "检查 tag 是否存在；若 REPO 指向私有仓库，需要有效的 GH_TOKEN（Contents: Read）" >&2
    exit 1
fi

# 资产名 → 资产 id。统一走 API：public / private 同一条路径，REPO 换成私有仓库
# 时只要补 token，不用改下载逻辑。
asset_id() {
    printf '%s' "$release_json" | python3 -c '
import json, sys

want = sys.argv[1]
for asset in json.load(sys.stdin).get("assets", []):
    if asset["name"] == want:
        print(asset["id"])
        break
' "$1"
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# 每个服务要拿 3 个资产：二进制、.rev、以及共用的 SHA256SUMS（可选）
wanted=()
for name in "${services[@]}"; do
    wanted+=("$name" "${name}.rev")
done
wanted+=("SHA256SUMS")

for name in "${wanted[@]}"; do
    id=$(asset_id "$name")
    if [ -z "$id" ]; then
        echo "==> release 中没有 $name，跳过"
        continue
    fi
    echo "==> 下载 $name"
    curl -fSL --retry 3 --retry-all-errors \
        ${auth[@]+"${auth[@]}"} \
        -H "Accept: application/octet-stream" \
        "https://api.github.com/repos/${repo}/releases/assets/${id}" \
        -o "${tmp}/${name}"
done

# 校验和：只要 release 里带了 SHA256SUMS 就必须过。--ignore-missing 允许
# "只更新其中一个服务"时另一行缺文件。
if [ -f "${tmp}/SHA256SUMS" ]; then
    echo "==> 校验 sha256"
    (cd "$tmp" && sha256sum -c --ignore-missing SHA256SUMS)
else
    echo "注意：release 没有 SHA256SUMS，跳过校验和检查" >&2
fi

mkdir -p bin
# 同一目录内先写 .new 再 rename：中断/磁盘满都不会让 bin/<service> 处于半个
# 文件的状态（跨文件系统的 mv 其实是复制+删除，没有这个保证）。
install_into_bin() {
    local src=$1 dst=$2
    cp -- "$src" "${dst}.new" && mv -f -- "${dst}.new" "$dst"
}

for name in "${services[@]}"; do
    [ -f "${tmp}/${name}" ] || continue # 下载阶段已提示过
    chmod 0755 "${tmp}/${name}"
    if [ -n "$arch_key" ]; then
        python3 scripts/lib/elf-arch.py "${tmp}/${name}" "$arch_key"
    fi
    install_into_bin "${tmp}/${name}" "bin/${name}"
    if [ -f "${tmp}/${name}.rev" ]; then
        install_into_bin "${tmp}/${name}.rev" "bin/${name}.rev"
    else
        echo "注意：release 里没有 ${name}.rev，bin/${name}.rev 仍是旧值（与刚更新的二进制不对应）" >&2
    fi
    echo "==> 更新 bin/${name}"
done

echo
if [ -n "$tag" ]; then
    echo "完成：bin/ 来自 release ${tag}"
else
    echo "完成：bin/ 来自 latest release"
fi
echo "当前版本："
for name in "${services[@]}"; do
    if [ -f "bin/${name}.rev" ]; then
        sed "s|^|  bin/${name}.rev: |" "bin/${name}.rev"
    fi
done
cat <<EOF

下一步：docker compose up -d        # 只重启容器，不重建镜像
回滚：  scripts/fetch-rust.sh <旧 tag> && docker compose up -d
若要确认版本：cat bin/*.rev
EOF
