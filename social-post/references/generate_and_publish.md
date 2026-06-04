# Phase 2：生成 + 發佈

何時跑：使用者說「發文」「今天發一下」「PO 一篇」「發到 XX」等。

## 步驟 0：發文前三檢查（必做）

1. **爆款冷卻**（SKILL.md R2）：讀 `content_plan.md` 最新戰績。讚 ≥ 100 或（讚 ≥ 50 且留言/讚比 > 0.5）且距今 < 24h → 冷卻中不發，建議使用者回留言 + 作者留言彙整。
2. **鐵粉圈監控**（SKILL.md R3）：讀最近 3 篇戰績。連續 > 85% 追蹤者觸及 → 下一篇**必用 F8-F13 廣推公式**（見 `formulas.md` Part 2）。
3. **輕重節奏**（SKILL.md R1）：上一篇是 🔴 高強度 → 今天強制用 🟢 低強度恢復。

## 步驟

1. **讀 `content_plan.md`** 看今天在 Day 幾、用哪個公式、發哪幾個平台、什麼目標。
2. **讀 `formulas.md`** 對應公式那段（不用讀全部）。
3. **產生平台語氣 brief**：在 skill 目錄執行 `node scripts/generate-brief.mjs --platform <platform> --topic "<topic>"`。
   - 來源是 `$HOME/Documents/CC Cli/brands/personal/core.yaml` + `voice/<platform>.yaml`（由 `config.yaml` 的 `voice_dir` 指向）。
   - 若 CLI 回 `voice not seeded for <platform> — run voice-bootstrap first`，停止生成，先跑 voice bootstrap 或改走下方 @deprecated fallback。
   - @deprecated fallback：只有 `voice/<platform>.yaml` 缺失時才讀舊 `$HOME/Documents/CC Cli/brands/personal/brand.yaml`；新流程不得主動依賴 `brand.yaml`。
4. **依使用者提供的「題材」+ 公式骨架 + generation brief，各平台各生一版草稿**。
   - 沒提供題材就看 `content_plan.md` 的題材提示 → 問使用者「今天要不要講 XXX？」
   - 不要一稿多投：FB 長、X 短、IG 配圖說明、Threads 口語短句
   - 若是 F6 爆款，嚴格照四段式結構
   - 生成時套用 CLI 選出的 hook archetype skeleton，把 `{entity}` 類 placeholder 補成題材中的具體人事物。
   - 套用 `style_fingerprint`：sentence length、beats、emoji density、link rate、register hint 都要貼近 brief。
   - 套用 `voice_directive`：更銳（sharpness:high）、展現實力（demonstrate_expertise）、proof-over-claim，不空喊。
   - 結尾使用 apex CTA（`objective_hierarchy` tier=apex metrics），但仍保持草稿口吻自然。
   - 避開 `avoid_topics` + `forbidden_imports`。
5. **預覽 + 確認**（安全閘）：
   - 把每平台草稿全文貼給使用者
   - 明確標示：`Output is a DRAFT only. Human posts every word. No auto-send (automation_policy.mode=propose_only).`
   - 不自動發佈、不呼叫 posting API、不按送出；作者只產出 DRAFT，使用者人工決定每個字。
6. **若使用者另外要求手動發佈協助**：讀目標平台的 `references/{facebook,instagram,threads,x}.md`，且仍必須先取得當前 session 明確確認。
7. **發完追蹤**：問使用者「要不要等幾小時後幫你看一下數據？」——若要，把「今天發完後 N 小時回看」記 note。
8. **更新 `content_plan.md`**：
    - 把「最近發文日期」改成今天
    - 「今天在哪一天」+1（若到 14 就回 1）
    - 戰績表追加一行（讚/留/分享先空著，事後再填）

## 使用者回報數據時 → 診斷流程

使用者貼 FB 洞察報告截圖 / 數字後：

1. **讀 `references/evaluation.md`**（4 指標框架 + benchmark + 紅線）
2. **不要只看讚絕對值**，按順序評估：分享 > 留言 > dwell > 讚
3. **判斷類型**：擴散型（非追蹤者 > 70%）vs 深化型（< 40%）—— 兩種都是成功
4. **連結點擊率**若 > 1% = 鐵粉真行動（珍貴）
5. 若全踩紅線（讚 < 10、互動率 < 5%、追蹤者 < 30%、連結點擊 = 0）= 真 flop
6. **更新 `content_plan.md`** 戰績備註欄（同一筆更新，不新增 row）
7. 若鐵粉圈 3 連（> 85% 追蹤者）→ 主動警告下篇必用 F8-F13

## 題材提示不夠用時

使用者說「今天沒題材」→
- 先看今天公式：
  - F1 Day-N：問「今天 skill/AI 有什麼進度？」
  - F2 截圖：問「今天有什麼 Claude / 工具的好笑 / 神奇 / 翻車截圖？」
  - F4 里程碑：看 `content_plan.md` 戰績或社群人數有無新里程碑
  - F5 對打：問「今天同時用了哪兩個 AI 工具？」
  - F6 爆款：問「今天 OiiOii / AI 做了什麼新成果？沒有就跳過本日」
  - F7 POV：問「今天踩到什麼荒謬場景？」
  - F3 翻車：一週只排一次，通常有料——問「這週用 X 跑下來，有沒有三件沒人說的事？」
- **寧可跳過也不要硬擠**。跳過就在 `content_plan.md` 戰績表寫「Day X 跳過 / 原因」。

## 省 token 技巧

- 只讀當天要發的平台 ref（1-2 個，不要四個全讀）
- `formulas.md` 可以用 Grep/Read offset 只取該公式段落，不必全文
- 草稿確認後才 Read 平台 ref（預覽階段不需要）
- 發完就更新 `content_plan.md`，別另開新檔案
