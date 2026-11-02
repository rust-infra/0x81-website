#!/usr/bin/env python3
"""把 moyan-backend 的 Rust 场景常量抽成 JSON（阶段 3 的一次性移植脚本）。

不手抄的理由：11 个场景 × (3 组开场白 × 2 条推荐表达 + 双语文案 + 焦点)
≈ 200 条字符串，手抄必错，而且错了要等真机跑才发现。

用法：python3 extract_scenarios.py [--out DIR]
不给 --out 就打 JSON 到 stdout（便于先核对）。
"""

import json
import re
import sys
from pathlib import Path

SRC = Path("moyan-backend/src/services/coach_scenarios.rs")

# §5.2 的改族表：旧的「按工作类型」→ 新的「按演练目的」。
# 这张表是 §5.2 逐 id 定的，不是按规则推的——所以写死在这里，
# 而不是用「Engineering→daily」这种规则（design_discussion 就是例外）。
CATEGORY_MAP = {
    "standup_update": "daily",
    "code_review": "daily",
    "ask_for_help": "daily",
    "remote_small_talk": "daily",
    "design_discussion": "pitch",
    "incident_sync": "hard_talk",
    "scope_deadline": "hard_talk",
    "one_on_one": "hard_talk",
    "interview_screening": "interview",
    "interview_behavioral": "interview",
    "interview_technical": "interview",
}


def join_continuations(text: str) -> str:
    """把 Rust 的 `\\` 行续接拼成一行。

    guidance 里用了 `\\` 换行续接，不处理的话解析出来会带反斜杠和缩进。
    """
    # 先合并物理行：行尾是 \ 的与下一行拼接
    lines = text.split("\n")
    merged = []
    buf = ""
    for line in lines:
        stripped = line.rstrip()
        if stripped.endswith("\\"):
            buf += stripped[:-1]
            continue
        merged.append(buf + line)
        buf = ""
    if buf:
        merged.append(buf)
    return "\n".join(merged)


def rust_str(raw: str) -> str:
    """把 Rust 字符串字面量的内容还原成真实字符。"""
    # 处理 \" \\ \n 等转义；其余保持原样
    out = []
    i = 0
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw):
            nxt = raw[i + 1]
            mapping = {"n": "\n", "t": "\t", "\\": "\\", '"': '"', "'": "'"}
            if nxt in mapping:
                out.append(mapping[nxt])
                i += 2
                continue
            # `\` 后跟换行+空白 = 续接（已被 join_continuations 处理，这里兜底）
            if nxt == "\n":
                i += 2
                while i < len(raw) and raw[i] in " \t":
                    i += 1
                continue
        out.append(c)
        i += 1
    return "".join(out)


def scalar(block: str, field: str) -> str:
    m = re.search(rf'\b{field}:\s*"((?:[^"\\]|\\.)*)"', block, re.S)
    return rust_str(m.group(1)) if m else ""


def integer(block: str, field: str) -> int:
    """抽裸整数（`max_turns: 10`）。scalar() 只认带引号的字符串。"""
    m = re.search(rf"\b{field}:\s*(\d+)", block)
    if not m:
        raise SystemExit(f"字段 {field!r} 没找到整数——结构变了，检查解析器")
    return int(m.group(1))


def str_list(block: str, field: str):
    m = re.search(rf"\b{field}:\s*&\[(.*?)\]", block, re.S)
    if not m:
        return []
    return [rust_str(s) for s in re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1), re.S)]


def openings(block: str):
    """抽 openings 数组：每组含 en / zh / suggestions(2 条 en-zh 对)。"""
    m = re.search(r"\bopenings:\s*&\[(.*)\n        \],", block, re.S)
    if not m:
        m = re.search(r"\bopenings:\s*&\[(.*)", block, re.S)
    body = m.group(1) if m else ""

    out = []
    for chunk in re.split(r"Opening\s*\{", body)[1:]:
        en = re.search(r'\ben:\s*"((?:[^"\\]|\\.)*)"', chunk, re.S)
        zh = re.search(r'\bzh:\s*"((?:[^"\\]|\\.)*)"', chunk, re.S)
        sug = re.search(r"suggestions:\s*&\[(.*?)\]\s*,?\s*\}", chunk, re.S)
        pairs = []
        if sug:
            pairs = re.findall(
                r'\("((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\)', sug.group(1), re.S
            )
        if en and zh:
            out.append(
                {
                    # 字段名刻意用 text / translation 而不是 en / zh：
                    # 中文场景（salary_negotiation 等）里「本来的语言」是中文，
                    # en/zh 这种命名会装错东西。与 §7.6 对 expressions 的
                    # 改名（en/zh → text/translation）是同一套逻辑。
                    "line": {
                        "text": rust_str(en.group(1)),
                        "translation": rust_str(zh.group(1)),
                    },
                    "next_lines": [
                        {"text": rust_str(a), "translation": rust_str(b)} for a, b in pairs
                    ],
                }
            )
    return out


def parse() -> list:
    src = join_continuations(SRC.read_text(encoding="utf-8"))
    # 顶层切块：`    Preset {` 到下一个 `    Preset {`
    starts = [m.start() for m in re.finditer(r"^    Preset \{", src, re.M)]
    blocks = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(src)
        blocks.append(src[start:end])

    out = []
    for block in blocks:
        sid = scalar(block, "id")
        if not sid:
            continue
        locale = scalar(block, "locale")
        category = CATEGORY_MAP.get(sid)
        if category is None:
            raise SystemExit(f"id {sid!r} 不在 §5.2 的改族表里——先更新 CATEGORY_MAP")

        out.append(
            {
                "id": sid,
                "category": category,
                # 旧模型里 locale 同时表示「语言+口音」。新模型拆开（§4.2）：
                # language 决定 AI 说什么语言，accent 只管 TTS 音色。
                # 这里把旧值原样保留成 language，accent 留 null（用默认音色），
                # 因为旧值本来就是各场景的默认口音，没有额外信息。
                "language": locale,
                "difficulty": scalar(block, "difficulty"),
                "max_turns": integer(block, "max_turns"),
                "persona": {
                    "name": scalar(block, "name"),
                    "role": scalar(block, "role"),
                    "accent": None,
                    "tone": scalar(block, "tone"),
                },
                "setting": scalar(block, "setting"),
                "title": {"zh": scalar(block, "title_zh"), "en": scalar(block, "title_en")},
                "description": {
                    "zh": scalar(block, "description_zh"),
                    "en": scalar(block, "description_en"),
                },
                "focus_points": {
                    "zh": str_list(block, "focus_zh"),
                    "en": str_list(block, "focus_en"),
                },
                "openings": openings(block),
                # 服务端专用：绝不进任何下发给客户端的结构（§4.4）。
                "guidance": scalar(block, "guidance"),
            }
        )
    return out


def main() -> None:
    presets = parse()
    out_dir = None
    if "--out" in sys.argv:
        out_dir = Path(sys.argv[sys.argv.index("--out") + 1])

    if out_dir is None:
        json.dump(presets, sys.stdout, ensure_ascii=False, indent=2)
        return

    out_dir.mkdir(parents=True, exist_ok=True)
    for p in presets:
        (out_dir / f"{p['id']}.json").write_text(
            json.dumps(p, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(f"写出 {len(presets)} 个文件到 {out_dir}")


if __name__ == "__main__":
    main()
