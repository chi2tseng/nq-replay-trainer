# NQ Replay Trainer — responsive layout / flat-skin implementation spec

Resolved from 58 QA findings (capture + 3 critics + contrast pass), 2026-09-16.
Files in scope: `D:\Tools\replay-trainer\index.html`, `src\styles.css`, `src\app.js`.
Bump `?v=` on `index.html:8` (styles) and on the app script for every change below.

Conflict rule used throughout: **reachability > reading order > vertical economy > aesthetics.**

---

## 0. Two invariants that outrank every tier rule

**INV-1 — nothing disappears.** No control may be `display:none` for space reasons.
Today's violations: `styles.css:1041` `#toolbar #btnHelp{display:none}` (<=1199, findings 11/29 — the `?` key is not reachable on iPad; evidence `exports/qa/sizes/1024x768_toolbar.png`), `styles.css:1026` `#modeBadge{font-size:0;width:10px}` (text-less orange sliver, `exports/qa/sizes/1175x900_toolbar.png`), `styles.css:1033` `#dateLabel{max-width:62px;text-overflow:ellipsis}` (renders `2026-09-…`, `exports/qa/sizes/1366x768_toolbar.png`).

Allowed instead, in this order: (a) shorten the string (ISO date -> `09-15`, clock -> `09:30:59 ET`, badge -> `TBBO`); (b) label -> icon + `title`; (c) relocate the information to a surface that is always reachable (data source moves into a permanent `Source: TBBO · NT` row at the top of `#indPopover`); (d) move the control into an explicit overflow button `#btnMore` (`more_vert`, opens `#morePopover`) appended as the last child of `.grp.tools`. `#btnMore` is itself `display:none` only while it holds nothing.

**State-driven hiding stays legal**: `#btnSettleNow` (`index.html:102`, hidden until a Random round runs) and `#bboTag` (non-TBBO days) are not space-hiding.

**INV-2 — flat only (「不要有陰影」).** After the change, `grep -nE 'box-shadow|text-shadow|backdrop-filter|linear-gradient' src/styles.css` must return **zero** hits, and `grep -n gradient index.html` likewise. Current hits: `styles.css:649` (`.lt-btn.active` inset ring), `:758` (`#loadingOverlay` blur), `:781` (`#rndHud` blur), `:830` (`#quizCard` blur), `index.html:49` and `:54` (swatch gradients). See section D.

---

## A. Per-breakpoint toolbar layout

Cluster ids (DOM order, `index.html:19-116`):

- `D` = `.grp` — `#symbol`, `#dataSelect`, `#tfSelect`, `#chartTypeSelect`, `#dateBtn`(+`#dateLabel`), `#modeBadge`, `#btnMtf`, `#btnIndicators`
- `T` = `.grp.transport` — `#btnPrevDay`, `#btnToStart`, `#btnStepBack`, `#btnPlay`, `#btnStepFwd`, `#btnNextDay`, `#speedSelect`, `#startSlider`, `#btnPickStart`
- `L` = `.grp.tools` — `#btnFit`, `#btnRandom`, `#btnSettleNow`(state), `#btnQuiz`, `#btnHelp`, (`#btnMore`)
- `R` = `.grp.right` — `#btnHideTradesTop`, `#btnAlert`(+`#alertLbl`), `#clock`, `#clockPrice`, `#bboTag`

### T1 — `@media (min-width:1800px)` · ONE row

Row 1: `D` -> `T` (`flex:1 1 auto`, grows) -> `L` -> `R` (`margin-left:auto`).

Full labels: `MTF`, `Indicators`, `#alertLbl`, `#modeBadge` text `TBBO · NT`, `#clock` `09/15 09:30:59 ET`, `#bboTag` visible with `#bboTag .bid{font-weight:700;color:var(--txt)}`; `#clockPrice` hidden whenever `#bboTag` is visible (J4 — removes the duplicated price seen in `exports/qa/sizes/ux_right_1920.png`, finding 43).

`#startSlider{width:100px;flex:1 1 100px;min-width:100px;max-width:240px}` — the cap is mandatory: measured 783.7px at 2560 and 144px at 1920 (`exports/qa/sizes/2560x1440_toolbar.png`, `crit_zoom_slider_2560.png`). Surplus width goes to the gutter before `R`, not into the control.

Cluster separation: `#toolbar{gap:8px}`, `#toolbar .grp{gap:5px}`, `#toolbar .right{gap:5px}`, plus `#toolbar .grp + .grp{border-left:1px solid var(--line);padding-left:8px}` (flat 1px rule, no shadow).

### T2 — `@media (min-width:1500px) and (max-width:1799px)` · ONE row (directive (a))

Same row, same order. Compaction ladder applied **in this order** (natural width measured 1849px at 1600; the ladder buys ~410px; verified live at 1500 / 1520 / 1600 -> single row, height 41px; first wrap only at 1490; proof crop `exports/qa/sizes/ux_proposed_1600_toolbar.png`):

1. `#toolbar #bboTag, #toolbar #clockPrice{display:none}` (−57..−112)
2. `#modeBadge` -> text `TBBO` only, neutral chip (section D7) (−27)
3. `#startSlider{width:80px;flex:1 1 80px;min-width:80px;max-width:240px}` (−160)
4. `#clock` time-only `09:30:59 ET`, full stamp moved to its `title` (J3) (−36..−52)
5. `#btnAlert #alertLbl{display:none}` — icon-only, `title` retained (−38)
6. `#dateLabel` -> `09-15`, ISO kept in `#dateBtn[title]` (J2) (−27)
7. `#toolbar #speedSelect{max-width:92px}`, `#toolbar #tfSelect{max-width:72px}`, `#toolbar #chartTypeSelect{max-width:88px}` (−69)
8. `#toolbar{gap:8px;padding:4px 8px}`, `#toolbar .grp{gap:4px}`, `#toolbar .right{gap:6px}`; drop the `.grp + .grp` dividers in this band (−20)
9. **last resort only** `#btnIndicators{font-size:0}`, then `#btnMtf{font-size:0}` — `show_chart` and `grid_view` are the least guessable icons in the bar, so labels go last, not first (today `styles.css:1009` drops them first while row 1 still has a 628px hole).

`.tb-break-1{display:none}` here, and the `order:2/3/4/5` reassignments must not apply in this band so DOM order holds.

### T3 — `@media (max-width:1499px)` · TWO rows, one deliberate break

- Row 1: `D` … `R` (`order:2; margin-left:auto`)
- `.tb-break-1{display:block; order:3}`
- Row 2: `T` (`order:4; flex:1 1 auto`, `.grp.transport > *{flex:none}`) then `L` (`order:5`)

`#startSlider{flex:1 1 160px;min-width:120px;max-width:320px}` — with `.grp.transport{flex:1 1 auto}` present the slider finally absorbs row 2's 345–505px tail and pushes `L` flush right (today row 2 ends at x=923 of 1428 at 1440 — `exports/qa/sizes/1440x900_toolbar.png`).

Labels: MTF/Indicators icon-only; `#alertLbl` hidden; `#dateLabel` = `09-15`; `#modeBadge` = 12px neutral dot + `title`, its text relocated to the `#indPopover` `Source:` row (INV-1c); `#clock` time-only; `#clockPrice` / `#bboTag` hidden.

**Control size is pointer-gated, not width-gated** (finding 28): keep `:root{--tb-ctl:40px;--lb-ctl:40px;--tab-ctl:40px;--ctl:40px;--ctl-lg:46px;--ctl-xl:58px}` but inside `@media (max-width:1499px) and (pointer:coarse)`. Mouse laptops at 1280/1366/1440 stay at 32px and recover 16px of chart (measured: toolbarHeight 85 at 1500 vs 101 at 1440).

### T4 — `@media (max-width:1199px)` · still TWO rows (never three)

**Delete** `.grp.tools{order:4}`, `.tb-break-2{display:block;order:5}` and `.grp.transport{order:6;flex:1 1 100%}` (`styles.css:1046-1049`), and remove the then-dead `.tb-break-2` div (`index.html:119`). These three rules produce today's 3-row toolbar whose middle row holds 3 icons on a 1024px line (86% empty) and strands `#btnPickStart` at x=976 — `exports/qa/sizes/1024x1366_toolbar.png`, metrics `toolbarRows:3, toolbarRowTops:[4,56,108], toolbarHeight:153`.

Rows as in T3. Fit check at 1024: row 1 = 532 + 271 + gaps = 815 / 1024; row 2 = transport at the slider's 80px min (545) + tools 144 + `#btnHelp` 40 = ~729 / 1024, ~295px spare — so **`#btnHelp` stays visible** (delete `styles.css:1041`).

`#toolbar{gap:6px;padding:4px 8px}`; `#symbol{max-width:56px}`; `#toolbar #dataSelect, #toolbar #tfSelect, #toolbar #chartTypeSelect, #toolbar #speedSelect{max-width:96px}`; `#startSlider{flex:1 1 90px;min-width:80px}` so `#btnPickStart` stays adjacent to the slider instead of drifting to the row edge.

### 1024 portrait (iPad Pro 1024x1366) — `@media (max-width:1100px) and (orientation:portrait)`

Toolbar identical to T4 (2 rows, 40px controls via `pointer:coarse`). Extra: `#app{--bottom-h:46vh}` while the Dashboard tab is active, otherwise `--bottom-h:230px`. Today the P&L calendar gets 230px of a 1366px-tall screen and only the TODAY strip plus the weekday header are above the fold — `exports/qa/sizes/1024x1366_dashboard.png`.

---

## B. Vertical budget

Hard rule: the chart keeps a **240px minimum**, enforced against the *measured* toolbar height.

Bug to fix (J1): `src/app.js:272` `TOOLBAR_H = 46` and `src/app.js:283` `maxBottom = vh - TOOLBAR_H - GUTTER - BOTTOM_MIN_MAIN`. The real toolbar is 80–153px, so a dragged `rt_layout2.bottom` can squeeze the chart to 133px at 1024x768 and the value persists in localStorage. Replace with `document.getElementById('toolbar').getBoundingClientRect().height` and call `applyLayout()` from the existing resize handler so a tier change re-clamps a stored height.

| | 1280x720 | 1366x768 |
|---|---|---|
| toolbar | max **2 rows**, `pointer:fine` -> 32px controls -> **80px** (4+32+6+32+4+1) | same, **80px** |
| gutter | 6px | 6px |
| bottom default, Trades tab **empty** | **96px** (tab strip + summary line, J5) | **96px** |
| bottom default, Trades tab with rows | `min(260, 24vh)` = 172, capped 170 by `@media (max-height:800px){#app{--bottom-h:170px}}` | 184 -> 170 |
| bottom default, Dashboard tab | `max(current, 300px)`, never above `vh - toolbar - 6 - 240` -> 300 | 300 |
| chart, empty trades | 720−80−6−96 = **538 (74.7%)** | 768−80−6−96 = **586 (76.3%)** |
| chart, with trades | 720−80−6−170 = **464 (64.4%)** | 768−80−6−170 = **512 (66.7%)** |
| chart, Dashboard tab | 720−80−6−300 = **334** | 768−80−6−300 = **382** |

Today for comparison (metrics.json): 1280x720 toolbar 101 / chart 440 (61.1%) / bottom 173 holding **0 rows**; 1366x768 toolbar 101 / chart 477 / bottom 184 — `exports/qa/sizes/1366x768_full.png` shows an empty column header over dead white.

Also inside the vertical budget:

- **Popovers must scroll** (findings 10/26). `.popover` (`styles.css:660`) gains `max-height:calc(100vh - 64px); overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch`. `#indPopover` is 741px tall: at 1280x720 the Oscillator `Mode` select and the `ATR period` input are clipped and unreachable — `exports/qa/sizes/1280x720_indicators.png`, `1024x768_indicators.png`. Add `#indPopover{right:0;left:auto}` at `<=1199` so it stays inside the viewport.
- **Live P&L must never sit below the fold** (findings 9/23/40). Move the Position card (`index.html:209-211`: `.card` > `.card-h`Position > `#posBox`) to immediately **after** the BUY/SELL `.bs` row inside `.card.ord-card`, and move the Flatten / Reverse / Cancel `.btn-row` with it so the exit control travels with the P&L. Then `@media (max-height:820px)` renders `#atmEditor` (`index.html:216`, already a `<details>`) closed by default. Evidence: `exports/qa/sizes/1280x720_position_open.png` (panel cut mid `Buy Stop`, POSITION off-screen; `#side` scrollHeight 941 vs clientHeight 440), `1024x768_position_open.png`, `1366x1024_position_open.png`, `1600x900_full.png`. Add `#side{scrollbar-gutter:stable}` plus a flat NT8 scrollbar (`#side::-webkit-scrollbar{width:10px}`, thumb `var(--line)`, track `var(--bg)`) so residual overflow reads as scrollable rather than clipped. Do **not** rely on auto-scroll.

---

## C. Touch rules — 1024x1366 and 1366x1024 (both `pointer:coarse`)

Gate all of the following on `@media (pointer:coarse)` so the 1280–1499 mouse laptops are unaffected:

1. `:root{--tb-ctl:40px;--lb-ctl:40px;--tab-ctl:40px;--ctl:40px;--ctl-lg:46px;--ctl-xl:58px}` (as today, but pointer-gated instead of width-gated).
2. 44px minimum on the controls still under it (finding 18): `.qz-b{min-height:44px;padding:0 6px}` (`styles.css:837`, today ~34px — `exports/qa/sizes/1024x1366_quiz_card.png`), `.rh-end{min-height:44px;padding:0}` (`:798`, ~33px — `1024x1366_random_hud.png`), `.cal-day{height:40px}` (`:1023`), the day-detail close X `{width:44px;height:44px}` (`1024x1366_day_detail.png`, ~28px today), `.pop-row{min-height:44px}`, `.pop-row input[type=checkbox]{width:20px;height:20px}`.
3. Slider thumb: `#startSlider{height:6px}` with `#startSlider::-webkit-slider-thumb, #startSlider::-moz-range-thumb{width:24px;height:24px;margin-top:-10px}` (today 14px at `styles.css:135` / `:141`).
4. No hover-only affordances: `#indLegend .il-x{opacity:.7}` always (today `styles.css:605` is `opacity:0` until row hover, so the per-indicator remove is unreachable by finger).
5. Resize gutters get a 24px hit area with zero layout change: `.gutter{position:relative;touch-action:none}`, `.gutter.row::before{content:'';position:absolute;left:0;right:0;top:-9px;bottom:-9px}`, `.gutter.col::before{content:'';position:absolute;top:0;bottom:0;left:-9px;right:-9px}`, plus a visible 24x3px `var(--line)` grip centred on each (`index.html:157` `#gutterCol`, `index.html:237` `#gutterRow`) so the affordance survives without the title tooltip.
6. `#btnHelp` is visible (INV-1) **and** the modal earns its place on touch: add a `@media (pointer:coarse)` "Touch" column documenting drag-the-HUD, drag-the-gutter, long-press chart menu and the `#btnPickStart` crosshair. Today the modal is a pure key sheet — `exports/qa/sizes/1024x1366_help_modal.png`.
7. `#rndHud, #quizCard{right:auto;left:12px;top:44px}` so they default clear of the price axis and the newest candles (today `top:12px;right:12px` at `styles.css:780` / `:829` covers them on a 672px-wide chart — `exports/qa/sizes/1024x1366_random_hud.png`, `1024x1366_quiz_card.png`). Saved drag positions (`rt_hud_pos`, `rt_quiz_pos`) still override.
8. `.help-card{width:min(760px,92vw)}` (`styles.css:932`) so the three columns stop wrapping mid-phrase at every size; drop the dead `border-radius:5px` and the faux-3D 2px bottom border on `.help-row kbd` (`:938`).

---

## D. Contrast / leftover-hex / flat-skin fixes

**D1 — `#rndHud` (`styles.css:780-782`) and `#quizCard` (`styles.css:829-831`)**, blockers 50/51 and seed finding 6.
Set `background:var(--panel); border:1px solid var(--line);` and delete `rgba(19,23,34,.86/.9)`, both `backdrop-filter` / `-webkit-backdrop-filter`, and `border-radius:10px` (dead under `*{border-radius:0!important}` at `:1071`).
Measured on the current dark card: `.rh-round` 1.77:1, `.rh-pnl` 1.69:1 (fails even the large-text 3.0 bar), `.rh-sub` / `.rh-scale` / `.rh-meta` 1.77:1; `.qz-ask` 1.50:1, `.qz-res` 1.50:1, `.qz-tf` / `.qz-foot` / `.qz-cmp` / `.qz-sub` / `.qz-run` 2.00:1, `.qz-n` 2.93:1 — raw data `exports/qa/contrast/results.json` and `quiz_results.json`; shots `exports/qa/contrast/1920x1080_rndHud.png`, `1366x1024_quizCard.png`, `exports/qa/sizes/1366x768_random_hud.png`.
On white the existing `var(--dim)` / `var(--txt)` rules pass (7:1 / 21:1), so only these colour lines change too:

- `.rh-pnl.pos{color:var(--pos)}` / `.rh-pnl.neg{color:var(--neg)}` (`:796` — today `--green`/`--red`, which `styles.css:23` marks FILLS ONLY)
- `.rh-streak{color:var(--amber)}` (`:797`, literal `#f0b90b`)
- `.rh-end:hover{background:var(--hover);border-color:var(--neg);color:var(--neg)}` (`:799`, today `#33262a` / `#7a3640`)
- `.qz-verdict.good, .qz-chip.good{background:rgba(33,177,22,.14);color:var(--pos)}`; `.bad{background:rgba(212,6,5,.12);color:var(--neg)}`; `.miss{background:rgba(178,106,0,.14);color:var(--amber)}` — replaces the TradingView teal/red literals at `:848-858` (today `.qz-verdict.bad` 2.93:1, `.qz-chip.bad` 2.49:1, `.qz-chip.good` 4.31:1). Re-measure after D1, since these tints composite onto the card.

**D2 — `.lt-btn.active` (`styles.css:649`)**: `box-shadow:inset 0 0 0 1px #58595B` -> `border:1px solid #58595B` (the exact ring the user named). Add `border:1px solid transparent` to the base `.lt-btn` so the icon does not shift 1px on activation. Visible top-left of every full screenshot.

**D3 — `#loadingOverlay` (`styles.css:757-758`)**: drop `backdrop-filter:blur(2px)`, scrim -> `rgba(0,0,0,.35)`. `.ld-spin{border-top-color:var(--brand)}` (`:763`, literal `#f0b90b`). The `.ld-box` itself already passes at 21:1 (`exports/qa/contrast/1920x1080_loadingOverlay_forced.png`) — leave it alone.

**D4 — indicator swatches**: `index.html:49` and `:54` use `linear-gradient(90deg,#32CD32,#FF0000)` — banned by INV-2, and at 10px it reads as a brown smear next to the flat chips (`exports/qa/sizes/2560x1440_indicators.png`). Replace with `<span class="ind-swatch duo"><i></i><i></i></span>` and `.ind-swatch.duo{display:inline-flex;width:12px;height:10px} .ind-swatch.duo i{flex:1} .ind-swatch.duo i:first-child{background:var(--green)} .ind-swatch.duo i:last-child{background:var(--red)}`.

**D5 — toolbar accent text on `--bg` #E6E7E8**: `#symbol` and `#modeBadge` in `--brand` #CC4400 = 3.86:1; `#alertLbl` in `--amber` #B26A00 = 3.42:1 (finding 53). Keep `--brand` for fills/borders/active states, and darken the text usage: `#symbol{color:var(--brand-hi)}` (#A63700, already declared at `styles.css:21`), `#alertLbl{color:var(--txt)}`.

**D6 — fill tokens used as text/icon colour**: `#bboTag > span` bid 2.30:1 / ask 4.43:1, and the leftbar `#annLong` / `#annShort` icons 2.30:1 / 4.43:1 (findings 54/56). Swap `--green` / `--red` -> `--pos` / `--neg` in those rules.

**D7 — `.mode-badge` (`styles.css:911-913`)**: de-shout it — `background:var(--panel2); border:1px solid var(--line); color:var(--dim);` plus a 6px `var(--brand)` `::before` dot. Delete the `#modeBadge{font-size:0;width:10px}` hack (`:1026`). Text `TBBO` / `15s` at >=1500; 12px dot + `title` below; and a permanent `Source: TBBO · NT` row at the top of `#indPopover` so the information is reachable on touch where tooltips are not.

**D8 — white-on-green BUY**: `#btnBuy > .bs-t` and `.bs-s`, and `.qz-b.buy`, are white on `--pos` #21B116 = 2.85:1 (finding 52; SELL on `--neg` passes at 5.49:1). Add `--pos-btn:#178A0E` and use it for those button fills only; leave `--pos` unchanged for text and thin accents.

**D9 — hover states that are dead or wrong on white**: `.tv-table tbody tr:hover{background:rgba(255,255,255,.03)}` (`:387` — invisible, so the trades grid has no hover at all) and `#indLegend .il-row:hover{background:rgba(30,35,41,.86)}` (`:603` — a near-black block over the white chart). Both -> `var(--hover)`.

**D10 — active-state collision on `#btnRandom` / `#btnQuiz`** (`styles.css:767` / `:828`): `button.active` (`:240`) already sets `background:var(--brand);color:var(--on-brand)`, and these later, higher-specificity rules reset only `color:var(--brand)`, producing a featureless orange square (`exports/qa/sizes/crit_tbrnd_1920x1080.png`, `1920x1080_quiz_card.png`). Adopt the `#btnIndicators.active` pattern (`:658-659`): `background:var(--brand);border-color:var(--brand);color:var(--on-brand)` plus the `.material-symbols-outlined{color:var(--on-brand)}` twin.

**D11 — dead fallbacks** (no visual change, they just hide the theme): remove `var(--amber,#f0b90b)` (`:150`), `var(--accent,#2962ff)` (`:436`), `var(--accent,#fcd535)` (`:696`).

**D12 — `#startSlider` must read as a slider** (findings 22/36): today `styles.css:129` paints `background:var(--panel2)` + `border:1px solid var(--line)` on the element while `:957` (`#toolbar input[type=range]{height:var(--tb-ctl)}`) stretches that box to 32/40px, so it looks like an empty text field with one orange dot in it. Change to `#startSlider{background:transparent;border:0;height:var(--tb-ctl);padding:0}` and add `#startSlider::-webkit-slider-runnable-track, #startSlider::-moz-range-track{height:4px;background:var(--panel2);border:1px solid var(--line)}`, with the existing thumb re-centred via `margin-top:-6px`. Delete the dead `border-radius:999px` (`:132`).

**Explicitly NOT a leftover — `#posBox .pos-pnl` stays black** (`styles.css:924-926`, comment at `:259`): deliberate NinjaTrader BasicEntry fidelity. Do verify that `app.js` applies `.pnl-pos` / `.pnl-neg` to that element — the −$15.00 renders plain white rather than LavenderBlush in `exports/qa/sizes/1920x1080_position_open.png`; if the class is missing, fold the colours in as `#posBox .pos-pnl.neg{color:#FFF0F5}` (J6).

---

## E. Dashboard and misc (same pass, lower priority)

- `#pnlCalendar{max-width:1100px;margin:0 auto}` and `.pc-day{aspect-ratio:7/5;height:auto}` — at 2560 a day cell measures 357x56 (6.4:1) with the number floating against 350px of nothing (`exports/qa/sizes/2560x1440_dashboard.png`, `crit_dash_2560x1440.png`). Same treatment for the TODAY strip via an inner `max-width:1280px;margin:0 auto` wrapper.
- Empty Trades tab: centred `var(--dim)` line "No trades yet — press B / S to take one" so the collapsed 96px panel is explained rather than blank (`exports/qa/sizes/1920x1080_full.png`).
- Icon semantics swap (finding 33): `#btnHelp` glyph `keyboard` -> `help`, `#btnQuiz` glyph `quiz` (a boxed `?`) -> `psychology`. Today the button that looks like help is the quiz (`index.html:103-104`). Keep both `title` attributes — they are the only labels these icon-only buttons have.

---

## F. Non-goals (do not do these)

1. **No new dependencies, no build step, no framework.** CSS plus the six small JS edits listed below, nothing else.
2. **No JS layout engine / ResizeObserver-driven toolbar.** Tiers stay pure CSS media queries. JS only: (J1) measure the toolbar for the layout clamp and re-clamp on resize; (J2) write `09-15` below 1500 and keep the ISO date in `#dateBtn[title]` (`src/app.js:2996`); (J3) write the time-only clock below 1800 with the full stamp in `title`; (J4) write the short badge text + `title` and hide `#clockPrice` while `#bboTag` is visible; (J5) content-aware bottom-panel height (`src/app.js:277` `autoBottomH`, `:289` `applyLayout`); (J6) wire `.pnl-pos` / `.pnl-neg` onto `.pos-pnl`.
3. **No re-theming of the chart, the order panel or the NT8 palette** beyond the token swaps in section D. `--brand` #CC4400, `--bg` #E6E7E8, white chart and square corners all stay.
4. **Do not reinstate any dark surface**, and do not "fix" the deliberately black `#posBox .pos-pnl`.
5. **Do not remove or gate Random / Quiz / MTF / Settle features** to save room — INV-1 governs; use the overflow menu instead.
6. **No responsive work below 1024px** and none above 2560px.
7. **No git commit, no push, no dependency on a rebuilt server** — verification is Playwright from `D:\SIPs` against `http://127.0.0.1:5560/`.
8. **No screenshots written outside** `D:\Tools\replay-trainer\exports\qa\sizes\`.

---

## G. Acceptance (re-run the same 10 sizes and the same view list)

1. `toolbarRows == 1` at 2560, 1920, 1800, 1600, 1500 — the 1600 case is the user's own window and the original rejection.
2. `toolbarRows == 2` at 1440, 1366x768, 1366x1024, 1280, 1175, 1024x768, 1024x1366. Never 3.
3. `hiddenControls` empty at every size (no `display:none (css)` entries; `#btnSettleNow` state-hidden excepted).
4. `grep -nE 'box-shadow|text-shadow|backdrop-filter|linear-gradient' src/styles.css` returns nothing.
5. Chart height >= 240px at every size after seeding `localStorage.rt_layout2 = {bottom:9999,bottomUser:true}`.
6. `#indPopover` bottom edge <= viewport height, or the popover scrolls, at 1280x720 and 1024x768.
7. `#posBox` `visible:true` after pressing `b` at 1280x720, 1366x768, 1440x900, 1600x900 and 1024x768.
8. Contrast: every text node inside `#rndHud` / `#quizCard` >= 4.5:1 (>= 3.0 for >=24px text), and the `#btnBuy` label >= 4.5:1.
9. `#dateLabel` shows `09-15` (no ellipsis) at every size <= 1499, and `#modeBadge` is either readable text or a deliberate 12px dot — never a text-less sliver.
