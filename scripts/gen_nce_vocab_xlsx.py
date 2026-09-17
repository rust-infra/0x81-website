#!/usr/bin/env python3
"""把《新概念英语》1-4 册词表（含课文例句）生成为 moyan 可导入的 xlsx。

数据源
  1. 词表：https://github.com/Kaiyiwing/qwerty-learner 的 public/dicts/nce-new-{1..4}.json
     （字段：name 单词 / trans 中文释义列表 / usphone / ukphone）。上游是 **GPL-3.0**，
     导入 moyan 前请确认授权是否可接受。
  2. 例句：https://github.com/magang0425/NCE 的 NCE{1..4}/*.lrc 同步字幕，
     每行形如 `[mm:ss.xx]English sentence|中文翻译`，即全套课文的中英对照逐句文本。
     字幕是按朗读停顿切行的，脚本会把连续行合并回完整句子后再生效例句。

生成的 xlsx 严格匹配 moyan-backend/src/services/admin_excel.rs 的格式：
  - 两个工作表，名字必须精确为 `Decks` / `Cards`
  - Decks 表头：name, description, color, source_key（name/description 必填）
  - Cards 表头：deck_name, front, back, example, pronunciation, tags
  - 校验规则：deck_name 必须能在 Decks 里找到；front / back 非空
  - example 单元格：一条例句一行，多条例句用换行；每行是 `英文` 或 `英文|中文`

用法：
    python3 scripts/gen_nce_vocab_xlsx.py [--out PATH] [--cache DIR] [--no-examples]
默认输出到 moyan-backend/data/nce-vocabulary-import.xlsx。该目录整体被 .gitignore 忽略，
但这个 xlsx 是**故意提交进仓库**的（和 system_vocabulary.json 一样），所以重新生成后要用
`git add -f` 才会被跟踪。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from xml.sax.saxutils import escape

RAW_BASE = "https://raw.githubusercontent.com/Kaiyiwing/qwerty-learner/master/public/dicts"
CORPUS_REPO = "https://github.com/magang0425/NCE"

# (册号, 卡组名, 颜色, source_key)
BOOKS = [
    (1, "新概念英语 第1册", "#4A90E2", "nce-1"),
    (2, "新概念英语 第2册", "#2E8B57", "nce-2"),
    (3, "新概念英语 第3册", "#E67E22", "nce-3"),
    (4, "新概念英语 第4册", "#8E44AD", "nce-4"),
]

DECKS_HEADERS = ["name", "description", "color", "source_key"]
CARDS_HEADERS = ["deck_name", "front", "back", "example", "pronunciation", "tags"]

# 每列宽度（人类在 Excel 里看时舒服些；对导入没有影响）
CARD_COL_WIDTHS = [20, 18, 58, 52, 20, 16]
DECK_COL_WIDTHS = [20, 46, 12, 14]

# 挑例句时的长度区间：太短没信息量，太长在卡片上难读（NCE3/4 的长句本身就有 200 字符左右）
MIN_SENTENCE_LEN = 10
MAX_SENTENCE_LEN = 220

_CACHE_DIR = ""
_CORPUS: dict[str, list[tuple[int, str, str]]] = {}


# --------------------------------------------------------------------------- #
# 词表
# --------------------------------------------------------------------------- #
def fetch_vocab(book: int) -> list[dict]:
    """读取（必要时下载）某一册的 qwerty-learner 词表 JSON。"""
    path = os.path.join(_CACHE_DIR, f"nce-new-{book}.json")
    if not os.path.exists(path):
        url = f"{RAW_BASE}/nce-new-{book}.json"
        print(f"  下载 {url}", file=sys.stderr)
        with urllib.request.urlopen(url, timeout=60) as resp, open(path, "wb") as fh:
            fh.write(resp.read())
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def normalize_phone(entry: dict) -> str:
    """音标统一成 moyan 既有的 `/…/` 写法（如 `/ˈveəriəbl/`）。"""
    raw = (entry.get("usphone") or entry.get("ukphone") or "").strip()
    raw = raw.strip("/").strip()
    return f"/{raw}/" if raw else ""


def shape_book(entries: list[dict]) -> tuple[list[dict], dict]:
    """把一册的原始条目整理成 (卡片列表, 统计)。

    处理两类脏数据：
      - 同一个词在词表里重复出现（上游按课文拼接所致）：完全重复的丢弃，
        释义不同的合并进同一张卡，避免 merge 导入时后者覆盖前者。
      - `trans` 为空的条目（如第 3 册 "St. Bernard"）：back 为空会让整个导入
        因 `back is required` 失败，因此剔除并记录。
    """
    stats = {"source": len(entries), "dropped_dup": 0, "merged": 0, "skipped": []}
    seen: dict[str, dict] = {}

    for entry in entries:
        front = (entry.get("name") or "").strip()
        trans = [t.strip() for t in (entry.get("trans") or []) if t and t.strip()]

        if not front:
            stats["skipped"].append(("(空词条)", "缺少单词"))
            continue
        if not trans:
            stats["skipped"].append((front, "缺少中文释义"))
            continue

        key = front.casefold()
        existing = seen.get(key)
        if existing is not None:
            fresh = [t for t in trans if t not in existing["trans"]]
            if fresh:
                existing["trans"].extend(fresh)
                stats["merged"] += 1
            else:
                stats["dropped_dup"] += 1
            if not existing["pronunciation"]:
                existing["pronunciation"] = normalize_phone(entry)
            continue

        seen[key] = {
            "front": front,
            "trans": list(trans),
            "pronunciation": normalize_phone(entry),
        }

    return list(seen.values()), stats


# --------------------------------------------------------------------------- #
# 课文语料（lrc 同步字幕）与例句匹配
# --------------------------------------------------------------------------- #
LRC_LINE = re.compile(r"^\[(\d+):(\d+)\.(\d+)\](.*)$")
LRC_META = ("[al:", "[ar:", "[ti:", "[by:")
# 句子结尾：句末标点后面还可能跟着引号或括号
SENTENCE_END = re.compile(r"""[.!?]["'”’)\]]*$""")
LESSON_TITLE = re.compile(r"^Lesson\s+\d+", re.IGNORECASE)


def parse_lesson_lines(path: str) -> list[tuple[str, str]]:
    """把一课的 lrc 拆成 [(英文, 中文), …]，丢掉文件头的 `Lesson N` 与标题行。"""
    lines: list[tuple[str, str]] = []
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw or raw.startswith(LRC_META):
                continue
            match = LRC_LINE.match(raw)
            if not match:
                continue
            en, _, zh = match.group(4).partition("|")
            lines.append((en.strip(), zh.strip()))
    if lines and LESSON_TITLE.match(lines[0][0]):
        lines = lines[2:]  # "Lesson 48" + 紧随的课文标题
    return lines


def merge_sentences(lines: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """把按朗读停顿切开的字幕行合并回完整句子（中英同步合并）。"""
    units: list[tuple[str, str]] = []
    en_buffer: list[str] = []
    zh_buffer: list[str] = []

    def flush() -> None:
        nonlocal en_buffer, zh_buffer
        if en_buffer:
            units.append(
                (" ".join(part for part in en_buffer if part), " ".join(part for part in zh_buffer if part))
            )
        en_buffer = []
        zh_buffer = []

    for en, zh in lines:
        en_buffer.append(en)
        zh_buffer.append(zh)
        if SENTENCE_END.search(en):
            flush()
    flush()
    return units


def ensure_corpus() -> dict[str, dict[str, list[tuple[int, str, str]]]]:
    """返回 {NCE1..4: {"units": 完整句, "lines": 原始字幕行}}，均按课号排序。

    选例句时优先用 `units`（完整句，可读性好），只为「只在断句里出现」的词退化到 `lines`。
    """
    cache = os.path.join(_CACHE_DIR, "nce_corpus_v2.json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as fh:
            raw = json.load(fh)
        return {
            book: {
                pool: [tuple(row) for row in rows]
                for pool, rows in pools.items()
            }
            for book, pools in raw.items()
        }

    checkout = os.path.join(_CACHE_DIR, "magang-NCE")
    if not os.path.exists(os.path.join(checkout, ".git")):
        print(f"  克隆课文语料 {CORPUS_REPO}", file=sys.stderr)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--filter=blob:none", "--no-checkout",
             CORPUS_REPO, checkout],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    subprocess.run(
        ["git", "sparse-checkout", "set", "--no-cone", "**/*.lrc"],
        cwd=checkout, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["git", "checkout"], cwd=checkout, check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    corpus: dict[str, dict[str, list[tuple[int, str, str]]]] = {}
    for root, _dirs, files in os.walk(checkout):
        book_dir = os.path.basename(root)
        if not re.fullmatch(r"NCE[1-4]", book_dir):
            continue
        units: list[tuple[int, str, str]] = []
        lines: list[tuple[int, str, str]] = []
        for name in sorted(files):
            if not name.endswith(".lrc"):
                continue
            digits = re.sub(r"\D", "", name.split("－")[0]) or "0"
            lesson = int(digits)
            parsed = parse_lesson_lines(os.path.join(root, name))
            lines.extend((lesson, en, zh) for en, zh in parsed)
            units.extend((lesson, en, zh) for en, zh in merge_sentences(parsed))
        units.sort(key=lambda row: row[0])
        lines.sort(key=lambda row: row[0])
        corpus[book_dir] = {"units": units, "lines": lines}

    with open(cache, "w", encoding="utf-8") as fh:
        json.dump(corpus, fh, ensure_ascii=False)
    return corpus


def word_regex(word: str) -> re.Pattern[str]:
    """整词匹配，容忍常见词形变化（-s/-es/-ed/-ing/-'s）。"""
    pattern = re.escape(word.strip()).replace(r"\ ", r"\s+")
    return re.compile(
        r"(?<![A-Za-z])" + pattern + r"(?:s|es|ed|d|ing|ies|'s)?(?![A-Za-z])",
        re.IGNORECASE,
    )


def looks_complete(sentence: str) -> bool:
    """粗略判断是不是一个完整句子（首字母大写/引号开头，句末是 .!?）。"""
    stripped = sentence.strip()
    if not stripped:
        return False
    head = stripped.lstrip("'\"“‘(")
    if not head[:1].isupper():
        return False
    return stripped.rstrip("\"'”’)").rstrip()[-1:] in ".!?"


def find_example(word: str, book: int) -> tuple[str, str, str] | None:
    """在课文里找这个词的例句，返回 (来源, 英文, 中文)。

    优先顺序：本册完整句 → 本册原始断句行 → 其他册完整句 → 其他册断句行。
    每档内取**最早出现该词的课**，同课内优先完整的句子、再取最短的一句——课程顺序与词表
    顺序基本一致，所以这通常就是该词被讲授的那一课。
    """
    regex = word_regex(word)
    others = [f"NCE{b}" for b in range(1, 5) if b != book]
    for book_key in [f"NCE{book}", *others]:
        source = "own" if book_key == f"NCE{book}" else "book"
        for pool in ("units", "lines"):
            hits = [
                (lesson, en, zh)
                for lesson, en, zh in _CORPUS.get(book_key, {}).get(pool, [])
                if MIN_SENTENCE_LEN <= len(en) <= MAX_SENTENCE_LEN and regex.search(en)
            ]
            if not hits:
                continue
            first_lesson = min(lesson for lesson, _, _ in hits)
            lesson_hits = [hit for hit in hits if hit[0] == first_lesson]
            lesson, en, zh = min(
                lesson_hits, key=lambda hit: (not looks_complete(hit[1]), len(hit[1]))
            )
            return source, en, zh
    return None


def example_cell(word: str, book: int) -> tuple[str, str]:
    """返回 (`英文|中文`, 来源)；无译文的句子只给英文，找不到例句则空串。"""
    found = find_example(word, book)
    if not found:
        return "", "none"
    source, en, zh = found
    return (f"{en}|{zh}" if zh else en), source


# --------------------------------------------------------------------------- #
# 组装
# --------------------------------------------------------------------------- #
def build_tables(with_examples: bool) -> tuple[list[list[str]], list[list[str]], dict, dict]:
    global _CORPUS
    if with_examples:
        _CORPUS = ensure_corpus()

    decks: list[list[str]] = []
    cards: list[list[str]] = []
    report: dict = {}
    example_stats = {"own": 0, "book": 0, "none": 0, "with_zh": 0}

    for book, deck_name, color, source_key in BOOKS:
        entries = fetch_vocab(book)
        items, stats = shape_book(entries)

        rows = []
        for item in items:
            cell = ""
            if with_examples:
                cell, source = example_cell(item["front"], book)
                if source == "none":
                    example_stats["none"] += 1
                else:
                    example_stats["own" if source == "own" else "book"] += 1
                    example_stats["with_zh" if "|" in cell else "plain"] += 1
            rows.append([
                deck_name,
                item["front"],
                "\n".join(item["trans"]),
                cell,
                item["pronunciation"],
                "",
            ])

        cards.extend(rows)
        decks.append([
            deck_name,
            f"《新概念英语》第{book}册词汇，{len(rows)} 词（含音标、词性释义与课文例句）"
            if with_examples
            else f"《新概念英语》第{book}册词汇，{len(rows)} 词（含音标与词性释义）",
            color,
            source_key,
        ])
        report[deck_name] = stats

    return decks, cards, report, example_stats


# --------------------------------------------------------------------------- #
# 最小 xlsx 写入（无第三方依赖；只用 inlineStr，不写 sharedStrings）
# --------------------------------------------------------------------------- #
CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"""

WORKBOOK_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="xl/styles.xml"/>
</Relationships>
"""

STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="2">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
</fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>
"""


def column_name(index: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA …"""
    name = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(ord("A") + rem) + name
    return name


def sanitize(value: str) -> str:
    """去掉 XML 1.0 不允许的控制字符（保留 \\n 与 \\t）。"""
    return "".join(ch for ch in value if ch >= " " or ch in "\n\t")


def sheet_xml(rows: list[list[str]], widths: list[int]) -> str:
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    ]
    if widths:
        parts.append("<cols>")
        for idx, width in enumerate(widths, start=1):
            parts.append(f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>')
        parts.append("</cols>")
    parts.append("<sheetData>")
    for row_idx, row in enumerate(rows, start=1):
        parts.append(f'<row r="{row_idx}">')
        for col_idx, value in enumerate(row):
            text = sanitize(str(value))
            if text == "":
                continue  # 空单元格省略，calamine 按缺失列处理为空
            ref = f"{column_name(col_idx)}{row_idx}"
            style = ' s="1"' if row_idx == 1 else ""
            parts.append(
                f'<c r="{ref}"{style} t="inlineStr"><is>'
                f'<t xml:space="preserve">{escape(text)}</t></is></c>'
            )
        parts.append("</row>")
    parts.append("</sheetData></worksheet>")
    return "".join(parts)


def write_workbook(path: str, decks: list[list[str]], cards: list[list[str]]) -> None:
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<sheets>"
        '<sheet name="Decks" sheetId="1" r:id="rId1"/>'
        '<sheet name="Cards" sheetId="2" r:id="rId2"/>'
        "</sheets></workbook>"
    )

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", ROOT_RELS)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", WORKBOOK_RELS)
        zf.writestr("xl/styles.xml", STYLES)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml([DECKS_HEADERS] + decks, DECK_COL_WIDTHS))
        zf.writestr("xl/worksheets/sheet2.xml", sheet_xml([CARDS_HEADERS] + cards, CARD_COL_WIDTHS))


# --------------------------------------------------------------------------- #
def main() -> int:
    global _CACHE_DIR
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--out",
        default=os.path.join("moyan-backend", "data", "nce-vocabulary-import.xlsx"),
        help="输出的 xlsx 路径",
    )
    parser.add_argument(
        "--cache",
        default=os.path.join(tempfile.gettempdir(), "nce-vocab-src"),
        help="上游 JSON / 课文语料的缓存目录",
    )
    parser.add_argument("--no-examples", action="store_true", help="只生成词表，不匹配课文例句")
    args = parser.parse_args()
    _CACHE_DIR = args.cache
    os.makedirs(_CACHE_DIR, exist_ok=True)

    decks, cards, report, example_stats = build_tables(not args.no_examples)

    print("各册统计：")
    for name, stats in report.items():
        count = sum(1 for row in cards if row[0] == name)
        print(
            f"  {name}: 上游 {stats['source']} 条 → 卡片 {count} 张"
            f"（丢弃重复 {stats['dropped_dup']}，合并释义 {stats['merged']}）"
        )
        for word, reason in stats["skipped"]:
            print(f"    ⚠ 剔除 {word}：{reason}")
    print(f"合计：{len(decks)} 个卡组，{len(cards)} 张卡片")

    if not args.no_examples:
        covered = example_stats["own"] + example_stats["book"]
        print(
            f"例句：{covered}/{len(cards)} 张卡有课文原句（本册 {example_stats['own']}，"
            f"跨册 {example_stats['book']}），其中 {example_stats['with_zh']} 条带中文译文；"
            f"{example_stats['none']} 张没有例句"
        )

    write_workbook(args.out, decks, cards)
    print(f"已写出 {args.out}（{os.path.getsize(args.out)} 字节）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
