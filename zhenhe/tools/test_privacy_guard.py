"""Exercise the fork guard against small, temporary Git repositories."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


GUARD = Path(__file__).with_name("privacy_guard.py")


class PrivacyGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.write("README.md", "baseline\n")
        self.write(".gitignore", "social-post/style_profile.md\nsocial-post/drafts/\nsocial-post/data/*\n!social-post/data/rule_registry.json\n")
        self.write("social-post/voice_quick.md", "template\n")
        self.write("social-post/data/rule_registry.json", "{}\n")
        self.git("add", "-A")
        self.git("commit", "-qm", "upstream baseline")
        self.git("branch", "upstream-fixture")
        self.upstream = "refs/heads/upstream-fixture"

    def git(self, *arguments):
        return subprocess.run(
            ["git", *arguments], cwd=self.repo, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        ).stdout.strip()

    def write(self, relative, content="sample\n"):
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def guard(self, *arguments):
        return subprocess.run(
            [sys.executable, str(GUARD), "--repo", str(self.repo),
             "--upstream-ref", self.upstream, *arguments],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )

    def assert_guard(self, code, *paths, arguments=()):
        result = self.guard(*arguments)
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, code, output)
        for path in paths:
            self.assertIn(json.dumps(path, ensure_ascii=False), output)
        return result

    def test_clean_addition_and_unchanged_voice_are_allowed(self):
        self.write("zhenhe/notes.md")
        self.git("add", "zhenhe/notes.md")
        self.git("commit", "-qm", "add notes")
        self.assert_guard(0)

    def test_force_added_ignored_profile_is_rejected_before_commit(self):
        self.write("social-post/style_profile.md")
        self.git("add", "-f", "social-post/style_profile.md")
        self.assert_guard(1, "social-post/style_profile.md")

    def test_subdirectory_repo_still_scans_the_entire_index(self):
        self.write("social-post/style_profile.md")
        self.git("add", "-f", "social-post/style_profile.md")
        nested = self.repo / "nested"
        nested.mkdir()
        result = self.guard("--repo", str(nested))
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("social-post/style_profile.md", result.stdout + result.stderr)

    def test_subdirectory_repo_does_not_limit_diff_to_that_directory(self):
        self.write("README.md", "changed\n")
        self.git("add", "README.md")
        self.git("commit", "-qm", "modify upstream")
        self.git("config", "diff.relative", "true")
        nested = self.repo / "nested"
        nested.mkdir()
        result = self.guard("--repo", str(nested), "--ref", "HEAD")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("README.md", result.stdout + result.stderr)

    def test_private_paths_are_all_reported(self):
        paths = (
            "nested/style_profile.md",
            "nested/content_plan.md",
            "nested/_scraped_posts_draft.md",
            "drafts/x.md",
            "social-post/data/posts.jsonl",
            "social-post/data/nested/rule_registry.json",
            "nested/.rd/note.txt",
            "nested/.env.production",
            "nested/.env.local/config.txt",
            "keys/private.pem",
            "keys/private.key",
            "drafts/tab\tname.md",
        )
        for path in paths:
            self.write(path)
        self.git("add", "-f", *paths)
        self.assert_guard(1, *paths)

    def test_newline_in_path_is_reported_on_one_line(self):
        path = "drafts/line\nname.md"
        self.write(path)
        self.git("add", "-f", path)
        result = self.guard()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stdout.splitlines(), ['"drafts/line\\nname.md": private directory'])

    def test_registry_and_example_markdown_are_allowed(self):
        paths = (
            "nested/social-post/data/rule_registry.json",
            "drafts/sample.example.md",
            "social-post/data/sample.example.md",
            "nested/.env.example.md",
            "data/posts.jsonl",
        )
        for path in paths:
            self.write(path)
        self.git("add", "-f", *paths)
        self.assert_guard(0)

    def test_changed_staged_voice_is_rejected(self):
        self.write("social-post/voice_quick.md", "changed\n")
        self.git("add", "social-post/voice_quick.md")
        self.assert_guard(1, "social-post/voice_quick.md")

    def test_new_voice_without_matching_upstream_blob_is_rejected(self):
        self.write("other/voice_quick.md", "template\n")
        self.git("add", "other/voice_quick.md")
        self.assert_guard(1, "other/voice_quick.md")

    def test_modified_upstream_file_is_rejected(self):
        self.write("README.md", "changed\n")
        self.git("add", "README.md")
        self.git("commit", "-qm", "modify upstream")
        self.assert_guard(1, "README.md")

    def test_deleted_upstream_file_is_rejected(self):
        self.git("rm", "README.md")
        self.git("commit", "-qm", "delete upstream")
        self.assert_guard(1, "README.md")

    def test_type_change_is_rejected(self):
        (self.repo / "README.md").unlink()
        os.symlink("social-post/voice_quick.md", self.repo / "README.md")
        self.git("add", "README.md")
        self.git("commit", "-qm", "change type")
        self.assert_guard(1, "README.md")

    def test_explicit_ref_uses_that_tree_not_the_staged_index(self):
        self.write("social-post/style_profile.md")
        self.git("add", "-f", "social-post/style_profile.md")
        self.assert_guard(0, arguments=("--ref", "HEAD"))
        self.git("commit", "-qm", "add private path")
        private_ref = self.git("rev-parse", "HEAD")
        self.git("rm", "social-post/style_profile.md")
        self.git("commit", "-qm", "remove private path")
        self.assert_guard(0)
        self.assert_guard(1, "social-post/style_profile.md", arguments=("--ref", private_ref))

    def test_missing_upstream_fails_closed(self):
        result = self.guard("--upstream-ref", "missing-upstream")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("missing-upstream", result.stdout + result.stderr)

    def test_missing_target_ref_fails_closed(self):
        result = self.guard("--ref", "missing-target")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("missing-target", result.stdout + result.stderr)

    def test_empty_target_ref_fails_closed(self):
        self.write("social-post/style_profile.md")
        self.git("add", "-f", "social-post/style_profile.md")
        result = self.guard("--ref", "")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
