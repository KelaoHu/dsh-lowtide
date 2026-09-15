<div align="center">

# dsh-lowtide

**忙時排任務，閒時自動跑。**

<sub>半自動、全自動兩種模式，躲開大模型的高峰時段和峰頂價格。DeepSeek Harness 必備插件。</sub>

[English](./README.md) | [简体中文](./README.zh-CN.md) | **繁體中文** | [العربية](./docs/README.ar.md) | [Deutsch](./docs/README.de.md) | [Español](./docs/README.es.md) | [Français](./docs/README.fr.md) | [Italiano](./docs/README.it.md) | [한국어](./docs/README.ko.md)

<img src="./assets/overview.png" alt="lowtide overview" width="100%">

</div>

---

![hero](./assets/screenshots/hero.png)

<p align="center"><i>隊列裡壓著三條任務，會話頂端亮著價格狀態，到了你設的視窗它自己開跑</i></p>

## 簡介

lowtide 是 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) 的一個插件。它解決的問題很樸素也非常自然：

通常，你想讓 Agent 幹活的時候，就得坐在電腦前向它發送指令，等待回覆，然後人工審核。但這種工作方式似乎忘了：你有大把的空閒時間，也有避開某些模型峰谷定價的機會。

裝了這個插件，日子會變成這樣：白天想到什麼活兒，隨手扔進隊列，審一眼放行；它攢到你設定的時間（比如晚上七點以後——那會兒 DeepSeek 是低谷價）自動開跑；第二天早上你打開報告，跑得好的收下，跑砸的打回去重跑。

就這點事。但用上一週，你的工作節奏真的會變慢的，可別忘了「時間就是金錢，效率就是生命」……

幾個關鍵能力：

- 四種執行策略：單次、迭代、抽樣、複核，從「一遍過」到「跑五份我來挑」
- 168 項單元測試 + 10 個端到端 spec，CI 在 ubuntu / windows × node 22 / 24 四個環境全綠
- 桌面端和網頁端用的是同一份構建產物，裝一次兩端通用
- 閒時自動落在 DeepSeek 低谷價時段，同樣一批任務，成本大約是高峰的一半

## 正常使用 Agent 的一天可能是這樣的……

**下班前十分鐘。** 你 review 完程式碼，順手排了三個明天的活：一個重構（迭代策略，3 輪）、一份週報（單次）、一個拿不準的方案（抽樣，跑 4 份候選）。全部放行，關機走人。第二天到工位打開晨報：重構做完了，週報躺在那兒，4 份方案並排擺著，每份花了多少錢寫得明明白白。

**週五晚上。** 把攢了一週的雜活一口氣排進去：清依賴、補測試、跑數據腳本。週末兩天全天低谷價，你出去玩，它在家幹活。週一回來看報告，不合格的 retry，合格的合併。

**上午十點的靈機一動。** 你正跟 Agent 聊一個緊急 bug，忽然想讓它「順便把文件也更了」。攔截卡彈出來：現在跑是高峰價，投到晚上跑便宜一半，差多少錢直接寫給你看。點一下「投遞閒時隊列」，草稿一個字不丟，接著聊 bug。

**常開伺服器。** 你有台 24 小時開著的機器跑 dsh。切成 L3 全自動檔，之後從任何地方用 API 投任務（`POST /ds-lowtide/tasks`），它到點自己跑、自己出報告。無人值守，但沙盒、日預算、檔案鎖定這些保險絲一根不少。

**要給客戶的交付物。** 用複核策略：先跑一遍，再自動開個獨立會話，按你指定的關注點（比如「專挑數據來源的硬傷」）把結果重新挑一遍刺。早上你看到的不是裸結果，是結果加一份挑剔的審查意見。

**人在海外。** 你在舊金山，DeepSeek 的高峰是北京時間，換算過來其實是前一天的傍晚和夜裡。設定頁會把官方時段換算成你的本地時鐘，一鍵採用。你按自己的作息設視窗，帳永遠跟官方對齊。

## lowtide 是怎麼工作的

```
① 投遞              ② 裁定              ③ 執行                 ④ 驗收
你有空時：           隊列面板按工作區      到達閒時視窗：          你忙完回來：
攔截卡一鍵投遞        分組展示，逐條        預檢五關全部過了        打開執行報告——
或手動填工單     →   ✓批准 ⏸順延  →    才進沙盒執行       →  結果 + diff + 實花
（四種策略可選）      ✕放棄 / 全部放行     每個視窗只跑一批        + 省下的錢
```

一條任務的完整流程：`pending-review → queued → preflight → running → done / failed / stale / timeout`，外加 `deferred`（順延）和 `dropped`（軟刪，能撈回來）。

第二步「裁定」是 lowtide 跟「全自動腳本」最大的區別：**每條任務都得你親手放行才會執行**（L2 檔是批次開跑前統一放一次）。機器不能自行進入運行隊列。自動化的是執行，不是決策——所以你可以放心地不在場。

## lowtide 的介面介紹

**新建工單彈窗。** 四種策略並排擺開，每個下面都有一句通俗說明；輪數、優先權、運行模式跟著任務走，不用回設定頁改全域。任務落地就是「待審」，誰也別想繞過你進隊列。

![new-task-modal](./assets/screenshots/new-task-modal.png)

**進階設定。** 模型、推理強度、0–9 的優先權、開新會話還是接著上次聊、鎖定檔案清單，都在這張小窗裡。鎖定檔案單獨說一下：列進去的檔案執行前會算一遍 sha256，對不上就標 stale 拒跑——防止排隊期間檔案被其他任務改動，而它毫不知情地覆蓋上去。

![advanced-options](./assets/screenshots/advanced-options.png)

**模型自由選擇。** 默認用官方 `deepseek-flash`（DeepSeek-V4.1-Flash；舊名 `deepseek-v4-flash` 仍可調用但按 Flash 價計費），但每個任務都能單獨指定模型——你 Harness 裡接的都在下拉裡，按來源分組。接了私有 provider 也能用。非官方模型沒有公開價目，帳本會標註「價格未知」；想記帳就去設定頁補個價目。

![model-picker](./assets/screenshots/model-picker.png)

**視窗編輯器。** 多段、跨零點、按星期幾都行。底下那條 24 小時價格帶是即時的：紅高峰綠低谷，你這會兒在哪兒標得清清楚楚。不在東八區就點「一鍵採用官方忙時」，北京時段自動換算成本地時間。

![window-editor](./assets/screenshots/window-editor.png)

**設定頁。** 視窗幾點到幾點、一批跑幾個、單任務最長多久、並發開多少、每天最多花多少、報告留幾份、自治開哪檔、價目表要不要覆寫——全是圖形介面，不用碰設定檔。官方定價規則（含週末全天低谷那條新規）在這頁做了通俗說明。

![settings](./assets/screenshots/settings.png)

日常使用中還有三個介面：**價格膠囊**（會話頂端，忙閒狀態、隊列數，點它直接改視窗）；**忙時攔截卡**（高峰打字就彈，價差寫在明面上，草稿不丟）；**執行報告**（晨報：先說省了多少，異常置頂，候選等你挑，一鍵複製 Markdown）。

## lowtide 的工作區介紹

每個任務都得落在某個工作區（workspace）裡跑。這一個下拉決定了三件事：

**它能動哪些檔案。** 任務跑在沙盒裡，沙盒的邊界就是工作區目錄。選錯了，輕則找不到檔案，重則改了不該改的。

**它跟誰排隊。** 同工作區的任務串行（兩個任務不會同時改一個倉庫），不同工作區並行（上限默認 3，可調）。想要吞吐就把不相關的活撒開，想要順序就收在一起。

**報告怎麼歸組。** 隊列面板和晨報都按工作區分組，任務一多，這個分組會很有用。

工單裡的 Workspace 下拉有三個來源：**Use current workspace**（就用當前會話的，最常用）、**列表裡的已有工作區**（每個都帶絕對路徑，一眼認出來）、**Custom path…**（手填路徑）。選了「續接前序會話」的話，還要再挑工作區和具體會話，任務接著那個會話的上下文繼續幹。

我的建議：**一個項目一個工作區，不要混用。** 預檢裡的 git 快照和檔案鎖定都按工作區生效，混著放容易把自己繞進去。

## 四種策略，什麼時候用哪個

| 策略 | 它幹什麼 | 什麼時候用 | 費用 |
|---|---|---|---|
| **單次** | 跑一遍就完 | 簡單明確的活 | 1× |
| **迭代** | 同一會話連跑 2–5 輪，每輪按你的「迭代眼光」改上一輪；兩輪足夠像就判定收斂，提前收工 | 要打磨的東西：文章、方案、程式碼 | 約 N× |
| **抽樣** | 2–5 個互不可見的獨立會話各跑一份，並排展示標明花費，**你挑**——機器不做審美判斷 | 標題、創意、方案：你要選項不要答案 | 約 N× |
| **複核** | 跑完另開獨立會話，按你的關注點重新挑刺，輸出審查意見 | 重要交付物，發出去前再過一道 | 約 2× |

## 自治三檔

- **L1 per-task**：每條任務單獨 ✓ 才跑。剛開始用、倉庫很重要的時候用它。
- **L2 batch**（默認）：任務進待審，開跑前 30 分鐘彈確認門，一次全放；不放就一律不跑。日常用這個。
- **L3 full-auto**：投遞即入隊，到點直接跑，零確認（切換時要確認兩次）。常開伺服器專用。

單個任務還能在工單裡臨時覆寫全域檔位。

## 架構：如何在你不在場時安全工作

讓 Agent 在你睡覺時跑批任務，並不是一件小事。lowtide 能做到，靠的是底下四層設計。

**Cordis 微核心。** dsh 跑在 Cordis 微核心插件體系上：所有能力都是插件，插件之間靠服務注入說話，互不直接依賴。lowtide 的宿主半就是一組守規矩的 Cordis 服務——路由、調度、狀態機各幹各的，註冊進核心，隨 harness 啟動，也能乾淨卸掉。一句話：它不是貼在 dsh 外面的一層皮，而是長在核心裡的一個器官。

**雙面構建，一份產物。** 宿主半（Node.js）管調度、執行、帳本；瀏覽器半（React）管全部介面。一次構建出雙面產物——桌面版 dsh 的介面本來就是 Web 渲染，所以桌面端和網頁端不用兩個分支，行為一模一樣。

**平台無關的核心層。** `lowtide-core` 裡是視窗模型、價目表、計費公式、隊列匯總、帳本、批次視窗計算——全是不碰 dsh 任何 API 的純函數，獨立成套件獨立測試。核心邏輯經過 44 個純函數單測反覆測試；哪天想移植到別的 Agent 框架，這個套件拆出來就能用。

**縱深防禦。** 預檢五關（工作區還在嗎、git HEAD 動了嗎、鎖定檔案 sha256 對嗎、視窗裝得下嗎、預算夠嗎），任何一關不過就標 stale 或順延，絕不盲跑；三檔沙盒預設審批全置 never——無人值守意味著沒人能點「允許」，所以允許做什麼，開跑前就已限定好；狀態檔案原子寫入，寫壞了自動回退備份；HTTP 路由只認本機同源請求。

狀態同步走 SSE，斷了自動降級 4 秒輪詢——隊列動一下，介面立刻跟著動。

## 安裝

**一鍵安裝（預構建包）：** `dsh plugin --profile web add https://github.com/KelaoHu/dsh-lowtide/releases/latest/download/dsh-lowtide.tgz`——或按下文從源碼構建。

前置：Node `^22.19 || >=24`，pnpm `11.7`。所有依賴都在公共 npm registry，不需要私有源。

先裝 dsh（二選一）：桌面版去 DeepSeek 官方渠道裝 dsh Desktop；命令列版 `npm install -g @deepseek-ai/dsh`。然後在 dsh 的模型設定裡配好一個能用的模型（比如 DeepSeek 官方 API Key）——lowtide 自己不碰你的憑據。

> **相容性（dsh-lowtide ≥ 0.2.3）:**dsh CLI **≥ 0.1.5-rc.1** 或 **DSH Desktop 2.0.3**。瀏覽器半包只依賴各代外殼都靜態播種的模組詞，一份產物兩端都能啟動；0.1.1 時代的 CLI 外殼與桌面端共用同一張種子表，行為應當一致，但只有上面兩個目標經過實測。（0.2.2 及更早版本在 CLI 0.1.5 上無法啟動——見 issue #4。）

然後拉原始碼、構建、裝進去：

```powershell
git clone https://github.com/KelaoHu/dsh-lowtide
cd dsh-lowtide
pnpm install

# 先構建核心層（插件的測試依賴它的產物）
pnpm --filter lowtide-core bundle
# 再構建插件：宿主半 + 瀏覽器半一次出齊
pnpm --filter dsh-lowtide bundle

# 裝進 profile——桌面端網頁端同一份產物
npx @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile desktop add ./packages/dsh-lowtide   # 桌面端
npx @deepseek-ai/dsh@0.1.5-rc.1 plugin --profile web add ./packages/dsh-lowtide       # 網頁端

# 起開發實例（3080 連接埠）
pnpm --filter dsh-lowtide dev
```

裝完打開 dsh，會話頂端應該能看到價格膠囊，輸入區旁邊有隊列面板。看不到就翻下面的常見問題。

## 日常使用

**投遞有三條路。** 攔截卡（高峰打字，一鍵投遞，草稿原樣變工單）；手動工單（輸入區旁點「New」，提示詞、策略、輪數、優先權隨便填）；API（`POST /ds-lowtide/tasks`，接進你自己的自動化）。

**隊列面板的日常。** 按工作區分待執行 / 已結束 / 已放棄三欄；行內 ✓ 批准、⏸ 順延、✕ 放棄（軟刪能恢復）；「全部放行」一次批完；「清空已完成」保持整潔（帳不受影響）；「Run now」不等視窗立刻跑一批，除錯用。

**時間語義。** 官方忙時段按**北京時間**判定（DeepSeek 按北京時間收費，帳得對齊；週末全天閒時）；你自訂的視窗和閒時運行視窗按**你的本地時間**判定，支援跨零點、按星期。視窗結束只是不再啟動新任務，不打斷正在跑的。

**帳本。** `ledger[YYYY-MM-DD] = { yuan, savedYuan }`，實花和省下的按天累計。顯示價就是計費價，同一個公式，逐位可核對。

## 設定項全表

`GET /ds-lowtide/config` 讀，`PUT` 部分更新（未列出的欄位會被拒絕）：

| 欄位 | 類型 | 默認 | 說明 |
|---|---|---|---|
| `autonomy` | `'l1'\|'l2'\|'l3'` | `l2` | 自治三檔；工單裡可單任務覆寫 |
| `batch.window` | `"HH:MM-HH:MM"` | `19:00-23:30` | 閒時運行視窗（本地時區） |
| `batch.tz` | IANA 時區 | 系統時區 | 運行視窗時區（留空=本地） |
| `batch.gateLeadMin` | 分鐘 | `30` | 批次確認門提前量 |
| `batch.maxTasksPerNight` | 數字 | `10` | 每批任務上限 |
| `batch.maxDurationMin` | 分鐘 | `240` | 單任務最長時長（超時取消重試一次） |
| `batch.maxConcurrency` | 數字 | `3` | 最大並發 1–8（同工作區串行，跨工作區並行） |
| `batch.paused` | 布林 | `false` | 暫停自動批次處理 |
| `budgetDailyYuan` | ¥ | `0` | 日預算（0=不限） |
| `windows[]` | 陣列 | `[]` | 自訂視窗；空=官方忙時（北京時間） |
| `windows[].level` | `peak\|off\|custom` | — | 忙時 / 閒時 / 自訂（閒時價×倍率） |
| `windows[].start/end` | `"HH:MM"` | — | 本地鐘點，支援跨零點 |
| `windows[].days` | `1..7` 陣列 | 每天 | ISO 星期（1=週一 … 7=週日） |
| `windows[].tz` | IANA 時區 | 系統時區 | 該視窗的時區 |
| `windows[].multiplier` | 數字 | `1` | custom 視窗的閒時價倍率 |
| `prices[model].{peak,off}.{input,inputCached,output}` | ¥/1M | 官方 | 價目表覆寫 |

## HTTP API

前綴 `/ds-lowtide/`，同源 + loopback 信任圍欄：

| 方法 | 路徑 | 用途 |
|---|---|---|
| GET | `/state` | 匯總狀態（價格/倒數計時/隊列/最新報告） |
| GET | `/events` | SSE 增量推送（用戶端降級 4s 輪詢） |
| GET/PUT | `/config` | 讀/寫設定 |
| POST | `/tasks` | 投遞工單 |
| POST | `/tasks/:id/approve \| defer \| drop \| cancel \| retry \| restore \| delete \| choose-candidate` | 裁定與管理 |
| POST | `/tasks/approve-all` | 全部放行 |
| POST | `/estimate` | 測算：峰價 vs 谷價 |
| POST | `/batch/run-now` | 立即開跑 |
| POST | `/dismiss` | 今日不再攔截 |
| GET | `/health` | 心跳 |

## 權限檔

| preset | sandbox | approval |
|---|---|---|
| `lt-readonly` | read-only | never |
| `lt-standard` | workspace-write | never |
| `lt-trusted` | danger-full-access | never |

投遞 UI 不提供選擇，任務統一按 `lt-standard` 跑；其餘兩檔留給 API（`POST /tasks` 傳 `permissionPreset`）。過了預檢才跑，絕不盲跑。

## 數據與狀態

- 一切持久化在 `$DSH_HOME/lowtide.json`（原子寫入，損壞自動回退備份）；有 `DSH_PROFILE` 時按 profile 隔離。**同一時刻只讓一個實例寫同一個檔案**——桌面版和 Web 版別同時開，或者做好 profile 隔離。
- 每視窗只跑一批，跨零點安全；空隊列不產空報告。
- 順延恢復：視窗開始時預檢順延的任務自動重新入隊（≥3 次標失敗）；你手動順延的回到待裁定。

## 測試與 CI

```powershell
pnpm --filter lowtide-core test    # 核心層純函數 44 測試
pnpm --filter dsh-lowtide test     # 插件單測 124 測試
pnpm --filter dsh-lowtide exec playwright test   # e2e（需 dsh web 在 3080 跑著）
```

10 個 e2e spec 串行跑，從雙面載入冒煙到「投遞→裁定→執行→報告」全閉環（真實 API）都覆蓋。倉庫自帶 GitHub Actions，每次 push / PR 在四個環境上跑 install → build → typecheck → 全部單測。

## 安全

- 路由只認 loopback + 同源；**不要把 3080 暴露到公網**，遠端走 SSH 隧道或鑑權反向代理。
- Windows 端沙盒是緩解級，Linux/macOS 完整強制；無人值守建議疊加檔案白名單和日預算。
- L3 全自動切換有二次確認。
- 狀態檔案裡有完整任務提示詞和路徑，備份注意保管。
- 發現漏洞走 [SECURITY.md](./SECURITY.md) 的私密渠道。

## 常見問題

**視窗到了為什麼沒跑？**
按順序查：任務批了沒 →「暫停閒時批次處理」勾了沒 → 確認門放了沒 → 預算用完沒 → 預檢是不是掛了（任務變 `stale`，詳情頁有原因）。

**抽樣為什麼不會自動選最好的？**
故意的。機器不替你做審美判斷，候選和花費擺給你，你點「選這份」。

**我在國外，忙時對不上作息？**
設定頁會顯示官方時段在你本地長什麼樣；按自己作息來就自訂視窗，或點「一鍵採用官方忙時（換算到我的時區）」。

**估算和實花對不上？**
估算只按輸入 token 上界粗算，實花按真實 usage（含輸出和緩存命中）。報告裡兩個數都有。

**任務變 stale 了？**
預檢掛了：工作區沒了、git 快照變了、鎖定檔案被改了、預算不夠、視窗裝不下。詳情頁看 `lastError`，修好點 `retry`。

## 已知限制與路線圖

- 當前是發布候選（v0.2.2）；e2e 需要真實 dsh web 實例。
- 默認批量模型 `deepseek-flash`；非官方模型沒公開價目，帳本標「價格未知」，可在設定頁手動補。
- 單任務最長 240 分鐘，超時取消重試一次。
- 路線圖候選：多視窗多批次、任務依賴圖、預算自動分攤、報告推送（郵件/Webhook）、價格波動提醒。

## 目錄結構

```
dsh-lowtide/
├── README.md                  English
├── README.zh-CN.md            簡體中文
├── README.zh-HK.md            本檔案
├── assets/screenshots/        README 介面截圖
├── docs/                      多語言 README（ar, de, es, fr, it, ko）
├── LICENSE                    MIT
├── CHANGELOG.md               版本記錄
├── CONTRIBUTING.md            貢獻指南
├── CODE_OF_CONDUCT.md         行為準則
├── SECURITY.md                安全策略
├── .github/                   CI 工作流 + Issue/PR 模板
├── package.json               pnpm workspace 根
└── packages/
    ├── core/                  平台無關核心層（lowtide-core）
    │   ├── src/               windows / pricing / model / digest / ledger / scheduler
    │   └── test/              純函數單測
    └── dsh-lowtide/           插件本體（dsh-lowtide）
        ├── src/               宿主半：routes / runner / scheduler / intake / store / state-machine
        ├── client/            瀏覽器半：components / hooks / i18n / store
        ├── test/              單測 + e2e（Playwright）
        ├── cordis.patch.yml   插件行 + lt-* 權限預設
        └── README.md          套件級 README
```

## 寫在最後

我把這個插件的內容完全開源給大家，希望能夠實現大家生產力水平的提高。同時我也希望能夠得到來自開源社區的反饋，能夠讓我學到更多的內容，我們一起把這一款插件營運好。讓我們在前往 AGI 的星辰大海上一起進步。

做了一點微小的貢獻，謝謝大家。

## 授權

MIT License（見 [LICENSE](./LICENSE)）。

- 構建於 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/dsh) · Cordis 插件體系
- [DeepSeek 模型與價格（2026-09-10 更新）](https://api-docs.deepseek.com/quick_start/pricing) · [更新日誌：V4.1-Flash 上線、模型改名與降價（2026-09-10）](https://api-docs.deepseek.com/updates) · [news](https://api-docs.deepseek.com/news)
