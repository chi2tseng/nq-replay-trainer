# Drawing architecture codemap — for adding Trend Channel (3-pt) + a Trend Line hotkey (F2)

Scope: read-only mapping. src/app.js is 4262 lines; index.html 339; tests/tv_drawing_matrix.mjs 814.
All line numbers verified by direct Read/Grep this session (2026-09-26).

## 1. Tool registry / activation
- `TOOLBTN` map (id -> DOM button id): **app.js:1739** — every tool must have an entry here (drives `updateToolUI` highlighting).
- `LINE_TOOLS` map (id -> [material-icon, tooltip incl. hotkey text]): **app.js:1759** — drives the `#drwLines` flyout group icon/title AND `syncLinesGroup()`. A channel tool is NOT itself a "line" in TV's own grouping (TV puts Trend Channel in a separate "Trend Line tools" flyout distinct from the plain Lines flyout), so decide whether to add it here or to a new group — see §7.
- `updateToolUI()` **app.js:1764**, `setTool(t)` **app.js:1765** (toggles `tool`, clears `pendingPt`/`previewXY`, repaints) — generic, no per-type change needed.
- `syncLinesGroup()` **app.js:1761** — reflects `lastLineTool` into `#drwLines` icon.

## 2. Click handling — 2-point tool flow
- `chart.subscribeClick` **app.js:1881-1891**: routes bar-bound tools (start/annotations) vs free {t,p} tools -> `handleDrawClick(tool, time, price, y, sourceEvent)`.
- `handleDrawClick(t, time, price, y, ev)` **app.js:1466-1487**:
  - magnet snap first (line 1467).
  - Shift-constrain 2nd point, gated by `SHIFT_TOOLS[t]` (line 1368: `{tl:1, ray:1, box:1, fib:1, measure:1}`) — **a 3-point tool needs its own handling**; Shift-constrain as coded only fires on the *second* click (arms `pendingPt` then constrains before the 2nd point is stored) and has no notion of a 3rd click.
  - `snapshot()` (undo) fires on any branch that is about to push a drawing, or when `pendingPt` is already set (line 1472).
  - One-click types (`hl`, `vline`, `hray`/`cross`, `rr`) each have a dedicated `if` that pushes a drawing and returns (lines 1473-1483).
  - **Generic 2-point fallback** (lines 1484-1486): `if (!pendingPt) { pendingPt = {t,p}; return; }` then on the 2nd click `drawings.push(newDrawing({type:t, p1:pendingPt, p2:{...}, color}))`, clears `pendingPt`, selects, saves, repaints, `resetToolAfterDraw()`.
  - **This fallback is 2-point only.** A 3-point Trend Channel (anchor line p1->p2, then a 3rd click sets the parallel channel width) needs a NEW branch before line 1484, using a second pending-state variable (e.g. `pendingPt2`) since `pendingPt`/`previewXY` are single-slot globals (app.js:1640, 1732). This is the single largest gap for a 3-point tool.
- `resetToolAfterDraw()` **app.js:1629** — generic, fine as-is (reverts tool unless Keep-drawing is on).
- Rubber-band preview during placement: `$('chart').addEventListener('pointermove', ...)` **app.js:1957-1973**, specifically lines 1959-1963 — only tracks ONE `previewXY` off ONE `pendingPt`. A 3-point tool's preview after the 2nd click (channel width following the cursor) is not representable with the current single pendingPt/previewXY pair; needs its own preview state or a generalized array.
- Primitive-level preview render (draws the rubber band while `pendingPt && previewXY`): **app.js:1310-1326** inside `drawingsPrimitive`. Only handles line/box/ray/fib/measure previews by `tool` name — a channel preview branch must be added here too (both the 2nd-click segment preview AND, ideally, a 3rd-click parallel-offset preview, which the current pendingPt/previewXY model can't carry — see above).

## 3. Rendering (drawingsPrimitive draw branches)
All in `drawingsPrimitive.paneViews()[0].renderer().draw` **app.js:1249-1334**, main per-type dispatch **app.x.js:1262-1283**:
- one-point types (`hl`/`vline`/`hray`/`cross`): 1266-1269 (early `continue`).
- `fib` -> `drawFib()` (defined app.js:1524), `measure` -> `drawMeasure()` (app.js:1549), `rr` -> `drawRR()` (app.js:1587): 1270-1272.
- generic 2-point x1/y1/x2/y2 else-if chain: **1273-1282** — `box` uses `boxRect()` (app.js:1350); **else** (`tl`/`ray`) uses `tlSeg()` (app.js:1343, Extend geometry) + optional `arrowHead()` (app.js:1354). **A Trend Channel would need a new `else if (d.type === 'channel')` branch here** that (a) draws the tl/ray-style main segment via `tlSeg()`, and (b) draws a second parallel segment offset by the stored channel width (perpendicular offset in price, or simple y-offset — TV's channel keeps the offset in price units so it stays a constant vertical distance regardless of zoom), reusing `applyStyle`/dash logic already active on `ctx`.
- Handle points for hover/selection (`hpts` closure): **app.js:1286-1293** — enumerates per-type anchor points; a channel has 3 logical anchors (p1, p2, p3-offset point) and must be added here or its own handles will not draw/select correctly (falls through to the generic `[p1, p2]` case at line 1290 otherwise, silently dropping the 3rd handle).
- `tlSeg(d,...)` **app.js:1342-1349**: shared Extend geometry helper for `tl`/`ray` — reusable by a channel's two rails if the channel adopts the same `extend` field.
- `rayEnd()` **app.js:1336-1341**: shared edge-extrapolation helper, reusable.
- `arrowHead()` **app.js:1354-1357**: reusable if channel rails get optional arrows (probably not needed — TV's Trend Channel does not draw arrowheads).

## 4. Hit-testing / handles / dragging
- `drawingHandles()` **app.js:1771-1796**: builds the draggable-anchor list. Per-type branches for `hl`/`vline`/`rr`, else generic p1/p2 (+ box cross-corners at 1790-1793). **A channel needs a branch here** exposing 3 handles: p1, p2 (the trend-line anchors) and a 3rd handle for the channel-width offset point, each with its own `apply(t,p)` closure that writes back into the drawing's own fields (e.g. `d.p1`, `d.p2`, `d.offset` or a `d.p3` point).
- `nearestHandle(x,y)` **app.js:1866-1870**: generic nearest-handle search over `drawingHandles()` output — no change needed once handles are registered.
- `drawingAt(x,y)` **app.js:1803-1829**: body hit-test for select/hover, per-type branches; `tl`/`ray` fall into the generic segment-distance test at the bottom (1824-1826) using `tlSeg()`. **A channel needs a branch** testing distance to BOTH rails (main line via `tlSeg`-like geometry + the offset parallel line), or it will not be selectable by clicking the second rail.
- `drawingFields(d)` **app.js:1831-1839**: enumerates movable {obj,key,kind} fields for whole-body move/nudge (used by `startBodyDrag`/`moveBody`/`nudgeSelection`/paste-shift). Generic fallback at 1836-1838 pushes p1.p/p1.t/p2.p/p2.t — **a channel's 3rd point (or stored offset) must be added here too**, or dragging the body / arrow-key nudge / paste will move the two rails but leave the channel width's backing field stale.
- `startBodyDrag(ds,x,y)` **app.js:1842-1845** and `moveBody(x,y,shiftKey)` **app.js:1847-1856**: generic, operate purely through `drawingFields()` — no per-type change needed once fields are registered, PROVIDED the offset is stored as a `{t,p}`-shaped field (kind:'p' style) rather than a raw scalar; a raw scalar offset (e.g. `d.channelWidth` in price units) is simplest for rendering but then must be migrated manually during body-drag (price delta) the same way `rr`'s `stop`/`target` are handled as extra `kind:'p'` fields (see line 1835 `rr` pattern — same pattern applies to a channel's width field).
- Pointerdown/pointermove/pointerup chart handlers (anchor drag vs body drag vs new-tool click dispatch order): **app.js:1892-1956**. No tool-specific code here — generic once handles/hit-test/fields cover the new type.

## 5. Floating toolbar + Settings panel (Style / Coordinates / Visibility tabs)
- `#drawToolbar` DOM placement: `placeDrawToolbar(bb,W,H)` **app.js:1977-1992** — generic, driven by the handle bbox computed in the renderer (§3); no type-specific code.
- `initDrawToolbar()` **app.js:2003-2016**: wires color/width/dash/lock/delete/settings buttons on the floating toolbar — generic (`setDrawingStyle`, `deleteSelectedDrawing`, `openDrawSettings`), no per-type change needed.
- `openDrawSettings(d, tab)` **app.js:2056-2084**: builds the settings panel HTML.
  - Style tab: base color/width/dash always shown (2063-2065); **type-specific extras** at 2066 (`tl`/`ray`: Extend select + arrow checkboxes), 2067 (`box`: extend/middle-line), 2068 (`fib`: level checkboxes + reverse/extend). **A channel needs its own `if (d.type === 'channel') style += ...` block** — likely an Extend select (reuse `tl`/`ray`'s pattern if the channel supports Extend) and maybe a "swap rails" or width-lock option depending on desired parity with TV.
  - Coordinates tab: per-type branches at 2070-2073 (`hl`, `vline`, `rr`, generic point-1/point-2 else). **A channel needs a 3rd coordinate group** (its offset point or width value) added to this `coords` string, following the `pt(name, obj, hasT, hasP)` helper pattern (line 2062).
  - Visibility tab (2074-2075): generic, per-timeframe checkboxes — no change needed.
- `applyDrawSetting(d,k,v)` **app.js:2085-2094**: dispatches on the `kind` prefix of the `data-k` attribute (`s:`=style, `d:`=type-specific field, `p:`/`t:`=point coords, `fib:`/`v:`/`tf:`=fib/visibility). A channel's new fields (extend, offset) flow through the existing `d:`/`p:`/`t:` kinds automatically once the settings HTML (above) emits inputs with the right `data-k`.

## 6. Storage / migration / undo
- `drawings` array shape comment: **app.js:1726** — the type union comment (`'hl'|'tl'|'ray'|'box'|'fib'|'measure'|'rr'|'hray'|'vline'|'cross'`) should be extended with the new type name for documentation parity (cosmetic but every other type is listed there).
- `newDrawing(d)` **app.js:1729**: assigns `style`/`locked`/`hidden`/`z`/`visibleTFs`/`id` defaults — generic, works for any `d.type` unchanged.
- `migrateDrawings(arr)` **app.js:1730**: back-fills old-format drawings — generic, no per-type code; a channel drawn under the new build never needs migration (it's created with `newDrawing()` from day one).
- `rt_drawings` persistence: every mutation site calls `saveJSON('rt_drawings', drawings)` — already generic across types (search hits at app.js:1473-1486, 1496, 1692, 1710, 1723, 1864, 1947, 1951, 1954, 2001, 2009, 2094 etc.) — no new save-site needed for a channel specifically.
- Undo/redo snapshots: `snapshot()` **app.js:1688**, `undo()`/`redo()` **app.js:1694-1695**, `restoreSnapshot()` **app.js:1690-1693** — all operate on the whole `drawings` array as JSON, type-agnostic. The channel's new tool only needs to call `snapshot()` at the right moment in its own click-handler branch (mirroring line 1472's `if (pendingPt || t === '...') snapshot();` condition, which must be extended to include the channel's tool id at each of its 1st/2nd/3rd click stages).

## 7. Toolbar HTML / lines flyout wiring
- `#drwLines` (icon button, shows last-used *line* tool) + `#btnLinesMenu` (chevron opening `#linesPopover`): **index.html:128-129**.
- `#linesPopover` rows (`#drwTL`, `#drwRay`, `#drwHL`, `#drwHRay`, `#drwVLine`, `#drwCross`): **index.html:304-312**. TV's real toolbar keeps "Trend Channel" in the SAME flyout group as Trend Line/Ray/Parallel Channel ("Lines" tools in TV terminology includes Trend Line, Ray, Info Line, Extended Line, Trend Angle, Horizontal Line, Horizontal Ray, Vertical Line, Cross Line, plus a separate "Channels" section with Parallel Channel/Regression Trend/Flat Top-Bottom). Given this app's existing `#linesPopover` already mixes trend-line-family + one-point tools in one flyout, the simplest ponytail-consistent placement is **adding a new `<button id="drwChannel" class="pop-row" data-icon="..."> ... Trend Channel ... </button>` row inside the existing `#linesPopover`** (index.html, after line 307's Ray row), rather than building a whole second flyout group — but this is a UX call, not an architecture constraint.
- `initLeftbarMenus()` **app.js:2036-2052**, specifically the `wire('btnLinesMenu', 'linesPopover', Object.keys(LINE_TOOLS).map(...))` call at **app.js:2046** — this auto-generates the flyout's click handlers FROM `LINE_TOOLS` keys, so **if `channel` is added to `LINE_TOOLS` (§1) the flyout row's click-to-arm wiring is automatic**; only the HTML row itself (`#drwChannel` markup + icon) must be hand-added to `index.html` to match a new `LINE_TOOLS.channel` entry's `TOOLBTN.channel` id.
- Button click wiring block for all other tool buttons: **app.js:4070-4086** (`$('drwHL').onclick = () => setTool('hl')` etc.) — if Trend Channel gets its own always-visible leftbar button (not just a flyout row) it needs a line here too; if it's flyout-only, the generic `wire()` call above already covers it and no line here is required.

## 8. Keydown handler — hotkey placement (F2 for existing Trend Line; new hotkey for Channel)
Full handler: **app.js:4186-4223**. Order matters — read top to bottom:
1. Line 4187: bails out entirely while focus is in an `<input>`/`<select>` (already correct — F2/Alt+T should not fire while e.g. editing the ATM editor's numeric fields).
2. Line 4188: `k` = lowercase single char OR the raw `e.key` for named keys (Escape, ArrowLeft, Delete, F2, etc. all pass through as-is since they're not length-1).
3. Line 4189: Space (step-bar) — unrelated.
4. **Ctrl/Cmd modifier block: 4191-4199** — `return` at 4198 unconditionally swallows every remaining Ctrl+<key> combo so it never reaches the plain-letter branches below (undo/redo/copy/paste live here). Existing standing decision says trading hotkeys must never fire from a drawing hotkey — this block already enforces that direction (Ctrl+anything never falls through to `b`/`s`/`f`/`j`/`x`).
5. **Alt modifier block: 4200-4209** — this is where the *existing* Alt+T / Alt+H / Alt+J / Alt+V / Alt+C / Alt+F / Shift+Alt+R tool hotkeys live (each does `e.preventDefault(); return setTool(...)`), and it unconditionally `return`s at 4208 for any other Alt-combo, so — like the Ctrl block — it already can never leak into the trading letters below.
6. **Plain-letter block: 4210-4222** — this is where B/S/F/J/X trading hotkeys live (4211-4215), plus Escape/Delete/arrows/`[`/`]`/`0`/`?`.
- **F2 for Trend Line**: F2 is a *named* key (`e.key === 'F2'`), so `k` at line 4188 passes through unchanged as `'F2'` (not lowercased, since `.length !== 1`). It does **not** collide with any existing modifier block (F2 has no Ctrl/Alt), so it must be added as a **new top-level check inside the plain-letter block** (anywhere in 4210-4222, before the final `else if (e.key === 'Escape')` catch-all, e.g. as a new `else if (k === 'F2') { e.preventDefault(); return setTool('tl'); }`) — mirroring the existing Alt+T behavior. **Verify first that F2 is not already claimed by the browser or OS** (Playwright/Chromium: F2 has no default browser action, so `e.preventDefault()` is only a safety net, not a required override).
- **A new Ctrl+2 (or whatever key is chosen) for Trend Channel**: `Ctrl+2` falls inside the **Ctrl/Cmd modifier block (4191-4199)**, so the new check must be added there, BEFORE the unconditional `return` at line 4198 — e.g. `if (k === '2') { e.preventDefault(); return setTool('channel'); }`. This block already blanket-returns for `e.altKey` (line 4193) so `Ctrl+Alt+2` would need its own explicit carve-out ahead of that line if that combo is ever wanted; a bare `Ctrl+2` is unambiguous and safe to add.
- `HELP_KEYS` **app.js:4228-4234**: the in-app "?" help sheet's data — the `'Drawing tools'` group (line 4232) currently lists `Alt+T` etc.; **both new hotkeys (F2 for Trend Line, Ctrl+2 for Trend Channel) must be added as new tuples in this array** or the shortcut will be invisible to the user in Help (this is purely a data-table edit, no logic).

## 9. Test helpers (tests/tv_drawing_matrix.mjs) — must extend, must not break
- `clickTool(sel)` **line 51**: clicks a tool button by CSS selector; auto-opens `#linesPopover` first if the target button lives inside it (checks `e.closest('#linesPopover')`). Works unchanged for a new `#drwChannel` row placed inside `#linesPopover` — no helper change needed for that placement.
- `clickChart(x,y,mods,button)` **line 50**: single click at chart-relative coords, optional modifier keys held during the click, 650ms settle wait.
- `drawTL(x1,y1,x2,y2,mods2,tool='drwTL')` **line 58**: 2-click helper (`clickTool` then two `clickChart` calls) — parameterized by `tool` selector so it already works for any 2-point tool by passing e.g. `tool:'drwRay'`. **For the 3-point channel this helper is insufficient as-is** — a new helper (e.g. `drawChannel(x1,y1,x2,y2,x3,y3,tool='drwChannel')`) doing 3 `clickChart` calls is needed; do not repurpose `drawTL` by adding an optional 3rd point parameter without checking every existing call site (52 PASS tests currently call `drawTL` with its current 2-point signature — grep confirms no call sites pass a tool other than the default plus a couple explicit ones; changing its signature risks silently breaking a call that expects exactly 2 clicks).
- `n()` **line 59**, `geomOf(i)` **line 57**, `seed(list)` **line 55**, `clear()` **line 56**: generic, `geomOf` reads `d.p1`/`d.p2`/`d.stop`/`d.target`/`d.color` only — **a channel's 3rd point/offset field is NOT read by `geomOf`**; any new assertions on channel geometry in a future test need either a `geomOf` extension (new optional fields) or a separate ad-hoc `page.evaluate`.
- `key(combo)` **line 60**: `page.keyboard.press(combo)` wrapper — usable as-is for asserting `F2` arms `tl` and `Ctrl+2` (Playwright combo string `'Control+2'`) arms `channel`.
- Existing 52/52 PASS suite must stay green: none of the read-only registries above (`TOOLBTN`, `LINE_TOOLS`, keydown handler additions) remove or rename any existing key/branch, so no existing G-numbered assertion is at risk PROVIDED the new Ctrl block addition is inserted before, not instead of, the existing checks at app.js:4194-4197, and the new Alt/plain-letter addition (F2) does not reuse a key already handled in that block (`p`,`b`,`s`,`f`,`j`,`x`,`[`,`]`,`0`,`?`,Delete,Escape,Arrow* — `F2` is clear of all of these).

## 10. Full checklist — every place a new type ("channel") must be registered
1. `TOOLBTN` (app.js:1739) — DOM id mapping.
2. `LINE_TOOLS` (app.js:1759) — if placed in the lines flyout (recommended); drives flyout icon + auto-wiring at app.js:2046.
3. `SHIFT_TOOLS` (app.js:1368) — decide if Shift-constrain should apply to the channel's 2nd click (probably yes, same as tl).
4. `handleDrawClick` (app.js:1466-1487) — new 3-click branch; needs a second pending-point slot (new global, not reusing `pendingPt`).
5. Rubber-band preview: pointermove handler (app.js:1959-1963) + primitive-level preview draw (app.js:1310-1326) — both assume single pendingPt/previewXY; need extension for a 3rd-click channel-width preview.
6. `drawingsPrimitive` renderer dispatch (app.js:1273-1282) — new render branch (2 parallel rails).
7. `hpts()` handle-point enumerator (app.js:1286-1293) — 3rd anchor point.
8. `drawingHandles()` (app.js:1771-1796) — 3rd draggable handle + apply() closures.
9. `drawingAt()` hit-test (app.js:1803-1829) — test against both rails.
10. `drawingFields()` (app.js:1831-1839) — 3rd movable field for body-drag/nudge/paste-shift.
11. `openDrawSettings()` Style tab (app.js:2066-2068 area) — Extend / other options.
12. `openDrawSettings()` Coordinates tab (app.js:2070-2073 area) — 3rd point row.
13. `drawings` type-union doc comment (app.js:1726) — cosmetic.
14. Toolbar HTML: new `#drwChannel` row in `#linesPopover` (index.html, near line 307).
15. Keydown handler: F2 -> `setTool('tl')` in the plain-letter block (app.js ~4210-4222); Ctrl+2 -> `setTool('channel')` in the Ctrl block before its line-4198 `return` (app.js 4191-4199).
16. `HELP_KEYS` (app.js:4228-4234) — document both new hotkeys.
17. `index.html` / `src/app.js` `?v=` cache-bust bump (index.html references `src/app.js?v=153` and `src/styles.css?v=140` — bump both version query strings on any edit, per project rule).
18. Tests: new `drawChannel()` helper + new G-numbered assertions in tests/tv_drawing_matrix.mjs; run full 52+N suite and confirm still green before calling it done.

## Open questions / not verified
- Whether "Trend Channel" should store its 3rd point as a raw price-offset scalar (simplest for rendering, matches how `rr`'s stop/target are handled) or as a full `{t,p}` third point (more flexible, lets the channel's parallel line tilt independently — NOT how TradingView's Trend Channel behaves; TV keeps the second rail strictly parallel, offset only in price) — **not verified against TradingView's live behavior in this session** (no web access used; this codemap is a static-code read, not a TV behavior study). Confirming exact NT8/TV Trend Channel interaction semantics (parallel-only vs free 3rd point, whether width is adjustable after the fact via drag) needs a live NT8/TV reference check before implementation, per the parent task's own instruction to research NT8's actual Ctrl+2 behavior.
- Exact icon choice for `#drwChannel` (Material Symbols) — not decided here; existing rows use `show_chart`/`north_east`/`horizontal_rule`/etc., no obvious pre-existing "channel" icon confirmed available in the Material Symbols set used elsewhere in this file (not verified — would need to check the Material Symbols font subset actually loaded by this page).
- Whether Ctrl+2 collides with a browser/OS default in the target browser — not verified (no live browser check performed this session; Playwright test should assert `e.defaultPrevented` behavior).
