# 振禾版社群發文規則

本規則適用於安裝後的 social-post Skill。P2 發文、瀏覽器工具、時段及日報格式若與上游 `SKILL.md` 或 `references/generate_and_publish.md` 的敘述衝突，以本文件為準；其餘上游安全與寫作規則仍適用。

## P2 自動發文

P2 寫完稿，同 revision 的 `check-draft` 通過，且語義和事實 QA 都通過後，直接發，不問確認。`check-draft` 沒過或無法執行時不發，在當次回報原因；語義或事實 QA 未通過也不發，並在當次回報原因。

依 Paperclip routine `f1903e1a` 的時段執行：台北時間（Asia/Taipei）每日 08:30、12:30、17:30、21:30。

## 瀏覽器發文

使用 personal-social profile 已安裝的瀏覽器 skill：Facebook 用 `facebook-web-automation`、Threads 用 `threads-web-automation`、LinkedIn 用 `linkedin-web-automation`、X 用 `x-web-automation`。P2 不使用 `chrome:control-chrome`。不執行 P5 留言自動化。其他平台尚未指定發文工具，先停止並在當次回報說明。

## 私人資料

私人 `style_profile.md`、`voice_quick.md`、`content_plan.md`、`drafts/`、`data/` 等資料留在安裝目標，不能 commit 進 repo。依 `zhenhe/INSTALL.md` 的私人資料、一般檔案與安裝時機規則處理；`data/rule_registry.json` 是公開索引，`voice_quick.md` 修改後視為私人資料。

## TG 日報

每篇只列平台和網址，不放摘要或預覽文字。網址前後各留一個半形空格，包含行尾的空格；例如：

```text
FB： https://… 
```

## 規則與候選

新規則及候選照原作者流程，由擁有者 review 精確變更，再另行 activate；未啟用前不是正式有效規則。自動生效待老闆決定，見 ZHENHE-864。
