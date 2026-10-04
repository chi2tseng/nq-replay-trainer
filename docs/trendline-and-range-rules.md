# 趨勢線規則、區間規則、趨勢何時結束、區間如何確認（Mack 為主）

> 延續 `trending-rules-route-mindmaps.md`。四個題目各自一節，每節先列 Mack（PATs）的原則，再用 Al Brooks、Thomas Wade 交叉驗證。
> 2026-10 上網查證整理，來源在文末。僅供練習與覆盤，非投資建議。

---

## 1. Trendline rules（趨勢線規則）

### 1.1 Mack 的畫法與確認

| 規則 | 內容 |
|---|---|
| 畫法 | 上升趨勢連接 **swing lows**（越來越高的低點）；下降趨勢連接 **swing highs**。趨勢線就是「斜的支撐／壓力」，和水平支撐壓力同等重要。 |
| 確認 | **3 個確認觸點**才算確認的趨勢線。觸點與反彈越多，趨勢越強、趨勢線越可靠。 |
| 短線也適用 | 大趨勢線裡面的小趨勢線（minor TL）規則一樣有效，Mack 建議用在短週期價格行為上。 |
| 通道 | 把趨勢線**複製到價格另一側**就是通道線（trend channel line）；通道線告訴你這一波大概會在哪裡結束、下一波從哪裡開始。 |
| 跨時段 | 前一段時間畫的趨勢線和支撐壓力，之後仍然有效。 |

### 1.2 Mack：什麼才算「破線」

1. **要有可驗證的收盤在趨勢線外**（verifiable close outside the trend line），不是影線穿過幾個 tick。
2. 破線必須「令人信服」（convincing），只穿幾 tick 不算。
3. **破線只是趨勢「可能」要結束的線索，不是趨勢已結束的訊號。**
4. 已確認的趨勢線被破之後，**價格通常還會轉回趨勢方向，做出一個比破線前更高（低）的新極值**，而且典型是兩條清楚的腿到新極值。
5. 破線後**仍不可逆勢**，要等前高（多頭）／前低（空頭）被回測之後。
6. 新趨勢形成後：重畫趨勢線，用新的 swing lows / highs。

### 1.3 Brooks 的補充：破線「強度」怎麼看

- 幾乎所有反轉都從「趨勢線被破」或「通道線被超越後反轉（overshoot & reversal）」開始。
- 強的破線：走了很多點、明顯穿越 EMA、持續 10 到 20 根 K、在 EMA 另一側收盤很多根、突破了前一個 lower high（空頭）或 higher low（多頭）。
- 弱的破線：K 棒重疊、小實體、停在 EMA 附近 → 偏向延續。
- Micro trendline：2 到 10 根 K 貼著的小趨勢線，被假突破後是順勢 H1 / L1 進場，不是反轉。
- 通道線 overshoot 是高潮（climax）；反轉回通道內才是交易。

### 1.4 Wade 的補充：趨勢線規則（trendline rule）

- 破線 = **K 棒收盤在趨勢線外**。
- 破線之後**預期會先做出新極值**，然後才可能反轉（和 Mack 一致）。
- 多頭趨勢線被破：**不放空**，空單被「鎖住」直到價格回測破線前的 swing high。
- 破線後若要繼續做多：價格要先進一步回調、形成新的下降趨勢線，然後突破那條下降線、再回測被穿越的最低 swing low，才算有效的多單。

---

## 2. 什麼情況 trend 結束

### 2.1 Mack：趨勢結束的順序（缺一不可）

```
① 已確認的趨勢線被令人信服地破（收盤在線外）
   ↓ 這只是線索，趨勢還沒結束
② 價格轉回趨勢方向，回測前極值（通常兩腿）
   ↓
③ 在前極值附近出現以下其中之一：
   a. 做出新極值，但順勢的 2nd entry「失敗」（failed 2nd entry）
      → 幾乎必然是陷阱，新趨勢的最佳進場
   b. 回測失敗：lower high / 雙頂（或 higher low / 雙底）
      → 逆勢 2nd entry 此時才被允許
   ↓
④ 趨勢結束。接著不是反向趨勢，就是進入區間。
```

Mack 原文：「大多數情況下，趨勢不會真正結束，直到前極值被回測、而且新極值已經出現之後。」

**還沒結束的訊號（別被騙）**
- 只破線沒回測：還不能逆勢。
- 回測後強勢做出新高且順勢 2nd entry 成功：趨勢延續，重畫趨勢線。
- 兩腿回調到 EMA / 趨勢線：這是延續型態，看起來像頭部，但輸家才在這裡逆勢。

### 2.2 Brooks：趨勢怎麼死

- MTR（major trend reversal）四步：強趨勢 → 趨勢線被破（動能流失）→ 回測極值（更高高或更低低）→ 反轉訊號 K。
- 趨勢結束後只有兩種去處：**反向趨勢**或**交易區間**。大多數高潮（climax）後的反轉變成區間，而不是反向趨勢。
- 衰弱的徵兆：K 棒重疊變多、影線變長、出現反向趨勢 K、回調開始穿 EMA。第一次出現 gap bar（整根不碰 EMA）的回調後，通常會再回測一次極值。
- **20 根 K 法則**：回調超過約 20 根 K，趨勢的影響力就幾乎沒了，反轉和延續機率各半，實際上已經是區間。

### 2.3 Wade：趨勢「打完」的判定

- 多頭「plays out with a new high」：破線後做出的那個新高，就是多頭偏向結束的訊號。
- Failure 的精確定義：第一根反向 K 出現後，**它的高／低被突破**才算失敗。
- F2EL below EMA（失敗的第二進場多單、在 EMA 下方）= 反轉型態。
- 只在逆勢情境出現的 2nd entry 叫 trap，不是進場。

---

## 3. 什麼情況確認這是 range

### 3.1 Mack：區間的判定清單

| 訊號 | 說明 |
|---|---|
| **21 EMA 走平** | EMA 是會動的趨勢線；走平 = 沒有趨勢。 |
| **價格頻繁穿越 EMA** | 區間日價格會「一直從 EMA 一側跑到另一側」；趨勢日價格停在趨勢那一側。 |
| **K 棒重疊** | 重疊的 K 棒就是 congestion；congestion 只是「小型交易區間」，規則完全一樣。 |
| **高低點被多次測試** | 區間的高勝率進場就在區間的高點和低點。 |
| **原始突破失敗** | 大多數初始突破不論方向都會失敗；突破失敗後回區間內 = 區間被確認。 |
| **趨勢結束後兩邊都失敗** | 破線 → 回測 → 既做不出新極值、反向也走不遠 → 區間。 |

Mack 另外一條：區間內價格**偏向延續進區間之前的趨勢**，但最常見的劇本是「逆偏向方向突破後立刻失敗」。

### 3.2 Brooks：區間的定義

- **兩根以上大幅重疊的 K 棒**就定義了一個交易區間；多空雙方都無法掌控（always-in 兩邊都不是）。
- 區間常常是「拉太久的回調」：回調超過 20 根 K 就當區間看。
- Barbwire（鐵絲網）：3 根以上重疊、長影線、很多十字線 = 緊縮區間，極度不確定。
- 區間裡會一再嘗試突破上下緣而失敗；初學者「一直被反轉」的挫折感本身就是區間的特徵。

### 3.3 Wade：區間「健康」與否

- **健康區間**：價格規律地在兩個關鍵價位之間上下震盪，兩端都被測試。
- **不健康區間（imbalance）**：區間某一側留白、某個關鍵價位完全沒被測試 → 區間結構有偏向。
- 關鍵價位要「靜態」（static）；價位一直在移動就不是乾淨的區間。
- 區間變成趨勢的條件：價格突破支撐或壓力，**並且持續遠離**原區間。

---

## 4. Range rules（區間規則）

### 4.1 Mack 的區間鐵律

1. **絕不買賣原始突破**。大多數區間突破至少先失敗一次，就算看起來很強。
2. 要嘛 **fade 突破**（做失敗突破），要嘛 **等突破回調（breakout pullback）**：突破失敗開始回調，回調失去動能、價格重新轉回突破方向時才進場。
3. **只在區間高點和低點進場**，中間沒有優勢。
4. 區間是**可以做逆勢**的地方（Mack：「市場在區間時，就是找逆勢行情的時候」）。
5. 區間內的 **2nd entry** 在上下緣；區間內的 **failed 2nd entry** 幾乎必是陷阱，是最好的進場。
6. 區間偏向延續先前趨勢，但「逆偏向突破立刻失敗」最常見 → 這個失敗就是進場。
7. **陷阱單**：突破只多 1 到 2 tick 就反轉時，把 stop 單放在被困者停損的位置。逆勢方向的失敗突破要特別警覺。
8. 停損與目標同趨勢規則：訊號 K 外 1 到 2 tick、最多 8 tick；4 tick 先出一部分，剩餘保本。

### 4.2 Brooks 的區間規則

- **BLSHS**：buy low, sell high, scalp。
- **80% 法則**：區間內多數突破失敗、多數反轉嘗試也失敗，價格留在區間內。
- 失敗突破的定義：突破後下一根是反向反轉 K，而且價格再穿過那根 K → 突破失敗 → 反方向高勝率。
- 區間突破後常有拖很久的回調，然後才出現「延遲的第二腿」。
- 不在中間做；等到區間邊緣的失敗突破或第二進場。

### 4.3 Wade 的區間規則

- 區間規則就是**買低賣高**，反直覺但用規則做很可預測。
- 先判斷區間是否健康、關鍵價位是否靜態，不健康的區間偏向失衡那一側。
- 區間轉趨勢：突破後持續遠離才算，否則仍用區間規則。

---

## 5. 兩張檢查表

### 5.1 「趨勢結束了嗎？」

```
□ 已確認（3 觸點）的趨勢線被收盤破了？                 否 → 趨勢未結束，只做順勢
□ 破線是令人信服的（不是幾 tick）？                      否 → 當作假破，順勢 H1/H2
□ 價格已回測前極值？                                     否 → 等，不逆勢
□ 回測時出現 failed 2nd entry 或 lower high / 雙頂？      否 → 趨勢延續，重畫趨勢線
□ 以上全部是 → 趨勢結束；看接下來是反向趨勢（新 HH/HL）還是區間（兩邊都失敗）
```

### 5.2 「這是區間嗎？」

```
□ 21 EMA 走平？
□ 價格一直穿越 EMA 兩側？
□ K 棒大量重疊（congestion）或回調已超過約 20 根 K？
□ 上下緣各被測試過不只一次？
□ 最近一次突破失敗回到區間內？
→ 三項以上成立：用區間規則（不追突破、只在邊緣做、fade 或等突破回調）
→ 突破後持續遠離並出現新的 HH/HL 或 LH/LL：切回趨勢規則
```

---

## 6. 來源（2026-10 查證）

**Mack / PATs**
- How To Reliably Predict Trend Reversals Using Price Action: https://priceactiontradingsystem.com/how-to-reliably-predict-trend-reversals-using-price-action/
- Using Trend Lines To Help You Read The Price Action: https://priceactiontradingsystem.com/using-trend-lines-to-help-you-read-the-price-action/
- Simplify Price Action Day Trading Strategies By Using Trend Lines: https://priceactiontradingsystem.com/simplify-price-action-day-trading-strategies-by-using-trend-lines/
- Counter Trend Trading – The Road To Ruin: https://priceactiontradingsystem.com/counter-trend-trading-the-road-to-ruin/
- How The Type Of Day Affects The Way You Read The Price Action: https://priceactiontradingsystem.com/how-the-type-of-day-affects-the-way-you-read-the-price-action/
- How Price Action Reacts In Congestion: https://priceactiontradingsystem.com/how-price-action-reacts-in-congestion/
- How to Day Trade Break Outs: https://priceactiontradingsystem.com/how-to-day-trade-break-outs/
- Using Price Action To Day Trade Failed Second Entries: https://priceactiontradingsystem.com/using-price-action-to-day-trade-failed-second-entries/
- Trading Traps in the ES: https://priceactiontradingsystem.com/trading-traps-in-the-es-the-perfect-scalp-entry/
- 2nd Entry Trade Example and Some Important Thoughts: https://priceactiontradingsystem.com/2nd-entry-trade-example-and-some-important-thoughts/
- Live Price Action Trade Example – Trading a Range: https://priceactiontradingsystem.com/live-price-action-trade-example-trading-a-range/
- How We Use An EMA: https://priceactiontradingsystem.com/how-we-use-an-ema-in-our-price-action-trading-strategies/
- 社群整理：https://quizlet.com/599525089/macks-price-action-trading-system-flash-cards/ 、https://nexusfi.com/showthread.php?t=17894&page=7

**Al Brooks**
- Trading ranges – areas of confusion: https://www.brookstradingcourse.com/how-to-trade-manual/trading-ranges/
- Microtrendlines and microchannels: https://www.brookstradingcourse.com/futures-market/trading-strategies-microtrendlines-microchannels/
- Price Action Trading Glossary: https://www.brookstradingcourse.com/price-action-trading-terms-glossary/
- Twenty Gap Bars (Trading Price Action Trading Ranges, ch. 13): https://onlinelibrary.wiley.com/doi/10.1002/9781119202608.ch13
- Major Trend Reversal 整理: https://forexsb.com/wiki/trading/al-brooks-trend-reversal
- 9 core principles: https://trasignal.com/blog/forex/price-action-trends-by-al-brooks/

**Thomas Wade**
- X：區間買低賣高、健康區間 https://x.com/IamThomasWade/status/1973081597923475786
- X：failure / trap 定義 https://x.com/i/status/1916565654011838700
- User Guide – Thomas Wade Price Action Strategy（趨勢線規則、2ES 鎖住、回測邏輯）: https://traidmarket.com/blogs/noticias/user-guide-thomas-wade-price-action-strategy
- 5 Price Action Rules EVERY Trader NEEDS To Know（逐字稿）: https://ytscribe.com/v/TegF3yYjnng
