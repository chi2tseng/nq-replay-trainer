# NQ Replay Trainer: design plan (frontend-design pass)

2026-09-26. Evidence: fresh `tests/capture_sizes.mjs` run (10 sizes, 0 capture-time findings). Screens read:
1920x1080 / 1600x900 / 1366x768 / 1024x1366 `_full`, `_dashboard`, plus 1920 `_position_open`, `_dashboard_position`, `_day_detail`.
Source read: `src/styles.css` (tokens, type, radii, heights), `index.html` (toolbar, side, footer), `src/app.js` string builders.

Scope rule: this is a restraint pass inside a pinned aesthetic (NT8 default skin, flat, square, gray chrome,
orange only for active state). Nothing is added. Changes are copy, type scale, spacing and three colour misuses.

---

## 1. Subject, audience, job

- **Subject:** a bar-by-bar replay of real NQ/ES futures tape with a NinjaTrader-style order ticket.
- **Audience:** a discretionary futures day trader who already lives in NT8 and wants practice reps without risk.
- **Primary job:** read the chart, place the entry (B / S / F / J), manage it, and see the result per trade and per day.

The chart is the product. Everything else is a ticket stub beside it.

---

## 2. Token system

### Colour (6 named base values, all already in `:root`)

| Name | Hex | Token | Role |
|---|---|---|---|
| Chrome | `#E6E7E8` | `--bg` | app shell, toolbar, left bar, tab strip |
| Paper | `#FFFFFF` | `--panel`, `--chart-bg` | chart, cards, fields |
| Rule | `#BCBDBF` | `--line` | every 1px border and divider (the only structural device) |
| Ink | `#000000` | `--txt` | text, the P&L plate |
| Graphite | `#58595B` | `--dim` | labels, meta, inactive icons |
| Signal | `#CC4400` | `--brand` | **active / selected state only**: pressed segment, active tool, playing transport, focus ring |

Data colours (not part of the chrome palette, used only for price direction):
fills `--green #32CD32` / `--red #FF0000` (candles, day-cell tint, left status bars);
text `--pos #127209` / `--neg #D40605` (6.1:1 / 5.5:1 on white); BUY/SELL fills use `--pos` / `--neg`.
`--sel #6495ED` stays for drawing selection handles only; `--info #0B5FA5` for the position line tag only.

### Type

- **Family:** Segoe UI (Windows system UI face; the stack already falls back to -apple-system / Roboto / Noto Sans TC).
  One family. Numerals use `font-variant-numeric: tabular-nums` so P&L and prices never jitter.
- **Mono (`--mono`, Consolas)** is kept **only** where columns of prices must align character-for-character:
  chart legend OHLC, order rows (`STOP 30769.75`), day-detail chart labels. Not for clocks, badges or HUD labels.
- **Scale** (Bringhurst's classical 6-7-8-9-10-11-12-14-16-18-21-24 ladder, base 12px, 5 steps used):

| Step | Size / line-height | Weight | Used for |
|---|---|---|---|
| caption | 11 / 14px | 400; 600 for field labels | field labels, table headers, meta, hotkey hints |
| body | 12 / 17px (1.45) | 400; 600 for buttons | all controls, table cells, card headings (600) |
| lead | 14 / 18px | 600 | position line (`Long 1 @ 30804.75`), dialog titles, BUY/SELL word |
| figure | 18 / 22px | 700 | stat card values, today P&L |
| plate | 24 / 28px | 700 | the live P&L in the position plate (one place only) |

  Weights allowed: **400, 600, 700**. Drop 500 and 800. No letter-spacing anywhere except 0.
  Today: 16 distinct px `font-size` values (9 to 40px, including 13.5px) and weights 500/600/700/800.

- **Case:** sentence case everywhere. NT8's own Chart Trader field labels read as words, not shouted caps
  (not verified against NT8 in this session). `text-transform: uppercase` is removed from all 13 selectors.
  Symbols and acronyms keep their own case (`NQ`, `ES`, `TBBO`, `ATM`, `R`, `P&L`); `BUY`/`SELL` become `Buy`/`Sell` (change 6).

### Spacing (4px base)

`2 · 4 · 8 · 12 · 16 · 24` (px). Card padding 8 (≤800px tall) / 12 (desktop); gap between cards 8; label-to-field 4;
field-to-field 8; section-to-section inside a card 12. Today's paddings of 5/6/7/9/10/11px collapse to the nearest step.

### Control heights (one per role, desktop / ≤800px tall / touch)

| Role | Desktop | ≤800 tall | Touch (coarse) |
|---|---|---|---|
| Toolbar, tab strip, left-bar icon | 32 / 32 / 34 | unchanged | 40–44 (existing rule) |
| Side-panel field, segment, stepper | 32 | 32 | 44 |
| Side-panel secondary action (Buy stop, Flatten, Reverse, Cancel) | 36 | 36 | 44 |
| BUY / SELL | 48 | 44 | 56 |

Rationale: today the side panel runs 36/44/56 on desktop, which makes the ticket taller than the chart needs and
pushes the ATM editor below the fold at 1366x768; one 32px row height across toolbar, tabs and ticket gives the
whole window a single rhythm.

---

## 3. Layout concept

Left-aligned throughout; numbers right-aligned in tables and order rows; nothing centred except icon glyphs and
segment labels. The chart owns every pixel not needed to trade.

### Main screen (≥1366 wide)

```
+--------------------------------------------------------------------------------------------+
| [NQ v][1m v][Candles v][09-25][TBBO] [MTF][Ind] | << |< < [>] > >> [1 bar/s v] ==o== (+) | Fit Rnd Quiz ? |  (eye)(alarm) 09:30:59 ET |
+--+---------------------------------------------------------------------+-+-----------------+
|> |  NQ 1m  O 30819.00 H 30822.00 L 30770.00 C 30804.25  -15.75        |31040| Order          |
|/ |                                                                     |     | [Market|Limit|Stop]
|= |                    chart (white, LimeGreen/Red)                     |     | Qty    ATM template
|[]|                                                                     |     | [-  1 +][Struct SL 1:1 v]
|<>|                                                                     |     | Target (R)  Stop from
|  |                                                                     |30804| [- 1 +] [O|HL|C|B|50]
|^ |                                                                     |     | [ ] Size by risk  $[200]
|v |                                                                     |     | [ Buy      B][ Sell     S]
|  |                                                                     |     | [Buy stop  F][Sell stop J]
|U |                                                                     |     +-----------------+
|  |                                                                     |     | Position        |
|  |_____________________________________________________________________|_____| Long 1 @ 30804.75|
|  | 07:10    07:30    07:50    08:10    08:30    08:50    09:10    09:30        | #### -$10.00 #### |  <- black plate
+--+---------------------------------------------------------------------+-+-----| Stop 1  30769.75 x|
| Trades  Dashboard                          Save log  Logs  Export CSV  Clear   | [Flatten][Reverse]|
| 0 trades   Net $0.00   Today $0.00                                             | > ATM templates   |
| #  Side  Qty  Entry time  Exit time  Entry  Exit  Ticks  P&L $  R  Plan  ATM   +-----------------+
+--------------------------------------------------------------------------------------------+
```

### Dashboard tab (answer first, calendar second)

```
+--------------------------------------------------------------------------------------------+
| Trades  Dashboard                                         Save log  Logs  Export CSV  Clear |
|--------------------------------------------------------------------------------------------|
|| Today  Fri 25 Sep   -$10.00                                        1 trade, 0 won, 1 lost |  <- 3px status bar
|--------------------------------------------------------------------------------------------|
| Trades | Win rate | Net P&L | Profit factor | Expectancy | Avg R | Planned R:R |  <- one row, 7 equal cells
|    1   |   0.0%   | -$10.00 |     0.00      |  -$10.00   | -0.01 |    1.00     |
|--------------------------------------------------------------------------------------------|
| P&L calendar                                         (<)  September 2026  -$10.00, 1 day (>) |
| Sun      Mon      Tue      Wed      Thu      Fri      Sat                                  |
|                   [ 1 ]    [ 2 ]    [ 3 ]    [ 4 ]    [ 5 ]     40px cells, P&L inside      |
| ...                                         [25 -$10.00]                                   |
|--------------------------------------------------------------------------------------------|
| Cumulative R                         | Statistics                                           |
| Session overview / By ATM                                                                  |
+--------------------------------------------------------------------------------------------+
```

At 1366x768 the dashboard currently shows only the today strip and one calendar row: moving stat cards above the
calendar puts the numbers a trader actually asks for ("how did I do") on the first screen.

---

## 4. Principles

1. **Chart first.** No chrome grows into the chart; any saved pixel goes to the chart, never to decoration.
2. **Colour is meaning.** Green/red = price direction or a buy/sell action. Orange = "this is on right now". Gray = everything else. If an element is orange and not active, it is a bug.
3. **One rule for structure.** Hierarchy comes from a 1px `--line` rule and weight 600, never from caps, tracking, tints, shadows or radius.
4. **One row height.** 32px across toolbar, tabs and ticket; the eye reads the window as one instrument panel.
5. **Words are labels, not instructions.** Short nouns for fields, verbs for buttons; hints go in `title`.
6. **The memorable element: the black P&L plate** (`#posBox .pos-pnl`, NT8 BasicEntry-faithful black strip). It is the only black-filled surface and the only 24px numeral in the app. Every other element stays quiet so an open position is visible from across the room. No other black fills, no other 24px+ figures (the today P&L drops from 22px/800 to 18px/700).

### Review against the brief (what I revised)

- First draft used Consolas for all numbers (clock, badges, HUD): a templated "mono for small data" tell. Revised to Segoe UI + tabular-nums, mono only where price columns must align.
- First draft proposed a Signal-orange hairline under the active tab. Revised: the active tab already reads by the white face vs gray; orange would be decoration.
- First draft kept stat cards after the calendar (current order). Revised: the stats are the answer, calendar is navigation.

---

## 5. Prioritised changes

Each item: element, what is wrong, exact change. Keep every id and handler; hide, never delete.

### P1: violates a standing decision

1. **`.drw-tb` (styles.css:702)**: `box-shadow:0 2px 8px rgba(0,0,0,.18)` on the floating drawing toolbar breaks "no shadows" (the only hit of `grep -nE 'box-shadow|gradient|backdrop-filter'`). Remove the declaration; the 1px `--line` border already separates it.
2. **`#btnPlay` / `#btnPlay.play` (styles.css:129-136)**: orange fill is permanent, including while paused. Orange must mean "playing". Change: default face = normal button (Paper, Rule border, Ink glyph); add `.on` in `play()` (app.js:2565) and remove it in `pause()` (app.js:2572), style `#btnPlay.on{background:var(--brand);border-color:var(--brand);color:#fff}`.
3. **`.rr-hint` (styles.css:773)**: "(struct)" and the "ticks" unit hints are orange but are not a state. Change `color:var(--accent)` to `color:var(--dim)`, weight 400.
4. **`#symbol` (styles.css:123-126)**: the orange 15px/700 "NQ" wordmark next to a select that also says "NQ" is accent-as-branding, and duplicates the symbol shown in the select and the chart legend. Change `color:var(--brand-hi)` to `var(--txt)`, 12px/600, no tracking (it is already hidden below 1600px).

### P2: templated tells and copy

5. **ALL-CAPS labels (13 selectors)**: `th` (styles.css:352), `.card-h`, `.dashbox-h`, `.stat .k`, `.todaypnl .tp-label`, `.ord-field > label`, `.tv-table th`, `.pc-wdrow span`, `#ctxMenu .ctx-head`, `.ds-gh`, `.popover .pop-h`, `.help-gh`, `#oscBar .osc-tag`. Remove `text-transform:uppercase` and all `letter-spacing`; set labels to 11px/600 `--dim`, card headings to 12px/600 `--txt`. Also drop the tracking on `.rh-round` (1.5px), `.st-badge` (2.5px), `.qz-n` (1.4px), `.rh-badge` (1px), `.mode-badge` (.6px).
6. **BUY / SELL (index.html `#btnBuy`, `#btnSell`)**: two-line "BUY / Long · B" is a middle-dot meta string and repeats the side. Change to one line: `Buy` left, hotkey `B` right in 11px at 70% opacity (`.bs-s` text becomes `B` / `S`); `.bs` becomes a row (`flex-direction:row; justify-content:space-between; padding:0 12px`), height 48. Same pattern on `#btnBuyStop` / `#btnSellStop` with `F` / `J`, which today live only in the `title`.
7. **`#btnBuyStop` / `#btnSellStop` (styles.css:804)**: solid Graphite `#58595B` fills make the secondary orders as loud as BUY/SELL. Change to default button face (Paper, Rule border) with `--pos` / `--neg` text and icon; height 36.
8. **Trades summary (app.js:3504-3505)**: `0 trades · Net $0.00 · Today (2026-09-25): $0.00 · 0 trades` says "trades" twice and chains five dots. Change to three spaced fields: `${n} trades   Net ${usd}   Today ${usd}` (use `<span>`s with `gap:16px`), no date (the date is in the toolbar).
9. **Today strip (app.js:3779-3781)**: `TODAY 2026-09-25 -$10.00 … 1 trade · 0W 1L`. Change label to `Today`, date to `Fri 25 Sep`, value 18px/700 (`.tp-val` from 22px/800), meta to `1 trade, 0 won, 1 lost` / `No trades yet`.
10. **"P&L calendar — click a day to see its trades" (index.html:285)**: em-dash instruction label. Change to `P&L calendar`; put the hint in the cell `title` ("Show trades for 25 Sep"). Month title (app.js:3558) `-$10.00 · 1d` becomes `-$10.00, 1 day`.
11. **ATM editor summary (index.html:235)**: "ATM template editor (multi-target scale-out)" wraps to two lines at ≤1600 (seen at 1600x900 and 1366x768). Change to `ATM templates`; move "multi-target scale-out" into the summary `title`.
12. **Order field labels (index.html:187-188, 203)**: `Target R (struct)` becomes `Target (R)`; `Auto-size by risk` becomes `Size by risk`; `Stop from` stays. Do **not** rename ATM keys like `Struct SL · 1:1` (app.js:162-175): they are localStorage keys; if the dot must go, map it at render time only.
13. **Mode badge (app.js:545-547)**: `TBBO · NT` in tracked caps mono. Render as `TBBO` plus a `title="Source: NinjaTrader"`; font = body family 11px/600.

### P3: hierarchy, redundancy, density

14. **Stat cards (styles.css:377 `.statcards`)**: `repeat(6,1fr)` for 7 cards leaves `Planned R:R` orphaned on a second row (1024x1366 dashboard). Change to `repeat(7,minmax(0,1fr))` above 1100px and `repeat(auto-fit,minmax(120px,1fr))` below; move `#statCards` above the calendar `dashbox` in `#panelDash`.
15. **Duplicate "hide trades" control**: `#btnHideTradesTop` (toolbar) and `#btnHideTrades` (tab strip) toggle the same thing. Hide the toolbar copy (`#btnHideTradesTop{display:none}`), which frees ~40px of the 1366px toolbar row; keep the labelled one in the tab strip (see open question 2).
16. **Calendar cells (`.pc-day` styles.css:426)**: 56px min-height, only the P&L matters. Set 40px desktop (touch rule keeps 44), P&L 12px/600, trade count 11px `--dim`. Weekday row `Sun Mon …` in 11px sentence case, left-aligned with the cell's date.
17. **Side-panel heights (styles.css:1033)**: `--ctl:36px; --ctl-lg:44px; --ctl-xl:56px` becomes `32 / 36 / 48` desktop; the ≤800px block becomes `32 / 36 / 44`. Touch rules unchanged.
18. **Position plate meta (`.pos-t`)**: `-2t · -0.01R` becomes `-2 ticks  -0.01 R` (space-separated), 12px/600 at 70% white.
19. **Day-detail header / trade rows (app.js:3024-3041)**: `· 2 trades · 0W 2L`, `NQ · 1m LONG 1`, `-$10.00 · -2t · -0.01R`. Replace dot joins with 12px gaps; `LONG 1` becomes `Long 1`.
20. **Type-scale consolidation (styles.css, whole file)**: map every `font-size` to 11/12/14/18/24 (9,10 to 11; 13,13.5 to 12; 15,16,17 to 14; 20,22 to 18; 26,30 to 24; the 40px glyph stays as an icon size) and every weight 500 to 400, 800 to 700.
21. **Dead radius code**: `*{border-radius:0!important}` (styles.css:1180) already squares everything, so the ~30 leftover `border-radius:5px…10px` declarations are dead. Delete them in one pass (no visual change; makes the file honest).

### Not changing (checked, correct)

- Price axis, candle colours, dotted last-price line, OHLC legend in mono: NT-faithful and aligned.
- Hover transitions (.12s, user-triggered only). No page-load motion exists; keep it that way.
- Modal backdrop `rgba(0,0,0,.6)`: a scrim, not a shadow.

---

## 6. Verification for whoever implements

1. `grep -nE 'box-shadow|text-shadow|backdrop-filter|gradient' src/styles.css index.html` returns 0 lines.
2. `grep -c 'text-transform:uppercase' src/styles.css` returns 0.
3. `grep -oE 'font-size:[0-9.]+px' src/styles.css | sort -u` lists only 11, 12, 14, 18, 24 (+ icon glyph sizes).
4. `cd /d/SIPs && node D:/Tools/replay-trainer/tests/capture_sizes.mjs`: toolbar rows=1 at 1366x768 and above, 2 below; read 1366x768 `_full` and `_dashboard`.
5. `tests/tv_drawing_matrix.mjs` stays 52/52; B/S/F/J/X still fire.
