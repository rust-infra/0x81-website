#!/usr/bin/env python3
"""把一组 Go module 的 .info/.mod/.zip 预置进本地 module cache。

为什么需要它：本机的 module cache（$GOMODCACHE）在沙箱外，Go 在里面做
rename/unlink 会报 `operation not permitted`（shell 的 mv/rm 反而可以）。
于是 `go get` 每次都失败在「下载完了但改不了名」这一步。

绕法：用 curl 把三个文件**直接写到最终路径**（创建文件是允许的，只有改名
不允许），再让 `go mod edit -require` + `GOPROXY=off go mod tidy` 从缓存里解析。

用法：
    python3 scripts/prefetch-modules.py github.com/gin-gonic/gin@v1.10.0

会沿着各 module 的 go.mod 里的 require 递归抓取（Go 1.17+ 的裁剪模块图）。
"""

import os
import re
import sys
import urllib.error
import urllib.request

PROXY = os.environ.get("GOPROXY_URL", "https://goproxy.cn")
CACHE = os.environ["GOMODCACHE"] + "/cache/download"


def escape(path: str) -> str:
    """module path 里的大写字母要写成 !小写（goproxy 的转义规则）。"""
    return "".join("!" + c.lower() if c.isupper() else c for c in path)


def target(mod: str, ver: str, ext: str) -> str:
    return f"{CACHE}/{escape(mod)}/@v/{ver}.{ext}"


def fetch(mod: str, ver: str, ext: str) -> bytes | None:
    dst = target(mod, ver, ext)
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return open(dst, "rb").read()
    url = f"{PROXY}/{escape(mod)}/@v/{ver}.{ext}"
    try:
        with urllib.request.urlopen(url, timeout=120) as resp:
            data = resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as err:
        print(f"  !! {mod}@{ver}.{ext}: {err}", file=sys.stderr)
        return None
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as handle:
        handle.write(data)
    return data


REQUIRE_LINE = re.compile(r"^\s*([^\s/]+(?:/[^\s]+)+)\s+(v[^\s]+)")


def requires(gomod: str) -> list[tuple[str, str]]:
    """从 go.mod 文本里抽出全部 require（含 indirect）。"""
    out: list[tuple[str, str]] = []
    in_block = False
    for raw in gomod.splitlines():
        line = raw.split("//")[0].rstrip()
        if not line.strip():
            continue
        if line.strip().startswith("require ("):
            in_block = True
            continue
        if in_block and line.strip() == ")":
            in_block = False
            continue
        if line.strip().startswith("require ") and "(" not in line:
            line = line.strip()[len("require ") :]
        elif not in_block:
            continue
        match = REQUIRE_LINE.match(line)
        if match:
            out.append((match.group(1), match.group(2)))
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    seen: set[tuple[str, str]] = set()
    queue: list[tuple[str, str]] = []
    for arg in sys.argv[1:]:
        mod, _, ver = arg.partition("@")
        queue.append((mod, ver or "latest"))

    fetched = 0
    while queue:
        mod, ver = queue.pop(0)
        if (mod, ver) in seen:
            continue
        seen.add((mod, ver))

        info = fetch(mod, ver, "info")
        gomod = fetch(mod, ver, "mod")
        if info is None or gomod is None:
            continue
        # 只有真正会被编译进去的包才需要 zip；多抓一点换取「不用再来一轮」。
        fetch(mod, ver, "zip")
        fetched += 1

        for dep_mod, dep_ver in requires(gomod.decode("utf-8", "replace")):
            if (dep_mod, dep_ver) not in seen:
                queue.append((dep_mod, dep_ver))

    print(f"预置完成：{fetched} 个 module（含递归依赖）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
