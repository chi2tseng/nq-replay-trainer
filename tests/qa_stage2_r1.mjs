// ADVERSARIAL QA — Stage 2 (placement + magnet), round 1. Independent script, does not reuse tv_drawing_stage2.mjs assertions.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/qa_stage2_r1.mjs   (needs http://127.0.0.1:5560/ up)
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/';
const results = [];
const report = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };
const errs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('dialog', d => d.accept());

async function load() {
  await page.goto(URL + '?r=' + Math.random(), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 100 && idx > 80, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
}
const clear = () => page.evaluate(() => { drawings.length = 0; selDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); repaintOverlays(); });
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const priceY = (p) => page.evaluate((p) => candle.priceToCoordinate(p), p);
const ohlcOf = (k) => page.evaluate((k) => { const b = bars[k]; return [b.open, b.high, b.low, b.close]; }, k);
const clickChart = async (x, y, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(r.left + x, r.top + y); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(650); };
const setMagnet = (v) => page.evaluate((v) => { magnet = v; if (v !== 'off') magnetMode = v; saveJSON('rt_magnet', v); }, v);
const drwErr = () => page.evaluate(() => (window.__drw ? window.__drw.err : undefined));

try {
  // ============================================================
  // MIGRATION edge cases beyond boolean true/false
  // ============================================================
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.removeItem('rt_magnet'); localStorage.setItem('rt_magnet_mode', '"strong"'); localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); });
  await load();
  const m0 = await page.evaluate(() => ({ magnet, mode: magnetMode }));
  report('MIG-missing-key', m0.magnet === 'off' && m0.mode === 'strong', `no rt_magnet key at all -> magnet='${m0.magnet}' (want 'off'); pre-existing rt_magnet_mode preserved as '${m0.mode}' (want 'strong', proves migration doesn't clobber an already-valid mode)`);

  await page.evaluate(() => { localStorage.setItem('rt_magnet', '"weak"'); });
  await load();
  const m1 = await page.evaluate(() => ({ magnet, stored: localStorage.getItem('rt_magnet') }));
  report('MIG-string-passthrough', m1.magnet === 'weak' && m1.stored === '"weak"', `rt_magnet already the string 'weak' -> stays '${m1.magnet}' (not coerced to strong/off)`);

  // idempotency: migrate once, reload again, value must be stable (no re-migration re-flip)
  await page.evaluate(() => { localStorage.setItem('rt_magnet', 'true'); });
  await load();
  const afterFirst = await page.evaluate(() => ({ magnet, stored: localStorage.getItem('rt_magnet') }));
  await load();
  const afterSecond = await page.evaluate(() => ({ magnet, stored: localStorage.getItem('rt_magnet') }));
  report('MIG-idempotent', afterFirst.magnet === 'strong' && afterSecond.magnet === 'strong' && afterSecond.stored === '"strong"', `true->strong on first migration (${afterFirst.magnet}), stays strong on reload of the already-migrated string (${afterSecond.magnet}/${afterSecond.stored})`);

  // ============================================================
  // v0 drawings migration: inject a pre-Stage-1 shaped array, verify fields added + rendering survives
  // ============================================================
  await page.evaluate(() => {
    localStorage.setItem('rt_drawings', JSON.stringify([{ type: 'hl', p1: { t: 0, p: 100 }, color: '#123456' }]));
    localStorage.removeItem('rt_drawings_v');
  });
  await load();
  const v0 = await page.evaluate(() => { const d = drawings[0]; return { n: drawings.length, hasStyle: !!(d && d.style), styleColor: d && d.style && d.style.color, colorKept: d && d.color, hasId: !!(d && d.id), locked: d && d.locked, hidden: d && d.hidden, zIsNum: d && typeof d.z === 'number', v: localStorage.getItem('rt_drawings_v'), err: window.__drw && window.__drw.err }; });
  report('V0-MIGRATE', v0.n === 1 && v0.hasStyle && v0.styleColor === '#123456' && v0.colorKept === '#123456' && v0.hasId && v0.locked === false && v0.hidden === false && v0.zIsNum && v0.v === '1' && v0.err === undefined, `v0 hl migrated: style.color=${v0.styleColor} color(legacy)=${v0.colorKept} id present=${v0.hasId} locked=${v0.locked} hidden=${v0.hidden} z is number=${v0.zIsNum} rt_drawings_v=${v0.v} render err=${v0.err}`);
  await clear();

  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx, spacing: chart.timeScale().options().barSpacing }));
  const k = geo.idx - 40;

  // ============================================================
  // G8 EXACT pixel-threshold boundary (their script only tried 6px/40px, not the 12px edge itself)
  // ============================================================
  await clear(); await setMagnet('weak');
  {
    // call magnetSnap() directly with exact pixel offsets — a mouse-click round trip (click -> event coords ->
    // coordinateToPrice -> re-render -> priceToCoordinate) can shift the effective distance by a fraction of a
    // px on either side of an exact integer boundary, which would make this specific test noisy for no reason
    // unrelated to the magnet logic itself. The full click pipeline is already covered by G8-strong/G8-weak.
    const pick = await page.evaluate((k0) => {
      for (let i = k0; i > k0 - 200 && i > 5; i--) {
        const b = bars[i], yh = candle.priceToCoordinate(b.high); if (yh == null || yh < 40) continue;
        const others = [b.open, b.low, b.close].map(v => candle.priceToCoordinate(v));
        if (others.every(y => Math.abs(y - yh) > 25)) return { i, yh, high: b.high };
      }
      return null;
    }, k);
    if (!pick) report('G8-boundary', false, 'no bar with an isolated high found — not verified');
    else {
      const r = await page.evaluate((pick) => {
        const time = bars[pick.i].time;
        const raw12 = candle.coordinateToPrice(pick.yh - 12), raw13 = candle.coordinateToPrice(pick.yh - 13);
        const r12 = magnetSnap(time, raw12, pick.yh - 12, false), r13 = magnetSnap(time, raw13, pick.yh - 13, false);
        return { raw12, raw13, r12, r13 };
      }, pick);
      const ok = r.r12.p === pick.high && r.r13.p === r.raw13;
      report('G8-boundary', ok, `bar ${pick.i} (isolated high=${pick.high}), weak magnet, MAGNET_WEAK_PX=12: exactly 12px away (raw=${r.raw12}) -> magnetSnap.p=${r.r12.p} (want ==high, code uses "> 12" so ==12 still snaps); exactly 13px away (raw=${r.raw13}) -> magnetSnap.p=${r.r13.p} (want ==raw13, unsnapped)`);
    }
  }

  // ============================================================
  // G10 magnetBarIdx half-bar-span boundary in future space
  // ============================================================
  await clear(); await setMagnet('strong');
  {
    const span = await page.evaluate(() => barSpanSec());
    const lastT = await page.evaluate(() => bars[idx].time);
    const ohlcLast = await ohlcOf(geo.idx);
    const xJustPast = await page.evaluate((t) => drawX(t), lastT + span * 0.3);   // < half span past last bar -> should still count as "on" the last bar
    await page.click('#drwHL'); await clickChart(xJustPast, geo.H * 0.5);
    const near = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p), mi: d && magnetBarIdx(d.p1.t) }; }, ohlcLast);
    await clear();
    const xFarPast = await page.evaluate((t) => drawX(t), lastT + span * 0.9);   // > half span past last bar -> genuinely "no bar under cursor"
    await page.click('#drwHL'); await clickChart(xFarPast, geo.H * 0.5);
    const far = await page.evaluate(() => { const d = drawings[0]; return { p: d && d.p1.p, mi: d && magnetBarIdx(d.p1.t) }; });
    report('G10-half-span', near.snapped && near.mi === geo.idx && far.mi === -1, `strong magnet, +0.3*barSpan past last bar -> magnetBarIdx=${near.mi} (want == last revealed idx ${geo.idx}), snapped to last-bar OHLC=${near.snapped} p=${near.p}; +0.9*barSpan past -> magnetBarIdx=${far.mi} (want -1, free p=${far.p})`);
  }

  // ============================================================
  // G11 indicator toggled OFF must drop out of snap targets even with Snap-to-indicators still ON
  // ============================================================
  await clear(); await setMagnet('strong');
  {
    await page.evaluate(() => { setBB(true); document.getElementById('indBB').checked = true; magnetInd = true; document.getElementById('magInd').checked = true; });
    await page.waitForTimeout(300);
    const pick = await page.evaluate(() => {
      for (let i = idx - 80; i < idx - 5; i++) { const up = bbData.up[i]; if (up == null) continue; const b = bars[i], yv = candle.priceToCoordinate(up); if (yv == null || yv < 40) continue;
        const dmin = Math.min(...[b.open, b.high, b.low, b.close].map(o => Math.abs(candle.priceToCoordinate(o) - yv))); if (dmin >= 4) return { i, v: up, yv }; }
      return null;
    });
    if (!pick) report('G11-toggle-off', false, 'no bar with BB-upper >=4px from OHLC found in current view — not verified');
    else {
      const x = await barX(pick.i);
      await page.click('#drwHL'); await clickChart(x, pick.yv + 1);
      const bbOn = await page.evaluate(() => drawings[0].p1.p);
      await clear(); await page.evaluate(() => { setBB(false); document.getElementById('indBB').checked = false; });
      await page.click('#drwHL'); await clickChart(x, pick.yv + 1);
      const bbOff = await page.evaluate(() => drawings[0].p1.p);
      const ohlc = await ohlcOf(pick.i);
      report('G11-toggle-off', bbOn === pick.v && ohlc.includes(bbOff) && bbOff !== pick.v, `BB upper=${pick.v} at bar ${pick.i}: BB on + Snap-to-indicators on -> p=${bbOn} == BB; BB turned OFF (indicators-snap still on) -> p=${bbOff} falls back to an OHLC (not BB value)`);
      await page.evaluate(() => { magnetInd = false; document.getElementById('magInd').checked = false; });
    }
  }

  // ============================================================
  // subscribeClick guard regression: annotation ("start"-class) tools must still require an exact bar —
  // clicking in the empty future-space region (param.time === null) must place NOTHING, even though the
  // generic guard is now `!tool || !param.point` (looser than the old `!tool || param.time==null`).
  // ============================================================
  await clear();
  {
    const xLast = await barX(geo.idx), xFuture = xLast + geo.spacing * 4;
    const before = await page.evaluate(() => annotations.length);
    await page.click('#annUp'); await clickChart(xFuture, geo.H * 0.5);
    const after = await page.evaluate(() => ({ n: annotations.length, tool }));
    report('ANN-GUARD-FUTURE', after.n === before && after.tool === 'au', `annUp clicked in empty future space (no bar there): annotations ${before}->${after.n} (want unchanged), tool stays armed='${after.tool}' (TV-style: bad click doesn't consume the tool)`);
    await page.evaluate(() => setTool(''));
  }

  // ============================================================
  // rubber-band preview lifecycle: cleared by Escape and by completing the 2nd click
  // ============================================================
  await clear(); await setMagnet('off');
  {
    const xa = await barX(k), ya = Math.round(geo.H * 0.4);
    await page.click('#drwTL'); await clickChart(xa, ya);
    const cr = await chartRect();
    await page.mouse.move(cr.left + xa + 80, cr.top + ya + 40, { steps: 3 }); await page.waitForTimeout(150);
    const mid = await page.evaluate(() => ({ prev: previewXY, pending: !!pendingPt }));
    await page.keyboard.press('Escape');
    const afterEsc = await page.evaluate(() => ({ prev: previewXY, pending: pendingPt, tool }));
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xa + 80, ya + 40);
    const afterDone = await page.evaluate(() => ({ prev: previewXY, pending: pendingPt, n: drawings.length }));
    report('G2-lifecycle', mid.pending && mid.prev != null && afterEsc.prev === null && afterEsc.pending === null && afterEsc.tool === '' && afterDone.prev === null && afterDone.pending === null && afterDone.n === 1, `mid-draw previewXY=${JSON.stringify(mid.prev)} pending=${mid.pending}; after Escape previewXY=${afterEsc.prev} pending=${afterEsc.pending} tool='${afterEsc.tool}'; after completing 2nd click previewXY=${afterDone.prev} pending=${afterDone.pending} drawings=${afterDone.n}`);
  }

  // ============================================================
  // preview must NOT be magnet-snapped — it tracks raw pixels regardless of magnet state (decision: preview stays pixel-space)
  // ============================================================
  await clear(); await setMagnet('strong');
  {
    const ohlc = await ohlcOf(k), x = await barX(k), yH = await priceY(ohlc[1]);
    await page.click('#drwHL'); // arm hl first just to get pendingPt via a 2-point tool instead — use tl
    await page.evaluate(() => setTool(''));
    await page.click('#drwTL'); await clickChart(x, yH - 60);
    const cr = await chartRect();
    const yFarFromAnyOHLC = yH - 61;
    await page.mouse.move(cr.left + x + 40, cr.top + yFarFromAnyOHLC, { steps: 3 }); await page.waitForTimeout(150);
    const prev = await page.evaluate(() => (window.__drwDbg && window.__drwDbg.preview));
    report('G2-no-magnet-in-preview', prev && Math.abs(prev.y2 - yFarFromAnyOHLC) < 1, `strong magnet armed, tl 2nd point previewed at raw cursor y=${yFarFromAnyOHLC}: preview.y2=${prev && prev.y2} (want ≈ raw cursor, i.e. preview is not snapped mid-draw)`);
    await page.keyboard.press('Escape');
  }

  // ============================================================
  // regression: select + drag + delete for every 2-point / 1-point type (tl/box/fib/rr/measure/hray/vline/cross)
  // ============================================================
  await clear();
  {
    const t1 = await page.evaluate(() => bars[Math.max(0, idx - 60)].time), t2 = await page.evaluate(() => bars[Math.max(0, idx - 20)].time);
    const p1 = await page.evaluate(() => bars[Math.max(0, idx - 60)].close), p2 = await page.evaluate(() => bars[Math.max(0, idx - 20)].close + 5);
    const cases = [];
    for (const type of ['tl', 'box', 'fib', 'measure', 'rr', 'hray', 'vline', 'cross']) {
      await page.evaluate(({ type, t1, t2, p1, p2 }) => {
        drawings.length = 0; selDrawing = null;
        const d = { type, p1: { t: t1, p: p1 }, color: '#000000' };
        if (['tl', 'box', 'fib', 'measure'].includes(type)) d.p2 = { t: t2, p: p2 };
        if (type === 'rr') { d.p2 = { t: t2, p: p1 }; d.stop = p1 - 10; d.target = p1 + 20; }
        drawings.push(newDrawing(d)); saveJSON('rt_drawings', drawings); repaintOverlays();
      }, { type, t1, t2, p1, p2 });
      // select via body-hit at a point on the drawing (use drawX/drawY midpoint, which drawingAt() should hit-test)
      const hit = await page.evaluate((type) => {
        const d = drawings[0]; let x, y;
        if (type === 'hray' || type === 'vline' || type === 'cross') { x = drawX(d.p1.t); y = type === 'vline' ? document.getElementById('chart').clientHeight / 2 : drawY(d.p1.p); }
        else if (type === 'rr') { x = (rrRange(d, drawX).xa + rrRange(d, drawX).xb) / 2; y = drawY(d.p1.p); }
        else if (type === 'box') { x = (drawX(d.p1.t) + drawX(d.p2.t)) / 2; y = Math.min(drawY(d.p1.p), drawY(d.p2.p)); }   // box hit-test is border-only (drawingAt, app.js) — hit the top edge, not the fill
        else { x = (drawX(d.p1.t) + drawX(d.p2.t)) / 2; y = (drawY(d.p1.p) + drawY(d.p2.p)) / 2; }
        return { x, y };
      }, type);
      const cr = await chartRect();
      await page.mouse.click(cr.left + hit.x, cr.top + hit.y); await page.waitForTimeout(150);
      const selected = await page.evaluate(() => !!selDrawing);
      // drag it (whole-body move) and confirm coordinates actually changed
      const before = await page.evaluate(() => JSON.stringify(drawings[0]));
      await page.mouse.move(cr.left + hit.x, cr.top + hit.y); await page.mouse.down();
      await page.mouse.move(cr.left + hit.x + 15, cr.top + hit.y + 10, { steps: 4 }); await page.waitForTimeout(100);
      await page.mouse.up(); await page.waitForTimeout(100);
      const after = await page.evaluate(() => JSON.stringify(drawings[0]));
      const moved = before !== after;
      // delete
      await page.keyboard.press('Delete'); await page.waitForTimeout(100);
      const n = await page.evaluate(() => drawings.length);
      cases.push({ type, selected, moved, deleted: n === 0 });
    }
    const ok = cases.every(c => c.selected && c.moved && c.deleted);
    report('REGRESSION-select-drag-delete', ok, cases.map(c => `${c.type}: sel=${c.selected} moved=${c.moved} del=${c.deleted}`).join('; '));

    // note (pre-existing, not Stage 2 scope): box can only be selected near its border, not by clicking its filled interior
    await page.evaluate(({ type, t1, t2, p1, p2 }) => { drawings.length = 0; drawings.push(newDrawing({ type: 'box', p1: { t: t1, p: p1 }, p2: { t: t2, p: p2 }, color: '#000000' })); saveJSON('rt_drawings', drawings); repaintOverlays(); }, { t1, t2, p1, p2 });
    const centerHit = await page.evaluate(() => { const d = drawings[0]; const x = (drawX(d.p1.t) + drawX(d.p2.t)) / 2, y = (drawY(d.p1.p) + drawY(d.p2.p)) / 2; return { x, y }; });
    const cr0 = await chartRect();
    await page.mouse.click(cr0.left + centerHit.x, cr0.top + centerHit.y); await page.waitForTimeout(100);
    const centerSel = await page.evaluate(() => !!selDrawing);
    report('NOTE-box-interior-not-hittable', true, `pre-existing (not Stage 2 scope): clicking a box's filled interior selects it = ${centerSel} (drawingAt() only hit-tests the border within 6px, app.js drawingAt box branch) — informational, not scored as pass/fail`);
    await clear();
  }

  // ============================================================
  // drift check: replay hundreds of bars forward (forces feedWindow/maybeReWindow), drawings must not move
  // ============================================================
  await clear(); await setMagnet('off');
  {
    const kk = Math.max(20, geo.idx - 200);
    const tRef = await page.evaluate((kk) => bars[kk].time, kk), pRef = await page.evaluate((kk) => bars[kk].close + 3.125, kk);   // deliberately off-tick free price
    const tFuture = await page.evaluate(() => bars[idx].time + barSpanSec() * 2);   // also plant one in future space
    await page.evaluate(({ tRef, pRef, tFuture }) => {
      drawings.length = 0;
      drawings.push(newDrawing({ type: 'hl', p1: { t: tRef, p: pRef }, color: '#000000' }));
      drawings.push(newDrawing({ type: 'vline', p1: { t: tFuture }, color: '#000000' }));
      saveJSON('rt_drawings', drawings); repaintOverlays();
    }, { tRef, pRef, tFuture });
    const beforeIdx = await page.evaluate(() => idx);
    for (let i = 0; i < 8; i++) { await page.evaluate(() => { for (let j = 0; j < 40; j++) stepAny(); }); await page.waitForTimeout(30); }
    const afterIdx = await page.evaluate(() => idx);
    const r = await page.evaluate(({ tRef, pRef, tFuture }) => ({
      t1: drawings[0].p1.t, p1: drawings[0].p1.p, t2: drawings[1].p1.t,
      err: window.__drw && window.__drw.err, ok: window.__drw && window.__drw.ok,
      x1: drawX(tRef), x2: drawX(tFuture),
    }), { tRef, pRef, tFuture });
    report('DRIFT-replay', r.t1 === tRef && r.p1 === pRef && r.t2 === tFuture && r.err === undefined && r.ok && Number.isFinite(r.x1) && Number.isFinite(r.x2), `advanced idx ${beforeIdx}->${afterIdx} (${afterIdx - beforeIdx} bars, forces feedWindow/maybeReWindow); stored hl p1.t=${r.t1}(want ${tRef}) p1.p=${r.p1}(want ${pRef}); vline p1.t=${r.t2}(want ${tFuture}); render err=${r.err} ok=${r.ok}; drawX still resolves: x1=${r.x1} x2=${r.x2}`);
  }

  // ============================================================
  // regression: trading hotkeys still work after all the drawing-path changes
  // ============================================================
  await clear();
  {
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (position) flatten(); });
    await page.keyboard.press('b'); await page.waitForTimeout(200);
    const b = await page.evaluate(() => ({ pos: !!position, side: position && position.side }));
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    const flat1 = await page.evaluate(() => !!position);
    await page.keyboard.press('f'); await page.waitForTimeout(200);
    const f = await page.evaluate(() => ({ orders: (entryOrder ? 1 : 0) + orders.length }));
    await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); for (const o of [...orders]) {} });
    report('REGRESSION-hotkeys', b.pos && b.side === 'long' && !flat1 && f.orders > 0, `B -> position long=${b.pos}; X -> flat=${!flat1}; F -> buy-stop order/entry present=${f.orders > 0}`);
  }

  // ============================================================
  // regression: timeframe switch does not throw and drawings survive with drawX still resolvable
  // ============================================================
  {
    await page.evaluate(() => { drawings.length = 0; drawings.push(newDrawing({ type: 'hl', p1: { t: bars[Math.max(0, idx - 50)].time, p: bars[Math.max(0, idx - 50)].close }, color: '#000000' })); saveJSON('rt_drawings', drawings); repaintOverlays(); });
    const before = await page.evaluate(() => ({ n: drawings.length, t: drawings[0].p1.t }));
    const curVal = await page.evaluate(() => document.getElementById('tfSelect').value);
    const opts = await page.evaluate(() => Array.from(document.getElementById('tfSelect').options).map(o => o.value));
    const other = opts.find(v => v !== curVal);
    if (other) {
      await page.selectOption('#tfSelect', other); await page.waitForTimeout(400);
      const mid = await page.evaluate(() => ({ n: drawings.length, t: drawings[0] && drawings[0].p1.t, err: window.__drw && window.__drw.err, tfNow: document.getElementById('tfSelect').value }));
      await page.selectOption('#tfSelect', curVal); await page.waitForTimeout(400);
      const after = await page.evaluate(() => ({ n: drawings.length, t: drawings[0] && drawings[0].p1.t, err: window.__drw && window.__drw.err }));
      const ok = mid.tfNow === other && mid.n === before.n && mid.t === before.t && mid.err === undefined && after.n === before.n && after.t === before.t && after.err === undefined;
      report('REGRESSION-tf-switch', ok, `placed hl at t=${before.t}; tf switch ${curVal}->${other}(now ${mid.tfNow})->${curVal}: drawing SURVIVES with p1.t unchanged (mid t=${mid.t}, after t=${after.t}), count stayed ${before.n} (mid=${mid.n}, after=${after.n}), render err mid=${mid.err} after=${after.err}`);
    } else report('REGRESSION-tf-switch', false, 'only one timeframe option present — not verified');
    await clear();
  }
  await clear();

  // ============================================================
  // regression: day switch does not throw (drawings are timestamp-based, not bar-index, so they may legitimately
  // vanish/relocate on a day boundary since bars[] itself is replaced — only asserting no crash / no render error)
  // ============================================================
  {
    await page.evaluate(() => { drawings.length = 0; drawings.push(newDrawing({ type: 'hl', p1: { t: bars[Math.max(0, idx - 30)].time, p: bars[Math.max(0, idx - 30)].close }, color: '#000000' })); saveJSON('rt_drawings', drawings); repaintOverlays(); });
    await page.click('#btnPrevDay'); await page.waitForTimeout(600);
    const afterPrev = await page.evaluate(() => ({ err: window.__drw && window.__drw.err, ok: window.__drw && window.__drw.ok, n: drawings.length }));
    await page.click('#btnNextDay'); await page.waitForTimeout(600);
    const afterNext = await page.evaluate(() => ({ err: window.__drw && window.__drw.err, ok: window.__drw && window.__drw.ok }));
    report('REGRESSION-day-switch', afterPrev.err === undefined && afterPrev.ok && afterNext.err === undefined && afterNext.ok, `prevDay -> render err=${afterPrev.err} ok=${afterPrev.ok} drawings=${afterPrev.n} (day switch legitimately reloads bars[], not asserting the drawing itself survives); nextDay back -> render err=${afterNext.err} ok=${afterNext.ok}`);
  }
  await clear();

  // ============================================================
  // informational: Alt+F (out of Stage-2 scope — hotkeys are Stage 4/G26-G32) — check current behaviour honestly
  // ============================================================
  {
    await page.evaluate(() => { if (position) flatten(); if (entryOrder) cancelOrder('entry'); });
    await page.keyboard.press('Alt+f'); await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({ tool, entry: !!entryOrder, ordersLen: orders.length }));
    await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    report('INFO-alt-f-not-stage2', true, `Alt+F: tool='${r.tool}' entryOrder-placed=${r.entry} orders=${r.ordersLen} — keydown handler (app.js ~3879, 'f' branch) has no e.altKey guard, so Alt+F still calls placeBreakout('long') and arms a live buy-stop (confirmed: entryOrder-placed=${r.entry}). This is Stage 4 scope (G26-G32 hotkey reordering per TV_DRAWING_GAP.md), NOT claimed as implemented in Stage 2 — reported for the record only, not scored as a Stage 2 pass/fail`);
  }

  report('CONSOLE-FINAL', errs.length === 0, errs.length ? errs.slice(0, 5).join(' | ') : 'no console/page errors across the whole run');
} catch (e) {
  report('SCRIPT-EXCEPTION', false, 'exception: ' + (e && e.stack || e));
} finally {
  await browser.close();
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} PASS`);
for (const r of results) if (!r.ok) console.log('FAILED: ' + r.id);
process.exit(0);
