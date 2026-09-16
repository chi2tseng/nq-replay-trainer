# Replay Trainer — 全按鈕稽核報告

稽核對象:`D:\Tools\replay-trainer\index.html` + `src\app.js` + `src\styles.css`
稽核方式:靜態碼讀取(grep + Read)逐一比對 icon/title/handler,再用 Playwright(D:\SIPs)開 `http://127.0.0.1:5560/?r=1`,1920×1080 實測每顆可見按鈕的 `getBoundingClientRect` 與 computed style。
唯讀稽核,未修改任何檔案。已知已修項目(btnStepFwd 圖示改 chevron_right、button:focus-visible 外框移除)不再列入。

量測產出檔:
- 全頁截圖:`exports/qa/buttons_1920.png`
- 全部按鈕量測 raw JSON:`exports/qa/buttons_1920_measurements.json`
- 自動掃出的尺寸/重疊/隱藏問題:`exports/qa/buttons_1920_issues.json`
- 補測預設隱藏的 5 顆按鈕(Dashboard 分頁 / RSI 副圖開啟 / 進入 Random 回合後才會出現):`exports/qa/buttons_hidden_measurements.json` + `buttons_dashboard_1920.png` / `buttons_osc_1920.png` / `buttons_round_1920.png`

---

## 表 1:全部按鈕清單

靜態 `<button>` 共 62 顆(index.html);動態由 app.js 樣板字串產生的「按鈕類型」另有 19 種(部分為每列重複實例,如 cal-day / trade-del / log-load,下表只列類型代表,不逐一列每個實例)。

### 上方工具列 `#toolbar`

| id/class | 圖示 | 文字/title | 動作(handler) | 群組/順序 |
|---|---|---|---|---|
| `dateBtn` | calendar_month | dateLabel 動態文字 / title「Jump to trading day」 | `wireCalendar`→`openCal`/`closeCal`(app.js:1978-1995) | .grp date,#1 |
| `btnMtf` | grid_view | 「MTF」/ title「Multiple timeframe view」 | 開關 `mtfPopover`(app.js:3620-3624) | .grp mtf,#2 |
| `btnIndicators` | show_chart | 「Indicators」/ title「Indicators」 | 開關 `indPopover`(app.js:3626-3628) | .grp ind,#3 |
| `btnPrevDay` | keyboard_double_arrow_left | title「Previous trading day 09:30 ET ([ or Left)」 | `prevDay`(3565) | .grp.transport,#1 |
| `btnToStart` | skip_previous | title「Back to session start」 | `gotoSession(sessionSelect.value)`(3564) | transport,#2 |
| `btnStepBack` | chevron_left | title「Step back one bar (flat only)」 | `pause();stepBack()`(3563) | transport,#3 |
| `btnPlay` | play_arrow⇄pause(動態切換,app.js:2085/2092) | title「Play / Pause (P)」 | `play`(3561),內部自行 toggle pause | transport,#4 |
| `btnStepFwd` | chevron_right ✅已修 | title「Step forward one bar (Space)」 | `pause();stepAny()`(3562) | transport,#5 |
| `btnNextDay` | keyboard_double_arrow_right | title「Next trading day 09:30 ET (] or Right)」 | `nextDay`(3566) | transport,#6 |
| `btnPickStart` | my_location | title「Click chart to set replay start (flat only)」 | `setTool('start')`(3574) | transport,#7 |
| `btnFit` | fit_screen | title「Fit — auto-zoom revealed bars (key 0)」 | `fitChart`(3575) | .grp.tools,#1 |
| `btnRandom` | shuffle | title「Random date GAME…」 | `enterRnd`(3576) | tools,#2 |
| `btnSettleNow`(預設 `display:none`) | flag | title「End round now — flatten & show the settlement dashboard」 | `settleNow`(3577) | tools,#3 |
| `btnQuiz` | quiz | title「Quiz me on my own trades…」 | `enterQuiz`(3580) | tools,#4 |
| `btnHelp` | keyboard | title「Keyboard shortcuts (?)」 | `toggleHelp()`(3701) | tools,#5 |
| `btnHideTradesTop`(.tb-btn.hidetrades-btn) | visibility⇄visibility_off | 無文字,title「Show / hide the trade entry & exit arrows」 | `setShowTrades(!showTrades)`(3680) | .grp.right,#1 |
| `btnAlert`(.tb-btn.alert-btn) | alarm + alertLbl | title「Mark a time on the chart…」 | `setAlertTime`(3584) | right,#2 |

### 左側繪圖工具列 `#leftbar`(每顆 34×34,`.lt-btn`)

| id | 圖示 | title | 動作 | 群組順序 |
|---|---|---|---|---|
| `toolCursor`(預設 `.active`) | arrow_selector_tool | 「Cursor — no tool (Esc)」 | `setTool('')`(3598) | 群1 #1 |
| `btnMagnet` | **inline `<svg>` 磁鐵圖(非 Material Symbols)** | 「Magnet — snap drawings to nearest OHLC」 | toggle `magnet`(3599-3600) | 群1 #2 |
| — separator — |||||
| `drwTL` | show_chart | 「Trend line — click two points」 | `setTool('tl')`(3591) | 群2 #1 |
| `drwRay` | north_east | 「Ray — two points, extends right」 | `setTool('ray')`(3592) | 群2 #2 |
| `drwHL` | horizontal_rule | 「Horizontal line — one click」 | `setTool('hl')`(3590) | 群2 #3 |
| `drwBox` | crop_square | 「Rectangle — two corners」 | `setTool('box')`(3593) | 群2 #4 |
| `drwFib` | format_line_spacing | 「Fib retracement…」 | `setTool('fib')`(3594) | 群2 #5 |
| `drwMeasure` | straighten | 「Measure — Δprice/Δticks/Δ%/bars」 | `setTool('measure')`(3595) | 群2 #6 |
| `drwRR` | swap_vert | 「Long/Short position (R:R)…」 | `setTool('rr')`(3597) | 群2 #7 |
| — separator — |||||
| `annUp` | arrow_upward | 「Arrow-up marker」 | `setTool('au')`(3585) | 群3 #1 |
| `annDown` | arrow_downward | 「Arrow-down marker」 | `setTool('ad')`(3586) | 群3 #2 |
| `annLong`(.lt-green) | trending_up | 「Mark LONG」 | `setTool('long')`(3587) | 群3 #3 |
| `annShort`(.lt-red) | trending_down | 「Mark SHORT」 | `setTool('short')`(3588) | 群3 #4 |
| — separator — |||||
| `drwClear` | ink_eraser | 「Clear all drawings — lines, shapes, fib & arrows (Shift+Del)」 | `clearDrawings`(3596)→清空 `drawings`+`annotations`(app.js:1309-1314) | 群4 #1 |
| `annClear` | delete | 「Clear all markers」 | `clearAnnotations`(3589)→清空 `annotations`+`markers`(app.js:1442) | 群4 #2 |

### 圖表覆蓋層(預設隱藏,需觸發才出現)

| id | 圖示 | title | 動作 | 出現條件 |
|---|---|---|---|---|
| `rhEnd`(.rh-end,在 `#rndHud` 內) | flag +「End round」文字 | 無 title | `settleNow`(3578) | Random 回合進行中 |
| `oscClose`(.osc-x,在 `#oscPane` 內) | close | 「Remove oscillator pane」 | `setOscMode('off')`(3629) | 副圖(ATR/RSI/MACD)開啟時 |

### 右側下單面板 `#side`

| id/class | 圖示 | 文字/title | 動作 | 群組 |
|---|---|---|---|---|
| `.seg-btn[data-type]`×3 | 無 | 「Market/Limit/Stop」純文字 | 同步 `#entryType`(3641-3644) | 委託類型 seg |
| `qtyMinus` / `qtyPlus` | 無(`&minus;` / `+`) | 無 title | 數量 ±1(3645-3646) | stepper |
| `rrMinus` / `rrPlus`(結構停損時顯示) | 無(`&minus;` / `+`) | 無 title | `setRr`±0.25(3657-3658) | stepper |
| `.seg-btn[data-src]`×5 | 無 | Open/H-L/Close/Body/50% | `setStopSrc`(3656) | 停損來源 seg |
| `btnBuy` | 無 | 「BUY」/「Long · B」 | `onEntryButton('long')`(3632),鍵 B | bs |
| `btnSell` | 無 | 「SELL」/「Short · S」 | `onEntryButton('short')`(3633),鍵 S | bs |
| `btnBuyStop` | north_east | 「Buy Stop」/ title 含 (F) | `placeBreakout('long')`(3634) | bs-stop |
| `btnSellStop` | south_east | 「Sell Stop」/ title 含 (J) | `placeBreakout('short')`(3635) | bs-stop |
| `btnFlatten` | close | 「Flatten」/ title 含 (X) | `flatten`(3636) | ico-btn |
| `btnReverse` | swap_horiz | 「Reverse」/ **無 title** | `reverse`(3637) | ico-btn |
| `btnCancelEntry` | cancel | 「Cancel order」/ **無 title** | `cancelEntry`(3638) | ico-btn wide |
| `.ord-x`(每筆委託單) | close | title 動態(如「Cancel stop order」) | `cancelOrder`(3639,委派) | 委託清單 |
| `btnAtmSave` | save | 「Save template」 | `saveAtm`(3662) | ATM 編輯 |
| `btnAtmDel` | delete | 「Delete」 | `delAtm`(3663) | ATM 編輯 |

### 底部交易/儀表板列 `#bottom` `#tabs`

| id | 圖示 | 文字/title | 動作 | 順序 |
|---|---|---|---|---|
| `tabTrades`(預設 `.active`) | receipt_long | 「Trades」 | `switchTab(true)`(3665) | #1 |
| `tabDash` | dashboard | 「Dashboard」 | `switchTab(false)`(3666) | #2 |
| `btnHideTrades`(.hidetrades-btn) | visibility⇄visibility_off | 「Hide trades」⇄「Show trades」/ title | `setShowTrades`(3679) | #3 |
| `btnSaveLog` | save | 「Save log」/ title | `saveTradeLog`(3675) | #4 |
| `btnLogs` | folder_open | 「Logs」/ title | `openLogs`(3676) | #5 |
| `btnExportCsv` | download | 「Export CSV」/ **無 title** | `exportCsv`(3677) | #6 |
| `btnReset`(.danger) | delete_sweep | 「Clear」/ **無 title** | `resetAll`(3678) | #7 |

### 動態彈窗/卡片(app.js 樣板字串產生)

| 類型 | 圖示 | 文字/title | 動作 | 位置 |
|---|---|---|---|---|
| `.cal-day`×N | 無(日期數字) | title「Tick tape」/「15-second bars」,無資料則 disabled 無 title | 跳轉當日(delegated,app.js:1984-1992) | 日期彈窗 |
| `.cal-nav`×2 | chevron_left/right | **無 title** | 月份 ±1(app.js:1972-1974) | 日期彈窗 |
| `.pc-nav`×2 | chevron_left/right | **無 title** | 月份 ±1(app.js:3668) | Dashboard PnL 月曆 |
| `stClose` | close | 「Close — stay on this day」 | `closeSettle`(2568) | 結算 modal |
| `stNext`(.primary) | shuffle | 「Next round」 | `closeSettle+rndJump`(2566) | 結算 modal |
| `stExit` | 無 | 「End session」 | `exitRnd`+toast(2567) | 結算 modal |
| `qz-b.buy/sell/skip` | 無 | LONG/SHORT/SKIP | `quizAnswer`(delegated,2675) | 測驗卡 |
| `qz-b.next` | 無 | 「Next question」/「See results」 | `quizGoto`(delegated,2675) | 測驗卡 |
| `qzClose` | close | 無 title | `closeQuizScore`(2725) | 測驗結果 modal |
| `qzAgain`(.primary) | replay | 「New round」 | 重洗題目(2723) | 測驗結果 modal |
| `qzExit` | 無 | 「Exit quiz」 | `exitQuiz`+toast(2724) | 測驗結果 modal |
| `helpClose`(.mini.ico-btn) | close | 無 title | `toggleHelp(false)`(3716) | 快捷鍵說明 modal |
| `ddClose` | close | 無 title | `closeDayDetail`(3217) | 交易日詳情 popover |
| `.trade-del`×N | close | 「Delete this trade」 | `deleteTrade`(delegated,3682) | 交易日詳情 |
| `logClose` | close | 無 title | `closeLogs`(3553) | 交易紀錄 modal |
| `.log-load`×N | download_for_offline | 「Load」 | `loadTradeLog`(delegated,3554) | 交易紀錄 modal |
| `.log-rename`×N | edit | 「Rename log」 | `renameTradeLog`(delegated,3555) | 交易紀錄 modal |
| `.log-del`×N | delete | 「Delete saved log」 | `deleteTradeLog`(delegated,3556) | 交易紀錄 modal |

Playwright 實測:頁面載入時 DOM 中共有 64 顆 `<button>`(靜態,不含動態彈窗內容),59 顆預設可見;死按鈕 0、handler 缺失 0、console error 0。

---

## 表 2:問題清單

| 嚴重度 | 按鈕 | 問題 | 證據 | 建議修法 |
|---|---|---|---|---|
| major | `drwClear` vs `annClear` | 兩顆「清除」按鈕的作用範圍**重疊**:`drwClear`(Shift+Del)清空 `drawings`+`annotations`;`annClear` 清空 `annotations`+`markers`。也就是說按 `drwClear` 會**連帶清掉** annUp/annDown/annLong/annShort 放的箭頭標記,而使用者以為那是 `annClear` 專屬管的東西。title 雖有誠實寫「& arrows」,但兩顆按鈕分開存在會讓人誤判「先清 lines 應該不會動到我的 LONG/SHORT 標記」。 | app.js:1309-1314(`clearDrawings`)vs app.js:1442(`clearAnnotations`);index.html:141-142 | 二選一:(a) `drwClear` 不再動 `annotations`,只清 `drawings`,讓兩顆真正互斥;(b) 或在 `drwClear` 的 title/confirm 對話框把「也會清除箭頭標記」講更醒目。 |
| major | `btnSettleNow` + `rhEnd` | 兩顆按鈕做**同一件事**(`onclick = settleNow`)且在 Random 回合中**同時可見**,視覺樣式還不同:`btnSettleNow` 只有琥珀色 icon(無文字),`rhEnd` 是黑字「flag + End round」文字按鈕,兩者相距僅約 160px。 | index.html:103,154;app.js:3577-3578(handler);app.js:2437-2438(`sn.style.display=on?'':'none'; hud.style.display=on?'':'none'` 同步顯隱);Playwright 實測進入回合後:`btnSettleNow`=(1356,4,44×32,色 rgb(178,106,0));`rhEnd`=(1320,207,184×33,色黑) | 保留一顆即可(建議留 `rhEnd`,因為它在 HUD 卡片內、上下文清楚);`btnSettleNow` 移除或只在 `rndHud` 被使用者拖走/滾動出視窗時才顯示成備援入口。 |
| major | `btnMagnet` | 全站唯一一顆圖示**不是** Material Symbols 字體,而是內嵌 `<svg>` 磁鐵圖,和同一群組其餘 14 顆(`toolCursor`~`annClear`)都用 `<span class="material-symbols-outlined">` 不一致,字重/對齊/縮放行為都可能跟其他圖示不同。 | index.html:126 `<svg viewBox="0 0 24 24" ...>` | 若 Material Symbols 版本有 `magnet` 字符,直接換成 `<span class="material-symbols-outlined">magnet</span>`;若該版本沒有這個字符(未查證,查不到线上字体清单),至少要點出這是刻意的例外並在 CSS 裡讓 `stroke-width`/尺寸對齊其餘 icon 的 22px 字級(見 styles.css:1022)。 |
| minor | `dateBtn` / `btnMtf` 的下拉彈窗 | 同排三顆下拉觸發鈕(`dateBtn`/`btnMtf`/`btnIndicators`)只有 `btnIndicators` 的 `indPopover` 有 Escape 鍵可關閉;`datePopover`、`mtfPopover` 沒有對應的 Escape handler,只能點外部關閉。 | app.js:3628(`indPopover` 的 keydown Escape);wireCalendar app.js:1980-1995(無 Escape);btnMtf 區塊 app.js:3619-3624(無 Escape) | 在全域 keydown(app.js:3684 起)的 Escape 分支裡一併加上「若 `datePopover`/`mtfPopover` 開著就關掉」,和 `indPopover` 邏輯一致。 |
| minor | `drwClear` vs `annClear` 圖示家族 | 同一「清除」子群組,一顆用 `ink_eraser`(橡皮擦),一顆用 `delete`(垃圾桶),兩種完全不同的視覺隱喻並列。 | index.html:141-142 | 統一成同一種比喻,例如都用 `ink_eraser`,或都改 `delete_sweep`(呼應底部 `btnReset` 用的 `delete_sweep`)。 |
| minor | `btnReverse` / `btnCancelEntry` | 同排 `btnFlatten`/`btnBuyStop`/`btnSellStop` 都有含熱鍵說明的 `title`,這兩顆完全沒有 `title`。 | index.html:202(有)、198/199(有)vs 203、205(無) | 補上,例如 `btnReverse` title=「Reverse the current position」、`btnCancelEntry` title=「Cancel the pending stop/limit order」。 |
| minor | `btnExportCsv` / `btnReset` | 同排 `btnSaveLog`/`btnLogs` 有 `title`,這兩顆沒有(`btnReset` 又是刪除性質的 `.danger` 按鈕,更需要提示)。 | index.html:246-247(有)vs 248-249(無) | 補 `title`,例如「Export all trades as CSV」「Clear all trades from this session」。 |
| minor | `.cal-nav` / `.pc-nav`(月曆上下月箭頭) | 全站 icon-only 按鈕幾乎都有 `title`,唯獨這兩組月份導覽箭頭完全沒有。 | app.js:1972-1974(`cal-nav`)、app.js:3072-3074(`pc-nav`) | 補 `title="Previous month"` / `"Next month"`。 |
| minor | `qtyMinus`/`rrMinus` vs `qtyPlus`/`rrPlus` | 減號用真正的 `&minus;`(U+2212,較粗/居中),加號用 ASCII `+`,兩者字重視覺不對稱。 | index.html:171,173 | 統一用同一套字符(例如都用純文字 `−`/`+` 或都改成 Material Symbols 的 `remove`/`add` icon,和其他 icon 按鈕的字體系統一致)。 |

---

## Playwright 量測摘要(1920×1080)

- 頁面預設載入時可見按鈕 59/64,零尺寸/隱藏 5 顆(`btnSettleNow`、`rhEnd`、`oscClose`、`.pc-nav`×2)——經查全部屬**設計上預設隱藏**(需進入 Random 回合 / 開啟副圖 / 切到 Dashboard 分頁才出現),已個別觸發驗證,結果併入表 2 的 `btnSettleNow`+`rhEnd` 那條。
- 依父容器分組比對高度(#toolbar 系列全 32px、`#leftbar` 全 34px、`#tabs` 系列全 32px、`.bs` 56px、`.bs-stop`/`ico-btn.flat/.rev/.wide` 全 44px、stepper/ATM 按鈕全 36px):**組內高度全部一致,無斷差**。
- 自動化的「同一 Y 列高度不一致」掃描曾誤報一筆(`annShort` 34px vs `btnFlatten`/`btnReverse` 44px 同落在 y≈496 那一格),查證後是 `#leftbar`(左側直排)跟右側下單面板**在完全不同欄位**只是座標剛好重疊,非同一視覺列,**判定非問題**,寫在此處避免誤導。
- 重疊(overlap)0 筆,console error 0 筆。
