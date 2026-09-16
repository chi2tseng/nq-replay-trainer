// TV drawing parity — Stage 4 acceptance (TV_DRAWING_GAP.md Stage 4: G21-G33, G44, G45, G46, G48 + hotkey regressions).
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/tv_drawing_stage4.mjs
// Prints one PASS/FAIL line per rule id. Needs the local server on http://127.0.0.1:5560/.
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/?r=' + Date.now();
const results = [];
const report = (id, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };
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
    window.__ptInk = (rootId, x, y, rad = 2) => { const cs = canvases(rootId); for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) if (isInk(rgbAt(cs, x + dx, y + dy))) return true; return false; };
    // count dark pixels along a horizontal scan line (y) between x0..x1 — an hl / box edge lights up the whole row, candles only a few columns
    window.__rowInk = (rootId, y, x0, x1) => { const cs = canvases(rootId); let best = 0; for (let dy = -2; dy <= 2; dy++) { let n = 0; for (let x = x0; x < x1; x += 2) if (isInk(rgbAt(cs, x, y + dy))) n++; best = Math.max(best, n); } return best; };   // max over 5 rows: the 1.5px line is centred at n+0.75
  });
}
const clear = async () => page.evaluate(() => { drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); drawingsLocked = false; lockBtnUI(); undoStack.length = 0; redoStack.length = 0; if ($('drawSettings').classList.contains('open')) closeDrawSettings(); repaintOverlays(); });
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const clickChart = async (x, y, mods = [], button = 'left') => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(r.left + x, r.top + y, { button }); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(650); };
const dragChart = async (x1, y1, x2, y2, mods = []) => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.move(r.left + x1, r.top + y1); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(r.left + x1 + (x2 - x1) * i / 8, r.top + y1 + (y2 - y1) * i / 8); await page.waitForTimeout(60); await page.mouse.up(); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(300); };
const paint = () => page.evaluate(() => new Promise(res => { repaintOverlays(); requestAnimationFrame(() => requestAnimationFrame(() => res(window.__drwDbg))); }));
const seed = (list) => page.evaluate((list) => { drawings.length = 0; for (const d of list) drawings.push(newDrawing(d)); clearSelection(); saveJSON('rt_drawings', drawings); repaintOverlays(); }, list);
const geomOf = (i) => page.evaluate((i) => { const d = drawings[i]; if (!d) return null; return { type: d.type, t1: d.p1.t, p1: d.p1.p, t2: d.p2 && d.p2.t, p2: d.p2 && d.p2.p, x1: drawX(d.p1.t), y1: drawY(d.p1.p), x2: d.p2 ? drawX(d.p2.t) : null, y2: d.p2 ? drawY(d.p2.p) : null }; }, i);
const drawTL = async (x1, y1, x2, y2, tool = 'drwTL') => { await page.click('#' + tool); await clickChart(x1, y1); await clickChart(x2, y2); };
const n = () => page.evaluate(() => drawings.length);
const key = async (combo) => { await page.keyboard.press(combo); await page.waitForTimeout(120); };
const st = () => page.evaluate(() => ({ tool, entry: entryOrder && { side: entryOrder.side, kind: entryOrder.kind }, pos: position && position.side, idx, sess: currentSessionIdx() }));

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); localStorage.setItem('rt_annotations', '[]'); localStorage.setItem('rt_magnet', '"off"'); localStorage.setItem('rt_lockdrw', 'false'); localStorage.setItem('rt_keepdraw', 'false'); localStorage.removeItem('rt_hide'); localStorage.removeItem('rt_alwaysrmlocked'); });
  await load();
  await page.mouse.move(5, 5);
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx, tf, nBars: bars.length }));
  const k = geo.idx - 40;

  // ================= G48 leftbar inventory + clean load =================
  {
    const inv = await page.evaluate(() => ['toolCursor', 'btnMagnet', 'btnMagnetMenu', 'btnKeepDraw', 'btnLockDrw', 'btnHideDrw', 'btnHideMenu', 'drwClear', 'btnRemoveMenu', 'hidePopover', 'removePopover', 'rmAlwaysLocked'].map(id => [id, !!document.getElementById(id)]));
    const missing = inv.filter(([, ok]) => !ok).map(([id]) => id);
    const ok = await page.evaluate(() => window.__drw && window.__drw.ok);
    report('LOAD', errs.length === 0, `console errors=${errs.length} ${errs.slice(0, 2).join(' | ')}; __drw.ok=${ok} (undefined until the first drawing exists — the primitive returns early on an empty list)`);
    report('G48', missing.length === 0, `leftbar: cursor / magnet(+menu) / keep drawing / lock / hide(+menu) / remove(+menu) all present; missing=[${missing.join(',')}]`);
  }

  // ================= G21 / G22 undo + redo (create, delete, and DRAG) =================
  await clear();
  {
    for (let i = 0; i < 3; i++) { await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * (0.3 + i * 0.1)); }
    const n3 = await n();
    await key('Control+z'); await key('Control+z'); const n1 = await n();
    await key('Control+y'); const n2 = await n();
    report('G21-G22-create', n3 === 3 && n1 === 1 && n2 === 2, `drew 3 hl -> ${n3}; Ctrl+Z x2 -> ${n1}; Ctrl+Y -> ${n2}`);
    // drag: snapshot must be taken at pointerdown, so Ctrl+Z restores the PRE-drag coordinates
    await clear();
    const xa = await barX(k), xb = await barX(k + 14);
    await drawTL(xa, geo.H * 0.35, xb, geo.H * 0.55);
    const before = await geomOf(0);
    const mx = (before.x1 + before.x2) / 2, my = (before.y1 + before.y2) / 2;
    await clickChart(geo.W * 0.5, geo.H * 0.9);   // deselect
    await dragChart(mx, my, mx + 60, my + 40);
    const after = await geomOf(0);
    await key('Control+z');
    const undone = await geomOf(0);
    const moved = Math.abs(after.x1 - before.x1) > 30 && Math.abs(after.y1 - before.y1) > 20;
    const restored = Math.abs(undone.t1 - before.t1) < 1e-6 && Math.abs(undone.p1 - before.p1) < 1e-9 && Math.abs(undone.t2 - before.t2) < 1e-6;
    await key('Control+y');
    const redone = await geomOf(0);
    report('G21-G22-drag', moved && restored && Math.abs(redone.t1 - after.t1) < 1e-6, `drag moved by dx=${(after.x1 - before.x1).toFixed(1)} dy=${(after.y1 - before.y1).toFixed(1)}; Ctrl+Z restored p1.t/p1.p/p2.t=${restored}; Ctrl+Y re-applied=${Math.abs(redone.t1 - after.t1) < 1e-6}`);
    // delete + undo
    await page.evaluate(() => { window.__rt.setSel(0); });
    await key('Delete'); const nd = await n(); await key('Control+z'); const nu = await n();
    report('G21-delete', nd === 0 && nu === 1, `Delete -> ${nd}; Ctrl+Z -> ${nu}`);
  }

  // ================= G31 / G28 Alt+F / Alt+J must NOT place orders; G26/G27/G29/G30/G32 tool hotkeys =================
  await clear();
  {
    await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    await key('Alt+f'); let s = await st();
    report('G31', s.tool === 'fib' && s.entry === null, `Alt+F -> tool=${s.tool} entryOrder=${JSON.stringify(s.entry)}`);
    await key('Alt+j'); s = await st();
    report('G28', s.tool === 'hray' && s.entry === null, `Alt+J -> tool=${s.tool} entryOrder=${JSON.stringify(s.entry)}`);
    const tools = [['Alt+t', 'tl', 'G26'], ['Alt+h', 'hl', 'G27'], ['Alt+v', 'vline', 'G29'], ['Alt+c', 'cross', 'G30'], ['Shift+Alt+r', 'box', 'G32']];
    for (const [combo, want, id] of tools) { await key(combo); s = await st(); report(id, s.tool === want && s.entry === null, `${combo} -> tool=${s.tool} entryOrder=${JSON.stringify(s.entry)}`); }
    await key('Escape');
    // regression: plain F / J / B / X still trade
    await key('f'); s = await st(); const fOk = s.entry && s.entry.side === 'long' && s.entry.kind === 'stop';
    await page.evaluate(() => cancelOrder('entry'));
    await key('j'); s = await st(); const jOk = s.entry && s.entry.side === 'short';
    await page.evaluate(() => cancelOrder('entry'));
    await key('b'); s = await st(); const bOk = s.pos === 'long';
    await key('x'); s = await st(); const xOk = s.pos === null;
    report('REG-hotkeys', fOk && jOk && bOk && xOk, `F buy-stop=${fOk} J sell-stop=${jOk} B market long=${bOk} X flatten=${xOk}`);
  }

  // ================= G23 arrow-key nudge (selection) vs day change (no selection) =================
  await clear();
  {
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5));
    await seed([{ type: 'tl', p1: { t: ts[0], p: pm }, p2: { t: ts[1], p: pm + 4 }, color: '#000000' }]);
    await page.evaluate(() => window.__rt.setSel(0));
    const s0 = await st(); const g0 = await geomOf(0);
    await key('ArrowRight'); const g1 = await geomOf(0); const s1 = await st();
    await key('ArrowUp'); const g2 = await geomOf(0);
    const dBar = await page.evaluate(([a, b]) => timeToLogical(b) - timeToLogical(a), [g0.t1, g1.t1]);
    const tick = await page.evaluate(() => TICK);
    report('G23-nudge', Math.abs(dBar - 1) < 1e-6 && s1.sess === s0.sess && s1.idx === s0.idx && Math.abs(g2.p1 - g1.p1 - tick) < 1e-9 && Math.abs(g2.p2 - g1.p2 - tick) < 1e-9,
      `ArrowRight moved p1.t by ${dBar.toFixed(3)} bars (session ${s0.sess}->${s1.sess}, idx ${s0.idx}->${s1.idx}); ArrowUp moved price by ${(g2.p1 - g1.p1).toFixed(3)} (TICK=${tick})`);
    await key('Escape'); const s2 = await st();
    // day change is async in deep mode (jumpToDeepDay loads the neighbouring day); pick a direction that has a neighbour
    const dayKey = () => page.evaluate(() => tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key);
    const k0 = await dayKey(); const dir = await page.evaluate(() => { const l = deepDayList(), c = tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key, i = l.indexOf(c); return l[i + 1] ? 1 : (l[i - 1] ? -1 : 0); });
    const selNow = await page.evaluate(() => !!(selDrawing || selSet.size));
    await key(dir >= 0 ? 'ArrowRight' : 'ArrowLeft');
    let changed = false; try { await page.waitForFunction((k0) => (tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key) !== k0, k0, { timeout: 10000 }); changed = true; } catch (e) {}
    const k1 = await dayKey();
    report('G23-day', !s2.tool && !selNow && changed && k1 !== k0, `no selection (sel=${selNow}): ${dir >= 0 ? 'ArrowRight' : 'ArrowLeft'} changed day ${k0} -> ${k1}`);
    await key(dir >= 0 ? 'ArrowLeft' : 'ArrowRight'); try { await page.waitForFunction((k0) => (tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key) === k0, k0, { timeout: 10000 }); } catch (e) {}
    await page.waitForTimeout(500); await page.evaluate(() => { drawings.length = 0; clearSelection(); saveJSON('rt_drawings', drawings); repaintOverlays(); });
  }

  // ================= G24 Ctrl+C / Ctrl+V clamped to idx =================
  await clear();
  {
    const g = await page.evaluate(() => ({ idx, hiT: bars[Math.min(idx, bars.length - 1)].time }));
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5));
    await seed([{ type: 'tl', p1: { t: ts[0], p: pm }, p2: { t: ts[1], p: pm + 4 }, color: '#000000' }, { type: 'hray', p1: { t: g.hiT, p: pm - 5 }, color: '#000000' }]);
    await page.evaluate(() => window.__rt.setSel(0));
    await key('Control+c'); await key('Control+v');
    const n1 = await n(); const c1 = await geomOf(2);
    await page.evaluate(() => window.__rt.setSel(1));   // hray already ON the last revealed bar -> paste must not cross idx
    await key('Control+c'); await key('Control+v');
    const n2 = await n(); const c2 = await geomOf(3);
    report('G24', n1 === 3 && n2 === 4 && c1.type === 'tl' && c1.t2 <= g.hiT && c1.t1 > ts[0] && c2.type === 'hray' && c2.p1 === pm - 5 && c2.t1 <= g.hiT,
      `paste tl: count ${n1}, t1 shifted right=${c1.t1 > ts[0]}, t2<=bars[idx].time=${c1.t2 <= g.hiT}; paste hray at idx: count ${n2}, t<=bars[idx].time=${c2.t1 <= g.hiT} (t=${c2.t1}, hi=${g.hiT})`);
  }

  // ================= G25 middle-click delete =================
  await clear();
  {
    const xa = await barX(k), xb = await barX(k + 14);
    await drawTL(xa, geo.H * 0.35, xb, geo.H * 0.55);
    const g = await geomOf(0); const n0 = await n();
    await clickChart(geo.W * 0.5, geo.H * 0.9);
    await clickChart((g.x1 + g.x2) / 2, (g.y1 + g.y2) / 2, [], 'middle');
    const n1 = await n();
    report('G25', n0 === 1 && n1 === 0, `middle-click on the tl body: ${n0} -> ${n1}`);
  }

  // ================= G33 / G45 Hide drawings (Ctrl+Alt+H) — must survive a pan; arrow markers vanish too =================
  await clear();
  {
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.4));
    const t0 = await page.evaluate((k) => bars[k].time, k);
    await seed([{ type: 'hl', p1: { t: t0, p: pm }, color: '#000000' }]);
    await page.evaluate((t) => placeAnnotation('au', t), t0);
    const y = await page.evaluate((p) => drawY(p), pm);
    await paint();
    const inkOn = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    const mkOn = await page.evaluate(() => candle.markers().length);
    await key('Control+Alt+h');
    let dbg = await paint();
    const inkOff = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    const mkOff = await page.evaluate(() => candle.markers().length);
    const flagOn = await page.evaluate(() => ({ h: hideFlags.drawings, btn: document.getElementById('btnHideDrw').classList.contains('active') }));
    // pan the chart (LWC repaints the primitive on its own — the guard must live inside the draw callback)
    await dragChart(geo.W * 0.5, geo.H * 0.85, geo.W * 0.5 - 120, geo.H * 0.85);
    await page.waitForTimeout(300);
    const inkPan = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    const dbgPan = await page.evaluate(() => window.__drwDbg);
    await key('Control+Alt+h');
    dbg = await paint();
    const inkBack = await page.evaluate((y) => window.__rowInk('chart', Math.round(y) + 0.75, 40, 600), y);
    const mkBack = await page.evaluate(() => candle.markers().length);
    report('G33-G45-drawings', inkOn > 150 && mkOn === 1 && inkOff < 40 && mkOff === 0 && flagOn.h && flagOn.btn && inkPan < 40 && dbgPan && dbgPan.hidden === true && inkBack > 150 && mkBack === 1,
      `hl row ink before=${inkOn} after Ctrl+Alt+H=${inkOff} after pan=${inkPan} after unhide=${inkBack}; markers ${mkOn}->${mkOff}->${mkBack}; hideFlags.drawings=${flagOn.h} button active=${flagOn.btn} dbg.hidden after pan=${dbgPan && dbgPan.hidden}`);
    await page.evaluate(() => { annotations.length = 0; saveJSON('rt_annotations', annotations); refreshMarkers(true); });
  }

  // ================= G45 Hide indicators: masks only, settings stay =================
  {
    await page.evaluate(() => { setVwap(true); setVolOn(true); setOscMode('rsi'); const s = $('oscSelect'); if (s) s.value = 'rsi'; });
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => ({ vwap: vwapOn, vol: volOn, osc: oscMode, rsiVis: rsiSeries && rsiSeries.options().visible, volVis: vol.options().visible }));
    await page.click('#btnHideMenu', { force: true }); await page.waitForTimeout(150);
    const popOpen = await page.evaluate(() => document.getElementById('hidePopover').classList.contains('open'));
    await page.click('#hideIndicators'); await page.waitForTimeout(300);
    const hid = await page.evaluate(() => ({ flag: hideFlags.indicators, vwap: vwapOn, vol: volOn, osc: oscMode, rsiVis: rsiSeries && rsiSeries.options().visible, volVis: vol.options().visible, row: document.getElementById('hideIndicators').classList.contains('sel') }));
    await page.evaluate(() => toggleHide('indicators')); await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ flag: hideFlags.indicators, vwap: vwapOn, vol: volOn, osc: oscMode, rsiVis: rsiSeries && rsiSeries.options().visible, volVis: vol.options().visible }));
    report('G45-indicators', popOpen && before.rsiVis === true && before.volVis === true && hid.flag && hid.rsiVis === false && hid.volVis === false && hid.vwap && hid.vol && hid.osc === 'rsi' && hid.row && !back.flag && back.rsiVis === true && back.volVis === true && back.vwap && back.osc === 'rsi',
      `menu opened=${popOpen}; hidden: rsi visible=${hid.rsiVis} vol visible=${hid.volVis} vwapOn=${hid.vwap} volOn=${hid.vol} oscMode=${hid.osc}; restored: rsi visible=${back.rsiVis} vol visible=${back.volVis} vwapOn=${back.vwap} oscMode=${back.osc}`);
    // positions & orders + All
    await page.evaluate(() => placeBreakout('long')); await page.waitForTimeout(200);
    const ordOn = await page.evaluate(() => new Promise(res => { orderRepaint(); requestAnimationFrame(() => requestAnimationFrame(() => res(orderHits.length))); }));
    await page.evaluate(() => toggleHide('positions')); await page.waitForTimeout(200);
    const ordOff = await page.evaluate(() => new Promise(res => { orderRepaint(); requestAnimationFrame(() => requestAnimationFrame(() => res({ hits: orderHits.length, entry: !!entryOrder }))); }));
    await page.evaluate(() => toggleHide('positions'));
    await page.evaluate(() => toggleHide('all')); const all1 = await page.evaluate(() => ({ ...hideFlags }));
    await page.evaluate(() => toggleHide('all')); const all0 = await page.evaluate(() => ({ ...hideFlags }));
    await page.evaluate(() => cancelOrder('entry'));
    report('G45-positions-all', ordOn > 0 && ordOff.hits === 0 && ordOff.entry && all1.drawings && all1.indicators && all1.positions && !all0.drawings && !all0.indicators && !all0.positions,
      `order tag hit-boxes ${ordOn} -> ${ordOff.hits} while hidden (entryOrder kept=${ordOff.entry}); Hide all=${JSON.stringify(all1)} -> ${JSON.stringify(all0)}`);
    await page.evaluate(() => { setVwap(false); setVolOn(false); setOscMode('off'); const s = $('oscSelect'); if (s) s.value = 'off'; });
  }

  // ================= G44 lock + Delete -> confirm; Always remove locked =================
  await clear();
  {
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5));
    await seed([{ type: 'tl', p1: { t: ts[0], p: pm }, p2: { t: ts[1], p: pm + 4 }, color: '#000000', locked: true }]);
    await page.evaluate(() => window.__rt.setSel(0));
    dialogs = []; dialogMode = 'dismiss';
    await key('Delete'); await page.waitForTimeout(200);
    const nKeep = await n(), d1 = dialogs.slice();
    dialogMode = 'accept'; dialogs = [];
    await page.evaluate(() => { alwaysRemoveLocked = true; });
    await page.evaluate(() => window.__rt.setSel(0));
    await key('Delete'); await page.waitForTimeout(200);
    const nGone = await n(), d2 = dialogs.slice();
    await page.evaluate(() => { alwaysRemoveLocked = false; });
    report('G44', nKeep === 1 && d1.length === 1 && /locked/i.test(d1[0]) && nGone === 0 && d2.length === 0, `locked + Delete: confirm "${d1[0]}" dismissed -> count ${nKeep}; alwaysRemoveLocked: no dialog (${d2.length}) -> count ${nGone}`);
  }

  // ================= G46 Remove dropdown: Remove Drawings & Indicators =================
  await clear();
  {
    const ts = await page.evaluate((k) => [bars[k].time, bars[k + 10].time], k);
    const pm = await page.evaluate(() => candle.coordinateToPrice(document.getElementById('chart').clientHeight * 0.5));
    await seed([{ type: 'tl', p1: { t: ts[0], p: pm }, p2: { t: ts[1], p: pm + 4 }, color: '#000000' }, { type: 'hl', p1: { t: ts[0], p: pm - 3 }, color: '#000000' }]);
    await page.evaluate(() => { setVwap(true); setBB(true); setEMA(true); setVolOn(true); ripsterOn = true; saveJSON('rt_ripster', true); $('ripsterToggle').checked = true; setVpCfg('p', { on: true }); setOscMode('rsi'); $('oscSelect').value = 'rsi'; ['indVwap', 'indBB', 'indEma', 'indVol', 'indVpP'].forEach(id => { $(id).checked = true; }); });
    await page.waitForTimeout(300);
    await page.click('#btnRemoveMenu', { force: true }); await page.waitForTimeout(150);
    const popOpen = await page.evaluate(() => document.getElementById('removePopover').classList.contains('open'));
    dialogs = []; dialogMode = 'accept';
    await page.click('#rmDrawingsInd'); await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ n: drawings.length, vwap: vwapOn, bb: bbOn, ema: emaOn, rip: ripsterOn, vol: volOn, vp: vpP.on, osc: oscMode, boxes: ['indVwap', 'indBB', 'indEma', 'indVol', 'indVpP', 'ripsterToggle'].map(id => $(id).checked), sel: $('oscSelect').value }));
    const undoN = await (async () => { await key('Control+z'); return n(); })();
    report('G46', popOpen && dialogs.length === 1 && r.n === 0 && !r.vwap && !r.bb && !r.ema && !r.rip && !r.vol && !r.vp && r.osc === 'off' && r.boxes.every(b => b === false) && r.sel === 'off' && undoN === 2,
      `menu opened=${popOpen} confirm=${dialogs.length}; drawings=${r.n} vwapOn/bbOn/emaOn/ripsterOn/volOn/vpP.on=${[r.vwap, r.bb, r.ema, r.rip, r.vol, r.vp].join('/')} oscMode=${r.osc} checkboxes=${r.boxes.join(',')} oscSelect=${r.sel}; Ctrl+Z brings the drawings back -> ${undoN}`);
    // Remove Drawings (body button) still works
    await page.click('#drwClear'); await page.waitForTimeout(300);
    report('G46-body', (await n()) === 0, `#drwClear body -> Remove drawings: count ${await n()}`);
  }

  // ================= HELP_KEYS updated =================
  {
    const help = await page.evaluate(() => HELP_KEYS.flatMap(([, rows]) => rows.map(([k]) => k)).join(' | '));
    const need = ['Ctrl+Z', 'Ctrl+C', 'Arrows', 'Ctrl+Alt+H', 'Alt+T', 'Alt+H', 'Alt+J', 'Alt+V', 'Alt+C', 'Alt+F', 'Shift+Alt+R', 'Middle-click'];
    const miss = need.filter(s => !help.includes(s));
    report('HELP_KEYS', miss.length === 0, `missing=[${miss.join(',')}]`);
  }

  await page.waitForTimeout(300);
  const drw = await page.evaluate(() => window.__drw);
  report('REG-no-errors', errs.length === 0 && drw && drw.ok === true && !drw.err, `console errors=${errs.length} ${errs.slice(0, 3).join(' | ')}; __drw=${JSON.stringify(drw)}`);
} catch (e) {
  console.log('FAIL RUNNER —', e && e.stack || e);
  results.push(false);
} finally {
  await browser.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
