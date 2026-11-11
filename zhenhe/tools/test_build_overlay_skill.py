"""Verify the generated skill and the documented Zhenhe overrides."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "zhenhe" / "tools" / "build_overlay_skill.py"
SOURCE = ROOT / "social-post" / "SKILL.md"
OVERLAY = ROOT / "zhenhe" / "overlay"
GATE = "- 發佈前必須在當前對話取得明確「確認」。\n"
AUTO_GATE = "- P2 文稿完成、同 revision 的 `check-draft` 與語義和事實 QA 均通過後直接發佈，不再另問確認；任一檢查未通過則不發佈並回報原因。\n"
BANNER = "> **振禾版：** 執行前先讀 [ZHENHE_OVERRIDES.md](ZHENHE_OVERRIDES.md)；P2 發文、瀏覽器工具、時段及日報格式與上游敘述衝突時，以覆蓋規則為準。規則／候選仍依上游人工審核、另行啟用。\n"


def expected_skill(source):
    replaced = source.replace(GATE, AUTO_GATE)
    front, separator, body = replaced.partition("\n---\n")
    if not source.startswith("---\n") or not separator:
        raise ValueError("missing skill frontmatter")
    return (front + separator + "\n" + BANNER + body).encode("utf-8")


class BuildOverlaySkillTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / "social-post" / "SKILL.md"
        self.output = self.root / "zhenhe" / "overlay" / "SKILL.md"
        self.builder = self.root / "zhenhe" / "tools" / BUILDER.name
        self.source.parent.mkdir(parents=True)
        self.builder.parent.mkdir(parents=True)
        self.source.write_bytes(SOURCE.read_bytes())
        if BUILDER.exists():
            shutil.copyfile(BUILDER, self.builder)

    def build(self, *args):
        return subprocess.run([sys.executable, "-B", str(self.builder), *args],
                              capture_output=True, text=True)

    def test_generated_skill_changes_only_the_publish_gate_and_adds_banner(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        source = self.source.read_text(encoding="utf-8")
        self.assertEqual(self.output.read_bytes(), expected_skill(source))
        output = self.output.read_text(encoding="utf-8")
        self.assertIn("經使用者審核精確 diff／digest，另行啟用後才變成正式有效版本。", output)
        self.assertIn("新的寫作／F 改善建議用候選審核流程，不直接改 voice 或 F 原檔。", output)

    def test_repository_overlay_matches_current_source_byte_for_byte(self):
        self.output.parent.mkdir(parents=True)
        shutil.copyfile(OVERLAY / "SKILL.md", self.output)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.root), "add", "social-post/SKILL.md",
                        "zhenhe/overlay/SKILL.md"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=Paperclip",
                        "-c", "user.email=noreply@paperclip.ing", "-c", "commit.gpgsign=false",
                        "commit", "-qm", "Temporary overlay test", "-m",
                        "Co-Authored-By: Paperclip <noreply@paperclip.ing>"],
                       check=True, capture_output=True)
        committed = subprocess.check_output(["git", "-C", str(self.root), "show",
                                             "HEAD:zhenhe/overlay/SKILL.md"])
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(committed, self.output.read_bytes())

    def test_check_compares_without_writing_even_when_output_is_missing_or_stale(self):
        result = self.build("--check")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertFalse(self.output.exists())
        self.assertEqual(self.build().returncode, 0)
        original = self.output.read_bytes()
        result = self.build("--check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.output.write_bytes(b"stale overlay\n")
        result = self.build("--check")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(self.output.read_bytes(), b"stale overlay\n")
        self.assertNotEqual(original, self.output.read_bytes())

    def test_missing_or_duplicate_gate_fails_and_names_the_sentence(self):
        source = self.source.read_text(encoding="utf-8")
        self.assertEqual(source.count(GATE), 1)
        self.output.parent.mkdir(parents=True)
        self.output.write_text("unchanged\n", encoding="utf-8")
        for changed in (source.replace(GATE, ""), source + GATE):
            with self.subTest(count=changed.count(GATE)):
                self.source.write_text(changed, encoding="utf-8")
                for args in ((), ("--check",)):
                    result = self.build(*args)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(GATE.strip(), result.stderr)
                    self.assertEqual(self.output.read_text(encoding="utf-8"), "unchanged\n")


class OverrideInstructionsTests(unittest.TestCase):
    def test_overrides_cover_publish_transport_schedule_privacy_and_reports(self):
        text = (OVERLAY / "ZHENHE_OVERRIDES.md").read_text(encoding="utf-8")
        for requirement in (
            "`check-draft`", "語義", "事實", "直接發", "不問確認", "不發", "回報原因",
            "facebook-web-automation", "threads-web-automation", "linkedin-web-automation",
            "x-web-automation", "不使用 `chrome:control-chrome`", "不執行 P5 留言自動化",
            "f1903e1a", "台北時間", "08:30", "12:30", "17:30", "21:30",
            "style_profile.md", "voice_quick.md", "content_plan.md", "drafts/", "data/",
            "安裝目標", "不能 commit", "INSTALL.md", "TG 日報", "只列平台和網址",
            "不放摘要或預覽文字", "網址前後各留一個半形空格",
            "由擁有者 review", "另行 activate", "自動生效待老闆決定，見 ZHENHE-864",
        ):
            with self.subTest(requirement=requirement):
                self.assertIn(requirement, text)
        self.assertIn("FB： https://… \n", text)

    def test_readme_explains_regeneration_and_check_failure(self):
        text = (ROOT / "zhenhe" / "README.md").read_text(encoding="utf-8")
        self.assertIn("python3 -B zhenhe/tools/build_overlay_skill.py", text)
        self.assertIn("--check", text)
        self.assertIn("原作者", text)
        self.assertIn("原句", text)
        self.assertIn("人工", text)


if __name__ == "__main__":
    unittest.main()
