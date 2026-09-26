# Web Interface Guidelines Audit — NQ Replay Trainer

Source ruleset: https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md (fetched 2026-09-26, full text saved verbatim during audit, see command history).
Scope reviewed: `index.html` (339 lines), `src/styles.css` (1189 lines), UI-building parts of `src/app.js` (4262 lines) — DOM creation, event handlers, focus, forms, toasts, modals, popovers, keyboard handling.
Method: static read + `grep` verification only in this session (no runtime/browser pass was performed for this audit — see "Not verified" note at bottom). Every line cited below was read directly.

Baseline preserved: did not touch `tv_drawing_matrix.mjs` behavior or any drawing-tool logic; this is a read-only review, no code was changed.

## Findings (most severe first)

### BLOCKER — Modals have no dialog semantics, no focus management
`index.html:297` (#dayDetail), `:298` (#logModal), `:333` (#drawSettings), `:334` (#settleModal), `:335` (#quizModal), `:336` (#helpModal)
`src/app.js` open/close fns: `openLogs` 4022, `closeLogs` 4023, `closeDrawSettings` 2055, `openDrawSettings` 2077-2080, `closeSettle` 3050, `closeQuizScore` 3207, `closeDayDetail` 3704, `toggleHelp` 4237

- 0 occurrences of `role=` or `aria-modal` anywhere in `index.html` or `src/app.js` (grep-confirmed).
- 0 occurrences of `.focus()` anywhere in `src/app.js` (grep-confirmed) — opening a modal never moves focus into it, closing one never returns focus to the triggering button.
- Result: screen readers never announce these as dialogs; Tab can walk out of an open modal into the hidden page behind the `.day-detail` backdrop.
- Escape-to-close IS wired for every modal (app.js:4067,4068,4174,4176,4222) — that part is fine.

Fix: add `role="dialog" aria-modal="true"` to each `.day-detail`/modal root; on open, call `.focus()` on the modal panel (or its first focusable control) and keep a simple Tab-wrap listener while `.open`; on close, call `.focus()` back on the element that opened it.

### BLOCKER — No visible keyboard-focus indicator on any `<button>`
`src/styles.css:68` — `button:focus-visible{outline:none}` (comment: "NT8 shows no focus ring on buttons") with zero replacement rule anywhere else in the file.

- Applies to every button in the app: leftbar drawing tools, transport controls, order entry, tabs, dt-toolbar — 50+ controls.
- The very next line already has the right pattern for inputs: `styles.css:69` `select:focus-visible,input:focus-visible{outline:2px solid var(--brand);outline-offset:1px}`.

Fix (smallest change, keeps the flat/no-shadow look): replace `styles.css:68` with `button:focus-visible{outline:2px solid var(--brand);outline-offset:1px}` — same treatment already used for inputs/selects, no shadow/gradient involved.

### MAJOR — ~20+ icon-only buttons have no `aria-label` (title only)
`index.html` leftbar (125, 128-156): `toolCursor, drwLines, btnLinesMenu, drwFib, drwBox, drwRR, drwMeasure, annUp, annDown, annLong, annShort, btnMagnet, btnMagnetMenu, btnKeepDraw, btnLockDrw, btnHideDrw, btnHideMenu, drwClear, btnRemoveMenu, annClear`
Transport (76-80): `btnPrevDay, btnToStart, btnStepBack, btnPlay, btnStepFwd, btnNextDay`
Also: `btnPickStart`(98), `btnSettleNow`(104), `btnHideTradesTop`(110), floating draw toolbar `dtLock/dtSettings/dtDelete`(329-331), `oscClose`(170)

- grep-confirmed: 0 `aria-label` occurrences in `src/app.js`, only 4 in `index.html` (none on the above).
- `title` alone is not a reliable accessible name (inconsistent AT support, no keyboard-triggered display).

Fix: add `aria-label="<same text as title>"` to each (title text already describes the action, e.g. `aria-label="Trend line"` on `drwLines`).

### MAJOR — Clickable `<div>` menu items instead of `<button>` (no keyboard path)
Right-click trading context menu: `src/app.js` `showCtx` 431-479, items built at 460/473 as `<div class="ctx-item">` + `.onclick` — actions include Buy/Sell Market, Buy/Sell Limit @ price, Buy/Sell Stop @ price, Move stop/target to price, Flatten, Reverse.
Same pattern in popovers: `index.html` magnetPopover (300-301: `#magWeak`,`#magStrong`), hidePopover (314-317: `#hideDrawings/#hideIndicators/#hidePositions/#hideAll`), removePopover (320-321: `#rmDrawings/#rmDrawingsInd`) — all plain `<div id="...">`, wired via `.onclick` at `app.js:2044-2045, 4094-4095`.

- None have `tabindex`, a keydown handler, or button/menuitem role — not reachable or activatable by keyboard.
- "Move stop/target to this price" and "Buy/Sell Limit/Stop @ (right-clicked price)" have no other UI path at all, so keyboard-only users cannot do these specific actions.

Fix: swap `<div>` → `<button type="button">` for every item above (styling unaffected, `button` can be unstyled to look identical); add `role="menu"/"menuitem"` and arrow-key navigation to `showCtx`'s generated menu.

### MAJOR — Toast messages carry no `aria-live` region
`src/app.js:3910` `function toast(msg)` creates `#toast` with no `aria-live`/`role` ever set (0 occurrences of `aria-live` anywhere in the codebase). Used for ~25 call sites including validation errors (`'ATR period 1–200'` @848, `'Invalid EMA periods'` @1028) and order confirmations.

Fix: on first creation (app.js:3910) set `el.setAttribute('role','status'); el.setAttribute('aria-live','polite');` once.

### MAJOR — Order-entry/ATM-editor `<label>`s not associated with their control
`index.html:183` (Price), `185` (Qty), `186` (ATM template), `187` (Target R), `198` (Unit), `199` (Stop), `200` (Target), `236` (Name), `237` (Distance unit), `238` (Stop SL), `244` (Trigger/offset), `246` (Start/distance).

- grep-confirmed: 0 occurrences of `for=` anywhere in `index.html`; in each line above the input sits in a sibling `<div>`/span, not inside the `<label>`.
- Labels that already wrap their control (checkboxes at 50-55, 203, 243, 245) are correct and need no change.

Fix: give the input an `id` (most already have one) and add matching `for="<id>"` to its `<label>`.

## Minor / polish

- `src/styles.css:437` `.day-detail{...overflow:auto}` has no `overscroll-behavior:contain` — scrolling past the end of a long modal (day detail, saved logs, help) scroll-chains into the page behind the backdrop. Fix: add `overscroll-behavior:contain`.
- `src/app.js:3495` trades table is rebuilt with one `innerHTML=trades.map(...).join('')` and no virtualization; only matters if a single session regularly exceeds ~100+ rows — not worth virtualizing pre-emptively (ponytail: leave as-is unless real sessions hit that size).
- `src/app.js:1900,1917,1961,1967,1983` call `$('chart').getBoundingClientRect()` freshly on every pointermove tick while drawing/hovering instead of caching once per drag gesture. Low real-world cost (single read, not interleaved with a write) but technically re-measures layout in a hot path.
- No `<meta name="theme-color">` / `color-scheme` — not a real gap: the app is deliberately single-theme (NT8 light skin only, standing decision), guideline item is dark-mode-specific.

## Clean / compliant (verified, not flagged)

- No `<img>` tags anywhere (favicon is inline SVG) → image-dimension/alt/lazy-loading rules are N/A.
- No `user-scalable=no`/`maximum-scale=1` in the viewport meta — pinch-zoom is allowed.
- No `onPaste`+`preventDefault` anywhere (grep: 0 hits).
- Destructive actions (`Clear all trades`, `Remove all drawings`, delete a saved log, etc.) all gate on `confirm()` before proceeding (app.js:1491,1509,1861,2937,3983,4006,4012).
- `select:focus-visible,input:focus-visible` already has a correct 2px outline (styles.css:69) — the pattern the button fix above should copy.
- `"Loading…"` and friends already use a real ellipsis character, not `...` (app.js:2293,2338,2398,2670) — all `...` matches in the codebase are JS spread syntax, not user-facing copy (spot-checked 2091,1541,2651).
- `.mono`/`tabular-nums` already applied to every numeric readout (P&L, stats, clock, etc.).

## Not verified in this pass

- No live browser/DOM render was opened for this specific audit (server confirmed reachable at http://127.0.0.1:5560/, HTTP 200, but no page was loaded/screenshotted this session) — all findings are static-analysis-verified via direct file read + grep, not confirmed against actual rendered/computed accessibility tree.
- Screen-reader behavior (NVDA/VoiceOver) was not tested; conclusions about "not announced" follow from absence of the relevant attribute, not from a live AT session.
