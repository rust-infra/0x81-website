#!/usr/bin/env python3
"""Validate 0xindex i18n parity and products.ts alignment."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4] / "0xindex"
I18N = ROOT / "src" / "i18n"
PRODUCTS_TS = ROOT / "src" / "data" / "products.ts"


def flatten_keys(obj: dict, prefix: str = "") -> set[str]:
    keys: set[str] = set()
    for key, value in obj.items():
        full = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            keys.update(flatten_keys(value, full))
        else:
            keys.add(full)
    return keys


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def product_ids_from_ts() -> list[str]:
    text = PRODUCTS_TS.read_text(encoding="utf-8")
    return re.findall(r'id:\s*"([^"]+)"', text)


def main() -> int:
    errors: list[str] = []

    en_path = I18N / "en.json"
    zh_path = I18N / "zh.json"

    for path in (en_path, zh_path, PRODUCTS_TS):
        if not path.exists():
            errors.append(f"Missing file: {path}")
            return 1

    en = load_json(en_path)
    zh = load_json(zh_path)
    en_keys = flatten_keys(en)
    zh_keys = flatten_keys(zh)

    only_en = sorted(en_keys - zh_keys)
    only_zh = sorted(zh_keys - en_keys)
    if only_en:
        errors.append(f"Keys in en.json but not zh.json: {', '.join(only_en)}")
    if only_zh:
        errors.append(f"Keys in zh.json but not en.json: {', '.join(only_zh)}")

    product_ids = product_ids_from_ts()
    for pid in product_ids:
        key = f"products.{pid}.blurb"
        if key not in en_keys:
            errors.append(f"products.ts id '{pid}' missing {key} in en.json")
        if key not in zh_keys:
            errors.append(f"products.ts id '{pid}' missing {key} in zh.json")

    if errors:
        print("FAIL — i18n validation errors:\n")
        for err in errors:
            print(f"  • {err}")
        return 1

    print(f"OK — {len(en_keys)} keys matched across en/zh; {len(product_ids)} products aligned.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
