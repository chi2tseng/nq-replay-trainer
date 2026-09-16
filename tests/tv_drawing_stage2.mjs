// TV drawing parity — Stage 2 acceptance (TV_DRAWING_GAP.md Stage 2: G1-G6, G8-G11 + rt_magnet migration + regressions).
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/tv_drawing_stage2.mjs
// Prints one PASS/FAIL line per rule id. Needs the local server on http://127.0.0.1:5560/.
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/?r=' + Date.now();
const results = [];
const report = (id, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };
const errs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('dialog', d => d.accept());

async function load() {
  await page.goto(URL + Math.random(), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 100 && idx > 50, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const canvases = (rootId) => {
      const root = document.getElementById(rootId), rr = root.getBoundingClientRect();
      return [...root.querySelectorAll('canvas')].map(c => ({ c, r: c.getBoundingClientRect() })).filter(o => o.r.width > rr.width * 0.5)
        .map(o => ({ ctx: o.c.getContext('2d'), ox: o.r.left - rr.left, oy: o.r.top - rr.top, w: o.c.width, h: o.c.height, sx: o.c.width / o.r.width, sy: o.c.height / o.r.height }));
    };
    const inkAt = (cs, x, y) => cs.some(({ ctx, ox, oy, w, h, sx, sy }) => {   // any opaque non-white/non-grid pixel (drawings are black / blue / orange on a white chart)
      const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy); if (px < 0 || py < 0 || px >= w || py >= h) return false;
      const d = ctx.getImageData(px, py, 1, 1).data; return d[3] > 200 && (d[0] < 200 || d[1] < 200 || d[2] < 200) && !(d[0] === d[1] && d[1] === d[2] && d[0] > 200);
    });
    window.__ptInk = (rootId, x, y, rad = 2) => { const cs = canvases(rootId); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if (inkAt(cs, x + dx, y + dy)) return true; return false; };
    window.__segInk = (rootId, x1, y1, x2, y2, n = 12) => { let hit = 0; for (let k = 1; k < n; k++) { const t = k / n; if (window.__ptInk(rootId, Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), 2)) hit++; } return hit / (n - 1); };
  });
}
const clear = async () => page.evaluate(() => { drawings.length = 0; selDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); repaintOverlays(); });
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const priceY = (p) => page.evaluate((p) => candle.priceToCoordinate(p), p);
const clickChart = async (x, y, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(r.left + x, r.top + y); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(650); };   // >500ms: LWC swallows a second click inside 500ms as a double-click
const setMagnet = (v) => page.evaluate((v) => { magnet = v; if (v !== 'off') magnetMode = v; saveJSON('rt_magnet', v); }, v);
const ohlcOf = (k) => page.evaluate((k) => { const b = bars[k]; return [b.open, b.high, b.low, b.close]; }, k);

try {
  // ================= rt_magnet migration: boolean true -> 'strong', false -> 'off' =================
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('rt_magnet', 'true'); localStorage.removeItem('rt_magnet_mode'); localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); });
  await load();
  const mig = await page.evaluate(() => ({ magnet, mode: magnetMode, stored: localStorage.getItem('rt_magnet'), active: document.getElementById('btnMagnet').classList.contains('active'), keep: keepDrawing, ind: magnetInd }));
  report('MIGRATION', mig.magnet === 'strong' && mig.mode === 'strong' && mig.stored === '"strong"' && mig.active && mig.keep === false && mig.ind === false, `rt_magnet true -> magnet=${mig.magnet} magnetMode=${mig.mode} persisted=${mig.stored} btn active=${mig.active}; keepDrawing=${mig.keep} magnetInd=${mig.ind} consoleErrors=${errs.length}`);
  await page.evaluate(() => { localStorage.setItem('rt_magnet', 'false'); });
  await load();
  const mig2 = await page.evaluate(() => ({ magnet, stored: localStorage.getItem('rt_magnet'), active: document.getElementById('btnMagnet').classList.contains('active') }));
  report('MIGRATION-off', mig2.magnet === 'off' && mig2.stored === '"off"' && !mig2.active, `rt_magnet false -> magnet=${mig2.magnet} persisted=${mig2.stored} btn active=${mig2.active}`);

  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx, spacing: chart.timeScale().options().barSpacing }));
  const k = geo.idx - 40;   // a revealed bar well inside the view

  // ================= G5 price free: magnet off, hl at a non-tick y =================
  await clear(); await setMagnet('off');
  {
    // find a y whose price is not a multiple of TICK (0.25)
    let y = Math.round(geo.H * 0.5), p = await page.evaluate((y) => candle.coordinateToPrice(y), y);
    for (let i = 0; i < 40 && Math.abs(p / 0.25 - Math.round(p / 0.25)) < 0.05; i++) { y += 1; p = await page.evaluate((y) => candle.coordinateToPrice(y), y); }
    await page.click('#drwHL'); await clickChart(await barX(k), y);
    const r = await page.evaluate(() => ({ n: drawings.length, p: drawings[0] && drawings[0].p1.p, tool }));
    const offTick = r.p != null && Math.abs(r.p / 0.25 - Math.round(r.p / 0.25)) > 0.01;
    report('G5', r.n === 1 && offTick && r.tool === '', `hl placed p=${r.p} (clicked price ${p}) p%0.25=${r.p != null ? (r.p % 0.25).toFixed(4) : 'n/a'} -> not tick-quantised=${offTick}; tool reverted='${r.tool}'`);
  }

  // ================= G6 time free: tl with both points between bars =================
  await clear();
  {
    const xa = (await barX(k)) + geo.spacing * 0.4, xb = (await barX(k + 12)) + geo.spacing * 0.45;
    await page.click('#drwTL'); await clickChart(xa, geo.H * 0.4); await clickChart(xb, geo.H * 0.55);
    const r = await page.evaluate(() => { const d = drawings[0]; return { n: drawings.length, t1: d && d.p1.t, t2: d && d.p2.t, on1: d && bars.some(b => b.time === d.p1.t), on2: d && bars.some(b => b.time === d.p2.t), tool, x1: d && drawX(d.p1.t), x2: d && drawX(d.p2.t) }; });
    report('G6', r.n === 1 && !r.on1 && !r.on2 && Math.abs(r.x1 - xa) < 1.5 && Math.abs(r.x2 - xb) < 1.5 && r.tool === '', `tl p1.t=${r.t1} p2.t=${r.t2}; on a bar: ${r.on1}/${r.on2}; drawX round-trip x1=${r.x1 && r.x1.toFixed(1)}≈${xa.toFixed(1)} x2=${r.x2 && r.x2.toFixed(1)}≈${xb.toFixed(1)}; tool='${r.tool}'`);
  }

  // ================= G7 placement in the empty space right of the last bar =================
  await clear();
  {
    const xLast = await barX(geo.idx); const x = xLast + geo.spacing * 3.5;
    await page.click('#drwHRay'); await clickChart(x, geo.H * 0.5);
    const r = await page.evaluate(() => { const d = drawings[0]; return { n: drawings.length, t: d && d.p1.t, lastT: bars[idx].time, x: d && drawX(d.p1.t), native: d && chart.timeScale().timeToCoordinate(d.p1.t), ok: window.__drw && window.__drw.ok }; });
    report('G7', r.n === 1 && r.t > r.lastT && Math.abs(r.x - x) < 1.5 && r.native == null && r.ok, `hray placed n=${r.n} p1.t=${r.t} > last revealed bar t=${r.lastT} (+${r.t - r.lastT}s) drawX=${r.x && r.x.toFixed(1)}≈clicked ${x.toFixed(1)} native timeToCoordinate=${r.native} __drw.ok=${r.ok}`);
  }

  // ================= G8 strong: click far from any OHLC -> snaps to the nearest OHLC of that bar =================
  await clear(); await setMagnet('strong');
  {
    const ohlc = await ohlcOf(k), x = (await barX(k)) + geo.spacing * 0.3;   // slightly off-centre: time must snap back to the bar too
    const yFar = (await priceY(ohlc[1])) - 60;   // 60px above the high
    await page.click('#drwHL'); await clickChart(x, yFar);
    const r = await page.evaluate((k) => { const d = drawings[0]; return { n: drawings.length, p: d && d.p1.p, t: d && d.p1.t, bt: bars[k].time }; }, k);
    report('G8-strong', r.n === 1 && r.p === ohlc[1] && r.t === r.bt, `clicked 60px above high (OHLC ${ohlc.join('/')}) -> p=${r.p} (== high ${ohlc[1]}) time snapped to bar=${r.t === r.bt}`);
  }

  // ================= G8 weak: far -> free; within 12px -> snap =================
  await clear(); await setMagnet('weak');
  {
    const ohlc = await ohlcOf(k), x = await barX(k), yH = await priceY(ohlc[1]);
    await page.click('#drwHL'); await clickChart(x, yH - 40);
    const far = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p) }; }, ohlc);
    await clear(); await page.click('#drwHL'); await clickChart(x, yH - 6);
    const near = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p), t: d && d.p1.t }; }, ohlc);
    report('G8-weak', far.p != null && !far.snapped && near.p === ohlc[1], `40px away: p=${far.p} snapped=${far.snapped}; 6px away: p=${near.p} == high ${ohlc[1]} (threshold ${await page.evaluate(() => MAGNET_WEAK_PX)}px)`);
  }

  // ================= G9 Ctrl inverts: off + Ctrl -> snaps; release -> free =================
  await clear(); await setMagnet('off'); await page.evaluate(() => { magnetMode = 'strong'; });
  {
    const ohlc = await ohlcOf(k), x = await barX(k), yH = await priceY(ohlc[1]);
    await page.click('#drwHL'); await clickChart(x, yH - 50, ['Control']);
    const withCtrl = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p) }; }, ohlc);
    await clear(); await page.click('#drwHL'); await clickChart(x, yH - 50);
    const noCtrl = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p) }; }, ohlc);
    // and the inverse: magnet strong + Ctrl -> free
    await clear(); await setMagnet('strong'); await page.click('#drwHL'); await clickChart(x, yH - 50, ['Control']);
    const strongCtrl = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p) }; }, ohlc);
    report('G9', withCtrl.snapped && withCtrl.p === ohlc[1] && !noCtrl.snapped && noCtrl.p != null && !strongCtrl.snapped, `off+Ctrl: p=${withCtrl.p} snapped=${withCtrl.snapped}; off no Ctrl: p=${noCtrl.p} snapped=${noCtrl.snapped}; strong+Ctrl: p=${strongCtrl.p} snapped=${strongCtrl.snapped}`);
  }

  // ================= G9-drag: Ctrl while dragging an anchor =================
  await clear(); await setMagnet('off'); await page.evaluate(() => { magnetMode = 'strong'; });
  {
    const ohlc = await ohlcOf(k + 5), xT = await barX(k + 5), yH = await priceY(ohlc[1]);
    await page.evaluate((k) => { drawings.push(newDrawing({ type: 'hl', p1: { t: bars[k].time, p: candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.3) }, color: '#000000' })); saveJSON('rt_drawings', drawings); repaintOverlays(); }, k);
    const y0 = await page.evaluate(() => drawY(drawings[0].p1.p));
    const cr = await chartRect();
    await page.mouse.move(cr.left + xT, cr.top + y0); await page.mouse.down(); await page.keyboard.down('Control');
    await page.mouse.move(cr.left + xT, cr.top + yH - 45, { steps: 5 }); await page.waitForTimeout(100);
    const during = await page.evaluate(() => drawings[0].p1.p);
    await page.keyboard.up('Control'); await page.mouse.move(cr.left + xT, cr.top + yH - 46, { steps: 2 }); await page.waitForTimeout(100);
    const after = await page.evaluate(() => drawings[0].p1.p);
    await page.mouse.up(); await page.waitForTimeout(200);
    report('G9-drag', during === ohlc[1] && !ohlc.includes(after) && after != null, `drag hl anchor with Ctrl (magnet off, last mode strong): p=${during} == high ${ohlc[1]}; Ctrl released mid-drag: p=${after} snapped=${ohlc.includes(after)}`);
  }

  // ================= G10 future space: strong magnet but no bar under the cursor -> no snap =================
  await clear(); await setMagnet('strong');
  {
    const xLast = await barX(geo.idx), x = xLast + geo.spacing * 3;
    const y = Math.round(geo.H * 0.5), pClick = await page.evaluate((y) => candle.coordinateToPrice(y), y);
    await page.click('#drwHL'); await clickChart(x, y);
    const r = await page.evaluate(() => { const d = drawings[0]; const all = new Set(); for (let i = Math.max(0, idx - 3); i <= idx; i++) for (const v of [bars[i].open, bars[i].high, bars[i].low, bars[i].close]) all.add(v); return { n: drawings.length, p: d && d.p1.p, t: d && d.p1.t, lastT: bars[idx].time, inOhlc: d && all.has(d.p1.p), mi: magnetBarIdx(d && d.p1.t) }; });
    report('G10', r.n === 1 && Math.abs(r.p - pClick) < 0.25 && r.t > r.lastT && !r.inOhlc && r.mi === -1, `strong magnet, click 3 bars right of the last bar: p=${r.p} == clicked ${pClick}, t beyond last bar=${r.t > r.lastT}, magnetBarIdx=${r.mi}, equals a recent OHLC=${r.inOhlc}`);
  }

  // ================= G11 snap to indicators: VWAP value becomes a snap target =================
  await clear(); await setMagnet('strong');
  {
    await page.evaluate(() => { setVwap(true); document.getElementById('indVwap').checked = true; });
    await page.waitForTimeout(300);
    // pick a revealed bar where VWAP sits clearly away from all four OHLC values (>= 3px)
    const pick = await page.evaluate(() => {
      for (let i = idx - 60; i < idx - 5; i++) { const v = vwapData[i]; if (v == null) continue; const b = bars[i], yv = candle.priceToCoordinate(v); if (yv == null || yv < 30) continue;
        const dmin = Math.min(...[b.open, b.high, b.low, b.close].map(o => Math.abs(candle.priceToCoordinate(o) - yv))); if (dmin >= 3) return { i, v, yv, dmin }; }
      return null;
    });
    if (!pick) report('G11', false, 'no revealed bar with VWAP >=3px away from OHLC in view — not verified');
    else {
      const x = await barX(pick.i);
      await page.evaluate(() => { magnetInd = false; }); await page.click('#drwHL'); await clickChart(x, pick.yv + 1);
      const off = await page.evaluate(() => drawings[0] && drawings[0].p1.p);
      await clear(); await page.evaluate(() => { magnetInd = true; document.getElementById('magInd').checked = true; }); await page.click('#drwHL'); await clickChart(x, pick.yv + 1);
      const on = await page.evaluate(() => drawings[0] && drawings[0].p1.p);
      const ohlc = await ohlcOf(pick.i);
      report('G11', ohlc.includes(off) && on === pick.v, `bar ${pick.i} VWAP=${pick.v} (${pick.dmin.toFixed(1)}px from nearest OHLC); Snap to indicators off -> p=${off} (an OHLC: ${ohlc.includes(off)}); on -> p=${on} == VWAP`);
      await page.evaluate(() => { magnetInd = false; document.getElementById('magInd').checked = false; setVwap(false); document.getElementById('indVwap').checked = false; });
    }
  }

  // ================= G2 rubber-band preview: after the first click the segment follows the cursor =================
  await clear(); await setMagnet('off');
  {
    const xa = await barX(k), ya = Math.round(geo.H * 0.35), xb = await barX(k + 25), yb = Math.round(geo.H * 0.65);
    const cr = await chartRect();
    await page.click('#drwTL'); await clickChart(xa, ya);
    await page.mouse.move(cr.left + xb, cr.top + yb, { steps: 4 }); await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({ pending: !!pendingPt, prev: previewXY, dbg: window.__drwDbg && window.__drwDbg.preview, n: drawings.length }));
    const ink = await page.evaluate(({ xa, ya, xb, yb }) => window.__segInk('chart', xa, ya, xb, yb), { xa, ya, xb, yb });
    // moving the cursor must move the preview
    await page.mouse.move(cr.left + xb, cr.top + yb - 120, { steps: 3 }); await page.waitForTimeout(200);
    const r2 = await page.evaluate(() => window.__drwDbg && window.__drwDbg.preview);
    const ink2 = await page.evaluate(({ xa, ya, xb, yb }) => window.__segInk('chart', xa, ya, xb, yb - 120), { xa, ya, xb, yb });
    // box preview too
    await clickChart(xb, yb); await clear(); await page.click('#drwBox'); await clickChart(xa, ya); await page.mouse.move(cr.left + xb, cr.top + yb, { steps: 3 }); await page.waitForTimeout(200);
    const box = await page.evaluate(({ xa, ya, xb, yb }) => ({ dbg: window.__drwDbg && window.__drwDbg.preview, top: window.__segInk('chart', xa, ya, xb, ya), right: window.__segInk('chart', xb, ya, xb, yb) }), { xa, ya, xb, yb });
    await page.keyboard.press('Escape');
    const ok = r.pending && r.n === 0 && r.prev && Math.abs(r.prev.x - xb) < 1 && r.dbg && r.dbg.tool === 'tl' && Math.abs(r.dbg.x1 - xa) < 1.5 && ink > 0.7 && r2 && Math.abs(r2.y2 - (yb - 120)) < 1 && ink2 > 0.7 && box.dbg && box.dbg.tool === 'box' && box.top > 0.6 && box.right > 0.6;
    report('G2', ok, `tl: pendingPt=${r.pending} drawings=${r.n} previewXY=${JSON.stringify(r.prev)} dbg=${JSON.stringify(r.dbg)} segment ink=${ink.toFixed(2)}; after move: y2=${r2 && r2.y2} ink=${ink2.toFixed(2)}; box preview: tool=${box.dbg && box.dbg.tool} top edge ink=${box.top.toFixed(2)} right edge ink=${box.right.toFixed(2)}`);
  }

  // ================= G3 / G4 keep drawing =================
  await clear();
  {
    const x = await barX(k);
    await page.click('#drwHL'); await clickChart(x, geo.H * 0.4);
    const off = await page.evaluate(() => ({ tool, n: drawings.length, active: document.getElementById('drwHL').classList.contains('active') }));
    await page.click('#btnKeepDraw');
    const kd = await page.evaluate(() => ({ keep: keepDrawing, stored: localStorage.getItem('rt_keepdraw'), active: document.getElementById('btnKeepDraw').classList.contains('active') }));
    await page.click('#drwHL'); await clickChart(x, geo.H * 0.45); await clickChart(x, geo.H * 0.5);
    const on = await page.evaluate(() => ({ tool, n: drawings.length, active: document.getElementById('drwHL').classList.contains('active') }));
    // two-point tool keeps its tool but clears pendingPt between objects
    await page.click('#drwTL'); await clickChart(x, geo.H * 0.3); await clickChart(x + 60, geo.H * 0.35);
    const on2 = await page.evaluate(() => ({ tool, pending: pendingPt, n: drawings.length }));
    // annotation tools follow the same flag
    await page.click('#annUp'); await clickChart(x, geo.H * 0.8);
    const ann = await page.evaluate(() => ({ tool, n: annotations.length }));
    await page.click('#btnKeepDraw'); await page.evaluate(() => setTool('')); await page.click('#drwHL'); await clickChart(x, geo.H * 0.55);
    const back = await page.evaluate(() => ({ tool, keep: keepDrawing, n: drawings.length }));
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(); });
    const ok = off.tool === '' && off.n === 1 && !off.active && kd.keep && kd.stored === 'true' && kd.active && on.tool === 'hl' && on.n === 3 && on.active && on2.tool === 'tl' && on2.pending === null && on2.n === 4 && ann.tool === 'au' && ann.n === 1 && back.tool === '' && !back.keep && back.n === 5;
    report('G4', ok, `keep off: tool='${off.tool}' n=${off.n}; toggled: keepDrawing=${kd.keep} stored=${kd.stored} btn active=${kd.active}; two hl placed: tool='${on.tool}' n=${on.n} btn active=${on.active}; tl: tool='${on2.tool}' pendingPt=${on2.pending} n=${on2.n}; annUp: tool='${ann.tool}' annotations=${ann.n}; keep off again: tool='${back.tool}' n=${back.n}`);
    report('G3', off.tool === '' && back.tool === '', `with Keep drawing off the tool reverts to cursor after each placement (tool='${off.tool}' / '${back.tool}')`);
  }

  // ================= G1 one-point tools complete on a single click (hl / hray / vline / cross) =================
  await clear();
  {
    const x = await barX(k + 8), out = [];
    for (const [btn, type] of [['drwHL', 'hl'], ['drwHRay', 'hray'], ['drwVLine', 'vline'], ['drwCross', 'cross']]) {
      await clear(); await page.click('#' + btn); await clickChart(x, geo.H * 0.5);
      out.push(await page.evaluate((type) => { const d = drawings[0]; return { type, n: drawings.length, got: d && d.type, hasP2: !!(d && d.p2), pending: pendingPt, tool, hasP: !!(d && 'p' in d.p1), hasT: !!(d && 't' in d.p1) }; }, type));
    }
    const ok = out.every(o => o.n === 1 && o.got === o.type && !o.hasP2 && o.pending === null && o.tool === '' && o.hasT && (o.type === 'vline' ? !o.hasP : o.hasP));
    report('G1', ok, out.map(o => `${o.type}: n=${o.n} type=${o.got} p2=${o.hasP2} pending=${o.pending} tool='${o.tool}' t=${o.hasT} p=${o.hasP}`).join('; '));
  }

  // ================= Magnet menu UI: chevron on hover, weak/strong pick, body toggle to last mode =================
  await page.evaluate(() => { magnet = 'off'; magnetMode = 'weak'; saveJSON('rt_magnet', 'off'); saveJSON('rt_magnet_mode', 'weak'); });
  {
    const before = await page.evaluate(() => getComputedStyle(document.getElementById('btnMagnetMenu')).opacity);
    await page.hover('#btnMagnet'); await page.waitForTimeout(150);
    const hov = await page.evaluate(() => getComputedStyle(document.getElementById('btnMagnetMenu')).opacity);
    await page.click('#btnMagnetMenu'); await page.waitForTimeout(150);
    const open = await page.evaluate(() => document.getElementById('magnetPopover').classList.contains('open'));
    await page.click('#magStrong'); await page.waitForTimeout(150);
    const s1 = await page.evaluate(() => ({ magnet, mode: magnetMode, open: document.getElementById('magnetPopover').classList.contains('open'), active: document.getElementById('btnMagnet').classList.contains('active'), stored: localStorage.getItem('rt_magnet'), storedMode: localStorage.getItem('rt_magnet_mode') }));
    await page.click('#btnMagnet'); await page.waitForTimeout(100);
    const s2 = await page.evaluate(() => ({ magnet, active: document.getElementById('btnMagnet').classList.contains('active') }));
    await page.click('#btnMagnet'); await page.waitForTimeout(100);
    const s3 = await page.evaluate(() => ({ magnet, mode: magnetMode }));
    await page.hover('#btnMagnet'); await page.click('#btnMagnetMenu'); await page.click('#magWeak'); await page.waitForTimeout(100);
    const s4 = await page.evaluate(() => ({ magnet, mode: magnetMode, weakSel: document.getElementById('magWeak').classList.contains('sel'), strongSel: document.getElementById('magStrong').classList.contains('sel') }));
    await page.hover('#btnMagnet'); await page.click('#btnMagnetMenu'); await page.click('#magInd'); await page.waitForTimeout(100);
    const s5 = await page.evaluate(() => ({ ind: magnetInd, stored: localStorage.getItem('rt_magnet_ind') }));
    await page.click('#magInd'); await page.keyboard.press('Escape');
    const ok = before === '0' && hov === '1' && open && s1.magnet === 'strong' && s1.mode === 'strong' && !s1.open && s1.active && s1.stored === '"strong"' && s1.storedMode === '"strong"' && s2.magnet === 'off' && !s2.active && s3.magnet === 'strong' && s4.magnet === 'weak' && s4.weakSel && !s4.strongSel && s5.ind && s5.stored === 'true';
    report('G8-menu', ok, `chevron opacity idle=${before} hover=${hov}; menu open=${open}; pick Strong -> magnet=${s1.magnet} mode=${s1.mode} menu closed=${!s1.open} btn active=${s1.active} stored=${s1.stored}/${s1.storedMode}; body click -> ${s2.magnet} (active=${s2.active}); body click -> ${s3.magnet}; pick Weak -> ${s4.magnet} weakSel=${s4.weakSel} strongSel=${s4.strongSel}; Snap to indicators -> ${s5.ind} stored=${s5.stored}`);
  }

  // ================= regressions: trading hotkeys + annotation tools + no console errors =================
  await clear(); await page.evaluate(() => { magnet = 'off'; saveJSON('rt_magnet', 'off'); if (keepDrawing) { keepDrawing = false; saveJSON('rt_keepdraw', false); document.getElementById('btnKeepDraw').classList.remove('active'); } });
  {
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });   // hotkeys ignore INPUT/SELECT targets; drop focus left on the menu checkbox
    await page.keyboard.press('b'); await page.waitForTimeout(200);
    const afterB = await page.evaluate(() => ({ pos: !!position, side: position && position.side, entry: !!entryOrder }));
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    const afterX = await page.evaluate(() => ({ pos: !!position, entry: !!entryOrder }));
    await page.keyboard.press('s'); await page.waitForTimeout(200);
    const afterS = await page.evaluate(() => ({ pos: !!position, side: position && position.side, entry: !!entryOrder }));
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    await page.keyboard.press('f'); await page.waitForTimeout(200);
    const afterF = await page.evaluate(() => ({ pos: !!position, entry: !!entryOrder, orders: orders.length }));
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    await page.keyboard.press('j'); await page.waitForTimeout(200);
    const afterJ = await page.evaluate(() => ({ pos: !!position, entry: !!entryOrder, orders: orders.length }));
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    const flat = await page.evaluate(() => ({ pos: !!position, entry: !!entryOrder }));
    const okKeys = (afterB.pos || afterB.entry) && !afterX.pos && !afterX.entry && (afterS.pos || afterS.entry) && (afterF.pos || afterF.entry || afterF.orders > 0) && (afterJ.pos || afterJ.entry || afterJ.orders > 0) && !flat.pos && !flat.entry;
    report('HOTKEYS', okKeys, `B -> pos=${afterB.pos}(${afterB.side})/entry=${afterB.entry}; X -> pos=${afterX.pos} entry=${afterX.entry}; S -> pos=${afterS.pos}(${afterS.side})/entry=${afterS.entry}; F -> pos/entry/orders=${afterF.pos}/${afterF.entry}/${afterF.orders}; J -> ${afterJ.pos}/${afterJ.entry}/${afterJ.orders}; X -> flat=${!flat.pos && !flat.entry}`);
    const x = await barX(k + 3);
    const a0 = await page.evaluate(() => annotations.length);
    for (const b of ['annUp', 'annDown', 'annLong', 'annShort']) { await page.click('#' + b); await clickChart(x, geo.H * 0.5); }
    const ann = await page.evaluate((k) => ({ n: annotations.length, tool, onBar: annotations.every(a => a.baseTime === bars[k].time), shapes: annotations.map(a => a.shape + (a.text ? ':' + a.text : '')).join(',') }), k + 3);
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(); });
    report('ANNOTATIONS', ann.n === a0 + 4 && ann.tool === '' && ann.onBar, `annUp/annDown/annLong/annShort placed ${ann.n - a0} markers (${ann.shapes}) on the clicked bar=${ann.onBar}, tool reverted='${ann.tool}'`);
  }
  await clear();
  report('CONSOLE', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : 'no console errors / page errors across all loads');
} catch (e) {
  report('SCRIPT', false, 'exception: ' + (e && e.stack || e));
} finally {
  await browser.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} PASS`);
process.exit(results.every(Boolean) ? 0 : 1);
