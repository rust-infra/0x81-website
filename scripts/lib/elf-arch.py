#!/usr/bin/env python3
"""校验 ELF 文件的目标架构，避免"编错了架构、部署时才炸"。

用法：elf-arch.py <文件> <amd64|arm64>

被 scripts/build-rust.sh（编译后校验产物）和 scripts/fetch-rust.sh
（下载后校验产物）共用，保证两侧判据一致。
"""

import sys

MACHINES = {"amd64": (62, "x86-64"), "arm64": (183, "aarch64")}
NAMES = {62: "x86-64", 183: "aarch64"}


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    path, key = argv[1], argv[2]
    if key not in MACHINES:
        print(f"未知架构：{key}（可选 {' / '.join(MACHINES)}）", file=sys.stderr)
        return 2

    want, name = MACHINES[key]
    with open(path, "rb") as fh:
        head = fh.read(20)

    if head[:4] != b"\x7fELF":
        print(f"{path}: 不是 ELF 文件", file=sys.stderr)
        return 1

    machine = int.from_bytes(head[18:20], "little")
    if machine != want:
        print(
            f"{path}: 架构是 {NAMES.get(machine, machine)}，期望 {name}"
            f"（PLATFORM 与目标服务器不一致，这个二进制在服务器上会 Exec format error）",
            file=sys.stderr,
        )
        return 1

    print(f"    架构校验通过：Linux ELF {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
