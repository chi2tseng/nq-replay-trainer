// Adversarial QA — Stage 1 round 1 (TV_DRAWING_GAP.md §1.1-1.4). Independent script, does not reuse the implementer's tests.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/qa_stage1_r1.mjs   (needs http://127.0.0.1:5560/)
import { createRequire } from 'module';
const sipsRequire = createRequire('D:/SIPs/package.json');
const { chromium } = sipsRequire('playwright');

const URL = 'http://127.0.0.1:5560/';
const results = [];
const errs = [];
const report = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('dialog', d => d.accept());

async function load() {
  errs.length = 0;
  await page.goto(URL + '?r=' + Math.random(), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 100 && idx > 50, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
}
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const clickChart = async (x, y) => { const r = await chartRect(); await page.mouse.click(r.left + x, r.top + y); await page.waitForTimeout(650); };
const seed = (arr) => page.evaluate((arr) => { drawings.length = 0; selDrawing = null; for (const d of arr) drawings.push(newDrawing(d)); saveJSON('rt_drawings', drawings); repaintOverlays(); }, arr);
const darkProbe = () => page.evaluate(() => {
  const canvases = (rootId) => { const root = document.getElementById(rootId); if (!root) return []; const rr = root.getBoundingClientRect();
    return [...root.querySelectorAll('canvas')].map(c => ({ c, r: c.getBoundingClientRect() })).filter(o => o.r.width > rr.width * 0.5)
      .map(o => ({ ctx: o.c.getContext('2d'), ox: o.r.left - rr.left, oy: o.r.top - rr.top, w: o.c.width, h: o.c.height, sx: o.c.width / o.r.width, sy: o.c.height / o.r.height })); };
  const darkAt = (cs, x, y) => cs.some(({ ctx, ox, oy, w, h, sx, sy }) => { const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy); if (px < 0 || py < 0 || px >= w || py >= h) return false; const d = ctx.getImageData(px, py, 1, 1).data; return d[3] > 110 && d[0] < 90 && d[1] < 90 && d[2] < 90; });   // threshold 110 (not 200): a 1.5px anti-aliased stroke centred between two rows can split to ~75% (191) alpha per row
  window.__cs = { main: canvases('chart'), osc: canvases('oscPane') };
  window.__dark = (root, x, y) => darkAt(window.__cs[root], x, y) || darkAt(window.__cs[root], x - 1, y) || darkAt(window.__cs[root], x + 1, y) || darkAt(window.__cs[root], x, y - 1) || darkAt(window.__cs[root], x, y + 1);
});

try {
  // ---------- BOOT ----------
  await load();
  const boot = await page.evaluate(() => ({ n: bars.length, idx, tf, err: (window.__drw || {}).err, v: localStorage.getItem('rt_drawings_v') }));
  report('BOOT', boot.n > 100 && !boot.err, `bars=${boot.n} idx=${boot.idx} tf=${boot.tf} rt_drawings_v=${boot.v} consoleErrors=${errs.length}`);

  // ---------- coordinate helpers: direct unit checks ----------
  const h1 = await page.evaluate(() => {
    const b0 = bars[Math.floor(bars.length / 2)], b1 = bars[Math.floor(bars.length / 2) + 1];
    const mid = (b0.time + b1.time) / 2;
    const lgMid = timeToLogical(mid), lgExact = timeToLogical(b0.time);
    const future = bars[Math.min(idx, bars.length - 1)].time + barSpanSec() * 50;
    const lgFuture = timeToLogical(future);
    const roundTrip = logicalToTime(timeToLogical(b0.time));
    const roundTripFuture = logicalToTime(lgFuture);
    return { exactInt: Number.isInteger(lgExact), midFrac: lgMid - Math.floor(lgMid), lgFuture, roundTripOk: Math.abs(roundTrip - b0.time) < 1, roundTripFutureOk: Math.abs(roundTripFuture - future) < 1, span: barSpanSec() };
  });
  report('HELPERS-logical', h1.exactInt && h1.midFrac > 0.01 && h1.midFrac < 0.99 && h1.lgFuture > 0 && h1.roundTripOk && h1.roundTripFutureOk,
    `exact-bar logical is integer=${h1.exactInt} mid-bar fractional=${h1.midFrac.toFixed(3)} future logical=${h1.lgFuture.toFixed(2)} roundTrip(t)=${h1.roundTripOk} roundTrip(future)=${h1.roundTripFutureOk} barSpanSec=${h1.span}`);

  const h2 = await page.evaluate(() => {
    const at = bars[Math.min(idx, bars.length - 1)];
    const xExact = drawX(at.time);
    const xNative = chart.timeScale().timeToCoordinate(at.time);
    const future = at.time + barSpanSec() * 30;
    const xFuture = drawX(future);
    const xFutureNative = chart.timeScale().timeToCoordinate(future);
    // nearest-bar-time for an off-grid t (simulate a stale timestamp from another timeframe)
    const offGrid = at.time + Math.floor(barSpanSec() / 3);
    const nb = nearestBarTime(offGrid);
    return { xExact, xNative, xFuture, xFutureNative, nb, offGrid, atTime: at.time, span: barSpanSec() };
  });
  report('HELPERS-drawX', h2.xExact != null && Math.abs(h2.xExact - h2.xNative) < 1 && h2.xFuture != null && h2.xFutureNative == null && h2.xFuture > h2.xExact,
    `drawX(lastBar)=${h2.xExact?.toFixed(1)} native=${h2.xNative} drawX(future)=${h2.xFuture?.toFixed(1)} nativeFuture(should be null)=${h2.xFutureNative} nearestBarTime(offGrid)=${h2.nb} (offGrid=${h2.offGrid}, atTime=${h2.atTime})`);

  // ---------- G7: future space renders (Stage 1 scope = rendering only, click-placement is Stage 2) ----------
  await load();
  const g7 = await page.evaluate(async () => {
    const at = bars[Math.min(idx, bars.length - 1)];
    const t = at.time + barSpanSec() * 40;
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'vline', p1: { t }, color: '#000000' }));
    saveJSON('rt_drawings', drawings); repaintOverlays();
    await new Promise(r => setTimeout(r, 150));
    const lastBarX = chart.timeScale().timeToCoordinate(at.time);
    return { ok: (window.__drw || {}).ok, err: (window.__drw || {}).err, lastX: (window.__drwDbg || {}).lastX, lastBarX };
  });
  report('G7-future-render', g7.ok === true && !g7.err && typeof g7.lastX === 'number' && isFinite(g7.lastX) && g7.lastX > g7.lastBarX,
    `__drw.ok=${g7.ok} err=${g7.err} vline drawn x=${g7.lastX?.toFixed(1)} > last-bar x=${g7.lastBarX?.toFixed(1)}`);
  // also confirm the click path itself is still gated (Stage 2 not implemented) — clicking in blank future space should NOT place anything
  await load();
  const g7click = await page.evaluate(async () => { setTool('vline'); return true; });
  const rectG7 = await chartRect();
  await page.mouse.click(rectG7.left + rectG7.width - 5, rectG7.top + 30);
  await page.waitForTimeout(300);
  const g7clickCount = await page.evaluate(() => drawings.length);
  report('G7-click-gated-stage2-scope', true, `clicking blank future space with vline armed placed ${g7clickCount} drawing(s) — click-placement in future space is Stage 2 scope per gap doc; informational only, not a Stage 1 requirement`);

  // ---------- G47: cross-interval nearest bar, coordinate preserved ----------
  await load();
  await page.evaluate(() => { const s = $('tfSelect'); if (s) s.value = '1'; setTf('1'); });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => {
    const at = bars[idx - 30];
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'tl', p1: { t: at.time, p: at.close }, p2: { t: bars[idx - 20].time, p: bars[idx - 20].close }, color: '#000000' }));
    saveJSON('rt_drawings', drawings);
    return { t: drawings[0].p1.t, tf: tf };
  });
  await page.evaluate(() => { const s = $('tfSelect'); if (s) s.value = '5'; setTf('5'); });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ t: drawings[0].p1.t, tf, onGrid: bars.some(b => b.time === drawings[0].p1.t), x: drawX(drawings[0].p1.t), ok: (window.__drw || {}).ok, err: (window.__drw || {}).err }));
  report('G47-cross-interval', after.t === before.t && after.tf !== before.tf && after.x != null && after.ok === true && !after.err,
    `tf ${before.tf}->${after.tf}; p1.t unchanged=${after.t === before.t}; still on new grid=${after.onGrid}; drawX after switch=${after.x?.toFixed(1)} (non-null=renders); __drw.ok=${after.ok}`);
  // reset persisted tf back to default so it doesn't leak into later tests (rt_tf is saved to localStorage by setTf)
  await page.evaluate(() => { const s = $('tfSelect'); if (s) s.value = '1'; setTf('1'); });
  await page.waitForTimeout(200);

  // ---------- G35: ray dx===0 extends vertically, and hit-test follows ----------
  await load();
  await darkProbe();
  const g35setup = await page.evaluate(() => {
    const at = bars[idx - 10];
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'ray', p1: { t: at.time, p: at.close }, p2: { t: at.time, p: at.close + 5 }, color: '#000000' }));
    saveJSON('rt_drawings', drawings); repaintOverlays();
    return { x: drawX(at.time), y1: drawY(at.close), y2: drawY(at.close + 5) };
  });
  await page.waitForTimeout(150);
  const topDark = await page.evaluate((x) => window.__dark('main', x, 5), Math.round(g35setup.x));
  const belowP1Dark = await page.evaluate((p) => window.__dark('main', p.x, p.y1 + 40), g35setup);
  const hitAboveP2 = await page.evaluate((p) => !!drawingAt(p.x, p.y2 - 20), g35setup);
  const missAboveP1 = await page.evaluate((p) => !!drawingAt(p.x, p.y1 + 40), g35setup);
  report('G35-ray-vertical', topDark && !belowP1Dark && hitAboveP2 && !missAboveP1,
    `dx===0 ray: pixel dark near top=${topDark} (should extend up since p2>p1 price), dark below p1=${belowP1Dark} (should be false — direction is upward from p1 to p2), hit-test between p1/p2=${hitAboveP2}, hit-test beyond p1 (wrong side)=${missAboveP1}`);

  // ---------- G36: hray extends right only ----------
  await load(); await darkProbe();
  const g36 = await page.evaluate(() => {
    const at = bars[idx - 15];
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'hray', p1: { t: at.time, p: at.close }, color: '#000000' }));
    saveJSON('rt_drawings', drawings); repaintOverlays();
    return { x: drawX(at.time), y: drawY(at.close), w: document.getElementById('chart').clientWidth };
  });
  await page.waitForTimeout(150);
  const rightDark = await page.evaluate((g) => window.__dark('main', g.x + 60, g.y), g36);
  const leftDark = await page.evaluate((g) => window.__dark('main', Math.max(2, g.x - 40), g.y), g36);
  const hitRight = await page.evaluate((g) => !!drawingAt(g.x + 60, g.y), g36);
  const missLeft = await page.evaluate((g) => !!drawingAt(Math.max(2, g.x - 40), g.y), g36);
  report('G36-hray', rightDark && !leftDark && hitRight && !missLeft, `right of anchor dark=${rightDark} hit=${hitRight}; left of anchor dark=${leftDark} hit=${missLeft} (both should be false — TV hray extends right only)`);

  // ---------- G38: cross = full horiz + full vert through one point ----------
  await load(); await darkProbe();
  const g38 = await page.evaluate(() => {
    const at = bars[idx - 12];
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'cross', p1: { t: at.time, p: at.close }, color: '#000000' }));
    saveJSON('rt_drawings', drawings); repaintOverlays();
    return { x: drawX(at.time), y: drawY(at.close) };
  });
  await page.waitForTimeout(150);
  const rowDarkFar = await page.evaluate((g) => window.__dark('main', 5, g.y), g38);
  const colDarkFar = await page.evaluate((g) => window.__dark('main', g.x, 5), g38);
  const hitHorizArm = await page.evaluate((g) => !!drawingAt(g.x + 80, g.y), g38);
  const hitVertArm = await page.evaluate((g) => !!drawingAt(g.x, g.y - 40), g38);
  const missOffArms = await page.evaluate((g) => !!drawingAt(g.x + 80, g.y - 40), g38);
  report('G38-cross', rowDarkFar && colDarkFar && hitHorizArm && hitVertArm && !missOffArms,
    `full-width row dark=${rowDarkFar} full-height col dark=${colDarkFar} hit horiz arm=${hitHorizArm} hit vert arm=${hitVertArm} miss off-arms=${missOffArms}`);

  // ---------- G37: vline spans main chart AND oscillator pane ----------
  await load();
  await page.evaluate(() => { const s = $('oscSelect'); if (s) { s.value = 'rsi'; s.dispatchEvent(new Event('change')); } else { oscMode = 'rsi'; ensureOscChart(); oscBuildSeries(); } });
  await page.waitForTimeout(400);
  await darkProbe();
  const g37 = await page.evaluate(() => {
    const at = bars[Math.min(idx, bars.length - 1) - 5];
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'vline', p1: { t: at.time }, color: '#000000' }));
    saveJSON('rt_drawings', drawings); repaintOverlays();
    return { x: drawX(at.time), oscOk: !!oscChart };
  });
  await page.waitForTimeout(200);
  const mainColDark = await page.evaluate((g) => window.__dark('main', g.x, 20), g37);
  const oscXY = await page.evaluate((at) => { const oscX = (window.__drwOscDbg || {}).lastX; return { oscX, h: document.getElementById('oscPane') ? document.getElementById('oscPane').clientHeight : 0 }; }, g37.x);
  const oscColDark = oscXY.oscX != null ? await page.evaluate((x) => window.__dark('osc', x, 10), oscXY.oscX) : false;
  report('G37-vline-osc', g37.oscOk && mainColDark && oscXY.oscX != null && oscColDark,
    `oscChart exists=${g37.oscOk} main-pane col dark @x=${g37.x?.toFixed(1)}: ${mainColDark}; osc-pane vline x=${oscXY.oscX} col dark=${oscColDark} (oscPane h=${oscXY.h})`);

  // ---------- drag handle for a one-point type (vline) — select, drag, verify new t is a real bar time ----------
  await load();
  const dragSetup = await page.evaluate(() => {
    const at = bars[idx - 40];
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'vline', p1: { t: at.time }, color: '#000000' }));
    saveJSON('rt_drawings', drawings); repaintOverlays();
    return { x: drawX(at.time), y: document.getElementById('chart').clientHeight / 2, origT: at.time, targetT: bars[idx - 30].time };
  });
  const r = await chartRect();
  const xTarget = await page.evaluate((t) => drawX(t), dragSetup.targetT);
  await page.mouse.move(r.left + dragSetup.x, r.top + dragSetup.y);
  await page.mouse.down();
  await page.mouse.move(r.left + xTarget, r.top + dragSetup.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragResult = await page.evaluate(() => ({ t: drawings[0].p1.t, sel: selDrawing === drawings[0], persisted: JSON.parse(localStorage.getItem('rt_drawings'))[0].p1.t }));
  report('G37-drag-handle', dragResult.t !== dragSetup.origT && dragResult.t === dragSetup.targetT && dragResult.sel && dragResult.persisted === dragResult.t,
    `vline handle drag: origT=${dragSetup.origT} -> newT=${dragResult.t} (target=${dragSetup.targetT}) selected=${dragResult.sel} persisted=${dragResult.persisted}`);

  // ---------- migration v0 -> v1 ----------
  await load();
  await page.evaluate(() => {
    const at = bars[idx - 5];
    const v0 = [{ type: 'hl', p1: { t: at.time, p: at.close }, color: '#2962ff' }, { type: 'rr', p1: { t: at.time, p: at.close }, p2: { t: bars[idx - 4].time, p: at.close }, stop: at.close - 2, target: at.close + 4, color: '#CC4400' }];
    localStorage.removeItem('rt_drawings_v');
    localStorage.setItem('rt_drawings', JSON.stringify(v0));
  });
  await load();
  const mig = await page.evaluate(() => ({
    v: localStorage.getItem('rt_drawings_v'), n: drawings.length,
    d0: { style: drawings[0].style, color: drawings[0].color, locked: drawings[0].locked, hidden: drawings[0].hidden, z: drawings[0].z, visibleTFs: drawings[0].visibleTFs, id: drawings[0].id, p1: drawings[0].p1 },
    d1: { stop: drawings[1].stop, target: drawings[1].target, p1: drawings[1].p1, p2: drawings[1].p2, id: drawings[1].id },
    persistedV: JSON.parse(localStorage.getItem('rt_drawings'))[0].style,
  }));
  report('MIGRATION-v0-v1', mig.v === '1' && mig.n === 2 && mig.d0.style && mig.d0.style.color === '#2962ff' && mig.d0.color === '#2962ff' && mig.d0.locked === false && mig.d0.hidden === false && typeof mig.d0.z === 'number' && mig.d0.visibleTFs === null && !!mig.d0.id && mig.d1.stop != null && mig.d1.target != null && !!mig.persistedV,
    `rt_drawings_v=${mig.v} n=${mig.n} hl.style=${JSON.stringify(mig.d0.style)} color kept=${mig.d0.color} locked=${mig.d0.locked} hidden=${mig.d0.hidden} z=${mig.d0.z} visibleTFs=${mig.d0.visibleTFs} id=${mig.d0.id} rr.stop/target intact=${mig.d1.stop}/${mig.d1.target} rr.id=${mig.d1.id} persisted=${JSON.stringify(mig.persistedV)}`);

  // ---------- no drift after replaying hundreds of bars (feedWindow / seriesFrom) ----------
  // The loaded default dataset (1380 1m bars) is smaller than RENDER_WINDOW (4000, app.js:86), so a REAL
  // replay session can never push idx-seriesFrom past the 5500 re-window threshold (maybeReWindow app.js:2156-2160)
  // -> seriesFrom never moves in practice with this dataset. To still exercise the actual regression risk
  // (a drawing's pixel must not drift once seriesFrom DOES move), synthetically extend bars[] and force two
  // feedWindow() calls at different idx so seriesFrom genuinely changes while the drawing's bar stays inside
  // the fed window both times — this is what a multi-thousand-bar deep-history replay would eventually do.
  await load();
  const driftSetup = await page.evaluate(() => {
    const span = barSpanSec(), lastT = bars[bars.length - 1].time, N = 6000;
    for (let i = 1; i <= N; i++) { const p = 100 + (i % 5); bars.push({ time: lastT + i * span, open: p, high: p + 1, low: p - 1, close: p, volume: 10 }); }
    const idx0 = bars.length - 1 - 500, markIdx = idx0 - 2000, markT = bars[markIdx].time;
    drawings.length = 0; selDrawing = null;
    drawings.push(newDrawing({ type: 'hray', p1: { t: markT, p: bars[markIdx].close }, color: '#000000' }));
    saveJSON('rt_drawings', drawings);
    idx = idx0; feedWindow(false); repaintOverlays();
    return { markT, seriesFromBefore: seriesFrom, idxBefore: idx, xBefore: drawX(markT), nativeBefore: chart.timeScale().timeToCoordinate(markT), markStillAheadBy: bars.length - 1 - idx0 };
  });
  await page.evaluate(() => { idx += 400; feedWindow(false); refreshMarkers(); repaintOverlays(); });
  await page.waitForTimeout(200);
  const driftAfter = await page.evaluate((t) => ({ tSame: drawings[0].p1.t === t, x: drawX(t), seriesFromAfter: seriesFrom, idxAfter: idx, nativeX: chart.timeScale().timeToCoordinate(t) }), driftSetup.markT);
  report('NO-DRIFT-after-replay', driftSetup.xBefore != null && Math.abs(driftSetup.xBefore - driftSetup.nativeBefore) < 1 && driftAfter.tSame && driftAfter.x != null &&
      driftAfter.seriesFromAfter !== driftSetup.seriesFromBefore && driftAfter.nativeX != null && Math.abs(driftAfter.x - driftAfter.nativeX) < 1,
    `[synthetic: default dataset (1380 bars) is under RENDER_WINDOW=4000 so seriesFrom never shifts in a real session — extended bars[] to force it] ` +
    `before shift: seriesFrom=${driftSetup.seriesFromBefore} drawX=${driftSetup.xBefore?.toFixed(1)} native=${driftSetup.nativeBefore?.toFixed(1)}; ` +
    `after advancing idx by 400 (seriesFrom ${driftSetup.seriesFromBefore}->${driftAfter.seriesFromAfter}, i.e. window genuinely moved while the drawing's bar stayed inside it): ` +
    `p1.t unchanged=${driftAfter.tSame} drawX=${driftAfter.x?.toFixed(1)} vs native timeToCoordinate=${driftAfter.nativeX?.toFixed(1)} (must match)`);

  // ---------- leftbar buttons + TOOLBTN + setTool bindings ----------
  await load();
  const leftbar = await page.evaluate(() => {
    const ids = ['drwHRay', 'drwVLine', 'drwCross'];
    const missing = ids.filter(id => !$(id));
    const glyphs = ids.map(id => { const el = $(id); const sp = el ? el.querySelector('.material-symbols-outlined') : null; return sp ? sp.textContent.trim() : null; });
    return { missing, glyphs, toolbtnHasAll: ['hray', 'vline', 'cross'].every(t => !!TOOLBTN[t]) };
  });
  report('LEFTBAR-buttons', leftbar.missing.length === 0 && leftbar.toolbtnHasAll && leftbar.glyphs.every(g => g), `missing=${JSON.stringify(leftbar.missing)} glyphs=${JSON.stringify(leftbar.glyphs)} TOOLBTN complete=${leftbar.toolbtnHasAll}`);

  for (const [id, tname] of [['drwHRay', 'hray'], ['drwVLine', 'vline'], ['drwCross', 'cross']]) {
    await page.evaluate((id) => $(id).click(), id);
    const st = await page.evaluate((id) => ({ tool, active: $(id).classList.contains('active') }), id);
    report(`SETTOOL-${tname}`, st.tool === tname && st.active, `click #${id} -> tool=${st.tool} active-class=${st.active}`);
    // place one and confirm tool reverts to cursor (no keepDrawing in Stage 1)
    const at = await page.evaluate(() => bars[idx - 8]);
    const x = await page.evaluate((t) => drawX(t), at.time);
    const y = await page.evaluate((p) => drawY(p), at.close);
    await clickChart(x, y);
    const after = await page.evaluate(() => ({ tool, n: drawings.length, type: drawings[drawings.length - 1].type }));
    report(`PLACE-${tname}`, after.tool === '' && after.type === tname, `after single click: tool reverted to ''=${after.tool === ''} placed type=${after.type} totalDrawings=${after.n}`);
  }

  // ---------- REGRESSION: existing drawing types still place/select/drag/delete ----------
  // each type gets its OWN non-overlapping bar range (0..2 spacing apart is not enough — overlap makes "topmost hit-test wins"
  // ambiguous and any select assertion meaningless), spaced 12 bars apart so no two shapes' geometry can share a pixel.
  await load();
  await page.evaluate(() => { drawings.length = 0; annotations.length = 0; selDrawing = null; saveJSON('rt_drawings', drawings); saveJSON('rt_annotations', annotations); });
  const regTypes = ['hl', 'tl', 'ray', 'box', 'fib', 'measure', 'rr'];
  for (let ti = 0; ti < regTypes.length; ti++) {
    const t = regTypes[ti];
    const base = 200 - ti * 12;   // each type's p1 at idx-base, p2 (if any) at idx-base+6 — isolated lanes, zero overlap
    const btn = { hl: 'drwHL', tl: 'drwTL', ray: 'drwRay', box: 'drwBox', fib: 'drwFib', measure: 'drwMeasure', rr: 'drwRR' }[t];
    await page.evaluate((id) => $(id).click(), btn);
    const at = await page.evaluate((i) => bars[idx - i], base);
    const x1 = await page.evaluate((tm) => drawX(tm), at.time), y1 = await page.evaluate((p) => drawY(p), at.close);
    await clickChart(x1, y1);
    if (t !== 'hl' && t !== 'rr') {
      const at2 = await page.evaluate((i) => bars[idx - i], base - 6);
      const x2 = await page.evaluate((tm) => drawX(tm), at2.time), y2 = await page.evaluate((p) => drawY(p), at2.close + 6);
      await clickChart(x2, y2);
    }
  }
  const regPlaced = await page.evaluate(() => drawings.map(d => d.type));
  report('REGRESSION-place-existing-types', regTypes.every(t => regPlaced.includes(t)), `placed types=${JSON.stringify(regPlaced)} (expected all of ${JSON.stringify(regTypes)}, each in its own isolated bar lane)`);
  // select + drag the tl body, then delete it via keyboard
  const tlIdx = await page.evaluate(() => drawings.findIndex(d => d.type === 'tl'));
  const midX = await page.evaluate((i) => (drawX(drawings[i].p1.t) + drawX(drawings[i].p2.t)) / 2, tlIdx);
  const midY = await page.evaluate((i) => (drawY(drawings[i].p1.p) + drawY(drawings[i].p2.p)) / 2, tlIdx);
  const r2 = await chartRect();
  await page.mouse.click(r2.left + midX, r2.top + midY);
  await page.waitForTimeout(150);
  const selInfo = await page.evaluate((i) => ({ ok: selDrawing === drawings[i], type: selDrawing && selDrawing.type }), tlIdx);
  const origP1 = await page.evaluate((i) => JSON.stringify(drawings[i].p1), tlIdx);
  await page.mouse.move(r2.left + midX, r2.top + midY);
  await page.mouse.down();
  await page.mouse.move(r2.left + midX + 20, r2.top + midY - 15, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const movedP1 = await page.evaluate((i) => JSON.stringify(drawings[i].p1), tlIdx);
  const beforeDelCount = await page.evaluate(() => drawings.length);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
  const afterInfo = await page.evaluate((i) => ({ len: drawings.length, stillHasTl: drawings.some(d => d.type === 'tl') }), tlIdx);
  report('REGRESSION-select-drag-delete-tl', selInfo.ok && movedP1 !== origP1 && afterInfo.len === beforeDelCount - 1 && !afterInfo.stillHasTl,
    `tl selected(not another overlapping shape)=${selInfo.ok}(got type=${selInfo.type}); body drag changed p1: ${origP1}->${movedP1}; count ${beforeDelCount}->${afterInfo.len} after Delete; tl gone=${!afterInfo.stillHasTl}`);

  // ---------- REGRESSION: annotations ----------
  // Pick a bar comfortably INSIDE the current visible logical range (not just "idx-5") — the boot-time default
  // view is fitRecent(n) (app.js:245-249, unrelated to Stage 1), and its right edge can land a few bars before
  // idx depending on boot timing, so a fixed idx-5 offset occasionally targets a bar that's scrolled just off
  // the plotted area. This is a pre-existing view-fit timing detail, not something Stage 1 touched.
  await load();
  await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); });
  await page.evaluate(() => $('annUp').click());
  const upAt = await page.evaluate(() => {
    const vlr = chart.timeScale().getVisibleLogicalRange();
    const safeLi = Math.max(0, Math.floor(vlr.to) - 3);   // a few bars inside the right edge of what's actually visible
    return bars[Math.min(idx, safeLi)];
  });
  const ux = await page.evaluate((t) => chart.timeScale().timeToCoordinate(t), upAt.time);
  const uy = await page.evaluate((p) => candle.priceToCoordinate(p), upAt.low);
  await clickChart(ux, uy);
  const annCount1 = await page.evaluate(() => annotations.length);
  await page.evaluate(() => $('annLong').click());
  await clickChart(ux, uy - 30);
  const annAfter = await page.evaluate(() => ({ n: annotations.length, texts: annotations.map(a => a.text) }));
  report('REGRESSION-annotations', annCount1 === 1 && annAfter.n === 2 && annAfter.texts.includes('LONG'), `annUp -> count=${annCount1}; annLong -> count=${annAfter.n} texts=${JSON.stringify(annAfter.texts)}`);

  // ---------- REGRESSION: trading hotkeys B/S/F/J/X still work, and are not shadowed by new tool bindings ----------
  // NOTE: default #entryType is 'market' (index.html), so B/S go straight to an open `position` (not `entryOrder`,
  // which is only used by limit/stop entries and by F/J's stop-breakout path) — assert on the right variable per key.
  await load();
  await page.evaluate(() => { entryOrder = null; position = null; orders = []; tool = ''; });
  await page.keyboard.press('b');
  const afterB = await page.evaluate(() => ({ posSide: position ? position.side : null, tool }));
  await page.keyboard.press('x');
  const afterX = await page.evaluate(() => ({ pos: position, entry: entryOrder }));
  await page.keyboard.press('f');
  const afterF = await page.evaluate(() => ({ entrySide: entryOrder ? entryOrder.side : null }));
  await page.evaluate(() => { entryOrder = null; });
  await page.keyboard.press('j');
  const afterJ = await page.evaluate(() => ({ entrySide: entryOrder ? entryOrder.side : null }));
  report('REGRESSION-hotkeys', afterB.posSide === 'long' && afterX.pos == null && afterF.entrySide === 'long' && afterJ.entrySide === 'short',
    `B->opens long position(${afterB.posSide}) X->flattens(position now ${afterX.pos}) F->long stop-entry(${afterF.entrySide}) J->short stop-entry(${afterJ.entrySide})`);

  // ---------- G31/G28 informational: Alt+F / Alt+J still fall through to trading hotkeys (Stage 4 scope, not fixed yet) ----------
  await page.evaluate(() => { entryOrder = null; });
  await page.keyboard.press('Alt+f');
  const altF = await page.evaluate(() => ({ entrySide: entryOrder ? entryOrder.side : null, tool }));
  report('INFO-AltF-not-yet-remapped', true, `Alt+F still ${altF.entrySide ? 'places order (side=' + altF.entrySide + ')' : 'no order'}, tool=${altF.tool || "''"} — G31 remap is Stage 4 scope per gap doc, expected unfixed at Stage 1`);

  // ---------- final console/error check ----------
  const finalDrw = await page.evaluate(() => ({ err: (window.__drw || {}).err, oscErr: (window.__drwOsc || {}).err }));
  report('CONSOLE', errs.length === 0 && !finalDrw.err && !finalDrw.oscErr, `page/console errors=${errs.length} ${errs.slice(0, 3).join(' | ')} __drw.err=${finalDrw.err} __drwOsc.err=${finalDrw.oscErr}`);

} catch (e) {
  report('SCRIPT-ERROR', false, String(e && e.stack || e));
} finally {
  await page.screenshot({ path: 'D:/Tools/replay-trainer/exports/qa/qa_stage1_r1.png' }).catch(() => {});
  await browser.close();
}

const fails = results.filter(r => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
process.exit(fails ? 1 : 0);
