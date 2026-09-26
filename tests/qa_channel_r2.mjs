// QA round 2 (independent of the implementer) — NT8 Trend Channel (Ctrl+2) + Line (F2) parity.
// Verifies D:\Tools\replay-trainer\exports\NT8_TRENDCHANNEL_SPEC.md rule by rule with REAL mouse input (page.mouse).
// Written from scratch against src/app.js source reading + the spec; does NOT reuse tests/qa_channel_r1.mjs.
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const R = [];
function log(name, pass, detail) { R.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + ' — ' + detail); }

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });

await page.goto('http://127.0.0.1:5560/?r=' + Date.now(), { waitUntil: 'load' });
await page.waitForTimeout(900);

// ---------- reset to known state (direct var writes; the actual interactions below still use real mouse/keyboard) ----------
await page.evaluate(() => {
  drawings = []; pendingPt = null; pendingPt2 = null; previewXY = null; clearSelection(); tool = '';
  keepDrawing = false; saveJSON('rt_keepdraw', false);
  magnet = 'off'; magnetMode = 'weak'; saveJSON('rt_magnet', 'off'); saveJSON('rt_magnet_mode', 'weak');
  saveJSON('rt_drawings', []); repaintOverlays(); updateToolUI();
});

async function chartRect() { return page.evaluate(() => { const r = document.getElementById('chart').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; }); }
async function toScreen(time, price) {
  return page.evaluate(({ time, price }) => {
    const ts = chart.timeScale();
    let x = ts.timeToCoordinate(time);
    if (x == null) { const lg = timeToLogical(time); x = logicalToX(ts, lg); }
    const y = candle.priceToCoordinate(price);
    const r = document.getElementById('chart').getBoundingClientRect();
    return { x: r.left + x, y: r.top + y };
  }, { time, price });
}
async function state() { return page.evaluate(() => ({ tool, pendingPt: pendingPt && { ...pendingPt }, pendingPt2: pendingPt2 && { ...pendingPt2 }, n: drawings.length })); }
async function lastDrawing() { return page.evaluate(() => { const d = drawings[drawings.length - 1]; return d && { type: d.type, id: d.id, p1: { ...d.p1 }, p2: { ...d.p2 }, p3: d.p3 && { ...d.p3 }, levels: d.levels, extend: d.extend }; }); }
async function allDrawings() { return page.evaluate(() => drawings.map(d => ({ type: d.type, id: d.id, p1: { ...d.p1 }, p2: d.p2 && { ...d.p2 }, p3: d.p3 && { ...d.p3 }, extend: d.extend, levels: d.levels }))); }
async function visBars() {   // bars actually on-screen right now (visible logical range), not just the tail of the underlying array — the replay pointer (idx) can sit well before bars.length
  return page.evaluate(() => {
    const ts = chart.timeScale(); const vr = ts.getVisibleLogicalRange();
    const lo = Math.max(0, Math.ceil(vr.from)), hi = Math.min(idx, Math.floor(vr.to));   // clamp to idx: only REVEALED bars, never the future/unrevealed tail
    const out = [];
    for (let i = lo; i <= hi; i++) if (bars[i]) out.push({ i, time: bars[i].time, open: bars[i].open, high: bars[i].high, low: bars[i].low, close: bars[i].close });
    return out;
  });
}
async function press(k) { await page.keyboard.press(k); await page.waitForTimeout(60); }
let _lastPt = null;   // LWC's own click-gesture recognizer needs a REAL intermediate mousemove trail between two points, not an instant teleport+click —
                       // page.mouse.click() alone silently drops the 2nd of two fast clicks (confirmed empirically against this app); always route through here.
async function clickAtPixel(x, y, opts = {}) {
  if (opts.mods) for (const m of opts.mods) await page.keyboard.down(m);
  if (_lastPt) await page.mouse.move((_lastPt.x + x) / 2, (_lastPt.y + y) / 2, { steps: 5 });
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(280);   // LWC's click gesture derives from its own rAF-driven hover/crosshair state, which lags a fast CDP move batch — this settle time is required, not cosmetic (empirically verified: without it ~50% of 2nd/3rd clicks in a 3-click sequence are dropped or land at a stale position)
  await page.mouse.down(opts.button ? { button: opts.button } : undefined);
  await page.waitForTimeout(50);
  await page.mouse.up(opts.button ? { button: opts.button } : undefined);
  if (opts.mods) for (const m of opts.mods) await page.keyboard.up(m);
  await page.waitForTimeout(150);
  _lastPt = { x, y };
  return { x, y };
}
async function clickAt(time, price, opts = {}) {
  const p = await toScreen(time, price);
  if (p.x == null || p.y == null || !isFinite(p.x) || !isFinite(p.y)) throw new Error('clickAt: bad screen point ' + JSON.stringify(p) + ' for time=' + time + ' price=' + price);
  return clickAtPixel(p.x, p.y, opts);
}
async function armChannel() {   // defensively force the channel tool ON regardless of any leftover state a previous (possibly failed) section left behind —
  await page.evaluate(() => { tool = ''; pendingPt = null; pendingPt2 = null; previewXY = null; });   // setTool('channel') TOGGLES OFF if tool is already 'channel', so always start from a known '' state
  await press('Control+2');
}

const B = await visBars();
const mid = B[Math.floor(B.length / 2) - 20];
const midEnd = B[Math.floor(B.length / 2) - 5];
const INSTR = await page.evaluate(() => window.__rt.instr());
console.log('visible on-screen bars: ' + B.length + ' (anchors at i=' + mid.i + ', ' + midEnd.i + ', idx boundary below)');

// ============================================================ 0. hotkeys
await press('Control+2');
{ const s = await state(); log('§0 Ctrl+2 selects Trend Channel tool', s.tool === 'channel', 'tool=' + s.tool); }
await press('Escape');
await press('F2');
{ const s = await state(); log('§2.1 F2 selects Line tool', s.tool === 'tl', 'tool=' + s.tool); }
await press('Escape');

const PXTOL = 2 * INSTR.TICK;   // real mouse coords round to whole screen pixels; recovered price/time can only round-trip to within ~1 tick, never exact float equality

// ============================================================ 1.1 / 1.2 three-click model + live preview
// deliberately large, unambiguous price separations (40 / 6 ticks) so pixel rounding never collapses two anchors together
const p1price = mid.low, p2price = mid.low + 40 * INSTR.TICK, p3price = mid.low - 6 * INSTR.TICK;
await armChannel();
await clickAt(mid.time, p1price);
{ const s = await state(); log('§1.1 click 1 sets pendingPt only (not committed)', !!s.pendingPt && !s.pendingPt2 && s.n === 0, JSON.stringify(s)); }
// mid-placement rubber-band: move the mouse, previewXY should track it before click 2
const movePt = await toScreen(midEnd.time, p2price);
await page.mouse.move(movePt.x, movePt.y, { steps: 10 });
await page.waitForTimeout(250);
{ const prev = await page.evaluate(() => previewXY && { ...previewXY }); log('§1.2 live rubber-band preview updates on mousemove pre-click2', !!prev, JSON.stringify(prev)); }
await clickAt(midEnd.time, p2price);
{ const s = await state(); log('§1.1 click 2 sets pendingPt2 only (not committed)', !!s.pendingPt2 && s.n === 0, JSON.stringify(s)); }
await clickAt(mid.time, p3price);
{ const s = await state(); const d = await lastDrawing();
  const ok = s.n === 1 && !s.pendingPt && !s.pendingPt2 && d.type === 'channel' &&
    Math.abs(d.p1.p - p1price) < PXTOL && Math.abs(d.p2.p - p2price) < PXTOL && Math.abs(d.p3.p - p3price) < PXTOL;
  log('§1.1 click 3 commits Draw.TrendChannel(anchor1,anchor2,anchor3)', ok, JSON.stringify(d) + ' want p1=' + p1price + ' p2=' + p2price + ' p3=' + p3price); }
{ const s = await state(); log('§1.2 tool exits draw mode after completion (Keep drawing off)', s.tool === '', 'tool=' + s.tool); }

// ============================================================ 1.3 handle geometry (6 VISUAL handles, 3 per rail; only 3 are independently draggable — L2A2 + both mid-points are body-drag entry points per NT8 spec §1.3)
{
  await page.evaluate(() => repaintOverlays());
  const dbg = await page.evaluate(() => window.__drwDbg);
  log('§1.3 selected Trend Channel paints exactly 6 visual handles (3/rail)', dbg && dbg.handles === 6, 'drwDbg.handles=' + (dbg && dbg.handles));
  const h = await page.evaluate(() => window.__rt.handles());
  log('§1.3 exactly 3 of those 6 are independently draggable (L1A1/L1A2/L2A1; mid+L2A2 are body-grabs per spec)', Array.isArray(h) && h.length === 3, 'draggable=' + (h && h.length));
}
{
  // verify chanGeom: rail b (parallel) = p3 -> p3+(p2-p1), i.e. L2A2 is computed, not an independent anchor (no separate stored field)
  const hasParallelEnd = await page.evaluate(() => { const d = drawings[drawings.length - 1]; return Object.prototype.hasOwnProperty.call(d, 'p4') || Object.prototype.hasOwnProperty.call(d, 'parallelEnd'); });
  log('§1.1 no independent ParallelEndAnchor stored (computed from slope)', hasParallelEnd === false, 'hasOwnField=' + hasParallelEnd);
}

// ============================================================ 1.4 no fill by default; Levels %
{
  const g = await page.evaluate(() => { const d = drawings[drawings.length - 1]; const el = document.getElementById('chart'); return chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); });
  log('§1.4 channel has no default Level (levels=[])', await page.evaluate(() => drawings[drawings.length - 1].levels.length === 0), 'checked via d.levels');
  log('§1.4 chanGeom produces 2 rails only when levels empty', g.lv.length === 0, 'lv.length=' + g.lv.length);
}

// ============================================================ Esc mid-placement cancels
const nBeforeEsc = (await state()).n;
await armChannel();
await clickAt(mid.time, mid.low);
await press('Escape');
{ const s = await state(); log('§2.4 Esc mid-placement cancels the in-progress draw', s.tool === '' && !s.pendingPt && s.n === nBeforeEsc, JSON.stringify(s)); }

// ============================================================ right-click mid-placement cancels
const nBeforeRC = (await state()).n;
await armChannel();
await clickAt(mid.time, mid.low);
await clickAt(midEnd.time, midEnd.high);
{
  const p = await toScreen(midEnd.time, midEnd.high - 5 * INSTR.TICK);
  await clickAtPixel(p.x, p.y, { button: 'right' });
}
{ const s = await state(); log('§2.4 right-click mid-placement cancels the draw', s.tool === '' && !s.pendingPt && !s.pendingPt2 && s.n === nBeforeRC, JSON.stringify(s)); }

// ============================================================ Magnet on/off (Snap Mode analogue) affects channel clicks too
await page.evaluate(() => { magnet = 'strong'; });
{
  const off1 = B[5];
  await armChannel();
  await clickAt(off1.time, off1.high + 3 * INSTR.TICK); // click a few px above the high; strong magnet must snap to it
  const d = await page.evaluate(() => pendingPt && { ...pendingPt });
  log('§1.5 magnet=strong snaps click to nearest OHLC (bar high)', !!d && Math.abs(d.p - off1.high) < 1e-6, JSON.stringify(d) + ' want=' + off1.high);
  await press('Escape');
}
await page.evaluate(() => { magnet = 'off'; });
{
  const off1 = B[5];
  const rawPrice = off1.high + 3 * INSTR.TICK;
  await armChannel();
  await clickAt(off1.time, rawPrice);
  const d = await page.evaluate(() => pendingPt && { ...pendingPt });
  log('§1.5 magnet=off leaves click free (no snap)', !!d && Math.abs(d.p - rawPrice) < PXTOL && Math.abs(d.p - off1.high) > 1e-6, JSON.stringify(d) + ' raw=' + rawPrice);
  await press('Escape');
}

// ============================================================ Shift constrains ONLY the 2nd click (trend line), 45° in pixel space
const nBeforeShift = (await state()).n;
await page.evaluate(() => { magnet = 'off'; });
await armChannel();
const anchor1 = await clickAt(mid.time, mid.close);
// choose a 2nd point whose raw angle (≈42°) is closest to the 45° step, so shift-rounding is unambiguous
const rawTarget = { x: anchor1.x + 100, y: anchor1.y - 108 };
await clickAtPixel(rawTarget.x, rawTarget.y, { mods: ['Shift'] });
{
  const s = await state();
  log('§2.4/G14-analogue Shift on click 2 still only arms pendingPt2 (channel not yet committed)', !!s.pendingPt2 && s.n === nBeforeShift, JSON.stringify(s));
}
// finish with click 3, then verify the committed p1->p2 pixel angle is a 45° multiple
const p3b = mid.close - 8 * INSTR.TICK;
await clickAt(mid.time, p3b);
{
  const d = await lastDrawing();
  const a = await toScreen(d.p1.t, d.p1.p), b = await toScreen(d.p2.t, d.p2.p);
  const dx = b.x - a.x, dy = b.y - a.y;
  const ratio = Math.abs(dx) < 0.5 ? Infinity : Math.abs(dy / dx);
  const ok = Math.abs(dx) < 1.5 || Math.abs(dy) < 1.5 || Math.abs(ratio - 1) < 0.08;
  log('§2.4 Shift constrained trend line to a 45° pixel angle', ok, 'dx=' + dx.toFixed(1) + ' dy=' + dy.toFixed(1) + ' ratio=' + (isFinite(ratio) ? ratio.toFixed(3) : 'inf'));
}

// ============================================================ Keep-drawing (Stay in Draw Mode) — clean slate, self-contained
await page.evaluate(() => { tool = ''; pendingPt = null; pendingPt2 = null; previewXY = null; drawings = []; saveJSON('rt_drawings', []); repaintOverlays(); });
await page.click('#btnKeepDraw');
{ const kd = await page.evaluate(() => keepDrawing); log('§1.2 Keep-drawing toggled on via real button click', kd === true, 'keepDrawing=' + kd); }
await armChannel();
await clickAt(mid.time, mid.low); await clickAt(midEnd.time, midEnd.high); await clickAt(mid.time, mid.low - 6 * INSTR.TICK);
{ const s = await state(); log('§1.2 tool STAYS armed after completion when Keep drawing is on', s.tool === 'channel' && s.n === 1, JSON.stringify(s)); }
// the just-completed channel auto-selects (its floating toolbar covers a real chunk of the chart) — deselecting is test setup/hygiene, not part of what's under test here (does Keep-drawing re-arm the tool), so do it directly rather than fighting toolbar geometry
await page.evaluate(() => { clearSelection(); repaintOverlays(); });
await clickAt(mid.time, mid.high); await clickAt(midEnd.time, midEnd.low); await clickAt(mid.time, mid.high + 6 * INSTR.TICK);
{ const s = await state(); log('§1.2 second channel drawn back-to-back without re-arming', s.n === 2, 'n=' + s.n); }
await page.click('#btnKeepDraw');
{ const kd = await page.evaluate(() => keepDrawing); log('§1.2 Keep-drawing toggled back off', kd === false, 'keepDrawing=' + kd); }
await press('Escape');

// ============================================================ Undo / redo (operates on the 2 channels the Keep-drawing test just made)
{
  const n0 = (await state()).n;
  await press('Control+z');
  const n1 = (await state()).n;
  await press('Control+y');
  const n2 = (await state()).n;
  log('§2.4-adjacent Ctrl+Z undoes the last channel placement', n1 === n0 - 1, 'n0=' + n0 + ' n1=' + n1);
  log('§2.4-adjacent Ctrl+Y redoes it back', n2 === n0, 'n2=' + n2);
}

// ============================================================ Settings panel: Extend + Levels %, via a REAL dblclick on the drawing body
{
  const d = await lastDrawing();
  if (!d) { log('§1.4/2.4 settings-panel section had a drawing to open (setup precondition)', false, 'lastDrawing() was undefined — an earlier section failed to leave a channel in place'); }
  else {
  const a = await toScreen(d.p1.t, d.p1.p), b = await toScreen(d.p2.t, d.p2.p);
  const bodyPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  await page.mouse.dblclick(bodyPt.x, bodyPt.y);
  await page.waitForTimeout(150);
  const open = await page.evaluate(() => document.getElementById('drawSettings').classList.contains('open'));
  log('§1.4/2.4 dblclick on channel body opens Properties (Settings)', open, 'open=' + open);
  if (open) {
    await page.selectOption('#drawSettings select[data-k="d:extend"]', 'right');
    await page.waitForTimeout(80);
    const ext = await page.evaluate(() => drawings[drawings.length - 1].extend);
    log('§2.2 Extend dropdown (none/left/right/both) applies to the channel', ext === 'right', 'extend=' + ext);
    const g1 = await page.evaluate(() => { const d = drawings[drawings.length - 1]; const el = document.getElementById('chart'); return chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); });
    const W = await page.evaluate(() => document.getElementById('chart').clientWidth);
    const extended = Math.abs(g1.a.bx - W) < 2 || Math.abs(g1.a.ax) < 2;
    log('§2.2 render reflects Extend=right (rail reaches a chart edge)', extended, 'a=(' + g1.a.ax.toFixed(0) + '->' + g1.a.bx.toFixed(0) + ') W=' + W);

    const levelsInput = await page.$('#drawSettings input[data-k="lv:levels"]');
    await levelsInput.fill('50');
    await levelsInput.dispatchEvent('change');
    await page.waitForTimeout(80);
    const levels = await page.evaluate(() => drawings[drawings.length - 1].levels);
    log('§1.4 Levels % (e.g. 50 = midline) writable via Properties', Array.isArray(levels) && levels.length === 1 && levels[0] === 50, 'levels=' + JSON.stringify(levels));
    const g2 = await page.evaluate(() => { const d = drawings[drawings.length - 1]; const el = document.getElementById('chart'); return chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); });
    log('§1.4 chanGeom renders one extra segment for the 50% level', g2.lv.length === 1, 'lv.length=' + g2.lv.length);
    await press('Escape');
  }
  }
}

// ============================================================ Reload persistence
{
  const before = await allDrawings();
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  const after = await allDrawings();
  const okCount = after.length === before.length;
  const lastB = before[before.length - 1], lastA = after[after.length - 1];
  const okMatch = lastA && lastB && lastA.type === 'channel' && Math.abs(lastA.p1.p - lastB.p1.p) < 1e-6 && lastA.extend === lastB.extend && JSON.stringify(lastA.levels) === JSON.stringify(lastB.levels);   // this is a straight localStorage round-trip (no mouse involved) so exact float equality is fine here
  log('§reload localStorage persistence: same drawing count after reload', okCount, 'before=' + before.length + ' after=' + after.length);
  log('§reload persisted channel keeps p1/extend/levels', !!okMatch, JSON.stringify(lastA));
}

// ============================================================ Renders correctly past the last bar
{
  const info = await page.evaluate(() => {
    const last = bars[idx];   // the LAST REVEALED bar in this replay (not bars[bars.length-1], which is future/unrevealed)
    const ts = chart.timeScale(); const opt = ts.options();
    const lastX = ts.timeToCoordinate(last.time);
    return { lastTime: last.time, lastClose: last.close, lastX, rightOffset: opt.rightOffset };
  });
  // use the app's own free-time math (logical space) instead of guessing seconds/bar
  const futT = await page.evaluate(() => logicalToTime(timeToLogical(bars[idx].time) + 2));
  const futT2 = await page.evaluate(() => logicalToTime(timeToLogical(bars[idx].time) + 4));
  const nBefore = (await state()).n;
  await armChannel();
  await clickAt(info.lastTime, info.lastClose);
  await clickAt(futT, info.lastClose + 4 * INSTR.TICK);
  await clickAt(futT2, info.lastClose - 4 * INSTR.TICK);
  await page.waitForTimeout(120);
  const s = await state();
  const dbg = await page.evaluate(() => window.__drwDbg);
  const geomOk = await page.evaluate(() => { const d = drawings[drawings.length - 1]; const el = document.getElementById('chart'); const g = chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); return g && isFinite(g.x2) && isFinite(g.y2) && isFinite(g.x4) && isFinite(g.y4); });
  log('§1.2/§future channel commits with an anchor past the last revealed bar', s.n === nBefore + 1, 'n=' + s.n);
  log('§future chanGeom produces finite pixel coords past the last bar (no null-coordinate break)', geomOk === true, 'geomOk=' + geomOk);
  log('§future paint loop counted it (no throw) — window.__drwDbg.drawn>=1', dbg && dbg.drawn >= 1, JSON.stringify(dbg));
}

// ============================================================ Survives a timeframe switch
{
  const tfOptions = await page.evaluate(() => [...document.getElementById('tfSelect').options].map(o => o.value));
  const curTf = await page.evaluate(() => String(tf));
  const other = tfOptions.find(v => v !== curTf && !v.startsWith('t'));
  const before = await allDrawings();
  if (other) {
    await page.selectOption('#tfSelect', other);
    await page.waitForTimeout(400);
    const after = await allDrawings();
    const stillThere = after.some(d => d.type === 'channel' && before.some(b => b.type === 'channel' && b.id === d.id));
    await page.evaluate(() => repaintOverlays());
    const dbg = await page.evaluate(() => window.__drwDbg);
    log('§TF-switch channel drawing (visibleTFs=null=all) survives a timeframe change', stillThere, 'tf ' + curTf + ' -> ' + other);
    log('§TF-switch repaint still renders drawings after switch (drwDbg.drawn>=1)', dbg && dbg.drawn >= 1, JSON.stringify(dbg));
    await page.selectOption('#tfSelect', curTf); // restore
    await page.waitForTimeout(200);
  } else {
    log('§TF-switch could not find a 2nd timeframe option to switch to', false, 'options=' + JSON.stringify(tfOptions));
  }
}

const nPass = R.filter(r => r.pass).length;
console.log('\n=== qa_channel_r2 SUMMARY: ' + nPass + '/' + R.length + ' PASS ===');
console.log('console/page errors captured: ' + consoleErrors.length);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 10).join('\n'));
const fails = R.filter(r => !r.pass);
if (fails.length) { console.log('\n--- FAILURES ---'); for (const f of fails) console.log('FAIL: ' + f.name + ' :: ' + f.detail); }

await browser.close();
process.exit(fails.length ? 1 : 0);
