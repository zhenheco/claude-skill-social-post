#!/usr/bin/env python3
"""Build the Zhenhe skill from the unchanged upstream skill."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "social-post" / "SKILL.md"
OUTPUT = ROOT / "zhenhe" / "overlay" / "SKILL.md"
GATE = "- 發佈前必須在當前對話取得明確「確認」。".encode("utf-8")
AUTO_GATE = "- P2 文稿完成、同 revision 的 `check-draft` 與語義和事實 QA 均通過後直接發佈，不再另問確認；任一檢查未通過則不發佈並回報原因。".encode("utf-8")
BANNER = "> **振禾版：** 執行前先讀 [ZHENHE_OVERRIDES.md](ZHENHE_OVERRIDES.md)；P2 發文、瀏覽器工具、時段及日報格式與上游敘述衝突時，以覆蓋規則為準。規則／候選仍依上游人工審核、另行啟用。".encode("utf-8")


def build(source: bytes) -> bytes:
    count = source.count(GATE)
    if count != 1:
        raise ValueError(f"expected one occurrence of {GATE.decode('utf-8')!r}, found {count}")
    newline = b"\r\n" if source.startswith(b"---\r\n") else b"\n"
    if not source.startswith(b"---" + newline):
        raise ValueError("source skill is missing frontmatter")
    front, separator, body = source.replace(GATE, AUTO_GATE).partition(newline + b"---" + newline)
    if not separator:
        raise ValueError("source skill is missing closing frontmatter")
    return front + separator + newline + BANNER + newline + body


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="compare without writing")
    args = parser.parse_args()
    try:
        generated = build(SOURCE.read_bytes())
        if args.check:
            if not OUTPUT.is_file() or OUTPUT.read_bytes() != generated:
                print("overlay SKILL.md is missing or out of date", file=sys.stderr)
                return 1
            print("overlay SKILL.md is up to date")
        else:
            OUTPUT.parent.mkdir(parents=True, exist_ok=True)
            OUTPUT.write_bytes(generated)
            print("generated zhenhe/overlay/SKILL.md")
    except (OSError, ValueError) as error:
        print(f"build_overlay_skill: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
