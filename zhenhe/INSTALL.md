# social-post 安裝與驗證

本次只在 Paperclip 執行的暫存目錄驗證，未安裝到正式 profile。正式安裝應由開發主管審查與安排。

## 安裝、重裝及退回

在此 repo 根目錄執行；以下變數只指向本次執行的暫存空間：

```sh
SP_TARGET="$PAPERCLIP_RUN_SCRATCH_DIR/inst/social-post"
SP_PRIVATE="$PAPERCLIP_RUN_SCRATCH_DIR/inst/private"
python3 -B zhenhe/tools/install_skill.py --repo "$PWD" \
  --ref origin/zhenhe/main --target "$SP_TARGET" --private-dir "$SP_PRIVATE" --dry-run
python3 -B zhenhe/tools/install_skill.py --repo "$PWD" \
  --ref origin/zhenhe/main --target "$SP_TARGET" --private-dir "$SP_PRIVATE"
```

`--repo` 省略時使用目前目錄；`--ref` 可填 commit SHA 或 Git ref。安裝器從解析後 commit 的 Git archive 讀取 `social-post/` 及同一 commit 中可選的 `zhenhe/overlay/`，不讀取工作樹中未提交的內容。`--private-dir` 可省略；僅在 target 不存在的首次安裝時，從該目錄匯入檔案，來源目錄不建立、不刪改。重裝一律使用舊 target，不再讀匯入來源。

`.zhenhe-pin.json` 記錄完整 SHA、原 ref、UTC 安裝時間，`files` 記錄 archive／overlay 的公開檔路徑與 SHA-256；`private_files` 只記錄安裝當時私人檔的相對路徑，不記錄內容。新產生的私人檔會在下次安裝時辨識並列入。為保護公開檔，首次匯入不得包含 `.zhenhe-pin.json`、`data/rule_registry.json`，也不能覆蓋公開檔（`voice_quick.md` 除外）。

重裝時執行同一條安裝命令即可，也可換成其他 `--ref`。沒有 pin 的既有 target 會被拒絕；安裝器先在同層暫存目錄組好新版本，逐檔複製私人資料並核對 SHA-256，再把舊 target 改名為 `social-post.bak-<UTC 時間戳>`，換入新版本。私人一般檔案的權限與 mtime 隨複製保留；同一 SHA 可重裝。退回最新備份時，先以 `--dry-run` 預覽，再執行：

```sh
python3 -B zhenhe/tools/install_skill.py --rollback --target "$SP_TARGET" --dry-run
python3 -B zhenhe/tools/install_skill.py --rollback --target "$SP_TARGET"
```

退回時會複製備份至暫存目錄，換成目前版本的私人資料並核對 hash；已從目前版本刪除的私人檔不會重新出現。目前版本會原樣保留為新的 `.bak-*`，來源備份也保留。遇到 symlink、junction 或非一般檔案會拒絕處理；安裝及退回失敗的回傳碼為 2。

## 私人資料位置與安裝時機

私人資料留在 target 內，均為一般檔案，不使用 symlink。範圍包括 `style_profile.md`、`content_plan.md`、`_scraped_posts_draft.md`、`.rd/`、`drafts/` 及 `data/` 中除 `rule_registry.json` 以外的所有內容，也包含舊 pin 公開檔清單以外的其他路徑。`voice_quick.md` 若與舊 pin 的公開 hash 不同，就視為私人資料沿用；未修改則換成新 archive 版本。

安裝或退回前必須確認 Hermes 沒有執行 social-post：安裝器會拒絕既有的 `data/.write.lock`，但僅靠檢查鎖檔不能防止檢查後有新工作啟動。正式安裝還須避開台北時間 08:00–09:00、12:00–13:00、17:00–18:00、21:00–22:00，以及 PC 夜間升級時段；夜間實際升級時間須另行確認。

## Python 實測（2026-11-03）

測試目標為固定上游 `c22737a33d6cf09c48690f8be076b28bffc43a67` 的暫存安裝。`command -v python3` 為 `/opt/homebrew/bin/python3`，版本 **3.14.9**；從 worker-home 的 `.hermes/installs/` 唯讀檢查 `facts.json` 所記錄的 Hermes venv，其 Python 也是 **3.14.9**。兩者皆以 `-B` 執行，未安裝任何套件。

| 兩個 Python 執行的命令 | 各自 exit | 結果 |
| --- | ---: | --- |
| `scripts/social_data.py validate` | 0 | `valid=True`，各資料筆數為 0 |
| `scripts/social_governance.py status` | 0 | `contract.status` 為 `unconfigured` |
| `scripts/social_governance.py check-draft --input <暫存假草稿> --revision synthetic-revision --platform facebook --media-family text_image --format B --formula F06b` | 1 | 尚無 `data/author_contract.json`，未建立或冒充作者契約 |
| `scripts/log_outcome.py --help` | 0 | 顯示用法；預設 dry-run，寫入需 `--write` |
| `scripts/log_outcome.py references/outcome-bundle.example.json` | 0 | 上游虛構範例通過，顯示 `DRY_RUN valid bundle` |

同 SHA 重裝前後，暫存的 `data/new_future_file.json` SHA-256 一致；兩個 Python 重跑 `social_data.py validate` 均 exit 0。初次安裝的 230 個公開檔 hash 均符合 pin，target 沒有 symlink。

以上呼叫沒有出現缺少 Python 套件的訊息，但未驗證所有功能依賴。安裝器只用標準函式庫，目標支援 Python 3.10–3.14；fixture 測試另在 3.11.15 通過，3.10、3.12、3.13 尚未驗證。未測試真實草稿、有效作者契約、`--write` 或正式 profile。
