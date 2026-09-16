// Fib retracement label legibility (final fix round 1, finding #1): tight retracement (46px anchor gap), wide control,
// and the Extend-left fallback. Asserts, by pixel scan of the label column, that the 4 default level labels are
// 4 separate ink runs (not merged) and that the dashed anchor connector does not cross the label column.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/qa_fib_labels.mjs
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');
const URL = 'http://127.0.0.1:5560/?r=' + Date.now();
const OUT = 'D:/Tools/replay-trainer/exports/qa/';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
let fails = 0; const report = (id, ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${msg}`); };
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const clickChart = async (x, y) => { const r = await chartRect(); await page.mouse.click(r.left + x, r.top + y); await page.waitForTimeout(600); };
const clear = () => page.evaluate(() => { drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); repaintOverlays(); });
// count vertical runs of fib-coloured ink (brand orange #CC4400 family) in column x between y0..y1
const runs = (x, y0, y1) => page.evaluate(([x, y0, y1]) => {
  const root = document.getElementById('chart'), rr = root.getBoundingClientRect();
  const cs = [...root.querySelectorAll('canvas')].map(c => ({ c, r: c.getBoundingClientRect() })).filter(o => o.r.width > rr.width * 0.5).map(o => ({ ctx: o.c.getContext('2d'), ox: o.r.left - rr.left, oy: o.r.top - rr.top, sx: o.c.width / o.r.width, sy: o.c.height / o.r.height, w: o.c.width, h: o.c.height }));
  const ink = (px, py) => cs.some(({ ctx, ox, oy, sx, sy, w, h }) => { const X = Math.round((px - ox) * sx), Y = Math.round((py - oy) * sy); if (X < 0 || Y < 0 || X >= w || Y >= h) return false; for (let dx = -3; dx <= 3; dx++) { const d = ctx.getImageData(Math.min(w - 1, Math.max(0, X + dx)), Y, 1, 1).data; if (d[3] > 80 && d[0] > 150 && d[1] > 30 && d[1] < 140 && d[2] < 110) return true; } return false; });
  const out = []; let cur = null;
  for (let y = y0; y <= y1; y++) { const on = ink(x, y); if (on && !cur) cur = { a: y, b: y }; else if (on) cur.b = y; else if (cur) { out.push(cur); cur = null; } }
  if (cur) out.push(cur);
  const m = []; for (const r of out) { const p = m[m.length - 1]; if (p && r.a - p.b - 1 <= 3) p.b = r.b; else m.push({ ...r }); } return m;   // merge glyph-interior gaps (<=3px); inter-label gaps are >=5px
}, [x, y0, y1]);
const layout = () => page.evaluate(() => { const d = drawings[0], W = document.getElementById('chart').clientWidth, g = fibGeom(d, drawX, W); const ys = fibLevels(d).map(f => drawY(g.p0 + g.span * f.lv)); return { xL: g.xL, xR: g.xR, xa: g.xa, xb: g.xb, y1: drawY(d.p1.p), y2: drawY(d.p2.p), ys, W }; });
const zoom = async (name, x, y, w, h) => { const r = await chartRect(); await page.screenshot({ path: OUT + name, clip: { x: r.left + x, y: r.top + y, width: w, height: h } }); };

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_magnet', '"off"'); localStorage.setItem('rt_keepdraw', 'false'); localStorage.setItem('rt_lockdrw', 'false'); });
  await page.goto(URL + '1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 200 && idx > 100, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx }));
  const xa = await page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), geo.idx - 60), ya = geo.H * 0.38;

  // ---- 1. tight retracement: exact repro from the finding (46px vertical gap between anchors) ----
  await clear(); await page.click('#drwFib'); await clickChart(xa, ya); await clickChart(xa + 110, ya + 65);
  let L = await layout(); await clickChart((L.xa + L.xb) / 2, (L.y1 + L.y2) / 2); await page.waitForTimeout(200);   // select -> handles + toolbar visible
  const sel = await page.evaluate(() => selDrawing && selDrawing.type);
  await page.screenshot({ path: OUT + 'drawing_fib.png' });
  await zoom('zoom_fib_labels.png', L.xL - 130, Math.min(...L.ys) - 40, 320, 130);
  const gapPx = Math.abs(L.y2 - L.y1).toFixed(1), colX = Math.round(L.xL - 30);
  let r1 = await runs(colX, Math.min(...L.ys) - 30, Math.max(...L.ys) + 30);
  const gaps1 = r1.slice(1).map((r, i) => r.a - r1[i].b - 1);
  report('FIB-TIGHT', sel === 'fib' && r1.length === 4 && gaps1.every(g => g >= 2), `anchor gap=${gapPx}px, level ys=${L.ys.map(v => v.toFixed(1)).join('/')}; label column x=${colX} (left of xL=${L.xL.toFixed(1)}) has ${r1.length} separate ink runs ${JSON.stringify(r1)}, white gaps between them=${gaps1.join('/')}px (need 4 runs, every gap>=2)`);
  // the dashed connector (xa,y1)->(xb,y2) lies inside [xL,xR]; the label column must carry no ink from it -> ink runs must each be glyph-height (<=11px)
  report('FIB-NO-STRIKE', r1.every(r => r.b - r.a + 1 <= 11), `every label run is glyph-sized (heights=${r1.map(r => r.b - r.a + 1).join('/')}px, <=11) => no line/connector crossing the text; connector spans x ${L.xa.toFixed(0)}..${L.xb.toFixed(0)} which is right of the label column`);
  // level lines still start at xL (labels moved out, lines untouched)
  const lineInk = await runs(Math.round(L.xL + 20), Math.min(...L.ys) - 2, Math.max(...L.ys) + 2);
  report('FIB-LINES', lineInk.length === 4, `inside the band (x=xL+20) the 4 level lines are 4 ink runs: ${JSON.stringify(lineInk)}`);

  // ---- 2. wide control (15% -> 75% of chart height): labels stay on their own level (no spreading needed) ----
  await clear(); await page.click('#drwFib'); await clickChart(xa, geo.H * 0.15); await clickChart(xa + 110, geo.H * 0.75);
  L = await layout(); await page.screenshot({ path: OUT + 'drawing_fib_wide.png' });
  const r2 = await runs(Math.round(L.xL - 30), Math.min(...L.ys) - 30, Math.max(...L.ys) + 30);
  const centred = r2.length === 4 && r2.every((r, i) => { const c = (r.a + r.b) / 2; return L.ys.slice().sort((a, b) => a - b).some(y => Math.abs(y - c) <= 3); });
  report('FIB-WIDE', centred, `anchor gap=${Math.abs(L.y2 - L.y1).toFixed(0)}px; ${r2.length} label runs, each centred within 3px of its level line (${centred}) runs=${JSON.stringify(r2)} ys=${L.ys.map(v => v.toFixed(1)).join('/')}`);

  // ---- 3. Extend-left: no room on the left -> labels fall back inside the band with a white backing so the line/connector don't strike through ----
  await clear(); await page.click('#drwFib'); await clickChart(xa, ya); await clickChart(xa + 110, ya + 65);
  await page.evaluate(() => { drawings[0].extendLeft = true; repaintOverlays(); }); await page.waitForTimeout(300);
  L = await layout();
  await zoom('zoom_fib_labels_extleft.png', 0, Math.min(...L.ys) - 40, 320, 130);
  const r3 = await runs(30, Math.min(...L.ys) - 30, Math.max(...L.ys) + 30);
  const gaps3 = r3.slice(1).map((r, i) => r.a - r3[i].b - 1);
  report('FIB-EXTLEFT', L.xL === 0 && r3.length === 4 && gaps3.every(g => g >= 2), `xL=${L.xL}; label column x=30 (inside band) has ${r3.length} separate runs ${JSON.stringify(r3)}, gaps=${gaps3.join('/')}px`);

  // ---- 4. preview while placing (rubber-band) uses the same renderer and must not throw ----
  await clear(); await page.click('#drwFib'); await clickChart(xa, ya);
  const r = await chartRect(); await page.mouse.move(r.left + xa + 60, r.top + ya + 30); await page.waitForTimeout(200);
  const prev = await page.evaluate(() => ({ pending: !!pendingPt, preview: !!previewXY, tool }));
  await page.keyboard.press('Escape'); await clear();
  report('FIB-PREVIEW', prev.pending && prev.preview && prev.tool === 'fib' && errs.length === 0, `pendingPt=${prev.pending} previewXY=${prev.preview} tool=${prev.tool}; page errors=${errs.length} ${errs.slice(0, 3).join(' | ')}`);
  console.log(`DONE fails=${fails} errors=${errs.length}`);
} catch (e) { console.log('EXCEPTION ' + (e && e.stack || e)); fails++; } finally { await browser.close(); }
process.exit(fails ? 1 : 0);
