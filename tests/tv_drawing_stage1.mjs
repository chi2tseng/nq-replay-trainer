// TV drawing parity — Stage 1 acceptance (TV_DRAWING_GAP.md §1.4 + G35/G36/G37/G38/G47 + migration + regressions).
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/tv_drawing_stage1.mjs
// Prints one PASS/FAIL line per rule id. Needs the local server on http://127.0.0.1:5560/.
import { createRequire } from 'module';
const sipsRequire = createRequire('D:/SIPs/package.json');
const { chromium } = sipsRequire('playwright');

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
    // pixel probes over every full-width canvas inside a root element (LWC pane canvases). Coordinates are root-relative CSS px.
    const canvases = (rootId) => {
      const root = document.getElementById(rootId), rr = root.getBoundingClientRect();
      return [...root.querySelectorAll('canvas')].map(c => ({ c, r: c.getBoundingClientRect() })).filter(o => o.r.width > rr.width * 0.5)
        .map(o => ({ ctx: o.c.getContext('2d'), ox: o.r.left - rr.left, oy: o.r.top - rr.top, w: o.c.width, h: o.c.height, sx: o.c.width / o.r.width, sy: o.c.height / o.r.height }));
    };
    const darkAt = (cs, x, y) => cs.some(({ ctx, ox, oy, w, h, sx, sy }) => {
      const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy); if (px < 0 || py < 0 || px >= w || py >= h) return false;
      const d = ctx.getImageData(px, py, 1, 1).data; return d[3] > 200 && d[0] < 70 && d[1] < 70 && d[2] < 70;
    });
    window.__colDark = (rootId, x, y0, y1) => { const cs = canvases(rootId); let n = 0, tot = 0; for (let y = Math.max(0, y0); y < y1; y++) { tot++; if (darkAt(cs, x - 1, y) || darkAt(cs, x, y) || darkAt(cs, x + 1, y)) n++; } return tot ? n / tot : 0; };
    window.__rowDark = (rootId, y, x0, x1) => { const cs = canvases(rootId); let n = 0, tot = 0; for (let x = Math.max(0, x0); x < x1; x++) { tot++; if (darkAt(cs, x, y - 1) || darkAt(cs, x, y) || darkAt(cs, x, y + 1)) n++; } return tot ? n / tot : 0; };
    window.__paneW = (rootId) => Math.max(...canvases(rootId).map(c => c.w / c.sx));   // pane canvas width (excludes the price axis)
    window.__ptDark = (rootId, x, y, rad = 2) => { const cs = canvases(rootId); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if (darkAt(cs, x + dx, y + dy)) return true; return false; };
  });
}
const nearT = (t, exp) => t != null && exp != null && Math.abs(t - exp) <= 8;   // Stage 2 (G6) frees time: Playwright rounds the click x to a whole client pixel, so a click at a bar's x lands within ~1px (<=8s of a 60s bar at 7.4px/bar) of it, not exactly on it
const seed = async (arr) => page.evaluate((arr) => { drawings.length = 0; selDrawing = null; for (const d of arr) drawings.push(newDrawing(d)); saveJSON('rt_drawings', drawings); repaintOverlays(); }, arr);
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const priceY = (p) => page.evaluate((p) => candle.priceToCoordinate(p), p);
const clickChart = async (x, y) => { const r = await chartRect(); await page.mouse.click(r.left + x, r.top + y); await page.waitForTimeout(650); };   // >500ms: LWC treats a second click inside 500ms as a double-click and swallows it

try {
  await load();
  const boot = await page.evaluate(() => ({ err: (window.__drw || {}).err, n: bars.length, idx, tf, span: barSpanSec(), v: localStorage.getItem('rt_drawings_v') }));
  report('BOOT', boot.n > 100 && !boot.err, `bars=${boot.n} idx=${boot.idx} tf=${boot.tf} barSpanSec=${boot.span} rt_drawings_v=${boot.v} consoleErrors=${errs.length}`);

  // ---- helper geometry: a visible price in the middle of the pane, a bar well inside the view ----
  const geo = await page.evaluate(() => {
    const H = document.getElementById('chart').clientHeight, W = document.getElementById('chart').clientWidth;
    const pMid = candle.coordinateToPrice(H * 0.5), pLow = candle.coordinateToPrice(H * 0.72);
    return { H, W, pMid, pLow, k: idx - 40, k2: idx - 15, lastT: bars[idx].time, idx };
  });

  // ================= G7 future space (seed via localStorage + reload, as the plan prescribes) =================
  await page.evaluate(({ lastT, pMid }) => {
    localStorage.setItem('rt_drawings', JSON.stringify([
      { type: 'vline', p1: { t: lastT + 240 }, color: '#000000' },                                       // 4 bars into the future (rightOffset is 6)
      { type: 'tl', p1: { t: lastT - 600, p: pMid }, p2: { t: lastT + 240, p: pMid }, color: '#000000' },   // ends in future space
    ])); localStorage.setItem('rt_drawings_v', '1');
  }, geo);
  await load();
  {
    const r = await page.evaluate(() => {
      const ts = chart.timeScale(), last = bars[idx].time, xLast = ts.timeToCoordinate(last), lg = timeToLogical(last + 240);
      const xV = drawX(last + 240), H = document.getElementById('chart').clientHeight;
      return { ok: window.__drw && window.__drw.ok, err: (window.__drw || {}).err, lastX: window.__drwDbg && window.__drwDbg.lastX, xLast, xV, lg, lgLast: timeToLogical(last), tt: ts.timeToCoordinate(last + 240), col: window.__colDark('chart', Math.round(xV), 20, H - 30), n: drawings.length };
    });
    report('G7', r.ok && r.n === 2 && Number.isFinite(r.xV) && r.xV > r.xLast && r.col > 0.9 && r.tt == null,
      `__drw.ok=${r.ok} err=${r.err} vline x=${r.xV && r.xV.toFixed(1)} > lastBar x=${r.xLast && r.xLast.toFixed(1)} (logical ${r.lgLast}→${r.lg && r.lg.toFixed(2)}) native timeToCoordinate=${r.tt} darkColFraction=${r.col.toFixed(2)}`);
  }

  // ================= migration v0 -> v1 =================
  await page.evaluate(({ lastT, pMid }) => {
    localStorage.setItem('rt_drawings', JSON.stringify([{ type: 'hl', p1: { t: lastT - 600, p: pMid }, color: '#d1d4dc' }, { type: 'tl', p1: { t: lastT - 900, p: pMid }, p2: { t: lastT - 300, p: pMid + 5 }, color: '#2962ff' }]));
    localStorage.removeItem('rt_drawings_v');
  }, geo);
  await load();
  {
    const r = await page.evaluate(() => {
      const d = drawings[0], e = drawings[1], saved = JSON.parse(localStorage.getItem('rt_drawings'));
      return { style: d.style, color: d.color, locked: d.locked, hidden: d.hidden, z: d.z, z1: e.z, visibleTFs: d.visibleTFs, id: d.id, id1: e.id, p1: d.p1, p2: e.p2, v: localStorage.getItem('rt_drawings_v'), savedStyle: saved[0].style && saved[0].style.color, savedColor: saved[1].color, ok: window.__drw && window.__drw.ok };
    });
    const ok = r.style && r.style.color === '#d1d4dc' && r.style.width === 1.5 && r.style.dash === 0 && r.color === '#d1d4dc' && r.locked === false && r.hidden === false && r.z === 0 && r.z1 === 1 && r.visibleTFs === null && typeof r.id === 'string' && r.id !== r.id1 && r.p1 && r.p1.p != null && r.p2 && r.v === '1' && r.savedStyle === '#d1d4dc' && r.savedColor === '#2962ff' && r.ok;
    report('MIGRATION', ok, `style=${JSON.stringify(r.style)} color kept=${r.color} locked=${r.locked} hidden=${r.hidden} z=${r.z},${r.z1} visibleTFs=${r.visibleTFs} id=${r.id} rt_drawings_v=${r.v} persisted style=${r.savedStyle} p1/p2 intact=${!!(r.p1 && r.p2)} __drw.ok=${r.ok}`);
  }

  // ================= G47 cross-interval: draw a tl by clicking at 1m, switch to 5m =================
  await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); });
  await load();
  {
    // pick two 1m bars whose times are NOT on a 5-minute boundary so they vanish from the 5m bar set
    const ks = await page.evaluate(() => { const out = []; for (let k = idx - 45; k < idx - 5 && out.length < 2; k++) if (bars[k].time % 300 !== 0) { out.push(k); k += 12; } return out; });
    await page.click('#drwTL');
    const yA = geo.H * 0.45, yB = geo.H * 0.6;
    await clickChart(await barX(ks[0]), yA); await clickChart(await barX(ks[1]), yB);
    const before = await page.evaluate(() => ({ n: drawings.length, t1: drawings[0] && drawings[0].p1.t, t2: drawings[0] && drawings[0].p2.t, tool, onBar: drawings[0] && bars.some(b => Math.abs(b.time - drawings[0].p1.t) <= 8) }));
    await page.evaluate(() => { const s = document.getElementById('tfSelect'); s.value = '5'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => {
      const d = drawings[0], ts = chart.timeScale(), spacing = ts.options().barSpacing;
      const x1 = drawX(d.p1.t), y1 = drawY(d.p1.p), x2 = drawX(d.p2.t), y2 = drawY(d.p2.p);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const nb = nearestBarTime(d.p1.t), xn = ts.timeToCoordinate(nb), i = barIndexLE(d.p1.t), xl = ts.timeToCoordinate(bars[i].time), xr = ts.timeToCoordinate(bars[i + 1].time);
      return { tf, t1: d.p1.t, t2: d.p2.t, stillOnBar: bars.some(b => b.time === d.p1.t), lastX: window.__drwDbg && window.__drwDbg.lastX, native: ts.timeToCoordinate(d.p1.t), x1, xn, xl, xr, spacing, nearOk: Math.abs(x1 - xn) <= spacing && x1 > xl && x1 < xr, pix: window.__ptDark('chart', Math.round(mx), Math.round(my), 3), ok: window.__drw && window.__drw.ok, err: (window.__drw || {}).err };
    });
    const ok = before.n === 1 && before.tool === '' && before.onBar && after.tf === 5 && after.t1 === before.t1 && after.t2 === before.t2 && !after.stillOnBar && Number.isFinite(after.lastX) && after.native == null && after.nearOk && after.pix && after.ok;
    report('G47', ok, `drawn at 1m (n=${before.n}, tool reverted='${before.tool}', p1 on a bar=${before.onBar}); after 5m: tf=${after.tf} p1.t unchanged=${after.t1 === before.t1} p1.t still a bar time=${after.stillOnBar} native timeToCoordinate=${after.native} drawX=${after.x1 && after.x1.toFixed(1)} between 5m bars x=${after.xl && after.xl.toFixed(1)}..${after.xr && after.xr.toFixed(1)} nearestBar x=${after.xn && after.xn.toFixed(1)} (spacing ${after.spacing && after.spacing.toFixed(2)}) lastX=${after.lastX && after.lastX.toFixed(1)} midpoint pixel dark=${after.pix} __drw.ok=${after.ok} err=${after.err}`);
    await page.evaluate(() => { const s = document.getElementById('tfSelect'); s.value = '1'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(1500);
  }

  // ================= G37 vline: one click, time-only, spans the oscillator pane =================
  await page.evaluate(() => { const s = document.getElementById('oscSelect'); s.value = 'rsi'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(1500);
  await seed([]);
  {
    const k = geo.k; const x = await barX(k);
    await page.click('#drwVLine');
    const armed = await page.evaluate(() => ({ tool, active: document.getElementById('drwVLine').classList.contains('active') }));
    await clickChart(x, geo.H * 0.5);
    await page.waitForTimeout(400);
    const r = await page.evaluate((k) => {
      const d = drawings[0], H = document.getElementById('chart').clientHeight, osc = document.getElementById('oscPane'), oh = osc.clientHeight, x = drawX(d.p1.t);
      const oscX = window.__drwOscDbg && window.__drwOscDbg.lastX, oscTimeX = oscChart.timeScale().timeToCoordinate(bars[k].time);   // where the osc pane itself puts that bar (its RSI point / mirrored crosshair)
      return { n: drawings.length, type: d && d.type, t: d && d.p1.t, hasP: d && ('p' in d.p1), expT: bars[k].time, tool, active: document.getElementById('drwVLine').classList.contains('active'), x,
        col: window.__colDark('chart', Math.round(x), 20, H - 30), oscH: oh, oscCol: window.__colDark('oscPane', Math.round(oscX), 4, oh - 4), oscX, oscTimeX, oscOk: window.__drwOsc && window.__drwOsc.ok, oscErr: (window.__drwOsc || {}).err, oscVisible: osc.style.display !== 'none' && oh > 20,
        fields: drawingFields(d).map(f => f.kind).join(','), handles: drawingHandles().map(h => h.vert ? 'vert' : h.horiz ? 'horiz' : 'pt').join(','), hit: drawingAt(x, H * 0.3) === d, miss: drawingAt(x + 40, H * 0.3) === null, hasStyle: !!(d && d.style && d.id) };
    }, k);
    const ok = armed.tool === 'vline' && armed.active && r.n === 1 && r.type === 'vline' && nearT(r.t, r.expT) && !r.hasP && r.tool === '' && !r.active && r.col > 0.9 && r.oscVisible && r.oscCol > 0.8 && r.oscOk && Math.abs(r.oscX - r.oscTimeX) < 1 && r.fields === 't' && r.handles === 'vert' && r.hit && r.miss && r.hasStyle;
    report('G37', ok, `armed tool=${armed.tool}; placed n=${r.n} type=${r.type} time-only=${!r.hasP} t==clicked bar(±8s)=${nearT(r.t, r.expT)} tool reverted='${r.tool}' btn active=${r.active}; main col dark=${r.col.toFixed(2)} osc pane visible=${r.oscVisible} h=${r.oscH} osc col dark @oscX=${r.oscCol.toFixed(2)} oscX=${r.oscX && r.oscX.toFixed(1)} == osc timeToCoordinate(bar)=${r.oscTimeX && r.oscTimeX.toFixed(1)} (main x=${r.x && r.x.toFixed(1)}) __drwOsc.ok=${r.oscOk} err=${r.oscErr}; fields=${r.fields} handles=${r.handles} hit=${r.hit} miss=${r.miss} style/id=${r.hasStyle}`);

    // drag the vline by its (vertical-only) handle 5 bars to the right → p1.t moves, nothing else
    const cr = await chartRect(); const spacing = await page.evaluate(() => chart.timeScale().options().barSpacing);
    await page.mouse.move(cr.left + r.x, cr.top + geo.H * 0.5); await page.mouse.down(); await page.mouse.move(cr.left + r.x + spacing * 5, cr.top + geo.H * 0.5, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(300);
    const dr = await page.evaluate((k) => ({ t: drawings[0].p1.t, exp: bars[k + 5].time, sel: selDrawing === drawings[0], saved: JSON.parse(localStorage.getItem('rt_drawings'))[0].p1.t }), k);
    report('G37-drag', nearT(dr.t, dr.exp) && dr.sel && dr.saved === dr.t, `vline handle drag +5 bars: p1.t=${dr.t} expected(±8s)=${dr.exp} selected=${dr.sel} persisted=${dr.saved === dr.t}`);
  }
  await page.evaluate(() => { const s = document.getElementById('oscSelect'); s.value = 'off'; s.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(600);

  // ================= G36 horizontal ray: one click, extends right only =================
  await seed([]);
  {
    const k = geo.k; const x = await barX(k); const y = await priceY(geo.pLow);
    await page.click('#drwHRay'); await clickChart(x, y); await page.waitForTimeout(400);
    const r = await page.evaluate(({ k, W }) => {
      const d = drawings[0], x1 = drawX(d.p1.t), y1 = drawY(d.p1.p);
      const PW = window.__paneW('chart');
      return { n: drawings.length, type: d && d.type, t: d && d.p1.t, expT: bars[k].time, p: d && d.p1.p, noP2: d && d.p2 === undefined, tool, right: window.__rowDark('chart', Math.round(y1), Math.round(x1) + 6, PW - 2), left: window.__rowDark('chart', Math.round(y1), 5, Math.round(x1) - 6),
        hitR: drawingAt(x1 + 150, y1) === d, missL: drawingAt(x1 - 60, y1) === null, fields: drawingFields(d).map(f => f.kind).sort().join(','), handles: drawingHandles().length };
    }, { k: k, W: geo.W });
    const ok = r.n === 1 && r.type === 'hray' && nearT(r.t, r.expT) && r.p != null && r.noP2 && r.tool === '' && r.right > 0.9 && r.left < 0.25 && r.hitR && r.missL && r.fields === 'p,t' && r.handles === 1;
    report('G36', ok, `n=${r.n} type=${r.type} p1={t on bar(±8s)=${nearT(r.t, r.expT)}, p=${r.p}} no p2=${r.noP2} tool reverted='${r.tool}'; row dark right of anchor=${r.right.toFixed(2)} left of anchor=${r.left.toFixed(2)}; hit right=${r.hitR} miss left=${r.missL} fields=${r.fields} handles=${r.handles}`);
  }

  // ================= G38 cross line: one click, full-width + full-height =================
  await seed([]);
  {
    const k = geo.k2; const x = await barX(k); const y = await priceY(geo.pMid);
    await page.click('#drwCross'); await clickChart(x, y); await page.waitForTimeout(400);
    const r = await page.evaluate(({ k, W }) => {
      const d = drawings[0], x1 = drawX(d.p1.t), y1 = drawY(d.p1.p), H = document.getElementById('chart').clientHeight;
      const PW = window.__paneW('chart');
      return { n: drawings.length, type: d && d.type, t: d && d.p1.t, expT: bars[k].time, tool, row: window.__rowDark('chart', Math.round(y1), 5, PW - 2), col: window.__colDark('chart', Math.round(x1), 20, H - 30),
        hitH: drawingAt(30, y1) === d, hitV: drawingAt(x1, H * 0.15) === d, miss: drawingAt(x1 + 60, y1 + 60) === null, fields: drawingFields(d).map(f => f.kind).sort().join(',') };
    }, { k, W: geo.W });
    const ok = r.n === 1 && r.type === 'cross' && nearT(r.t, r.expT) && r.tool === '' && r.row > 0.9 && r.col > 0.9 && r.hitH && r.hitV && r.miss && r.fields === 'p,t';
    report('G38', ok, `n=${r.n} type=${r.type} on bar(±8s)=${nearT(r.t, r.expT)} tool reverted='${r.tool}'; row dark=${r.row.toFixed(2)} col dark=${r.col.toFixed(2)} hit horizontal arm=${r.hitH} hit vertical arm=${r.hitV} miss off-arms=${r.miss} fields=${r.fields}`);
    // body drag of the cross moves both t and p
    const cr = await chartRect(); const spacing = await page.evaluate(() => chart.timeScale().options().barSpacing);
    await page.mouse.move(cr.left + x + 120, cr.top + y); await page.mouse.down(); await page.mouse.move(cr.left + x + 120 + spacing * 3, cr.top + y - 40, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(300);
    const dr = await page.evaluate(({ k, p0 }) => ({ t: drawings[0].p1.t, expT: bars[k + 3].time, p: drawings[0].p1.p, p0, sel: selDrawing === drawings[0] }), { k, p0: geo.pMid });
    report('G38-drag', nearT(dr.t, dr.expT) && dr.p > dr.p0 && dr.sel, `body drag +3 bars / up 40px: p1.t=${dr.t} expected(±8s, body moves are free-time since Stage 3)=${dr.expT} price ${dr.p0.toFixed(2)}→${dr.p.toFixed(2)} selected=${dr.sel}`);
  }

  // ================= G35 ray with dx===0 extends vertically and stays clickable =================
  {
    const t = await page.evaluate((k) => bars[k].time, geo.k);
    await seed([
      { type: 'ray', p1: { t, p: geo.pMid }, p2: { t, p: geo.pMid - 8 }, color: '#000000' },   // same bar, pointing down → must reach the bottom edge
    ]);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const d = drawings[0], H = document.getElementById('chart').clientHeight, x = drawX(d.p1.t), y1 = drawY(d.p1.p), y2 = drawY(d.p2.p);
      const below = window.__colDark('chart', Math.round(x), Math.round(y2) + 10, H - 30), above = window.__colDark('chart', Math.round(x), 20, Math.round(y1) - 10);
      return { x, y1, y2, below, above, hitFar: drawingAt(x, (y2 + H) / 2 + 20) === d, hitSeg: drawingAt(x, (y1 + y2) / 2) === d, missAbove: drawingAt(x, y1 - 40) === null, ok: window.__drw && window.__drw.ok };
    });
    report('G35', r.below > 0.9 && r.above < 0.2 && r.hitFar && r.hitSeg && r.missAbove && r.ok, `dx===0 ray: dark col below p2=${r.below.toFixed(2)} above p1=${r.above.toFixed(2)} hit beyond p2=${r.hitFar} hit segment=${r.hitSeg} miss above p1=${r.missAbove} __drw.ok=${r.ok}`);
    await seed([{ type: 'ray', p1: { t, p: geo.pMid }, p2: { t, p: geo.pMid + 8 }, color: '#000000' }]);   // pointing up → reaches the top edge
    await page.waitForTimeout(300);
    const u = await page.evaluate(() => { const d = drawings[0], x = drawX(d.p1.t), y2 = drawY(d.p2.p), H = document.getElementById('chart').clientHeight; return { above: window.__colDark('chart', Math.round(x), 20, Math.round(y2) - 10), hitTop: drawingAt(x, 25) === d, below: window.__colDark('chart', Math.round(x), drawY(d.p1.p) + 10, H - 30) }; });
    report('G35-up', u.above > 0.9 && u.hitTop && u.below < 0.2, `upward dx===0 ray: dark col above p2=${u.above.toFixed(2)} hit near top=${u.hitTop} below p1=${u.below.toFixed(2)}`);
  }

  // ================= existing types still render through drawX/drawY (regression) =================
  {
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 10].time, bars[k + 20].time], geo.k);
    await seed([
      { type: 'hl', p1: { t: ts[0], p: geo.pMid }, color: '#000000' },
      { type: 'tl', p1: { t: ts[0], p: geo.pMid }, p2: { t: ts[1], p: geo.pMid + 6 }, color: '#000000' },
      { type: 'box', p1: { t: ts[0], p: geo.pMid - 2 }, p2: { t: ts[1], p: geo.pMid - 8 }, color: '#6495ED' },
      { type: 'fib', p1: { t: ts[1], p: geo.pMid - 10 }, p2: { t: ts[2], p: geo.pMid + 10 }, color: '#CC4400' },
      { type: 'measure', p1: { t: ts[0], p: geo.pMid + 10 }, p2: { t: ts[2], p: geo.pMid + 14 }, color: '#000000' },
      { type: 'rr', p1: { t: ts[1], p: geo.pMid }, p2: { t: ts[2], p: geo.pMid }, stop: geo.pMid - 4, target: geo.pMid + 8, color: '#CC4400' },
    ]);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const H = document.getElementById('chart').clientHeight;
      const d = drawings[0], y = drawY(d.p1.p), x1 = drawX(drawings[1].p1.t), x2 = drawX(drawings[1].p2.t);
      return { ok: window.__drw && window.__drw.ok, err: (window.__drw || {}).err, n: window.__drw && window.__drw.n, hlRow: window.__rowDark('chart', Math.round(y), 5, 200), tlHit: drawingAt((x1 + x2) / 2, (drawY(drawings[1].p1.p) + drawY(drawings[1].p2.p)) / 2) === drawings[1], handles: drawingHandles().length, boxHit: drawingAt(drawX(drawings[2].p1.t), (drawY(drawings[2].p1.p) + drawY(drawings[2].p2.p)) / 2) === drawings[2] };
    });
    report('REGRESSION-types', r.ok && !r.err && r.hlRow > 0.9 && r.tlHit && r.boxHit && r.handles >= 8, `hl/tl/box/fib/measure/rr seeded: __drw.ok=${r.ok} err=${r.err} hl row dark=${r.hlRow.toFixed(2)} tl body hit=${r.tlHit} box edge hit=${r.boxHit} handles=${r.handles}`);
  }

  // ================= regressions: annotation tools + trading hotkeys + leftbar inventory =================
  await seed([]);
  {
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(); });
    await page.click('#annUp'); await clickChart(await barX(geo.k), geo.H * 0.5);
    const a = await page.evaluate(() => ({ n: annotations.length, tool }));
    await page.click('#annLong'); await clickChart(await barX(geo.k + 3), geo.H * 0.5);
    const a2 = await page.evaluate(() => ({ n: annotations.length, tool, txt: annotations[1] && annotations[1].text }));
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(); });
    report('REGRESSION-annotations', a.n === 1 && a.tool === '' && a2.n === 2 && a2.txt === 'LONG', `annUp → annotations=${a.n} tool='${a.tool}'; annLong → annotations=${a2.n} text=${a2.txt}`);

    await page.keyboard.press('b'); await page.waitForTimeout(200);
    const pos1 = await page.evaluate(() => position && position.side);
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    const pos2 = await page.evaluate(() => position);
    await page.keyboard.press('f'); await page.waitForTimeout(200);
    const ord1 = await page.evaluate(() => entryOrder && entryOrder.side + '/' + entryOrder.kind);
    await page.evaluate(() => cancelEntry());
    await page.keyboard.press('j'); await page.waitForTimeout(200);
    const ord2 = await page.evaluate(() => entryOrder && entryOrder.side + '/' + entryOrder.kind);
    await page.evaluate(() => cancelEntry());
    await page.keyboard.press('s'); await page.waitForTimeout(200);
    const pos3 = await page.evaluate(() => position && position.side);
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    const pos4 = await page.evaluate(() => position);
    report('REGRESSION-hotkeys', pos1 === 'long' && pos2 === null && ord1 === 'long/stop' && ord2 === 'short/stop' && pos3 === 'short' && pos4 === null, `B→${pos1} X→${pos2} F→${ord1} J→${ord2} S→${pos3} X→${pos4}`);

    const inv = await page.evaluate(() => ['toolCursor', 'btnMagnet', 'drwTL', 'drwRay', 'drwHL', 'drwBox', 'drwFib', 'drwMeasure', 'drwRR', 'drwHRay', 'drwVLine', 'drwCross', 'annUp', 'annDown', 'annLong', 'annShort', 'drwClear', 'annClear'].map(id => { const el = document.getElementById(id); const sp = el && el.querySelector('span'); return el && el.getBoundingClientRect().height > 20 && (!sp || sp.getBoundingClientRect().width < 30) ? null : id; }).filter(Boolean));
    const tb = await page.evaluate(() => ['hray', 'vline', 'cross'].every(k => document.getElementById(TOOLBTN[k])));
    report('LEFTBAR', inv.length === 0 && tb, `all leftbar buttons present with glyph icons (missing/broken: [${inv}]); TOOLBTN maps hray/vline/cross=${tb}`);
  }

  // clean up and final health
  await page.evaluate(() => { drawings.length = 0; saveJSON('rt_drawings', drawings); repaintOverlays(); });
  const fin = await page.evaluate(() => ({ err: (window.__drw || {}).err, oscErr: (window.__drwOsc || {}).err }));
  report('CONSOLE', errs.length === 0 && !fin.err && !fin.oscErr, `console/page errors=${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''} __drw.err=${fin.err} __drwOsc.err=${fin.oscErr}`);
} catch (e) {
  report('SCRIPT', false, 'exception: ' + (e.stack || e));
}
await page.screenshot({ path: 'D:/Tools/replay-trainer/exports/qa/tv_stage1.png' }).catch(() => {});
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} PASS`);
process.exit(results.every(Boolean) ? 0 : 1);
