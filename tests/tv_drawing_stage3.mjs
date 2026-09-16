// TV drawing parity — Stage 3 acceptance (TV_DRAWING_GAP.md Stage 3: G12-G20, G34, G39-G43 drag guard + regressions).
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/tv_drawing_stage3.mjs
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
    const rgbAt = (cs, x, y) => { for (let i = cs.length - 1; i >= 0; i--) { const { ctx, ox, oy, w, h, sx, sy } = cs[i]; const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy); if (px < 0 || py < 0 || px >= w || py >= h) continue; const d = ctx.getImageData(px, py, 1, 1).data; if (d[3] > 80) return [...d]; } return null; };   // topmost canvas (drawings) first; lower canvases are opaque white. alpha > 80: a 1px line at a fractional y splits over two rows
    const isInk = (d) => d && d[3] > 80 && (d[0] < 200 || d[1] < 200 || d[2] < 200) && !(d[0] === d[1] && d[1] === d[2] && d[0] > 200);
    window.__ptInk = (rootId, x, y, rad = 2) => { const cs = canvases(rootId); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if (isInk(rgbAt(cs, x + dx, y + dy))) return true; return false; };
    window.__rgb = (rootId, x, y) => rgbAt(canvases(rootId), x, y);
    window.__colorNear = (rootId, x, y, test, rad = 2) => { const cs = canvases(rootId); const f = new Function('r', 'g', 'b', 'return ' + test); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) { const d = rgbAt(cs, x + dx, y + dy); if (d && d[3] > 80 && f(d[0], d[1], d[2])) return true; } return false; };
  });
}
const clear = async () => page.evaluate(() => { drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); drawingsLocked = false; lockBtnUI(); if ($('drawSettings').classList.contains('open')) closeDrawSettings(); repaintOverlays(); });
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const clickChart = async (x, y, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(r.left + x, r.top + y); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(650); };   // >500ms: LWC swallows a second click inside 500ms as a double-click
const dragChart = async (x1, y1, x2, y2, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.move(r.left + x1, r.top + y1); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(r.left + x1 + (x2 - x1) * i / 8, r.top + y1 + (y2 - y1) * i / 8); await page.waitForTimeout(60); await page.mouse.up(); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(300); };
const hoverChart = async (x, y) => { const r = await chartRect(); await page.mouse.move(r.left + x, r.top + y); await page.waitForTimeout(150); };
const paint = () => page.evaluate(() => new Promise(res => { repaintOverlays(); requestAnimationFrame(() => requestAnimationFrame(() => res(window.__drwDbg))); }));
const seed = (list) => page.evaluate((list) => { drawings.length = 0; for (const d of list) drawings.push(newDrawing(d)); clearSelection(); saveJSON('rt_drawings', drawings); repaintOverlays(); }, list);
const geomOf = (i) => page.evaluate((i) => { const d = drawings[i]; if (!d) return null; return { type: d.type, t1: d.p1.t, p1: d.p1.p, t2: d.p2 && d.p2.t, p2: d.p2 && d.p2.p, x1: drawX(d.p1.t), y1: drawY(d.p1.p), x2: d.p2 ? drawX(d.p2.t) : null, y2: d.p2 ? drawY(d.p2.p) : null, stop: d.stop, target: d.target, color: d.style && d.style.color }; }, i);
const drawTL = async (x1, y1, x2, y2, mods2 = [], tool = 'drwTL') => { await page.click('#' + tool); await clickChart(x1, y1); await clickChart(x2, y2, mods2); };

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); localStorage.setItem('rt_magnet', '"off"'); localStorage.setItem('rt_lockdrw', 'false'); localStorage.setItem('rt_keepdraw', 'false'); });
  await load();
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx, spacing: chart.timeScale().options().barSpacing, tf, lastT: bars[Math.min(idx, bars.length - 1)].time, nBars: bars.length }));
  const k = geo.idx - 40;
  const boot = await page.evaluate(() => ({ tb: document.getElementById('drawToolbar').hidden, lock: !!document.getElementById('btnLockDrw'), ok: window.__drw && window.__drw.ok, ds: !!document.getElementById('drawSettings') }));
  report('LOAD', errs.length === 0 && boot.tb && boot.lock && boot.ds, `console errors=${errs.length} ${errs.slice(0, 2).join(' | ')}; #drawToolbar hidden=${boot.tb} #btnLockDrw=${boot.lock} #drawSettings=${boot.ds} __drw.ok=${boot.ok}`);

  // ================= G12 handles only when selected / hovered (tl + measure + rr) =================
  await clear();
  {
    const xa = await barX(k), xb = await barX(k + 14), ya = geo.H * 0.35, yb = geo.H * 0.55;
    await drawTL(xa, ya, xb, yb);
    let g = await geomOf(0);
    await clickChart(geo.W * 0.5, geo.H * 0.9);   // empty space -> deselect
    await hoverChart(20, 20);
    let dbg = await paint();
    const noSel = await page.evaluate(() => ({ sel: selDrawing, n: selSet.size }));
    const inkP1Unsel = await page.evaluate(([x, y]) => window.__ptInk('chart', x - 2, y + 2, 0) || window.__ptInk('chart', x + 2, y - 2, 0), [g.x1, g.y1]);   // off the line (perpendicular), inside the r=5 handle's blue fill (the black ring starts at ~4.2px)
    const handlesUnsel = dbg.handles;
    await hoverChart((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2);
    const hov = await page.evaluate(() => ({ h: hoverDrawing && hoverDrawing.type, handles: window.__drwDbg.handles, cur: document.getElementById('chart').style.cursor }));
    await clickChart((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2);
    dbg = await paint();
    const selNow = await page.evaluate(() => selDrawing && selDrawing.type);
    const inkP1Sel = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y + 2, 'b > 180 && r < 140', 0) || window.__colorNear('chart', x + 2, y - 2, 'b > 180 && r < 140', 0), [g.x1, g.y1]);
    report('G12-tl', noSel.sel === null && noSel.n === 0 && handlesUnsel === 0 && !inkP1Unsel && hov.h === 'tl' && hov.handles === 2 && selNow === 'tl' && dbg.handles === 2 && inkP1Sel,
      `deselected: selDrawing=${noSel.sel} handles drawn=${handlesUnsel} handle ink at p1=${inkP1Unsel}; hover body: hoverDrawing=${hov.h} handles=${hov.handles} cursor=${hov.cur}; click body: sel=${selNow} handles=${dbg.handles} blue handle ink at p1=${inkP1Sel}`);
  }
  {
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5));
    await seed([{ type: 'measure', p1: { t: ts[0], p: pm + 6 }, p2: { t: ts[1], p: pm - 6 }, color: '' }, { type: 'rr', p1: { t: ts[0], p: pm - 30 }, stop: pm - 40, target: pm - 10, color: '' }]);   // no p2 -> default 300px box, so the centred label pills stay clear of the corner handles
    await paint();
    const m = await geomOf(0), r = await geomOf(1);
    const rrXa = await page.evaluate(() => rrRange(drawings[1], drawX).xa), rrYt = await page.evaluate(() => drawY(drawings[1].target));
    const mUn = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 3, y - 3, 'b > 180 && r < 140', 0), [m.x1, m.y1]);
    const rUn = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y - 2, 'b > 180 && r < 140', 0), [rrXa, rrYt]);
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); }); await paint();
    const mSel = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 3, y - 3, 'b > 180 && r < 140', 0), [m.x1, m.y1]);
    await page.evaluate(() => { selectDrawing(drawings[1], false); repaintOverlays(); }); await paint();
    const rSel = await page.evaluate(([x, y]) => window.__colorNear('chart', x - 2, y - 2, 'b > 180 && r < 140', 0), [rrXa, rrYt]);
    report('G12-measure-rr', !mUn && !rUn && mSel && rSel, `blue handle pixel just outside the p1 corner — measure: unselected=${mUn} selected=${mSel}; rr (corner ${rrXa.toFixed(0)},${rrYt.toFixed(0)}): unselected=${rUn} selected=${rSel}`);
  }

  // ================= G14 Shift = 45° (tl) / G16 Shift = square (box) =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 120, ya + 90, ['Shift']);
    const g = await geomOf(0);
    const ratio = g ? Math.abs((g.y2 - g.y1) / (g.x2 - g.x1)) : NaN;
    report('G14', g && g.type === 'tl' && Math.abs(ratio - 1) < 0.03, `tl 2nd click at dx=120 dy=90 (36.9°) with Shift -> pixel dx=${g && (g.x2 - g.x1).toFixed(1)} dy=${g && (g.y2 - g.y1).toFixed(1)} |dy/dx|=${ratio.toFixed(3)}`);
    await clear();
    await drawTL(xa, ya, xa + 120, ya + 60, ['Shift'], 'drwBox');
    const b = await geomOf(0);
    const w = b ? Math.abs(b.x2 - b.x1) : NaN, h = b ? Math.abs(b.y2 - b.y1) : NaN;
    report('G16', b && b.type === 'box' && Math.abs(w - h) < 2 && w > 100, `box 2nd click at dx=120 dy=60 with Shift -> w=${w.toFixed(1)} h=${h.toFixed(1)}`);
  }

  // ================= G15 Shift-drag locks one axis =================
  {
    const b = await geomOf(0);   // the square box from above; grab its top edge midpoint
    const gx = (b.x1 + b.x2) / 2, gy = Math.min(b.y1, b.y2);
    await dragChart(gx, gy, gx + 60, gy + 40, ['Shift']);
    const a = await geomOf(0);
    const dt = a.t1 !== b.t1 || a.t2 !== b.t2, dp = Math.abs(a.p1 - b.p1) > 1e-9 || Math.abs(a.p2 - b.p2) > 1e-9;
    report('G15', dt && !dp && Math.abs(a.x1 - b.x1 - 60) < 3, `Shift-drag box by (+60,+40)px: time changed=${dt} (x1 ${b.x1.toFixed(1)}->${a.x1.toFixed(1)}), price changed=${dp} (p1 ${b.p1}->${a.p1})`);
    await dragChart(a.x1 + 40, gy, a.x1 + 40 + 20, gy + 50, ['Shift']);   // top edge again (price unchanged by the first drag)
    const c = await geomOf(0);
    const dt2 = c.t1 !== a.t1, dp2 = Math.abs(c.p1 - a.p1) > 1e-9;
    report('G15-vertical', !dt2 && dp2 && Math.abs(c.y1 - a.y1 - 50) < 3, `Shift-drag by (+20,+50)px: time changed=${dt2}, price changed=${dp2} (y1 ${a.y1.toFixed(1)}->${c.y1.toFixed(1)})`);
  }

  // ================= G18 Ctrl-drag clones =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 40);
    const o = await geomOf(0);
    await dragChart(xa + 75, ya + 20, xa + 75 + 50, ya + 20 + 30, ['Control']);
    const r = await page.evaluate(() => ({ n: drawings.length, sel: selDrawing === drawings[1], ids: drawings.map(d => d.id) }));
    const o2 = await geomOf(0), c = await geomOf(1);
    report('G18', r.n === 2 && o2.t1 === o.t1 && o2.p1 === o.p1 && o2.t2 === o.t2 && c && Math.abs(c.x1 - o.x1 - 50) < 3 && Math.abs(c.y1 - o.y1 - 30) < 3 && r.sel && r.ids[0] !== r.ids[1],
      `Ctrl-drag (+50,+30): drawings=${r.n}; original unchanged=${o2.t1 === o.t1 && o2.p1 === o.p1}; clone x1 ${o.x1.toFixed(1)}->${c && c.x1.toFixed(1)} y1 ${o.y1.toFixed(1)}->${c && c.y1.toFixed(1)}; clone selected=${r.sel}; distinct ids=${r.ids[0] !== r.ids[1]}`);
  }

  // ================= G19 Ctrl+click multiselect / G20 group move + delete =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 20);
    await drawTL(xa, ya + 120, xa + 150, ya + 140);
    await clickChart(xa + 75, ya + 10);                 // select A
    await clickChart(xa + 75, ya + 130, ['Control']);   // add B
    const s1 = await page.evaluate(() => ({ size: selSet.size, sel: selDrawing === drawings[1] }));
    const a0 = await geomOf(0), b0 = await geomOf(1);
    await dragChart(xa + 75, ya + 10, xa + 75 + 40, ya + 10 + 25);   // drag A -> both move
    const a1 = await geomOf(0), b1 = await geomOf(1);
    const both = Math.abs(a1.x1 - a0.x1 - 40) < 3 && Math.abs(b1.x1 - b0.x1 - 40) < 3 && Math.abs(a1.y1 - a0.y1 - 25) < 3 && Math.abs(b1.y1 - b0.y1 - 25) < 3;
    const s2 = await page.evaluate(() => selSet.size);
    await clickChart(a1.x1 + 75, (a1.y1 + a1.y2) / 2, ['Control']);   // Ctrl+click a member again -> removed from the set
    const s3 = await page.evaluate(() => ({ size: selSet.size, sel: selDrawing && selDrawing === drawings[1] }));
    await clickChart(a1.x1 + 75, (a1.y1 + a1.y2) / 2, ['Control']);   // back in
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    const n = await page.evaluate(() => drawings.length);
    report('G19', s1.size === 2 && s1.sel && s3.size === 1 && s3.sel && n === 0, `A + Ctrl-click B: selSet.size=${s1.size} primary=B ${s1.sel}; Ctrl-click A again: size=${s3.size} primary=B ${s3.sel}; Ctrl-click A + Delete -> drawings=${n}`);
    report('G20', both && s2 === 2, `group drag (+40,+25)px with 2 selected: A dx=${(a1.x1 - a0.x1).toFixed(1)} dy=${(a1.y1 - a0.y1).toFixed(1)}, B dx=${(b1.x1 - b0.x1).toFixed(1)} dy=${(b1.y1 - b0.y1).toFixed(1)}; selSet after drag=${s2}`);
  }

  // ================= G43 Lock all: select ok, drag blocked =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 40);
    await clickChart(geo.W * 0.5, geo.H * 0.9);
    await page.click('#btnLockDrw');
    const st = await page.evaluate(() => ({ locked: drawingsLocked, stored: localStorage.getItem('rt_lockdrw'), active: document.getElementById('btnLockDrw').classList.contains('active') }));
    const o = await geomOf(0);
    await dragChart(xa + 75, ya + 20, xa + 75 + 50, ya + 20 + 30);
    const r = await page.evaluate(() => ({ sel: selDrawing && selDrawing.type, tb: !document.getElementById('drawToolbar').hidden }));
    const a = await geomOf(0);
    await dragChart(o.x1, o.y1, o.x1 + 30, o.y1 + 30);   // anchor drag is blocked too
    const a2 = await geomOf(0);
    await page.click('#btnLockDrw');
    const unl = await page.evaluate(() => drawingsLocked);
    report('G43', st.locked && st.stored === 'true' && st.active && r.sel === 'tl' && a.t1 === o.t1 && a.p1 === o.p1 && a2.t1 === o.t1 && a2.p1 === o.p1 && !unl,
      `lock on: drawingsLocked=${st.locked} persisted=${st.stored} btn active=${st.active}; body drag -> selected=${r.sel} toolbar shown=${r.tb} moved=${a.t1 !== o.t1 || a.p1 !== o.p1}; anchor drag moved=${a2.t1 !== o.t1 || a2.p1 !== o.p1}; unlocked=${!unl}`);
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
    const above = tb.bbox && tb.r.bottom <= r0.top + tb.bbox.y0 + 1;
    await page.evaluate(() => { const c = document.getElementById('dtColor'); c.value = '#ff00ff'; c.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => { document.getElementById('dtWidth').value = '3'; document.getElementById('dtWidth').dispatchEvent(new Event('change')); document.getElementById('dtDash').value = '1'; document.getElementById('dtDash').dispatchEvent(new Event('change')); });
    await paint();
    const st = await page.evaluate(() => ({ color: drawings[0].style.color, legacy: drawings[0].color, width: drawings[0].style.width, dash: drawings[0].style.dash, stored: JSON.parse(localStorage.getItem('rt_drawings'))[0].style }));
    const g = await geomOf(0);
    let magenta = false; for (let i = 0.2; i <= 0.8 && !magenta; i += 0.05) magenta = await page.evaluate(([x, y]) => window.__colorNear('chart', x, y, 'r > 200 && g < 90 && b > 200', 2), [g.x1 + (g.x2 - g.x1) * i, g.y1 + (g.y2 - g.y1) * i]);
    // lock via toolbar
    await page.click('#dtLock');
    const lk = await page.evaluate(() => ({ locked: drawings[0].locked, icon: document.querySelector('#dtLock span').textContent }));
    await dragChart(g.x1 + 75, (g.y1 + g.y2) / 2, g.x1 + 75 + 40, (g.y1 + g.y2) / 2 + 40);
    const g2 = await geomOf(0);
    await page.click('#dtLock');
    // pan the selection off-screen -> toolbar hides, no errors
    const e0 = errs.length;
    await page.evaluate(() => { const vr = chart.timeScale().getVisibleLogicalRange(); chart.timeScale().setVisibleLogicalRange({ from: vr.from - 2500, to: vr.to - 2500 }); });
    await page.waitForTimeout(300); await paint();
    const off = await page.evaluate(() => ({ hidden: document.getElementById('drawToolbar').hidden, st: window.__drwDbg.toolbar, sel: !!selDrawing, bb: window.__drwDbg.bbox }));
    await page.evaluate(() => window.__rt.fit()); await page.waitForTimeout(300); await paint();
    const back = await page.evaluate(() => ({ hidden: document.getElementById('drawToolbar').hidden, st: window.__drwDbg.toolbar }));
    // delete via toolbar
    await page.click('#dtDelete'); await page.waitForTimeout(150); await paint();
    const del = await page.evaluate(() => ({ n: drawings.length, hidden: document.getElementById('drawToolbar').hidden }));
    report('G13', vis && !tb.hidden && inside && above && st.color === '#ff00ff' && st.legacy === '#ff00ff' && st.width === 3 && st.dash === 1 && st.stored.color === '#ff00ff' && magenta && lk.locked && lk.icon === 'lock' && g2.t1 === g.t1 && g2.p1 === g.p1 && off.hidden && off.st === 'hidden' && off.sel && !back.hidden && errs.length === e0 && del.n === 0 && del.hidden,
      `select -> visible=${vis} inside chart=${inside} above bbox=${above} (tb bottom ${tb.r.bottom.toFixed(0)} vs bbox top ${tb.bbox && (r0.top + tb.bbox.y0).toFixed(0)}); color -> style=${st.color} legacy=${st.legacy} width=${st.width} dash=${st.dash} persisted=${st.stored.color} magenta ink on line=${magenta}; lock btn -> locked=${lk.locked} icon=${lk.icon} drag moved=${g2.t1 !== g.t1}; scrolled off-screen -> hidden=${off.hidden} state=${off.st} still selected=${off.sel} errors=${errs.length - e0}; fit -> shown=${!back.hidden}; delete btn -> n=${del.n} hidden=${del.hidden}`);
  }

  // ================= G17 colour change reaches fib / measure / rr renderers; dblclick opens Settings =================
  await clear();
  {
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 12].time], k);
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5));
    const res = {};
    for (const [type, d] of [['fib', { type: 'fib', p1: { t: ts[0], p: pm - 12 }, p2: { t: ts[1], p: pm + 12 }, color: '#CC4400' }], ['measure', { type: 'measure', p1: { t: ts[0], p: pm + 6 }, p2: { t: ts[1], p: pm - 6 }, color: '' }], ['rr', { type: 'rr', p1: { t: ts[0], p: pm }, stop: pm - 10, target: pm + 20, color: '' }]]) {
      await seed([d]); await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); }); await paint();
      const pts = await page.evaluate((type) => { const d = drawings[0], X = drawX, Y = drawY; if (type === 'fib') { const g = fibGeom(d, X, document.getElementById('chart').clientWidth); const y = Y(g.p0 + g.span * 0.618); return [[g.xL + 40, y], [g.xL + 60, y], [g.xL + 80, y]]; } if (type === 'measure') { const x1 = X(d.p1.t), y1 = Y(d.p1.p), x2 = X(d.p2.t), y2 = Y(d.p2.p); return [0.3, 0.5, 0.7].map(f => [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f]); } const { xa } = rrRange(d, X), ym = (Y(d.p1.p) + Y(d.target)) / 2; return [-1, 0, 1].map(o => [xa + o, ym]); }, type);
      const test = type === 'rr' ? 'r > 140 && b > 140 && r - g > 60' : 'r > 200 && g < 90 && b > 200';   // rr border is a .45-alpha 1px stroke at a fractional x over the zone fills -> test for a magenta tint (the default grey border has r ~= g)
      const before = await page.evaluate(([pts, test]) => pts.some(([x, y]) => window.__colorNear('chart', x, y, test, 1)), [pts, test]);
      await page.evaluate(() => { const c = document.getElementById('dtColor'); c.value = '#ff00ff'; c.dispatchEvent(new Event('input', { bubbles: true })); }); await paint();
      const after = await page.evaluate(([pts, test]) => pts.some(([x, y]) => window.__colorNear('chart', x, y, test, 1)), [pts, test]);
      res[type] = { before, after, color: await page.evaluate(() => drawings[0].style.color) };
    }
    const ok = ['fib', 'measure', 'rr'].every(t => !res[t].before && res[t].after && res[t].color === '#ff00ff');
    report('G17-recolor', ok, ['fib', 'measure', 'rr'].map(t => `${t}: magenta before=${res[t].before} after=${res[t].after} style.color=${res[t].color}`).join('; '));
    await clear();
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 150, ya + 40);
    await clickChart(geo.W * 0.5, geo.H * 0.9);
    const r = await chartRect(); await page.mouse.dblclick(r.left + xa + 75, r.top + ya + 20); await page.waitForTimeout(300);
    const ds = await page.evaluate(() => ({ open: document.getElementById('drawSettings').classList.contains('open'), tabs: [...document.querySelectorAll('#drawSettings .ds-tab')].map(b => b.textContent), sel: selDrawing && selDrawing.type }));
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    const closed = await page.evaluate(() => !document.getElementById('drawSettings').classList.contains('open') && !!selDrawing);
    report('G17-dblclick', ds.open && ds.tabs.join(',') === 'Style,Coordinates,Visibility' && ds.sel === 'tl' && closed, `dblclick body -> settings open=${ds.open} tabs=${ds.tabs.join('/')} selected=${ds.sel}; Esc closes (selection kept)=${closed}`);
  }

  // ================= G34 trend line extend + arrowheads =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.4;
    await drawTL(xa, ya, xa + 150, ya + 30);
    await clickChart(geo.W * 0.5, geo.H * 0.95);
    const g = await geomOf(0);
    const slope = (g.y2 - g.y1) / (g.x2 - g.x1), yAt = (x) => g.y1 + slope * (x - g.x1);
    const leftBefore = await page.evaluate(([x, y]) => ({ ink: window.__ptInk('chart', x, y, 1), hit: drawingAt(x, y) && drawingAt(x, y).type }), [g.x1 - 60, yAt(g.x1 - 60)]);
    await page.evaluate(() => { drawings[0].extend = 'both'; drawings[0].arrowEnd = true; saveJSON('rt_drawings', drawings); repaintOverlays(); }); await paint();
    const leftAfter = await page.evaluate(([x, y]) => ({ ink: window.__ptInk('chart', x, y, 1), hit: drawingAt(x, y) && drawingAt(x, y).type }), [g.x1 - 60, yAt(g.x1 - 60)]);
    const rightAfter = await page.evaluate(([x, y]) => ({ ink: window.__ptInk('chart', x, y, 1), hit: drawingAt(x, y) && drawingAt(x, y).type }), [g.x2 + 80, yAt(g.x2 + 80)]);
    await page.evaluate(() => { drawings[0].extend = 'none'; repaintOverlays(); }); await paint();
    const a = Math.atan2(g.y2 - g.y1, g.x2 - g.x1), w = Math.PI / 7, wing = [g.x2 - 8 * Math.cos(a - 0.6 * w), g.y2 - 8 * Math.sin(a - 0.6 * w)];   // inside the arrowhead triangle, ~2px off the line
    const arrow = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 0), wing);
    await page.evaluate(() => { drawings[0].arrowEnd = false; repaintOverlays(); }); await paint();
    const noArrow = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 0), wing);
    report('G34', !leftBefore.ink && !leftBefore.hit && leftAfter.ink && leftAfter.hit === 'tl' && rightAfter.ink && rightAfter.hit === 'tl' && arrow && !noArrow,
      `60px left of p1: before extend ink=${leftBefore.ink} hit=${leftBefore.hit}; extend=both ink=${leftAfter.ink} hit=${leftAfter.hit}; 80px right of p2 ink=${rightAfter.ink} hit=${rightAfter.hit}; arrowEnd wing ink=${arrow} -> off=${noArrow}`);
  }

  // ================= G39 rectangle extend + middle line =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 120, ya + 80, [], 'drwBox');
    await clickChart(geo.W * 0.5, geo.H * 0.95);
    const g = await geomOf(0), top = Math.min(g.y1, g.y2), ym = (g.y1 + g.y2) / 2, xm = (g.x1 + g.x2) / 2;
    const b4 = await page.evaluate(([x, y, xm, ym]) => ({ right: window.__ptInk('chart', x, y, 1), mid: window.__ptInk('chart', xm, ym, 1), midHit: drawingAt(xm, ym) && drawingAt(xm, ym).type }), [geo.W - 90, top, xm, ym]);
    await page.evaluate(() => { drawings[0].extendRight = true; drawings[0].middleLine = true; saveJSON('rt_drawings', drawings); repaintOverlays(); }); await paint();
    const af = await page.evaluate(([x, y, xm, ym]) => ({ right: window.__ptInk('chart', x, y, 1), rightHit: drawingAt(x, y) && drawingAt(x, y).type, mid: window.__ptInk('chart', xm, ym, 1), midHit: drawingAt(xm, ym) && drawingAt(xm, ym).type }), [geo.W - 90, top, xm, ym]);
    report('G39', !b4.right && !b4.mid && !b4.midHit && af.right && af.rightHit === 'box' && af.mid && af.midHit === 'box',
      `top edge at x=W-90: before=${b4.right} after extendRight=${af.right} hit=${af.rightHit}; middle line at box centre: before=${b4.mid}/${b4.midHit} after=${af.mid} hit=${af.midHit}`);
  }

  // ================= G40 fib defaults + levels + reverse + extend =================
  await clear();
  {
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 12].time], k);
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5));
    await seed([{ type: 'fib', p1: { t: ts[0], p: pm - 15 }, p2: { t: ts[1], p: pm + 15 }, color: '#CC4400' }]); await paint();
    const def = await page.evaluate(() => ({ lv: fibLevels(drawings[0]).map(f => f.lv), stored: drawings[0].fibLevels }));
    const y05 = await page.evaluate(() => ({ y: drawY(drawings[0].p1.p + (drawings[0].p2.p - drawings[0].p1.p) * 0.5), xL: fibGeom(drawings[0], drawX, 9999).xL, xR: fibGeom(drawings[0], drawX, 9999).xR, y236: drawY(drawings[0].p1.p + (drawings[0].p2.p - drawings[0].p1.p) * 0.236) }));
    const FIBC = 'r > 180 && g > 40 && g < 130 && b < 90';   // #CC4400 (fib default) — not candle red (g=0) / green / black
    const half0 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL + 30, y05.y, FIBC]);
    // level labels sit LEFT of the band since final-fix round 1 -> probe 160px left of xL, beyond the label text
    const left0 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL - 160, y05.y236, FIBC]);
    await page.evaluate(() => { drawings[0].fibLevels = [0.236, 0.382, 0.5, 0.618, 1]; repaintOverlays(); }); await paint();
    const half1 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL + 30, y05.y, FIBC]);
    await page.evaluate(() => { drawings[0].reverse = true; repaintOverlays(); }); await paint();
    const rev = await page.evaluate((t) => { const d = drawings[0]; const y = drawY(d.p2.p + (d.p1.p - d.p2.p) * 0.236); return { y, ink: window.__colorNear('chart', fibGeom(d, drawX, 9999).xL + 30, y, t, 1) }; }, FIBC);
    await page.evaluate(() => { drawings[0].reverse = false; drawings[0].extendLeft = true; repaintOverlays(); }); await paint();
    const left1 = await page.evaluate(([x, y, t]) => window.__colorNear('chart', x, y, t, 1), [y05.xL - 160, y05.y236, FIBC]);
    const hitL = await page.evaluate(([x, y]) => drawingAt(x, y) && drawingAt(x, y).type, [y05.xL - 40, y05.y236]);
    report('G40', def.lv.join(',') === '0.236,0.382,0.618,1' && def.stored == null && !half0 && half1 && Math.abs(rev.y - y05.y236) > 20 && rev.ink && !left0 && left1 && hitL === 'fib',
      `default levels=${def.lv.join('/')} (fibLevels stored=${def.stored}); 0.5 line ink before=${half0} after adding=${half1}; reverse: 0.236 y ${y05.y236.toFixed(0)}->${rev.y.toFixed(0)} ink=${rev.ink}; extendLeft: ink 160px left of xL (beyond the ~95px level label, which now sits left of the band) before=${left0} after=${left1} hit=${hitL}`);
  }

  // ================= G41 coordinates tab (bar number + price, future allowed) =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 100, ya + 30);
    await page.evaluate(() => { selectDrawing(drawings[0], false); openDrawSettings(drawings[0], 'coords'); });
    const inputs = await page.evaluate(() => [...document.querySelectorAll('#drawSettings [data-k]')].map(i => ({ k: i.dataset.k, v: i.value })));
    const before = await geomOf(0);
    const target = geo.nBars + 10;   // beyond the last bar in the data set -> future space
    await page.evaluate((v) => { const i = document.querySelector('#drawSettings [data-k="t:p2"]'); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); const p = document.querySelector('#drawSettings [data-k="p:p1"]'); p.value = String((+p.value) + 7.5); p.dispatchEvent(new Event('input', { bubbles: true })); }, target);
    await paint();
    const after = await page.evaluate(() => { const d = drawings[0]; return { t2: d.p2.t, p1: d.p1.p, lastT: bars[bars.length - 1].time, bar2: timeToLogical(d.p2.t) + seriesFrom, stored: JSON.parse(localStorage.getItem('rt_drawings'))[0].p2.t, ok: window.__drw.ok }; });
    await page.evaluate(() => closeDrawSettings());
    report('G41', inputs.some(i => i.k === 't:p1') && inputs.some(i => i.k === 'p:p2') && after.t2 > after.lastT && Math.abs(after.bar2 - target) < 0.01 && Math.abs(after.p1 - before.p1 - 7.5) < 0.01 && after.stored === after.t2 && after.ok,
      `inputs=${inputs.map(i => i.k).join(',')}; bar# p2 -> ${target}: p2.t=${after.t2} > last bar ${after.lastT} (bar# back=${after.bar2.toFixed(2)}); price p1 ${before.p1}->${after.p1}; persisted=${after.stored === after.t2} __drw.ok=${after.ok}`);
  }

  // ================= G42 visibility per timeframe (continue not return) =================
  await clear();
  {
    const xa = await barX(k), ya = geo.H * 0.3;
    await drawTL(xa, ya, xa + 100, ya + 30);            // A: will be limited to 5m
    await drawTL(xa, ya + 100, xa + 100, ya + 130);     // B: always visible, selected -> handles must survive
    await page.evaluate(() => { drawings[0].visibleTFs = [5]; selectDrawing(drawings[1], false); saveJSON('rt_drawings', drawings); repaintOverlays(); });
    const dbg = await paint();
    const gA = await geomOf(0), gB = await geomOf(1);
    const inkA = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [(gA.x1 + gA.x2) / 2, (gA.y1 + gA.y2) / 2]);
    const inkB = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [(gB.x1 + gB.x2) / 2, (gB.y1 + gB.y2) / 2]);
    const hitA = await page.evaluate(([x, y]) => drawingAt(x, y) && drawingAt(x, y).type, [(gA.x1 + gA.x2) / 2, (gA.y1 + gA.y2) / 2]);
    await page.evaluate(() => { drawings[0].visibleTFs = [tf]; repaintOverlays(); }); const dbg2 = await paint();
    const inkA2 = await page.evaluate(([x, y]) => window.__ptInk('chart', x, y, 1), [(gA.x1 + gA.x2) / 2, (gA.y1 + gA.y2) / 2]);
    // Visibility tab: unchecking "All timeframes" limits to the current tf; re-checking clears
    await page.evaluate(() => { drawings[0].visibleTFs = null; openDrawSettings(drawings[0], 'vis'); const a = document.querySelector('#drawSettings [data-k="v:all"]'); a.checked = false; a.dispatchEvent(new Event('change', { bubbles: true })); });
    const v1 = await page.evaluate(() => JSON.stringify(drawings[0].visibleTFs));
    await page.evaluate(() => { const a = document.querySelector('#drawSettings [data-k="tf:5"]'); a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); });
    const v2 = await page.evaluate(() => JSON.stringify(drawings[0].visibleTFs));
    await page.evaluate(() => { const a = document.querySelector('#drawSettings [data-k="v:all"]'); a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); closeDrawSettings(); });
    const v3 = await page.evaluate(() => drawings[0].visibleTFs);
    report('G42', geo.tf !== 5 && dbg.drawn === 1 && !inkA && inkB && !hitA && dbg.handles === 2 && dbg2.drawn === 2 && inkA2 && v1 === `[${geo.tf}]` && v2 === `[${[geo.tf, 5].sort((a, b) => a - b).join(',')}]` && v3 === null,
      `tf=${geo.tf}: A visibleTFs=[5] -> drawn=${dbg.drawn} A ink=${inkA} hit=${hitA}; B ink=${inkB} handles=${dbg.handles}; A visibleTFs=[tf] -> drawn=${dbg2.drawn} ink=${inkA2}; panel: uncheck All -> ${v1}, +5m -> ${v2}, All -> ${v3}`);
  }

  // ================= REGRESSIONS: trading hotkeys, annotation tools, keep drawing, __drw health =================
  await clear();
  {
    await page.keyboard.press('f'); await page.waitForTimeout(150);
    const eo = await page.evaluate(() => window.__rt.entryOrderInfo());
    await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    await page.keyboard.press('b'); await page.waitForTimeout(150);
    const pos = await page.evaluate(() => window.__rt.state().pos);
    await page.keyboard.press('x'); await page.waitForTimeout(150);
    const flat = await page.evaluate(() => window.__rt.state().pos);
    const n0 = await page.evaluate(() => window.__rt.annCount());
    await page.click('#annUp'); await clickChart(await barX(k), geo.H * 0.5);
    const n1 = await page.evaluate(() => ({ n: window.__rt.annCount(), tool }));
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(); });
    const health = await page.evaluate(() => ({ ok: window.__drw && window.__drw.ok, err: window.__drw && window.__drw.err }));
    report('REGRESSION', eo && eo.side === 'long' && eo.kind === 'stop' && pos && pos.side === 'long' && !flat && n1.n === n0 + 1 && n1.tool === '' && health.ok && !health.err && errs.length === 0,
      `F -> ${eo && eo.side + ' ' + eo.kind}; B -> pos=${pos && pos.side}; X -> flat=${!flat}; annUp click -> annotations ${n0}->${n1.n} tool='${n1.tool}'; __drw.ok=${health.ok} err=${health.err}; console errors=${errs.length} ${errs.slice(0, 3).join(' | ')}`);
  }
} catch (e) {
  console.log('FAIL EXCEPTION — ' + (e && e.stack || e));
  results.push(false);
} finally {
  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} PASS${errs.length ? `\nconsole errors: ${errs.join(' | ')}` : ''}`);
  process.exit(pass === results.length ? 0 : 1);
}
