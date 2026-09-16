// Independent adversarial QA for Stage 3 (TV_DRAWING_GAP.md: G12-G20, G34, G39-G43 drag-guard, + regressions).
// Written fresh for round 1 — does NOT reuse tests/tv_drawing_stage3.mjs.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/qa_stage3_r1.mjs
// Needs http://127.0.0.1:5560/ already serving the repo.
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/?r=' + Date.now();
const results = [];
const report = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };
const errs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('dialog', (d) => d.accept());

async function boot() {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.setItem('rt_drawings', '[]');
    localStorage.setItem('rt_drawings_v', '1');
    localStorage.setItem('rt_magnet', '"off"');
    localStorage.setItem('rt_lockdrw', 'false');
    localStorage.setItem('rt_keepdraw', 'false');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 100 && idx > 200, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__qaCanvases = (rootId) => {
      const root = document.getElementById(rootId), rr = root.getBoundingClientRect();
      return [...root.querySelectorAll('canvas')]
        .map((c) => ({ c, r: c.getBoundingClientRect() }))
        .filter((o) => o.r.width > rr.width * 0.4)
        .map((o) => ({ ctx: o.c.getContext('2d'), ox: o.r.left - rr.left, oy: o.r.top - rr.top, w: o.c.width, h: o.c.height, sx: o.c.width / o.r.width, sy: o.c.height / o.r.height }));
    };
    window.__qaRgbAt = (rootId, x, y) => {
      const cs = window.__qaCanvases(rootId);
      for (let i = cs.length - 1; i >= 0; i--) {
        const { ctx, ox, oy, w, h, sx, sy } = cs[i];
        const px = Math.round((x - ox) * sx), py = Math.round((y - oy) * sy);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const d = ctx.getImageData(px, py, 1, 1).data;
        if (d[3] > 60) return [...d];
      }
      return null;
    };
  });
}

const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);

async function clickChart(x, y, mods = []) {
  const r = await chartRect();
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(r.left + x, r.top + y);
  for (const m of mods) await page.keyboard.up(m);
  await wait(650); // LWC treats a 2nd click inside ~500ms as a dblclick
}
async function dragChart(x1, y1, x2, y2, mods = [], steps = 10) {
  const r = await chartRect();
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(r.left + x1, r.top + y1);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(r.left + x1 + ((x2 - x1) * i) / steps, r.top + y1 + ((y2 - y1) * i) / steps);
  await wait(80);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await wait(250);
}
async function moveChart(x, y) { const r = await chartRect(); await page.mouse.move(r.left + x, r.top + y); await wait(180); }
async function dblclickChart(x, y) { const r = await chartRect(); await page.mouse.dblclick(r.left + x, r.top + y); await wait(250); }

async function ink(x, y, rad, testExpr) {
  return page.evaluate(({ x, y, rad, testExpr }) => {
    const test = testExpr ? new Function('r', 'g', 'b', 'return ' + testExpr) : (r, g, b) => !(r > 240 && g > 240 && b > 240);
    for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
      const d = window.__qaRgbAt('chart', x + dx, y + dy);
      if (d && test(d[0], d[1], d[2])) return true;
    }
    return false;
  }, { x, y, rad, testExpr });
}
async function inkPane(root, x, y, rad, testExpr) {
  return page.evaluate(({ root, x, y, rad, testExpr }) => {
    const test = testExpr ? new Function('r', 'g', 'b', 'return ' + testExpr) : (r, g, b) => !(r > 240 && g > 240 && b > 240);
    for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
      const d = window.__qaRgbAt(root, x + dx, y + dy);
      if (d && test(d[0], d[1], d[2])) return true;
    }
    return false;
  }, { root, x, y, rad, testExpr });
}
const BLUE = 'r>60&&r<160&&g>100&&g<190&&b>190';
const MAGENTA = 'r>200&&g<60&&b>200';
const MAGENTA_FAINT = 'r>230&&b>230&&g>100&&g<180'; // magenta alpha-blended (~0.45) over a white background
const BLACK = 'r<50&&g<50&&b<50';
const ORANGE = 'r>150&&g>30&&g<130&&b<60'; // default fib color #CC4400
// samples several points along a segment so a dashed stroke's gaps ([3,3] etc.) can't produce a false negative
async function inkAlongSegment(x1, y1, x2, y2, rad, test, n = 10) {
  for (let i = 0; i <= n; i++) {
    const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n;
    if (await ink(x, y, rad, test)) return true;
  }
  return false;
}

function outward(p1, p2, dist) {
  const dx = p1.x - p2.x, dy = p1.y - p2.y, L = Math.hypot(dx, dy) || 1;
  return { x: p1.x + (dx / L) * dist, y: p1.y + (dy / L) * dist };
}

async function paint() { return page.evaluate(() => new Promise((res) => { repaintOverlays(); requestAnimationFrame(() => requestAnimationFrame(() => res(window.__drwDbg))); })); }
async function seed(list) {
  return page.evaluate((list) => {
    drawings.length = 0; for (const d of list) drawings.push(newDrawing(d));
    clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null;
    saveJSON('rt_drawings', drawings); repaintOverlays();
  }, list);
}
async function resetAll() {
  // also restores the time-scale view (fitChart): earlier blocks pan/scroll/zoom the chart (G13's
  // off-screen scroll test in particular), and leaving that in place shifts every later barX(k)/pixel
  // calculation, which silently invalidates unrelated tests' geometry.
  const r = await page.evaluate(() => {
    drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null;
    if (tool) setTool(tool);
    drawingsLocked = false; saveJSON('rt_lockdrw', drawingsLocked); lockBtnUI();
    if (document.getElementById('drawSettings').classList.contains('open')) closeDrawSettings();
    saveJSON('rt_drawings', drawings); fitChart(); repaintOverlays();
  });
  await wait(150);
  return r;
}
async function getDrawings() { return page.evaluate(() => JSON.parse(JSON.stringify(drawings))); }
async function getState() { return page.evaluate(() => ({ selCount: selSet.size, sel: !!selDrawing, drawErr: window.__drw && window.__drw.err })); }
async function timeToXY(t, p) { return page.evaluate(({ t, p }) => ({ x: drawX(t), y: drawY(p) }), { t, p }); }

let k0, geo;

try {
  await boot();
  geo = await page.evaluate(() => ({ idx, barsLen: bars.length, W: document.getElementById('chart').clientWidth, H: document.getElementById('chart').clientHeight, tf }));
  k0 = geo.idx - 60;

  // ================= LOAD =================
  {
    const boot0 = await page.evaluate(() => ({ tb: document.getElementById('drawToolbar').hidden, lock: !!document.getElementById('btnLockDrw'), ds: !!document.getElementById('drawSettings') }));
    report('LOAD', errs.length === 0 && boot0.tb && boot0.lock && boot0.ds, `console/page errors=${errs.length}${errs.length ? ' [' + errs.slice(0, 2).join(' | ') + ']' : ''}; #drawToolbar hidden=${boot0.tb}; #btnLockDrw=${boot0.lock}; #drawSettings=${boot0.ds}`);
  }

  // ================= G12: handles only when selected/hovered =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 16);
    const ya = geo.H * 0.30, yb = geo.H * 0.55;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb);
    await page.keyboard.press('Escape'); await wait(150); // placement auto-selects (SPEC/handleDrawClick) -> deselect first
    await paint();
    const p1 = { x: xa, y: ya }, p2 = { x: xb, y: yb };
    const out1 = outward(p1, p2, 8);
    const noneOut = await ink(out1.x, out1.y, 2);
    const noneBlue = await ink(p1.x, p1.y, 3, BLUE);
    await moveChart(geo.W - 20, geo.H - 20); // hover far away from the line
    const noneOut2 = await ink(out1.x, out1.y, 2);
    // hover over the body (not an endpoint) to trigger hoverDrawing
    const midx = (xa + xb) / 2, midy = (ya + yb) / 2;
    await moveChart(midx, midy);
    const dbgHover = await page.evaluate(() => window.__drwDbg && window.__drwDbg.handles);
    const hoverOut = await ink(out1.x, out1.y, 3);
    const hoverBlue = await ink(p1.x, p1.y, 3, BLUE);
    await moveChart(geo.W - 20, geo.H - 20);
    await clickChart(midx, midy); // plain click on the body -> select
    const selOut = await ink(p1.x, p1.y, 3, BLUE);
    const st = await getState();
    const ok = !noneOut && !noneBlue && !noneOut2 && hoverOut && !hoverBlue && (dbgHover || 0) > 0 && selOut && st.sel;
    report('G12-tl', ok, `deselected: outward-ink=${noneOut} blueAtP1=${noneBlue}; after-unhover outward-ink=${noneOut2}; hover: outward-ink=${hoverOut} blueAtP1=${hoverBlue} dbg.handles=${dbgHover}; select: blueAtP1=${selOut} selDrawing=${st.sel}`);
  }

  // ================= G12: measure + rr hover/select (blue handles drawn by their own renderer) =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 16);
    const ya = geo.H * 0.30, yb = geo.H * 0.55;
    await page.click('#drwMeasure'); await clickChart(xa, ya); await clickChart(xb, yb);
    await paint();
    const noneSel = await ink(xa, ya, 3, BLUE);
    await page.keyboard.press('Escape'); await wait(150);
    const noneAfterEsc = await ink(xa, ya, 3, BLUE);
    const midx = (xa + xb) / 2, midy = (ya + yb) / 2;
    await moveChart(midx, midy); await wait(150);
    const hoverBlue = await ink(xa, ya, 3, BLUE);
    await moveChart(geo.W - 20, geo.H - 20); await wait(150);
    const unhoverBlue = await ink(xa, ya, 3, BLUE);
    await clickChart(midx, midy);
    const selBlue = await ink(xa, ya, 3, BLUE);
    const measureOk = noneAfterEsc === false && hoverBlue === true && unhoverBlue === false && selBlue === true;
    report('G12-measure', measureOk, `after-place(still selected)=${!noneSel}; after-Esc(deselected)=${!noneAfterEsc}; hover-blue=${hoverBlue}; unhover-blue=${unhoverBlue}; click-select-blue=${selBlue}`);
  }
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 24);
    const y1 = geo.H * 0.45;
    await page.click('#drwRR'); await clickChart(xa, y1); // rr is a single click (entry) per handleDrawClick t==='rr'
    await paint();
    await page.keyboard.press('Escape'); await wait(150);
    const d = (await getDrawings())[0];
    const xy = await timeToXY(d.p1.t, d.p1.p);
    const noneBlue = await ink(xy.x, xy.y, 3, BLUE);
    const hoverNoneState = await page.evaluate(() => !!hoverDrawing);
    await moveChart(xy.x + 30, xy.y); await wait(150); // hover near the entry line body, off the exact anchor
    const hoverBlue = await ink(xy.x, xy.y, 3, BLUE);
    const hoverOnState = await page.evaluate(() => !!hoverDrawing);
    await moveChart(5, geo.H - 5); await wait(150); // bottom-left corner: outside the rr box (anchored near k0..k0+24, mid price)
    const unhoverBlue = await ink(xy.x, xy.y, 3, BLUE);
    const hoverOffState = await page.evaluate(() => !!hoverDrawing);
    const ok = !noneBlue && !hoverNoneState && hoverBlue && hoverOnState && !unhoverBlue && !hoverOffState;
    report('G12-rr', ok, `deselected: blue=${noneBlue} hoverDrawing=${hoverNoneState}; hover: blue=${hoverBlue} hoverDrawing=${hoverOnState}; unhover: blue=${unhoverBlue} hoverDrawing=${hoverOffState}`);
  }

  // ================= G13: floating toolbar (bbox-driven, recolor, lock, delete, off-screen hide) =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 16), ya = geo.H * 0.3, yb = geo.H * 0.5;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb);
    await page.keyboard.press('Escape'); await wait(150); // deselect (placement auto-selects)
    await paint();
    const hiddenBefore = await page.evaluate(() => document.getElementById('drawToolbar').hidden);
    await clickChart((xa + xb) / 2, (ya + yb) / 2); // select
    await paint();
    const box = await page.evaluate(() => { const el = document.getElementById('drawToolbar'); const r = el.getBoundingClientRect(); return { hidden: el.hidden, w: r.width, h: r.height, top: r.top }; });
    // recolor via the toolbar color input
    await page.evaluate(() => { const el = document.getElementById('dtColor'); el.value = '#ff00ff'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(150);
    const styleColor = (await getDrawings())[0].style.color;
    const magentaInk = await ink((xa + xb) / 2, (ya + yb) / 2, 3, 'r>200&&g<60&&b>200');
    // lock via the toolbar
    await page.click('#dtLock'); await wait(120);
    const lockedIcon = await page.evaluate(() => document.getElementById('dtLock').querySelector('span').textContent);
    const preDragGeom = (await getDrawings())[0];
    await dragChart((xa + xb) / 2, (ya + yb) / 2, (xa + xb) / 2 + 40, (ya + yb) / 2 + 25);
    const postDragGeom = (await getDrawings())[0];
    const dragBlocked = JSON.stringify(preDragGeom.p1) === JSON.stringify(postDragGeom.p1) && JSON.stringify(preDragGeom.p2) === JSON.stringify(postDragGeom.p2);
    await page.click('#dtLock'); await wait(120); // unlock so delete below is not confirm-gated (Stage 4 territory)
    // scroll the drawing off-screen without touching selection (pointerdown-based pan would clear it)
    await page.evaluate(() => chart.timeScale().scrollToPosition(-100000, false));
    await paint();
    const hiddenOffscreen = await page.evaluate(() => document.getElementById('drawToolbar').hidden);
    const stillSelected = (await getState()).sel;
    await page.evaluate(() => chart.timeScale().scrollToPosition(0, false));
    await paint();
    const shownAgain = await page.evaluate(() => document.getElementById('drawToolbar').hidden === false);
    // delete via the toolbar
    await page.click('#dtDelete'); await wait(150);
    const nAfterDelete = (await getDrawings()).length;
    const hiddenAfterDelete = await page.evaluate(() => document.getElementById('drawToolbar').hidden);
    const ok = hiddenBefore && box.w > 0 && box.h > 0 && styleColor === '#ff00ff' && magentaInk && lockedIcon === 'lock' && dragBlocked && hiddenOffscreen && stillSelected && shownAgain && nAfterDelete === 0 && hiddenAfterDelete;
    report('G13', ok, `hidden-before-select=${hiddenBefore}; bbox=${box.w.toFixed(0)}x${box.h.toFixed(0)}; color-after=${styleColor} magentaInk=${magentaInk}; lock-icon=${lockedIcon} dragBlockedWhileLocked=${dragBlocked}; offscreen-hidden=${hiddenOffscreen} stillSelected=${stillSelected}; shown-after-scroll-back=${shownAgain}; after-delete n=${nAfterDelete} hidden=${hiddenAfterDelete}`);
  }

  // ================= G14: Shift 45 degree (trend line) =================
  await resetAll();
  {
    const xa = await barX(k0), ya = geo.H * 0.5;
    await page.click('#drwTL'); await clickChart(xa, ya);
    await clickChart(xa + 130, ya - 55, ['Shift']); // far from any 45-degree multiple before the snap
    const d = (await getDrawings())[0];
    const xy1 = await timeToXY(d.p1.t, d.p1.p), xy2 = await timeToXY(d.p2.t, d.p2.p);
    const dx = xy2.x - xy1.x, dy = xy2.y - xy1.y, ratio = Math.abs(dy / dx);
    report('G14', Math.abs(ratio - 1) < 0.06, `2nd click dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} |dy/dx|=${ratio.toFixed(3)} (expect ~1.0 for a 45 degree snap)`);
  }

  // ================= G16: Shift square (rectangle) =================
  await resetAll();
  {
    const xa = await barX(k0), ya = geo.H * 0.35;
    await page.click('#drwBox'); await clickChart(xa, ya);
    await clickChart(xa + 150, ya + 70, ['Shift']);
    const d = (await getDrawings())[0];
    const xy1 = await timeToXY(d.p1.t, d.p1.p), xy2 = await timeToXY(d.p2.t, d.p2.p);
    const w = Math.abs(xy2.x - xy1.x), h = Math.abs(xy2.y - xy1.y);
    report('G16', Math.abs(w - h) < 1.5, `box 2nd click dx=150 dy=70 with Shift -> w=${w.toFixed(1)} h=${h.toFixed(1)}`);
  }

  // ================= G15: Shift-drag locks the dominant pixel axis (existing drawing) =================
  // Uses a trend line, not a box: a box's BODY only hits near its edges (drawingAt has no interior/fill
  // hit-test), so clicking a box's geometric center misses it entirely and silently deselects instead.
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 20), ya = geo.H * 0.35, yb = geo.H * 0.55;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb);
    await clickChart((xa + xb) / 2, (ya + yb) / 2); // select (midpoint of the segment is a valid body hit)
    const selAfterClick1 = (await getState()).sel;
    const before = (await getDrawings())[0];
    await dragChart((xa + xb) / 2, (ya + yb) / 2, (xa + xb) / 2 + 55, (ya + yb) / 2 + 8, ['Shift']); // mostly horizontal
    const afterH = (await getDrawings())[0];
    const p1SameH = Math.abs(afterH.p1.p - before.p1.p) < 1e-6, tSameH = afterH.p1.t !== before.p1.t;
    await seed([{ type: 'tl', p1: { t: before.p1.t, p: before.p1.p }, p2: { t: before.p2.t, p: before.p2.p }, color: '#000000' }]);
    await clickChart((xa + xb) / 2, (ya + yb) / 2);
    const selAfterClick2 = (await getState()).sel;
    const before2 = (await getDrawings())[0];
    await dragChart((xa + xb) / 2, (ya + yb) / 2, (xa + xb) / 2 + 8, (ya + yb) / 2 + 55, ['Shift']); // mostly vertical
    const afterV = (await getDrawings())[0];
    const tSameV = afterV.p1.t === before2.p1.t, pSameV = Math.abs(afterV.p1.p - before2.p1.p) < 1e-6;
    report('G15', selAfterClick1 && selAfterClick2 && p1SameH && tSameH && tSameV && !pSameV, `selected before drag: h-case=${selAfterClick1} v-case=${selAfterClick2}; horiz drag(+55,+8): price-unchanged=${p1SameH} time-changed=${tSameH}; vert drag(+8,+55): time-unchanged=${tSameV} price-changed=${!pSameV}`);
  }

  // ================= G18: Ctrl-drag clone =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 16), ya = geo.H * 0.4, yb = geo.H * 0.5;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb);
    await clickChart((xa + xb) / 2, (ya + yb) / 2);
    const before = (await getDrawings())[0];
    await dragChart((xa + xb) / 2, (ya + yb) / 2, (xa + xb) / 2 + 45, (ya + yb) / 2 + 35, ['Control']);
    const list = await getDrawings();
    const origUnchanged = JSON.stringify(list[0].p1) === JSON.stringify(before.p1) && JSON.stringify(list[0].p2) === JSON.stringify(before.p2);
    const cloneSelected = (await getState()).sel;
    const distinctIds = list.length === 2 && list[0].id !== list[1].id;
    const clonedMoved = list.length === 2 && (list[1].p1.p !== before.p1.p || list[1].p1.t !== before.p1.t);
    report('G18', list.length === 2 && origUnchanged && distinctIds && cloneSelected && clonedMoved, `drawings=${list.length}; original unchanged=${origUnchanged}; distinct ids=${distinctIds}; clone selected=${cloneSelected}; clone moved=${clonedMoved}`);
  }

  // ================= G19/G20: Ctrl-click multiselect + group drag + group delete =================
  // Uses two trend lines so the ctrl-click lands on the BODY hit-test branch (drawingAt), which is the
  // only branch that implements multiselect/clone. See the dedicated hl/vline test below for the bug
  // where nearestHandle() intercepts the same gesture before it ever reaches that branch.
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 10), ya = geo.H * 0.25, yb = geo.H * 0.35;
    const xa2 = await barX(k0 + 20), xb2 = await barX(k0 + 30), yc = geo.H * 0.6, yd = geo.H * 0.7;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb); // A
    await page.click('#drwTL'); await clickChart(xa2, yc); await clickChart(xb2, yd); // B
    const midA = { x: (xa + xb) / 2, y: (ya + yb) / 2 }, midB = { x: (xa2 + xb2) / 2, y: (yc + yd) / 2 };
    await clickChart(midA.x, midA.y); // select A
    const afterA = await getState();
    await clickChart(midB.x, midB.y, ['Control']); // ctrl-click B -> add to set
    const afterAB = await getState();
    const list0 = await getDrawings();
    const primaryIsB = await page.evaluate(() => selDrawing && selDrawing.id) === list0[1].id;
    await clickChart(midB.x, midB.y, ['Control']); // ctrl-click B again -> remove
    const afterRemoveB = await getState();
    await clickChart(midB.x, midB.y, ['Control']); // re-add B -> group drag test uses both
    const beforeList = await getDrawings();
    await dragChart(midB.x, midB.y, midB.x + 20, midB.y + 40); // plain drag on a member keeps the group (G19 design)
    const afterList = await getDrawings();
    const dA = afterList[0].p1.p - beforeList[0].p1.p, dB = afterList[1].p1.p - beforeList[1].p1.p;
    const groupMoved = Math.abs(dA - dB) < 1e-6 && Math.abs(dA) > 1e-6;
    await page.keyboard.press('Delete'); await wait(150);
    const nAfterDelete = (await getDrawings()).length;
    const ok = afterA.selCount === 1 && afterAB.selCount === 2 && primaryIsB && afterRemoveB.selCount === 1 && groupMoved && nAfterDelete === 0;
    report('G19-G20', ok, `select A: selSet=${afterA.selCount}; ctrl-click B: selSet=${afterAB.selCount} primary=B:${primaryIsB}; ctrl-click B again: selSet=${afterRemoveB.selCount}; group drag dA=${dA?.toFixed(3)} dB=${dB?.toFixed(3)} equal-delta=${groupMoved}; Delete -> drawings=${nAfterDelete}`);
  }

  // ================= BLOCKER CHECK: Ctrl+click/drag on hl / vline never reaches the multiselect/clone code =================
  // nearestHandle() is checked FIRST in pointerdown, unconditionally (no modifier-key check), and hl/vline
  // handles hit-test by ONE axis only (horiz: any x at that y; vert: any y at that x) -> a click ANYWHERE
  // along a full-span hl/vline always resolves as an anchor-edit, so the ctrl-branch in the BODY hit-test
  // (drawingAt) is unreachable for these two types. Net effect: Ctrl+click never adds them to selSet, and
  // Ctrl+drag does not clone them — it silently drags (mutates) the original anchor instead.
  await resetAll();
  {
    const xa = await barX(k0), ya = geo.H * 0.3, xa2 = await barX(k0 + 20), yc = geo.H * 0.6;
    await page.click('#drwHL'); await clickChart(xa, ya); // A
    await page.click('#drwHL'); await clickChart(xa2, yc); // B
    await clickChart(xa, ya); // select A
    await clickChart(xa2, yc, ['Control']); // ctrl-click B -> SHOULD add B (selSet.size === 2)
    const afterCtrlClick = await getState();
    const beforeDrawings = await getDrawings();
    await dragChart(xa2, yc, xa2, yc + 60, ['Control']); // ctrl-drag B -> SHOULD clone (length 3, B's own price unchanged)
    const afterDrawings = await getDrawings();
    const bPriceUnchanged = Math.abs(afterDrawings[1].p1.p - beforeDrawings[1].p1.p) < 1e-6;
    const cloned = afterDrawings.length === beforeDrawings.length + 1;
    const ok = afterCtrlClick.selCount === 2 && cloned && bPriceUnchanged;
    report('BLOCKER-ctrl-hl-vline', ok, `ctrl-click B on an hl: selSet.size=${afterCtrlClick.selCount} (want 2 -> multiselect broken for hl if 1); ctrl-drag B: drawings ${beforeDrawings.length}->${afterDrawings.length} (want +1 clone), B's own price ${beforeDrawings[1].p1.p.toFixed(3)}->${afterDrawings[1].p1.p.toFixed(3)} unchanged=${bPriceUnchanged} (if it moved, ctrl-drag mutated the original instead of cloning it). Root cause: nearestHandle() in the pointerdown handler runs before any Ctrl check, and hl/vline handles hit-test along their whole span (horiz/vert ignore the other axis), so the ctrl-clone/multiselect branch in drawingAt() is unreachable for these two types.`);
  }

  // ================= G17: dblclick opens settings (tabs, Esc keeps selection) + recolor fib/measure/rr =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 16), ya = geo.H * 0.35, yb = geo.H * 0.55;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb);
    await dblclickChart((xa + xb) / 2, (ya + yb) / 2);
    const panelOpen = await page.evaluate(() => document.getElementById('drawSettings').classList.contains('open'));
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.ds-tab')].map((b) => b.textContent.trim()));
    await page.keyboard.press('Escape'); await wait(150);
    const closedAfterEsc = await page.evaluate(() => !document.getElementById('drawSettings').classList.contains('open'));
    const selKeptAfterEsc = (await getState()).sel;
    report('G17-dblclick', panelOpen && tabs.join(',') === 'Style,Coordinates,Visibility' && closedAfterEsc && selKeptAfterEsc, `panel open=${panelOpen}; tabs=[${tabs.join(', ')}]; Esc closes=${closedAfterEsc}; selection kept=${selKeptAfterEsc}`);
  }
  // fib/measure/rr recolor, driven directly through the settings-panel input, verified against the stored style + render
  await resetAll();
  {
    const bt = await barX(k0), bt2 = await barX(k0 + 16);
    const timeAt = await page.evaluate((x) => xToFreeTime(x), bt);
    const timeAt2 = await page.evaluate((x) => xToFreeTime(x), bt2);
    const priceAt = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.3);
    const priceAt2 = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.5);
    const cases = [
      { type: 'fib', p1: { t: timeAt, p: priceAt2 }, p2: { t: timeAt2, p: priceAt }, color: '#cc4400' },
      { type: 'measure', p1: { t: timeAt, p: priceAt }, p2: { t: timeAt2, p: priceAt2 }, color: '' },
      { type: 'rr', p1: { t: timeAt, p: priceAt }, p2: { t: timeAt2, p: priceAt }, stop: priceAt - 5, target: priceAt2, color: '' },
    ];
    for (const c of cases) {
      await resetAll();
      await seed([c]);
      const d = (await getDrawings())[0];
      const xy1 = await timeToXY(d.p1.t, d.p1.p), xy2 = await timeToXY(d.p2.t, d.p2.p);
      // click a point guaranteed to be ON the shape's hit-test path, and a probe segment guaranteed to be
      // rendered SOLID with style.color (avoids landing in a dash gap or a near-invisible faint fill)
      let clickXY, probe;
      if (c.type === 'fib') {
        clickXY = { x: (xy1.x + xy2.x) / 2, y: (xy1.y + xy2.y) / 2 }; // fib hit-test also accepts the anchor-to-anchor segment
        const g = await page.evaluate((d) => { const xa = drawX(d.p1.t), xb = drawX(d.p2.t); return { xL: Math.min(xa, xb), xR: Math.max(xa, xb) }; }, d);
        const yLevel1 = await page.evaluate((d) => drawY(d.p2.p), d); // level 1.0 sits exactly at p2 -> a solid, non-dashed level line
        probe = { x1: g.xL, y1: yLevel1, x2: g.xR, y2: yLevel1 };
      } else if (c.type === 'measure') {
        clickXY = { x: (xy1.x + xy2.x) / 2, y: (xy1.y + xy2.y) / 2 };
        probe = { x1: xy1.x, y1: xy1.y, x2: xy2.x, y2: xy2.y }; // the diagonal delta line is solid
      } else { // rr: the entry dashed line is fully opaque style.color, but the metric pill (opaque gray,
        // centered on the box) paints over most of its length, and the selected-state blue handle circle
        // sits exactly at its two endpoints — probe a short stretch just past the left handle, before the
        // pill starts, where the dash pattern's "on" segments (5 on / 3 off) are still guaranteed to appear
        clickXY = { x: xy1.x, y: xy1.y };
        const geomRR = await page.evaluate((d) => { const { xa } = rrRange(d, drawX); return { xa, ye: drawY(d.p1.p) }; }, d);
        probe = { x1: geomRR.xa + 5, y1: geomRR.ye, x2: geomRR.xa + 16, y2: geomRR.ye };
      }
      await clickChart(clickXY.x, clickXY.y);
      const selected = (await getState()).sel;
      await page.evaluate(() => { if (selDrawing) openDrawSettings(selDrawing); });
      const hasColorInput = await page.evaluate(() => !!document.querySelector('[data-k="s:color"]'));
      const magentaTest = MAGENTA;
      let magentaBefore = false, magentaAfter = false;
      if (hasColorInput) {
        magentaBefore = await inkAlongSegment(probe.x1, probe.y1, probe.x2, probe.y2, 2, magentaTest);
        await page.evaluate(() => { const inp = document.querySelector('[data-k="s:color"]'); inp.value = '#ff00ff'; inp.dispatchEvent(new Event('input', { bubbles: true })); });
        await wait(150);
        magentaAfter = await inkAlongSegment(probe.x1, probe.y1, probe.x2, probe.y2, 2, magentaTest);
      }
      const storedColor = (await getDrawings())[0].style.color;
      report(`G17-recolor-${c.type}`, selected && hasColorInput && !magentaBefore && magentaAfter && storedColor === '#ff00ff', `selected=${selected}; settings has color input=${hasColorInput}; magenta before=${magentaBefore} after=${magentaAfter}; stored style.color=${storedColor}`);
    }
  }

  // ================= G34: trend line Extend + arrowheads =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 10), ya = geo.H * 0.4, yb = geo.H * 0.45; // shallow slope: keeps the far extended points within [0,H] on both sides
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb);
    const d0 = (await getDrawings())[0];
    const xy1 = await timeToXY(d0.p1.t, d0.p1.p), xy2 = await timeToXY(d0.p2.t, d0.p2.p);
    const slope = (xy2.y - xy1.y) / (xy2.x - xy1.x);
    const leftProbeX = xy1.x - 60, leftProbeY = xy1.y - slope * 60;
    const rightProbeX = xy2.x + 60, rightProbeY = xy2.y + slope * 60;
    const beforeLeft = await ink(leftProbeX, leftProbeY, 2, BLACK);
    const beforeRight = await ink(rightProbeX, rightProbeY, 2, BLACK);
    await clickChart((xa + xb) / 2, (ya + yb) / 2);
    const selectedOk = (await getState()).sel;
    await page.evaluate(() => { selDrawing.extend = 'both'; selDrawing.arrowEnd = true; saveJSON('rt_drawings', drawings); repaintOverlays(); });
    await wait(150);
    const afterLeft = await ink(leftProbeX, leftProbeY, 2, BLACK);
    const afterRight = await ink(rightProbeX, rightProbeY, 2, BLACK);
    // arrowhead: a wing point offset perpendicular from the line near p2, beyond the plain segment end
    const dirx = (xy2.x - xy1.x), diry = (xy2.y - xy1.y), L = Math.hypot(dirx, diry);
    const perpX = -diry / L, perpY = dirx / L;
    const wingX = xy2.x - (dirx / L) * 4 + perpX * 5, wingY = xy2.y - (diry / L) * 4 + perpY * 5;
    const arrowInk = await ink(wingX, wingY, 2, BLACK);
    report('G34', selectedOk && !beforeLeft && !beforeRight && afterLeft && afterRight && arrowInk, `selected=${selectedOk}; before extend: left=${beforeLeft} right=${beforeRight}; after extend=both: left=${afterLeft} right=${afterRight}; arrowEnd wing ink=${arrowInk}`);
  }

  // ================= G39: rectangle Extend + Middle line =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 10), ya = geo.H * 0.3, yb = geo.H * 0.5;
    await page.click('#drwBox'); await clickChart(xa, ya); await clickChart(xb, yb);
    const d0 = (await getDrawings())[0];
    const topY = Math.min((await timeToXY(d0.p1.t, d0.p1.p)).y, (await timeToXY(d0.p2.t, d0.p2.p)).y);
    const edgeX = geo.W - 100; // clear of the price-axis boundary (a probe right at the axis edge finds no canvas pixel at all)
    const beforeEdge = await ink(edgeX, topY, 2, BLUE);
    // box has no interior/fill hit-test -> select via an EDGE point, not the geometric center
    const leftEdgeX = Math.min((await timeToXY(d0.p1.t, d0.p1.p)).x, (await timeToXY(d0.p2.t, d0.p2.p)).x);
    await clickChart(leftEdgeX, (ya + yb) / 2);
    const selectedOk = (await getState()).sel;
    await page.evaluate(() => { selDrawing.extendRight = true; saveJSON('rt_drawings', drawings); repaintOverlays(); });
    await wait(150);
    const afterEdge = await ink(edgeX, topY, 2, BLUE);
    const midY = (await timeToXY(d0.p1.t, d0.p1.p)).y + ((await timeToXY(d0.p2.t, d0.p2.p)).y - (await timeToXY(d0.p1.t, d0.p1.p)).y) / 2;
    const midXInside = (Math.min((await timeToXY(d0.p1.t, d0.p1.p)).x, (await timeToXY(d0.p2.t, d0.p2.p)).x) + Math.max((await timeToXY(d0.p1.t, d0.p1.p)).x, (await timeToXY(d0.p2.t, d0.p2.p)).x)) / 2;
    const beforeMid = await ink(midXInside, midY, 2, BLUE);
    await page.evaluate(() => { selDrawing.middleLine = true; saveJSON('rt_drawings', drawings); repaintOverlays(); });
    await wait(150);
    const afterMid = await ink(midXInside, midY, 2, BLUE);
    // check the hit-test/geometry independently: middle line should be at the price midpoint, not a pixel midpoint of a possibly asymmetric y-scale (they're the same here since price->y is linear, so also assert the analytic price)
    const priceMidOk = Math.abs((d0.p1.p + d0.p2.p) / 2 - (await page.evaluate((y) => candle.coordinateToPrice(y), midY))) < (0.02 * Math.abs(d0.p1.p - d0.p2.p) + 0.5);
    report('G39', selectedOk && !beforeEdge && afterEdge && !beforeMid && afterMid && priceMidOk, `selected=${selectedOk}; extendRight: edge-ink before=${beforeEdge} after=${afterEdge}; middleLine: mid-ink before=${beforeMid} after=${afterMid}; midline price sanity=${priceMidOk}`);
  }

  // ================= G40: fib default 4 levels, selectable extra levels, reverse, extend =================
  await resetAll();
  {
    const bt = await barX(k0), bt2 = await barX(k0 + 16);
    const t1 = await page.evaluate((x) => xToFreeTime(x), bt), t2 = await page.evaluate((x) => xToFreeTime(x), bt2);
    const pHi = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.3);
    const pLo = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.6);
    await seed([{ type: 'fib', p1: { t: t1, p: pLo }, p2: { t: t2, p: pHi }, color: '#cc4400' }]);
    const d = (await getDrawings())[0];
    const storedLevels = d.fibLevels;
    const yAt = async (lv) => page.evaluate(({ p0, span, lv }) => drawY(p0 + span * lv), { p0: d.p1.p, span: d.p2.p - d.p1.p, lv });
    const xL = (await timeToXY(d.p1.t, d.p1.p)).x, xR = (await timeToXY(d.p2.t, d.p2.p)).x;
    const midX = (Math.min(xL, xR) + Math.max(xL, xR)) / 2;
    // NOT midX: the anchor-to-anchor dashed diagonal (always drawn) necessarily crosses near the geometric
    // midpoint at close to the 0.5-level's own y, which would falsely read as "0.5 level drawn" even when
    // it isn't selected. Probe near xR instead, where the diagonal sits close to the p2/level-1 y (far from
    // the other levels' y-values) and can't be confused with a selectable level line.
    const probeX = Math.max(xL, xR) - 8;
    const y236 = await yAt(0.236), y5 = await yAt(0.5), y618 = await yAt(0.618), y1 = await yAt(1);
    const has236 = await ink(probeX, y236, 2, ORANGE), has5before = await ink(probeX, y5, 2, ORANGE), has618 = await ink(probeX, y618, 2, ORANGE), has1 = await ink(probeX, y1, 2, ORANGE);
    await clickChart(xL, (await timeToXY(d.p1.t, d.p1.p)).y);
    const selectedOk = (await getState()).sel;
    await page.evaluate(() => applyDrawSetting(selDrawing, 'fib:0.5', true));
    await wait(150);
    const has5after = await ink(probeX, y5, 2, ORANGE);
    // reverse: 0.236 level's y should move (anchor flips)
    const y236before = y236;
    await page.evaluate(() => applyDrawSetting(selDrawing, 'd:reverse', true));
    await wait(150);
    const dRev = (await getDrawings())[0];
    const y236afterRev = await page.evaluate(({ p0, span, lv }) => drawY(p0 + span * lv), { p0: dRev.reverse ? dRev.p2.p : dRev.p1.p, span: dRev.reverse ? dRev.p1.p - dRev.p2.p : dRev.p2.p - dRev.p1.p, lv: 0.236 });
    const reverseChanged = Math.abs(y236afterRev - y236before) > 5;
    await page.evaluate(() => applyDrawSetting(selDrawing, 'd:reverse', false)); // undo reverse before extend test
    // extendLeft
    const leftProbeX = Math.min(xL, xR) - 40;
    const beforeExtLeft = await ink(leftProbeX, y1, 2, ORANGE);
    await page.evaluate(() => applyDrawSetting(selDrawing, 'd:extendLeft', true));
    await wait(150);
    const afterExtLeft = await ink(leftProbeX, y1, 2, ORANGE);
    const ok = selectedOk && storedLevels === undefined && has236 && !has5before && has618 && has1 && has5after && reverseChanged && !beforeExtLeft && afterExtLeft;
    report('G40', ok, `selected=${selectedOk}; default fibLevels(stored)=${storedLevels}; ink 0.236=${has236} 0.5(before)=${has5before} 0.618=${has618} 1=${has1}; after adding 0.5: ink=${has5after}; reverse moved 0.236 line: ${reverseChanged} (dy=${(y236afterRev - y236before).toFixed(1)}); extendLeft: before=${beforeExtLeft} after=${afterExtLeft}`);
  }

  // ================= G41: Coordinates tab — bar number (future allowed) + price =================
  await resetAll();
  {
    const bt = await barX(k0), bt2 = await barX(k0 + 16);
    const t1 = await page.evaluate((x) => xToFreeTime(x), bt), t2 = await page.evaluate((x) => xToFreeTime(x), bt2);
    const p1v = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.4);
    const p2v = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.5);
    await seed([{ type: 'tl', p1: { t: t1, p: p1v }, p2: { t: t2, p: p2v }, color: '#000000' }]);
    const xyA = await timeToXY(t1, p1v), xyB = await timeToXY(t2, p2v);
    await clickChart((xyA.x + xyB.x) / 2, (xyA.y + xyB.y) / 2); // click the segment midpoint -> selects it
    await page.evaluate(() => openDrawSettings(selDrawing, 'coords'));
    const lastBarTime = await page.evaluate(() => bars[Math.min(idx, bars.length - 1)].time);
    const futureBarNo = await page.evaluate(() => Math.round((idx - seriesFrom)) + 1390);
    const priceInput = await page.evaluate(() => { const rows = [...document.querySelectorAll('#drawSettings [data-k]')]; return rows.map((r) => r.dataset.k); });
    // find the p2 bar-number ("t:p2") and p2 price ("p:p2") inputs
    await page.evaluate((v) => { const inp = document.querySelector('[data-k="t:p2"]'); inp.value = String(v); inp.dispatchEvent(new Event('input', { bubbles: true })); }, futureBarNo);
    await wait(150);
    const d1 = (await getDrawings())[0];
    const wentFuture = d1.p2.t > lastBarTime;
    await page.evaluate((v) => { const inp = document.querySelector('[data-k="p:p1"]'); inp.value = String(v); inp.dispatchEvent(new Event('input', { bubbles: true })); }, (p1v + 7).toFixed(2));
    await wait(150);
    const d2 = (await getDrawings())[0];
    const priceMoved = Math.abs(d2.p1.p - (p1v + 7)) < 0.01;
    report('G41', priceInput.length > 0 && wentFuture && priceMoved, `coord inputs present=${priceInput.length}; p2 bar# -> ${futureBarNo}: p2.t=${d1.p2.t} > lastBar ${lastBarTime} = ${wentFuture}; p1 price -> ${(p1v + 7).toFixed(2)}: applied=${priceMoved}`);
  }

  // ================= G42: Visibility per timeframe (continue, not return -> other drawings unaffected) =================
  await resetAll();
  {
    const bt = await barX(k0), bt2 = await barX(k0 + 20);
    const t1 = await page.evaluate((x) => xToFreeTime(x), bt), t2 = await page.evaluate((x) => xToFreeTime(x), bt2);
    const pA = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.3);
    const pB = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.6);
    await seed([
      { type: 'hl', p1: { t: t1, p: pA }, color: '#000000', visibleTFs: [5] }, // A: only visible at 5m
      { type: 'hl', p1: { t: t2, p: pB }, color: '#000000' }, // B: all timeframes
    ]);
    const yA = await page.evaluate((p) => drawY(p), pA);
    const yB = await page.evaluate((p) => drawY(p), pB);
    const drawnAt1m = await page.evaluate(() => window.__drwDbg && window.__drwDbg.drawn);
    const aInkAt1m = await ink(geo.W / 2, yA, 2);
    const bInkAt1m = await ink(geo.W / 2, yB, 2);
    const hitA1m = await page.evaluate((y) => { const w = document.getElementById('chart').clientWidth; return drawingAt(w / 2, y); }, yA);
    await page.evaluate(() => setTf(5));
    await page.waitForTimeout(400);
    await paint();
    // recompute y from the (unchanged) stored price: the visible price range re-fits per timeframe, so a
    // fixed price's pixel row can shift after the switch even though the drawing itself did not move
    const yA5 = await page.evaluate((p) => drawY(p), pA), yB5 = await page.evaluate((p) => drawY(p), pB);
    const aInkAt5m = await ink(geo.W / 2, yA5, 2);
    const bInkAt5m = await ink(geo.W / 2, yB5, 2);
    await page.evaluate(() => setTf(1)); // restore
    await page.waitForTimeout(400);
    report('G42', !aInkAt1m && hitA1m === null && bInkAt1m && aInkAt5m && bInkAt5m, `at tf=1m: A(visibleTFs=[5]) ink=${aInkAt1m} hit=${hitA1m}; B(all) ink=${bInkAt1m}; at tf=5m: A ink=${aInkAt5m}; B ink still=${bInkAt5m}`);
  }

  // ================= G43: Lock blocks drag, not select (anchor + body) =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 16), ya = geo.H * 0.35, yb = geo.H * 0.55;
    await page.click('#drwTL'); await clickChart(xa, ya); await clickChart(xb, yb);
    await page.click('#btnLockDrw'); await wait(120);
    const lockedFlag = await page.evaluate(() => drawingsLocked);
    const persisted = await page.evaluate(() => loadJSON('rt_lockdrw', null));
    const btnActive = await page.evaluate(() => document.getElementById('btnLockDrw').classList.contains('active'));
    // body drag while locked
    const before = (await getDrawings())[0];
    await clickChart((xa + xb) / 2, (ya + yb) / 2);
    const selectedWhileLocked = (await getState()).sel;
    await dragChart((xa + xb) / 2, (ya + yb) / 2, (xa + xb) / 2 + 50, (ya + yb) / 2 + 30);
    const afterBodyDrag = (await getDrawings())[0];
    const bodyBlocked = JSON.stringify(before.p1) === JSON.stringify(afterBodyDrag.p1) && JSON.stringify(before.p2) === JSON.stringify(afterBodyDrag.p2);
    // anchor drag while locked
    await dragChart(xa, ya, xa + 40, ya + 25);
    const afterAnchorDrag = (await getDrawings())[0];
    const anchorBlocked = JSON.stringify(before.p1) === JSON.stringify(afterAnchorDrag.p1);
    await page.click('#btnLockDrw'); await wait(120);
    const unlockedFlag = await page.evaluate(() => drawingsLocked);
    // now drag should work
    await clickChart((xa + xb) / 2, (ya + yb) / 2);
    await dragChart((xa + xb) / 2, (ya + yb) / 2, (xa + xb) / 2 + 50, (ya + yb) / 2 + 30);
    const afterUnlockDrag = (await getDrawings())[0];
    const dragWorksAfterUnlock = JSON.stringify(before.p1) !== JSON.stringify(afterUnlockDrag.p1);
    report('G43', lockedFlag && persisted === true && btnActive && selectedWhileLocked && bodyBlocked && anchorBlocked && !unlockedFlag && dragWorksAfterUnlock, `locked=${lockedFlag} persisted=${persisted} btn active=${btnActive}; selected while locked=${selectedWhileLocked}; body drag blocked=${bodyBlocked}; anchor drag blocked=${anchorBlocked}; unlocked=${!unlockedFlag}; drag works after unlock=${dragWorksAfterUnlock}`);
  }

  // ================= REGRESSION: place/select/drag/delete smoke for every type =================
  await resetAll();
  {
    const xa = await barX(k0), xb = await barX(k0 + 14), ya = geo.H * 0.3, yb = geo.H * 0.5;
    const place2pt = async (btn) => { await page.click('#' + btn); await clickChart(xa, ya); await clickChart(xb, yb); };
    const cases = [
      { id: 'drwHL', oneClick: true }, { id: 'drwTL' }, { id: 'drwBox' }, { id: 'drwFib' }, { id: 'drwMeasure' }, { id: 'drwRR', oneClick: true },
      { id: 'drwHRay', oneClick: true }, { id: 'drwVLine', oneClick: true }, { id: 'drwCross', oneClick: true },
    ];
    const rows = [];
    for (const c of cases) {
      await resetAll();
      if (c.oneClick) { await page.click('#' + c.id); await clickChart(xa, ya); } else { await place2pt(c.id); }
      const placed = (await getDrawings()).length === 1;
      const cx = c.oneClick ? xa : (xa + xb) / 2, cy = c.oneClick ? ya : (ya + yb) / 2;
      // box has no interior hit-test (only its edges/corners) -> click a point on its left edge, not the center
      const clickXY = c.id === 'drwVLine' ? { x: xa, y: geo.H / 2 } : c.id === 'drwHL' ? { x: geo.W / 2, y: ya } : c.id === 'drwBox' ? { x: xa, y: cy } : { x: cx, y: cy };
      await clickChart(clickXY.x, clickXY.y);
      const selected = (await getState()).sel;
      const before = (await getDrawings())[0];
      await dragChart(clickXY.x, clickXY.y, clickXY.x + 20, clickXY.y + 15);
      const after = (await getDrawings())[0];
      const moved = JSON.stringify(before) !== JSON.stringify(after);
      await page.keyboard.press('Delete'); await wait(150);
      const deleted = (await getDrawings()).length === 0;
      rows.push(`${c.id}:placed=${placed},sel=${selected},moved=${moved},del=${deleted}`);
    }
    const allOk = rows.every((r) => !r.includes('=false'));
    report('REGRESSION-shapes', allOk, rows.join(' | '));
  }

  // ================= REGRESSION: annotation tools + trading hotkeys + order placement =================
  await resetAll();
  {
    const before = await page.evaluate(() => annotations.length);
    const barXY = { x: await barX(geo.idx - 5), y: geo.H * 0.5 };
    await page.click('#annUp'); await clickChart(barXY.x, barXY.y); // arms the tool, then places it on a real bar (bar-bound click branch)
    const afterUp = await page.evaluate(() => annotations.length);
    const toolClearedAfter = await page.evaluate(() => tool);
    // trading hotkeys via keyboard (document-level handler)
    await page.evaluate(() => { if (position) flatten(); if (entryOrder) cancelEntry(); });
    await page.keyboard.press('b'); await wait(200);
    const afterBuy = await page.evaluate(() => (position ? position.side : null));
    await page.keyboard.press('x'); await wait(200);
    const afterFlatten = await page.evaluate(() => position);
    await page.keyboard.press('s'); await wait(200);
    const afterSell = await page.evaluate(() => (position ? position.side : null));
    await page.evaluate(() => flatten());
    await page.keyboard.press('f'); await wait(200);
    const afterBuyStop = await page.evaluate(() => (entryOrder ? entryOrder.side : null));
    await page.evaluate(() => cancelEntry());
    await page.keyboard.press('j'); await wait(200);
    const afterSellStop = await page.evaluate(() => (entryOrder ? entryOrder.side : null));
    await page.evaluate(() => cancelEntry());
    const ok = afterUp === before + 1 && toolClearedAfter === '' && afterBuy === 'long' && afterFlatten === null && afterSell === 'short' && afterBuyStop === 'long' && afterSellStop === 'short';
    report('REGRESSION-hotkeys', ok, `annUp: ${before}->${afterUp} tool='${toolClearedAfter}'; B->pos=${afterBuy}; X->flat=${afterFlatten === null}; S->pos=${afterSell}; F->entry=${afterBuyStop}; J->entry=${afterSellStop}`);
  }

  // ================= REGRESSION: timeframe switch, day switch, no console/page errors, __drw.err =================
  await resetAll();
  {
    const bt = await barX(k0);
    const t1 = await page.evaluate((x) => xToFreeTime(x), bt);
    const p1v = await page.evaluate((y) => candle.coordinateToPrice(y), geo.H * 0.4);
    await seed([{ type: 'hl', p1: { t: t1, p: p1v }, color: '#000000' }]);
    const beforeT = (await getDrawings())[0].p1.t;
    await page.evaluate(() => setTf(5));
    await page.waitForTimeout(400);
    const afterTfT = (await getDrawings())[0].p1.t;
    const errAfterTf = await page.evaluate(() => window.__drw && window.__drw.err);
    await page.evaluate(() => setTf(1));
    await page.waitForTimeout(400);
    await page.evaluate(() => nextDay());
    await page.waitForTimeout(600);
    const errAfterDay = await page.evaluate(() => window.__drw && window.__drw.err);
    const pageErrs = errs.length;
    report('REGRESSION-tf-day', beforeT === afterTfT && errAfterTf === undefined && errAfterDay === undefined && pageErrs === 0, `t unchanged across tf switch=${beforeT === afterTfT}; __drw.err after tf=${errAfterTf}; after day-switch=${errAfterDay}; cumulative console/page errors=${pageErrs}`);
  }

  // ================= REGRESSION: drawings do not drift after replaying hundreds of bars =================
  await boot(); // fresh, deterministic idx
  {
    const g = await page.evaluate(() => ({ idx, barsLen: bars.length }));
    const k = g.idx - 30;
    const t = await page.evaluate((k) => bars[k].time, k);
    const p = await page.evaluate((y) => candle.coordinateToPrice(y), 300);
    await seed([{ type: 'hl', p1: { t, p }, color: '#000000' }]);
    const steps = Math.min(300, g.barsLen - g.idx - 5);
    await page.evaluate((n) => { for (let i = 0; i < n; i++) stepAny(); }, steps);
    await page.waitForTimeout(300);
    const d = (await getDrawings())[0];
    const tpUnchanged = d.p1.t === t && d.p1.p === p;
    const stillRendersFinite = await page.evaluate((p) => { const x = drawX(bars[0].time); const y = drawY(p); return isFinite(x) && isFinite(y); }, p);
    const err = await page.evaluate(() => window.__drw && window.__drw.err);
    report('REGRESSION-drift', tpUnchanged && stillRendersFinite && err === undefined, `advanced ${steps} bars; stored {t,p} unchanged=${tpUnchanged}; still renders finite coords=${stillRendersFinite}; __drw.err=${err}`);
  }

  // ================= REGRESSION: v0 drawings migrate =================
  {
    await page.goto(URL, { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.removeItem('rt_drawings_v');
      localStorage.setItem('rt_drawings', JSON.stringify([{ type: 'hl', p1: { t: 1700000000, p: 100.25 }, color: '#123456' }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 100, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const migrated = await page.evaluate(() => ({ color: drawings[0] && drawings[0].style && drawings[0].style.color, hasId: !!(drawings[0] && drawings[0].id), v: loadJSON('rt_drawings_v', -1), hiddenField: drawings[0] && drawings[0].hidden, lockedField: drawings[0] && drawings[0].locked }));
    report('REGRESSION-migrate-v0', migrated.color === '#123456' && migrated.hasId && migrated.v === 1 && migrated.hiddenField === false && migrated.lockedField === false, `style.color=${migrated.color}; id assigned=${migrated.hasId}; rt_drawings_v=${migrated.v}; hidden=${migrated.hiddenField} locked=${migrated.lockedField}`);
  }

} catch (e) {
  report('SUITE-EXCEPTION', false, String(e && e.stack || e));
} finally {
  const finalErrs = errs.length;
  report('FINAL-no-console-errors', finalErrs === 0, `cumulative console/page errors=${finalErrs}${finalErrs ? ' [' + errs.slice(0, 5).join(' | ') + ']' : ''}`);
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} PASS`);
process.exit(fails.length ? 1 : 0);
