// TV drawing parity — Stage 5 verification matrix (TV_DRAWING_GAP.md Stage 5 table, p.331-364).
// One test per rule G1..G48 (rules wholly out of scope per §(C) print SKIP with a reason) + the 4 regression guards.
// Adapted from the implementer's own per-stage acceptance scripts (tests/tv_drawing_stage1..4.mjs), which were each
// independently re-verified by adversarial QA passes (tests/qa_stage*_r*.mjs) already in this repo — this script
// consolidates all of that into ONE run, one line per rule, in G-number order.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/tv_drawing_matrix.mjs   (needs http://127.0.0.1:5560/ up)
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/?r=' + Date.now();
const results = [];
const report = (id, ok, detail) => { results.push({ id, status: ok ? 'PASS' : 'FAIL' }); console.log(`${id} ${ok ? 'PASS' : 'FAIL'} — ${detail}`); };
const skip = (id, reason) => { results.push({ id, status: 'SKIP' }); console.log(`${id} SKIP — ${reason}`); };
const errs = [];
let dialogMode = 'accept', dialogs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('dialog', d => { dialogs.push(d.message()); if (dialogMode === 'dismiss') d.dismiss(); else d.accept(); });

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
    const rgbAt = (cs, x, y) => { for (let i = cs.length - 1; i >= 0; i--) { const { ctx, ox, oy, w, h, sx, sy } = cs[i]; const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy); if (px < 0 || py < 0 || px >= w || py >= h) continue; const d = ctx.getImageData(px, py, 1, 1).data; if (d[3] > 80) return [...d]; } return null; };
    const isInk = (d) => d && d[3] > 80 && (d[0] < 200 || d[1] < 200 || d[2] < 200) && !(d[0] === d[1] && d[1] === d[2] && d[0] > 200);
    const darkAt = (cs, x, y) => cs.some(({ ctx, ox, oy, w, h, sx, sy }) => { const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy); if (px < 0 || py < 0 || px >= w || py >= h) return false; const d = ctx.getImageData(px, py, 1, 1).data; return d[3] > 200 && d[0] < 70 && d[1] < 70 && d[2] < 70; });
    window.__colDark = (rootId, x, y0, y1) => { const cs = canvases(rootId); let n = 0, tot = 0; for (let y = Math.max(0, y0); y < y1; y++) { tot++; if (darkAt(cs, x - 1, y) || darkAt(cs, x, y) || darkAt(cs, x + 1, y)) n++; } return tot ? n / tot : 0; };
    window.__rowDark = (rootId, y, x0, x1) => { const cs = canvases(rootId); let n = 0, tot = 0; for (let x = Math.max(0, x0); x < x1; x++) { tot++; if (darkAt(cs, x, y - 1) || darkAt(cs, x, y) || darkAt(cs, x, y + 1)) n++; } return tot ? n / tot : 0; };
    window.__paneW = (rootId) => Math.max(...canvases(rootId).map(c => c.w / c.sx));
    window.__ptInk = (rootId, x, y, rad = 2) => { const cs = canvases(rootId); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if (isInk(rgbAt(cs, x + dx, y + dy))) return true; return false; };
    window.__rowInk = (rootId, y, x0, x1) => { const cs = canvases(rootId); let best = 0; for (let dy = -2; dy <= 2; dy++) { let n = 0; for (let x = x0; x < x1; x += 2) if (isInk(rgbAt(cs, x, y + dy))) n++; best = Math.max(best, n); } return best; };
    window.__segInk = (rootId, x1, y1, x2, y2, n = 12) => { let hit = 0; for (let k = 1; k < n; k++) { const t = k / n; if (window.__ptInk(rootId, Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), 2)) hit++; } return hit / (n - 1); };
    window.__rgbNear = (rootId, x, y, rad = 1) => { const cs = canvases(rootId), o = []; for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) o.push((rgbAt(cs, Math.round(x) + dx, Math.round(y) + dy) || []).join(',')); return o.join(';'); };   // NT checks: raw neighbourhood for before/after pixel diffs (immune to candle ink)
    window.__colorNear = (rootId, x, y, test, rad = 2) => { const cs = canvases(rootId); const f = new Function('r', 'g', 'b', 'return ' + test); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) { const d = rgbAt(cs, x + dx, y + dy); if (d && d[3] > 80 && f(d[0], d[1], d[2])) return true; } return false; };
  });
}
const nearT = (t, exp) => t != null && exp != null && Math.abs(t - exp) <= 8;
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const priceY = (p) => page.evaluate((p) => candle.priceToCoordinate(p), p);
const clickChart = async (x, y, mods = [], button = 'left') => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(r.left + x, r.top + y, { button }); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(650); };
const clickTool = async (sel) => { const inPop = await page.$eval(sel, e => !!e.closest('#linesPopover')).catch(() => false); if (inPop) { await page.hover('#drwLines'); await page.click('#btnLinesMenu'); await page.waitForTimeout(150); } await page.click(sel); };
const dragChart = async (x1, y1, x2, y2, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.move(r.left + x1, r.top + y1); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(r.left + x1 + (x2 - x1) * i / 8, r.top + y1 + (y2 - y1) * i / 8); await page.waitForTimeout(60); await page.mouse.up(); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(300); };
const hoverChart = async (x, y) => { const r = await chartRect(); await page.mouse.move(r.left + x, r.top + y); await page.waitForTimeout(150); };
const paint = () => page.evaluate(() => new Promise(res => { repaintOverlays(); requestAnimationFrame(() => requestAnimationFrame(() => res(window.__drwDbg))); }));
const seed = (list) => page.evaluate((list) => { drawings.length = 0; for (const d of list) drawings.push(newDrawing(d)); clearSelection(); saveJSON('rt_drawings', drawings); repaintOverlays(); }, list);
const clear = async () => page.evaluate(() => { drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); drawingsLocked = false; lockBtnUI(); undoStack.length = 0; redoStack.length = 0; if ($('drawSettings').classList.contains('open')) closeDrawSettings(); repaintOverlays(); });
const geomOf = (i) => page.evaluate((i) => { const d = drawings[i]; if (!d) return null; return { type: d.type, t1: d.p1.t, p1: d.p1.p, t2: d.p2 && d.p2.t, p2: d.p2 && d.p2.p, x1: drawX(d.p1.t), y1: drawY(d.p1.p), x2: d.p2 ? drawX(d.p2.t) : null, y2: d.p2 ? drawY(d.p2.p) : null, stop: d.stop, target: d.target, color: d.style && d.style.color }; }, i);
const drawTL = async (x1, y1, x2, y2, mods2 = [], tool = 'drwTL') => { await clickTool('#' + tool); await clickChart(x1, y1); await clickChart(x2, y2, mods2); };
const n = () => page.evaluate(() => drawings.length);
const key = async (combo) => { await page.keyboard.press(combo); await page.waitForTimeout(120); };
const setMagnet = (v) => page.evaluate((v) => { magnet = v; if (v !== 'off') magnetMode = v; saveJSON('rt_magnet', v); }, v);
const ohlcOf = (k) => page.evaluate((k) => { const b = bars[k]; return [b.open, b.high, b.low, b.close]; }, k);
const st = () => page.evaluate(() => ({ tool, entry: entryOrder && { side: entryOrder.side, kind: entryOrder.kind }, pos: position && position.side, idx, sess: currentSessionIdx() }));

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); localStorage.setItem('rt_annotations', '[]'); localStorage.setItem('rt_magnet', '"off"'); localStorage.setItem('rt_lockdrw', 'false'); localStorage.setItem('rt_keepdraw', 'false'); localStorage.removeItem('rt_hide'); localStorage.removeItem('rt_alwaysrmlocked'); });
  await load();
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx, tf, spacing: chart.timeScale().options().barSpacing, pMid: candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5), pLow: candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.72), lastT: bars[idx].time, nBars: bars.length }));
  const k = geo.idx - 40, k2 = geo.idx - 15;

  // ================= G48 leftbar inventory (Object tree intentionally excluded — see §(C)) =================
  {
    const inv = await page.evaluate(() => ['toolCursor', 'btnMagnet', 'btnMagnetMenu', 'btnKeepDraw', 'btnLockDrw', 'btnHideDrw', 'btnHideMenu', 'drwClear', 'btnRemoveMenu', 'hidePopover', 'removePopover'].map(id => [id, !!document.getElementById(id)]));
    const missing = inv.filter(([, ok]) => !ok).map(([id]) => id);
    const drwOk = await page.evaluate(() => window.__drw !== undefined || drawings.length === 0);
    report('G48', missing.length === 0 && errs.length === 0, `leftbar: cursor/magnet(+menu)/keep-drawing/lock/hide(+menu)/remove(+menu) present, missing=[${missing.join(',')}]; Object tree deliberately not built (§C); console errors=${errs.length}`);
  }

  // ================= G1 one-point tools complete on a single click =================
  await clear();
  {
    const x = await barX(k + 8), out = [];
    for (const [btn, type] of [['drwHL', 'hl'], ['drwHRay', 'hray'], ['drwVLine', 'vline'], ['drwCross', 'cross']]) {
      await clear(); await clickTool('#' + btn); await clickChart(x, geo.H * 0.5);
      out.push(await page.evaluate((type) => { const d = drawings[0]; return { type, n: drawings.length, got: d && d.type, hasP2: !!(d && d.p2), pending: pendingPt, tool, hasP: !!(d && 'p' in d.p1) }; }, type));
    }
    const ok = out.every(o => o.n === 1 && o.got === o.type && !o.hasP2 && o.pending === null && o.tool === '' && (o.type === 'vline' ? !o.hasP : o.hasP));
    report('G1', ok, out.map(o => `${o.type}: n=${o.n} type=${o.got} p2=${o.hasP2} tool='${o.tool}'`).join('; '));
  }

  // ================= G2 rubber-band preview (line + box) =================
  await clear(); await setMagnet('off');
  {
    const xa = await barX(k), ya = Math.round(geo.H * 0.35), xb = await barX(k + 25), yb = Math.round(geo.H * 0.65);
    const cr = await chartRect();
    await clickTool('#drwTL'); await clickChart(xa, ya);
    await page.mouse.move(cr.left + xb, cr.top + yb, { steps: 4 }); await page.waitForTimeout(250);
    const r = await page.evaluate(() => ({ pending: !!pendingPt, prev: previewXY, dbg: window.__drwDbg && window.__drwDbg.preview, n: drawings.length }));
    const ink = await page.evaluate(({ xa, ya, xb, yb }) => window.__segInk('chart', xa, ya, xb, yb), { xa, ya, xb, yb });
    await clickChart(xb, yb); await clear(); await page.click('#drwBox'); await clickChart(xa, ya); await page.mouse.move(cr.left + xb, cr.top + yb, { steps: 3 }); await page.waitForTimeout(200);
    const box = await page.evaluate(({ xa, ya, xb, yb }) => ({ dbg: window.__drwDbg && window.__drwDbg.preview, top: window.__segInk('chart', xa, ya, xb, ya), right: window.__segInk('chart', xb, ya, xb, yb) }), { xa, ya, xb, yb });
    await page.keyboard.press('Escape');
    const ok = r.pending && r.n === 0 && r.prev && Math.abs(r.prev.x - xb) < 1 && r.dbg && r.dbg.tool === 'tl' && ink > 0.7 && box.dbg && box.dbg.tool === 'box' && box.top > 0.6 && box.right > 0.6;
    report('G2', ok, `tl: pendingPt after 1st click=${r.pending}, live segment to cursor ink=${ink.toFixed(2)}; box preview: top edge ink=${box.top.toFixed(2)} right edge ink=${box.right.toFixed(2)}`);
  }

  // ================= G3 auto-revert / G4 Keep drawing =================
  await clear();
  {
    const x = await barX(k);
    await clickTool('#drwHL'); await clickChart(x, geo.H * 0.4);
    const off = await page.evaluate(() => ({ tool, n: drawings.length, active: document.getElementById('drwHL').classList.contains('active') }));
    await page.click('#btnKeepDraw');
    const kd = await page.evaluate(() => ({ keep: keepDrawing, stored: localStorage.getItem('rt_keepdraw'), active: document.getElementById('btnKeepDraw').classList.contains('active') }));
    await clickTool('#drwHL'); await clickChart(x, geo.H * 0.45); await clickChart(x, geo.H * 0.5);
    const on = await page.evaluate(() => ({ tool, n: drawings.length, active: document.getElementById('drwHL').classList.contains('active') }));
    await clickTool('#drwTL'); await clickChart(x, geo.H * 0.3); await clickChart(x + 60, geo.H * 0.35);
    const on2 = await page.evaluate(() => ({ tool, pending: pendingPt, n: drawings.length }));
    await page.click('#annUp'); await clickChart(x, geo.H * 0.8);
    const ann = await page.evaluate(() => ({ tool, n: annotations.length }));
    await page.click('#btnKeepDraw'); await page.evaluate(() => setTool('')); await clickTool('#drwHL'); await clickChart(x, geo.H * 0.55);
    const back = await page.evaluate(() => ({ tool, keep: keepDrawing, n: drawings.length }));
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(); });
    report('G3', off.tool === '' && back.tool === '', `after a single placement (Keep drawing off) tool reverts to cursor: '${off.tool}' / '${back.tool}'`);
    const g4ok = off.n === 1 && !off.active && kd.keep && kd.stored === 'true' && kd.active && on.tool === 'hl' && on.n === 3 && on2.tool === 'tl' && on2.pending === null && on2.n === 4 && ann.tool === 'au' && ann.n === 1 && back.tool === '' && !back.keep && back.n === 5;
    report('G4', g4ok, `toggled on: keepDrawing=${kd.keep} btn active=${kd.active}; two hl placed without leaving tool armed (n=${on.n}, tool='${on.tool}'); tl 2nd object pendingPt cleared between objects; annUp (arrow-marker tool) also stays armed (tool='${ann.tool}'); toggled off -> tool reverts again`);
  }

  // ================= G5 price free (magnet off) =================
  await clear(); await setMagnet('off');
  {
    let y = Math.round(geo.H * 0.5), p = await page.evaluate((y) => candle.coordinateToPrice(y), y);
    for (let i = 0; i < 40 && Math.abs(p / 0.25 - Math.round(p / 0.25)) < 0.05; i++) { y += 1; p = await page.evaluate((y) => candle.coordinateToPrice(y), y); }
    await clickTool('#drwHL'); await clickChart(await barX(k), y);
    const r = await page.evaluate(() => ({ n: drawings.length, p: drawings[0] && drawings[0].p1.p, tool }));
    const offTick = r.p != null && Math.abs(r.p / 0.25 - Math.round(r.p / 0.25)) > 0.01;
    report('G5', r.n === 1 && offTick && r.tool === '', `hl placed p=${r.p} (clicked price ${p}), not tick-quantised=${offTick}`);
  }

  // ================= G6 time free =================
  await clear();
  {
    const xa = (await barX(k)) + geo.spacing * 0.4, xb = (await barX(k + 12)) + geo.spacing * 0.45;
    await clickTool('#drwTL'); await clickChart(xa, geo.H * 0.4); await clickChart(xb, geo.H * 0.55);
    const r = await page.evaluate(() => { const d = drawings[0]; return { n: drawings.length, on1: d && bars.some(b => b.time === d.p1.t), on2: d && bars.some(b => b.time === d.p2.t), tool, x1: d && drawX(d.p1.t), x2: d && drawX(d.p2.t) }; });
    report('G6', r.n === 1 && !r.on1 && !r.on2 && Math.abs(r.x1 - xa) < 1.5 && Math.abs(r.x2 - xb) < 1.5 && r.tool === '', `tl placed between bars: on a bar time=${r.on1}/${r.on2}; drawX round-trip x1=${r.x1 && r.x1.toFixed(1)}≈${xa.toFixed(1)} x2=${r.x2 && r.x2.toFixed(1)}≈${xb.toFixed(1)}`);
  }

  // ================= G7 future space: placement (click) + seeded-load render (reload) =================
  await clear();
  {
    const xLast = await barX(geo.idx), x = xLast + geo.spacing * 3.5;
    await clickTool('#drwHRay'); await clickChart(x, geo.H * 0.5);
    const place = await page.evaluate(() => { const d = drawings[0]; return { n: drawings.length, t: d && d.p1.t, lastT: bars[idx].time, x: d && drawX(d.p1.t), native: d && chart.timeScale().timeToCoordinate(d.p1.t) }; });
    await page.evaluate(({ lastT, pMid }) => { localStorage.setItem('rt_drawings', JSON.stringify([{ type: 'vline', p1: { t: lastT + 240 }, color: '#000000' }, { type: 'tl', p1: { t: lastT - 600, p: pMid }, p2: { t: lastT + 240, p: pMid }, color: '#000000' }])); localStorage.setItem('rt_drawings_v', '1'); }, geo);
    await load();
    const seeded = await page.evaluate(() => { const ts = chart.timeScale(), last = bars[idx].time, xV = drawX(last + 240), H = document.getElementById('chart').clientHeight; return { ok: window.__drw && window.__drw.ok, n: drawings.length, xV, xLast: ts.timeToCoordinate(last), tt: ts.timeToCoordinate(last + 240), col: window.__colDark('chart', Math.round(xV), 20, H - 30) }; });
    const ok = place.n === 1 && place.t > place.lastT && Math.abs(place.x - x) < 1.5 && place.native == null && seeded.ok && seeded.n === 2 && seeded.xV > seeded.xLast && seeded.col > 0.9 && seeded.tt == null;
    report('G7', ok, `click 3.5 bars past the last bar -> placed at t=${place.t}>${place.lastT}, native timeToCoordinate=${place.native}; reload with a drawing seeded 4 bars into the future -> renders (col dark=${seeded.col.toFixed(2)}, __drw.ok=${seeded.ok}), native timeToCoordinate still ${seeded.tt}`);
    await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); }); await load();
  }

  // ================= G8 Weak/Strong magnet grading + menu gesture (chevron / body toggle) + 12px threshold decision =================
  await clear(); await setMagnet('strong');
  {
    const ohlc = await ohlcOf(k), x = (await barX(k)) + geo.spacing * 0.3, yFar = (await priceY(ohlc[1])) - 60;
    await clickTool('#drwHL'); await clickChart(x, yFar);
    const strong = await page.evaluate((k) => { const d = drawings[0]; return { n: drawings.length, p: d && d.p1.p, t: d && d.p1.t, bt: bars[k].time }; }, k);
    await clear(); await setMagnet('weak');
    const ohlc2 = await ohlcOf(k), x2 = await barX(k), yH = await priceY(ohlc2[1]);
    await clickTool('#drwHL'); await clickChart(x2, yH - 40);
    const far = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p) }; }, ohlc2);
    await clear(); await clickTool('#drwHL'); await clickChart(x2, yH - 6);
    const near = await page.evaluate((ohlc) => { const d = drawings[0]; return { p: d && d.p1.p, snapped: d && ohlc.includes(d.p1.p) }; }, ohlc2);
    const wpx = await page.evaluate(() => MAGNET_WEAK_PX);
    // menu gesture: hover reveals chevron, click opens weak/strong popover, body click toggles off<->lastMode
    await page.evaluate(() => { magnet = 'off'; magnetMode = 'weak'; saveJSON('rt_magnet', 'off'); saveJSON('rt_magnet_mode', 'weak'); });
    const idle = await page.evaluate(() => getComputedStyle(document.getElementById('btnMagnetMenu')).opacity);
    await page.hover('#btnMagnet'); await page.waitForTimeout(150);
    const hov = await page.evaluate(() => getComputedStyle(document.getElementById('btnMagnetMenu')).opacity);
    await page.click('#btnMagnetMenu'); await page.waitForTimeout(150);
    const open = await page.evaluate(() => document.getElementById('magnetPopover').classList.contains('open'));
    await page.click('#magStrong'); await page.waitForTimeout(150);
    const s1 = await page.evaluate(() => ({ magnet, mode: magnetMode, open: document.getElementById('magnetPopover').classList.contains('open'), active: document.getElementById('btnMagnet').classList.contains('active') }));
    await page.click('#btnMagnet'); await page.waitForTimeout(100);
    const s2 = await page.evaluate(() => magnet);
    await page.click('#btnMagnet'); await page.waitForTimeout(100);
    const s3 = await page.evaluate(() => magnet);
    await setMagnet('off');
    const ok = strong.n === 1 && strong.p === ohlc[1] && strong.t === strong.bt && far.p != null && !far.snapped && near.p === ohlc2[1] && wpx === 12 && idle === '0' && hov === '1' && open && s1.magnet === 'strong' && !s1.open && s1.active && s2 === 'off' && s3 === 'strong';
    report('G8', ok, `strong snaps regardless of distance (60px above high -> p=high, time snapped to bar); weak: 40px away unsnapped, 6px away snapped (MAGNET_WEAK_PX=${wpx}, decision=12); menu: chevron hidden idle/shown on hover (${idle}->${hov}), click opens picker(${open}), pick Strong sets magnet(${s1.magnet}); body click toggles off<->last mode(${s2}->${s3})`);
  }

  // ================= G9 Ctrl temporarily inverts the magnet (click + drag) =================
  await clear(); await setMagnet('off'); await page.evaluate(() => { magnetMode = 'strong'; });
  {
    const ohlc = await ohlcOf(k), x = await barX(k), yH = await priceY(ohlc[1]);
    await clickTool('#drwHL'); await clickChart(x, yH - 50, ['Control']);
    const withCtrl = await page.evaluate((ohlc) => ({ p: drawings[0] && drawings[0].p1.p, snapped: drawings[0] && ohlc.includes(drawings[0].p1.p) }), ohlc);
    await clear(); await clickTool('#drwHL'); await clickChart(x, yH - 50);
    const noCtrl = await page.evaluate((ohlc) => ({ snapped: drawings[0] && ohlc.includes(drawings[0].p1.p) }), ohlc);
    await clear(); await setMagnet('strong'); await clickTool('#drwHL'); await clickChart(x, yH - 50, ['Control']);
    const strongCtrl = await page.evaluate((ohlc) => ({ snapped: drawings[0] && ohlc.includes(drawings[0].p1.p) }), ohlc);
    // drag with Ctrl held/released mid-drag
    await clear(); await setMagnet('off'); await page.evaluate(() => { magnetMode = 'strong'; });
    const ohlc5 = await ohlcOf(k + 5), xT = await barX(k + 5), yH5 = await priceY(ohlc5[1]);
    await page.evaluate((k) => { drawings.push(newDrawing({ type: 'hl', p1: { t: bars[k].time, p: candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.3) }, color: '#000000' })); saveJSON('rt_drawings', drawings); repaintOverlays(); }, k);
    const y0 = await page.evaluate(() => drawY(drawings[0].p1.p)); const cr = await chartRect();
    await page.mouse.move(cr.left + xT, cr.top + y0); await page.mouse.down(); await page.keyboard.down('Control');
    await page.mouse.move(cr.left + xT, cr.top + yH5 - 45, { steps: 5 }); await page.waitForTimeout(100);
    const during = await page.evaluate(() => drawings[0].p1.p);
    await page.keyboard.up('Control'); await page.mouse.move(cr.left + xT, cr.top + yH5 - 46, { steps: 2 }); await page.waitForTimeout(100);
    const after = await page.evaluate(() => drawings[0].p1.p);
    await page.mouse.up(); await page.waitForTimeout(200);
    const ok = withCtrl.snapped && withCtrl.p === ohlc[1] && !noCtrl.snapped && !strongCtrl.snapped && during === ohlc5[1] && !ohlc5.includes(after);
    report('G9', ok, `magnet off + Ctrl -> snaps(${withCtrl.snapped}); off no Ctrl -> free(${!noCtrl.snapped}); strong + Ctrl -> free(${!strongCtrl.snapped}); dragging an anchor: Ctrl held snaps(${during === ohlc5[1]}), released mid-drag frees(${!ohlc5.includes(after)})`);
  }

  // ================= G10 snap target = nearest revealed bar's OHLC; no snap in future space =================
  await clear(); await setMagnet('strong');
  {
    const xLast = await barX(geo.idx), x = xLast + geo.spacing * 3;
    const y = Math.round(geo.H * 0.5), pClick = await page.evaluate((y) => candle.coordinateToPrice(y), y);
    await clickTool('#drwHL'); await clickChart(x, y);
    const r = await page.evaluate(() => { const d = drawings[0]; const all = new Set(); for (let i = Math.max(0, idx - 3); i <= idx; i++) for (const v of [bars[i].open, bars[i].high, bars[i].low, bars[i].close]) all.add(v); return { n: drawings.length, p: d && d.p1.p, t: d && d.p1.t, lastT: bars[idx].time, inOhlc: d && all.has(d.p1.p), mi: magnetBarIdx(d && d.p1.t) }; });
    report('G10', r.n === 1 && Math.abs(r.p - pClick) < 0.25 && r.t > r.lastT && !r.inOhlc && r.mi === -1, `strong magnet 3 bars past the last bar: p==clicked(free)=${Math.abs(r.p - pClick) < 0.25}, magnetBarIdx=${r.mi} (-1 = no bar under cursor -> no snap in future space)`);
  }

  // ================= G11 Snap to indicators (VWAP joins O/H/L/C as a snap target) =================
  await clear(); await setMagnet('strong');
  {
    await page.evaluate(() => { setVwap(true); document.getElementById('indVwap').checked = true; });
    await page.waitForTimeout(300);
    const pick = await page.evaluate(() => { for (let i = idx - 60; i < idx - 5; i++) { const v = vwapData[i]; if (v == null) continue; const b = bars[i], yv = candle.priceToCoordinate(v); if (yv == null || yv < 30) continue; const dmin = Math.min(...[b.open, b.high, b.low, b.close].map(o => Math.abs(candle.priceToCoordinate(o) - yv))); if (dmin >= 3) return { i, v, yv, dmin }; } return null; });
    if (!pick) report('G11', false, 'not verified — no revealed bar in view had VWAP >=3px clear of every OHLC value to test against');
    else {
      const x = await barX(pick.i);
      await page.evaluate(() => { magnetInd = false; }); await clickTool('#drwHL'); await clickChart(x, pick.yv + 1);
      const off = await page.evaluate(() => drawings[0] && drawings[0].p1.p);
      await clear(); await page.evaluate(() => { magnetInd = true; document.getElementById('magInd').checked = true; }); await clickTool('#drwHL'); await clickChart(x, pick.yv + 1);
      const on = await page.evaluate(() => drawings[0] && drawings[0].p1.p);
      const ohlc = await ohlcOf(pick.i);
      report('G11', ohlc.includes(off) && on === pick.v, `bar ${pick.i} VWAP=${pick.v}: Snap to indicators off -> snaps to an OHLC value instead(${ohlc.includes(off)}); on -> snaps to VWAP(${on === pick.v})`);
      await page.evaluate(() => { magnetInd = false; document.getElementById('magInd').checked = false; setVwap(false); document.getElementById('indVwap').checked = false; });
    }
  }
  await setMagnet('off');

  // ================= G12 anchor handles drawn only when selected / hovered =================
  await clear();
  {
    const xa = await barX(k), xb = await barX(k + 14), ya = geo.H * 0.35, yb = geo.H * 0.55;
    await drawTL(xa, ya, xb, yb);
    let g = await geomOf(0);
    await clickChart(geo.W * 0.5, geo.H * 0.9); await hoverChart(20, 20);
    let dbg = await paint();
    const noSel = await page.evaluate(() => ({ sel: selDrawing, n: selSet.size }));
    const inkP1Unsel = await page.evaluate(([x, y]) => window.__ptInk('chart', x - 2, y + 2, 0) || window.__ptInk('chart', x + 2, y - 2, 0), [g.x1, g.y1]);
    const handlesUnsel = dbg.handles;
    await hoverChart((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2);
    const hov = await page.evaluate(() => ({ h: hoverDrawing && hoverDrawing.type, handles: window.__drwDbg.handles }));
    await clickChart((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2);
    dbg = await paint();
    const selNow = await page.evaluate(() => selDrawing && selDrawing.type);
    const inkP1Sel = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y + 2, 'b > 180 && r < 140', 0) || window.__colorNear('chart', x + 2, y - 2, 'b > 180 && r < 140', 0), [g.x1, g.y1]);
    const tlOk = noSel.sel === null && handlesUnsel === 0 && !inkP1Unsel && hov.h === 'tl' && hov.handles === 2 && selNow === 'tl' && dbg.handles === 2 && inkP1Sel;
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = geo.pMid;
    await seed([{ type: 'measure', p1: { t: ts[0], p: pm + 6 }, p2: { t: ts[1], p: pm - 6 }, color: '' }, { type: 'rr', p1: { t: ts[0], p: pm - 30 }, stop: pm - 40, target: pm - 10, color: '' }]);
    await paint();
    const m = await geomOf(0), r = await geomOf(1);
    const rrXa = await page.evaluate(() => rrRange(drawings[1], drawX).xa), rrYt = await page.evaluate(() => drawY(drawings[1].target));
    // measure probe at (-2,-2) like tl/rr: the old (-3,-3) sat 4.24px out on the 5px dot's anti-aliased black ring, so it passed or failed with the sub-pixel chart geometry
    const mUn = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y - 2, 'b > 180 && r < 140', 0), [m.x1, m.y1]);
    const rUn = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y - 2, 'b > 180 && r < 140', 0), [rrXa, rrYt]);
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); }); await paint();
    const mSel = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y - 2, 'b > 180 && r < 140', 0), [m.x1, m.y1]);
    await page.evaluate(() => { selectDrawing(drawings[1], false); repaintOverlays(); }); await paint();
    const rSel = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y - 2, 'b > 180 && r < 140', 0), [rrXa, rrYt]);
    report('G12', tlOk && !mUn && !rUn && mSel && rSel, `tl: no handles unselected(${handlesUnsel === 0}), handles on hover(${hov.handles}) and on select(${dbg.handles}); measure/rr: handle ink appears only after select (measure ${mUn}->${mSel}, rr ${rUn}->${rSel})`);
  }

  // ================= G13 floating toolbar =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 40);
    await clickChart(xa + 75, ya + 20);
    await paint();
    const r0 = await chartRect();
    const tb = await page.evaluate(() => { const el = document.getElementById('drawToolbar'), r = el.getBoundingClientRect(); return { hidden: el.hidden, r: r.toJSON(), st: window.__drwDbg.toolbar, bbox: window.__drwDbg.bbox }; });
    const vis = await page.locator('#drawToolbar').isVisible();
    const inside = tb.r.left >= r0.left && tb.r.right <= r0.right && tb.r.top >= r0.top && tb.r.bottom <= r0.bottom;
    await page.evaluate(() => { const c = document.getElementById('dtColor'); c.value = '#ff00ff'; c.dispatchEvent(new Event('input', { bubbles: true })); });
    await paint();
    const st2 = await page.evaluate(() => ({ color: drawings[0].style.color, stored: JSON.parse(localStorage.getItem('rt_drawings'))[0].style.color }));
    const g = await geomOf(0);
    let magenta = false; for (let i = 0.2; i <= 0.8 && !magenta; i += 0.05) magenta = await page.evaluate(([x, y]) => window.__colorNear('chart', x, y, 'r > 200 && g < 90 && b > 200', 2), [g.x1 + (g.x2 - g.x1) * i, g.y1 + (g.y2 - g.y1) * i]);
    const e0 = errs.length;
    await page.evaluate(() => { const vr = chart.timeScale().getVisibleLogicalRange(); chart.timeScale().setVisibleLogicalRange({ from: vr.from - 2500, to: vr.to - 2500 }); });
    await page.waitForTimeout(300); await paint();
    const off = await page.evaluate(() => ({ hidden: document.getElementById('drawToolbar').hidden, sel: !!selDrawing }));
    await page.evaluate(() => window.__rt.fit()); await page.waitForTimeout(300); await paint();
    const back = await page.evaluate(() => document.getElementById('drawToolbar').hidden);
    const ok = vis && !tb.hidden && inside && st2.color === '#ff00ff' && st2.stored === '#ff00ff' && magenta && off.hidden && off.sel && !back && errs.length === e0;
    report('G13', ok, `toolbar appears on select, inside the chart(${inside}); color edit reaches the drawing and persists(${st2.color}); scrolled off-screen -> toolbar hides but selection kept(${off.hidden}/${off.sel}), no console errors; back in view -> toolbar returns`);
    await page.click('#dtDelete'); await page.waitForTimeout(150);
  }

  // ================= G14 Shift locks 45° (trend line) =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 120, ya + 90, ['Shift']);
    const g = await geomOf(0);
    const ratio = g ? Math.abs((g.y2 - g.y1) / (g.x2 - g.x1)) : NaN;
    report('G14', g && g.type === 'tl' && Math.abs(ratio - 1) < 0.03, `2nd click at 36.9° with Shift held -> pixel |dy/dx|=${ratio.toFixed(3)} (want ~1.0 for 45°)`);
  }

  // ================= G15 Shift-drag locks to one axis =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 120, ya + 60, [], 'drwBox');
    await clickChart(geo.W * 0.5, geo.H * 0.95);
    const b = await geomOf(0);
    const gx = (b.x1 + b.x2) / 2, gy = Math.min(b.y1, b.y2);
    await dragChart(gx, gy, gx + 60, gy + 40, ['Shift']);
    const a = await geomOf(0);
    const dt = a.t1 !== b.t1 || a.t2 !== b.t2, dp = Math.abs(a.p1 - b.p1) > 1e-9 || Math.abs(a.p2 - b.p2) > 1e-9;
    await dragChart(a.x1 + 40, gy, a.x1 + 40 + 20, gy + 50, ['Shift']);
    const c = await geomOf(0);
    const dt2 = c.t1 !== a.t1, dp2 = Math.abs(c.p1 - a.p1) > 1e-9;
    report('G15', dt && !dp && !dt2 && dp2, `Shift-drag horizontal (+60,+40)px on an edge handle: time moved, price fixed(${dt}/${!dp}); Shift-drag vertical (+20,+50)px: time fixed, price moved(${!dt2}/${dp2})`);
  }

  // ================= G16 Shift locks square (rectangle) =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 120, ya + 60, ['Shift'], 'drwBox');
    const b = await geomOf(0);
    const w = b ? Math.abs(b.x2 - b.x1) : NaN, h = b ? Math.abs(b.y2 - b.y1) : NaN;
    report('G16', b && b.type === 'box' && Math.abs(w - h) < 2 && w > 100, `box 2nd click at dx=120 dy=60 with Shift -> w=${w.toFixed(1)} h=${h.toFixed(1)} (locked square)`);
  }

  // ================= G17 dblclick opens Settings; recolor reaches fib/measure/rr renderers =================
  await clear();
  {
    const ts2 = await page.evaluate((k) => [bars[k].time, bars[k + 12].time], k);
    const pm = geo.pMid, res = {};
    for (const [type, d] of [['fib', { type: 'fib', p1: { t: ts2[0], p: pm - 12 }, p2: { t: ts2[1], p: pm + 12 }, color: '#CC4400' }], ['measure', { type: 'measure', p1: { t: ts2[0], p: pm + 6 }, p2: { t: ts2[1], p: pm - 6 }, color: '' }], ['rr', { type: 'rr', p1: { t: ts2[0], p: pm }, stop: pm - 10, target: pm + 20, color: '' }]]) {
      await seed([d]); await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); }); await paint();
      const pts = await page.evaluate((type) => { const d = drawings[0], X = drawX, Y = drawY; if (type === 'fib') { const g = fibGeom(d, X, document.getElementById('chart').clientWidth); const y = Y(g.p0 + g.span * 0.618); return [[g.xL + 40, y], [g.xL + 60, y], [g.xL + 80, y]]; } if (type === 'measure') { const x1 = X(d.p1.t), y1 = Y(d.p1.p), x2 = X(d.p2.t), y2 = Y(d.p2.p); return [0.3, 0.5, 0.7].map(f => [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]); } const { xa } = rrRange(d, X), ym = (Y(d.p1.p) + Y(d.target)) / 2; return [-1, 0, 1].map(o => [xa + o, ym]); }, type);
      const test = type === 'rr' ? 'r > 140 && b > 140 && r - g > 60' : 'r > 200 && g < 90 && b > 200';
      const before = await page.evaluate(([pts, test]) => pts.some(([x, y]) => window.__colorNear('chart', x, y, test, 1)), [pts, test]);
      await page.evaluate(() => { const c = document.getElementById('dtColor'); c.value = '#ff00ff'; c.dispatchEvent(new Event('input', { bubbles: true })); }); await paint();
      const after = await page.evaluate(([pts, test]) => pts.some(([x, y]) => window.__colorNear('chart', x, y, test, 1)), [pts, test]);
      res[type] = { before, after, color: await page.evaluate(() => drawings[0].style.color) };
    }
    await clear();
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 40);
    await clickChart(geo.W * 0.5, geo.H * 0.9);
    const r = await chartRect(); await page.mouse.dblclick(r.left + xa + 75, r.top + ya + 20); await page.waitForTimeout(300);
    const ds = await page.evaluate(() => ({ open: document.getElementById('drawSettings').classList.contains('open'), tabs: [...document.querySelectorAll('#drawSettings .ds-tab')].map(b => b.textContent), sel: selDrawing && selDrawing.type }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    const recolorOk = ['fib', 'measure', 'rr'].every(t => !res[t].before && res[t].after && res[t].color === '#ff00ff');
    const ok = recolorOk && ds.open && ds.tabs.join(',') === 'Style,Coordinates,Visibility' && ds.sel === 'tl';
    report('G17', ok, `recolor via floating-toolbar swatch reaches fib/measure/rr renderers (all 3: was hardcoded before, magenta after=${recolorOk}); double-click body opens Settings(${ds.open}) with tabs ${ds.tabs.join('/')}`);
  }

  // ================= G18 Ctrl+drag clones a drawing =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 40);
    const o = await geomOf(0);
    await dragChart(xa + 75, ya + 20, xa + 75 + 50, ya + 20 + 30, ['Control']);
    const r = await page.evaluate(() => ({ n: drawings.length, sel: selDrawing === drawings[1], ids: drawings.map(d => d.id) }));
    const o2 = await geomOf(0), c = await geomOf(1);
    report('G18', r.n === 2 && o2.t1 === o.t1 && o2.p1 === o.p1 && c && Math.abs(c.x1 - o.x1 - 50) < 3 && r.sel && r.ids[0] !== r.ids[1], `Ctrl-drag (+50,+30)px: drawings 1->${r.n}, original unchanged(${o2.t1 === o.t1}), clone moved to the drop point and is now selected(${r.sel}), distinct ids`);
  }

  // ================= G19 Ctrl+click builds a multiselect set; G20 group move + batch delete =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 20);
    await drawTL(xa, ya + 120, xa + 150, ya + 140);
    await clickChart(xa + 75, ya + 10);
    await clickChart(xa + 75, ya + 130, ['Control']);
    const s1 = await page.evaluate(() => ({ size: selSet.size, sel: selDrawing === drawings[1] }));
    const a0 = await geomOf(0), b0 = await geomOf(1);
    await dragChart(xa + 75, ya + 10, xa + 75 + 40, ya + 10 + 25);
    const a1 = await geomOf(0), b1 = await geomOf(1);
    const both = Math.abs(a1.x1 - a0.x1 - 40) < 3 && Math.abs(b1.x1 - b0.x1 - 40) < 3 && Math.abs(a1.y1 - a0.y1 - 25) < 3 && Math.abs(b1.y1 - b0.y1 - 25) < 3;
    const s2 = await page.evaluate(() => selSet.size);
    await clickChart(a1.x1 + 75, (a1.y1 + a1.y2) / 2, ['Control']);
    const s3 = await page.evaluate(() => ({ size: selSet.size, sel: selDrawing && selDrawing === drawings[1] }));
    await clickChart(a1.x1 + 75, (a1.y1 + a1.y2) / 2, ['Control']);
    await page.keyboard.press('Delete'); await page.waitForTimeout(200);
    const n2 = await page.evaluate(() => drawings.length);
    report('G19', s1.size === 2 && s1.sel && s3.size === 1 && n2 === 0, `A + Ctrl-click B -> selSet.size=${s1.size}; Ctrl-click A again removes it from the set(size=${s3.size}); Ctrl-click A back + Delete -> both gone(${n2})`);
    report('G20', both && s2 === 2, `dragging member A with 2 selected moves both A and B by the same (+40,+25)px offset; batch delete above removed both members in one Delete`);
  }

  // ================= G21 Undo / G22 Redo (create, drag, delete) =================
  await clear();
  {
    for (let i = 0; i < 3; i++) { await clickTool('#drwHL'); await clickChart(geo.W * 0.5, geo.H * (0.3 + i * 0.1)); }
    const n3 = await n();
    await key('Control+z'); await key('Control+z'); const n1 = await n();
    await key('Control+y'); const n2b = await n();
    await clear();
    const xa = await barX(k), xb = await barX(k + 14);
    await drawTL(xa, geo.H * 0.35, xb, geo.H * 0.55);
    const before = await geomOf(0);
    const mx = (before.x1 + before.x2) / 2, my = (before.y1 + before.y2) / 2;
    await clickChart(geo.W * 0.5, geo.H * 0.9);
    await dragChart(mx, my, mx + 60, my + 40);
    const after = await geomOf(0);
    await key('Control+z');
    const undone = await geomOf(0);
    const moved = Math.abs(after.x1 - before.x1) > 30, restored = Math.abs(undone.t1 - before.t1) < 1e-6 && Math.abs(undone.p1 - before.p1) < 1e-9;
    await key('Control+y');
    const redone = await geomOf(0);
    await page.evaluate(() => { window.__rt.setSel(0); });
    await key('Delete'); const nd = await n(); await key('Control+z'); const nu = await n();
    const undoOk = n3 === 3 && n1 === 1 && restored && nd === 0 && nu === 1;
    report('G21', undoOk, `Ctrl+Z: drew 3 hl -> Ctrl+Z x2 -> ${n1} left; drag moved the tl(${moved}) then Ctrl+Z restored the pre-drag coords(p1.t/p1.p, ${restored} — snapshot must be taken at pointerdown, not pointerup); delete -> Ctrl+Z -> back to ${nu}`);
    const redoOk = n2b === 2 && Math.abs(redone.t1 - after.t1) < 1e-6;
    report('G22', redoOk, `Ctrl+Y after the create-then-undo above restored ${n2b}/2 drawings; Ctrl+Y after the drag-undo re-applied the moved coordinates`);
  }

  // ================= G23 arrow-key nudge (selected) vs day change (nothing selected) =================
  await clear();
  {
    const ts3 = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = geo.pMid;
    await seed([{ type: 'tl', p1: { t: ts3[0], p: pm }, p2: { t: ts3[1], p: pm + 4 }, color: '#000000' }]);
    await page.evaluate(() => window.__rt.setSel(0));
    const g0 = await geomOf(0); const s0 = await st();
    await key('ArrowRight'); const g1 = await geomOf(0); const s1 = await st();
    await key('ArrowUp'); const g2 = await geomOf(0);
    const dBar = await page.evaluate(([a, b]) => timeToLogical(b) - timeToLogical(a), [g0.t1, g1.t1]);
    const tick = await page.evaluate(() => TICK);
    const nudgeOk = Math.abs(dBar - 1) < 1e-6 && s1.sess === s0.sess && s1.idx === s0.idx && Math.abs(g2.p1 - g1.p1 - tick) < 1e-9;
    await key('Escape');
    const dayKey = () => page.evaluate(() => tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key);
    const k0 = await dayKey(); const dir = await page.evaluate(() => { const l = deepDayList(), c = tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key, i = l.indexOf(c); return l[i + 1] ? 1 : (l[i - 1] ? -1 : 0); });
    const selNow = await page.evaluate(() => !!(selDrawing || selSet.size));
    await key(dir >= 0 ? 'ArrowRight' : 'ArrowLeft');
    let changed = false; try { await page.waitForFunction((k0) => (tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key) !== k0, k0, { timeout: 10000 }); changed = true; } catch (e) {}
    const k1 = await dayKey();
    report('G23', nudgeOk && !selNow && changed && k1 !== k0, `selected: ArrowRight moved p1.t by exactly 1 bar (idx/session unchanged), ArrowUp moved price by exactly 1 tick; nothing selected: Left/Right changed the replay day (${k0}->${k1})`);
    await key(dir >= 0 ? 'ArrowLeft' : 'ArrowRight'); try { await page.waitForFunction((k0) => (tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key) === k0, k0, { timeout: 10000 }); } catch (e) {}
    await page.waitForTimeout(500);
  }

  // ================= G24 Copy/paste, clamped to the last revealed bar =================
  await clear();
  {
    const g = await page.evaluate(() => ({ idx, hiT: bars[Math.min(idx, bars.length - 1)].time }));
    const ts4 = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = geo.pMid;
    await seed([{ type: 'tl', p1: { t: ts4[0], p: pm }, p2: { t: ts4[1], p: pm + 4 }, color: '#000000' }, { type: 'hray', p1: { t: g.hiT, p: pm - 5 }, color: '#000000' }]);
    await page.evaluate(() => window.__rt.setSel(0));
    await key('Control+c'); await key('Control+v');
    const n1c = await n(); const c1 = await geomOf(2);
    await page.evaluate(() => window.__rt.setSel(1));
    await key('Control+c'); await key('Control+v');
    const n2c = await n(); const c2 = await geomOf(3);
    report('G24', n1c === 3 && n2c === 4 && c1.t2 <= g.hiT && c1.t1 > ts4[0] && c2.t1 <= g.hiT, `paste tl shifted right but its 2nd point clamps at the last revealed bar (t2<=${g.hiT}); pasting an hray already ON the last bar cannot cross it either`);
  }

  // ================= G25 middle-click deletes the drawing under the cursor =================
  await clear();
  {
    const xa = await barX(k), xb = await barX(k + 14);
    await drawTL(xa, geo.H * 0.35, xb, geo.H * 0.55);
    const g = await geomOf(0); const n0 = await n();
    await clickChart(geo.W * 0.5, geo.H * 0.9);
    await clickChart((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2, [], 'middle');
    const n1d = await n();
    report('G25', n0 === 1 && n1d === 0, `middle-click on the tl body: ${n0} -> ${n1d}`);
  }

  // ================= G26-G32 Alt hotkeys arm the right tool WITHOUT placing a trade order =================
  await clear();
  {
    await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    await key('Alt+f'); let s = await st();
    report('G31', s.tool === 'fib' && s.entry === null, `Alt+F -> tool='${s.tool}' (must NOT trigger the plain 'f' buy-stop hotkey), entryOrder=${JSON.stringify(s.entry)}`);
    await key('Alt+j'); s = await st();
    report('G28', s.tool === 'hray' && s.entry === null, `Alt+J -> tool='${s.tool}' (must NOT trigger the plain 'j' sell-stop hotkey), entryOrder=${JSON.stringify(s.entry)}`);
    const tools = [['Alt+t', 'tl', 'G26'], ['Alt+h', 'hl', 'G27'], ['Alt+v', 'vline', 'G29'], ['Alt+c', 'cross', 'G30'], ['Shift+Alt+r', 'box', 'G32']];
    for (const [combo, want, id] of tools) { await key(combo); s = await st(); report(id, s.tool === want && s.entry === null, `${combo} -> tool='${s.tool}' entryOrder=${JSON.stringify(s.entry)}`); }
    await key('Escape');
  }

  // ================= G33 Ctrl+Alt+H hides drawings (and their markers), survives a pan =================
  await clear();
  {
    const pm = geo.pMid;
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'hl', p1: { t: t0, p: pm }, color: '#000000' }]);
    await page.evaluate((t) => placeAnnotation('au', t), t0);
    const y = await page.evaluate((p) => drawY(p), pm);
    await paint();
    const inkOn = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    const mkOn = await page.evaluate(() => candle.markers().length);
    await key('Control+Alt+h');
    await paint();
    const inkOff = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    const mkOff = await page.evaluate(() => candle.markers().length);
    await dragChart(geo.W * 0.5, geo.H * 0.85, geo.W * 0.5 - 120, geo.H * 0.85);
    await page.waitForTimeout(300);
    const inkPan = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    await key('Control+Alt+h'); await paint();
    const inkBack = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    const mkBack = await page.evaluate(() => candle.markers().length);
    report('G33', inkOn > 150 && mkOn === 1 && inkOff < 40 && mkOff === 0 && inkPan < 40 && inkBack > 150 && mkBack === 1, `hl row ink before=${inkOn} after Ctrl+Alt+H=${inkOff} after a pan=${inkPan} (guard lives inside the primitive's draw callback, not repaintOverlays, so it survives LWC's own repaints) after unhide=${inkBack}; markers ${mkOn}->${mkOff}->${mkBack}`);
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(true); });
  }

  // ================= G34 Trend line: extend Both + arrowhead =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.4;
    await drawTL(xa, ya, xa + 150, ya + 30);
    await clickChart(geo.W * 0.5, geo.H * 0.95);
    const g = await geomOf(0);
    const slope = (g.y2 - g.y1) / (g.x2 - g.x1), yAt = (x) => g.y1 + slope * (x - g.x1);
    const leftBefore = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [g.x1 - 60, yAt(g.x1 - 60)]);
    await page.evaluate(() => { drawings[0].extend = 'both'; drawings[0].arrowEnd = true; saveJSON('rt_drawings', drawings); repaintOverlays(); }); await paint();
    const leftAfter = await page.evaluate(([x, y]) => ({ ink: window.__ptInk('chart', x, y, 1), hit: drawingAt(x, y) && drawingAt(x, y).type }), [g.x1 - 60, yAt(g.x1 - 60)]);
    const a = Math.atan2(g.y2 - g.y1, g.x2 - g.x1), w = Math.PI / 7, wing = [g.x2 - 8 * Math.cos(a - 0.6 * w), g.y2 - 8 * Math.sin(a - 0.6 * w)];
    const arrow = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 0), wing);
    report('G34', !leftBefore && leftAfter.ink && leftAfter.hit === 'tl' && arrow, `no extend: nothing left of p1(${!leftBefore}); extend='both': line + hit-test both extend left(${leftAfter.ink}/${leftAfter.hit}); arrowEnd draws a wing at p2(${arrow})`);
  }

  // ================= G35 Ray with dx===0 (same-bar points) still extends vertically & stays clickable =================
  await clear();
  {
    const t = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'ray', p1: { t, p: geo.pMid }, p2: { t, p: geo.pMid - 8 }, color: '#000000' }]);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => { const d = drawings[0], H = document.getElementById('chart').clientHeight, x = drawX(d.p1.t), y1 = drawY(d.p1.p), y2 = drawY(d.p2.p); return { below: window.__colDark('chart', Math.round(x), Math.round(y2) + 10, H - 30), hitFar: drawingAt(x, (y2 + H) / 2 + 20) === d }; });
    report('G35', r.below > 0.9 && r.hitFar, `two points on the same bar (dx===0), pointing down: dark column continues below p2 to the bottom edge(${r.below.toFixed(2)}) and the extended segment is clickable(${r.hitFar})`);
  }

  // ================= G36 Horizontal ray: 1 point, extends right only =================
  await clear();
  {
    const x = await barX(k); const y = await priceY(geo.pLow);
    await clickTool('#drwHRay'); await clickChart(x, y); await page.waitForTimeout(400);
    const r = await page.evaluate(({ k }) => { const d = drawings[0], x1 = drawX(d.p1.t), y1 = drawY(d.p1.p), PW = window.__paneW('chart'); return { n: drawings.length, type: d && d.type, t: d && d.p1.t, expT: bars[k].time, noP2: d && d.p2 === undefined, right: window.__rowDark('chart', Math.round(y1), Math.round(x1) + 6, PW - 2), left: window.__rowDark('chart', Math.round(y1), 5, Math.round(x1) - 6) }; }, { k });
    report('G36', r.n === 1 && r.type === 'hray' && nearT(r.t, r.expT) && r.noP2 && r.right > 0.9 && r.left < 0.25, `1 click -> {t,p} only (no p2), extends right of the anchor(${r.right.toFixed(2)}) not left(${r.left.toFixed(2)})`);
  }

  // ================= G37 Vertical line: 1 point (time only), spans the oscillator pane too =================
  await page.evaluate(() => { const s = document.getElementById('oscSelect'); s.value = 'rsi'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(1500);
  await clear();
  {
    const x = await barX(k);
    await clickTool('#drwVLine'); await clickChart(x, geo.H * 0.5); await page.waitForTimeout(400);
    const r = await page.evaluate((k) => { const d = drawings[0], H = document.getElementById('chart').clientHeight, osc = document.getElementById('oscPane'), oh = osc.clientHeight, x = drawX(d.p1.t); const oscX = window.__drwOscDbg && window.__drwOscDbg.lastX, oscTimeX = oscChart.timeScale().timeToCoordinate(bars[k].time); return { n: drawings.length, type: d && d.type, hasP: d && ('p' in d.p1), col: window.__colDark('chart', Math.round(x), 20, H - 30), oscCol: window.__colDark('oscPane', Math.round(oscX), 4, oh - 4), oscOk: window.__drwOsc && window.__drwOsc.ok, aligned: Math.abs(oscX - oscTimeX) < 1 }; }, k);
    report('G37', r.n === 1 && r.type === 'vline' && !r.hasP && r.col > 0.9 && r.oscCol > 0.8 && r.oscOk && r.aligned, `1 click -> time-only {t} (no price); dark column spans the main pane(${r.col.toFixed(2)}) AND the RSI oscillator pane(${r.oscCol.toFixed(2)}, aligned to the same bar=${r.aligned}) via oscVlineAttach`);
  }
  await page.evaluate(() => { const s = document.getElementById('oscSelect'); s.value = 'off'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(600);

  // ================= G38 Crossline: 1 point, full-width horizontal + full-height vertical (decision (3)) =================
  await clear();
  {
    const x = await barX(k2); const y = await priceY(geo.pMid);
    await clickTool('#drwCross'); await clickChart(x, y); await page.waitForTimeout(400);
    const r = await page.evaluate(({ k2 }) => { const d = drawings[0], x1 = drawX(d.p1.t), y1 = drawY(d.p1.p), H = document.getElementById('chart').clientHeight, PW = window.__paneW('chart'); return { n: drawings.length, type: d && d.type, row: window.__rowDark('chart', Math.round(y1), 5, PW - 2), col: window.__colDark('chart', Math.round(x1), 20, H - 30), hitH: drawingAt(30, y1) === d, hitV: drawingAt(x1, H * 0.15) === d }; }, { k2 });
    report('G38', r.n === 1 && r.type === 'cross' && r.row > 0.9 && r.col > 0.9 && r.hitH && r.hitV, `1 click -> full-width row(${r.row.toFixed(2)}) + full-height column(${r.col.toFixed(2)}) through that point, both arms clickable`);
  }

  // ================= G39 Rectangle: Extend right + Middle line (decision (4): horizontal, price midpoint) =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 120, ya + 80, [], 'drwBox');
    await clickChart(geo.W * 0.5, geo.H * 0.95);
    const g = await geomOf(0), top = Math.min(g.y1, g.y2), ym = (g.y1 + g.y2) / 2, xm = (g.x1 + g.x2) / 2;
    const b4 = await page.evaluate(([x, y, xm, ym]) => ({ right: window.__ptInk('chart', x, y, 1), mid: window.__ptInk('chart', xm, ym, 1) }), [geo.W - 90, top, xm, ym]);
    await page.evaluate(() => { drawings[0].extendRight = true; drawings[0].middleLine = true; saveJSON('rt_drawings', drawings); repaintOverlays(); }); await paint();
    const af = await page.evaluate(([x, y, xm, ym]) => ({ right: window.__ptInk('chart', x, y, 1), rightHit: drawingAt(x, y) && drawingAt(x, y).type, mid: window.__ptInk('chart', xm, ym, 1) }), [geo.W - 90, top, xm, ym]);
    report('G39', !b4.right && !b4.mid && af.right && af.rightHit === 'box' && af.mid, `before: no ink at the right edge / centre(${!b4.right}/${!b4.mid}); extendRight -> box reaches the pane's right edge and is clickable there(${af.right}/${af.rightHit}); middleLine -> horizontal line at the price midpoint(${af.mid})`);
  }

  // ================= G40 Fib: default 4 levels, custom levels, Reverse, Extend left (log-scale excluded per §C) =================
  await clear();
  {
    const ts5 = await page.evaluate((k) => [bars[k].time, bars[k + 12].time], k);
    const pm = geo.pMid;
    await seed([{ type: 'fib', p1: { t: ts5[0], p: pm - 15 }, p2: { t: ts5[1], p: pm + 15 }, color: '#CC4400' }]); await paint();
    const def = await page.evaluate(() => fibLevels(drawings[0]).map(f => f.lv));
    const y05 = await page.evaluate(() => ({ y: drawY(drawings[0].p1.p + (drawings[0].p2.p - drawings[0].p1.p) * 0.5), xL: fibGeom(drawings[0], drawX, 9999).xL, y236: drawY(drawings[0].p1.p + (drawings[0].p2.p - drawings[0].p1.p) * 0.236) }));
    const FIBC = 'r > 180 && g > 40 && g < 130 && b < 90';
    const half0 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL + 30, y05.y, FIBC]);
    // level labels now sit LEFT of the band (~95px wide, TV placement; final-fix round 1) -> probe 160px left of xL, beyond the label, so only an Extend-left line can put ink there
    const left0 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL - 160, y05.y236, FIBC]);
    await page.evaluate(() => { drawings[0].fibLevels = [0.236, 0.382, 0.5, 0.618, 1]; repaintOverlays(); }); await paint();
    const half1 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL + 30, y05.y, FIBC]);
    await page.evaluate(() => { drawings[0].reverse = true; repaintOverlays(); }); await paint();
    const rev = await page.evaluate((t) => { const d = drawings[0]; const y = drawY(d.p2.p + (d.p1.p - d.p2.p) * 0.236); return { y, ink: window.__colorNear('chart', fibGeom(d, drawX, 9999).xL + 30, y, t, 1) }; }, FIBC);
    await page.evaluate(() => { drawings[0].reverse = false; drawings[0].extendLeft = true; repaintOverlays(); }); await paint();
    const left1 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL - 160, y05.y236, FIBC]);
    report('G40', def.join(',') === '0.236,0.382,0.618,1' && !half0 && half1 && Math.abs(rev.y - y05.y236) > 20 && rev.ink && !left0 && left1, `default levels=${def.join('/')} (23.6/38.2/61.8/100 per SPEC); adding 0.5 to fibLevels draws it(${!half0}->${half1}); Reverse flips the anchor(${rev.ink}); extendLeft reaches past xL(${!left0}->${left1}). log-scale option not implemented — out of scope per §(C), no log price axis in this chart`);
  }

  // ================= G41 Coordinates tab: bar number + price, future bars allowed =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 100, ya + 30);
    await page.evaluate(() => { selectDrawing(drawings[0], false); openDrawSettings(drawings[0], 'coords'); });
    const inputs = await page.evaluate(() => [...document.querySelectorAll('#drawSettings [data-k]')].map(i => i.dataset.k));
    const before = await geomOf(0);
    const target = geo.nBars + 10;
    await page.evaluate((v) => { const i = document.querySelector('#drawSettings [data-k="t:p2"]'); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); const p = document.querySelector('#drawSettings [data-k="p:p1"]'); p.value = String((+p.value) + 7.5); p.dispatchEvent(new Event('input', { bubbles: true })); }, target);
    await paint();
    const after = await page.evaluate(() => { const d = drawings[0]; return { t2: d.p2.t, p1: d.p1.p, lastT: bars[bars.length - 1].time, bar2: timeToLogical(d.p2.t) + seriesFrom }; });
    await page.evaluate(() => closeDrawSettings());
    report('G41', inputs.includes('t:p1') && inputs.includes('p:p2') && after.t2 > after.lastT && Math.abs(after.bar2 - target) < 0.01 && Math.abs(after.p1 - before.p1 - 7.5) < 0.01, `panel exposes bar-number + price inputs per point (${inputs.join(',')}); typing bar #${target} (past the last bar) into p2's time field moves it into future space; price field edits the price directly`);
  }

  // ================= G42 Visibility per timeframe (continue, not return — other drawings/handles unaffected) =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 100, ya + 30);
    await drawTL(xa, ya + 100, xa + 100, ya + 130);
    await page.evaluate(() => { drawings[0].visibleTFs = [5]; selectDrawing(drawings[1], false); saveJSON('rt_drawings', drawings); repaintOverlays(); });
    const dbg = await paint();
    const gA = await geomOf(0), gB = await geomOf(1);
    const inkA = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [(gA.x1 + gA.x2) / 2, (gA.y1 + gA.y2) / 2]);
    const inkB = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [(gB.x1 + gB.x2) / 2, (gB.y1 + gB.y2) / 2]);
    await page.evaluate(() => { drawings[0].visibleTFs = [tf]; repaintOverlays(); }); const dbg2 = await paint();
    const inkA2 = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [(gA.x1 + gA.x2) / 2, (gA.y1 + gA.y2) / 2]);
    report('G42', geo.tf !== 5 && !inkA && inkB && dbg.handles === 2 && dbg2.drawn === 2 && inkA2, `A limited to visibleTFs=[5] on a tf=${geo.tf} chart: A disappears(${!inkA}) while B stays fully visible AND B's handles still draw(${dbg.handles}, proving the filter uses 'continue' not 'return'); restoring A's tf makes it reappear(${inkA2})`);
  }

  // ================= G43 Lock all: blocks drag (anchor + body), never blocks selection =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 40);
    await clickChart(geo.W * 0.5, geo.H * 0.9);
    await page.click('#btnLockDrw');
    const o = await geomOf(0);
    await dragChart(xa + 75, ya + 20, xa + 75 + 50, ya + 20 + 30);
    const r = await page.evaluate(() => selDrawing && selDrawing.type);
    const a = await geomOf(0);
    await dragChart(o.x1, o.y1, o.x1 + 30, o.y1 + 30);
    const a2 = await geomOf(0);
    await page.click('#btnLockDrw');
    report('G43', r === 'tl' && a.t1 === o.t1 && a.p1 === o.p1 && a2.t1 === o.t1 && a2.p1 === o.p1, `locked: body drag selects(${r}) but does not move it(${a.t1 === o.t1 && a.p1 === o.p1}); anchor drag is blocked too(${a2.t1 === o.t1 && a2.p1 === o.p1})`);
  }

  // ================= G44 Removing a locked drawing asks for confirmation; "Always remove locked" skips it =================
  await clear();
  {
    const ts6 = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = geo.pMid;
    await seed([{ type: 'tl', p1: { t: ts6[0], p: pm }, p2: { t: ts6[1], p: pm + 4 }, color: '#000000', locked: true }]);
    await page.evaluate(() => window.__rt.setSel(0));
    dialogs = []; dialogMode = 'dismiss';
    await key('Delete'); await page.waitForTimeout(200);
    const nKeep = await n(), d1 = dialogs.slice();
    dialogMode = 'accept'; dialogs = [];
    await page.evaluate(() => { alwaysRemoveLocked = true; }); await page.evaluate(() => window.__rt.setSel(0));
    await key('Delete'); await page.waitForTimeout(200);
    const nGone = await n(), d2 = dialogs.slice();
    await page.evaluate(() => { alwaysRemoveLocked = false; });
    report('G44', nKeep === 1 && d1.length === 1 && /locked/i.test(d1[0]) && nGone === 0 && d2.length === 0, `locked + Delete -> confirm dialog appears("${d1[0]}"); dismiss keeps it(count=${nKeep}); alwaysRemoveLocked=true -> Delete skips the dialog and removes it(count=${nGone})`);
  }

  // ================= G45 Hide dropdown: Drawings / Indicators / Positions and orders / All — masks only =================
  {
    await page.evaluate(() => { setVwap(true); setVolOn(true); setOscMode('rsi'); const s = $('oscSelect'); if (s) s.value = 'rsi'; });
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => ({ rsiVis: rsiSeries && rsiSeries.options().visible, volVis: vol.options().visible }));
    await page.click('#btnHideMenu', { force: true }); await page.waitForTimeout(150);
    const popOpen = await page.evaluate(() => document.getElementById('hidePopover').classList.contains('open'));
    await page.click('#hideIndicators'); await page.waitForTimeout(300);
    const hid = await page.evaluate(() => ({ vwap: vwapOn, osc: oscMode, rsiVis: rsiSeries && rsiSeries.options().visible, volVis: vol.options().visible }));
    await page.evaluate(() => toggleHide('indicators')); await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ rsiVis: rsiSeries && rsiSeries.options().visible, vwap: vwapOn, osc: oscMode }));
    await page.evaluate(() => placeBreakout('long')); await page.waitForTimeout(200);
    const ordOn = await page.evaluate(() => new Promise(res => { orderRepaint(); requestAnimationFrame(() => requestAnimationFrame(() => res(orderHits.length))); }));
    await page.evaluate(() => toggleHide('positions')); await page.waitForTimeout(200);
    const ordOff = await page.evaluate(() => new Promise(res => { orderRepaint(); requestAnimationFrame(() => requestAnimationFrame(() => res({ hits: orderHits.length, entry: !!entryOrder }))); }));
    await page.evaluate(() => toggleHide('positions'));
    await page.evaluate(() => toggleHide('all')); const all1 = await page.evaluate(() => ({ ...hideFlags }));
    await page.evaluate(() => toggleHide('all')); const all0 = await page.evaluate(() => ({ ...hideFlags }));
    await page.evaluate(() => cancelOrder('entry'));
    const ok = popOpen && before.rsiVis === true && before.volVis === true && hid.rsiVis === false && hid.volVis === false && hid.vwap && hid.osc === 'rsi' && back.rsiVis === true && back.vwap && ordOn > 0 && ordOff.hits === 0 && ordOff.entry && all1.drawings && all1.indicators && all1.positions && !all0.drawings;
    report('G45', ok, `Hide>Indicators masks RSI+volume series visibility(${hid.rsiVis}/${hid.volVis}) WITHOUT touching vwapOn/oscMode settings(${hid.vwap}/${hid.osc}), unhide restores(${back.rsiVis}); Hide>Positions hides order tag hit-boxes but keeps entryOrder alive(${ordOff.hits}/${ordOff.entry}); Hide>All sets/clears all 3 flags together`);
    await page.evaluate(() => { setVwap(false); setVolOn(false); setOscMode('off'); const s = $('oscSelect'); if (s) s.value = 'off'; });
  }

  // ================= G46 Remove dropdown: "Remove Drawings & Indicators" clears both, undo-able =================
  await clear();
  {
    const ts7 = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = geo.pMid;
    await seed([{ type: 'tl', p1: { t: ts7[0], p: pm }, p2: { t: ts7[1], p: pm + 4 }, color: '#000000' }, { type: 'hl', p1: { t: ts7[0], p: pm - 3 }, color: '#000000' }]);
    await page.evaluate(() => { setVwap(true); setBB(true); setEMA(true); setVolOn(true); ripsterOn = true; saveJSON('rt_ripster', true); $('ripsterToggle').checked = true; setVpCfg('p', { on: true }); setOscMode('rsi'); $('oscSelect').value = 'rsi'; ['indVwap', 'indBB', 'indEma', 'indVol', 'indVpP'].forEach(id => { $(id).checked = true; }); });
    await page.waitForTimeout(300);
    await page.click('#btnRemoveMenu', { force: true }); await page.waitForTimeout(150);
    const popOpen = await page.evaluate(() => document.getElementById('removePopover').classList.contains('open'));
    dialogs = []; dialogMode = 'accept';
    await page.click('#rmDrawingsInd'); await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ n: drawings.length, vwap: vwapOn, bb: bbOn, ema: emaOn, rip: ripsterOn, vol: volOn, osc: oscMode, boxes: ['indVwap', 'indBB', 'indEma', 'indVol', 'ripsterToggle'].map(id => $(id).checked) }));
    await key('Control+z'); const undoN = await n();
    const ok = popOpen && dialogs.length === 1 && r.n === 0 && !r.vwap && !r.bb && !r.ema && !r.rip && !r.vol && r.osc === 'off' && r.boxes.every(b => b === false) && undoN === 2;
    report('G46', ok, `menu opened(${popOpen}), confirm shown(${dialogs.length}); "Remove Drawings & Indicators" clears drawings(${r.n}) AND every indicator setter + its checkbox(${r.boxes.join(',')}); Ctrl+Z brings the drawings back(${undoN})`);
    await page.click('#drwClear'); await page.waitForTimeout(300);
  }

  // ================= G47 Cross-timeframe: (timestamp,price) survives; renders via nearest-bar fallback =================
  await clear();
  {
    const ks = await page.evaluate(() => { const out = []; for (let i = idx - 45; i < idx - 5 && out.length < 2; i++) if (bars[i].time % 300 !== 0) { out.push(i); i += 12; } return out; });
    await clickTool('#drwTL');
    await clickChart(await barX(ks[0]), geo.H * 0.45); await clickChart(await barX(ks[1]), geo.H * 0.6);
    const before = await page.evaluate(() => ({ n: drawings.length, t1: drawings[0] && drawings[0].p1.t, t2: drawings[0] && drawings[0].p2.t, onBar: drawings[0] && bars.some(b => Math.abs(b.time - drawings[0].p1.t) <= 8) }));
    await page.evaluate(() => { const s = document.getElementById('tfSelect'); s.value = '5'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => { const d = drawings[0], ts = chart.timeScale(); const x1 = drawX(d.p1.t), y1 = drawY(d.p1.p), x2 = drawX(d.p2.t), y2 = drawY(d.p2.p); const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; return { tf, t1: d.p1.t, t2: d.p2.t, stillOnBar: bars.some(b => b.time === d.p1.t), native: ts.timeToCoordinate(d.p1.t), pix: window.__ptDark ? window.__ptDark('chart', Math.round(mx), Math.round(my), 3) : window.__ptInk('chart', Math.round(mx), Math.round(my), 3), ok: window.__drw && window.__drw.ok }; });
    const ok = before.n === 1 && before.onBar && after.tf === 5 && after.t1 === before.t1 && after.t2 === before.t2 && !after.stillOnBar && after.native == null && after.pix && after.ok;
    report('G47', ok, `drawn at 1m on a bar(${before.onBar}); switched to 5m: p1.t/p2.t UNCHANGED (still the original timestamp, ${after.t1 === before.t1}) even though that exact time is no longer a 5m bar(${!after.stillOnBar}) and native timeToCoordinate returns null(${after.native}); nearestBarTime fallback still renders it visibly(${after.pix})`);
    await page.evaluate(() => { const s = document.getElementById('tfSelect'); s.value = '1'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(1500);
  }

  // ================= NT1..NT18 NinjaTrader 8 Trend Channel (Ctrl+2) + Line (F2) — exports/NT8_TRENDCHANNEL_SPEC.md, IMPL_SPEC §A =================
  // Ink checks are before/after pixel diffs of the same points (drawings shown vs hidden, or before vs after the preview mouse move) so candle ink never counts.
  {
    const e0 = errs.length;
    const reset = () => page.evaluate(() => { drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; pendingPt2 = null; previewXY = null; if (tool) setTool(''); saveJSON('rt_drawings', drawings); undoStack.length = 0; redoStack.length = 0; if ($('drawSettings').classList.contains('open')) closeDrawSettings(); repaintOverlays(); });
    const segPts = (x1, y1, x2, y2, a = 0.15, b = 0.85, n = 9) => Array.from({ length: n }, (_, i) => { const t = a + (b - a) * i / (n - 1); return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]; });
    const sample = (pts) => page.evaluate((pts) => pts.map(([x, y]) => window.__rgbNear('chart', x, y)), pts);
    const frac = (a, b) => a.filter((v, i) => v !== b[i]).length / a.length;
    const inkDiff = (pts) => page.evaluate(async (pts) => {   // per point: did the drawings layer change these pixels? (selection + hover off so handles don't count)
      const fr = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      clearSelection(); hoverDrawing = null; repaintOverlays(); await fr();
      const on = pts.map(([x, y]) => window.__rgbNear('chart', x, y));
      hideFlags.drawings = true; repaintOverlays(); await fr();
      const off = pts.map(([x, y]) => window.__rgbNear('chart', x, y));
      hideFlags.drawings = false; repaintOverlays(); await fr();
      return on.map((v, i) => v !== off[i]);
    }, pts);
    const share = (a) => a.filter(Boolean).length / a.length;
    const chan = () => page.evaluate(() => { const d = drawings.find(q => q.type === 'channel'); if (!d) return null; const el = document.getElementById('chart'); const g = chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight); return { p1: { ...d.p1 }, p2: { ...d.p2 }, p3: d.p3 && { ...d.p3 }, levels: d.levels, extend: d.extend, g, l1: timeToLogical(d.p1.t), l2: timeToLogical(d.p2.t), l3: timeToLogical(d.p3.t) }; });
    const noTrade = () => page.evaluate(() => ({ pos: position ? position.side : null, entry: entryOrder ? entryOrder.side + '/' + entryOrder.kind : null }));
    await reset(); await setMagnet('off');
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (entryOrder) cancelOrder('entry'); if (position) closePosition(); });

    // NT1 F2 = Line (NT8 default)
    await key('F2'); const f2a = await st(); await key('F2'); const f2b = await st();
    report('NT1', f2a.tool === 'tl' && f2b.tool === '', `F2 arms the trend line (tool='${f2a.tool}'), F2 again drops it (tool='${f2b.tool}'); flyout row label=${await page.evaluate(() => document.querySelector('#drwTL .pop-key').textContent)}`);

    // NT2 Ctrl+2 / Alt+2 = Trend channel (CDP-dispatched keys: proves the JS binding only — a real Ctrl+2 in a Chrome tab is taken by the browser, see IMPL_SPEC §A.4)
    await page.evaluate(() => { localStorage.removeItem('rt_hint_ctrl2'); const t = document.getElementById('toast'); if (t) t.textContent = ''; });
    await key('Control+2'); const c2 = await st(); const toastAfterCtrl = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
    await key('Escape'); await key('Alt+2'); const a2 = await st();
    const hint1 = await page.evaluate(() => ({ text: (document.getElementById('toast') || {}).textContent || '', stored: localStorage.getItem('rt_hint_ctrl2') }));
    await page.evaluate(() => { document.getElementById('toast').textContent = 'x'; });
    await key('Escape'); await key('Alt+2'); const hint2 = await page.evaluate(() => document.getElementById('toast').textContent); await key('Escape');
    const ico = await page.evaluate(() => { const w = (txt) => { const s = document.createElement('span'); s.className = 'material-symbols-outlined'; s.style.cssText = 'position:absolute;left:-999px;top:0'; s.textContent = txt; document.body.appendChild(s); const v = s.getBoundingClientRect().width; s.remove(); return v; }; return document.querySelector('#drwChannel .material-symbols-outlined') && w('stacked_line_chart') < w('zz_bogus_glyph_name') / 4 ? w('stacked_line_chart') : 0; });   // ligature resolved -> one glyph wide (a bogus name renders as long text)
    report('NT2', c2.tool === 'channel' && a2.tool === 'channel' && !/Alt\+2/.test(toastAfterCtrl) && /Alt\+2/.test(hint1.text) && hint1.stored === 'true' && hint2 === 'x' && ico > 0 && ico < 40, `Control+2 -> tool='${c2.tool}' (no hint: a Ctrl+2 that arrives already works), Alt+2 fallback -> '${a2.tool}'; one-time hint shown once(${/Alt\+2/.test(hint1.text)}, not again=${hint2 === 'x'}); stacked_line_chart glyph width=${ico.toFixed(0)}px`);

    // NT3 drawing hotkeys never trade; trading hotkeys still trade afterwards
    const t0 = await noTrade(); await key('F2'); await key('Escape'); await key('Control+2'); await key('Escape'); await key('Alt+2'); await key('Escape'); const t1 = await noTrade();
    await page.keyboard.press('b'); await page.waitForTimeout(200); const tb = await noTrade();
    await page.keyboard.press('x'); await page.waitForTimeout(200); const tx = await noTrade();
    await page.keyboard.press('f'); await page.waitForTimeout(200); const tf_ = await noTrade(); await page.evaluate(() => cancelOrder('entry'));
    await page.keyboard.press('j'); await page.waitForTimeout(200); const tj = await noTrade(); await page.evaluate(() => cancelOrder('entry'));
    await page.keyboard.press('s'); await page.waitForTimeout(200); const ts_ = await noTrade(); await page.keyboard.press('x'); await page.waitForTimeout(200);
    await page.evaluate(() => { markers = []; refreshMarkers(true); });   // the 2 round trips above left trade arrows on the last bars; a click on one deletes it instead of grabbing a drawing
    report('NT3', t0.pos === null && t0.entry === null && t1.pos === null && t1.entry === null && tb.pos === 'long' && tx.pos === null && tf_.entry === 'long/stop' && tj.entry === 'short/stop' && ts_.pos === 'short', `F2 / Ctrl+2 / Alt+2 placed nothing (pos=${t1.pos} entry=${t1.entry}); then B->${tb.pos} X->flat(${tx.pos === null}) F->${tf_.entry} J->${tj.entry} S->${ts_.pos}`);

    // geometry for the placement / drag tests (all on revealed bars, magnet off)
    const P1 = [await barX(k), Math.round(geo.H * 0.42)], P2 = [await barX(k + 20), Math.round(geo.H * 0.36)], P3 = [await barX(k + 5), Math.round(geo.H * 0.62)];
    const P4 = [P3[0] + P2[0] - P1[0], P3[1] + P2[1] - P1[1]];
    const cr = await chartRect();

    // NT4 + NT5: 3-click placement with live preview after click 1 and after click 2; clicks 1-2 leave no undo entry
    await reset();
    await clickTool('#drwChannel');
    const armed = await st();
    await clickChart(...P1);
    const s1 = await page.evaluate(() => ({ n: drawings.length, p1: !!pendingPt, p2: !!pendingPt2, u: undoStack.length }));
    const band1 = segPts(...P1, ...P2), pre1 = await sample(band1);
    await page.mouse.move(cr.left + P2[0], cr.top + P2[1], { steps: 4 }); await page.waitForTimeout(250);
    const post1 = await sample(band1), dbg1 = await page.evaluate(() => window.__drwDbg && window.__drwDbg.preview);
    await clickChart(...P2);
    const s2 = await page.evaluate(() => ({ n: drawings.length, p1: !!pendingPt, p2: !!pendingPt2, u: undoStack.length }));
    const railA = segPts(...P1, ...P2), railB = segPts(...P3, ...P4), preA = await sample(railA), preB = await sample(railB);
    await page.mouse.move(cr.left + P3[0], cr.top + P3[1], { steps: 4 }); await page.waitForTimeout(250);
    const postA = await sample(railA), postB = await sample(railB), dbg2 = await page.evaluate(() => window.__drwDbg && window.__drwDbg.preview);
    await clickChart(...P3);
    const s3 = await page.evaluate(() => { const d = drawings[0]; return { n: drawings.length, type: d && d.type, p3: !!(d && d.p3 && d.p3.t != null && d.p3.p != null), levels: d && JSON.stringify(d.levels), tool, pend: !!pendingPt || !!pendingPt2, u: undoStack.length, sel: selDrawing === d }; });
    report('NT4', armed.tool === 'channel' && s1.n === 0 && s1.p1 && !s1.p2 && s2.n === 0 && s2.p1 && s2.p2 && s1.u === 0 && s2.u === 0 && s3.n === 1 && s3.type === 'channel' && s3.p3 && s3.levels === '[]' && s3.tool === '' && !s3.pend && s3.u === 1 && s3.sel, `flyout row arms 'channel'; click1 n=${s1.n}, click2 n=${s2.n} (undo entries ${s1.u}/${s2.u}), click3 n=${s3.n} type=${s3.type} p3=${s3.p3} levels=${s3.levels} -> one undo entry(${s3.u}), selected(${s3.sel}), tool back to cursor('${s3.tool}', Keep drawing off)`);
    report('NT5', frac(pre1, post1) >= 0.7 && dbg1 && dbg1.tool === 'channel' && !dbg1.rails && frac(preA, postA) >= 0.7 && frac(preB, postB) >= 0.7 && dbg2 && dbg2.rails === 2, `after click 1: rubber band to the cursor (pixels changed on ${Math.round(frac(pre1, post1) * 100)}% of the p1->cursor path); after click 2: fixed trend rail + parallel rail from the cursor (changed ${Math.round(frac(preA, postA) * 100)}% / ${Math.round(frac(preB, postB) * 100)}%, __drwDbg.preview.rails=${dbg2 && dbg2.rails})`);

    // NT6 render: both rails, no fill / no midline, 6 handles when selected
    let c = await chan();
    const inkA = share(await inkDiff(segPts(c.g.x1, c.g.y1, c.g.x2, c.g.y2))), inkB = share(await inkDiff(segPts(c.g.x3, c.g.y3, c.g.x4, c.g.y4)));
    const mid = segPts((c.g.x1 + c.g.x3) / 2, (c.g.y1 + c.g.y3) / 2, (c.g.x2 + c.g.x4) / 2, (c.g.y2 + c.g.y4) / 2, 0.2, 0.8, 7), quarter = segPts(c.g.x1 + (c.g.x3 - c.g.x1) * 0.3, c.g.y1 + (c.g.y3 - c.g.y1) * 0.3, c.g.x2 + (c.g.x4 - c.g.x2) * 0.3, c.g.y2 + (c.g.y4 - c.g.y2) * 0.3, 0.2, 0.8, 7);
    const inkMid = share(await inkDiff(mid)), inkQ = share(await inkDiff(quarter));
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); }); const dSel = await paint();
    report('NT6', inkA >= 0.8 && inkB >= 0.8 && inkMid === 0 && inkQ === 0 && dSel.handles === 6, `rail ink trend=${inkA.toFixed(2)} parallel=${inkB.toFixed(2)}; band interior untouched at the centre(${inkMid}) and 30% line(${inkQ}) = no fill, no midline (NT default); handles when selected=${dSel.handles} (NT: 3 per rail)`);

    // NT7 parallel geometry holds at two zoom levels (pixel vector of rail b == rail a)
    const zoom = [];
    for (const sp of [geo.spacing, geo.spacing * 1.8]) {
      await page.evaluate((sp) => chart.timeScale().applyOptions({ barSpacing: sp }), sp); await page.waitForTimeout(250);
      const q = await chan(); const inkBz = share(await inkDiff(segPts(q.g.x3, q.g.y3, q.g.x4, q.g.y4)));
      zoom.push({ sp, dx: Math.abs((q.g.x4 - q.g.x3) - (q.g.x2 - q.g.x1)), dy: Math.abs((q.g.y4 - q.g.y3) - (q.g.y2 - q.g.y1)), len: Math.hypot(q.g.x2 - q.g.x1, q.g.y2 - q.g.y1), ink: inkBz });
    }
    await page.evaluate((sp) => chart.timeScale().applyOptions({ barSpacing: sp }), geo.spacing); await page.waitForTimeout(250);
    report('NT7', zoom.every(z => z.dx < 1 && z.dy < 1 && z.ink >= 0.8) && Math.abs(zoom[1].len - zoom[0].len) > 20, zoom.map(z => `barSpacing ${z.sp.toFixed(1)}: |Δvec|=(${z.dx.toFixed(2)},${z.dy.toFixed(2)})px, trend len ${z.len.toFixed(0)}px, parallel ink ${z.ink.toFixed(2)}`).join('; '));

    // NT8 drag p3 (NT L2A1): parallel rail only
    c = await chan(); await dragChart(c.g.x3, c.g.y3, c.g.x3 + 24, c.g.y3 + 30);
    let c2_ = await chan();
    report('NT8', JSON.stringify(c2_.p1) === JSON.stringify(c.p1) && JSON.stringify(c2_.p2) === JSON.stringify(c.p2) && c2_.p3.p !== c.p3.p && c2_.p3.t !== c.p3.t, `drag p3 (+24,+30)px: trend p1/p2 unchanged(${JSON.stringify(c2_.p1) === JSON.stringify(c.p1)}/${JSON.stringify(c2_.p2) === JSON.stringify(c.p2)}), p3 moved in time and price(${c2_.p3.t !== c.p3.t}/${c2_.p3.p !== c.p3.p})`);

    // NT9 drag p2 (NT L1A2): p2 only; the parallel end follows because it is derived
    c = await chan(); await dragChart(c.g.x2, c.g.y2, c.g.x2 + 30, c.g.y2 - 20);
    c2_ = await chan();
    report('NT9', JSON.stringify(c2_.p1) === JSON.stringify(c.p1) && JSON.stringify(c2_.p3) === JSON.stringify(c.p3) && c2_.p2.p !== c.p2.p && Math.abs((c2_.g.x4 - c2_.g.x3) - (c2_.g.x2 - c2_.g.x1)) < 1 && Math.abs(c2_.g.x4 - c.g.x4 - 30) < 2, `drag p2 (+30,-20)px: p1/p3 unchanged, p2 moved; parallel end p4 moved with it (Δx4=${(c2_.g.x4 - c.g.x4).toFixed(1)}px) and stays parallel`);

    // NT10 drag p1 (NT L1A1): p3 rides along — offset vector p3-p1 fixed in price and in bars
    c = await chan(); await dragChart(c.g.x1, c.g.y1, c.g.x1 - 26, c.g.y1 + 22);
    c2_ = await chan();
    const offP0 = c.p3.p - c.p1.p, offP1 = c2_.p3.p - c2_.p1.p, offL0 = c.l3 - c.l1, offL1 = c2_.l3 - c2_.l1;
    report('NT10', c2_.p1.p !== c.p1.p && c2_.p1.t !== c.p1.t && JSON.stringify(c2_.p2) === JSON.stringify(c.p2) && Math.abs(offP1 - offP0) < 1e-6 && Math.abs(offL1 - offL0) < 0.01, `drag p1 (-26,+22)px: p1 moved, p2 unchanged; offset p3-p1 price ${offP0.toFixed(4)} -> ${offP1.toFixed(4)}, bars ${offL0.toFixed(3)} -> ${offL1.toFixed(3)} (both rails rotate together)`);

    // NT11 body drag from the trend-rail midpoint and from the (non-anchor) parallel end p4: all 3 anchors shift by the same delta
    const bodyMove = async (x, y) => { const a = await chan(); const what = await page.evaluate(([x, y]) => ({ h: !!nearestHandle(x, y), d: drawingAt(x, y) && drawingAt(x, y).type, mk: !!markerAt(x, y) }), [x, y]); await dragChart(x, y, x + 40, y + 25); const b = await chan(); const dp = [b.p1.p - a.p1.p, b.p2.p - a.p2.p, b.p3.p - a.p3.p], dl = [b.l1 - a.l1, b.l2 - a.l2, b.l3 - a.l3]; return { what, dp, dl, same: Math.max(...dp) - Math.min(...dp) < 1e-6 && Math.max(...dl) - Math.min(...dl) < 0.01 && Math.abs(dl[0]) > 0.5 && Math.abs(dp[0]) > 0 }; };
    c = await chan(); const bm = await bodyMove((c.g.x1 + c.g.x2) / 2, (c.g.y1 + c.g.y2) / 2);
    c = await chan(); const b4 = await bodyMove(c.g.x4, c.g.y4);
    report('NT11', bm.same && b4.same, `trend midpoint grab: Δbars=${bm.dl.map(v => v.toFixed(2)).join('/')} Δprice=${bm.dp.map(v => v.toFixed(2)).join('/')}; p4 grab (not an anchor in NT, hit=${JSON.stringify(b4.what)}): Δbars=${b4.dl.map(v => v.toFixed(2)).join('/')} Δprice=${b4.dp.map(v => v.toFixed(2)).join('/')} -> whole channel translated`);

    // NT12 Esc and right-click cancel an in-progress channel (no drawing, no undo entry, no trade menu)
    await reset();
    await clickTool('#drwChannel'); await clickChart(...P1); await clickChart(...P2); await key('Escape');
    const esc = await page.evaluate(() => ({ n: drawings.length, p1: pendingPt, p2: pendingPt2, tool, u: undoStack.length }));
    await clickTool('#drwChannel'); await clickChart(...P1); await clickChart(P2[0], P2[1], [], 'right');
    const rc = await page.evaluate(() => ({ n: drawings.length, p1: pendingPt, p2: pendingPt2, tool, u: undoStack.length, menu: !!(document.getElementById('ctxMenu') && document.getElementById('ctxMenu').style.display === 'block') }));
    await page.evaluate(() => { if (typeof hideCtx === 'function') hideCtx(); });
    report('NT12', esc.n === 0 && esc.p1 === null && esc.p2 === null && esc.tool === '' && esc.u === 0 && rc.n === 0 && rc.p1 === null && rc.tool === '' && rc.u === 0 && !rc.menu, `Esc after click 2: n=${esc.n} pending=${esc.p1}/${esc.p2} tool='${esc.tool}' undo=${esc.u}; right-click after click 1: n=${rc.n} pending=${rc.p1} tool='${rc.tool}' trade menu shown=${rc.menu}`);

    // NT13 Delete removes / NT14 undo + redo
    await reset();
    await clickTool('#drwChannel'); await clickChart(...P1); await clickChart(...P2); await clickChart(...P3);
    const nPlaced = await n(); await key('Control+z'); const nU = await n(); await key('Control+y'); const nR = await n();
    const redoP3 = await page.evaluate(() => !!(drawings[0] && drawings[0].type === 'channel' && drawings[0].p3));
    report('NT14', nPlaced === 1 && nU === 0 && nR === 1 && redoP3, `placed ${nPlaced} -> one Ctrl+Z -> ${nU} (clicks 1-2 left no history) -> Ctrl+Y -> ${nR} with p3 intact(${redoP3})`);
    await page.evaluate(() => window.__rt.setSel(0)); await key('Delete'); const nDel = await n(); await key('Control+z'); const nBack = await n();
    report('NT13', nDel === 0 && nBack === 1, `select + Delete -> ${nDel}; Ctrl+Z brings it back -> ${nBack}`);

    // NT15 Settings: Levels % (50 = midline), Extend right on both rails, Coordinates shows the Parallel start anchor
    c = await chan();
    await page.evaluate(() => { selectDrawing(drawings[0], false); openDrawSettings(drawings[0], 'style'); });
    const title = await page.evaluate(() => document.querySelector('#drawSettings .dd-date').textContent);
    await page.evaluate(() => { const i = document.querySelector('#drawSettings [data-k="lv:levels"]'); i.value = '50'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    const lvl = await page.evaluate(() => JSON.stringify(drawings[0].levels));
    const inkMid50 = share(await inkDiff(segPts((c.g.x1 + c.g.x3) / 2, (c.g.y1 + c.g.y3) / 2, (c.g.x2 + c.g.x4) / 2, (c.g.y2 + c.g.y4) / 2, 0.2, 0.8, 7)));
    await page.evaluate(() => { openDrawSettings(drawings[0], 'style'); const s = document.querySelector('#drawSettings [data-k="d:extend"]'); s.value = 'right'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    const PW = await page.evaluate(() => window.__paneW('chart'));
    const xr = PW - 30, yA = c.g.y1 + (c.g.y2 - c.g.y1) * (xr - c.g.x1) / (c.g.x2 - c.g.x1), yB = c.g.y3 + (c.g.y4 - c.g.y3) * (xr - c.g.x3) / (c.g.x4 - c.g.x3);
    const extInk = await inkDiff([[xr, yA], [xr, yB]]);
    await page.evaluate(() => openDrawSettings(drawings[0], 'coords'));
    const coords = await page.evaluate(() => ({ txt: document.getElementById('drawSettings').textContent, ks: [...document.querySelectorAll('#drawSettings [data-k]')].map(i => i.dataset.k) }));
    await page.evaluate(() => closeDrawSettings());
    report('NT15', title === 'Trend channel settings' && lvl === '[50]' && inkMid50 >= 0.8 && extInk[0] && extInk[1] && yA > 0 && yA < geo.H && yB > 0 && yB < geo.H && /Parallel start/.test(coords.txt) && coords.ks.includes('t:p3') && coords.ks.includes('p:p3'), `title='${title}'; Levels "50" -> levels=${lvl}, midline ink ${inkMid50.toFixed(2)}; Extend=right -> ink at x=${xr.toFixed(0)} on trend(${extInk[0]}) and parallel(${extInk[1]}); Coordinates has a Parallel start group (${coords.ks.filter(q => q.endsWith('p3')).join(',')})`);

    // NT17 renders past the last bar (placement in future space) / NT16 persists across reload
    await reset(); await page.evaluate(() => chart.timeScale().scrollToRealTime()); await page.waitForTimeout(250);   // last bar back at its rightOffset slot so 4 future bars are on the pane
    const liveIdx = await page.evaluate(() => idx), xLast = await barX(liveIdx), sp = geo.spacing;   // live idx: G47's 1m->5m->1m round trip can leave idx != geo.idx
    const F1 = [xLast - sp * 8, Math.round(geo.H * 0.3)], F2 = [xLast + sp * 4, Math.round(geo.H * 0.26)], F3 = [xLast - sp * 8, Math.round(geo.H * 0.5)];
    await clickTool('#drwChannel'); await clickChart(...F1); await clickChart(...F2); await clickChart(...F3);
    const fut = await page.evaluate(() => { const d = drawings[0]; return d && { t2: d.p2.t, lastT: bars[idx].time, native: chart.timeScale().timeToCoordinate(d.p2.t) }; });
    const fA = segPts(...F1, ...F2, 0.78, 0.95, 5), fB = segPts(F3[0], F3[1], F3[0] + F2[0] - F1[0], F3[1] + F2[1] - F1[1], 0.78, 0.95, 5);
    const futInk = [share(await inkDiff(fA)), share(await inkDiff(fB))];
    report('NT17', fut && fut.t2 > fut.lastT && fut.native == null && futInk[0] >= 0.8 && futInk[1] >= 0.8, `click 2 at 4 bars past the last bar -> p2.t=${fut && fut.t2} > last bar ${fut && fut.lastT} (native timeToCoordinate=${fut && fut.native}); ink on the future part of both rails ${futInk.map(v => v.toFixed(2)).join('/')}`);
    const saved = await chan();
    await load();
    const re = await chan();
    const reLast = await page.evaluate(() => chart.timeScale().timeToCoordinate(bars[idx].time)), rA = re ? segPts(re.g.x1, re.g.y1, re.g.x2, re.g.y2, 0.78, 0.95, 5) : [], rB = re ? segPts(re.g.x3, re.g.y3, re.g.x4, re.g.y4, 0.78, 0.95, 5) : [];   // view resets on reload -> re-derive the probe pixels
    const reInk = re && rA.concat(rB).every(([x]) => x > reLast) ? [share(await inkDiff(rA)), share(await inkDiff(rB))] : [0, 0];
    report('NT16', !!re && JSON.stringify(re.p1) === JSON.stringify(saved.p1) && JSON.stringify(re.p2) === JSON.stringify(saved.p2) && JSON.stringify(re.p3) === JSON.stringify(saved.p3) && reInk[0] >= 0.8 && reInk[1] >= 0.8, `after a page reload the channel is back from rt_drawings with identical p1/p2/p3 (${!!re && JSON.stringify(re.p3) === JSON.stringify(saved.p3)}) and still renders past the last bar (${reInk.map(v => v.toFixed(2)).join('/')})`);

    // NT18 no console errors / render errors across the whole NT block
    const drwNT = await page.evaluate(() => window.__drw);
    report('NT18', errs.length === e0 && drwNT && drwNT.ok && !drwNT.err, `console errors during NT1-NT17: ${errs.length - e0}${errs.length > e0 ? ' (' + errs.slice(e0).join(' | ').slice(0, 300) + ')' : ''}; window.__drw=${JSON.stringify(drwNT)}`);
    await reset();
  }

  // ================= Regression guards (Stage 5 doc, 4 of them) =================
  await clear();
  {
    // 1) window.__drw.err must be undefined at the end of a long run of drawing operations above
    const drw = await page.evaluate(() => window.__drw);
    report('REG1-no-render-err', !!drw && drw.ok === true && !drw.err, `after the full matrix above, window.__drw=${JSON.stringify(drw)} (err must be undefined — the try/catch in the draw callback otherwise swallows exceptions silently)`);

    // 2) trading hotkeys B/S/F/J/X still work after every drawing test
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); if (entryOrder) cancelOrder('entry'); if (position) closePosition(); });
    await page.keyboard.press('b'); await page.waitForTimeout(200);
    const posB = await page.evaluate(() => position && position.side);
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    const flatX = await page.evaluate(() => position);
    await page.keyboard.press('f'); await page.waitForTimeout(200);
    const ordF = await page.evaluate(() => entryOrder && entryOrder.side + '/' + entryOrder.kind);
    await page.evaluate(() => cancelOrder('entry'));
    await page.keyboard.press('j'); await page.waitForTimeout(200);
    const ordJ = await page.evaluate(() => entryOrder && entryOrder.side + '/' + entryOrder.kind);
    await page.evaluate(() => cancelOrder('entry'));
    await page.keyboard.press('s'); await page.waitForTimeout(200);
    const posS = await page.evaluate(() => position && position.side);
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    report('REG2-trading-hotkeys', posB === 'long' && flatX === null && ordF === 'long/stop' && ordJ === 'short/stop' && posS === 'short', `B->market long(${posB}) X->flat(${flatX === null}) F->buy-stop(${ordF}) J->sell-stop(${ordJ}) S->market short(${posS}); none of the new Alt/Ctrl drawing bindings shadowed these`);

    // 3) #btnHideTradesTop's own showTrades toggle is unaffected by the new G45 hideFlags.drawings mask
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([]);
    await page.evaluate((t) => placeAnnotation('au', t), t0);
    await page.evaluate(() => { hideFlags.drawings = false; saveJSON('rt_hide', hideFlags); });
    const before3 = await page.evaluate(() => ({ showTrades, mk: candle.markers().length }));
    await page.click('#btnHideTradesTop', { force: true }); await page.waitForTimeout(200);
    const after3 = await page.evaluate(() => ({ showTrades, mk: candle.markers().length }));
    await page.click('#btnHideTradesTop', { force: true }); await page.waitForTimeout(200);
    const restored3 = await page.evaluate(() => ({ showTrades, mk: candle.markers().length }));
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(true); });
    report('REG3-hide-trades-unchanged', before3.showTrades === true && after3.showTrades === false && restored3.showTrades === true, `#btnHideTradesTop still flips its own 'showTrades' switch independently of the new Hide>Drawings flag (${before3.showTrades}->${after3.showTrades}->${restored3.showTrades})`);

    // 4) replaying hundreds/thousands of bars (feedWindow/maybeReWindow re-feed the series, moving seriesFrom) must not drift existing drawings.
    // The loaded dataset (idx ~900-1400) is under RENDER_WINDOW=4000 (app.js:86), so a real replay session on it can never push
    // idx-seriesFrom past the 5500 re-window threshold -> seriesFrom never actually moves. To exercise the real regression risk
    // (technique borrowed from tests/qa_stage1_r1.mjs's NO-DRIFT-after-replay), synthetically extend bars[] and force seriesFrom
    // to genuinely shift twice while the drawing's bar stays inside the fed window both times.
    await load();
    const g4 = await page.evaluate(() => {
      const span = barSpanSec(), lastT = bars[bars.length - 1].time, N = 6000;
      for (let i = 1; i <= N; i++) { const p = 100 + (i % 5); bars.push({ time: lastT + i * span, open: p, high: p + 1, low: p - 1, close: p, volume: 10 }); }
      const idx0 = bars.length - 1 - 500, markIdx = idx0 - 2000, t = bars[markIdx].time;
      drawings.length = 0; drawings.push(newDrawing({ type: 'hl', p1: { t, p: bars[markIdx].close }, color: '#000000' }));
      saveJSON('rt_drawings', drawings); idx = idx0; feedWindow(false); repaintOverlays();
      return { t, p: bars[markIdx].close, idx0, seriesFrom0: seriesFrom, x0: drawX(t), native0: chart.timeScale().timeToCoordinate(t) };
    });
    await page.evaluate(() => { idx += 400; feedWindow(false); refreshMarkers(); repaintOverlays(); });
    await page.waitForTimeout(200);
    const r4 = await page.evaluate((t) => ({ t1: drawings[0].p1.t, p1: drawings[0].p1.p, x1: drawX(t), native1: chart.timeScale().timeToCoordinate(t), idx1: idx, seriesFrom1: seriesFrom, ok: window.__drw && window.__drw.ok, err: window.__drw && window.__drw.err }), g4.t);
    const ok4 = r4.t1 === g4.t && r4.p1 === g4.p && r4.seriesFrom1 !== g4.seriesFrom0 && r4.x1 != null && r4.native1 != null && Math.abs(r4.x1 - r4.native1) < 1 && r4.ok && !r4.err;
    report('REG4-no-drift-on-rewindow', ok4, `[dataset under RENDER_WINDOW so a real session can't shift seriesFrom -> synthetically extended bars[] by 6000] advanced idx ${g4.idx0}->${r4.idx1} (+400), seriesFrom genuinely moved ${g4.seriesFrom0}->${r4.seriesFrom1} (window really re-fed): stored p1.t/p1.p unchanged(${r4.t1 === g4.t}/${r4.p1 === g4.p}), drawX still matches native timeToCoordinate(${r4.x1 && r4.x1.toFixed(1)} vs ${r4.native1 && r4.native1.toFixed(1)}), no render error`);
    await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); });
  }

  await page.evaluate(() => { drawings.length = 0; annotations.length = 0; saveJSON('rt_drawings', drawings); saveJSON('rt_annotations', annotations); repaintOverlays(); });
} catch (e) {
  report('RUNNER-EXCEPTION', false, 'uncaught exception: ' + (e && e.stack || e));
} finally {
  await browser.close();
}

const order = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G19', 'G20', 'G21', 'G22', 'G23', 'G24', 'G25', 'G26', 'G27', 'G28', 'G29', 'G30', 'G31', 'G32', 'G33', 'G34', 'G35', 'G36', 'G37', 'G38', 'G39', 'G40', 'G41', 'G42', 'G43', 'G44', 'G45', 'G46', 'G47', 'G48', 'NT1', 'NT2', 'NT3', 'NT4', 'NT5', 'NT6', 'NT7', 'NT8', 'NT9', 'NT10', 'NT11', 'NT12', 'NT13', 'NT14', 'NT15', 'NT16', 'NT17', 'NT18', 'REG1-no-render-err', 'REG2-trading-hotkeys', 'REG3-hide-trades-unchanged', 'REG4-no-drift-on-rewindow'];
const byId = Object.fromEntries(results.map(r => [r.id, r.status]));
const pass = order.filter(id => byId[id] === 'PASS').length, fail = order.filter(id => byId[id] === 'FAIL').length, sk = order.filter(id => byId[id] === 'SKIP').length, missing = order.filter(id => !(id in byId));
console.log(`\n${pass} PASS / ${fail} FAIL / ${sk} SKIP out of ${order.length}${missing.length ? ` (missing: ${missing.join(',')})` : ''}`);
process.exit(fail === 0 && missing.length === 0 ? 0 : 1);
