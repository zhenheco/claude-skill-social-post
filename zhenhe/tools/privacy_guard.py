#!/usr/bin/env python3
"""Check a fork's tracked paths and changes against an upstream tree."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "social-post" / "scripts"))
from sync_public import privacy_violations  # noqa: E402

KEY_NAMES = {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials.json"}


def git(repo: str, *arguments: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", repo, *arguments],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode:
        message = os.fsdecode(result.stderr).strip()
        raise RuntimeError(message or "git command failed")
    return result.stdout


def tree_id(repo: str, ref: str, label: str) -> str:
    if not ref:
        raise RuntimeError(f"{label} ref cannot be empty")
    try:
        return git(repo, "rev-parse", "--verify", "--quiet", "--end-of-options", f"{ref}^{{tree}}").decode("ascii").strip()
    except RuntimeError as error:
        raise RuntimeError(f"{label} ref {ref!r} is unavailable or not a tree: {error}") from error


def tree_entries(repo: str, tree: str) -> dict[str, tuple[str, str]]:
    entries = {}
    for record in git(repo, "ls-tree", "-r", "-z", "--full-tree", tree).split(b"\0"):
        if record:
            header, path = record.split(b"\t", 1)
            _mode, kind, blob = header.split(b" ")
            entries[os.fsdecode(path)] = (kind.decode("ascii"), blob.decode("ascii"))
    return entries


def index_entries(repo: str) -> dict[str, tuple[str, str]]:
    entries = {}
    for record in git(repo, "ls-files", "--full-name", "--stage", "-z", "--", ":/").split(b"\0"):
        if record:
            header, path = record.split(b"\t", 1)
            mode, blob, stage = header.split(b" ")
            kind = "commit" if mode == b"160000" else "blob"
            if stage != b"0":
                kind = "unmerged"
            entries[os.fsdecode(path)] = (kind, blob.decode("ascii"))
    return entries


def private_reason(path: str) -> str | None:
    parts = tuple(part.casefold() for part in PurePosixPath(path).parts)
    name = parts[-1]
    if name.endswith(".example.md"):
        return None
    if name in {"style_profile.md", "content_plan.md", "_scraped_posts_draft.md"}:
        return "private profile or draft"
    if any(part in {"drafts", ".rd", "social-post-private"} for part in parts[:-1]):
        return "private directory"
    if any(part.startswith(".env") for part in parts) or name in KEY_NAMES or name.endswith((".pem", ".key", ".p12", ".pfx")):
        return "environment or key file"
    for index in range(len(parts) - 1):
        if parts[index:index + 2] == ("social-post", "data"):
            if parts[index + 2:] != ("rule_registry.json",):
                return "private social-post data"
    return None


def inspect_entries(entries: dict[str, tuple[str, str]], upstream: dict[str, tuple[str, str]]) -> set[tuple[str, str]]:
    violations = set()
    for path, entry in entries.items():
        reason = private_reason(path)
        if reason:
            violations.add((path, reason))
        if PurePosixPath(path).name.casefold() == "voice_quick.md" and (
            entry[0] != "blob" or entry != upstream.get(path)
        ):
            violations.add((path, "voice_quick.md differs from upstream"))
        if entry[0] == "unmerged":
            violations.add((path, "unmerged index entry"))
    return violations


def content_violations(repo: str, entries: dict[str, tuple[str, str]]) -> set[tuple[str, str]]:
    """Scan the blobs a ref or the index points at, never the working directory."""
    config = json.loads((ROOT / "audit.config.json").read_text(encoding="utf-8-sig"))
    violations = set()
    with tempfile.TemporaryDirectory() as scratch:
        rows = []
        for number, (path, (kind, blob)) in enumerate(sorted(entries.items())):
            if kind == "blob" and not private_reason(path):
                copy = Path(scratch) / str(number)
                copy.write_bytes(git(repo, "cat-file", "blob", blob))
                rows.append((copy, path))
        for failure in privacy_violations(rows, config):
            path, _, reason = failure.partition(": ")
            violations.add((path, reason))
    return violations


def diff_violations(repo: str, *arguments: str) -> set[tuple[str, str]]:
    fields = git(repo, "diff", "--name-status", "--no-renames", "--no-relative", "-z", *arguments, "--").split(b"\0")
    violations = set()
    for index in range(0, len(fields) - 1, 2):
        status = fields[index].decode("ascii")
        path = os.fsdecode(fields[index + 1])
        if status != "A":
            violations.add((path, f"upstream change {status}"))
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="repository path (default: current directory)")
    parser.add_argument("--ref", help="tree to inspect (default: HEAD and the index)")
    parser.add_argument("--upstream-ref", default="upstream/main", help="upstream baseline ref")
    args = parser.parse_args()

    try:
        upstream_tree = tree_id(args.repo, args.upstream_ref, "upstream")
        target_tree = tree_id(args.repo, args.ref if args.ref is not None else "HEAD", "target")
        upstream = tree_entries(args.repo, upstream_tree)
        target = tree_entries(args.repo, target_tree)
        violations = inspect_entries(target, upstream)
        violations.update(content_violations(args.repo, target))
        violations.update(diff_violations(args.repo, upstream_tree, target_tree))
        if args.ref is None:
            staged = index_entries(args.repo)
            violations.update(inspect_entries(staged, upstream))
            violations.update(content_violations(args.repo, staged))
            violations.update(diff_violations(args.repo, "--cached", upstream_tree))
    except (OSError, RuntimeError) as error:
        print(f"privacy guard error: {error}", file=sys.stderr)
        return 2

    if violations:
        for path, reason in sorted(violations):
            print(f"{json.dumps(path, ensure_ascii=False)}: {reason}")
        return 1
    print("privacy guard passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
