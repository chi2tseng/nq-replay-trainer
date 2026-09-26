// QA round 3 (independent of the implementer AND of qa_channel_r1.mjs / qa_channel_r2.mjs — written from scratch against
// src/app.js source reading + exports/NT8_TRENDCHANNEL_SPEC.md). Adds REAL mouse DRAG verification of the 3 anchor
// handles + body + the non-independent L2A2/mid handles, which r1/r2 never exercised (they only counted handles).
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

async function resetAll() {
  await page.evaluate(() => {
    drawings = []; pendingPt = null; pendingPt2 = null; previewXY = null; clearSelection(); tool = '';
    keepDrawing = false; saveJSON('rt_keepdraw', false);
    magnet = 'off'; magnetMode = 'weak'; saveJSON('rt_magnet', 'off'); saveJSON('rt_magnet_mode', 'weak');
    saveJSON('rt_drawings', []); repaintOverlays(); updateToolUI();
  });
}
await resetAll();

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
async function visBars() {
  return page.evaluate(() => {
    const ts = chart.timeScale(); const vr = ts.getVisibleLogicalRange();
    const lo = Math.max(0, Math.ceil(vr.from)), hi = Math.min(idx, Math.floor(vr.to));
    const out = [];
    for (let i = lo; i <= hi; i++) if (bars[i]) out.push({ i, time: bars[i].time, open: bars[i].open, high: bars[i].high, low: bars[i].low, close: bars[i].close });
    return out;
  });
}
async function press(k) { await page.keyboard.press(k); await page.waitForTimeout(60); }

// LWC's subscribeClick gesture recognizer needs a real intermediate mousemove trail + settle time between two placement
// clicks (empirically verified against this app in r1/r2 — a fast teleport+click silently drops the 2nd/3rd click).
let _lastPt = null;
async function clickAtPixel(x, y, opts = {}) {
  if (opts.mods) for (const m of opts.mods) await page.keyboard.down(m);
  if (_lastPt) await page.mouse.move((_lastPt.x + x) / 2, (_lastPt.y + y) / 2, { steps: 5 });
  await page.mouse.move(x, y, { steps: 10 });
  await page.waitForTimeout(280);
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
  if (p.x == null || p.y == null || !isFinite(p.x) || !isFinite(p.y)) throw new Error('clickAt: bad screen point ' + JSON.stringify(p));
  return clickAtPixel(p.x, p.y, opts);
}
// Drag of an ALREADY-PLACED handle/body is driven by plain window pointermove/pointerup listeners reading clientX/clientY
// directly (app.js L1966-2006) — no LWC click-gesture recognizer involved here, so a simple down/move/up suffices.
async function dragMouse(from, to) {
  await page.mouse.move(from.x, from.y, { steps: 5 });
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.waitForTimeout(50);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(150);
}
async function armChannel() {
  await page.evaluate(() => { tool = ''; pendingPt = null; pendingPt2 = null; previewXY = null; });
  await press('Control+2');
}
async function drawFreshChannel(p1t, p1p, p2t, p2p, p3t, p3p) {
  await page.evaluate(() => { drawings = []; clearSelection(); tool = ''; pendingPt = null; pendingPt2 = null; });
  await armChannel();
  await clickAt(p1t, p1p); await clickAt(p2t, p2p); await clickAt(p3t, p3p);
  return lastDrawing();
}

const B = await visBars();
const mid = B[Math.floor(B.length / 2) - 25];
const midEnd = B[Math.floor(B.length / 2) - 8];
const INSTR = await page.evaluate(() => window.__rt.instr());
const TICK = INSTR.TICK, PXTOL = 2 * TICK;
console.log('visible bars: ' + B.length + ', anchors i=' + mid.i + '/' + midEnd.i);

// ============================================================ 0. hotkeys reach the page correctly
await press('Control+2');
{ const s = await state(); log('§0 Ctrl+2 (real keypress) arms Trend Channel tool', s.tool === 'channel', 'tool=' + s.tool); }
await press('Escape');
await press('F2');
{ const s = await state(); log('§2.1 F2 arms Line tool', s.tool === 'tl', 'tool=' + s.tool); }
await press('Escape');
await press('Alt+2');
{ const s = await state(); log('§0 Alt+2 fallback also arms Trend Channel (help text advertises Ctrl+2|Alt+2)', s.tool === 'channel', 'tool=' + s.tool); }
await press('Escape');

// ============================================================ trading hotkeys unaffected by drawing hotkeys, and vice versa
{
  await page.evaluate(() => { tool = ''; });
  const before = await page.evaluate(() => window.__rt.state().entryOrder);
  await press('F2');
  const afterF2 = await page.evaluate(() => window.__rt.state().entryOrder);
  log('TRADE-SAFETY F2 does not leak into the "f" Buy-Stop hotkey', before == null && afterF2 == null, 'before=' + JSON.stringify(before) + ' afterF2=' + JSON.stringify(afterF2));
  await press('Escape');
  await press('Control+2');
  const afterCtrl2 = await page.evaluate(() => window.__rt.state().entryOrder);
  log('TRADE-SAFETY Ctrl+2 does not leak into any trading hotkey', afterCtrl2 == null, 'afterCtrl2=' + JSON.stringify(afterCtrl2));
  await press('Escape');
  await page.evaluate(() => { tool = ''; });
  await press('f');
  const armed = await page.evaluate(() => window.__rt.state().entryOrder);
  log('TRADE-SAFETY plain "f" still fires Buy-Stop (placeBreakout) when no tool is armed', !!armed, 'entryOrder=' + JSON.stringify(armed));
  await press('x');
  const cancelled = await page.evaluate(() => window.__rt.state().entryOrder);
  log('TRADE-SAFETY "x" flattens/cancels the test order cleanly (no residue left for later sections)', cancelled == null, 'entryOrder=' + JSON.stringify(cancelled));
}
{
  // a drawing tool armed must NOT block a trading hotkey, and the trading hotkey must NOT disturb the in-progress placement
  await armChannel();
  await clickAt(mid.time, mid.low);
  const s0 = await state();
  await press('f');
  const armed = await page.evaluate(() => window.__rt.state().entryOrder);
  const s1 = await state();
  log('TRADE-SAFETY "f" still fires while Trend Channel placement is mid-flight (click 1 done)', !!armed, 'entryOrder=' + JSON.stringify(armed));
  log('TRADE-SAFETY that same "f" press left the in-progress channel placement untouched', s1.tool === 'channel' && !!s1.pendingPt && !s1.pendingPt2, JSON.stringify(s1) + ' (before=' + JSON.stringify(s0) + ')');
  await press('x'); // clean up the order
  await press('Escape'); // cancel the in-progress channel
}

// ============================================================ 1.1/1.2 three-click model, pending-only intermediate states, live preview
{
  await page.evaluate(() => { drawings = []; saveJSON('rt_drawings', []); });
  const p1 = mid.low, p2 = mid.low + 40 * TICK, p3 = mid.low - 6 * TICK;
  await armChannel();
  await clickAt(mid.time, p1);
  { const s = await state(); log('§1.1 click 1 only arms pendingPt (nothing committed)', !!s.pendingPt && !s.pendingPt2 && s.n === 0, JSON.stringify(s)); }
  const mv = await toScreen(midEnd.time, p2);
  await page.mouse.move(mv.x, mv.y, { steps: 10 }); await page.waitForTimeout(250);
  { const prev = await page.evaluate(() => previewXY && { ...previewXY }); log('§1.2 rubber-band preview tracks mousemove before click 2', !!prev, JSON.stringify(prev)); }
  await clickAt(midEnd.time, p2);
  { const s = await state(); log('§1.1 click 2 only arms pendingPt2 (still nothing committed)', !!s.pendingPt2 && s.n === 0, JSON.stringify(s)); }
  const mv2 = await toScreen(mid.time, p3);
  await page.mouse.move(mv2.x, mv2.y, { steps: 10 }); await page.waitForTimeout(250);
  { const dbg = await page.evaluate(() => window.__drwDbg && window.__drwDbg.preview); log('§1.2 click2->click3 preview shows BOTH the fixed trend line and a parallel rail through the cursor (rails:2)', !!dbg && dbg.rails === 2, JSON.stringify(dbg)); }
  await clickAt(mid.time, p3);
  const s = await state(), d = await lastDrawing();
  const ok = s.n === 1 && !s.pendingPt && !s.pendingPt2 && d.type === 'channel' &&
    Math.abs(d.p1.p - p1) < PXTOL && Math.abs(d.p2.p - p2) < PXTOL && Math.abs(d.p3.p - p3) < PXTOL;
  log('§1.1 click 3 commits Draw.TrendChannel(anchor1,anchor2,anchor3)', ok, JSON.stringify(d));
  log('§1.2 tool exits draw mode after completion (Keep drawing off)', (await state()).tool === '', 'tool=' + (await state()).tool);
  const hasParallelEnd = await page.evaluate(() => { const dd = drawings[drawings.length - 1]; return Object.prototype.hasOwnProperty.call(dd, 'p4') || Object.prototype.hasOwnProperty.call(dd, 'parallelEnd'); });
  log('§1.1 no independent ParallelEndAnchor field is stored (computed from slope, per official interface ref)', hasParallelEnd === false, 'hasOwnField=' + hasParallelEnd);
  const dbg = await page.evaluate(() => window.__drwDbg);
  log('§1.3 selected/hover-agnostic paint counts exactly 1 drawing after commit', dbg && dbg.drawn === 1, JSON.stringify(dbg));
}

// ============================================================ §1.4 no fill by default, levels empty by default
{
  const g = await page.evaluate(() => { const d = drawings[drawings.length - 1]; const el = document.getElementById('chart'); return chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); });
  log('§1.4 channel has no default Level (levels=[])', await page.evaluate(() => drawings[drawings.length - 1].levels.length === 0), 'levels empty');
  log('§1.4 chanGeom emits exactly 2 rails (a,b) when levels=[] — no midline, no fill primitive requested', Array.isArray(g.lv) && g.lv.length === 0 && !!g.a && !!g.b, 'lv.length=' + g.lv.length);
}

// ============================================================ §1.3 handle geometry: 6 visual, 3 independently draggable
{
  await page.evaluate(() => { selectDrawing(drawings[drawings.length - 1], false); repaintOverlays(); });
  const dbg = await page.evaluate(() => window.__drwDbg);
  log('§1.3 selected Trend Channel paints exactly 6 visual handles (3 per rail)', dbg && dbg.handles === 6, 'handles=' + (dbg && dbg.handles));
  const h = await page.evaluate(() => window.__rt.handles());
  log('§1.3 exactly 3 of the 6 are independently draggable anchors (L1A1/L1A2/L2A1)', Array.isArray(h) && h.length === 3, 'draggable=' + (h && h.length));
}

// ============================================================ REAL MOUSE DRAG: L1A1 (p1) — resize/rotate from this end, p3 offset RIDES ALONG (spec §1.3), p2 untouched
{
  const d0 = await drawFreshChannel(mid.time, mid.low, midEnd.time, mid.low + 40 * TICK, mid.time, mid.low - 6 * TICK);
  await page.evaluate(() => { magnet = 'off'; clearSelection(); repaintOverlays(); });
  const a = await toScreen(d0.p1.t, d0.p1.p);
  const newP1Price = d0.p1.p + 22 * TICK;
  const target = await toScreen(d0.p1.t, newP1Price); // vertical-only drag: keep the same x/time
  await dragMouse(a, target);
  const d1 = await lastDrawing();
  const p1Moved = Math.abs(d1.p1.p - newP1Price) < PXTOL;
  const p2Same = Math.abs(d1.p2.p - d0.p2.p) < PXTOL && Math.abs(d1.p2.t - d0.p2.t) < 1;
  const offsetBefore = d0.p3.p - d0.p1.p, offsetAfter = d1.p3.p - d1.p1.p;
  const offsetPreserved = Math.abs(offsetAfter - offsetBefore) < PXTOL;
  log('§1.3 dragging L1A1 (p1 handle) moves the trend-line start', p1Moved, 'p1: ' + d0.p1.p.toFixed(2) + ' -> ' + d1.p1.p.toFixed(2) + ' want ' + newP1Price.toFixed(2));
  log('§1.3 L1A1 drag leaves p2 (trend-line end) untouched', p2Same, JSON.stringify({ before: d0.p2, after: d1.p2 }));
  log('§1.3 L1A1 drag keeps the parallel offset (p3-p1) fixed — "re-slopes the parallel line in sync" per spec', offsetPreserved, 'offsetBefore=' + offsetBefore.toFixed(3) + ' offsetAfter=' + offsetAfter.toFixed(3));
}

// ============================================================ REAL MOUSE DRAG: L1A2 (p2) — same as L1A1 but pivoting from the other end; p1/p3 untouched, parallel re-slopes through fixed p3
{
  const d0 = await drawFreshChannel(mid.time, mid.low, midEnd.time, mid.low + 40 * TICK, mid.time, mid.low - 6 * TICK);
  await page.evaluate(() => { clearSelection(); repaintOverlays(); });
  const b = await toScreen(d0.p2.t, d0.p2.p);
  const newP2Price = d0.p2.p + 18 * TICK;
  const target = await toScreen(d0.p2.t, newP2Price);
  await dragMouse(b, target);
  const d1 = await lastDrawing();
  const p2Moved = Math.abs(d1.p2.p - newP2Price) < PXTOL;
  const p1Same = Math.abs(d1.p1.p - d0.p1.p) < PXTOL;
  const p3Same = Math.abs(d1.p3.p - d0.p3.p) < PXTOL && Math.abs(d1.p3.t - d0.p3.t) < 1;
  log('§1.3 dragging L1A2 (p2 handle) moves the trend-line end', p2Moved, 'p2: ' + d0.p2.p.toFixed(2) + ' -> ' + d1.p2.p.toFixed(2) + ' want ' + newP2Price.toFixed(2));
  log('§1.3 L1A2 drag leaves p1 untouched', p1Same, JSON.stringify({ before: d0.p1, after: d1.p1 }));
  log('§1.3 L1A2 drag leaves p3 (ParallelStartAnchor) untouched — the parallel rail re-slopes but still passes through the same p3', p3Same, JSON.stringify({ before: d0.p3, after: d1.p3 }));
}

// ============================================================ REAL MOUSE DRAG: L2A1 (p3) — moves the parallel line alone; p1/p2 untouched
{
  const d0 = await drawFreshChannel(mid.time, mid.low, midEnd.time, mid.low + 40 * TICK, mid.time, mid.low - 6 * TICK);
  await page.evaluate(() => { clearSelection(); repaintOverlays(); });
  const c = await toScreen(d0.p3.t, d0.p3.p);
  const newP3Price = d0.p3.p - 14 * TICK;
  const target = await toScreen(d0.p3.t, newP3Price);
  await dragMouse(c, target);
  const d1 = await lastDrawing();
  const p3Moved = Math.abs(d1.p3.p - newP3Price) < PXTOL;
  const p1Same = Math.abs(d1.p1.p - d0.p1.p) < PXTOL;
  const p2Same = Math.abs(d1.p2.p - d0.p2.p) < PXTOL;
  log('§1.3 dragging L2A1 (p3 / ParallelStartAnchor) moves the parallel line alone', p3Moved, 'p3: ' + d0.p3.p.toFixed(2) + ' -> ' + d1.p3.p.toFixed(2) + ' want ' + newP3Price.toFixed(2));
  log('§1.3 L2A1 drag leaves the trend line (p1,p2) completely untouched, per spec "does NOT change the trend line at all"', p1Same && p2Same, JSON.stringify({ p1: d1.p1, p2: d1.p2 }));
}

// ============================================================ REAL MOUSE DRAG: body mid-point translates the WHOLE channel, no shape change
{
  const d0 = await drawFreshChannel(mid.time, mid.low, midEnd.time, mid.low + 40 * TICK, mid.time, mid.low - 6 * TICK);
  await page.evaluate(() => { clearSelection(); repaintOverlays(); });
  const a1 = await toScreen(d0.p1.t, d0.p1.p), a2 = await toScreen(d0.p2.t, d0.p2.p);
  const bodyPt = { x: (a1.x + a2.x) / 2 + (a2.x - a1.x) * 0.15, y: (a1.y + a2.y) / 2 + (a2.y - a1.y) * 0.15 }; // a point ON rail a, off both endpoints (avoids the 9px handle radius)
  const target = { x: bodyPt.x + 60, y: bodyPt.y - 25 };
  await dragMouse(bodyPt, target);
  const d1 = await lastDrawing();
  const dp1 = d1.p1.p - d0.p1.p, dp2 = d1.p2.p - d0.p2.p, dp3 = d1.p3.p - d0.p3.p;
  const allMoved = Math.abs(dp1) > PXTOL && Math.abs(dp2) > PXTOL && Math.abs(dp3) > PXTOL;
  const shapePreserved = Math.abs(dp1 - dp2) < PXTOL && Math.abs(dp1 - dp3) < PXTOL;
  log('§1.3 dragging the rail body (not an anchor) translates all 3 anchors', allMoved, 'dp1=' + dp1.toFixed(2) + ' dp2=' + dp2.toFixed(2) + ' dp3=' + dp3.toFixed(2));
  log('§1.3 body-drag preserves channel shape (equal delta on all 3 anchors — "no shape change" per spec)', shapePreserved, 'dp1=' + dp1.toFixed(3) + ' dp2=' + dp2.toFixed(3) + ' dp3=' + dp3.toFixed(3));
}

// ============================================================ REAL MOUSE DRAG: L2A2 (computed 4th corner) is NOT an independent anchor — grabbing it must translate the whole object like a body-grab
{
  // wider parallel offset (30t not 6t) so the computed L2A2 point isn't pixel-adjacent to a real anchor handle (would confound the test via nearestHandle's 9px radius)
  const d0 = await drawFreshChannel(mid.time, mid.low, midEnd.time, mid.low + 40 * TICK, mid.time, mid.low - 30 * TICK);
  await page.evaluate(() => { clearSelection(); repaintOverlays(); });
  const g0 = await page.evaluate(() => { const d = drawings[drawings.length - 1]; const el = document.getElementById('chart'); return chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); });
  const rect0 = await page.evaluate(() => document.getElementById('chart').getBoundingClientRect());
  const l2a2 = { x: rect0.left + g0.x4, y: rect0.top + g0.y4 }; // chanGeom returns CANVAS-LOCAL coords; page.mouse needs page coords
  const target = { x: l2a2.x + 45, y: l2a2.y + 20 };
  await dragMouse(l2a2, target);
  const d1 = await lastDrawing();
  const dp1 = d1.p1.p - d0.p1.p, dp2 = d1.p2.p - d0.p2.p, dp3 = d1.p3.p - d0.p3.p;
  const translated = Math.abs(dp1) > PXTOL && Math.abs(dp1 - dp2) < PXTOL && Math.abs(dp1 - dp3) < PXTOL;
  log('§1.3 grabbing L2A2 (the non-anchor 6th handle) moves the whole object like a body-grab, not an independent resize', translated, 'dp1=' + dp1.toFixed(3) + ' dp2=' + dp2.toFixed(3) + ' dp3=' + dp3.toFixed(3));
}

// ============================================================ Esc / right-click mid-placement cancels
{
  await page.evaluate(() => { drawings = []; clearSelection(); });
  const n0 = (await state()).n;
  await armChannel();
  await clickAt(mid.time, mid.low);
  await press('Escape');
  const s = await state();
  log('§2.4 Esc after click 1 cancels the in-progress channel', s.tool === '' && !s.pendingPt && s.n === n0, JSON.stringify(s));
}
{
  const n0 = (await state()).n;
  await armChannel();
  await clickAt(mid.time, mid.low);
  await clickAt(midEnd.time, midEnd.high);
  const p = await toScreen(midEnd.time, midEnd.high - 5 * TICK);
  await clickAtPixel(p.x, p.y, { button: 'right' });
  const s = await state();
  log('§2.4 right-click after click 2 cancels the in-progress channel', s.tool === '' && !s.pendingPt && !s.pendingPt2 && s.n === n0, JSON.stringify(s));
}

// ============================================================ Magnet strong/weak — REAL clicks near (not on) a bar's OHLC
{
  await page.evaluate(() => { magnet = 'strong'; magnetMode = 'strong'; });
  const bar = B[8];
  await armChannel();
  await clickAt(bar.time, bar.high + 3 * TICK);
  const d = await page.evaluate(() => pendingPt && { ...pendingPt });
  log('§1.5 magnet=strong snaps a near-miss real click to the bar high', !!d && Math.abs(d.p - bar.high) < 1e-6, JSON.stringify(d) + ' want=' + bar.high);
  await press('Escape');

  await page.evaluate(() => { magnet = 'weak'; magnetMode = 'weak'; });
  const rawNear = bar.high + 2 * TICK; // inside the 12px weak-pull radius at default zoom
  await armChannel();
  await clickAt(bar.time, rawNear);
  const dw = await page.evaluate(() => pendingPt && { ...pendingPt });
  log('§1.5 magnet=weak pulls a CLOSE real click to the bar high (within its pixel radius)', !!dw && Math.abs(dw.p - bar.high) < 1e-6, JSON.stringify(dw) + ' want=' + bar.high);
  await press('Escape');

  await page.evaluate(() => { magnet = 'off'; });
  const rawFar = bar.high + 3 * TICK;
  await armChannel();
  await clickAt(bar.time, rawFar);
  const doff = await page.evaluate(() => pendingPt && { ...pendingPt });
  log('§1.5 magnet=off leaves a real click free (no snap)', !!doff && Math.abs(doff.p - rawFar) < PXTOL && Math.abs(doff.p - bar.high) > 1e-6, JSON.stringify(doff));
  await press('Escape');
}

// ============================================================ Shift constrains ONLY the trend line (click 2), 45° in pixel space; click 3 stays free
{
  await page.evaluate(() => { drawings = []; magnet = 'off'; });
  await armChannel();
  const anchor1 = await clickAt(mid.time, mid.close);
  const rawTarget = { x: anchor1.x + 100, y: anchor1.y - 108 }; // raw angle ~47°, closest to the 45° step
  await clickAtPixel(rawTarget.x, rawTarget.y, { mods: ['Shift'] });
  { const s = await state(); log('§2.4-analogue Shift on click 2 only arms pendingPt2 (nothing committed yet)', !!s.pendingPt2, JSON.stringify(s)); }
  await clickAt(mid.time, mid.close - 8 * TICK);
  const d = await lastDrawing();
  const a = await toScreen(d.p1.t, d.p1.p), b = await toScreen(d.p2.t, d.p2.p);
  const dx = b.x - a.x, dy = b.y - a.y, ratio = Math.abs(dx) < 0.5 ? Infinity : Math.abs(dy / dx);
  const ok = Math.abs(dx) < 1.5 || Math.abs(dy) < 1.5 || Math.abs(ratio - 1) < 0.08;
  log('§2.4-analogue Shift constrained the trend line (click1->click2) to a 45° pixel angle', ok, 'dx=' + dx.toFixed(1) + ' dy=' + dy.toFixed(1));
}

// ============================================================ Keep-drawing (Stay in Draw Mode) via real button click
{
  await page.evaluate(() => { drawings = []; saveJSON('rt_drawings', []); tool = ''; pendingPt = null; pendingPt2 = null; });
  await page.click('#btnKeepDraw');
  { const kd = await page.evaluate(() => keepDrawing); log('§1.2 Keep-drawing toggled ON via real click on #btnKeepDraw', kd === true, 'keepDrawing=' + kd); }
  await armChannel();
  await clickAt(mid.time, mid.low); await clickAt(midEnd.time, midEnd.high); await clickAt(mid.time, mid.low - 6 * TICK);
  { const s = await state(); log('§1.2 tool STAYS armed after completion when Keep drawing is on', s.tool === 'channel' && s.n === 1, JSON.stringify(s)); }
  await page.evaluate(() => { clearSelection(); repaintOverlays(); });
  await clickAt(mid.time, mid.high); await clickAt(midEnd.time, midEnd.low); await clickAt(mid.time, mid.high + 6 * TICK);
  { const s = await state(); log('§1.2 second channel drawn back-to-back without re-arming the tool', s.n === 2, 'n=' + s.n); }
  await page.click('#btnKeepDraw');
  { const kd = await page.evaluate(() => keepDrawing); log('§1.2 Keep-drawing toggled back OFF via real click', kd === false, 'keepDrawing=' + kd); }
  await press('Escape');
}

// ============================================================ Undo / redo (real Ctrl+Z / Ctrl+Y on the 2 channels above)
{
  const n0 = (await state()).n;
  await press('Control+z');
  const n1 = (await state()).n;
  await press('Control+y');
  const n2 = (await state()).n;
  log('§2.4-adjacent Ctrl+Z undoes the last channel placement', n1 === n0 - 1, 'n0=' + n0 + ' n1=' + n1);
  log('§2.4-adjacent Ctrl+Y redoes it back', n2 === n0, 'n2=' + n2);
}

// ============================================================ Settings panel — real dblclick on body, real form inputs
{
  const d = await lastDrawing();
  const a = await toScreen(d.p1.t, d.p1.p), b = await toScreen(d.p2.t, d.p2.p);
  await page.mouse.dblclick((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.waitForTimeout(150);
  const open = await page.evaluate(() => document.getElementById('drawSettings').classList.contains('open'));
  log('§1.4/2.4 real dblclick on channel body opens the Properties/Settings panel', open, 'open=' + open);
  if (open) {
    await page.selectOption('#drawSettings select[data-k="d:extend"]', 'right');
    await page.waitForTimeout(80);
    const ext = await page.evaluate(() => drawings[drawings.length - 1].extend);
    log('§2.2 Extend dropdown applies to the channel', ext === 'right', 'extend=' + ext);
    const g1 = await page.evaluate(() => { const dd = drawings[drawings.length - 1]; const el = document.getElementById('chart'); return chanGeom(dd, drawX, drawY, el.clientWidth, el.clientHeight); });
    const W = await page.evaluate(() => document.getElementById('chart').clientWidth);
    const extended = Math.abs(g1.a.bx - W) < 2 || Math.abs(g1.a.ax) < 2;
    log('§2.2 render reflects Extend=right (a rail reaches a chart edge)', extended, 'a=(' + g1.a.ax.toFixed(0) + '->' + g1.a.bx.toFixed(0) + ') W=' + W);
    const levelsInput = await page.$('#drawSettings input[data-k="lv:levels"]');
    if (levelsInput) {
      await levelsInput.fill('50');
      await levelsInput.dispatchEvent('change');
      await page.waitForTimeout(80);
      const levels = await page.evaluate(() => drawings[drawings.length - 1].levels);
      log('§1.4 Levels % (e.g. 50 = midline) writable via Properties', Array.isArray(levels) && levels.includes(50), 'levels=' + JSON.stringify(levels));
      const g2 = await page.evaluate(() => { const dd = drawings[drawings.length - 1]; const el = document.getElementById('chart'); return chanGeom(dd, drawX, drawY, el.clientWidth, el.clientHeight); });
      log('§1.4 chanGeom renders one extra segment for the 50% level', g2.lv.length >= 1, 'lv.length=' + g2.lv.length);
    } else log('§1.4 Levels input present in Properties panel', false, 'input[data-k="lv:levels"] not found');
    await press('Escape');
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
  const okMatch = lastA && lastB && lastA.type === 'channel' && Math.abs(lastA.p1.p - lastB.p1.p) < 1e-6 && lastA.extend === lastB.extend && JSON.stringify(lastA.levels) === JSON.stringify(lastB.levels);
  log('§reload same drawing count survives a reload (localStorage)', okCount, 'before=' + before.length + ' after=' + after.length);
  log('§reload persisted channel keeps p1/extend/levels exactly', !!okMatch, JSON.stringify(lastA));
}

// ============================================================ Renders correctly past the last revealed bar
{
  const info = await page.evaluate(() => { const last = bars[idx]; const ts = chart.timeScale(); return { lastTime: last.time, lastClose: last.close, lastX: ts.timeToCoordinate(last.time) }; });
  const futT = await page.evaluate(() => logicalToTime(timeToLogical(bars[idx].time) + 2));
  const futT2 = await page.evaluate(() => logicalToTime(timeToLogical(bars[idx].time) + 4));
  const nBefore = (await state()).n;
  await armChannel();
  await clickAt(info.lastTime, info.lastClose);
  await clickAt(futT, info.lastClose + 4 * TICK);
  await clickAt(futT2, info.lastClose - 4 * TICK);
  await page.waitForTimeout(150);
  const s = await state();
  const dbg = await page.evaluate(() => window.__drwDbg);
  const geomOk = await page.evaluate(() => { const d = drawings[drawings.length - 1]; const el = document.getElementById('chart'); const g = chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); return g && isFinite(g.x2) && isFinite(g.y2) && isFinite(g.x4) && isFinite(g.y4); });
  log('§future channel commits with an anchor placed past the last revealed bar', s.n === nBefore + 1, 'n=' + s.n);
  log('§future chanGeom produces finite pixel coords past the last bar (no null-coordinate break)', geomOk === true, 'geomOk=' + geomOk);
  log('§future paint loop drew it without throwing (window.__drwDbg.drawn>=1)', dbg && dbg.drawn >= 1, JSON.stringify(dbg));
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
    log('§TF-switch channel (visibleTFs=null=all) survives a timeframe change', stillThere, 'tf ' + curTf + ' -> ' + other);
    log('§TF-switch repaint still renders drawings after switch', dbg && dbg.drawn >= 1, JSON.stringify(dbg));
    await page.selectOption('#tfSelect', curTf);
    await page.waitForTimeout(200);
  } else {
    log('§TF-switch found a 2nd timeframe option to test', false, 'options=' + JSON.stringify(tfOptions));
  }
}

const nPass = R.filter(r => r.pass).length;
console.log('\n=== qa_channel_r3 SUMMARY: ' + nPass + '/' + R.length + ' PASS ===');
console.log('console/page errors captured: ' + consoleErrors.length);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 10).join('\n'));
const fails = R.filter(r => !r.pass);
if (fails.length) { console.log('\n--- FAILURES ---'); for (const f of fails) console.log('FAIL: ' + f.name + ' :: ' + f.detail); }

await browser.close();
process.exit(fails.length ? 1 : 0);
