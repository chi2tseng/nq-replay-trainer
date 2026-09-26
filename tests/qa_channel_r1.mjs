// Independent QA round 1 — NT8 Trend Channel (Ctrl+2) + Line (F2) vs exports/NT8_TRENDCHANNEL_SPEC.md.
// Written from scratch for this QA pass (does not import/reuse tests/tv_drawing_matrix.mjs or any implementer script).
// Every interaction that the spec describes as a mouse action is driven with real page.mouse.* calls, not synthetic evaluate() clicks.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/qa_channel_r1.mjs   (needs http://127.0.0.1:5560/ up)
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/?r=' + Date.now();
const results = [];
const pass = (id, ok, detail) => { results.push({ id, ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} — ${detail}`); };
const consoleErrs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
page.on('pageerror', e => consoleErrs.push('PAGEERROR ' + e.message));
page.on('dialog', d => d.accept());

async function boot() {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.setItem('rt_drawings', '[]');
    localStorage.setItem('rt_magnet', '"off"');
    localStorage.setItem('rt_keepdraw', 'false');
    localStorage.setItem('rt_lockdrw', 'false');
    localStorage.removeItem('rt_hint_ctrl2');
  });
  await page.goto(URL + '&b=' + Date.now(), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 100 && idx > 60, null, { timeout: 20000 });
  await page.waitForTimeout(800);
}

// ---- small independent helper layer (pixel ink probe built fresh for this script) ----
async function installProbe() {
  await page.evaluate(() => {
    window.__qaCanvases = (rootId) => {
      const root = document.getElementById(rootId), rr = root.getBoundingClientRect();
      return [...root.querySelectorAll('canvas')].map(c => ({ c, r: c.getBoundingClientRect() }))
        .filter(o => o.r.width > rr.width * 0.5)
        .map(o => ({ ctx: o.c.getContext('2d'), ox: o.r.left - rr.left, oy: o.r.top - rr.top, w: o.c.width, h: o.c.height, sx: o.c.width / o.r.width, sy: o.c.height / o.r.height }));
    };
    window.__qaPixel = (rootId, x, y) => {
      const cs = window.__qaCanvases(rootId);
      for (let i = cs.length - 1; i >= 0; i--) {
        const { ctx, ox, oy, w, h, sx, sy } = cs[i];
        const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const d = ctx.getImageData(px, py, 1, 1).data; if (d[3] > 60) return [...d];
      }
      return null;
    };
    window.__qaInk = (rootId, x, y) => { // any non-white-ish pixel within a 2px box = a stroke passed through here
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
        const d = window.__qaPixel(rootId, x + dx, y + dy);
        if (d && d[3] > 60 && !(d[0] > 245 && d[1] > 245 && d[2] > 245)) return true;
      }
      return false;
    };
    window.__qaSegInk = (rootId, x1, y1, x2, y2, n = 14) => { let hit = 0; for (let k = 1; k < n; k++) { const t = k / n; if (window.__qaInk(rootId, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) hit++; } return hit / (n - 1); };
  });
}
const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => drawX(bars[k].time), k);
const segInk = (x1, y1, x2, y2) => page.evaluate(([x1, y1, x2, y2]) => window.__qaSegInk('chart', x1, y1, x2, y2), [x1, y1, x2, y2]);
const pointInk = (x, y) => page.evaluate(([x, y]) => window.__qaInk('chart', x, y), [x, y]);

async function mouseClick(x, y, opts = {}) {
  const r = await chartRect();
  const mods = opts.mods || [];
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(r.left + x, r.top + y);
  await page.mouse.down({ button: opts.button || 'left' });
  await page.mouse.up({ button: opts.button || 'left' });
  for (const m of mods) await page.keyboard.up(m);
  await page.waitForTimeout(700); // clear of Chromium's native multi-click (dblclick) coalescing window before the next click
}
async function mouseMove(x, y) { const r = await chartRect(); await page.mouse.move(r.left + x, r.top + y, { steps: 6 }); await page.waitForTimeout(200); }
async function mouseDrag(x1, y1, x2, y2) {
  const r = await chartRect();
  await page.mouse.move(r.left + x1, r.top + y1);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) await page.mouse.move(r.left + x1 + (x2 - x1) * i / steps, r.top + y1 + (y2 - y1) * i / steps);
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const openLinesFlyout = async () => { await page.hover('#drwLines'); await page.waitForTimeout(150); await page.click('#btnLinesMenu'); await page.waitForTimeout(150); };
const armChannel = async () => { const cur = await page.evaluate(() => tool); if (cur !== 'channel') { await openLinesFlyout(); await page.click('#drwChannel'); } await page.waitForTimeout(150); };
const st = () => page.evaluate(() => ({ tool, n: drawings.length, p1: !!pendingPt, p2: !!pendingPt2, u: undoStack.length, r: redoStack.length }));
const chan = () => page.evaluate(() => {
  const d = drawings.find(x => x.type === 'channel'); if (!d) return null;
  const el = document.getElementById('chart');
  const g = chanGeom(d, drawX, drawY, el.clientWidth, el.clientHeight);
  return { p1: { ...d.p1 }, p2: { ...d.p2 }, p3: d.p3 && { ...d.p3 }, levels: d.levels, extend: d.extend, g };
});
const resetAll = () => page.evaluate(() => {
  drawings.length = 0; undoStack.length = 0; redoStack.length = 0; clearSelection(); hoverDrawing = null;
  pendingPt = null; pendingPt2 = null; previewXY = null; if (tool) { tool = ''; }
  keepDrawing = false; saveJSON('rt_keepdraw', false);
  magnet = 'off'; saveJSON('rt_magnet', 'off');
  saveJSON('rt_drawings', drawings);
  if (document.getElementById('drawSettings').classList.contains('open')) closeDrawSettings();
  repaintOverlays();
});
const tradeState = () => page.evaluate(() => ({ pos: position ? position.side : null, entry: entryOrder ? entryOrder.side + '/' + entryOrder.kind : null }));
const flatten = () => page.evaluate(() => { if (entryOrder) cancelOrder('entry'); if (position) { flatten(); } });

try {
  await boot();
  await installProbe();
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, idx, spacing: chart.timeScale().options().barSpacing }));
  const k = (await page.evaluate(() => idx)) - 45;
  await resetAll();

  // ================= R1: hotkey defaults (spec §0) =================
  {
    await resetAll();
    await page.keyboard.press('F2'); const afterF2 = await st();
    await page.keyboard.press('F2'); const afterF2b = await st(); // toggles back off
    await resetAll();
    await page.keyboard.press('Control+2'); const afterCtrl2 = await st();
    await page.keyboard.press('Escape');
    pass('R1-F2', afterF2.tool === 'tl' && afterF2b.tool === '', `F2 arms tool='${afterF2.tool}' (spec: Line), pressing F2 again drops it -> '${afterF2b.tool}'`);
    pass('R1-Ctrl2', afterCtrl2.tool === 'channel', `Ctrl+2 arms tool='${afterCtrl2.tool}' (spec: Trend Channel)`);
  }

  // ================= R2: drawing hotkeys never fire trading hotkeys; trading hotkeys still work after =================
  {
    await resetAll();
    const t0 = await tradeState();
    await page.keyboard.press('F2'); await page.keyboard.press('Escape');
    await page.keyboard.press('Control+2'); await page.keyboard.press('Escape');
    const t1 = await tradeState();
    await page.keyboard.press('b'); await page.waitForTimeout(200); const tb = await tradeState();
    await page.keyboard.press('x'); await page.waitForTimeout(200); const tx = await tradeState();
    await page.keyboard.press('f'); await page.waitForTimeout(200); const tf1 = await tradeState(); await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    await page.keyboard.press('j'); await page.waitForTimeout(200); const tj = await tradeState(); await page.evaluate(() => { if (entryOrder) cancelOrder('entry'); });
    await page.keyboard.press('s'); await page.waitForTimeout(200); const ts = await tradeState();
    await page.keyboard.press('x'); await page.waitForTimeout(200);
    await page.evaluate(() => { markers = []; refreshMarkers(true); });
    const ok = t0.pos === null && t0.entry === null && t1.pos === null && t1.entry === null &&
      tb.pos === 'long' && tx.pos === null && tf1.entry === 'long/stop' && tj.entry === 'short/stop' && ts.pos === 'short';
    pass('R2', ok, `F2/Ctrl+2 placed no trade (pos=${t1.pos},entry=${t1.entry}); then B->${tb.pos} X->flat(${tx.pos === null}) F->${tf1.entry} J->${tj.entry} S->${ts.pos}`);
  }

  // geometry used for placement tests
  const P1 = [await barX(k), Math.round(geo.H * 0.40)];
  const P2 = [await barX(k + 22), Math.round(geo.H * 0.32)];
  const P3 = [await barX(k + 6), Math.round(geo.H * 0.62)];
  const P4 = [P3[0] + P2[0] - P1[0], P3[1] + P2[1] - P1[1]];

  // ================= R3: 3-click placement model (spec §1.1) =================
  {
    await resetAll();
    await armChannel();
    const armed = await st();
    await mouseClick(...P1);
    const s1 = await st();
    await mouseClick(...P2);
    const s2 = await st();
    await mouseClick(...P3);
    const s3 = await st();
    const c = await chan();
    const ok = armed.tool === 'channel' && s1.n === 0 && s1.p1 && !s1.p2 && s1.u === 0 &&
      s2.n === 0 && s2.p1 && s2.p2 && s2.u === 0 &&
      s3.n === 1 && s3.u === 1 && s3.tool === '' && !s3.p1 && !s3.p2 &&
      c && c.p3 != null && JSON.stringify(c.levels) === '[]';
    pass('R3', ok, `armed=${armed.tool}; click1 n=${s1.n}/pend=${s1.p1}; click2 n=${s2.n}/pend2=${s2.p2}; click3 n=${s3.n} undo=${s3.u} tool='${s3.tool}'; p3 set=${!!(c && c.p3)}`);
  }

  // ================= R4: live rubber-band after click 1, dual-rail preview after click 2 (spec §1.2) =================
  {
    await resetAll(); await armChannel();
    await mouseClick(...P1);
    const bandBefore = await segInk(P1[0], P1[1], P2[0], P2[1]);
    await mouseMove(...P2);
    const bandAfter = await segInk(P1[0], P1[1], P2[0], P2[1]);
    const dbg1 = await page.evaluate(() => window.__drwDbg && window.__drwDbg.preview);
    await mouseClick(...P2);
    await mouseMove(...P3);
    const dbg2 = await page.evaluate(() => window.__drwDbg && window.__drwDbg.preview);
    const railAink = await segInk(P1[0], P1[1], P2[0], P2[1]);
    const railBink = await segInk(P3[0], P3[1], P4[0], P4[1]);
    await mouseClick(...P3);
    const ok = bandBefore < 0.3 && bandAfter >= 0.7 && dbg1 && dbg1.tool === 'channel' && !dbg1.rails &&
      dbg2 && dbg2.rails === 2 && railAink >= 0.7 && railBink >= 0.7;
    pass('R4', ok, `pre-move trend segment ink=${bandBefore.toFixed(2)} -> after move=${bandAfter.toFixed(2)} (rubber-band); after click2, moving toward P3 previews 2 rails (dbg.rails=${dbg2 && dbg2.rails}), trend ink=${railAink.toFixed(2)} parallel ink=${railBink.toFixed(2)}`);
  }

  // ================= R5: Esc mid-placement cancels =================
  {
    await resetAll(); await armChannel();
    await mouseClick(...P1); await mouseClick(...P2);
    await page.keyboard.press('Escape');
    const afterEsc = await st();
    pass('R5-Esc-after-click2', afterEsc.n === 0 && !afterEsc.p1 && !afterEsc.p2 && afterEsc.tool === '' && afterEsc.u === 0,
      `Esc after 2 clicks -> n=${afterEsc.n} pending=${afterEsc.p1}/${afterEsc.p2} tool='${afterEsc.tool}' undoEntries=${afterEsc.u}`);

    await resetAll(); await armChannel();
    await mouseClick(...P1);
    await page.keyboard.press('Escape');
    const afterEsc1 = await st();
    pass('R5-Esc-after-click1', afterEsc1.n === 0 && !afterEsc1.p1 && afterEsc1.tool === '',
      `Esc after 1 click -> n=${afterEsc1.n} pending=${afterEsc1.p1} tool='${afterEsc1.tool}'`);
  }

  // ================= R6: right-click mid-placement cancels, no trade/context menu (spec §2.4) =================
  {
    await resetAll(); await armChannel();
    await mouseClick(...P1);
    await mouseClick(P2[0], P2[1], { button: 'right' });
    const rc = await page.evaluate(() => ({ n: drawings.length, pend: !!pendingPt, tool, ctxOpen: !!(document.getElementById('ctxMenu') && document.getElementById('ctxMenu').style.display === 'block') }));
    await page.evaluate(() => { if (typeof hideCtx === 'function') hideCtx(); });
    pass('R6', rc.n === 0 && !rc.pend && rc.tool === '' && !rc.ctxOpen, `right-click after click1 -> n=${rc.n} pending=${rc.pend} tool='${rc.tool}' contextMenuShown=${rc.ctxOpen}`);
  }

  // ================= R7: magnet strong snaps clicks to nearest bar OHLC (spec §1.5 Snap Mode) =================
  {
    await resetAll();
    await page.evaluate(() => { magnet = 'strong'; magnetMode = 'strong'; saveJSON('rt_magnet', 'strong'); });
    await armChannel();
    const bar = await page.evaluate((k) => ({ time: bars[k].time, o: bars[k].open, h: bars[k].high, l: bars[k].low, c: bars[k].close }), k);
    const bx = await barX(k);
    // click a few px off the bar's own x/y so a snap is provable (not an accidental exact hit)
    const offY = await page.evaluate((p) => candle.priceToCoordinate(p), bar.h);
    await mouseClick(bx + 4, offY - 9);
    const p1after = await page.evaluate(() => ({ t: pendingPt && pendingPt.t, p: pendingPt && pendingPt.p }));
    await page.keyboard.press('Escape');
    const snappedTime = p1after.t === bar.time;
    const snappedPrice = [bar.o, bar.h, bar.l, bar.c].some(v => Math.abs(v - p1after.p) < 1e-9);
    pass('R7-magnet-strong', snappedTime && snappedPrice, `strong magnet click near bar ${k} (O/H/L/C=${bar.o}/${bar.h}/${bar.l}/${bar.c}) off-target by (4px,~9px) -> snapped t=${p1after.t === bar.time} p=${p1after.p} (one of OHLC=${snappedPrice})`);
    await page.evaluate(() => { magnet = 'off'; saveJSON('rt_magnet', 'off'); });
  }

  // ================= R8: Shift constrains the 1st->2nd leg to 45 degree increments (channel is in SHIFT_TOOLS) =================
  {
    await resetAll(); await armChannel();
    const xa = P1[0], ya = P1[1], xb = xa + 90, yb = ya + 7; // near-horizontal drag; Shift should snap the resulting angle to a 45 deg multiple
    await mouseClick(xa, ya);
    await mouseClick(xb, yb, { mods: ['Shift'] });
    // channel isn't committed to `drawings` until the 3rd click — read the pending 2nd anchor directly, converted back to pixels
    const pend = await page.evaluate(() => ({ p1: { ...pendingPt }, p2: { ...pendingPt2 } }));
    const px1 = await page.evaluate((t) => drawX(t), pend.p1.t), py1 = await page.evaluate((p) => drawY(p), pend.p1.p);
    const px2 = await page.evaluate((t) => drawX(t), pend.p2.t), py2 = await page.evaluate((p) => drawY(p), pend.p2.p);
    const ang = (px1 != null && px2 != null) ? Math.atan2(py2 - py1, px2 - px1) * 180 / Math.PI : null;
    const nearestMul45 = ang != null ? Math.round(ang / 45) * 45 : null;
    const ok = ang != null && Math.abs(ang - nearestMul45) < 1.5;
    await mouseClick((xa + xb) / 2, Math.min(ya, yb) - 40); // close the channel with a 3rd click so resetAll() below has nothing pending
    pass('R8-shift-45', ok, `click1->Shift+click2 raw target angle would be ~${(Math.atan2(yb - ya, xb - xa) * 180 / Math.PI).toFixed(1)}deg; placed trend-line angle=${ang && ang.toFixed(2)}deg (nearest 45-multiple=${nearestMul45})`);
  }

  // ================= R9: selection shows 6 handles; 3 are real independent anchors, 3 are body-grabs (spec §1.3) =================
  await resetAll(); await armChannel();
  await mouseClick(...P1); await mouseClick(...P2); await mouseClick(...P3);
  {
    const dSel = await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res(window.__drwDbg)))); });
    pass('R9-six-handles', dSel && dSel.handles === 6, `selected channel shows __drwDbg.handles=${dSel && dSel.handles} (spec: 6, 3 per rail)`);
  }

  // R9a: drag anchor1 (p1 / L1A1) -> p2 unchanged, offset (p3-p1) preserved, both rails re-slope together
  {
    let c = await chan();
    await mouseDrag(c.g.x1, c.g.y1, c.g.x1 - 22, c.g.y1 + 18);
    let c2 = await chan();
    const offBefore = { t: c.p3.t - c.p1.t, p: c.p3.p - c.p1.p }, offAfter = { t: c2.p3.t - c2.p1.t, p: c2.p3.p - c2.p1.p };
    const ok = JSON.stringify(c2.p2) === JSON.stringify(c.p2) && (c2.p1.p !== c.p1.p || c2.p1.t !== c.p1.t) &&
      Math.abs(offAfter.p - offBefore.p) < 1e-6 && Math.abs(offAfter.t - offBefore.t) < 1;
    pass('R9a-drag-p1', ok, `drag anchor1 (-22,+18)px: p2 unchanged=${JSON.stringify(c2.p2) === JSON.stringify(c.p2)}, p1 moved=${c2.p1.p !== c.p1.p}, offset(p3-p1) preserved: price ${offBefore.p.toFixed(4)}->${offAfter.p.toFixed(4)}, time ${offBefore.t.toFixed(1)}->${offAfter.t.toFixed(1)}`);
  }

  // R9b: drag anchor2 (p2 / L1A2) -> p1,p3 unchanged; parallel end (p4, derived) follows so rail b stays parallel
  {
    let c = await chan();
    await mouseDrag(c.g.x2, c.g.y2, c.g.x2 + 26, c.g.y2 - 16);
    let c2 = await chan();
    const parallelHeld = Math.abs((c2.g.x4 - c2.g.x3) - (c2.g.x2 - c2.g.x1)) < 1 && Math.abs((c2.g.y4 - c2.g.y3) - (c2.g.y2 - c2.g.y1)) < 1;
    const ok = JSON.stringify(c2.p1) === JSON.stringify(c.p1) && JSON.stringify(c2.p3) === JSON.stringify(c.p3) && c2.p2.p !== c.p2.p && parallelHeld;
    pass('R9b-drag-p2', ok, `drag anchor2 (+26,-16)px: p1/p3 unchanged=${JSON.stringify(c2.p1) === JSON.stringify(c.p1)}/${JSON.stringify(c2.p3) === JSON.stringify(c.p3)}, p2 moved=${c2.p2.p !== c.p2.p}, rail b stays parallel to rail a=${parallelHeld}`);
  }

  // R9c: drag anchor3 (p3 / L2A1, the real ParallelStartAnchor) -> p1,p2 untouched, only the parallel rail's offset changes
  {
    let c = await chan();
    await mouseDrag(c.g.x3, c.g.y3, c.g.x3 + 20, c.g.y3 + 26);
    let c2 = await chan();
    const ok = JSON.stringify(c2.p1) === JSON.stringify(c.p1) && JSON.stringify(c2.p2) === JSON.stringify(c.p2) && (c2.p3.p !== c.p3.p || c2.p3.t !== c.p3.t);
    pass('R9c-drag-p3', ok, `drag anchor3/L2A1 (+20,+26)px: p1/p2 untouched=${JSON.stringify(c2.p1) === JSON.stringify(c.p1)}/${JSON.stringify(c2.p2) === JSON.stringify(c.p2)}, p3 moved=${c2.p3.p !== c.p3.p || c2.p3.t !== c.p3.t}`);
  }

  // R9d: body-grab at the trend-rail MIDPOINT (not a real anchor per spec) -> whole channel translates (all 3 anchors shift equally)
  {
    let c = await chan();
    const mx = (c.g.x1 + c.g.x2) / 2, my = (c.g.y1 + c.g.y2) / 2;
    await mouseDrag(mx, my, mx + 35, my + 24);
    let c2 = await chan();
    const dp1 = c2.p1.p - c.p1.p, dp2 = c2.p2.p - c.p2.p, dp3 = c2.p3.p - c.p3.p;
    const same = Math.max(dp1, dp2, dp3) - Math.min(dp1, dp2, dp3) < 1e-6 && Math.abs(dp1) > 0;
    pass('R9d-body-mid', same, `drag rail-a midpoint (+35,+24)px: Δprice p1/p2/p3 = ${dp1.toFixed(4)}/${dp2.toFixed(4)}/${dp3.toFixed(4)} (whole-object translate expected)`);
  }

  // R9e: grab at the NON-anchor 6th handle (x4,y4 = rail-b's computed far end, "L2A2") -> also a whole-object translate
  {
    let c = await chan();
    await mouseDrag(c.g.x4, c.g.y4, c.g.x4 + 30, c.g.y4 + 20);
    let c2 = await chan();
    const dp1 = c2.p1.p - c.p1.p, dp2 = c2.p2.p - c.p2.p, dp3 = c2.p3.p - c.p3.p;
    const same = Math.max(dp1, dp2, dp3) - Math.min(dp1, dp2, dp3) < 1e-6 && Math.abs(dp1) > 0;
    pass('R9e-L2A2-not-anchor', same, `drag the visual-only 6th handle (L2A2, x4/y4) (+30,+20)px: Δprice p1/p2/p3 = ${dp1.toFixed(4)}/${dp2.toFixed(4)}/${dp3.toFixed(4)} (spec: not a real anchor -> whole object moves)`);
  }

  // ================= R10: Keep drawing (Stay in Draw Mode) keeps 'channel' armed after a completed object (spec §1.2) =================
  {
    await resetAll();
    await page.evaluate(() => { keepDrawing = true; saveJSON('rt_keepdraw', true); });
    await armChannel();
    await mouseClick(...P1); await mouseClick(...P2); await mouseClick(...P3);
    const afterFirst = await st();
    await mouseClick(P1[0] + 60, P1[1]); await mouseClick(P2[0] + 60, P2[1]); await mouseClick(P3[0] + 60, P3[1]);
    const afterSecond = await st();
    pass('R10-keep-drawing', afterFirst.n === 1 && afterFirst.tool === 'channel' && afterSecond.n === 2, `Keep drawing ON: after 1st channel n=${afterFirst.n} tool stays='${afterFirst.tool}'; placed a 2nd channel without re-arming -> n=${afterSecond.n}`);
    await page.evaluate(() => { keepDrawing = false; saveJSON('rt_keepdraw', false); });
  }

  // ================= R11: Undo/redo (clicks 1-2 leave no history; the finished object is 1 undo step) =================
  {
    await resetAll(); await armChannel();
    await mouseClick(...P1); await mouseClick(...P2); await mouseClick(...P3);
    const placed = await page.evaluate(() => drawings.length);
    await page.keyboard.press('Control+z'); const afterUndo = await page.evaluate(() => drawings.length);
    await page.keyboard.press('Control+y'); const afterRedo = await page.evaluate(() => drawings.length);
    const p3Intact = await page.evaluate(() => !!(drawings[0] && drawings[0].type === 'channel' && drawings[0].p3 && drawings[0].p3.p != null));
    pass('R11-undo-redo', placed === 1 && afterUndo === 0 && afterRedo === 1 && p3Intact, `placed=${placed} -> Ctrl+Z -> ${afterUndo} -> Ctrl+Y -> ${afterRedo}, p3 intact after redo=${p3Intact}`);
  }

  // ================= R12: Delete removes selected channel; undo restores (spec §2.4) =================
  {
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); });
    await page.keyboard.press('Delete');
    const afterDel = await page.evaluate(() => drawings.length);
    await page.keyboard.press('Control+z');
    const afterUndo = await page.evaluate(() => drawings.length);
    pass('R12-delete-undo', afterDel === 0 && afterUndo === 1, `select+Delete -> n=${afterDel}; Ctrl+Z -> n=${afterUndo}`);
  }

  // ================= R13: Settings panel — title, Levels % (50 = midline), Extend, Coordinates tab shows Parallel start (spec §1.4) =================
  {
    let c = await chan();
    // open via a REAL double-click on the object's body (matches the app's own dblclick-to-open handler)
    const mx = (c.g.x1 + c.g.x2) / 2, my = (c.g.y1 + c.g.y2) / 2;
    const r = await chartRect();
    await page.mouse.dblclick(r.left + mx, r.top + my);
    await page.waitForTimeout(200);
    const title = await page.evaluate(() => { const el = document.querySelector('#drawSettings .dd-date'); return el && el.textContent; });
    const hasExtendSelect = await page.evaluate(() => { const s = document.querySelector('#drawSettings [data-k="d:extend"]'); return s ? [...s.options].map(o => o.value).join(',') : null; });
    // set Levels=50 via the real input field
    await page.fill('#drawSettings [data-k="lv:levels"]', '50');
    await page.locator('#drawSettings [data-k="lv:levels"]').dispatchEvent('change');
    await page.waitForTimeout(150);
    const levelsNow = await page.evaluate(() => JSON.stringify(drawings[0].levels));
    // 50% level = rail a shifted by half the (p3-p1) offset vector IN BOTH AXES (matches chanGeom's own `lv` formula)
    const ox = c.g.x3 - c.g.x1, oy = c.g.y3 - c.g.y1;
    const midX1 = c.g.x1 + ox / 2, midY1 = c.g.y1 + oy / 2, midX2 = c.g.x2 + ox / 2, midY2 = c.g.y2 + oy / 2;
    const midInk = await segInk(midX1, midY1, midX2, midY2);
    // set Extend = both
    await page.selectOption('#drawSettings [data-k="d:extend"]', 'both');
    await page.waitForTimeout(150);
    const extendNow = await page.evaluate(() => drawings[0].extend);
    // Coordinates tab
    await page.click('#drawSettings .ds-tab[data-tab="coords"]');
    await page.waitForTimeout(120);
    const coordsTxt = await page.evaluate(() => document.getElementById('drawSettings').textContent);
    const hasP3Field = await page.evaluate(() => !!document.querySelector('#drawSettings [data-k="p:p3"]'));
    await page.evaluate(() => closeDrawSettings());
    const ok = title === 'Trend channel settings' && hasExtendSelect === 'none,left,right,both' && levelsNow === '[50]' && midInk >= 0.7 && extendNow === 'both' && /Parallel start/.test(coordsTxt) && hasP3Field;
    pass('R13-settings', ok, `title='${title}'; Extend options=[${hasExtendSelect}]; Levels 50 -> ${levelsNow} (midline ink=${midInk.toFixed(2)}); Extend=both stored='${extendNow}'; Coordinates shows Parallel start group with p:p3 field=${hasP3Field}`);
  }

  // ================= R14: reload persistence (spec: drawings persist via rt_drawings) =================
  {
    const saved = await chan();
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 100, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    await installProbe();
    const re = await chan();
    const ok = re && JSON.stringify(re.p1) === JSON.stringify(saved.p1) && JSON.stringify(re.p2) === JSON.stringify(saved.p2) && JSON.stringify(re.p3) === JSON.stringify(saved.p3) && JSON.stringify(re.levels) === JSON.stringify(saved.levels) && re.extend === saved.extend;
    pass('R14-reload-persist', ok, `after reload: p1/p2/p3 match=${!!ok}; levels=${JSON.stringify(re && re.levels)} extend='${re && re.extend}'`);
  }

  // ================= R15: renders correctly past the last bar (future space) =================
  {
    await resetAll(); await page.evaluate(() => chart.timeScale().scrollToRealTime());
    await page.waitForTimeout(300);
    const liveIdx = await page.evaluate(() => idx), spacing = geo.spacing;
    const xLast = await barX(liveIdx);
    const F1 = [xLast - spacing * 8, Math.round(geo.H * 0.30)];
    const F2b = [xLast + spacing * 4, Math.round(geo.H * 0.26)]; // 2nd anchor lands 4 bars PAST the last revealed bar
    const F3 = [xLast - spacing * 8, Math.round(geo.H * 0.50)];
    await armChannel();
    await mouseClick(...F1); await mouseClick(...F2b); await mouseClick(...F3);
    const d = await page.evaluate(() => { const dd = drawings[0]; return { t2: dd.p2.t, lastT: bars[idx].time, nativeCoord: chart.timeScale().timeToCoordinate(dd.p2.t) }; });
    const F4 = [F3[0] + F2b[0] - F1[0], F3[1] + F2b[1] - F1[1]];
    const futInkTrend = await segInk(F1[0] + (F2b[0] - F1[0]) * 0.8, F1[1] + (F2b[1] - F1[1]) * 0.8, F2b[0], F2b[1]);
    const futInkParallel = await segInk(F3[0] + (F4[0] - F3[0]) * 0.8, F3[1] + (F4[1] - F3[1]) * 0.8, F4[0], F4[1]);
    const ok = d.t2 > d.lastT && d.nativeCoord == null && futInkTrend >= 0.6 && futInkParallel >= 0.6;
    pass('R15-past-last-bar', ok, `2nd anchor placed ${((d.t2 - d.lastT)).toFixed(0)}s past the last bar (native chart.timeToCoordinate=${d.nativeCoord}, i.e. outside the library's own range); our renderer still draws both rails out there (trend ink=${futInkTrend.toFixed(2)}, parallel ink=${futInkParallel.toFixed(2)})`);
  }

  // ================= R16: survives a timeframe switch (not just a zoom/barSpacing change) =================
  {
    const before = await chan();
    const tfBefore = await page.evaluate(() => tf);
    await page.selectOption('#tfSelect', { label: '5m' }).catch(async () => { await page.selectOption('#tfSelect', '5'); });
    await page.waitForTimeout(500);
    const tfAfter = await page.evaluate(() => tf);
    const after = await chan();
    const geomValid = after && after.g && [after.g.x1, after.g.y1, after.g.x2, after.g.y2, after.g.x3, after.g.y3, after.g.x4, after.g.y4].every(v => v != null && isFinite(v));
    let renderedInk = 0;
    if (geomValid) renderedInk = await segInk(after.g.x1, after.g.y1, after.g.x2, after.g.y2);
    // restore original timeframe
    await page.selectOption('#tfSelect', String(tfBefore)).catch(() => {});
    await page.waitForTimeout(400);
    const restored = await chan();
    const ok = tfAfter !== tfBefore && geomValid && renderedInk >= 0.5 && restored && JSON.stringify(restored.p1) === JSON.stringify(before.p1);
    pass('R16-timeframe-switch', ok, `tf ${tfBefore} -> ${tfAfter}; channel geometry after switch valid=${geomValid}, trend-rail ink=${renderedInk.toFixed(2)}; anchors survive the round trip back to tf=${tfBefore}=${!!(restored && JSON.stringify(restored.p1) === JSON.stringify(before.p1))}`);
  }

  // ================= R17: no fill / no default midline (spec §1.4, inferred no AreaBrush) =================
  {
    await resetAll(); await armChannel();
    await mouseClick(...P1); await mouseClick(...P2); await mouseClick(...P3);
    const c = await chan();
    // sample well inside the band, away from either rail and away from the (currently empty) levels list
    const cx1 = c.g.x1 + (c.g.x2 - c.g.x1) * 0.5, cy1 = c.g.y1 + (c.g.y3 - c.g.y1) * 0.5 + (c.g.y2 - c.g.y1) * 0.5 - (c.g.y1);
    // simpler: midpoint between rail-a and rail-b sampled at 40% and 60% along the channel's length
    const samples = [0.35, 0.65].map(f => {
      const ax = c.g.x1 + (c.g.x2 - c.g.x1) * f, ay = c.g.y1 + (c.g.y2 - c.g.y1) * f;
      const bx = c.g.x3 + (c.g.x4 - c.g.x3) * f, by = c.g.y3 + (c.g.y4 - c.g.y3) * f;
      return { x: (ax + bx) / 2, y: (ay + by) / 2 };
    });
    const inks = [];
    for (const s of samples) inks.push(await pointInk(s.x, s.y));
    pass('R17-no-fill', inks.every(v => v === false), `interior-of-band samples at 35%/65% along the channel: ink present=${inks.join(',')} (spec-inferred: should be false, no fill/no default midline)`);
  }

  // ================= R18: console/render error sweep across the whole run =================
  {
    const drw = await page.evaluate(() => window.__drw);
    pass('R18-no-errors', consoleErrs.length === 0 && drw && drw.ok && !drw.err, `console/page errors during this run: ${consoleErrs.length}${consoleErrs.length ? ' (' + consoleErrs.slice(0, 3).join(' | ').slice(0, 300) + ')' : ''}; window.__drw=${JSON.stringify(drw)}`);
  }

  await resetAll();
} catch (e) {
  pass('SCRIPT-ERROR', false, String(e && e.stack || e));
} finally {
  await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n==== qa_channel_r1: ${results.length - failed.length}/${results.length} PASS ====`);
if (failed.length) console.log('FAILED: ' + failed.map(r => r.id).join(', '));
process.exit(failed.length ? 1 : 0);
