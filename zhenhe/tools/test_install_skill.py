"""Exercise pinned installations in disposable Git repositories."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


INSTALLER = Path(__file__).with_name("install_skill.py")


class InstallSkillTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.target = self.root / "install" / "social-post"
        self.private = self.root / "private"
        self.git("init", "-q")
        self.write("social-post/SKILL.md", "original skill\n")
        self.write("social-post/voice_quick.md", "public starter\n")
        self.write("social-post/data/rule_registry.json", '{"rules": []}\n')
        self.write("zhenhe/overlay/extra.md", "pinned overlay\n")
        self.commit("fixture")
        self.sha = self.git("rev-parse", "HEAD").stdout.strip()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True)

    def write(self, relative, content):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def commit(self, message):
        self.git("add", "-A")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                 "commit", "-qm", message)

    def run_installer(self, *extra, ref="HEAD", target=None, private=None):
        command = [sys.executable, "-B", str(INSTALLER), "--repo", str(self.repo),
                   "--ref", ref, "--target", str(target or self.target)]
        if private is not None:
            command.extend(["--private-dir", str(private)])
        return subprocess.run([*command, *extra], capture_output=True, text=True)

    def rollback(self, *extra):
        return subprocess.run([sys.executable, "-B", str(INSTALLER), "--rollback",
                               "--target", str(self.target), *extra],
                              capture_output=True, text=True)

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def assert_no_links(self, root):
        for path in root.rglob("*"):
            self.assertFalse(path.is_symlink(), str(path))

    def target_file(self, relative, content):
        path = self.target / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def pin(self, root=None):
        return json.loads(((root or self.target) / ".zhenhe-pin.json").read_text())

    def test_new_install_uses_pinned_archive_and_records_public_hashes(self):
        self.write("social-post/SKILL.md", "uncommitted change\n")
        self.write("zhenhe/overlay/extra.md", "uncommitted overlay\n")
        self.assert_success(self.run_installer())
        self.assertFalse(self.private.exists())
        self.assertEqual((self.target / "SKILL.md").read_text(), "original skill\n")
        self.assertEqual((self.target / "extra.md").read_text(), "pinned overlay\n")
        self.assertEqual((self.target / "voice_quick.md").read_text(), "public starter\n")
        pin = self.pin()
        self.assertEqual(pin["sha"], self.sha)
        self.assertEqual(pin["ref"], "HEAD")
        self.assertEqual(datetime.fromisoformat(pin["installed_at"].replace("Z", "+00:00")).utcoffset().total_seconds(), 0)
        public_files = {path.relative_to(self.target).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in self.target.rglob("*")
                        if path.is_file() and path.name != ".zhenhe-pin.json"}
        self.assertEqual(pin["files"], public_files)
        self.assertEqual(pin["private_files"], [])
        self.assert_no_links(self.target)

    def test_existing_unmanaged_target_is_refused_without_changes(self):
        self.target.mkdir(parents=True)
        (self.target / "existing.md").write_text("keep", encoding="utf-8")
        result = self.run_installer()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("unmanaged", result.stderr)
        self.assertEqual((self.target / "existing.md").read_text(), "keep")
        self.assertFalse(list(self.target.parent.glob("social-post.bak-*")))

    def test_reinstall_preserves_private_files_and_metadata_with_same_sha(self):
        self.assert_success(self.run_installer())
        paths = ("style_profile.md", "content_plan.md", "_scraped_posts_draft.md",
                 ".rd/note.txt", "drafts/example.md", "data/posts.jsonl",
                 "data/new_future_file.json", "other-future-name.txt")
        for relative in paths:
            path = self.target_file(relative, "private " + relative)
            path.chmod(0o640)
            os.utime(path, (1600000000, 1600000000))
        before = {relative: (hashlib.sha256((self.target / relative).read_bytes()).hexdigest(),
                             stat.S_IMODE((self.target / relative).stat().st_mode),
                             (self.target / relative).stat().st_mtime_ns)
                  for relative in paths}
        self.assert_success(self.run_installer())
        self.assert_success(self.run_installer())
        self.assertEqual(len(list(self.target.parent.glob("social-post.bak-*"))), 2)
        for relative, expected in before.items():
            path = self.target / relative
            self.assertEqual((hashlib.sha256(path.read_bytes()).hexdigest(),
                              stat.S_IMODE(path.stat().st_mode), path.stat().st_mtime_ns), expected)
        self.assertEqual(set(self.pin()["private_files"]), set(paths))
        self.assertFalse(set(paths) & self.pin()["files"].keys())
        self.assert_no_links(self.target)

    def test_modified_voice_is_preserved_across_new_archive_versions(self):
        self.assert_success(self.run_installer())
        self.target_file("voice_quick.md", "private voice")
        self.write("social-post/voice_quick.md", "new public voice\n")
        self.commit("updated voice")
        self.assert_success(self.run_installer())
        self.assertEqual((self.target / "voice_quick.md").read_text(), "private voice")
        self.assertIn("voice_quick.md", self.pin()["private_files"])
        self.assertNotIn("voice_quick.md", self.pin()["files"])
        self.assert_success(self.run_installer())
        self.assertEqual((self.target / "voice_quick.md").read_text(), "private voice")

    def test_unmodified_voice_is_updated_from_new_archive(self):
        self.assert_success(self.run_installer())
        self.write("social-post/voice_quick.md", "new public voice\n")
        self.commit("updated voice")
        self.assert_success(self.run_installer())
        self.assertEqual((self.target / "voice_quick.md").read_text(), "new public voice\n")
        self.assertNotIn("voice_quick.md", self.pin()["private_files"])
        self.assertEqual(self.pin()["files"]["voice_quick.md"],
                         hashlib.sha256(b"new public voice\n").hexdigest())

    def test_first_import_copies_private_files_without_modifying_source(self):
        (self.private / "data").mkdir(parents=True)
        (self.private / "data/new_future_file.json").write_text('{"fixture": true}\n')
        (self.private / "voice_quick.md").write_text("imported voice")
        (self.private / "drafts").mkdir()
        (self.private / "drafts/example.md").write_text("fixture draft")
        (self.private / "voice_quick.md").chmod(0o640)
        before = {p.relative_to(self.private): (p.read_bytes(), p.stat().st_mode, p.stat().st_mtime_ns)
                  for p in self.private.rglob("*") if p.is_file()}
        self.assert_success(self.run_installer(private=self.private))
        after = {p.relative_to(self.private): (p.read_bytes(), p.stat().st_mode, p.stat().st_mtime_ns)
                 for p in self.private.rglob("*") if p.is_file()}
        self.assertEqual(after, before)
        for relative, (content, mode, mtime) in before.items():
            copy = self.target / relative
            self.assertEqual((copy.read_bytes(), copy.stat().st_mode, copy.stat().st_mtime_ns),
                             (content, mode, mtime))
        self.assertEqual(set(self.pin()["private_files"]), {p.as_posix() for p in before})
        self.assert_no_links(self.target)
        (self.private / "voice_quick.md").write_text("changed source")
        self.assert_success(self.run_installer(private=self.private))
        self.assertEqual((self.target / "voice_quick.md").read_text(), "imported voice")

    def test_reinstall_ignores_even_a_linked_import_source(self):
        self.assert_success(self.run_installer())
        self.target_file("data/posts.jsonl", "current data")
        self.private.symlink_to(self.root, target_is_directory=True)
        self.assert_success(self.run_installer(private=self.private))
        self.assertEqual((self.target / "data/posts.jsonl").read_text(), "current data")
        self.assertTrue(self.private.is_symlink())

    def test_imported_voice_needs_no_archive_starter(self):
        self.git("rm", "-q", "social-post/voice_quick.md")
        self.commit("no starter")
        self.private.mkdir()
        (self.private / "voice_quick.md").write_text("existing voice")
        self.assert_success(self.run_installer(private=self.private))
        self.assertEqual((self.target / "voice_quick.md").read_text(), "existing voice")

    def test_symlink_in_old_target_aborts_without_changing_it(self):
        self.assert_success(self.run_installer())
        outside = self.root / "outside"
        outside.write_text("outside content")
        link = self.target / "data/new_future_file.json"
        link.symlink_to(outside)
        before_pin = (self.target / ".zhenhe-pin.json").read_bytes()
        result = self.run_installer()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertTrue(link.is_symlink())
        self.assertEqual(link.read_text(), "outside content")
        self.assertEqual((self.target / ".zhenhe-pin.json").read_bytes(), before_pin)
        self.assertFalse(list(self.target.parent.glob("social-post.bak-*")))

    def test_symlink_in_import_aborts_without_touching_source(self):
        self.private.mkdir()
        (self.private / "drafts").symlink_to(self.root, target_is_directory=True)
        result = self.run_installer(private=self.private)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertTrue((self.private / "drafts").is_symlink())
        self.assertFalse(self.target.exists())

    def test_nonregular_private_file_aborts_without_changing_old_target(self):
        self.assert_success(self.run_installer())
        fifo = self.target / "data/future.fifo"
        os.mkfifo(fifo)
        result = self.run_installer()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertTrue(stat.S_ISFIFO(fifo.lstat().st_mode))
        self.assertEqual(self.pin()["sha"], self.sha)
        self.assertFalse(list(self.target.parent.glob("social-post.bak-*")))

    def test_active_write_lock_aborts_without_changing_old_target(self):
        self.assert_success(self.run_installer())
        (self.target / "data/.write.lock").mkdir()
        result = self.run_installer()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertTrue((self.target / "data/.write.lock").is_dir())
        self.assertEqual(self.pin()["sha"], self.sha)
        self.assertFalse(list(self.target.parent.glob("social-post.bak-*")))

    def test_dry_run_does_not_create_or_change_anything(self):
        self.assert_success(self.run_installer("--dry-run", private=self.private))
        self.assertFalse(self.target.parent.exists())
        self.assertFalse(self.private.exists())
        self.assert_success(self.run_installer())
        before = (self.target / ".zhenhe-pin.json").read_bytes()
        self.assert_success(self.run_installer("--dry-run"))
        self.assertEqual((self.target / ".zhenhe-pin.json").read_bytes(), before)
        self.assertFalse(list(self.target.parent.glob("social-post.bak-*")))

    def test_rollback_restores_previous_version_with_latest_private_data(self):
        self.assert_success(self.run_installer())
        self.target_file("data/posts.jsonl", "old record\n")
        self.write("social-post/SKILL.md", "second version\n")
        self.commit("second fixture")
        second_sha = self.git("rev-parse", "HEAD").stdout.strip()
        self.assert_success(self.run_installer())
        self.target_file("data/posts.jsonl", "latest record\n")
        self.target_file("data/new_future_file.json", "latest future data")
        self.target_file("voice_quick.md", "latest private voice")
        self.assert_success(self.rollback())
        self.assertEqual((self.target / "SKILL.md").read_text(), "original skill\n")
        self.assertEqual(self.pin()["sha"], self.sha)
        self.assertEqual((self.target / "data/posts.jsonl").read_text(), "latest record\n")
        self.assertEqual((self.target / "data/new_future_file.json").read_text(), "latest future data")
        self.assertEqual((self.target / "voice_quick.md").read_text(), "latest private voice")
        self.assertIn("data/new_future_file.json", self.pin()["private_files"])
        saved_current = [p for p in self.target.parent.glob("social-post.bak-*")
                         if self.pin(p)["sha"] == second_sha]
        self.assertEqual(len(saved_current), 1)
        self.assertEqual((saved_current[0] / "data/posts.jsonl").read_text(), "latest record\n")
        self.assert_no_links(self.target)

    def test_rollback_rejects_symlink_without_changing_either_version(self):
        self.assert_success(self.run_installer())
        self.assert_success(self.run_installer())
        link = self.target / "data/future.json"
        link.symlink_to(self.root / "missing")
        backups = list(self.target.parent.glob("social-post.bak-*"))
        before = (backups[0] / ".zhenhe-pin.json").read_bytes()
        result = self.rollback()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertTrue(link.is_symlink())
        self.assertEqual((backups[0] / ".zhenhe-pin.json").read_bytes(), before)
        self.assertEqual(list(self.target.parent.glob("social-post.bak-*")), backups)

    def test_rollback_does_not_resurrect_deleted_private_files(self):
        self.assert_success(self.run_installer())
        self.target_file("data/retired.json", "old private data")
        self.assert_success(self.run_installer())
        (self.target / "data/retired.json").unlink()
        self.assert_success(self.rollback())
        self.assertFalse((self.target / "data/retired.json").exists())
        self.assertTrue(any((backup / "data/retired.json").exists()
                            for backup in self.target.parent.glob("social-post.bak-*")))

    def test_nonexistent_ref_returns_two_without_writes(self):
        result = self.run_installer(ref="does-not-exist")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("invalid ref", result.stderr)
        self.assertFalse(self.target.exists())

    def test_overlay_is_optional(self):
        self.git("rm", "-qr", "zhenhe")
        self.commit("no overlay")
        self.assert_success(self.run_installer())
        self.assertFalse((self.target / "extra.md").exists())

    def test_refuses_overlapping_private_and_target_directories(self):
        result = self.run_installer(private=self.target / "private")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertFalse(self.target.exists())
        result = self.run_installer(target=self.private / "skill", private=self.private)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertFalse(self.private.exists())

    def test_rollback_without_backup_refuses_and_keeps_target(self):
        self.assert_success(self.run_installer())
        result = self.rollback()
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual((self.target / "SKILL.md").read_text(), "original skill\n")


if __name__ == "__main__":
    unittest.main()
