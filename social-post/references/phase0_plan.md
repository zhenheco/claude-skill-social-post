# Phase 0：內容規劃

何時跑：`content_plan.md` 不存在、或使用者說「重新規劃」「換策略」「排新的 14 天」。

目標：產出（或更新）`content_plan.md`，內含平台記錄 + 14 天日曆 + 20 篇冷啟動假設 + 總戰績區 + 平台各自記錄 + review 規則。

## 步驟

1. **問目標**：使用者要擴大**社群人數** / 轉換**工坊付費** / 建立**KOL 品牌** / 推**聯盟收益**？單選或混搭。
2. **問平台與頻率**：FB / LinkedIn / Threads / X 各自是否啟用；每天 / 每週 3-5 / 每週 1-2。
3. **讀平台狀態**：
   - `config.yaml` 的 `platform_registry` 決定發文方式（例如 LinkedIn / X = Chrome on demand）。
   - `voice/<platform>.yaml` 的 `voice_state.human_sample_count` 決定狀態：`0` = 冷啟動，已 P1 學風格 = 可開始。
4. **依目標優先序挑公式**：見 `formulas.md` 的「目標 → 公式對應」表；LinkedIn 禁用 FB/Threads 規則，照 `voice/linkedin.yaml forbidden_imports`。
5. **排 14 天日曆**：一天一個 slot，格式見 `content_plan.example.md` 的表格。
   - 同一公式 14 天內不連續出現（至少隔 2-3 天）
   - 爆款模板（F6）不要超過每週 2 次（避免疲勞）
   - Threads 專屬公式（F7）只排 Threads 日
   - FB 長文（F3）一週最多 1 次
6. **寫入 `content_plan.md`**（完整覆寫平台記錄 / 本輪日曆 / 冷啟動假設，保留歷史日曆與既有戰績）。
7. **給使用者 3 句摘要**：本輪主打哪三種題材、各平台怎麼判斷成敗、何時 review。

## `content_plan.md` 必備區塊

照 `content_plan.example.md` 建立或更新。缺一不可：

1. `## 平台記錄`
   - 每個啟用平台一列：語氣來源、發文方式、頻率上限、成熟判定、主要 KPI、狀態。
   - `human_sample_count: 0` 的平台標成冷啟動，不假裝已學會使用者語氣。
   - LinkedIn / X 若是 `Chrome on demand`，註明「使用者指定單篇才發」。
2. `## 本輪日曆`
   - 14 天 slot；平台、類型、主目標、題材提示分開寫。
   - FB 和 LinkedIn 不共用同一稿；同一題材也要平台化重寫。
3. `## 20 篇冷啟動假設`
   - 對沒有真人樣本或沒有歷史戰績的平台，先寫假設、保留條件、淘汰條件。
   - 第一輪只判斷 20 篇後的模式，不用單篇勝負推翻策略。
4. `## 戰績記錄（總表）`
   - 跨平台總表，方便 review 時比較題材和平台。
5. `## <平台> 記錄`
   - 每個啟用平台各自記錄該平台 KPI；例如 `## Facebook 記錄`、`## LinkedIn 記錄`。
   - 滿 72 小時再填成熟判斷；Threads / X 可用 48-72 小時，不用 1-19 小時下結論。

## 範例產出

使用者目標：FB 保持個人語氣 + LinkedIn 冷啟動找題材

→ 平台記錄：FB 已 P1 學風格；LinkedIn `human_sample_count: 0`，先標冷啟動。
→ 14 天日曆：FB 排真人短筆記 / 流程拆解 / demo；LinkedIn 排 cautionary take / process teardown / principle contrast。
→ 戰績：總表 + Facebook 記錄 + LinkedIn 記錄；滿 72 小時才判斷。

## 不要做

- 不要一次塞 14 個同公式（疲勞）
- 不要為了湊滿 14 天就強排（寧缺勿濫，使用者可以跳過）
- 不要在沒戰績數據時就推測「哪個公式對使用者有效」——第一輪是探索，戰績回來再調
- 不要把 FB 的語氣或演算法規則硬搬到 LinkedIn；平台各自記錄、各自 review
