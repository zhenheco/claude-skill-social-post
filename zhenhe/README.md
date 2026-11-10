# 振禾分支規則

`zhenhe/main` 保留原作者檔案的原狀：振禾的變更只能新增檔案，不修改或刪除上游既有檔案。每日同步上游時，以取得的 `upstream/main` 作為檢查基準。

私人資料放在 repo 外的 `worker-home/.hermes/profiles/personal-social/social-post-private/`，不要加入 repo。檢查會擋下私人資料路徑（含 `social-post-private/`）、金鑰與憑證檔名（如 `id_rsa`、`.p12`、`credentials.json`），並以 `audit.config.json` 的隱私規則掃描 HEAD／暫存區 blob 內容，並確認 `voice_quick.md` 與上游相同。`*.example.md` 範例檔可放行；`social-post/data/` 中只有根目錄的 `rule_registry.json` 與 Markdown 範例檔可放行。

在 repo 根目錄執行：

```sh
python3 zhenhe/tools/privacy_guard.py --upstream-ref upstream/main
python3 -m unittest discover -s zhenhe/tools -p 'test_*.py'
```

預設會檢查 `HEAD` 及 Git 暫存區，因此 `git add -f` 加入的私人檔案也會被擋下；尚未加入暫存區的檔案不在檢查範圍。可用 `--repo <路徑>` 指定 repo，或用 `--ref <ref>` 只檢查指定的 tree。上游 ref 必須存在；缺少 ref 或執行 Git 失敗時會以 exit 2 結束，發現違規則以 exit 1 結束。
