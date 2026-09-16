# TradingView 繪圖操作一致性:差異表 + 實作計畫

**目標**:讓 `D:\Tools\replay-trainer` 的繪圖系統在**操作細節上與 TradingView 完全一致**。
**規格正本**:`exports/TV_DRAWING_SPEC.md`(每條規則都有官方 URL;本文引用時寫 `SPEC §n` 或 `SPEC:行號`)。
**現況依據**:`src/app.js`(3735 行,classic script)、`index.html`(279 行)、`lib/lightweight-charts.standalone.production.js`(v4)。本文每一條「現在」都附 `file:line`,全部逐行讀過原始碼;查不到的寫「查不到」,不推測。
**本輪性質**:唯讀稽核,沒有改動任何程式碼。
**日期**:2026-09-16。

---

## 0. 讀法

- **差異分類**:`missing`(功能完全不存在)/`partial`(部分符合,缺子功能)/`different`(有實作但行為與 TV 相反或不同)/`same`(已一致)。
- 本表共 **48 條規則**,由 54 筆逐條查核合併而來(同一規則被多個稽核批次重複查到的,合併為一列並保留全部證據行號)。
- 標記 `[推定]` 的 4 條(G18/G25/G27/G41)不是本輪逐條查核的產物,而是依「全檔 `grep ctrlKey`/`altKey` 零命中」「全檔無 per-drawing 設定 UI」這兩個已驗證事實推得;它們的 TV 側規格在 SPEC 裡有逐字條款,現況側證據也在,但沒有獨立走完一次對抗式查核。
- 已確認**一致、不需要改**的項目列在 §A.9。

---

# (A) 差異表

## §1 放置方式、工具狀態(SPEC §1)

| # | 規則 | TradingView | 現在(file:line) | 差異 | 要改什麼 |
|---|---|---|---|---|---|
| G1 | 一點工具單擊完成 | Horizontal line 只有 price 一個座標、單擊完成;Vertical line 只有 bar number 一個座標(SPEC:13) | `hl` 已是單擊完成:`handleDrawClick` 的 `t === 'hl'` 分支直接 push 再 `resetToolAfterDraw()`(app.js:1296),不進兩點等待邏輯(app.js:1305)。但 vertical line / horizontal ray / crossline 這三個一點工具整個不存在(TOOLBTN app.js:1440 無對應鍵;leftbar index.html:121-127 無按鈕) | **partial** | 保留 `hl` 寫法;新增 `vline`/`hray`/`cross` 三個一點型別,各自用單擊分支(比照 app.js:1296),資料形狀見 G37/G36/G38 |
| G2 | 第一點後即時預覽(rubber-band) | 放下第一點後,線段/圖形隨游標延伸到第二點才定案(官方示範 GIF 佐證,無獨立文字條款,SPEC:15) | 完全沒有。`pendingPt` 只在 app.js:1215 畫一個半徑 4px 的藍色靜態圓點;`#chart` 的 pointermove(app.js:1608-1615)第二行 `if (tool) { …cursor='crosshair'; return; }` 就直接 return,不記錄游標座標也不 repaint。全檔無 `previewPt`/`hoverPt`/`mouseX` 之類變數 | **missing** | 在 app.js:1608-1615 的 pointermove,tool 存在時記錄 `previewXY = {x,y}`(**像素**,不是 time/price)並 `repaintOverlays()`;drawingsPrimitive 在 app.js:1215 之後依 `tool` 分派畫 tl/ray/box/fib/measure 的預覽。**不要**把游標轉成 time/price 再轉回來——渲染本來就在像素空間(app.js:1186 `useMediaCoordinateSpace`) |
| G3 | 完成後自動回 Cursor | 逐字:「If not selected, after each drawing is placed, you will return to your cursor.」(SPEC:18) | `resetToolAfterDraw()`(app.js:1416)`{ tool=''; pendingPt=null; updateToolUI(); }` **無條件**執行,呼叫點 4 處:hl(1296)、rr(1303)、兩點工具第二擊(1307)、annotation(1564)。等同 TV 的「Keep drawing = off」單一情境 | **partial** | 行為本身對;只需在 app.js:1416 加一層 `if (!keepDrawing)` 守衛(見 G4),其餘不動 |
| G4 | Keep drawing / Stay in Drawing Mode | 左側工具列鉛筆/圖釘圖示,開啟後連續放置同一工具的多個物件,再點一次關閉(SPEC:20-21) | 完全不存在:全檔 grep `keepDrawing`/`stayInDrawing`/`pencil` 零命中;leftbar(index.html:117-136)只有 cursor/magnet/7 繪圖/4 標記/2 清空,無鉛筆或圖釘 | **missing** | ①index.html leftbar 加 `#btnKeepDraw`(Material Symbol `edit` 或 `push_pin`);②`let keepDrawing = loadJSON('rt_keepdraw', false)`(比照 app.js:1421 magnet);③onclick 比照 app.js:3599-3600;④**只改 app.js:1416 一處**:`function resetToolAfterDraw(){ if(!keepDrawing) tool=''; pendingPt=null; updateToolUI(); }` — 四個呼叫點(1296/1303/1307/1564)一次全覆蓋,含 annotation 工具 |

## §2 座標自由度(SPEC §2)

| # | 規則 | TradingView | 現在(file:line) | 差異 | 要改什麼 |
|---|---|---|---|---|---|
| G5 | 價格自由(預設不對齊 tick/OHLC) | 只有 Magnet 開啟(或暫按 Ctrl)才吸附;預設任意價格(SPEC:27) | `magnetPrice()` app.js:1423-1428 第一行 `if (!magnet) return rnd(raw);`,`rnd()` = `Math.round(p/TICK)*TICK`(app.js:34,TICK=0.25)。放置(app.js:1295,價格來自 `candle.coordinateToPrice` app.js:1565,本是連續值)與拖曳端點(app.js:1585)兩條路徑都被量化 | **different**(方向與 TV 相反) | app.js:1424 改 `return raw;`;順帶 app.js:1425 `if (!b) return rnd(raw)` 也改 `return raw`(magnet 開但找不到 bar 時不該量化)。已確認下游 hit-test/渲染/RR 計算全走像素距離或線性映射,不依賴「價格是 tick 倍數」 |
| G6 | 時間自由(不強制吸到某根 K 棒) | 同一份磁鐵邏輯同時管價格與時間,關閉時兩者都自由(SPEC:29) | 時間永遠鎖在既有 K 棒:放置直接沿用 `param.time`(app.js:1559-1567,且 1561-1562 用 `bars.findIndex` 驗證存在);拖曳走 `xToTime()`(app.js:1554-1557)`Math.round(lg)` + clamp 到 `[0, min(idx, bars.length-1)]`。`magnetPrice(time, raw)` 雖吃 time,但只拿去 `barByTime` 查 OHLC,從不回傳時間(app.js:1423-1428) | **different** | 新增 `xToFreeTime(x)`:`coordinateToLogical(x)` → 用**真實 epoch 秒**內插/外插(`lastBarTime + (lg - lastLogical) * barSpanSec()`),存進 `p.t`。**儲存格式仍是 timestamp,不可改存 logical index** —— `feedWindow()`/`maybeReWindow()`(app.js:2032-2044)會搬動 `seriesFrom`(logical 0 的錨點)且只補償可視範圍,存 logical 會在 replay 前進後悄悄指向錯的 K 棒;SPEC:145 也明文要求存 timestamp。magnet 開時才 snap 回 `barByTime` 的 `.time` |
| G7 | 可放在最後一根 K 棒之外(未來空間) | Coordinates 用 bar number,可輸入超出資料範圍的值(機制佐證,SPEC:31) | 三道獨立封鎖:①`chart.subscribeClick` app.js:1560 `if (!tool || param.time == null) return;` — 右側空白區點擊 `param.time` 為 null 直接丟掉;②`xToTime()` app.js:1556 clamp 到 `min(idx, bars.length-1)`(`idx` = 已揭露的最後一根,比資料尾端更嚴);③渲染 `X = (t) => ts.timeToCoordinate(t)`(app.js:1188、1469、1499、2123),v4 對不精確命中資料集的 time 一律回 `null`(已反解 lib:`timeToCoordinate` → 內部二分搜尋帶 `false`=不接受最近值) | **missing** | 三道一起開:①改判斷式為 `if (!tool || !param.point) return;`(`bars.findIndex` 檢查只保留給 `start`/annotation 分支,app.js:1561-1564);②改用 `xToFreeTime`;③渲染改走 `timeToLogical(t)` + `ts.logicalToCoordinate()`(見 Stage 1)。`rightOffset` 已是 6(app.js:201/715/2315),不用動 |

## §3 磁鐵(SPEC §3)

| # | 規則 | TradingView | 現在(file:line) | 差異 | 要改什麼 |
|---|---|---|---|---|---|
| G8 | Weak / Strong 分級 | 逐字:「**Strong Magnet** pulls…regardless of the distance…**Weak Magnet**…pulls…when you are drawing near them.」(SPEC:44) | 單一 boolean `magnet`(app.js:1421,`rt_magnet`),`magnetPrice`(app.js:1423-1428)一旦為 true 就**無距離門檻**吸最近 OHLC —— 現況等於永遠 Strong,連 TV 預設的 Weak 都做不到。`#btnMagnet`(index.html:119)只是單純 toggle(app.js:3599-3600) | **missing** | 狀態改三態 `'off'|'weak'|'strong'`(沿用 `rt_magnet`,加 boolean→字串 migration);**門檻必須用像素**:把候選 OHLC 經 `candle.priceToCoordinate(v)` 轉回像素與游標 y 比距離(檔內已有先例 `nearestLine` app.js:1463 用 7px),不能比價格差(縮放時判定會飄)。因此 `magnetPrice` 簽名要多收一個 `y`,兩個呼叫點(app.js:1565-1566、1583-1585)把已存在的 `param.point.y` / `y` 往下傳。UI:`#btnMagnet` 右鍵/長按開次選單切 weak/strong(**TV 用什麼手勢喚出這個選單,SPEC 全文查不到,標「查不到」,實作前先實機確認**) |
| G9 | Ctrl 暫時反轉磁鐵 | 按住 `Ctrl`/`Cmd` 畫圖或移動錨點,暫時反轉目前狀態(SPEC:46,官方快捷鍵表) | 全檔 `grep ctrlKey`/`metaKey` **零命中**;pointerdown/pointermove/subscribeClick 都不讀修飾鍵 | **missing** | **落點很關鍵**:新畫圖的初始放置**不經過 pointerdown**(app.js:1569 `if (e.button !== 0 \|\| tool) return;` 有工具時直接短路),而是走 `chart.subscribeClick`(app.js:1559-1567)。所以要讀 `param.sourceEvent.ctrlKey` —— 已反解 lib 確認 v4 的 click params 帶 `sourceEvent:{ctrlKey,altKey,shiftKey,metaKey}`。拖曳端點另在 app.js:1583-1585 讀 `e.ctrlKey` |
| G10 | 吸附目標 = 最近一根 K 棒的 O/H/L/C | 吸到具體 OHLC 數值,不是等距價格網格(SPEC:48) | OHLC 比較邏輯本身正確(app.js:1426-1428)。但取棒子用 `barByTime()`(app.js:1422)做**精確 time 相等**的二分搜尋 —— 目前之所以永遠命中,是因為上游把 time 鎖死在既有 K 棒(見 G6);一旦 G6 放開時間自由,`barByTime` 會回 `null`,`magnetPrice` 靜默退化成「完全不吸附」 | **partial**(現在對,改完 G6 就會壞) | 換成 `coordinateToLogical → Math.round → clamp` 取最近的整數 logical(即 `xToTime` app.js:1554-1557 已在用的模式)找那根真實 K 棒,再丟進既有 OHLC 比較。落在未來空間(無 K 棒)時**不吸附**,維持自由座標 |
| G11 | Snap to Indicators | 獨立開關,啟用後疊圖指標數值也當吸附點(SPEC:49 逐字) | 不存在:`magnetPrice`(app.js:1423-1428)只比 O/H/L/C;全檔 grep `snapIndicat`/`Snap to Indicators` 零命中;`#indPopover`(index.html:47-69)與 leftbar(117-136)都沒有這個勾選框 | **missing** | 勾選框要放在 **Magnet 自己的設定面板**(TV 是和 Weak/Strong 同一處,SPEC:48-49),不是丟進 `#indPopover`(那是「顯示哪些指標」的另一件事)。**實作前提**:`ripsterData`/`vwapData`/`bbData`/`emaData[].arr` 都是**與 `bars[]` 同索引**的平行陣列(app.js:882 註解、574/884/909-931),而 `barByTime` 只回 bar 物件、`xToTime` 只回 time,兩者都沒吐 index —— 必須先加一支回傳 index 的查找 |

## §4 選取與編輯(SPEC §4)

| # | 規則 | TradingView | 現在(file:line) | 差異 | 要改什麼 |
|---|---|---|---|---|---|
| G12 | 錨點只在選取(/hover)後出現 | 「選取後出現錨點」(SPEC:55) | 三種行為並存:`hl` **已達標**(被 app.js:1202 排除在常駐迴圈外,只在選取時於 1210 畫一個琥珀錨點);`tl/ray/box/fib` 靠 app.js:1201-1206 的通用迴圈**一律顯示**黑底小圓點;`measure`/`rr` 由 `drawMeasure`(app.js:1347 兩個 `ctx.arc`)與 `drawRR`(app.js:1387-1390 的 `sq()`/`ci()`)**在自己的函式裡無條件每幀畫**,完全不看 `selDrawing` | **partial** | 三處一起改:①app.js:1201-1206 迴圈開頭加 `if (d !== selDrawing && d !== hoverDrawing) continue;`;②`drawMeasure`(app.js:1336 起)、`drawRR`(app.js:1374 起)各加一個 `selected` 參數(呼叫端 app.js:1193-1194 傳 `d === selDrawing`),把 1347 與 1387-1390 的 handle 繪製包進去;③`hl`(1191/1210)不用動 |
| G13 | 浮動工具列(floating toolbar) | 選取後出現,至少含樣式/顏色入口、alert clock icon、樣板(SPEC:55, 68-69) | 完全不存在。選取後只有 app.js:1207-1214 把錨點換成琥珀色大圓點。全檔搜 `toolbar` 只命中頂部 `#toolbar`(index.html:18)與靜態 leftbar(116);右鍵選單 `showCtx`(app.js:420-468)只服務部位/委託單;無 `input[type=color]` 綁到繪圖(index.html:57/59/61 那三個是 Volume Profile);無 dblclick 開設定(app.js:268 是價格軸 fitChart、323 版面、3128 交易明細) | **missing** | 新增 `#drawToolbar`(顏色/線寬/線型/鎖定/刪除/設定)。定位**直接複用** app.js:1208-1214 選取分支已經在算的 `hpts` 與同一組 `X()/Y()`,取 min/max 當 bbox;**必須 null 防呆**:`vpan`(app.js:1579)與 LWC 原生拖曳可以把選取物件的錨點平移出視窗,座標回 null 時工具列隱藏而不是硬擠出 NaN(檔內 1191/1196/1215 都已是 null-continue 風格) |
| G14 | Shift 鎖 45 度(畫 Trend line) | 逐字:「To draw a trendline at 45-degree angle, keep the Shift key pressed while drawing.」(SPEC:60) | 全檔 `e.shiftKey` 只有一處:app.js:3696 `Delete` + Shift → `clearDrawings()`。`handleDrawClick`(app.js:1294-1308)與 `chart.subscribeClick`(1559-1567)都沒讀修飾鍵,`p2` 直接等於點擊座標(app.js:1306) | **missing** | **不要**另建 keydown/keyup 維護的全域 `shiftHeld`。在既有 `chart.subscribeClick`(app.js:1559)裡讀 `param.sourceEvent.shiftKey`(已反解 lib 確認存在),第二擊且 `pendingPt` 存在時,用 G2 的像素預覽座標把 dy 夾成 ±dx,再 `candle.coordinateToPrice()` 換回 price |
| G15 | Shift 鎖水平/垂直(拖曳既有繪圖) | 拖曳時按 Shift 只能沿水平或垂直移動(SPEC:61) | `moveBody(x,y)`(app.js:1533-1541,呼叫端 1588)與 `dragH.apply`(app.js:1583-1585)都沒讀 `e.shiftKey`,`dPrice`/`dIdx` 一律同時套用 | **missing** | `startBodyDrag`(app.js:1528-1532)多存起點像素 `sx:x, sy:y`;`moveBody(x, y, shiftKey)` 內用**像素差**判主軸:`Math.abs(x-sx) >= Math.abs(y-sy) ? dPrice=0 : dIdx=0`。pointermove(app.js:1588)傳 `e.shiftKey`。**不要**把 dPrice/dIdx 再轉回像素比較(多兩次 API 呼叫、縮放時失真) |
| G16 | Shift 鎖正方形(畫 Rectangle) | 畫 Rectangle 時按 Shift → 正方形(SPEC:62) | 同 G14:box 是純 click-click(app.js:1305-1306),放置路徑不讀 shiftKey | **missing** | 同 G14 的落點(`param.sourceEvent.shiftKey`),第二擊時在像素空間把 `dx`/`dy` 夾成等長,再換回 price 寫回 `p2.p` |
| G17 | 雙擊開設定(顏色/樣式) | 官方查不到逐字條款,第三方教學佐證「double-click 或浮動工具列 Settings 開樣式選單」(SPEC:67) | 無。`#chart` 唯一的 dblclick 是 app.js:268(在價格軸上才 `fitChart()`);顏色在建立當下寫死:hl `#d1d4dc`(1296)、rr `#fcd535`(1302)、tl/ray `#d1d4dc`、box `#2962ff`、fib `#fcd535`(1306 三元式),寫入後除了拖曳搬 p1/p2 外沒有任何路徑會再碰 `d.color` | **missing** | 在 `#chart` 加 dblclick,用既有 `drawingAt(x,y)`(app.js:1497-1518)命中後開設定面板。**注意**:光寫回 `d.color` 對 3/6 種型別無效 —— `drawFib`(app.js:1323-1333)用 `FIB_LEVELS` 內建 9 色階、`drawMeasure`(app.js:1342)用寫死漲跌綠紅、`drawRR`(app.js:1374-1390)用寫死風險/報酬色,都不讀 `d.color`。要嘛限定 hl/tl/ray/box 可改色,要嘛同步改這三個 renderer |
| G18 | Ctrl+拖曳 複製(clone) `[推定]` | 逐字:「select the item…hold Ctrl/Command and then drag the figure to the place you need.」(SPEC:64-66) | 不存在(依據:全檔 `grep ctrlKey`/`metaKey` 零命中;pointerdown app.js:1568-1580 命中 handle/body 後直接進 drag,無複製分支) | **missing** | pointerdown 的 body 命中分支(app.js:1576)在 `startBodyDrag` 之前:`if (e.ctrlKey \|\| e.metaKey) { const c = cloneDrawing(hd); drawings.push(c); selDrawing = c; startBodyDrag(c, x, y); }` —— 深拷貝用 `JSON.parse(JSON.stringify())` 即可(drawings 內全是純資料) |
| G19 | Ctrl+點擊 多選 | 按住 Ctrl 點擊多個物件建立多選集合(SPEC:70-71、88) | 單選:`let dragBody = null, selDrawing = null;`(app.js:1430);命中即覆蓋賦值(app.js:1574、1576);空白處(1578)與 Esc(3699)直接設 null;高亮(1207-1213)與刪除(1543-1546)也只認單一物件 | **missing** | 加 `let selSet = new Set();`(存物件參照即可,drawings 本來就用參照傳遞,不必另造 id)。只在 **body 命中分支**(app.js:1576)加 Ctrl 分支(拖 anchor 是改點,不是多選手勢,1574 不動);1578 與 3699 要**一併清空 selSet**;渲染改在 app.js:1207-1213 遍歷 selSet。`drawingHandles()`(app.js:1467)不用改 —— 它本來就對全部 drawings 出 handle 供 hit-test |
| G20 | 多選後群組操作 | 移動/隱藏/鎖定/刪除/z-order/批次改樣式(SPEC:70) | 全缺:drawing 物件只有 `{type,p1,p2,color}`(+rr 的 `stop`/`target`),見 app.js:1432 註解與 push 處 1296/1302/1306,**無 `hidden`/`locked`/`z` 欄位**;`drawings` 是普通陣列,渲染順序 = 插入順序,全檔無 `zOrder`/`sort`;無任何批次改色/線寬 UI | **missing** | drawing 物件加 `hidden`/`locked`/`z`(Stage 1 migration 一併補);`deleteSelectedDrawing`(app.js:1543-1546)與新增的 hide/lock 改成 `for (const d of selSet)`;群組移動把 `dragBody`(app.js:1530)從單一 `{d, fields}` 換成成員陣列,套同一組 `dIdx`/`dPrice`(`moveBody` app.js:1533-1541 的 bar-index 位移算法可直接複用,不用重寫) |

## §5 鍵盤(SPEC §5)

> 現況共通事實:唯一的 keydown handler 在 **app.js:3684-3700**,`k = e.key.length===1 ? e.key.toLowerCase() : e.key`(3686),只認 Space/p/b/s/f/j/x/`[`/`]`/0/Delete/Shift+Delete/?/Escape。**全檔 `ctrlKey`/`metaKey`/`altKey` 零命中**,`shiftKey` 只有 3696 一處。說明表 `HELP_KEYS` 在 app.js:3705-3709。

| # | 規則 | TradingView | 現在(file:line) | 差異 | 要改什麼 |
|---|---|---|---|---|---|
| G21 | Undo `Ctrl+Z` | 官方快捷鍵表(SPEC:83);SPEC:125 也提到鎖定物件誤動可 Ctrl+Z 復原 | 完全沒有歷史機制。9 個直接寫入點都是「改完就 `saveJSON`」:push(1296/1302/1306)、`clearDrawings`(1313)、`splice`(1545)、拖曳 in-place 改 p1/p2(pointermove 1583-1588,**pointerup 1602-1606 只是落盤**)、`editAt`(3725)、`moveSel`(3729)。grep `undo`/`history`/`snapshot` 在繪圖脈絡零命中 | **missing** | `undoStack`/`redoStack` + `snapshot()` 深拷貝 `{drawings, annotations}`。**快照必須在 mutation 之前**:push 前(1296/1302/1306)、splice 前(1545)、`clearDrawings`/`clearAnnotations` 開頭(1313/1442)、**pointerdown 選中 handle/body 的當下**(1574/1576,不是 pointerup —— p1/p2 在 pointermove 就被就地改寫了)、`editAt`/`moveSel` 前(3725/3729)。範圍要含 `annotations`(它有自己的 push/splice/clear:1441/1442/1457) |
| G22 | Redo `Ctrl+Y` | 官方快捷鍵表(SPEC:84) | 同上,零 | **missing** | 依附 G21;沒有 G21 就沒有可 redo 的堆疊(不是「加個指標」而已) |
| G23 | 方向鍵微調選取繪圖 | 上下左右:左右逐 bar、上下逐價格單位移動選取中的繪圖(SPEC:90) | 方向鍵被**換日**吃掉:app.js:3693 `'[' \|\| 'ArrowLeft' → prevDay()`、3694 `']' \|\| 'ArrowRight' → nextDay()`,兩者都不檢查 `selDrawing`;全檔 `ArrowUp`/`ArrowDown` 零命中(按了沒反應) | **different** | 在 3693 之前插一段 `if (selDrawing && k.startsWith('Arrow'))`,用既有 `drawingFields(selDrawing)`(app.js:1520-1527,已處理 hl 只有 p1.p、rr 還有 stop/target 的差異)逐欄位改:price 欄 ±TICK,time 欄用 `bars.findIndex` ±1 並 clamp 到 `Math.min(idx, bars.length-1)`(同 `moveBody` app.js:1536 的邊界)。`selDrawing` 為 null 才落到換日分支 |
| G24 | 複製/貼上 `Ctrl+C` / `Ctrl+V` | 官方快捷鍵表(SPEC:91) | 不存在(grep `clipboard`/`ctrlKey` 零命中) | **missing** | `clipboardDrawing = JSON.parse(JSON.stringify(selDrawing))`;貼上時用 `drawingFields()` 逐欄位偏移,time 欄比照 rr 一鍵放置的既有寫法(app.js:1300-1301:`bars.findIndex` → `+N` bar → clamp `hi = Math.min(idx, bars.length-1)` → 取 `.time`)。**clamp 到 `idx` 是硬需求**:否則 Ctrl+V 會把繪圖貼到尚未揭露的未來 K 棒,洩漏後續價格 |
| G25 | 刪除選取物件:`Delete` / `Backspace` / **滑鼠中鍵** `[推定]` | 官方列三種等效操作(SPEC:82) | Delete/Backspace 有(app.js:3697 → `deleteSelectedDrawing` 1543-1546);中鍵沒有(pointerdown app.js:1569 `if (e.button !== 0 …) return;` 直接擋掉非左鍵) | **partial** | app.js:1569 放行 `e.button === 1`:命中 `drawingAt(x,y)` 就刪除該物件(並 `e.preventDefault()` 擋掉瀏覽器中鍵捲動) |
| G26 | `Alt+T` → Trend line | SPEC:93 | 無 altKey 判斷;`tl` 只能點 `#drwTL`(index.html:121 → app.js:3591) | **missing** | keydown 加 `else if (e.altKey && k==='t') { e.preventDefault(); setTool('tl'); }`,直接呼叫既有 `setTool`(app.js:1461),與按鈕行為完全一致 |
| G27 | `Alt+H` → Horizontal line `[推定]` | SPEC:94、113 | 無(同上) | **missing** | 同 G26,`setTool('hl')` |
| G28 | `Alt+J` → Horizontal ray | SPEC:95 | 無 altKey;且**純 `j` 已綁 `placeBreakout('short')`(app.js:3691)**,若把 Alt+J 分支寫在它後面會變死碼 | **missing** | 新分支必須**插在 app.js:3691 之前**(或給 3690/3691 加 `&& !e.altKey`),並 `e.preventDefault()` 擋瀏覽器 Alt-accesskey。工具本體見 G36 |
| G29 | `Alt+V` → Vertical line | SPEC:96 | 無 | **missing** | 同 G26;工具本體見 G37 |
| G30 | `Alt+C` → Crossline | SPEC:97 | 無 | **missing** | 同 G26;工具本體見 G38 |
| G31 | `Alt+F` → Fib retracement | SPEC:98 | **現在按 Alt+F 會誤下單**:app.js:3690 `else if (k === 'f') { e.preventDefault(); placeBreakout('long'); }` 不排除 altKey,else-if 鏈會先攔截 | **different**(不是無作用,是有害副作用) | 二選一:把 `e.altKey && k==='f' → setTool('fib')` **插在 3690 之前**,或把 3690 改成 `k==='f' && !e.altKey`。同理檢查 3691 的 `j`(G28) |
| G32 | `Shift+Alt+R` → Rectangle | SPEC:99(SPEC:103 已更正:單獨 `Alt+R` 是 Reset chart view,不是 Rectangle,勿照抄) | 無 | **missing** | `else if (e.shiftKey && e.altKey && k==='r') { e.preventDefault(); setTool('box'); }` |
| G33 | `Ctrl+Alt+H` 隱藏全部繪圖 | SPEC:86、130(暫時隱藏,與 Remove all 是兩件事) | 無;全檔沒有任何繪圖可見性旗標(grep `hidden`/`visible` 命中的都是 DATASETS 過濾 app.js:13/23/24/2004、分頁 class 3718、LWC series 選項) | **missing** | 見 G45(共用 `hideDrawings` 旗標);快捷鍵只 toggle **Drawings 這一類**,不是三類全隱(SPEC:86 逐字是 "Hide all drawings") |

## §6 各工具的點數與特殊行為(SPEC §6)

| # | 規則 | TradingView | 現在(file:line) | 差異 | 要改什麼 |
|---|---|---|---|---|---|
| G34 | Trend line:extend / 箭頭 | 2 點;Shift 鎖 45°;Style 可設 Extend Left/Right/Both/None;可切兩端箭頭(SPEC:111) | 點數與座標形狀正確(app.js:1306 push 兩組 `{t,p}`);渲染只畫原始線段(app.js:1198 的 else 分支,只有 `ray` 有邊緣延伸);全檔無 extend 欄位/UI(grep `extend` 只命中 app.js:1513 的 ray hit-test 註解與 1685 的 Heikin-Ashi 註解);無任何 arrowhead token | **partial** | 加 `d.extend: 'none'\|'left'\|'right'\|'both'` + `d.arrowStart/arrowEnd`。**延伸用檔內既有的像素外插手法**(app.js:1198 的 `tx = dx>=0?W:0` + 斜率內插),不要為此引入 `logicalToCoordinate`;`drawingAt` 的 hit-test(app.js:1513-1514)要同步套用同一套延伸 |
| G35 | Ray:任意方向單向無限延伸 | 2 點,方向任意,只往第二點方向延伸(SPEC:112) | 非垂直情況正確(app.js:1198 參數式延伸到 0 或 W,含負斜率、反向)。**`dx === 0`(兩點落在同一根 K 棒)時退化**:`ctx.lineTo` 目標變成 `(x2,y2)`,完全不延伸。同一退化也在 hit-test(app.js:1514 `if (dx !== 0)` 沒有 else,`ex/ey` 保持 `x2/y2`) | **partial** | 在同一個 `useMediaCoordinateSpace` 回呼取得 `H`(檔內已有寫法:app.js:2118 `H = (scope.mediaSize && scope.mediaSize.height) \|\| 9999`),`dx===0` 時終點改 `(x1, dy>=0 ? H : 0)`;**app.js:1514 的 hit-test 必須同步修**,否則會出現「畫面上延伸到邊界但點不到」 |
| G36 | Horizontal ray 工具 | 1 點(price + bar number),只往右延伸,不往左;`Alt+J`(SPEC:114) | 整個工具不存在:leftbar(index.html:121-127)無按鈕、`TOOLBTN`(app.js:1440)無 `hray`、`handleDrawClick`(1294-1307)只有 `hl`/`rr` 兩個單點分支、drawingsPrimitive 型別分派(1189-1199)無分支;全檔 grep `hray` 零命中 | **missing** | 新增按鈕 + TOOLBTN 項 + 單點分支(比照 app.js:1296);渲染 `moveTo(x, y) → lineTo(W, y)`,**必須加 `if (x==null\|\|y==null) continue` 防呆**(比照 1191/1195-1196)。選取控點不用另寫:app.js:1201-1206 的一般錨點迴圈與 1205-1210 的 fallback 在 `d.p2` 為 undefined 時天然只畫 p1 |
| G37 | Vertical line 工具 | 1 點,只有 bar number、無價格;**縱貫全圖含所有指標窗格**;`Alt+V`(SPEC:115) | 不存在(grep `vline`/`vertical` 只命中縱向縮放註解 app.js:218-235 與 alert 標記線註解 2102)。`#btnAlert`(index.html:107)的單一鬧鐘縱線不算——不能新增多條、不能選取/拖曳/刪除 | **missing** | 型別 `{type:'vline', p1:{t}}`(不存 price)。渲染比照**檔內已上線**的 `alertLinePrimitive`(app.js:2112-2131:`x = ts.timeToCoordinate(...)`、null 就跳過、`moveTo(x,0)→lineTo(x,H)`)。**指標窗格是現在式不是未來式**:`oscChart` 是第二個獨立的 `createChart()` 實例(app.js:705-737,靠 visible-logical-range 719-728 與 crosshair 729-734 手動同步),主圖 primitive 畫不進去 —— 開 RSI/MACD/ATR 時必須同步掛一份 primitive 到 oscChart,否則線會明顯只畫一半。選取/拖曳要新增對稱於 `hl` 的 `vert:true` handle(`nearestHandle` app.js:1548-1552 目前只認 `horiz:true` 與「hx/hy 都要對準」兩種),並在 `drawingHandles`/`drawingAt`/`drawingFields`(1467/1497/1520)各補一個 vline 分支 —— 否則會是「畫得出來但摸不到」的裝飾線 |
| G38 | Crossline 工具 | `Alt+C`(SPEC:97)。**視覺行為 SPEC §6 工具表沒有列 Crossline,查不到官方逐字條款** | 不存在(型別只有 hl/tl/ray/box/fib/rr/measure) | **missing** | `{type:'cross', p1:{t,p}}`,渲染水平+垂直各一條穿全圖。**「十字」這個畫法是依工具命名推斷,規格查不到,實作前要標註或實機確認**,不可寫成已驗證事實 |
| G39 | Rectangle:Shift 正方形 / Extend / Middle line | 2 點對角;Shift 鎖正方形;Style 有 Extend right/left;可開 Middle line(SPEC:116) | 兩點對角 + min/max 換算 + alpha .12 填色 + 邊框(app.js:1197)正確,四角 handle 也對(1204-1205 由 p1/p2 補算另兩角)。Shift(見 G16)、`extendLeft`/`extendRight`、`middleLine` 全檔零命中 | **partial** | `left = d.extendLeft ? 0 : Math.min(x1,x2)`、`right = d.extendRight ? W : Math.max(x1,x2)` —— **兩個 flag 各自獨立鉗制**,不是照搬 ray 的單向 `dx` 判斷,也不需要 `logicalToCoordinate`(是螢幕座標鉗制)。Middle line 定案為 **price 中點水平線** `y = Y((p1.p+p2.p)/2)`,並在文件註明「TV 官方頁未逐字說明方向,依常見實作假設為水平」 |
| G40 | Fib:預設層級 / 可勾選 / Reverse / Extend / log | 官方逐字:預設 **23.6 / 38.2 / 61.8 / 100** 四條;可勾選最多 24 條;有 Reverse、Extend Left/Right、log-scale 選項(SPEC:117) | `FIB_LEVELS`(app.js:1318-1321)寫死 **9 條**(0/.236/.382/.5/.618/.786/1/1.272/1.618),`drawFib`(1323-1333)無條件全畫,hit-test(1506)也遍歷全 9 條;無 Reverse/Extend/log(grep `Reverse` 只命中倉位 app.js:430/2795) | **different** | 預設收斂成 4 條 + 其餘可勾選;新欄位用**扁平**寫法 `d.fibLevels`/`d.reverse`/`d.extendLeft`/`d.extendRight`(檔內慣例:rr 的 `d.stop`/`d.target` 就是直接掛在 d 上,app.js:1302/1523),**不要** `d.fib.levels` 巢狀。log-scale **查不到對應需求,暫緩**。順帶修:`drawFib` 在 `X()` 回 null 時把 `xL` 退回 0(app.js:1326),做 Extend Left 會放大這個既有 bug |
| G41 | Coordinates 對話框(精確輸入 bar number + price)`[推定]` | 8 種工具皆有(SPEC:119) | 不存在(全檔無 per-drawing 設定 UI,見 G17 證據) | **missing** | 併進 G13 的浮動工具列 → Settings 面板,分頁 Coordinates / Visibility / Style |
| G42 | Visibility per interval(哪些週期顯示這個物件) | 每個工具都有 Visibility 對話框(SPEC:119) | 不存在;drawing 物件無任何 timeframe 欄位(app.js:1432 註解 + push 1296/1302/1306);index.html 無 Visibility/modal/dialog | **missing** | 加 `d.visibleTFs: null \| number[]`(**單位是分鐘 number**,對齊全域 `tf`(app.js:80-81)與 `STD_TF`(app.js:26 `[0.25,1/3,0.5,1,2,3,5,10,15,30,60]`),不是 `'1m'` 字串;null = 全週期顯示,向下相容)。過濾寫在**兩個 for 迴圈各自開頭**(app.js:1189 主繪製、1201 錨點)用 **`continue` 不是 `return`** —— 三段程式共用同一個 `useMediaCoordinateSpace` 回呼,`return` 會把後面所有繪圖與 handle 一起砍掉 |

## §7 全域(SPEC §7)

| # | 規則 | TradingView | 現在(file:line) | 差異 | 要改什麼 |
|---|---|---|---|---|---|
| G43 | Lock all drawings | 逐字:「Lock all drawings: This option prevents accidental movement of drawings…」鎖頭圖示切換(SPEC:125) | 不存在。leftbar(index.html:117-136)無鎖頭;全檔唯一的 `locked()`(app.js:2409)= `!!position \|\| !!entryOrder`,是「持倉/掛單中」的 UI 閘門(用於 1981/2077/2388/2447/3570 等),與繪圖鎖定無關 | **missing** | ①leftbar 加 `#btnLockDrw` + `let drawingsLocked = loadJSON('rt_lockdrw', false)`;②app.js:1573-1576 **只用 `if (!drawingsLocked)` 包住「啟動拖曳」那幾行**(`dragH = h` / `startBodyDrag()` / `chart.applyOptions({handleScroll:false,…})`),**保留 `selDrawing` 賦值與 `return`** —— 若照字面「跳過整個 return」會落到 app.js:1578 的空白處 deselect,把剛設的 `selDrawing` 立刻清掉;③刪除路徑也要擋,見 G44 |
| G44 | 移除鎖定物件:確認對話框 + 「Always remove locked drawings」 | 預設跳確認;可勾選改成直接刪(SPEC:127-128) | `deleteSelectedDrawing()`(app.js:1543-1546)無條件 `splice`;keydown 的兩個刪除分支(app.js:3696 Shift+Del→`clearDrawings`、3697 Del/Backspace→`deleteSelectedDrawing`)都不檢查任何鎖定狀態。**本 codebase 無 undo(grep 零命中)**,所以不能援引 TV「反正還能 Ctrl+Z」當作不擋刪除的理由 | **missing** | `deleteSelectedDrawing` 開頭:`if (selDrawing.locked && !alwaysRemoveLocked) { if (!confirm('Remove locked drawing?')) return; }` —— 用**原生 `confirm()`**,這是檔內同類二次確認的既有慣例(app.js:1312/2457/3498/3521/3527),不要造新 UI 元件。變數名 `drawingsLocked`/`alwaysRemoveLocked` 避開既有 `locked()`。`clearDrawings`(1309-1316)若要保留鎖定物件,鎖定就得做成 per-drawing 旗標而非單一全域 boolean |
| G45 | Hide 下拉(Drawings / Indicators / Positions and orders / All) | 四個分類可分別或一次隱藏;`Ctrl+Alt+H`(SPEC:129-130) | 不存在。唯一叫 Hide 的是 `#btnHideTradesTop`(index.html:106)/`#btnHideTrades`(238)→`setShowTrades`(app.js:2939-2940、3679-3681),只切 `showTrades`,而它只在 `refreshMarkers` 的 `const ms = (showTrades ? markers : []).concat(annotations)`(app.js:2923)用到 —— **只擋歷史成交箭頭**,不擋 annotations、不擋 drawings、不擋指標 | **missing** | 三支獨立旗標 + All:<br>**Drawings** → 守衛要下在 **drawingsPrimitive 的 draw callback 內部**(app.js:1184 那行附近),**不是 `repaintOverlays()`(app.js:1293)**;後者只呼叫各 primitive 的 `_req()`,LWC 自己在平移/縮放/resize/播放時都會直接觸發 draw,守衛放錯位置的話「隱藏後一平移就冒回來」。同時 `refreshMarkers`(app.js:2923)要把 annotations 併入判斷(箭頭走 `candle.setMarkers()`,是另一條渲染路徑;而 `clearDrawings` app.js:1309 的註解已把兩者當同一組)。<br>**Indicators** → 不只 `indicatorPrimitive`(app.js:938-1002,只含主圖 VWAP/BB/EMA);RSI/MACD/ATR 是 oscChart 上的真 series(app.js:756-767)、volume 是 histogram series(app.js:204),這些要 `applyOptions({visible:false})`。**用暫時遮罩,不要動 `vwapOn`/`bbOn` 等設定值**(那是 Reset 不是 Hide)。<br>**Positions and orders** → `orderPrimitive`(app.js:1282-1291)的 draw 開頭 return。<br>**MTF(`mtfWrap`/`mtfPanes`,app.js:2287+)不是指標**,不要塞進 Indicators 這一類 |
| G46 | Remove 下拉(Remove Drawings & Indicators) | 下拉選單,選「Remove Drawings & Indicators」一次清空繪圖與指標(SPEC:131-132) | `#drwClear`(index.html:134)是單一按鈕 → `clearDrawings`(app.js:3596);另有 Shift+Del(3696)與右鍵選單項(445-446)同路徑。`clearDrawings`(1309-1316)`confirm()` 後只清 `drawings=[]` 與 `annotations=[]` 兩個陣列 + 兩個 localStorage key,**完全不碰任何指標**。旁邊 `#annClear`(index.html:135)→`clearAnnotations`(1442)清 `annotations` **與 `markers`**,無 confirm | **different**(UI 形狀不同 + 少清一整類物件) | `#drwClear` 改成下拉(可直接複用既有 popover 開合慣例 app.js:3625-3629),選項:「Remove Drawings」(= 現有 `clearDrawings`)/「Remove Drawings & Indicators」。後者要另外呼叫**每個指標自己的 setter**(`setVwap(false)`/`setBB(false)`/`setEMA(false)`/`setVolOn(false)`/`ripsterOn=false`+`ripsterRepaint()`/`vpP/vpO/vpD` 三個 `setVpCfg`/`oscMode='off'`+`oscCompute()`)並同步 checkbox 的 `.checked` —— app.js:867-869 已有一段一次性的「全部歸零」邏輯可抽成 `resetAllIndicators()` 重用;**只翻 checkbox DOM 屬性沒有用**,指標是靠 onchange handler(app.js:3601-3617)生效的。`#annClear` 是否併入要一併決定,避免功能重疊 |
| G47 | 跨時間週期保留依據 = (timestamp, price) | 換 interval 時 X 座標會變,因為綁的是原始 timestamp,圖表找「最接近該 timestamp 的新 K 棒」重新顯示(SPEC:135-137 逐字) | **儲存端已正確**:`p.t` 一律是真實 bar timestamp(放置 app.js:1559-1566、拖曳 app.js:1554-1557),不是 bar index。**渲染端會整條消失**:三處 `X = (t) => ts.timeToCoordinate(t)`(app.js:1188/1469/1499)直接餵原始 t;而 `aggregate()`(app.js:1650-1658)用 `Math.floor(b.time/span)*span` 重新分桶、`rebuildTf()`(app.js:2007)只重建 `bars` 不碰 `drawings`,切週期後新 `bars[]` 裡幾乎不會再有那個精確 time,`timeToCoordinate` 回 null → 渲染 `continue` 跳過。已反解 lib 確認 v4 的 `timeToCoordinate` 是「精確命中才給座標」的二分搜尋,不會自動找最近點 | **partial**(存對了,顯示不出來) | 加 `nearestBarTime(t)`:**比照既有 `barByTime`(app.js:1422)的二分搜尋**定位插入點,再比左右兩根取較近者 —— 不要對 `bars[]` 做 `|b.time - t|` 全陣列線性掃描(每次 repaint × 每個 handle 會變 O(n²))。套進三個 `X()`(1188/1469/1499)。**注意範圍**:這只解「t 在資料範圍內但不對齊新週期分桶」;「t 超出資料範圍(未來空間)」是 G7,必須走 `logicalToCoordinate`,nearest-bar 會錯誤地把點釘死在最後一根上 |
| G48 | 左側工具列元件盤點 | Cursor、Magnet、Keep drawing(鉛筆/圖釘)、Lock all(鎖頭)、Hide 下拉、Remove 下拉、Object tree(SPEC:20/125/129/131/133) | `#leftbar`(index.html:117-136)實際內容:`toolCursor`(118)、`btnMagnet`(119)、分隔線(120)、7 個繪圖工具 `drwTL/drwRay/drwHL/drwBox/drwFib/drwMeasure/drwRR`(121-127)、分隔線(128)、4 個標記 `annUp/annDown/annLong/annShort`(129-132)、分隔線(133)、`drwClear`(134)、`annClear`(135)。**7 項 TV 元件中已有 2 項(Cursor/Magnet),缺 5 項** | **partial** | Keep drawing → G4;Lock all → G43;Hide 下拉 → G45;Remove 下拉 → G46;Object tree → **不做**(見 (C))。註:`annUp/annDown/annLong/annShort` 是本專案自有的交易標記,TV 沒有對應概念,**Keep drawing 的旗標是否套用到它們要明確決定**(`resetToolAfterDraw` app.js:1416 是四類共用的同一支函式,加旗標會一併生效) |

## §A.9 已確認一致,不需要改

| 規則 | 證據 |
|---|---|
| 放置手勢 = click-click 不是按住拖曳 | `chart.subscribeClick` → `handleDrawClick`(app.js:1559-1567 / 1294-1308),兩次獨立點擊,與 SPEC:11 一致 |
| 可放在目前可視價格軸範圍之外而不被拉回 | 價格走 `candle.coordinateToPrice`/`priceToCoordinate` 線性映射,`priceAuto=false` 後不自動 fit(app.js:1583-1595 的 vpan/pxZoom 路徑) |
| 磁鐵預設關閉 | `let magnet = loadJSON('rt_magnet', false)`(app.js:1421),與 SPEC:39 反推的預設一致 |
| 磁鐵按鈕啟用變藍 | `#btnMagnet`(index.html:119)+ `.lt-btn.active { color: var(--brand) }`(styles.css:634),`--brand:#2962ff` 註解寫明 "TradingView blue"(styles.css:17),與 SPEC:40 一致 |
| hover 視覺回饋 | `#chart` pointermove 命中 `nearestHandle`/`drawingAt` 時 `cursor='move'`(app.js:1608-1615)。TV 側 SPEC:57 標「查不到官方逐字條款」,現況不劣於規格 |
| 拖曳錨點 vs 拖曳本體 | pointerdown 先試 `nearestHandle`(app.js:1573-1574,只改該端點)再試 `drawingAt`(1575-1576,`startBodyDrag` 整體平移),與 SPEC:58 的動圖行為一致 |
| Esc 取消工具/取消選取 | app.js:3699。SPEC:81 標明官方快捷鍵表沒有 Esc 條目,屬通用慣例 |

---

# (B) 實作計畫(5 階段)

> **依賴順序**:Stage 1 換掉座標層(所有後續階段都踩在它上面)→ Stage 2 放置與磁鐵 → Stage 3 編輯與浮動工具列 → Stage 4 鍵盤/undo/全域開關 → Stage 5 驗證。跨階段跳做會造成 G10(磁鐵找不到 bar)、G47(切週期整條消失)這類靜默倒退。
>
> **測試基礎設施現況**:repo 根目錄**沒有 `package.json`、沒有 `tests/`**(已 `ls` 確認),Playwright 是全新基礎設施。本地站用 `serve.py`(port **5560**,備援 5460)。
>
> **共用小知識**:`app.js` 是 classic script,頂層 `let` 會建立全域語彙繫結,所以 Playwright 可以直接 `page.evaluate(() => drawings)` 讀到繪圖陣列;更穩的路徑是讀 `localStorage.rt_drawings`。渲染健康度可讀 `window.__drw`(app.js:1217-1219,成功時 `{n, ok:true}`,例外時 `{err}`)。

---

## Stage 1 — 資料模型 + 渲染座標層

**目標**:繪圖點可以落在最後一根 K 棒之後、可以落在可視價格範圍之外、切換週期不會整條消失;一點工具有自己的形狀。

### 1.1 新增的座標 helper(建議放在 `drawingsPrimitive` 之前,app.js:1177 附近)

| 函式 | 內容 | 為什麼 |
|---|---|---|
| `barSpanSec()` | 由全域 `tf`(分鐘,app.js:80-81)與 `STD_TF`(app.js:26)換算;tick bar 模式退回 `bars[n-1].time - bars[n-2].time` 的中位數 | 外插未來時間、內插 sub-bar 時間都要它 |
| `timeToLogical(t)` | 二分搜尋 `bars`:精確命中 → `i - seriesFrom`;落在兩根之間 → 小數內插;超出尾端 → `(bars.length-1 - seriesFrom) + (t - lastTime)/barSpanSec()` | LWC 的 logical 是**相對於目前餵進 series 的窗口**,`seriesFrom` 會被 `feedWindow()`/`maybeReWindow()`(app.js:2032-2044)搬動,所以**只能在渲染當下即時計算,絕不可儲存** |
| `logicalToTime(lg)` | 上式反函數 | 放置/拖曳取自由時間用(Stage 2) |
| `nearestBarTime(t)` | 二分搜尋定位 + 比左右兩根(**不是線性掃描**) | G47 跨週期重映射 |
| `drawX(t)` | `const c = ts.logicalToCoordinate(timeToLogical(t)); return c != null ? c : ts.timeToCoordinate(nearestBarTime(t));` | G7 + G47 一次解決 |
| `drawY(p)` | 先 `candle.priceToCoordinate(p)`;回 null 時用兩個已知價位的線性外插自算 | SPEC:147 建議 3 |

### 1.2 要改的既有位置

| file:line | 現有 | 動作 |
|---|---|---|
| app.js:1188 | `const X = (t) => ts.timeToCoordinate(t), Y = (p) => candle.priceToCoordinate(p);` | 換成 `drawX`/`drawY` |
| app.js:1469 | `drawingHandles()` 內同樣的 X/Y | 同上 |
| app.js:1499 | `drawingAt()` 內同樣的 X/Y | 同上 |
| app.js:1189-1199 | 型別分派 | 新增 `vline`(G37)、`hray`(G36)、`cross`(G38)三個分支,全部加 null-guard;`ray` 的 `dx===0` 退化修掉(G35),同一個回呼內取 `H`(比照 app.js:2118) |
| app.js:1513-1514 | `drawingAt` 的 ray 延伸 | 同步修 `dx===0`(G35);加 `hray`/`vline`/`cross` 的 hit-test |
| app.js:1467-1490 | `drawingHandles()` | `vline` 加對稱於 `horiz:true` 的 `vert:true`(只比 x 距離);`hray`/`cross` 各一個單點 handle |
| app.js:1548-1552 | `nearestHandle()` | 目前只認 `horiz`(只比 y)與預設(hx/hy 都比);加 `vert` 分支(只比 x) |
| app.js:1520-1527 | `drawingFields()` | `vline` 只有 t 欄位;`hray`/`cross` 各 t+p |
| app.js:705-737 | `ensureOscChart()` | 掛一份 vline 專用 primitive 到 oscChart 的 series,讓縱線貫穿指標窗格(G37)。兩張 chart 的 timeScale 已同步(719-728),`oscChart.timeScale().timeToCoordinate/logicalToCoordinate` 可直接用 |

### 1.3 `rt_drawings` migration

新增版本鍵 `rt_drawings_v`(目前不存在,`loadJSON` 回 0 即視為舊版),在 `drawings` 載入處(app.js:1432)之後立刻跑一次:

```
// v0 -> v1
function migrateDrawings(arr) {
  let n = 0;
  for (const d of arr) {
    if (d.style) continue;                       // 已遷移
    d.style = { color: d.color || '#d1d4dc', width: 1.5, dash: 0 };
    d.locked = false; d.hidden = false;
    d.z = n; d.visibleTFs = null;                // null = 所有週期都顯示(向下相容)
    d.id = 'd' + (Date.now().toString(36)) + '_' + n;
    n++;
  }
  return arr;
}
```

**相容規則**:
- **保留 `d.color`**(不刪),新程式讀 `d.style.color`,寫入時兩邊都寫 —— 檔內 renderer 直接用 `d.color`(app.js:1190、1206),分兩批改比一次改完安全。
- **保留 `p1`/`p2`/`stop`/`target` 的既有形狀**,不改名(`drawingFields` app.js:1520-1527、`startBodyDrag` app.js:1531 都靠這些 key)。
- `annotations`(`rt_annotations`)本階段**不動**。
- 一點工具的新型別沒有 `p2`;所有讀 `d.p2` 的地方本來就有 `if (d.p2)` 守衛(app.js:1203、1209、1507、1525),確認過不會炸。
- 遷移完 `saveJSON('rt_drawings', drawings); saveJSON('rt_drawings_v', 1);`。回滾方式:舊版程式讀到多出來的欄位會直接忽略(只讀 type/p1/p2/color),**降版安全**。

### 1.4 Playwright 驗收

| 測 | 步驟 |
|---|---|
| 未來空間可見(G7) | 載入 → `localStorage.setItem('rt_drawings', JSON.stringify([{type:'hl',p1:{t:<最後一根 time>+3600,p:<某價>},color:'#d1d4dc'}]))` → reload → `expect(await page.evaluate(()=>window.__drw.ok)).toBe(true)` → 截圖比對線有畫出來(或在 primitive 內埋 `window.__drwDbg.lastX` 斷言 x 為有限數非 null) |
| 跨週期不消失(G47) | 畫一條 tl(見 Stage 2 的點擊流程)→ 記下 `drawings[0].p1.t` → 切 timeframe(`#tfSelect`)→ `expect(drawings[0].p1.t)` 不變 **且** `window.__drwDbg.lastX` 非 null |
| 舊存檔可遷移 | 塞入 v0 形狀的 `rt_drawings` → reload → `expect(await page.evaluate(()=>drawings[0].style.color)).toBe('#d1d4dc')`、`rt_drawings_v === 1` |
| vline 貫穿指標窗格(G37) | 開 RSI(`#oscSelect`)→ 放一條 vline → 對 `#chart` 與 `#oscPane` 各截圖,斷言同一 x 欄位都有非背景色像素 |

---

## Stage 2 — 放置 + 磁鐵

**目標**:預設自由座標(價格與時間都自由)、Weak/Strong 磁鐵、Ctrl 暫時反轉、rubber-band 預覽、Keep drawing。

| # | file:line | 函式 / handler | 動作 |
|---|---|---|---|
| G5 | app.js:1424-1425 | `magnetPrice()` | 兩行的 `rnd(raw)` 都改 `raw` |
| G8/G10/G11 | app.js:1423-1428 | `magnetPrice(time, raw)` → `magnetSnap(time, raw, y, invert)` | 三態 `'off'/'weak'/'strong'`;weak 用 `candle.priceToCoordinate(v)` 與 `y` 比**像素**距離(門檻 8-10px,**TV 未公布數值,標「查不到」待實機比對**);找棒子改用 logical 就近取整(G10);未來空間無棒 → 不吸附 |
| G6 | app.js:1554-1557 | `xToTime()` | **保留原樣**給 annotation/`start` 用;**新增** `xToFreeTime(x)` = `logicalToTime(ts.coordinateToLogical(x))` |
| G7/G6 | app.js:1559-1567 | `chart.subscribeClick` | 1560 的 guard 改 `if (!tool \|\| !param.point) return;`;1561-1562 的 `bars.findIndex` 檢查**只保留給 `start`(1563)與 annotation(1564)分支**;繪圖分支改呼叫 `handleDrawClick(tool, xToFreeTime(param.point.x), price, param.sourceEvent)` |
| G9 | app.js:1565-1566 / 1583-1585 | 放置 / `dragH` 拖曳 | 放置讀 `param.sourceEvent.ctrlKey`(**已反解 lib v4 確認 click params 帶 sourceEvent 修飾鍵**);拖曳讀 `e.ctrlKey`,兩處都把 invert 傳進 `magnetSnap` |
| G2 | app.js:1608-1615 | `#chart` pointermove | 目前 `if (tool) { cursor='crosshair'; return; }` → 改成記錄 `previewXY = {x,y}` 後 `repaintOverlays()` 再 return |
| G2 | app.js:1215 之後 | `drawingsPrimitive` draw | `pendingPt && previewXY` 時依 `tool` 畫預覽(tl/ray 線段、box 矩形、fib 帶、measure 標籤)。**純像素:起點 `drawX/drawY(pendingPt)`,終點直接用 `previewXY`**,不做 time/price 往返 |
| G4 | app.js:1416 | `resetToolAfterDraw()` | 加 `if (!keepDrawing)` 守衛(四個呼叫點 1296/1303/1307/1564 一次覆蓋) |
| G4 | index.html:119 後 / app.js:3599-3600 旁 | leftbar | `#btnKeepDraw` 按鈕 + `rt_keepdraw` 持久化,寫法比照 `#btnMagnet` |
| G36-G38 | app.js:1294-1308 | `handleDrawClick` | 加 `hray`/`vline`/`cross` 三個單點分支(比照 1296),各自 push + `resetToolAfterDraw()` |
| G26-G32 的工具本體 | index.html:127 後 / app.js:1440 / 3591-3597 | leftbar + `TOOLBTN` + onclick | `drwHRay`/`drwVLine`/`drwCross` 三顆新按鈕 + TOOLBTN 對應 + `setTool()` 綁定 |

**migration**:`rt_magnet` 由 boolean → 字串。`let magnet = (v => v === true ? 'strong' : v === false ? 'off' : (v || 'off'))(loadJSON('rt_magnet', false))`,首次讀到 boolean 就立刻回寫字串。舊值 `true` 映射成 `'strong'` 是忠於現況(現在的「開」就是無門檻吸附)。

**Playwright 驗收**

| 測 | 步驟 |
|---|---|
| 價格自由(G5) | 確認 magnet=off → 點 `#drwHL` → `page.mouse.click(x, y)`(y 刻意選非 tick 對齊)→ `expect(drawings[0].p1.p % 0.25).not.toBe(0)` |
| 時間自由(G6) | magnet=off → 畫 tl,兩點都落在 K 棒之間 → `expect(bars.some(b=>b.time===drawings[0].p1.t)).toBe(false)` |
| 未來空間放置(G7) | 點在最後一根 K 棒**右側空白區** → `expect(drawings.length).toBe(1)` 且 `drawings[0].p1.t > bars[bars.length-1].time` |
| Strong 磁鐵(G8) | magnet=strong → 在距離 high 很遠處點擊 → `expect(drawings[0].p1.p)` ∈ 該 bar 的 OHLC |
| Weak 磁鐵(G8) | magnet=weak,距離 > 門檻 → 價格**不等於**任何 OHLC;距離 < 門檻 → 等於最近 OHLC |
| Ctrl 反轉(G9) | magnet=off + `page.keyboard.down('Control')` 點擊 → 價格吸到 OHLC;放開後再點 → 不吸 |
| 預覽(G2) | 點第一點後 `page.mouse.move(...)` → 截圖斷言起點與游標之間出現線段像素(或讀 `window.__drwDbg.preview`) |
| Keep drawing(G4) | 開 `#btnKeepDraw` → 畫完一條 hl → `expect(await page.evaluate(()=>tool)).toBe('hl')`;關掉後再畫 → `tool === ''` |

---

## Stage 3 — 編輯(錨點、本體、Shift、Ctrl-clone、多選、hover、浮動工具列)

| # | file:line | 函式 / handler | 動作 |
|---|---|---|---|
| G12 | app.js:1201-1206 / 1347 / 1387-1390 | 錨點迴圈 / `drawMeasure` / `drawRR` | 三處都加「選取或 hover 才畫 handle」的條件;`drawMeasure`/`drawRR` 加 `selected` 參數(呼叫端 1193-1194) |
| G12 | app.js:1608-1615 | `#chart` pointermove | 已在算 `nearestHandle`/`drawingAt`,順手存 `hoverDrawing` 並在變動時 `repaintOverlays()` |
| G43 | app.js:1573-1576 | pointerdown | `if (!drawingsLocked) { dragH = h; chart.applyOptions(...) }`,**`selDrawing` 賦值與 `return` 留在外面**(否則掉進 1578 的 deselect) |
| G18 | app.js:1576 | pointerdown body 分支 | `e.ctrlKey/metaKey` → clone 後拖 clone |
| G19 | app.js:1430 / 1576 / 1578 / 3699 / 1207-1213 / 1543-1546 | `selSet` | 宣告、Ctrl 加入-移除、兩處清空、高亮遍歷、刪除遍歷 |
| G15 | app.js:1528-1532 / 1533-1541 / 1588 | `startBodyDrag` / `moveBody` / pointermove | 存起點像素 `sx/sy`;`moveBody(x,y,shiftKey)` 用像素差決定鎖哪一軸;呼叫端傳 `e.shiftKey` |
| G14/G16 | app.js:1559 | `chart.subscribeClick` | 第二擊讀 `param.sourceEvent.shiftKey`:tl 夾 45°、box 夾正方形(在像素空間夾,再 `coordinateToPrice` 換回) |
| G13/G17/G41/G42 | 新 DOM + app.js:1207-1214 | `#drawToolbar` + Settings 面板 | bbox 由選取分支已算的 `hpts` + `drawX/drawY` 取 min/max,**座標 null 就隱藏**;工具列項目:顏色/線寬/線型/鎖定/刪除/設定;設定面板分頁 Style / Coordinates(G41)/ Visibility(G42) |
| G17 | app.js:1323-1333 / 1336-1357 / 1374-1390 | `drawFib` / `drawMeasure` / `drawRR` | 改成讀 `d.style.color`(目前三者都用寫死顏色,不改的話「調了色卻沒反應」) |
| G34/G39/G40 | app.js:1198 / 1197 / 1318-1333 | tl extend+箭頭 / box extend+middle line / fib 層級+Reverse+Extend | 依 G34/G39/G40 欄位渲染;hit-test(app.js:1506/1509-1514)同步 |
| G20 | app.js:1530 | `dragBody` | 單一 `{d, fields}` → 成員陣列,群組移動 |

**Playwright 驗收**

| 測 | 步驟 |
|---|---|
| 錨點只在選取後出現(G12) | 畫一條 tl → 點空白處取消選取 → 截圖不應有錨點像素 → 點線本體 → 錨點出現 |
| Shift 45°(G14) | 點第一點 → `keyboard.down('Shift')` → 點一個非 45° 的位置 → 斷言 `|dy/dx|` 在像素空間約等於 1(±2px) |
| Shift 正方形(G16) | 同上對 box → 斷言 `|x2-x1| ≈ |y2-y1|` |
| Shift 拖曳鎖軸(G15) | 選取 box → `keyboard.down('Shift')` → 斜向拖曳 → 斷言只有 t 欄位或只有 p 欄位變動 |
| Ctrl clone(G18) | 選取後 Ctrl+拖曳 → `expect(drawings.length).toBe(2)` 且原件座標不變 |
| 多選(G19) | 點 A → Ctrl 點 B → `expect(await page.evaluate(()=>selSet.size)).toBe(2)` → Delete → `drawings.length === 0` |
| Lock 擋拖不擋選(G43) | 開鎖 → 點本體 → `selDrawing` 非 null;拖曳 → 座標**不變** |
| 浮動工具列(G13) | 選取 → `expect(page.locator('#drawToolbar')).toBeVisible()` → 改色 → `drawings[0].style.color` 更新且重繪;把該繪圖平移出畫面 → 工具列隱藏且無 console error |
| 改色對 fib/measure/rr 有效(G17) | 對每種型別各測一次改色後截圖差異 |

---

## Stage 4 — 鍵盤 + Undo/Redo + 全域開關

### 4.1 keydown(app.js:3684-3700)重排

**順序是正確性問題,不是風格問題**:所有帶修飾鍵的分支必須排在純字母分支**之前**,否則 `Alt+F`(G31)會被 3690 的 `k==='f'` 吃掉並**真的送出突破買單**,`Alt+J`(G28)會被 3691 的 `placeBreakout('short')` 吃掉。建議在 3687(Space)之後、3688 之前插入一整段修飾鍵區塊:

```
if (e.ctrlKey || e.metaKey) {
  if (k === 'z') { e.preventDefault(); return undo(); }
  if (k === 'y') { e.preventDefault(); return redo(); }
  if (k === 'c') { e.preventDefault(); return copyDrawing(); }
  if (k === 'v') { e.preventDefault(); return pasteDrawing(); }
  if (e.altKey && k === 'h') { e.preventDefault(); return toggleHide('drawings'); }
}
if (e.altKey) {
  if (e.shiftKey && k === 'r') { e.preventDefault(); return setTool('box'); }
  if (k === 't') { e.preventDefault(); return setTool('tl'); }
  if (k === 'h') { e.preventDefault(); return setTool('hl'); }
  if (k === 'j') { e.preventDefault(); return setTool('hray'); }
  if (k === 'v') { e.preventDefault(); return setTool('vline'); }
  if (k === 'c') { e.preventDefault(); return setTool('cross'); }
  if (k === 'f') { e.preventDefault(); return setTool('fib'); }
}
if (selDrawing && k.startsWith('Arrow')) { /* G23 微調,見下 */ }
```

3685 的 `INPUT/SELECT` 提前 return 已經保護輸入框的原生 undo,不用另外處理。`HELP_KEYS`(app.js:3705-3709)的 Drawings 群組要補上新鍵。

### 4.2 各項落點

| # | file:line | 動作 |
|---|---|---|
| G21/G22 | 1296 / 1302 / 1306(push 前)、1313、1442、1545、**1574 / 1576**(pointerdown 起拖當下)、3725 / 3729 | 各插一次 `snapshot()`;`undo()`/`redo()` 還原 `drawings` + `annotations`,兩個 `saveJSON`,再 `repaintOverlays()` + `refreshMarkers()` |
| G23 | 3693 之前 | 方向鍵微調;用 `drawingFields()` + `bars.findIndex ±1` + clamp `Math.min(idx, bars.length-1)`;`selDrawing` 為 null 才落到換日 |
| G24 | 新函式 | `copyDrawing`/`pasteDrawing`,貼上偏移比照 app.js:1300-1301 的 rr 放置寫法,**clamp 到 `idx`** |
| G25 | 1569 | 放行 `e.button === 1` → 命中即刪 |
| G33/G45 | **1184**(drawingsPrimitive draw callback 內)、2923(`refreshMarkers` 把 annotations 併入)、1282-1291(`orderPrimitive`)、938-1002(`indicatorPrimitive`)、756-767 + 204(oscChart series / volume 的 `applyOptions({visible})`) | 三支旗標 `hideDrawings`/`hideIndicators`/`hidePositions` + All;守衛**下在 draw callback 內,不是 `repaintOverlays()`(1293)** |
| G43/G44 | 1573-1576、1543-1546、3696-3697 | `drawingsLocked` 擋拖曳(保留選取)、刪除前 `confirm()`、`alwaysRemoveLocked` 設定 |
| G46 | index.html:134、app.js:3596、867-869 | `#drwClear` 改下拉;抽 `resetAllIndicators()` 給「Remove Drawings & Indicators」用;**經 setter 呼叫並同步 checkbox `.checked`** |

**migration**:新增 `rt_keepdraw`、`rt_lockdrw`、`rt_alwaysrmlocked`、`rt_hide`(`{drawings,indicators,positions}`),全部 `loadJSON(key, 預設)` 取值,舊使用者讀不到就用預設,無需轉換。`rt_magnet` 的 boolean→字串轉換見 Stage 2。

**Playwright 驗收**

| 測 | 步驟 |
|---|---|
| Undo/Redo(G21/G22) | 畫 3 條 → Ctrl+Z ×2 → `drawings.length===1` → Ctrl+Y → `===2`;**拖曳後 Ctrl+Z 要還原到拖曳前座標**(這是最容易做錯的一條:快照必須在 pointerdown 拍) |
| Alt+F 不再下單(G31) | `page.keyboard.press('Alt+f')` → `expect(tool).toBe('fib')` 且 `expect(await page.evaluate(()=>entryOrder)).toBeNull()` |
| Alt+J 不再送賣單(G28) | 同上對 `hray` |
| 其他熱鍵(G26/G27/G29/G30/G32) | 逐一 press → 斷言 `tool` 值 |
| 方向鍵(G23) | 選取繪圖 → ArrowRight → `p1.t` 前進一根、**當日未換日**;取消選取 → ArrowRight → 換日 |
| Ctrl+C/V(G24) | 複製貼上 → `drawings.length` +1,且新物件的 t **≤ `bars[idx].time`** |
| 中鍵刪除(G25) | `page.mouse.click(x, y, {button:'middle'})` 命中繪圖 → `drawings.length` -1 |
| Hide all(G33/G45) | Ctrl+Alt+H → 截圖無繪圖 **且箭頭標記也消失** → **平移圖表後再截圖,繪圖不可冒回來**(這條專門抓「守衛放錯在 repaintOverlays」) |
| Hide Indicators | 開 RSI+VWAP → Hide Indicators → `#oscPane` 與主圖都無指標像素;取消隱藏後**設定值原樣恢復**(不是被 reset 掉) |
| Lock + Delete(G44) | 鎖定後按 Delete → 出現 `confirm`(`page.on('dialog')`)→ 取消 → `drawings.length` 不變 |
| Remove Drawings & Indicators(G46) | 開數個指標 + 畫數條線 → 選該選項 → `drawings.length===0` 且 `vwapOn/bbOn/emaOn/ripsterOn/volOn === false`、`oscMode==='off'`、對應 checkbox 皆 unchecked |

---

## Stage 5 — 驗證矩陣

**執行環境**:`py serve.py`(5560)→ `npx playwright test`。新增 `package.json`(只放 `@playwright/test` 一個 devDependency)與 `tests/tv-drawing.spec.js`。

**每個 case 的共同前置**:`page.addInitScript` 清空 `rt_drawings`/`rt_annotations` 並鎖定一組固定的資料集與 timeframe,讓像素座標可重現。

| 規則 | 測試 id | 斷言核心 | 階段 |
|---|---|---|---|
| G1/G36-G38 一點工具 | `one-click-tools` | 每個工具單擊後 `drawings.length===1` 且 `tool===''` | 2 |
| G2 預覽 | `rubber-band` | 第一點後移動游標,畫面出現連到游標的線 | 2 |
| G3/G4 Keep drawing | `keep-drawing` | 開/關兩種情境下 `tool` 的值 | 2 |
| G5 價格自由 | `free-price` | `p % TICK !== 0` | 2 |
| G6 時間自由 | `free-time` | `p1.t` 不等於任何 `bars[].time` | 2 |
| G7 未來空間 | `future-space` | 空白區可放置,且 `window.__drw.ok === true` | 1+2 |
| G8 Weak/Strong | `magnet-levels` | 遠距離下 weak 不吸、strong 吸 | 2 |
| G9 Ctrl 反轉 | `magnet-ctrl` | 按住 Ctrl 時行為與目前狀態相反 | 2 |
| G10 吸附目標 | `magnet-ohlc` | 吸到的值 ∈ 該 bar OHLC | 2 |
| G11 Snap to Indicators | `magnet-ind` | 開啟後可吸到 VWAP/EMA 值 | 2 |
| G12 錨點時機 | `anchor-on-select` | 未選取無錨點像素 | 3 |
| G13 浮動工具列 | `floating-toolbar` | 顯示/隱藏/改色生效/移出畫面隱藏 | 3 |
| G14/G16 Shift 角度與正方形 | `shift-constrain` | 45° / 正方形 | 3 |
| G15 Shift 拖曳鎖軸 | `shift-drag-axis` | 只有一軸變動 | 3 |
| G17 雙擊設定 | `dblclick-settings` | 面板開啟,fib/measure/rr 改色也生效 | 3 |
| G18 Ctrl clone | `ctrl-clone` | 數量 +1、原件不動 | 3 |
| G19/G20 多選與群組 | `multiselect` | `selSet.size`、批次刪除/移動/鎖定 | 3 |
| G21/G22 undo/redo | `undo-redo` | 含**拖曳**的 undo | 4 |
| G23 方向鍵 | `arrow-nudge` | 有選取不換日、無選取才換日 | 4 |
| G24 複製貼上 | `copy-paste` | clamp 到 `idx` | 4 |
| G25 中鍵刪除 | `middle-click-delete` | 數量 -1 | 4 |
| G26-G32 熱鍵 | `hotkeys` | 每個 Alt 組合 → 對應 `tool`,且**不觸發下單** | 4 |
| G33/G45 Hide | `hide-all` | 隱藏後平移不冒回來;三分類各自獨立 | 4 |
| G34/G35/G39/G40 工具特殊行為 | `tool-options` | extend/箭頭/中線/正方形/fib 4 條預設 | 3 |
| G35 ray 垂直 | `ray-vertical` | 兩點同 bar 時線延伸到上/下邊界,**且延伸段可點選** | 1 |
| G41 Coordinates | `coord-dialog` | 手動輸入 bar number + price 後圖形移動到該處(含未來 bar) | 3 |
| G42 Visibility | `visibility-tf` | 限定 5m 顯示的物件,切到 1m 時消失,**且其他繪圖與 handle 照常顯示**(專抓 `return` vs `continue` 的 bug) | 3 |
| G43/G44 Lock | `lock-drawings` | 擋拖不擋選;刪除跳 confirm | 3+4 |
| G46 Remove 下拉 | `remove-menu` | 繪圖與指標一起清空 | 4 |
| G47 跨週期 | `cross-interval` | 切週期後 `t` 不變且仍可見 | 1 |
| G48 leftbar | `leftbar-inventory` | 7 個 TV 元件的按鈕都存在且可切換 | 1-4 |

**回歸保護**(改壞既有功能會立刻被抓到):
1. `window.__drw.err` 在任何 case 結束時必須是 undefined(app.js:1217-1219 的 try/catch 會把渲染例外吞掉,不主動斷言就看不見)。
2. 交易熱鍵 B/S/F/J/X 在所有繪圖 case 之後仍能正常下單(防 Alt 分支插錯位置)。
3. `#btnHideTradesTop`(index.html:106)原本的「隱藏成交箭頭」行為不變(G45 是新旗標,不可把它改掉)。
4. replay 前進數百根觸發 `feedWindow()`/`maybeReWindow()`(app.js:2032-2044)後,既有繪圖位置不得漂移 —— 這是 Stage 1「logical 不可儲存」那條規則的守門測試。

---

# (C) 刻意不做(out of scope)

| TV 行為 | SPEC 出處 | 不做的理由 |
|---|---|---|
| **Object tree(物件樹 + 資料夾分組 + 拖曳排序 z-order + 資料夾繼承可見性)** | SPEC:133 | 完整的樹狀面板 + folder + 繼承規則是獨立子系統,與「操作細節一致」的核心訴求(放置/磁鐵/編輯/鍵盤)無關;本專案是單圖單 layout 的 replay 訓練器,繪圖數量以個位數為主,沒有需要用資料夾管理的規模。**但 `z` 欄位在 Stage 1 已經先加進資料模型**,之後要補只需做 UI |
| **跨 layout / 跨圖表同步(Sync off / by layout / Global sync)** | SPEC:138 | 本專案沒有 layout 概念,也沒有多圖表工作區(MTF 副圖是唯讀衍生窗格),這個設定沒有對應語意 |
| **Alert(浮動工具列的 clock icon,對繪圖設價格警報)** | SPEC:56、68 | 需要後端/常駐通知機制;replay 是歷史回放,對歷史 K 棒設警報沒有意義。浮動工具列先不放這顆圖示 |
| **Style 樣板(template)套用** | SPEC:69 | 官方註明只有 Trading Platform 有;先做單一物件的樣式編輯(G13/G17),樣板是之後的量化需求 |
| **Alt+拖曳「示範游標」** | SPEC:101 | 給錄影/直播用的展示功能,與交易訓練無關 |
| **Ctrl + Eraser 局部擦除** | SPEC:92 | 本專案沒有 Eraser 工具(leftbar index.html:117-136 僅有 clear-all 兩顆),導入橡皮擦是另一個工具的規格 |
| **Fib 的 log-scale 專用計算** | SPEC:117 | 本圖表沒有對數價格軸(全檔無 log scale 設定),沒有可對照的行為;標「查不到對應需求,暫緩」 |
| **`annUp`/`annDown`/`annLong`/`annShort` 四個標記工具對齊 TV** | — | 這是本專案自有功能,TradingView 沒有對應工具,不列入一致性範圍。**但它們共用 `resetToolAfterDraw()`(app.js:1416),Keep drawing 的旗標會不會套用到它們必須明確決定**(建議:套用,行為較一致) |

### 規格本身查不到、實作時要標註或實機確認的 5 點

1. Weak/Strong 磁鐵**選單的喚出手勢**(長按?右鍵?)—— SPEC 全文以 dropdown/右鍵/長按/箭頭/popup 等關鍵字搜過,只有兩種模式的定義,沒有 UI 手勢來源(G8)。
2. Weak 磁鐵的**像素門檻數值** —— 官方未公布(G8)。
3. **Crossline 的視覺形狀** —— SPEC §6 工具表沒有這一列,「水平+垂直十字」是依命名推斷(G38)。
4. **Rectangle 的 Middle line 方向** —— 官方頁未逐字說明,依常見實作假設為水平(G39)。
5. **超出可視範圍後圖表是否自動捲動/縮放** —— SPEC:33 標明「查不到」(影響 G7 的邊界行為)。

---

## 手動實測補記(2026-09-17,真實滑鼠/鍵盤逐項操作 5560)

| 項目 | 結果 | 處理 |
|---|---|---|
| Alt+T → 點兩下、第一點後預覽線跟游標、畫完自動選取 + 浮動工具列 | 一致 | — |
| 價格/時間自由(p%0.25≠0、t 不在 K 棒上) | 一致 | — |
| hover 線段游標 move + 錨點浮現、拖本體、拖錨點、Shift 鎖軸/45°、Ctrl 複製、Ctrl 多選、Delete、Ctrl+Z/Y、方向鍵微調(選取時不換日) | 一致 | — |
| 雙擊開設定(Style / Coordinates / Visibility) | 一致 | — |
| 磁鐵 chevron → Weak/Strong/Snap to indicators;Ctrl 暫時反轉;Weak 12px 門檻 | 一致 | — |
| Keep drawing、Esc 取消、未來空間放置、Alt 熱鍵不下單、Ctrl+Alt+H 平移後仍隱藏、Lock 擋拖 + 刪除 confirm、Ctrl+C/V、Remove 下拉 | 一致 | — |
| 第一點後跳出「Click the second point」toast | TV 沒有 | 已移除 |
| 左工具列排列:TV 是「工具在上、磁鐵/Keep drawing/Lock/Hide/Remove 在下」;六種線工具在 TV 是一顆群組鈕 + 右側小箭頭展開清單(含熱鍵) | 原本不同 | 已改成 TV 排列;新增 `#drwLines` 群組鈕(顯示最後用過的線工具)+ `#btnLinesMenu` 展開 LINES 清單;按鈕不再被壓扁,工具列改為可捲動 |
| TV 登入牆擋住的項目(選取態浮動工具列外觀、右鍵選單、hover 顏色) | 無法取得 TV 實際畫面 | 依規格文字實作;待使用者以自己的 TV 帳號對照 |
