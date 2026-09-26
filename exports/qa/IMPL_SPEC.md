# IMPL_SPEC: NT8 Trend Channel (Ctrl+2), F2 Line, guideline fixes, visual pass

2026-09-26. One spec, three sections, each an ordered list of exact edits followed by acceptance checks.
Inputs: `exports/NT8_TRENDCHANNEL_SPEC.md`, `exports/qa/DRAWING_CODEMAP.md`, `exports/qa/DESIGN_PLAN.md`, the WIG audit (8 findings) and the browser-hotkey research.
All line numbers below were re-read this session in `src/app.js` (4262 lines), `src/styles.css` (1189), `index.html` (339). Edit **bottom-up inside each file** so earlier line numbers stay valid. If a number has drifted, anchor on the quoted old text.

**Conflict order used:** standing user decisions > NT fidelity > web interface guidelines > design plan.
**Cache bust:** `index.html:8` `styles.css?v=140` → `?v=141`; `index.html:337` `app.js?v=153` → `?v=154`. Bump them again on every later edit.
**Do not touch:** `scripts/import_nt_db.py`, `scripts/nt_restart_import.ps1`. Keep every existing id and handler. Do not commit.

**Baseline measured this session:** `tests/tv_drawing_matrix.mjs` → **50 PASS / 2 FAIL / 0 SKIP of 52**. That was run before any edit in this spec, so the brief's "52/52" claim was already stale. Acceptance for every section: **no new FAIL** relative to that baseline. The two failing rules (G12 and G17, present before any edit) are listed in §D.

---

## A. Drawing: NT8 Trend Channel (`channel`) + F2 / Ctrl+2

### A.0 Behaviour contract (what "NT-exact" means here)

| Aspect | Behaviour to build | Source / confidence |
|---|---|---|
| Placement | 3 clicks and no drag. Click 1 = trend start (p1), click 2 = trend end (p2), click 3 = a point the parallel line passes through (p3 = `ParallelStartAnchor`) | NT API [OFFICIAL] |
| Parallel rail | Drawn from p3 to p3 + (p2 − p1), computed in pixel space at paint time so it stays parallel and the same length at any zoom. No 4th stored point | [OFFICIAL] (the API has no ParallelEndAnchor) |
| Preview | Clicks 1→2: rubber-band trend line to the cursor (same as `tl`). Clicks 2→3: solid trend line plus a live parallel rail whose start follows the cursor | inferred from the general NT tool mechanism; **not verified** for Trend Channel specifically |
| Shift | Constrains click 2 to 45° steps, same as `tl`. It does nothing on click 3 | [OFFICIAL] for line tools; click 3 **not verified** |
| Snap | The existing magnet (off/weak/strong, Ctrl inverts) applies to all 3 clicks and to handle drags | standing decision beats NT Snap Mode |
| Fill | **None** | inferred from the official interface (no AreaBrush); **not visually verified** |
| Middle line | **None by default.** Optional Levels in % of the channel (50 gives a midline) | [FORUM] no midline; Levels [OFFICIAL] |
| Extend | Default none, meaning finite segments. An Extend none/left/right/both select applies to both rails and the levels | NT Line has Extend [BLOG]; for Trend Channel it is **not verified**. Additive and off by default |
| Handles | 6 drawn: p1, p2 and the trend midpoint; p3, p4 and the parallel midpoint | [FORUM] ×2 |
| Drag p1 (L1A1) | Moves p1 and carries p3 by the same Δlogical/Δprice, so the offset vector stays fixed. Both rails rotate or resize together | [FORUM] says "in sync". The carry-p3 detail is **not verified** (see open questions) |
| Drag p2 (L1A2) | Moves p2 only. The parallel end follows because it is derived | [FORUM] |
| Drag p3 (L2A1) | Moves the parallel rail only (width/offset). The trend line does not change | [FORUM] |
| Drag mid / p4 | Translates the whole channel. This is the body drag, so they are not registered as anchor handles | [FORUM] |
| Esc / right-click while placing | Cancels the in-progress draw with no drawing and no undo entry. Right-click cancel applies to **every** tool | [OFFICIAL] |
| After placement | Returns to the cursor unless Keep drawing (= NT "Stay in Draw Mode") is on | [OFFICIAL] |
| Colour default | `#000000` 1.5px solid (the same default as `tl`; 21:1 on the white chart). NT's own default brush is **not verified** (search found nothing citable) | — |
| Handle look | The existing app look stays: white on hover, `#6495ED` when selected. NT draws plain white circles | standing decision (TV-matching drawing tools) beats NT |

**NT vs TradingView: where they disagree for this tool, and what we build**

1. TV's Parallel Channel fills the band and draws a dashed midline by default. **NT: no fill, no midline.** We build NT.
2. TV sets channel width with its 3rd point but keeps the parallel start at p1's time. **NT stores a full (time, price) ParallelStartAnchor**, so the parallel rail can be shifted along the time axis as well. We build NT: p3 is a full {t,p}.
3. TV handles: the parallel rail's two ends drag width. **NT: only L2A1 (p3) is a real anchor.** L2A2 and both mids translate the whole object. We build NT.
4. Hotkey: TV has no default for its channel. **NT: Ctrl+2.** We build Ctrl+2, plus a fallback (A.2).
5. Snap: TV uses a weak/strong magnet; NT uses 5-state Snap Mode. **Here the standing decision wins and the magnet stays.** This is the only NT deviation, and it is recorded in HELP.
6. Handle look: see the last row of the table above (standing decision).

### A.1 `src/app.js` edits (bottom-up order)

1. **`window.__rt.drawingsList` (≈4251)**. Old: `drawingsList: () => drawings.map(d => ({ type: d.type, p1: d.p1 && { ...d.p1 }, p2: d.p2 && { ...d.p2 } })),`
   New: `drawingsList: () => drawings.map(d => ({ type: d.type, p1: d.p1 && { ...d.p1 }, p2: d.p2 && { ...d.p2 }, p3: d.p3 && { ...d.p3 }, levels: d.levels })),` (test hook only).
2. **`HELP_KEYS` 'Drawing tools' row (4232)**. Old first tuple: `['Alt+T', 'Trend line'],`. New: `['Alt+T · F2', 'Trend line'], ['Ctrl+2 · Alt+2', 'Trend channel (3 clicks)'],`.
   Also add to the 'Drawings' row (4231): `['Right-click (placing)', 'Cancel the drawing']`.
3. **Keydown plain-letter block (4210/4211)**. Insert a new line between 4210 (arrow nudge) and 4211 (`if (k === 'p') ...`):
   `if (k === 'F2') { e.preventDefault(); return setTool('tl'); }   // NT8 default: F2 = Line`
   It is placed before the trading letters and returns, so it can never reach B/S/F/J/X.
4. **Keydown Alt block (4200-4208)**. Insert before `return;   // Alt+<anything else>` (4208):
   `if (e.code === 'Digit2') { e.preventDefault(); return setTool('channel'); }   // fallback: Chromium swallows Ctrl+2 in a normal tab`
   Use `e.code`, so the check does not depend on the keyboard layout. On Windows, Chrome binds tab switching to Ctrl+1..8, not Alt+digit. Whether Alt+2 is free on Linux/ChromeOS is **not verified**.
5. **Keydown Ctrl block (4191-4198)**. Insert after the `if (e.altKey) return;` line (4193) and before `if (k === 'z')`:
   `if (e.code === 'Digit2') { e.preventDefault(); return setTool('channel'); }   // NT8 default Trend Channel; reaches the page only in an app window (no tab strip) or never in a plain Chrome tab`
   It sits before the block's final `return` (4198), so trading letters stay unreachable.
6. **One-time Ctrl+2 hint**. Add directly under `function setTool` (1765):
   ```js
   function ctrl2Hint() {   // Ctrl+2 never reaches a page in a normal Chromium tab (browser tab-switch accelerator); tell the user once
     if (loadJSON('rt_hint_ctrl2', false) || matchMedia('(display-mode: standalone)').matches) return;
     saveJSON('rt_hint_ctrl2', true); toast('Trend channel: Ctrl+2 works in an app window (browser menu › Cast, save and share › Install page as app / Open as window). In a tab use Alt+2.');
   }
   ```
   Call it from the flyout row and from Alt+2 only. Ctrl+2 arriving proves it already works. The edits are: in step 4 the new line becomes `{ e.preventDefault(); ctrl2Hint(); return setTool('channel'); }`, and in step 16 the flyout wiring calls `ctrl2Hint()` when `t === 'channel'`. `toast()` hides after 1.6 s (3910). Change `toastT = setTimeout(..., 1600)` to `setTimeout(..., msg.length > 60 ? 5000 : 1600)` so the hint stays readable. The Chrome menu wording is **not verified** on the user's Chrome/Brave build, so check it by hand.
7. **`applyDrawSetting` (2085-2094)**. Insert after the `kind === 'fib'` line (2091):
   `else if (kind === 'lv') d.levels = String(v).split(/[\s,]+/).map(Number).filter(n => isFinite(n) && n !== 0 && n !== 100);   // NT Trend Channel Levels, % of channel (0 = trend line, 100 = parallel)`
8. **`openDrawSettings` Coordinates (2073)**. Old: `else coords = pt(d.p2 ? 'Point 1' : 'Point', 'p1', true, true) + (d.p2 ? pt('Point 2', 'p2', true, true) : '');`
   New: append `+ (d.p3 ? pt('Parallel start', 'p3', true, true) : '')` before the `;`. The existing `p:`/`t:` kinds already write `d[key].p/.t`.
9. **`openDrawSettings` Style (after 2068)**. Add:
   ```js
   if (d.type === 'channel') style += `<label class="ds-row ds-num"><span>Extend</span><select data-k="d:extend">${['none', 'left', 'right', 'both'].map(v => `<option value="${v}" ${(d.extend || 'none') === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>` +
     `<label class="ds-row ds-num"><span>Levels %</span><input type="text" data-k="lv:levels" value="${(d.levels || []).join(', ')}" placeholder="50"></label>`;
   ```
   No arrow checkboxes, because NT's channel has none. Settings title (2077): replace `${d.type.toUpperCase()} settings` with `${d.type === 'channel' ? 'Trend channel' : d.type.toUpperCase()} settings`. §C.5 sentence-cases every type.
10. **`$('chart')` pointermove preview (1962)**. Old: `if (e.shiftKey && SHIFT_TOOLS[tool]) {`. New: `if (e.shiftKey && SHIFT_TOOLS[tool] && !pendingPt2) {` (Shift does not apply to click 3).
11. **`drawingFields` (1837)**. After `if (d.p2) A.push(...)` add:
    `if (d.p3) A.push({ obj: d.p3, key: 'p', kind: 'p' }, { obj: d.p3, key: 't', kind: 't' });`
    Body drag, arrow nudge and paste shift then move all three anchors.
12. **`drawingAt` (after 1815 `if (x1 == null || y1 == null) continue;`)**. Add:
    `if (d.type === 'channel') { const g = chanGeom(d, X, Y, W, H); if (g && [g.a, g.b, ...g.lv].some(s => pointSegDist(x, y, s.ax, s.ay, s.bx, s.by) < TH)) return d; continue; }   // either rail or a level; the band itself is not a hit (no fill in NT)`
13. **`drawingHandles` (after the box block, 1793)**. Add inside the loop:
    ```js
    if (d.type === 'channel' && d.p3) {   // NT: L2A1 (p3) moves the parallel rail alone; mids + L2A2 are body grabs via drawingAt
      const x3 = X(d.p3.t), y3 = Y(d.p3.p);
      if (x3 != null && y3 != null) out.push({ d, hx: x3, hy: y3, apply: (t, p) => { if (t != null) d.p3.t = t; d.p3.p = p; } });
    }
    ```
    Then **replace the p1 handle for channels only**. Change line 1788 `apply` to:
    `apply: (t, p) => { if (d.type === 'channel' && d.p3) { const l0 = timeToLogical(d.p1.t), l3 = timeToLogical(d.p3.t), ln = t != null ? timeToLogical(t) : null; if (l0 != null && l3 != null && ln != null) { const nt = logicalToTime(l3 + ln - l0); if (nt != null) d.p3.t = nt; } d.p3.p += p - d.p1.p; } if (t != null) d.p1.t = t; d.p1.p = p; }`
    This keeps the offset vector (p3 − p1) fixed. The p2 handle (1789) is unchanged.
14. **Helper `chanGeom`**. Add after `tlSeg` (1349):
    ```js
    // NT8 Trend Channel geometry (pixel space): rail a = p1->p2, rail b = p3 -> p3+(p2-p1); levels = rail a shifted by f% of (p3-p1). Shared by renderer + hit-test.
    function chanGeom(d, X, Y, W, H) {
      const x1 = X(d.p1.t), y1 = Y(d.p1.p), x2 = X(d.p2.t), y2 = Y(d.p2.p), x3 = d.p3 ? X(d.p3.t) : null, y3 = d.p3 ? Y(d.p3.p) : null;
      if ([x1, y1, x2, y2, x3, y3].some(v => v == null)) return null;
      const ox = x3 - x1, oy = y3 - y1, x4 = x2 + ox, y4 = y2 + oy, seg = (ax, ay, bx, by) => tlSeg(d, ax, ay, bx, by, W, H);
      const lv = (Array.isArray(d.levels) ? d.levels : []).map(f => seg(x1 + ox * f / 100, y1 + oy * f / 100, x2 + ox * f / 100, y2 + oy * f / 100));
      return { a: seg(x1, y1, x2, y2), b: seg(x3, y3, x4, y4), lv, x1, y1, x2, y2, x3, y3, x4, y4 };
    }
    ```
    `tlSeg`'s ray branch keys on `d.type === 'ray'`, so a channel only extends when `d.extend` is set.
15. **`handleDrawClick` (1466-1487)**.
    a. Line 1468 Shift guard. Old: `if (pendingPt && ev && ev.shiftKey && SHIFT_TOOLS[t]) {`. New: `if (pendingPt && !pendingPt2 && ev && ev.shiftKey && SHIFT_TOOLS[t]) {`
    b. Insert a new branch **between 1471 and 1472** (before the generic snapshot line, so clicks 1 and 2 leave no empty undo entry):
    ```js
    if (t === 'channel') {   // NT8 Trend Channel: click 1 trend start, click 2 trend end, click 3 = point the parallel passes through (ParallelStartAnchor)
      if (!pendingPt) { pendingPt = { t: time, p: price }; pendingPt2 = null; previewXY = null; repaintOverlays(); return; }
      if (!pendingPt2) { pendingPt2 = { t: time, p: price }; previewXY = null; repaintOverlays(); return; }
      snapshot(); drawings.push(newDrawing({ type: 'channel', p1: pendingPt, p2: pendingPt2, p3: { t: time, p: price }, levels: [], color: '#000000' }));
      pendingPt = null; pendingPt2 = null; previewXY = null; selectDrawing(drawings[drawings.length - 1], false); saveJSON('rt_drawings', drawings); repaintOverlays(); resetToolAfterDraw(); return;
    }
    ```
16. **`initLeftbarMenus` flyout wiring (2046)**. Old: `... .map(t => [TOOLBTN[t], () => { if (tool !== t) setTool(t); }])`. New: `... .map(t => [TOOLBTN[t], () => { if (tool !== t) setTool(t); if (t === 'channel') ctrl2Hint(); }])`.
17. **`setTool` (1765) and `resetToolAfterDraw` (1629)**. Add `pendingPt2 = null;` next to each `pendingPt = null;`. `applyHide` (2026) and `wipeDrawings` (1495) get the same. The three load resets (2344/2404/2673) are safe as they are, because click 1 always clears `pendingPt2`.
18. **Globals (1732)**. After `let pendingPt = null;` add `let pendingPt2 = null;   // 2nd click of the 3-point Trend Channel (NT8 Ctrl+2)`. Extend the type comment at 1726 with `|'channel'` and `p3?:{t,p}, levels?:number[]`.
19. **`LINE_TOOLS` (1759)**. Add after the `ray` entry: `channel: ['stacked_line_chart', 'Trend channel — three clicks: line start, line end, parallel (Ctrl+2 / Alt+2)'],`. The `tl` title becomes `'Trend line — click two points (Alt+T / F2)'`.
    `stacked_line_chart` was verified to render as a Material Symbols glyph this session (20 px wide vs 340 px for a bogus name).
20. **`TOOLBTN` (1739)**. Add `channel: 'drwChannel'`.
21. **`SHIFT_TOOLS` (1368)**. Add `channel: 1`.
22. **Renderer: preview (1310-1326)**. Inside `if (x1 != null && y1 != null) {`, before `if (tool === 'fib' || ...`, add:
    ```js
    if (tool === 'channel' && pendingPt2) {   // clicks 2->3: fixed trend line + parallel rail starting at the cursor
      const x2c = X(pendingPt2.t), y2c = Y(pendingPt2.p);
      if (x2c != null && y2c != null) { ctx.strokeStyle = '#000000'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2c, y2c); ctx.moveTo(x2, y2); ctx.lineTo(x2 + x2c - x1, y2 + y2c - y1); ctx.stroke(); dbg.preview.rails = 2; }
      ctx.restore();
    } else
    ```
    so that the existing `if (tool === 'fib' ...) {...} else {...}` chain becomes the else branch. The first `ctx.restore()` stays for that chain only. Clicks 1→2 fall through to the existing black rubber band.
    Also add an orange dot for `pendingPt2` next to 1308: `if (pendingPt2) { const x = X(pendingPt2.t), y = Y(pendingPt2.p); if (x != null && y != null) { ctx.fillStyle = '#CC4400'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); } }`
23. **Renderer: `hpts` (1286)**. First line inside:
    `if (d.type === 'channel') { const g = chanGeom(d, X, Y, W, H); return g ? [[g.x1, g.y1], [g.x2, g.y2], [(g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2], [g.x3, g.y3], [g.x4, g.y4], [(g.x3 + g.x4) / 2, (g.y3 + g.y4) / 2]].map(([x, y]) => ({ x, y })) : []; }   // NT: 6 handles, 3 per rail`
24. **Renderer: draw branch (insert after 1272 `rr`)**:
    `if (d.type === 'channel') { const g = chanGeom(d, X, Y, W, H); if (!g) continue; dbg.lastX = g.x1; ctx.beginPath(); for (const s of [g.a, g.b, ...g.lv]) { ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); } ctx.stroke(); continue; }   // no fill, no midline unless a Level is set (NT)`
25. **Right-click cancels placement (480)**. Old: `$('chart').addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY); });`
    New: `$('chart').addEventListener('contextmenu', (e) => { e.preventDefault(); if (tool && pendingPt) { setTool(''); return; } showCtx(e.clientX, e.clientY); });   // NT: right-click while placing cancels`
    Right-click with a tool armed but no point placed still opens the trading menu, which is the current behaviour.

### A.2 `index.html` edits

1. `#linesPopover`: insert after the `#drwRay` row (line 306):
   `<button id="drwChannel" class="pop-row" data-icon="stacked_line_chart"><span class="material-symbols-outlined">stacked_line_chart</span><span class="pop-lbl">Trend channel</span><span class="pop-key">Ctrl+2</span></button>`
2. `#drwTL` row (305): `<span class="pop-key">Alt+T</span>` → `<span class="pop-key">F2</span>`. F2 is NT's default; Alt+T stays in the title and HELP.
3. `#drwLines` title (128): `Trend line — click two points (Alt+T)` → `Trend line — click two points (Alt+T / F2)`.

### A.3 Tests: new file `tests/nt_channel.mjs` (do not change `drawTL` or the 52-rule matrix)

Copy `load/clickChart/clickTool/key/n/clear` from `tv_drawing_matrix.mjs` lines 24-60 and add `drawChannel(x1,y1,x2,y2,x3,y3)` = `clickTool('#drwChannel')` followed by 3 `clickChart` calls. Each check below prints PASS/FAIL:

- C1 `key('F2')` → `__rt.getTool()==='tl'`; F2 again → `''`.
- C2 `key('Control+2')` → `'channel'`; `key('Alt+2')` → `'channel'`. This is CDP-injected, so it proves the JS only. A real Ctrl+2 in a tab is **expected to fail** (see A.4).
- C3 after C1/C2 no position/order was created (`__rt.state().pos==null && !__rt.entryOrderInfo()`), and B/S/F/J/X still trade (reuse the REG2 body).
- C4 placement: after click 1 `n()===0`; after click 2 `n()===0` and `undoStack.length` unchanged; after click 3 `n()===1`, type `channel`, `p3` set, `levels=[]`, tool back to `''` (Keep drawing off).
- C5 preview: after click 2 plus a mouse move, `__drwDbg.preview.rails===2` and `__segInk` > 0.6 along both preview rails.
- C6 render: ink > 0.7 along both rails; **no ink** at the band centre between the rails (no fill, no midline); `__drwDbg.handles===6` when selected.
- C7 geometry: rail b pixel vector equals rail a vector within 1 px, at two zoom levels (`chart.timeScale().applyOptions({barSpacing})`).
- C8 drag p3: trend p1/p2 unchanged, p3 moved. Drag p2: p1 and p3 unchanged. Drag p1: `p3 − p1` is unchanged in price and logical. Drag the trend midpoint or p4: all 3 anchors shift by the same delta.
- C9 Esc after click 2 → `n()===0`, `pendingPt===null`, undo stack unchanged. Right-click after click 1 → same, and `#ctxMenu` is not shown.
- C10 one Ctrl+Z after C4 → `n()===0`; Ctrl+Y → 1.
- C11 settings: `Levels %`=`50` → an ink line at the midpoint between the rails; Extend=right → ink at the right chart edge on both rails; Coordinates shows a "Parallel start" group.
- C12 persistence: reload → the channel is still there with p3.
- Then run `tv_drawing_matrix.mjs` and require no new FAIL vs the baseline (§D).

### A.4 Browser limitation (what to tell the user)

- **F2 = Line** reaches the page in every Chromium context. It is not a browser accelerator.
- **Ctrl+2 = Trend channel** reaches the page only where no tab strip exists: an installed or "Open as window" app window. Per the hotkey research it is community-reported, not documented by Chromium. In a normal Chrome/Brave tab the browser switches to tab 2 and the page never sees the key.
- **Fallbacks that always work:** Alt+2, and the Lines flyout row. The one-time toast (A.1 step 6) says this.
- Keyboard Lock (`navigator.keyboard.lock`) is **not implemented**. It only works inside element fullscreen, and the app has no fullscreen mode (grep for `requestFullscreen` found 0 hits). Adding a fullscreen control would be a new UI element, which is YAGNI.

---

## B. Web Interface Guidelines fixes (all blockers and majors)

1. **[blocker] Modals have no dialog semantics or focus management**
   - Add `role="dialog" aria-modal="true"` to the six modal roots at `index.html:297,298,333,334,335,336` (`#dayDetail #logModal #drawSettings #settleModal #quizModal #helpModal`).
   - Add one helper in `app.js`: `let _modalRet = null; function modalOpened(el) { _modalRet = document.activeElement; const f = el.querySelector('button, [href], input, select, textarea'); (f || el).focus(); } function modalClosed() { if (_modalRet && _modalRet.focus) _modalRet.focus(); _modalRet = null; }`. Give each root `tabindex="-1"` so `el.focus()` works.
   - Call `modalOpened(el)` at the end of `openLogs` (4022), `openDrawSettings` (after 2080 `classList.add('open')`), `toggleHelp` (after 4243), and the day-detail, settle and quiz openers.
   - Call `modalClosed()` in `closeLogs` (4023), `closeDrawSettings` (2055), `closeSettle` (3050), `closeQuizScore` (3207), `closeDayDetail` (3704) and the close path of `toggleHelp` (4239).
   - Add a Tab trap: `document.addEventListener('keydown', e => { if (e.key !== 'Tab') return; const m = document.querySelector('.day-detail.open'); if (!m) return; const f = [...m.querySelectorAll('button, [href], input, select, textarea')].filter(x => !x.disabled && x.offsetParent); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } });`
   - Caution: `openDrawSettings` focus must not steal keys during chart work. It runs only on a Settings click or double-click, so this is fine. The keydown guard (4187) already ignores INPUT/SELECT.
2. **[blocker] `styles.css:68` `button:focus-visible{outline:none}` removes the keyboard focus indicator.** Replace it with `button:focus-visible{outline:2px solid var(--brand);outline-offset:1px}`, the same rule as line 69. `:focus-visible` does not show on mouse clicks, so the NT look for mouse users is unchanged. It is flat: no shadow.
3. **[major] Icon-only buttons are named by `title` only.** Add `aria-label` with the exact `title` text to every icon-only button: `toolCursor, drwLines, drwFib, drwBox, drwRR, drwMeasure, annUp, annDown, annLong, annShort, btnMagnet, btnKeepDraw, btnLockDrw, btnHideDrw, drwClear, annClear` (index.html 125-156; `btnLinesMenu`/`btnMagnetMenu`/`btnHideMenu`/`btnRemoveMenu` already have one), the transport buttons `btnPrevDay, btnToStart, btnStepBack, btnPlay, btnStepFwd, btnNextDay` (76-80), `btnPickStart` (98), `btnSettleNow` (104), `btnHideTradesTop` (110), `dtLock, dtSettings, dtDelete` (329-331) and `oscClose` (170).
   - Where JS rewrites `title` at runtime (`syncLinesGroup` 1762, `hideBtnUI` 2032, `syncDrawToolbar` 1997), also set `aria-label` to the same string.
4. **[major] The context menu and 3 flyouts are not reachable by keyboard.**
   - In `showCtx` (≈470-473) create items with `document.createElement('button')`, `type='button'`, `role='menuitem'` instead of a `div`, and give `ctxEl` `role="menu"`.
   - After showing the menu, focus the first item. Add ArrowUp/ArrowDown to move focus between `.ctx-item` elements. The Escape handler at 482 already hides the menu.
   - In `index.html:300-301,314-317,320-321` change `<div class="pop-row" id=…>` to `<button type="button" class="pop-row" id=…>`, keeping the ids. The `<label class="pop-row">` checkbox rows stay as they are.
   - CSS: extend the reset at `styles.css:1184` to all of these: `.popover .pop-row:is(button), #ctxMenu button.ctx-item{ width:100%; background:transparent; border:0; text-align:left; font:inherit; color:var(--txt); }`.
   - The `.onclick` wiring at 2042/2044-2045 is id-based, so it is unchanged.
5. **[major] Toasts are silent to screen readers.** In `toast()` (3910) creation branch add `el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');`.
6. **[major] Labels are not associated with their fields.** Add `for="<id>"` to the labels at index.html 183, 185, 186, 187, 198, 199, 200, 236, 237, 238, 244 and 246, pointing at the existing input or select id of each field. Where a field has no id, add one. Confirm each id is unused with `grep -c 'id="X"' index.html` = 1 before adding it.
7. **Minors (grouped)**
   - (a) `styles.css:437` `.day-detail`: add `overscroll-behavior:contain;`.
   - (b) Cache `$('chart').getBoundingClientRect()` once per drag in the pointerdown handler (1900) as `dragRect`, and use it in the window pointermove (1917) while `dragH || dragBody || drag || vpan` is set. The hover path (1967) and the preview path (1961) can keep reading it live, since they change no layout.

---

## C. Visual pass (design plan, constrained)

**Token system (no new values; all already exist in `:root`):** Chrome `#E6E7E8` (--bg), Paper `#FFFFFF` (--panel), Rule `#BCBDBF` (--line), Ink `#000000` (--txt), Graphite `#58595B` (--dim), Signal `#CC4400` (--brand, active/selected/focus only). Data: fills `#32CD32/#FF0000`, text `#127209/#D40605`.
Type: Segoe UI with tabular-nums. Mono only for price columns. Scale: 11/14, 12/17, 14/18, 18/22, 24/28 (the last for the P&L plate only). Weights 400/600/700. Letter-spacing 0. Sentence case.
Spacing 2/4/8/12/16/24. Heights: toolbar/tabs/fields 32, secondary 36, Buy/Sell 48 (44 at ≤800 px tall). Touch sizes unchanged.

Edits in priority order:

1. `styles.css:702` `.drw-tb`: delete `box-shadow:0 2px 8px rgba(0,0,0,.18);` (standing flat rule).
2. `#btnPlay` orange only while playing.
   - `styles.css:129-136`: change the fill to the neutral button face. `#btnPlay,#btnPlay.play{min-width:42px;font-size:14px}`.
   - Add `#btnPlay.on{background:var(--brand);border-color:var(--brand);color:var(--on-brand)}` and `#btnPlay.on:hover:not(:disabled){background:var(--brand-hi);border-color:var(--brand-hi)}`.
   - `app.js` `play()` (2565): after `textContent = 'pause'` add `$('btnPlay').classList.add('on');`. `pause()` (2572): add `$('btnPlay').classList.remove('on');`.
   - Keep the static `class="play"` in index.html:78.
3. `styles.css:773` `.rr-hint`: `color:var(--accent)` → `color:var(--dim)`, `font-weight:600` → `400`.
4. `styles.css:123-126` `#symbol`: `font-weight:600;letter-spacing:0;font-size:12px;color:var(--txt);`.
5. Remove every `text-transform:uppercase` and letter-spacing from the 13 selectors the plan lists, and zero the tracking on `.rh-round .st-badge .qz-n .rh-badge .mode-badge`.
   - Labels become 11px/600 `--dim`; card headings 12px/600 `--txt`.
   - JS strings that are uppercased at the source become sentence case: `openDrawSettings` title (use the `channel`-style map for all types), ctx head `LONG/SHORT` at 436, and the day-detail `LONG 1` (the plan's item 19).
   - **Not changed:** the order-bracket tags `BUY LMT / STOP / TGT / LONG` drawn on the chart (1401-1420). They are NT chart-trader-style canvas tags, not UI labels, and the NT fidelity rule applies.
6. Buy/Sell one row: `Buy` plus hotkey `B` on the right (11px, 70% opacity), and the same for Sell `S`, Buy stop `F` and Sell stop `J`. `.bs{flex-direction:row;justify-content:space-between;padding:0 12px}`. Keep the ids and `.bs-s` spans, changing only their text.
7. `styles.css:804` `button.bs-stop.buy/.sell`: set `background:var(--panel);border:1px solid var(--line)`, with `color:var(--pos)` on `.buy` and `color:var(--neg)` on `.sell`.
8. Trades summary (app.js 3504-3505): `${n} trades   Net ${usd}   Today ${usd}` as `<span>`s with `gap:16px`.
9. Today strip (3779-3781): `Today  Fri 25 Sep`, `.tp-val` 18px/700, meta `1 trade, 0 won, 1 lost` / `No trades yet`.
10. Stat cards: `.statcards` → `repeat(7,minmax(0,1fr))` at ≥1100 px and `repeat(auto-fit,minmax(120px,1fr))` below. Move `#statCards` above the calendar box in `#panelDash`. This is a DOM move with the id kept.
11. Copy:
    - `P&L calendar` (index.html:285), with the hint moved to the cell `title`.
    - Month total `-$10.00, 1 day` (3558).
    - `ATM templates` summary (235), with "multi-target scale-out" in its `title`.
    - `Target (R)` and `Size by risk` (187-188, 203).
    - TBBO badge text `TBBO` with `title="Source: NinjaTrader"` (545-547).
    - **Do not rename ATM localStorage keys** (162-175).
12. Side-panel heights: `styles.css:1033` `--ctl:32px; --ctl-lg:36px; --ctl-xl:48px`; the ≤800 px block (1052) becomes `32 / 36 / 44`. The touch block (1139) is unchanged.
13. Middle dots removed from the P&L plate meta (`-2 ticks  -0.01 R`) and the day-detail rows. Use 12px gaps.
14. Type-scale consolidation to 11/12/14/18/24, and weights 500→400 and 800→700. This is a whole-file mechanical pass; do it last, then re-capture.
15. Delete the dead `border-radius` declarations. `*{border-radius:0!important}` at 1180 already squares everything, so there is no visual change.

**Rejected or deferred plan items**

- **Rejected:** hiding `#btnHideTradesTop` (plan item 15). Test REG3 clicks it (`tv_drawing_matrix.mjs:774,776`), and `display:none` would break a currently passing rule. Keep it. The one-row toolbar at ≥1366 already holds (capture_sizes: 1 row at 1366×768).
- **Kept as-is:** the chart canvas colours, order tags and drawing handle colours.
- **Guard:** no change may add a toolbar element. The toolbar row count must stay 1 at ≥1366 and exactly 2 below.

### C acceptance

1. `grep -nE 'box-shadow|text-shadow|backdrop-filter|gradient' src/styles.css index.html` returns 0 lines.
2. `grep -c 'text-transform:uppercase' src/styles.css` returns 0.
3. `grep -oE 'font-size:[0-9.]+px' src/styles.css | sort -u` lists only 11/12/14/18/24 plus icon glyph sizes.
4. `cd /d/SIPs && node D:/Tools/replay-trainer/tests/capture_sizes.mjs`: toolbar rows = 1 at ≥1366 wide and 2 below; 0 findings.
   - Open the 1366×768 `_full` and `_dashboard` shots and check them: orange appears only on active tool, playing transport, pressed segment and focus ring; the stat row is above the calendar.
5. Toggle play/pause: `#btnPlay` is orange only while playing.

---

## D. Global acceptance / run order

1. Implement A, then run `tests/nt_channel.mjs` (all PASS) and `tests/tv_drawing_matrix.mjs` (no new FAIL vs the 50/2 baseline).
2. Implement B. Keyboard-only walk: Tab reaches the leftbar and flyout rows with a visible orange ring; Enter on a flyout row arms the tool; open and close each modal and confirm focus returns to its trigger; Shift+F10 or the context-menu key is **not** in scope.
3. Implement C, then run capture_sizes plus the matrix again.
4. A human does the real-keyboard check (CDP cannot prove it):
   - F2 in a Chrome tab arms Trend line.
   - Ctrl+2 in a tab switches browser tabs (expected); in an "Open as window" app window it arms Trend channel.
   - Alt+2 arms it in both.
   - The one-time toast appears once.
5. **Baseline failing rules (matrix run twice this session before any edit, both 50/2):**
   - **G12:** measure handle ink does not appear after select (`measure false->false`).
   - **G17:** fib/measure/rr recolour via the toolbar swatch: `magenta after=false`.
   - Both failures predate this spec and are unrelated to it. Whether each is a real regression or a test-probe problem is **not verified**. Do not count them against this work, and do not "fix" them silently inside it.
