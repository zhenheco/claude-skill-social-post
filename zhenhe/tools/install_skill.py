#!/usr/bin/env python3
"""Install a pinned social-post archive without replacing private files."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


PIN = ".zhenhe-pin.json"
PRIVATE_ROOTS = {"style_profile.md", "content_plan.md", "_scraped_posts_draft.md", ".rd", "drafts"}


def git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(["git", "--no-optional-locks", "-C", str(repo), *args],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError(result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def resolve_ref(repo: Path, ref: str) -> str:
    try:
        return git(repo, "rev-parse", "--verify", "--end-of-options",
                   ref + "^{commit}").decode("ascii").strip()
    except (ValueError, UnicodeError) as exc:
        raise ValueError(f"invalid ref {ref!r}: {exc}") from exc


def extract_archive(payload: bytes, prefix: str, destination: Path) -> None:
    """Copy regular archive entries only, without trusting archive paths or links."""
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as archive:
        for entry in archive:
            parts = PurePosixPath(entry.name).parts
            base = PurePosixPath(prefix).parts
            if entry.isdir() and len(parts) < len(base) and base[:len(parts)] == parts:
                continue
            if parts[:len(base)] != base or ".." in parts or not parts:
                raise ValueError(f"unsafe archive path: {entry.name}")
            relative = parts[len(base):]
            if not relative:
                continue
            path = destination.joinpath(*relative)
            if entry.isdir():
                path.mkdir(parents=True, exist_ok=True)
            elif entry.isfile():
                path.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(entry)
                if source is None:
                    raise ValueError(f"unreadable archive file: {entry.name}")
                with source, path.open("wb") as output:
                    shutil.copyfileobj(source, output)
                path.chmod(entry.mode & 0o777)
            else:
                raise ValueError(f"unsupported archive entry: {entry.name}")


def overlay_exists(repo: Path, sha: str) -> bool:
    result = subprocess.run(["git", "--no-optional-locks", "-C", str(repo),
                             "cat-file", "-e", f"{sha}:zhenhe/overlay"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return result.returncode == 0


def linked(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def safe_tree(root: Path) -> tuple[list[Path], list[Path]]:
    """List directories and regular files without following links or junctions."""
    info = root.lstat()
    if linked(info) or not stat.S_ISDIR(info.st_mode):
        raise ValueError(f"not a regular directory: {root}")
    directories: list[Path] = []
    files: list[Path] = []

    def visit(directory: Path) -> None:
        with os.scandir(directory) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                path = Path(entry.path)
                info = entry.stat(follow_symlinks=False)
                if linked(info):
                    raise ValueError(f"linked path is not allowed: {path}")
                relative = path.relative_to(root)
                if stat.S_ISDIR(info.st_mode):
                    directories.append(relative)
                    visit(path)
                elif stat.S_ISREG(info.st_mode):
                    files.append(relative)
                else:
                    raise ValueError(f"non-regular path is not allowed: {path}")

    visit(root)
    return directories, files


def digest(path: Path) -> str:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        if linked(os.fstat(source.fileno())) or not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError(f"not a regular file: {path}")
        result = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
        return result.hexdigest()


def managed(path: Path) -> bool:
    pin = path / PIN
    return path.is_dir() and not linked(path.lstat()) and pin.is_file() and not linked(pin.lstat())


def read_pin(root: Path) -> dict:
    pin = json.loads((root / PIN).read_text(encoding="utf-8"))
    if not isinstance(pin, dict) or not isinstance(pin.get("files"), dict):
        raise ValueError(f"invalid pin in {root}")
    if not isinstance(pin.get("private_files", []), list):
        raise ValueError(f"invalid private file list in {root}")
    for name, value in pin["files"].items():
        path = PurePosixPath(name) if isinstance(name, str) else None
        if (path is None or path.is_absolute() or not path.parts or ".." in path.parts
                or not isinstance(value, str)):
            raise ValueError(f"invalid public file in pin: {name!r}")
    return pin


def private_name(relative: Path) -> bool:
    parts = relative.parts
    return (parts[0] in PRIVATE_ROOTS
            or (parts[0] == "data" and len(parts) > 1
                and relative.as_posix() != "data/rule_registry.json"))


def private_inventory(root: Path, pin: dict, tree: tuple[list[Path], list[Path]]) -> tuple[list[Path], list[Path]]:
    directories, files = tree
    public = pin["files"]
    private_files = []
    for relative in files:
        name = relative.as_posix()
        if name == PIN:
            continue
        if (private_name(relative) or name not in public
                or (name == "voice_quick.md" and digest(root / relative) != public[name])):
            private_files.append(relative)
    private_dirs = [relative for relative in directories
                    if private_name(relative) or not any(
                        name.startswith(relative.as_posix() + "/") for name in public)]
    return private_dirs, private_files


def copy_files(source: Path, destination: Path, tree: tuple[list[Path], list[Path]]) -> None:
    directories, files = tree
    lock = Path("data/.write.lock")
    if any(path == lock or lock in path.parents for path in [*directories, *files]):
        raise ValueError(f"outcome store lock exists: {source / lock}")
    for relative in directories:
        (destination / relative).mkdir(parents=True, exist_ok=True)
    expected = {}
    for relative in files:
        origin = source / relative
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        expected[relative] = digest(origin)
        shutil.copy2(origin, target, follow_symlinks=False)
        info = target.lstat()
        if linked(info) or not stat.S_ISREG(info.st_mode):
            raise ValueError(f"copied path is not a regular file: {relative}")
    for relative, value in expected.items():
        if digest(source / relative) != value or digest(destination / relative) != value:
            raise ValueError(f"copied file hash mismatch: {relative}")


def write_pin(root: Path, pin: dict) -> None:
    (root / PIN).write_text(json.dumps(pin, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def check_lock(root: Path) -> None:
    lock = root / "data" / ".write.lock"
    if lock.exists() or lock.is_symlink():
        raise ValueError(f"outcome store lock exists: {lock}")


def backup_name(target: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    base = target.with_name(f"{target.name}.bak-{stamp}")
    candidate = base
    counter = 0
    while candidate.exists() or candidate.is_symlink():
        counter += 1
        candidate = base.with_name(f"{base.name}-{counter:04d}")
    return candidate


def replace_target(staging: Path, target: Path) -> None:
    backup = None
    if target.exists():
        backup = backup_name(target)
        target.rename(backup)
    try:
        staging.rename(target)
    except OSError:
        if backup is not None:
            backup.rename(target)
        raise


def rollback(target: Path, dry_run: bool) -> None:
    if not managed(target):
        raise ValueError("target is not a managed installation")
    check_lock(target)
    current_tree = safe_tree(target)
    current_private = private_inventory(target, read_pin(target), current_tree)
    prefix = target.name + ".bak-"
    backups = [path for path in target.parent.iterdir()
               if path.name.startswith(prefix) and managed(path)]
    if not backups:
        raise ValueError("no managed backup to restore")
    previous = max(backups, key=lambda path: path.name)
    check_lock(previous)
    previous_tree = safe_tree(previous)
    previous_pin = read_pin(previous)
    previous_private = private_inventory(previous, previous_pin, previous_tree)
    old_private_files = {path.as_posix() for path in previous_private[1]}
    current_private_files = {path.as_posix() for path in current_private[1]}
    if ("voice_quick.md" in old_private_files and "voice_quick.md" not in current_private_files
            and (target / "voice_quick.md").is_file()):
        current_private[1].append(Path("voice_quick.md"))
    print(f"Restore {previous} to {target}; preserve current as {target}.bak-<UTC timestamp>")
    if dry_run:
        return
    with tempfile.TemporaryDirectory(prefix=f".{target.name}.rollback-", dir=target.parent) as name:
        staging = Path(name) / "skill"
        staging.mkdir()
        copy_files(previous, staging, previous_tree)
        for path in previous_private[1]:
            (staging / path).unlink()
        copy_files(target, staging, current_private)
        private = {path.as_posix() for path in current_private[1]}
        previous_pin["private_files"] = sorted(private)
        for path in private:
            previous_pin["files"].pop(path, None)
        write_pin(staging, previous_pin)
        safe_tree(staging)
        check_lock(staging)
        check_lock(previous)
        check_lock(target)
        replace_target(staging, target)


def install(repo: Path, ref: str, target: Path, private: Path | None, dry_run: bool) -> None:
    exists = target.exists() or target.is_symlink()
    if exists and not managed(target):
        raise ValueError("target exists but is unmanaged")
    source = None
    source_tree: tuple[list[Path], list[Path]] = ([], [])
    if exists:
        check_lock(target)
        tree = safe_tree(target)
        source = target
        source_tree = private_inventory(target, read_pin(target), tree)
    elif private is not None:
        if target == private or target in private.parents or private in target.parents:
            raise ValueError("target and private directory overlap")
        if private.exists() or private.is_symlink():
            source = private
            check_lock(private)
            source_tree = safe_tree(private)
            if any(path.as_posix() in {PIN, "data/rule_registry.json"} for path in source_tree[1]):
                raise ValueError("private import contains a reserved file")
    sha = resolve_ref(repo, ref)
    payload = git(repo, "archive", "--format=tar", sha, "social-post")
    overlay = (git(repo, "archive", "--format=tar", sha, "zhenhe/overlay")
               if overlay_exists(repo, sha) else None)
    print(f"Install {ref} ({sha}) to {target}" + (f"; import from {source}" if source else ""))
    if exists:
        print(f"Preserve current installation as {target}.bak-<UTC timestamp>")
    if dry_run:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{target.name}.install-", dir=target.parent) as name:
        staging = Path(name) / "skill"
        staging.mkdir()
        extract_archive(payload, "social-post", staging)
        if overlay is not None:
            extract_archive(overlay, "zhenhe/overlay", staging)
        if (staging / PIN).exists():
            raise ValueError("archive contains reserved pin file")
        _, archive_files = safe_tree(staging)
        public = {path.as_posix(): digest(staging / path) for path in archive_files
                  if not private_name(path)}
        private_files = {path.as_posix() for path in archive_files if private_name(path)}
        if source is not None:
            if not exists:
                for path in source_tree[1]:
                    if path.as_posix() in public and path.as_posix() != "voice_quick.md":
                        raise ValueError(f"private import conflicts with public file: {path}")
            copy_files(source, staging, source_tree)
            private_files.update(path.as_posix() for path in source_tree[1])
        for path in private_files:
            public.pop(path, None)
        pin = {"sha": sha, "ref": ref, "installed_at": datetime.now(timezone.utc).isoformat(),
               "files": public, "private_files": sorted(private_files)}
        write_pin(staging, pin)
        safe_tree(staging)
        check_lock(staging)
        if source is not None:
            check_lock(source)
        replace_target(staging, target)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    parser.add_argument("--ref")
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--private-dir", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    if not args.rollback and not args.ref:
        parser.error("--ref is required for installation")
    try:
        if (args.target.exists() or args.target.is_symlink()) and linked(args.target.lstat()):
            raise ValueError("target must not be a symlink or junction")
        target = args.target.resolve()
        if args.rollback:
            rollback(target, args.dry_run)
        else:
            private = args.private_dir if not target.exists() else None
            if private is not None and (private.exists() or private.is_symlink()) and linked(private.lstat()):
                raise ValueError("private import must not be a symlink or junction")
            install(args.repo.resolve(), args.ref, target, private.resolve() if private else None, args.dry_run)
        return 0
    except (OSError, ValueError, tarfile.TarError) as exc:
        print(f"install_skill: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
