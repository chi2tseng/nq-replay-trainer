// Adversarial QA round 2 for TV_DRAWING_GAP.md Stage 3 (G12-G20, G34, G39-G43 drag guard).
// Independent script — written fresh, does not reuse or trust tv_drawing_stage3.mjs / qa_stage3_r1.mjs assertions.
// Focus: re-verify the claimed hl/vline Ctrl blocker fix at the exact pixel most likely to trigger the old bug,
// plus regressions across all 9 shape types, timeframe/day switch, and a 300-bar replay drift check.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/qa_stage3_r2.mjs   (server must be up on 127.0.0.1:5560)
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/';
const results = [];
const report = (id, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };
const errs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('dialog', d => d.accept());

async function installInk() {
  await page.evaluate(() => {
    const canvases = (rootId) => {
      const root = document.getElementById(rootId), rr = root.getBoundingClientRect();
      return [...root.querySelectorAll('canvas')].map(c => ({ c, r: c.getBoundingClientRect() })).filter(o => o.r.width > rr.width * 0.5)
        .map(o => ({ ctx: o.c.getContext('2d'), ox: o.r.left - rr.left, oy: o.r.top - rr.top, w: o.c.width, h: o.c.height, sx: o.c.width / o.r.width, sy: o.c.height / o.r.height }));
    };
    const rgbAt = (cs, x, y) => { for (let i = cs.length - 1; i >= 0; i--) { const { ctx, ox, oy, w, h, sx, sy } = cs[i]; const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy); if (px < 0 || py < 0 || px >= w || py >= h) continue; const d = ctx.getImageData(px, py, 1, 1).data; if (d[3] > 80) return [...d]; } return null; };
    const isInk = (d) => d && d[3] > 80 && (d[0] < 200 || d[1] < 200 || d[2] < 200) && !(d[0] === d[1] && d[1] === d[2] && d[0] > 200);
    window.__ptInk = (rootId, x, y, rad = 2) => { const cs = canvases(rootId); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if (isInk(rgbAt(cs, x + dx, y + dy))) return true; return false; };
    window.__colorNear = (rootId, x, y, test, rad = 2) => { const cs = canvases(rootId); const f = new Function('r', 'g', 'b', 'return ' + test); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) { const d = rgbAt(cs, x + dx, y + dy); if (d && d[3] > 80 && f(d[0], d[1], d[2])) return true; } return false; };
  });
}
async function load() {
  await page.goto(URL + '?r=' + Date.now() + Math.random(), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 200 && idx > 100, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  await installInk();
}
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const clickChart = async (x, y, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(r.left + x, r.top + y); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(650); };
const dragChart = async (x1, y1, x2, y2, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.move(r.left + x1, r.top + y1); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(r.left + x1 + (x2 - x1) * i / 8, r.top + y1 + (y2 - y1) * i / 8); await page.waitForTimeout(60); await page.mouse.up(); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(300); };
const paint = () => page.evaluate(() => new Promise(res => { repaintOverlays(); requestAnimationFrame(() => requestAnimationFrame(() => res(window.__drwDbg))); }));
const seed = (list) => page.evaluate((list) => { drawings.length = 0; for (const d of list) drawings.push(newDrawing(d)); clearSelection(); hoverDrawing = null; saveJSON('rt_drawings', drawings); repaintOverlays(); }, list);
const clear = () => page.evaluate(() => { drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); drawingsLocked = false; lockBtnUI(); if ($('drawSettings').classList.contains('open')) closeDrawSettings(); repaintOverlays(); });
const dg = (i) => page.evaluate((i) => { const d = drawings[i]; if (!d) return null; return { type: d.type, t1: d.p1.t, p1: d.p1 ? d.p1.p : null, t2: d.p2 && d.p2.t, p2: d.p2 && d.p2.p, x1: drawX(d.p1.t), y1: drawY(d.p1.p), x2: d.p2 ? drawX(d.p2.t) : null, y2: d.p2 ? drawY(d.p2.p) : null, id: d.id, locked: d.locked }; }, i);
const TOOLID = { tl: 'drwTL', ray: 'drwRay', hl: 'drwHL', box: 'drwBox', fib: 'drwFib', measure: 'drwMeasure', rr: 'drwRR', hray: 'drwHRay', vline: 'drwVLine', cross: 'drwCross' };

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); localStorage.setItem('rt_magnet', '"off"'); localStorage.setItem('rt_lockdrw', 'false'); localStorage.setItem('rt_keepdraw', 'false'); localStorage.setItem('rt_annotations', '[]'); });
  await load();
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx, tf, nBars: bars.length }));
  const k = geo.idx - 60;

  report('LOAD', errs.length === 0, `console errors on boot=${errs.length} ${errs.slice(0, 3).join(' | ')}`);

  // ===================================================================================================
  // BLOCKER re-verify — the exact scenario the fix targets: Ctrl+click / Ctrl+drag ON the visual anchor
  // pixel of hl / vline (hpts(): hl at x=W/2, vline at x=X(t)). This is the pixel where nearestHandle's
  // one-axis-only hit test would have hijacked every Ctrl press before the fix.
  // ===================================================================================================
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    const tlXa = await barX(k - 10), tlXb = await barX(k + 10);
    await seed([{ type: 'tl', p1: { t: await page.evaluate((k) => bars[k - 10].time, k), p: await page.evaluate(() => candle.coordinateToPrice(200)) }, p2: { t: await page.evaluate((k) => bars[k + 10].time, k), p: await page.evaluate(() => candle.coordinateToPrice(220)) }, color: '#000000' },
             { type: 'hl', p1: { t: t0, p: await page.evaluate(() => candle.coordinateToPrice(350)) }, color: '#d1d4dc' }]);
    const A0 = await dg(0), B0 = await dg(1);
    const hlY = B0.y1, hlAnchorX = geo.W / 2;   // hpts() draws the hl's single handle dot at (W/2, Y(price))
    // select A normally
    await clickChart((A0.x1 + A0.x2) / 2, (A0.y1 + A0.y2) / 2);
    const afterA = await page.evaluate(() => ({ sel: selDrawing && selDrawing.type, size: selSet.size }));
    // Ctrl+click exactly on the hl's visual handle pixel
    await clickChart(hlAnchorX, hlY, ['Control']);
    const afterCtrlClick = await page.evaluate(() => ({ size: selSet.size, primary: selDrawing && selDrawing.type, hlUnmoved: drawings[1].p1.p }));
    // Ctrl+drag starting at a DIFFERENT x on the same hl line (still same y) -> must clone, not drag-the-anchor-in-place
    await dragChart(geo.W * 0.2, hlY, geo.W * 0.2 + 60, hlY + 35, ['Control']);
    const n = await page.evaluate(() => drawings.length);
    const B0b = await dg(1), clone = await dg(2);
    const origUnchanged = B0b && Math.abs(B0b.p1 - B0.p1) < 1e-9 && B0b.t1 === B0.t1;
    const cloneMoved = clone && Math.abs(clone.p1 - B0.p1) > 5;
    report('BLOCKER-ctrl-hl', afterA.sel === 'tl' && afterCtrlClick.size === 2 && afterCtrlClick.primary === 'hl' && afterCtrlClick.hlUnmoved === B0.p1 &&
      n === 3 && origUnchanged && cloneMoved,
      `select A(tl); Ctrl+click hl at its handle pixel (${hlAnchorX.toFixed(0)},${hlY.toFixed(0)}): selSet=${afterCtrlClick.size} primary=${afterCtrlClick.primary} hl price unmoved=${afterCtrlClick.hlUnmoved === B0.p1}; Ctrl-drag hl body (+60,+35) from a different x: drawings ${n === 3 ? '2->3' : '2->' + n}; original hl unchanged=${origUnchanged} (p1 ${B0.p1}->${B0b && B0b.p1}); clone moved=${cloneMoved}`);
  }
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    const rXa = await page.evaluate(() => candle.coordinateToPrice(150)), rXb = await page.evaluate(() => candle.coordinateToPrice(180));
    await seed([{ type: 'ray', p1: { t: await page.evaluate((k) => bars[k - 10].time, k), p: rXa }, p2: { t: await page.evaluate((k) => bars[k + 5].time, k), p: rXb }, color: '#000000' },
                { type: 'vline', p1: { t: t0 }, color: '#d1d4dc' }]);
    const A0 = await dg(0), V0 = await dg(1);
    const vAnchorX = V0.x1, vAnchorY = geo.H / 2;   // hpts() for vline: (X(t), H/2)
    await clickChart((A0.x1 + A0.x2) / 2, (A0.y1 + A0.y2) / 2);
    // Ctrl+click exactly on the vline's visual handle pixel
    await clickChart(vAnchorX, vAnchorY, ['Control']);
    const afterCtrlClick = await page.evaluate(() => ({ size: selSet.size, primary: selDrawing && selDrawing.type, vUnmoved: drawings[1].p1.t }));
    // Ctrl+drag starting at a DIFFERENT y on the same vline (still same x) -> must clone
    await dragChart(vAnchorX, geo.H * 0.2, vAnchorX + 55, geo.H * 0.2 + 30, ['Control']);
    const n = await page.evaluate(() => drawings.length);
    const V0b = await dg(1), clone = await dg(2);
    const origUnchanged = V0b && V0b.t1 === V0.t1;
    const cloneMoved = clone && clone.t1 !== V0.t1;
    report('BLOCKER-ctrl-vline', afterCtrlClick.size === 2 && afterCtrlClick.primary === 'vline' && afterCtrlClick.vUnmoved === V0.t1 &&
      n === 3 && origUnchanged && cloneMoved,
      `Ctrl+click vline at its handle pixel (${vAnchorX.toFixed(0)},${vAnchorY.toFixed(0)}): selSet=${afterCtrlClick.size} primary=${afterCtrlClick.primary} time unmoved=${afterCtrlClick.vUnmoved === V0.t1}; Ctrl-drag vline body from a different y: drawings ${n === 3 ? '2->3' : '2->' + n}; original unchanged=${origUnchanged}; clone moved=${cloneMoved}`);
  }

  // Regression: plain (no-Ctrl) anchor drag on hl / vline must still work — the fix must not have broken the non-Ctrl path
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'hl', p1: { t: t0, p: await page.evaluate(() => candle.coordinateToPrice(300)) }, color: '#000000' }]);
    const b = await dg(0);
    await dragChart(geo.W / 2, b.y1, geo.W / 2, b.y1 - 50);
    const a = await dg(0);
    report('REGRESSION-hl-anchor-drag', a.p1 !== b.p1 && Math.abs((a.y1) - (b.y1 - 50)) < 3, `no-Ctrl drag on hl handle (0,-50)px: price ${b.p1}->${a.p1}, y ${b.y1.toFixed(1)}->${a.y1.toFixed(1)}`);
  }
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'vline', p1: { t: t0 }, color: '#000000' }]);
    const b = await dg(0);
    await dragChart(b.x1, geo.H / 2, b.x1 + 45, geo.H / 2);
    const a = await dg(0);
    report('REGRESSION-vline-anchor-drag', a.t1 !== b.t1 && Math.abs(a.x1 - (b.x1 + 45)) < 3, `no-Ctrl drag on vline handle (+45,0)px: time ${b.t1}->${a.t1}, x ${b.x1.toFixed(1)}->${a.x1.toFixed(1)}`);
  }

  // G9 regression on hl specifically: mousedown WITHOUT Ctrl starts an anchor drag; pressing Ctrl mid-drag inverts magnet.
  // The bar the magnet snaps to is whichever bar sits under the drag's CURRENT x (xToFreeTime), not necessarily bar k —
  // so the target bar/OHLC set is looked up the same way the app does it, via page.evaluate, not assumed from outside.
  await clear();
  {
    await page.evaluate(() => { magnet = 'off'; magnetMode = 'strong'; });
    const setup = await page.evaluate((wHalf) => {
      const ft = xToFreeTime(wHalf), bi = nearestBarIdx(ft), b = bars[bi];
      const price = candle.coordinateToPrice(300);   // an arbitrary starting price, far from this bar's OHLC
      drawings.length = 0; drawings.push(newDrawing({ type: 'hl', p1: { t: b.time, p: price }, color: '#000000' }));
      saveJSON('rt_drawings', drawings); repaintOverlays();
      return { bi, o: b.open, h: b.high, l: b.low, c: b.close, y1: drawY(price) };   // y1 must be the PIXEL for the assigned price, not the literal 300
    }, geo.W / 2);
    const ohlc = [setup.o, setup.h, setup.l, setup.c];
    const nearest = (p) => ohlc.reduce((a, v) => Math.abs(v - p) < Math.abs(a - p) ? v : a, ohlc[0]);
    // pick a y between the bar's high and the next tick above it, clearly off every OHLC value
    const targetY = await page.evaluate((h) => candle.priceToCoordinate(h) - 22, setup.h);
    const r = await chartRect();
    await page.mouse.move(r.left + geo.W / 2, r.top + setup.y1); await page.mouse.down();
    await page.mouse.move(r.left + geo.W / 2, r.top + targetY); await page.waitForTimeout(80);
    const freePrice = await page.evaluate(() => drawings[0].p1.p);
    await page.keyboard.down('Control'); await page.mouse.move(r.left + geo.W / 2, r.top + targetY - 1); await page.waitForTimeout(80);
    const snappedPrice = await page.evaluate(() => drawings[0].p1.p);
    await page.keyboard.up('Control'); await page.mouse.up(); await page.waitForTimeout(150);
    const expectSnap = nearest(freePrice);
    report('G9-hl-ctrl-invert-middrag', !ohlc.some(v => Math.abs(v - freePrice) < 0.001) && Math.abs(snappedPrice - expectSnap) < 0.001,
      `bar#${setup.bi} OHLC=[${ohlc.join(',')}]; free price=${freePrice} (must not equal any OHLC); Ctrl mid-drag -> snapped=${snappedPrice}, nearest-OHLC-to-freePrice=${expectSnap}`);
  }

  // ===================================================================================================
  // G12: handles only rendered when selected/hovered — spot-check vline + box (stage3 script covered tl/measure/rr)
  // ===================================================================================================
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'vline', p1: { t: t0 }, color: '#000000' }]);
    const g = await dg(0);
    await clickChart(geo.W * 0.9, geo.H * 0.9);   // deselect (empty space)
    let dbg = await paint();
    const unselHandles = dbg.handles;
    // vline's own handle sits at (x, H/2) using the primitive's INTERNAL mediaSize.height, which is shorter than
    // #chart's DOM clientHeight (the time-axis strip is outside the plot canvas) — read the true H back from the
    // bbox the app itself computed (bb.y1 = H for a selected vline, per app.js) instead of assuming clientHeight.
    const unselInk = await page.evaluate(([x, y]) => window.__colorNear('chart', x, y, 'b > 180 && r < 140', 2), [g.x1, geo.H / 2]);
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); });
    dbg = await paint();
    const handleY = (dbg.bbox.y0 + dbg.bbox.y1) / 2;
    const selInk = await page.evaluate(([x, y]) => window.__colorNear('chart', x, y, 'b > 180 && r < 140', 2), [g.x1, handleY]);
    report('G12-vline', unselHandles === 0 && !unselInk && dbg.handles === 1 && selInk, `deselected: handles=${unselHandles} blue-ink@DOM-H/2=${unselInk}; selected: handles=${dbg.handles} blue-ink@true-handle-y(${handleY.toFixed(1)})=${selInk} (bbox=${JSON.stringify(dbg.bbox)})`);
  }
  await clear();
  {
    const xa = await barX(k), xb = await barX(k + 10);
    await page.click('#drwBox'); await clickChart(xa, geo.H * 0.3); await clickChart(xb, geo.H * 0.5);
    const g = await dg(0);
    await clickChart(geo.W * 0.95, geo.H * 0.95);
    let dbg = await paint();
    const unsel = dbg.handles;
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); });
    dbg = await paint();
    report('G12-box', unsel === 0 && dbg.handles === 4, `box deselected handles=${unsel}; selected handles=${dbg.handles} (4 corners expected)`);
  }

  // ===================================================================================================
  // G14/G15/G16 with different tools than the implementer's own test (ray instead of tl; fib body-drag axis lock)
  // ===================================================================================================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.35;
    await page.click('#drwRay'); await clickChart(xa, ya);
    await page.keyboard.down('Shift'); await clickChart(xa + 100, ya + 100); await page.keyboard.up('Shift');
    const g = await dg(0);
    const ratio = Math.abs((g.y2 - g.y1) / (g.x2 - g.x1));
    report('G14-ray-shift45', g.type === 'ray' && Math.abs(ratio - 1) < 0.03, `ray 2nd click dx=100 dy=100 (already 45°, sanity) with Shift held -> |dy/dx|=${ratio.toFixed(3)}`);
    await clear();
    await page.click('#drwRay'); await clickChart(xa, ya);
    // dx=100 dy=70 -> 35°, closer to the 45° multiple than to 0° -> shiftConstrain must round UP to 45°, not snap to horizontal
    await page.keyboard.down('Shift'); await clickChart(xa + 100, ya + 70); await page.keyboard.up('Shift');
    const g2 = await dg(0);
    const ratio2 = Math.abs((g2.y2 - g2.y1) / (g2.x2 - g2.x1));
    report('G14-ray-shift45-offaxis', Math.abs(ratio2 - 1) < 0.03, `ray 2nd click dx=100 dy=70 (35°, nearest 45°-multiple is 45 not 0) with Shift -> snapped |dy/dx|=${ratio2.toFixed(3)} (want ~1.0)`);
  }
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await page.click('#drwFib'); await clickChart(xa, ya); await clickChart(xa + 80, ya + 60);
    const b = await dg(0);
    // fib's body hit-test only fires on a level line or the anchor-to-anchor diagonal (drawingAt, app.js) — grab
    // the exact midpoint of that diagonal so the drag reliably starts a body-move rather than a chart pan
    const gx = (b.x1 + b.x2) / 2, gy = (b.y1 + b.y2) / 2;
    await dragChart(gx, gy, gx + 55, gy + 35, ['Shift']);
    const a = await dg(0);
    const dt = a.t1 !== b.t1 || a.t2 !== b.t2, dp = Math.abs(a.p1 - b.p1) > 1e-9 || Math.abs(a.p2 - b.p2) > 1e-9;
    report('G15-fib-shiftdrag-axislock', dt && !dp, `Shift-drag fib body by (+55,+35)px [dominant axis=x]: time fields changed=${dt}, price fields changed=${dp} (want time only)`);
  }

  // ===================================================================================================
  // G18 clone for box + fib (different types than tl)
  // ===================================================================================================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await page.click('#drwBox'); await clickChart(xa, ya); await clickChart(xa + 90, ya + 60);
    const o = await dg(0);
    // box body hit-test (drawingAt, app.js) only fires near an EDGE or the middle line, never the open interior —
    // grab the top edge midpoint (same technique the implementer's own G15/G43 tests use for box)
    const gx = (o.x1 + o.x2) / 2, gy = Math.min(o.y1, o.y2);
    await dragChart(gx, gy, gx + 45, gy + 25, ['Control']);
    const n = await page.evaluate(() => drawings.length);
    const o2 = await dg(0), c = await dg(1);
    report('G18-box-clone', n === 2 && o2.t1 === o.t1 && o2.p1 === o.p1 && c && Math.abs(c.x1 - o.x1 - 45) < 3 && o2.id !== c.id,
      `Ctrl-drag box body (+45,+25): drawings=${n}; original unchanged=${o2.t1 === o.t1 && o2.p1 === o.p1}; clone dx=${c ? (c.x1 - o.x1).toFixed(1) : 'n/a'}`);
  }

  // ===================================================================================================
  // G19/G20 multiselect across MIXED types (hl + box) + group drag + group delete
  // ===================================================================================================
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    const xa = await barX(k), ya = geo.H * 0.3;
    await seed([{ type: 'hl', p1: { t: t0, p: await page.evaluate(() => candle.coordinateToPrice(250)) }, color: '#000000' }]);
    await page.click('#drwBox'); await clickChart(xa, ya + 150); await clickChart(xa + 90, ya + 200);
    const H0 = await dg(0), B0 = await dg(1);
    const bgx = (B0.x1 + B0.x2) / 2, bgy = Math.min(B0.y1, B0.y2);   // box hit-test is edge-only (see G18 note above)
    await clickChart(geo.W / 2, H0.y1);                 // select hl
    await clickChart(bgx, bgy, ['Control']);   // add box (top edge)
    const s1 = await page.evaluate(() => ({ size: selSet.size, primary: selDrawing && selDrawing.type }));
    await dragChart(bgx, bgy, bgx + 30, bgy - 40);
    const H1 = await dg(0), B1 = await dg(1);
    const hlMoved = Math.abs(H1.p1 - H0.p1) > 0.01, boxMoved = Math.abs(B1.x1 - B0.x1 - 30) < 3;
    await page.keyboard.press('Delete'); await page.waitForTimeout(200);
    const n = await page.evaluate(() => drawings.length);
    report('G19-G20-mixed-types', s1.size === 2 && hlMoved && boxMoved && n === 0,
      `select hl + Ctrl-click box: selSet=${s1.size}; group drag (+30,-40): hl price moved=${hlMoved}, box x moved=${boxMoved} (dx=${(B1.x1 - B0.x1).toFixed(1)}); Delete -> drawings=${n}`);
  }

  // ===================================================================================================
  // G34 trend line Extend LEFT (not 'both') + arrowStart (not arrowEnd) — different combo than the implementer's test
  // ===================================================================================================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.4;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xa + 130, ya + 25);
    const g = await dg(0);
    const slope = (g.y2 - g.y1) / (g.x2 - g.x1), yAt = (x) => g.y1 + slope * (x - g.x1);
    // black-specific match, not generic "ink": the extrapolated line crosses real candle bodies (red/green), which
    // are themselves non-white "ink" under a loose brightness test and would falsely read as the line's own pixels.
    const BLACK = 'r < 60 && g < 60 && b < 60';
    const rightBefore = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [g.x2 + 70, yAt(g.x2 + 70), BLACK]);
    await page.evaluate(() => { drawings[0].extend = 'left'; repaintOverlays(); }); await paint();
    const leftAfter = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [g.x1 - 70, yAt(g.x1 - 70), BLACK]);
    const rightAfter = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [g.x2 + 70, yAt(g.x2 + 70), BLACK]);
    // arrowStart's tip is drawn at whichever pixel is the CURRENT p1-side terminus — with extend='left' that terminus
    // moves off to the chart edge, so the arrowhead check must run with extend='none' (a true, unmoved terminus at p1),
    // exactly mirroring how the implementer's own G34 test resets extend before checking its arrowEnd wing.
    await page.evaluate(() => { drawings[0].extend = 'none'; drawings[0].arrowStart = true; repaintOverlays(); }); await paint();
    const a = Math.atan2(g.y2 - g.y1, g.x2 - g.x1), w = Math.PI / 7, wing = [g.x1 + 8 * Math.cos(a - 0.6 * w), g.y1 + 8 * Math.sin(a - 0.6 * w)];
    const arrowAtStart = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 0), [...wing, BLACK]);
    await page.evaluate(() => { drawings[0].arrowStart = false; repaintOverlays(); }); await paint();
    const noArrow = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 0), [...wing, BLACK]);
    report('G34-extendLeft-arrowStart', !rightBefore && leftAfter && !rightAfter && arrowAtStart && !noArrow,
      `extend='left': left-of-p1 black-ink=${leftAfter}, right-of-p2 black-ink=${rightAfter} (before extend right had black-ink=${rightBefore}); extend reset to 'none', arrowStart wing black-ink=${arrowAtStart} -> after arrowStart off=${!noArrow}`);
  }

  // ===================================================================================================
  // G39 rectangle Extend LEFT + middle line (implementer tested extendRight; this checks extendLeft)
  // ===================================================================================================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await page.click('#drwBox'); await clickChart(xa, ya); await clickChart(xa + 100, ya + 70);
    const g = await dg(0), top = Math.min(g.y1, g.y2), ym = (g.y1 + g.y2) / 2, xm = (g.x1 + g.x2) / 2;
    const leftEdgeX = 15;
    const b4 = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [leftEdgeX, top]);
    await page.evaluate(() => { drawings[0].extendLeft = true; drawings[0].middleLine = true; repaintOverlays(); }); await paint();
    const af = await page.evaluate(([x, y]) => ({ ink: window.__ptInk('chart', x, y, 1), hit: drawingAt(x, y) && drawingAt(x, y).type }), [leftEdgeX, top]);
    const midAf = await page.evaluate(([x, y]) => ({ ink: window.__ptInk('chart', x, y, 1), hit: drawingAt(x, y) && drawingAt(x, y).type }), [xm, ym]);
    report('G39-extendLeft-middleLine', !b4 && af.ink && af.hit === 'box' && midAf.ink && midAf.hit === 'box',
      `left edge at x=${leftEdgeX}: before=${b4} after extendLeft=${af.ink} hit=${af.hit}; middle line at box centre ink=${midAf.ink} hit=${midAf.hit}`);
  }

  // ===================================================================================================
  // G40 fib: interact with the REAL settings-panel checkboxes (not programmatic mutation) for level toggle + reverse
  // ===================================================================================================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await page.click('#drwFib'); await clickChart(xa, ya + 60); await clickChart(xa + 90, ya);
    const def = await page.evaluate(() => fibLevels(drawings[0]).map(f => f.lv));
    await page.evaluate(() => { selectDrawing(drawings[0], false); openDrawSettings(drawings[0], 'style'); });
    const cb5 = await page.evaluate(() => { const els = [...document.querySelectorAll('#drawSettings [data-k^="fib:"]')]; return els.map(e => e.dataset.k); });
    await page.evaluate(() => { const el = document.querySelector('#drawSettings [data-k="fib:0.5"]'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const after5 = await page.evaluate(() => fibLevels(drawings[0]).map(f => f.lv));
    await page.evaluate(() => { const el = document.querySelector('#drawSettings [data-k="d:reverse"]'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const reversed = await page.evaluate(() => drawings[0].reverse);
    await page.evaluate(() => closeDrawSettings());
    report('G40-fib-settings-ui', def.join(',') === '0.236,0.382,0.618,1' && cb5.length >= 9 && after5.includes(0.5) && reversed === true,
      `default via UI query=${def.join('/')}; checkbox list has ${cb5.length} fib: entries; after checking 0.5 -> levels=${after5.join('/')}; Reverse checkbox -> d.reverse=${reversed}`);
  }

  // ===================================================================================================
  // G43 lock blocks GROUP drag too, not just a single selection (the implementer's test only checked single)
  // ===================================================================================================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xa + 100, ya + 20);
    await page.click('#drwTL'); await clickChart(xa, ya + 100); await clickChart(xa + 100, ya + 120);
    const A0 = await dg(0), B0 = await dg(1);
    await clickChart((A0.x1 + A0.x2) / 2, (A0.y1 + A0.y2) / 2);
    await clickChart((B0.x1 + B0.x2) / 2, (B0.y1 + B0.y2) / 2, ['Control']);
    await page.click('#btnLockDrw');
    await dragChart((A0.x1 + A0.x2) / 2, (A0.y1 + A0.y2) / 2, (A0.x1 + A0.x2) / 2 + 40, (A0.y1 + A0.y2) / 2 + 20);
    const A1 = await dg(0), B1 = await dg(1);
    const stillSel = await page.evaluate(() => selSet.size);
    await page.click('#btnLockDrw');
    report('G43-lock-blocks-group-drag', A1.t1 === A0.t1 && A1.p1 === A0.p1 && B1.t1 === B0.t1 && B1.p1 === B0.p1 && stillSel === 2,
      `2 selected, lock on, drag A: A moved=${A1.t1 !== A0.t1 || A1.p1 !== A0.p1}, B moved=${B1.t1 !== B0.t1 || B1.p1 !== B0.p1}, selSet after=${stillSel} (selection must survive, only drag blocked)`);
  }

  // ===================================================================================================
  // Settings panel opened via the FLOATING TOOLBAR's Settings button (implementer's own test only used dblclick)
  // ===================================================================================================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await page.click('#drwBox'); await clickChart(xa, ya); await clickChart(xa + 100, ya + 60);
    await clickChart((await dg(0)).x1 + 5, (await dg(0)).y1 + 5);   // select (corner-ish, inside body hit range near edge)
    // ensure selected via body click at center instead (more reliable)
    const g = await dg(0);
    await clickChart((g.x1 + g.x2) / 2, g.y1);   // top edge midpoint -> body/edge hit
    await paint();
    const tbVisible = await page.locator('#drawToolbar').isVisible();
    await page.click('#dtSettings');
    const ds = await page.evaluate(() => ({ open: document.getElementById('drawSettings').classList.contains('open'), tabs: [...document.querySelectorAll('#drawSettings .ds-tab')].map(b => b.textContent), sel: selDrawing && selDrawing.type }));
    await page.evaluate(() => closeDrawSettings());
    report('G13-settings-via-toolbar', tbVisible && ds.open && ds.tabs.join(',') === 'Style,Coordinates,Visibility' && ds.sel === 'box', `toolbar visible=${tbVisible}; #dtSettings click -> panel open=${ds.open} tabs=${ds.tabs.join('/')} sel=${ds.sel}`);
  }

  // ===================================================================================================
  // Full regression matrix: place / select / drag(body) / delete for all 9 drawing types
  // ===================================================================================================
  const shapeResults = [];
  for (const type of ['tl', 'ray', 'hl', 'box', 'fib', 'measure', 'rr', 'hray', 'vline', 'cross']) {
    await clear();
    const xa = await barX(k), ya = geo.H * 0.4;
    await page.click('#' + TOOLID[type]);
    await clickChart(xa, ya);
    if (['tl', 'ray', 'box', 'fib', 'measure'].includes(type)) await clickChart(xa + 90, ya + 45);
    const placed = await page.evaluate(() => drawings.length === 1 && drawings[0].type);
    const g = await dg(0);
    let selX, selY;
    if (type === 'hl') { selX = geo.W / 2; selY = g.y1; }
    else if (type === 'vline') { selX = g.x1; selY = geo.H / 2; }
    else if (type === 'hray') { selX = g.x1 + 30; selY = g.y1; }
    else if (type === 'cross') { selX = g.x1 + 30; selY = g.y1; }
    else if (type === 'rr') { const r = await page.evaluate(() => rrRange(drawings[0], drawX)); selX = (r.xa + r.xb) / 2; selY = g.y1; }
    else if (type === 'box') { selX = (g.x1 + g.x2) / 2; selY = Math.min(g.y1, g.y2); }   // box hit-test is edge-only, not fill-interior (see G18 note)
    else { selX = (g.x1 + g.x2) / 2; selY = (g.y1 + g.y2) / 2; }
    await clickChart(selX, selY);
    const selType = await page.evaluate(() => selDrawing && selDrawing.type);
    await dragChart(selX, selY, selX + 35, selY + 20);
    const g2 = await dg(0);
    const moved = type === 'hl' ? g2.p1 !== g.p1 : type === 'vline' ? g2.t1 !== g.t1 : (g2.t1 !== g.t1 || g2.p1 !== g.p1 || g2.t2 !== g.t2 || g2.p2 !== g.p2);
    await page.keyboard.press('Delete'); await page.waitForTimeout(150);
    const n = await page.evaluate(() => drawings.length);
    const ok = placed === type && selType === type && moved && n === 0;
    shapeResults.push(ok);
    report(`REGRESSION-shape-${type}`, ok, `placed=${placed}; select@(${selX.toFixed(0)},${selY.toFixed(0)})->${selType}; body-drag(+35,+20) moved=${moved}; Delete -> n=${n}`);
  }

  // ===================================================================================================
  // Annotation tools + trading hotkeys (must still work — untouched by the Stage 3 change)
  // ===================================================================================================
  await clear();
  {
    const n0 = await page.evaluate(() => annotations.length);
    for (const id of ['annUp', 'annDown', 'annLong', 'annShort']) { await page.click('#' + id); await clickChart(await barX(k), geo.H * 0.5); }
    const n1 = await page.evaluate(() => ({ n: annotations.length, tool, shapes: annotations.map(a => a.shape) }));
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(); });
    report('REGRESSION-annotations', n1.n === n0 + 4 && n1.tool === '', `4 annotation clicks: ${n0}->${n1.n}, tool after='${n1.tool}', shapes=${n1.shapes.join(',')}`);
  }
  await clear();
  {
    await page.keyboard.press('f'); await page.waitForTimeout(150);
    const eo = await page.evaluate(() => window.__rt.entryOrderInfo());
    await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    await page.keyboard.press('j'); await page.waitForTimeout(150);
    const eo2 = await page.evaluate(() => window.__rt.entryOrderInfo());
    await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    await page.keyboard.press('b'); await page.waitForTimeout(150);
    const posLong = await page.evaluate(() => window.__rt.state().pos);
    await page.keyboard.press('x'); await page.waitForTimeout(150);
    const flat1 = await page.evaluate(() => window.__rt.state().pos);
    await page.keyboard.press('s'); await page.waitForTimeout(150);
    const posShort = await page.evaluate(() => window.__rt.state().pos);
    await page.keyboard.press('x'); await page.waitForTimeout(150);
    const flat2 = await page.evaluate(() => window.__rt.state().pos);
    report('REGRESSION-hotkeys', eo && eo.side === 'long' && eo.kind === 'stop' && eo2 && eo2.side === 'short' && eo2.kind === 'stop' && posLong && posLong.side === 'long' && !flat1 && posShort && posShort.side === 'short' && !flat2,
      `F->${eo && eo.side + '/' + eo.kind}; J->${eo2 && eo2.side + '/' + eo2.kind}; B->pos=${posLong && posLong.side}; X->flat=${!flat1}; S->pos=${posShort && posShort.side}; X->flat=${!flat2}`);
  }

  // ===================================================================================================
  // Timeframe switch + day switch: no exceptions, __drw stays healthy, a drawing's stored timestamp is untouched
  // ===================================================================================================
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'hl', p1: { t: t0, p: await page.evaluate(() => candle.coordinateToPrice(300)) }, color: '#000000' }]);
    const before = await dg(0);
    const opts = await page.$$eval('#tfSelect option', els => els.map(e => e.value));
    const curTf = await page.evaluate(() => String(tf));
    const other = opts.find(v => v !== curTf && !v.startsWith('t')) || opts.find(v => v !== curTf);
    const e0 = errs.length;
    await page.selectOption('#tfSelect', other); await page.waitForTimeout(500);
    const afterTf = await dg(0);
    const health1 = await page.evaluate(() => ({ ok: window.__drw && window.__drw.ok, err: window.__drw && window.__drw.err }));
    await page.selectOption('#tfSelect', curTf); await page.waitForTimeout(500);
    report('TF-SWITCH-no-crash', errs.length === e0 && afterTf.t1 === before.t1 && health1.ok && !health1.err, `switch tf ${curTf}->${other}->${curTf}: new console errors=${errs.length - e0}; drawing timestamp preserved=${afterTf.t1 === before.t1}; __drw.ok=${health1.ok} err=${health1.err}`);
  }
  await clear();
  {
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'tl', p1: { t: t0, p: await page.evaluate(() => candle.coordinateToPrice(300)) }, p2: { t: await page.evaluate((k) => bars[k + 10].time, k), p: await page.evaluate(() => candle.coordinateToPrice(320)) }, color: '#000000' }]);
    const e0 = errs.length;
    await page.evaluate(() => prevDay()); await page.waitForTimeout(500);
    await page.evaluate(() => nextDay()); await page.waitForTimeout(500);
    const health = await page.evaluate(() => ({ ok: window.__drw && window.__drw.ok, err: window.__drw && window.__drw.err, dCount: drawings.length }));
    report('DAY-SWITCH-no-crash', errs.length === e0 && health.ok && !health.err, `prevDay()+nextDay() with a tl present: new console errors=${errs.length - e0}; __drw.ok=${health.ok} err=${health.err}; drawings still=${health.dCount}`);
  }

  // ===================================================================================================
  // 300-bar replay drift check: drawing's stored {t,p} must be byte-identical after many stepFwd() calls
  // (each of which can trigger maybeReWindow() / re-feed the series — the exact mechanism G6/G47 depend on)
  // ===================================================================================================
  await load();
  await clear();
  {
    const anchorIdx = Math.max(10, (await page.evaluate(() => idx)) - 5);
    const anchorTime = await page.evaluate((i) => bars[i].time, anchorIdx);
    const anchorPrice = await page.evaluate(() => candle.coordinateToPrice(300));
    await seed([{ type: 'hl', p1: { t: anchorTime, p: anchorPrice }, color: '#000000' },
                { type: 'vline', p1: { t: anchorTime }, color: '#000000' }]);
    const e0 = errs.length;
    const stepsOk = await page.evaluate(() => { try { for (let i = 0; i < 300; i++) { if (idx >= bars.length - 1) break; stepFwd(); } return true; } catch (e) { window.__stepErr = String(e); return false; } });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ hlT: drawings[0].p1.t, hlP: drawings[0].p1.p, vT: drawings[1].p1.t, drwOk: window.__drw && window.__drw.ok, drwErr: window.__drw && window.__drw.err, stepErr: window.__stepErr }));
    report('REPLAY-300BAR-NO-DRIFT', stepsOk && after.hlT === anchorTime && after.hlP === anchorPrice && after.vT === anchorTime && errs.length === e0 && after.drwOk && !after.drwErr && !after.stepErr,
      `300x stepFwd() (triggers re-window): hl.p1.t unchanged=${after.hlT === anchorTime}, hl.p1.p unchanged=${after.hlP === anchorPrice}, vline.p1.t unchanged=${after.vT === anchorTime}; new console errors=${errs.length - e0}; __drw.ok=${after.drwOk} err=${after.drwErr}; stepFwd threw=${after.stepErr}`);
  }

  // ===================================================================================================
  // v0 -> v1 migration still works after this change (Stage 1 contract must not have regressed)
  // ===================================================================================================
  {
    await page.evaluate(() => { localStorage.setItem('rt_drawings', JSON.stringify([{ type: 'hl', p1: { t: 1700000000, p: 100.25 }, p2: null, color: '#d1d4dc' }])); localStorage.removeItem('rt_drawings_v'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const mig = await page.evaluate(() => ({ style: drawings[0] && drawings[0].style, v: localStorage.getItem('rt_drawings_v'), ok: window.__drw && window.__drw.ok, id: drawings[0] && drawings[0].id, locked: drawings[0] && drawings[0].locked }));
    report('MIGRATION-v0', mig.style && mig.style.color === '#d1d4dc' && mig.v === '1' && mig.ok && !!mig.id && mig.locked === false, `v0 hl migrated: style.color=${mig.style && mig.style.color}, rt_drawings_v=${mig.v}, id set=${!!mig.id}, locked=${mig.locked}, __drw.ok=${mig.ok}`);
  }

} catch (e) {
  console.log('FAIL EXCEPTION — ' + (e && e.stack || e));
  results.push(false);
} finally {
  const finalErr = await page.evaluate(() => window.__drw && window.__drw.err).catch(() => undefined);
  report('FINAL-no-console-errors', errs.length === 0 && !finalErr, `cumulative console/page errors=${errs.length}${errs.length ? ' :: ' + errs.slice(0, 5).join(' | ') : ''}; window.__drw.err=${finalErr}`);
  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} PASS`);
  process.exit(pass === results.length ? 0 : 1);
}
