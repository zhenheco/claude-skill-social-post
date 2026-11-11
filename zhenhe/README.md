# 振禾分支規則

`zhenhe/main` 保留原作者檔案的原狀：振禾的變更只能新增檔案，不修改或刪除上游既有檔案。每日同步上游時，以取得的 `upstream/main` 作為檢查基準。

私人資料放在 repo 外的 `worker-home/.hermes/profiles/personal-social/social-post-private/`，不要加入 repo。檢查會擋下私人資料路徑（含 `social-post-private/`）、金鑰與憑證檔名（如 `id_rsa`、`.p12`、`credentials.json`），並以 `audit.config.json` 的隱私規則掃描 HEAD／暫存區 blob 內容，並確認 `voice_quick.md` 與上游相同。`*.example.md` 範例檔可放行；`social-post/data/` 中只有根目錄的 `rule_registry.json` 與 Markdown 範例檔可放行。

在 repo 根目錄執行：

```sh
python3 zhenhe/tools/privacy_guard.py --upstream-ref upstream/main
python3 -m unittest discover -s zhenhe/tools -p 'test_*.py'
```

預設會檢查 `HEAD` 及 Git 暫存區，因此 `git add -f` 加入的私人檔案也會被擋下；尚未加入暫存區的檔案不在檢查範圍。可用 `--repo <路徑>` 指定 repo，或用 `--ref <ref>` 只檢查指定的 tree。上游 ref 必須存在；缺少 ref 或執行 Git 失敗時會以 exit 2 結束，發現違規則以 exit 1 結束。

## 重新產生振禾版 Skill

原作者更新 `social-post/SKILL.md` 後，在 repo 根目錄執行：

```sh
python3 -B zhenhe/tools/build_overlay_skill.py
python3 -B zhenhe/tools/build_overlay_skill.py --check
python3 -B -m unittest discover -s zhenhe/tools -p 'test_*.py'
```

產生器只替換發文確認關卡並加入振禾版說明，保留上游規則／候選的人工審核與另行啟用流程。`--check` 只比對、不寫檔；不一致時先檢視上游差異，重新產生並審查 `zhenhe/overlay/SKILL.md`，再執行檢查和測試。若產生器指出確認關卡原句不存在或不只一處，先人工核對原作者的新流程，更新產生器的精確匹配與測試後再產生；不要修改上游檔案或放寬審核流程。安裝器從指定 commit 的 archive 讀取 overlay，工作樹內未提交的產生結果不會被安裝。
