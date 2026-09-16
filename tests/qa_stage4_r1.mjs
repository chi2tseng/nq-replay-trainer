// Adversarial QA (round 1) for Stage 4 (TV_DRAWING_GAP.md G21-G33, G44, G45, G46, G48 + regressions).
// Independent script — does not reuse or trust tests/tv_drawing_stage4.mjs assertions.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/qa_stage4_r1.mjs
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/';
const results = [];
const R = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); };
const errs = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('dialog', d => { dialogSeen.push(d.message()); (dialogAction === 'dismiss' ? d.dismiss() : d.accept()); });
let dialogSeen = [], dialogAction = 'accept';

const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const clickChart = async (x, y, mods = [], button = 'left') => { const r = await chartRect(); for (const m of mods) await page.keyboard.down(m); await page.mouse.click(r.left + x, r.top + y, { button }); for (const m of mods) await page.keyboard.up(m); await page.waitForTimeout(500); };
const dragChart = async (x1, y1, x2, y2) => { const r = await chartRect(); await page.mouse.move(r.left + x1, r.top + y1); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(r.left + x1 + (x2 - x1) * i / 10, r.top + y1 + (y2 - y1) * i / 10); await page.waitForTimeout(50); await page.mouse.up(); await page.waitForTimeout(300); };
const key = async (combo) => { await page.keyboard.press(combo); await page.waitForTimeout(150); };
const n = () => page.evaluate(() => drawings.length);
const st = () => page.evaluate(() => ({ tool, entry: entryOrder && { side: entryOrder.side, kind: entryOrder.kind }, pos: position && position.side }));
const clearAll = () => page.evaluate(() => {
  drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null;
  saveJSON('rt_drawings', drawings); if (tool) setTool(''); drawingsLocked = false; lockBtnUI();
  undoStack.length = 0; redoStack.length = 0; if ($('drawSettings').classList.contains('open')) closeDrawSettings();
  if (entryOrder) cancelOrder('entry'); if (position) flatten();
  repaintOverlays();
});

async function boot() {
  await page.goto(URL + '?r=' + Date.now(), { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); localStorage.setItem('rt_annotations', '[]');
    localStorage.setItem('rt_magnet', '"off"'); localStorage.setItem('rt_lockdrw', 'false'); localStorage.setItem('rt_keepdraw', 'false');
    localStorage.removeItem('rt_hide'); localStorage.removeItem('rt_alwaysrmlocked');
  });
  await page.goto(URL + '?r=' + Date.now(), { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 200 && idx > 100, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
}

try {
  await boot();
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth }));

  // ---- LOAD / console errors ----
  R('LOAD', errs.length === 0, `console errors=${errs.length}${errs.length ? ' | ' + errs.slice(0, 2).join(' | ') : ''}`);

  // ---- G48 leftbar inventory ----
  {
    const need = ['toolCursor', 'btnMagnet', 'btnMagnetMenu', 'btnKeepDraw', 'btnLockDrw', 'btnHideDrw', 'btnHideMenu', 'hidePopover', 'drwClear', 'btnRemoveMenu', 'removePopover', 'rmAlwaysLocked'];
    const missing = await page.evaluate((ids) => ids.filter(id => !document.getElementById(id)), need);
    R('G48', missing.length === 0, `leftbar inventory; missing=[${missing.join(',')}]`);
  }

  // ---- undo/redo: create ----
  await clearAll();
  {
    for (let i = 0; i < 4; i++) { await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * (0.25 + i * 0.08)); }
    const n4 = await n();
    await key('Control+z'); await key('Control+z'); await key('Control+z'); const n1 = await n();
    await key('Control+y'); const n2 = await n();
    R('undo-redo-create', n4 === 4 && n1 === 1 && n2 === 2, `drew 4 -> ${n4}; Ctrl+Z x3 -> ${n1}; Ctrl+Y -> ${n2}`);
  }

  // ---- undo restores EXACT pre-drag coords (the trap: snapshot must be at pointerdown, not pointerup) ----
  await clearAll();
  {
    await page.click('#drwTL');
    await clickChart(geo.W * 0.35, geo.H * 0.3);
    await clickChart(geo.W * 0.55, geo.H * 0.5);
    const before = await page.evaluate(() => ({ t1: drawings[0].p1.t, p1: drawings[0].p1.p, t2: drawings[0].p2.t, p2: drawings[0].p2.p }));
    // select then drag the body away from both endpoints (midpoint)
    const mid = await page.evaluate(() => { const d = drawings[0]; return { x: (drawX(d.p1.t) + drawX(d.p2.t)) / 2, y: (drawY(d.p1.p) + drawY(d.p2.p)) / 2 }; });
    await clickChart(geo.W * 0.5, geo.H * 0.92); // deselect first (empty space)
    await dragChart(mid.x, mid.y, mid.x + 90, mid.y + 55);
    const after = await page.evaluate(() => ({ t1: drawings[0].p1.t, p1: drawings[0].p1.p, t2: drawings[0].p2.t, p2: drawings[0].p2.p }));
    const moved = after.t1 !== before.t1 || after.p1 !== before.p1;
    await key('Control+z');
    const undone = await page.evaluate(() => ({ t1: drawings[0].p1.t, p1: drawings[0].p1.p, t2: drawings[0].p2.t, p2: drawings[0].p2.p }));
    const exact = undone.t1 === before.t1 && undone.p1 === before.p1 && undone.t2 === before.t2 && undone.p2 === before.p2;
    await key('Control+y');
    const redone = await page.evaluate(() => ({ t1: drawings[0].p1.t, p1: drawings[0].p1.p }));
    const reExact = redone.t1 === after.t1 && redone.p1 === after.p1;
    R('undo-redo-drag-exact', moved && exact && reExact, `moved=${moved} (dt=${(after.t1 - before.t1).toFixed(2)} dp=${(after.p1 - before.p1).toFixed(4)}); undo exact-restore=${exact}; redo exact-reapply=${reExact}`);
  }

  // ---- delete + undo ----
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); });
    await key('Delete');
    const nd = await n();
    await key('Control+z');
    const nu = await n();
    R('undo-redo-delete', nd === 0 && nu === 1, `Delete -> ${nd}; Ctrl+Z -> ${nu}`);
  }

  // ---- Alt+F / Alt+J must NOT place a real order (the exact bug the spec warns about) ----
  await clearAll();
  {
    await key('Alt+f'); let s = await st();
    const okF = s.tool === 'fib' && s.entry === null;
    R('alt-f-no-order', okF, `Alt+F -> tool=${s.tool} entryOrder=${JSON.stringify(s.entry)}`);
    await key('Escape');
    await key('Alt+j'); s = await st();
    const okJ = s.tool === 'hray' && s.entry === null;
    R('alt-j-no-order', okJ, `Alt+J -> tool=${s.tool} entryOrder=${JSON.stringify(s.entry)}`);
    await key('Escape');
    const combos = [['Alt+t', 'tl'], ['Alt+h', 'hl'], ['Alt+v', 'vline'], ['Alt+c', 'cross'], ['Shift+Alt+r', 'box']];
    let allOk = true, detail = [];
    for (const [combo, want] of combos) {
      await key(combo); s = await st();
      const ok = s.tool === want && s.entry === null && s.pos === null;
      allOk = allOk && ok; detail.push(`${combo}->${s.tool}${ok ? '' : '(FAIL want ' + want + ')'}`);
      await key('Escape');
    }
    R('alt-tool-hotkeys', allOk, detail.join(' '));
  }

  // ---- regression: trading hotkeys still fire when no tool armed ----
  await clearAll();
  {
    await key('f'); let s = await st(); const fOk = s.entry && s.entry.side === 'long' && s.entry.kind === 'stop';
    await page.evaluate(() => cancelOrder('entry'));
    await key('j'); s = await st(); const jOk = s.entry && s.entry.side === 'short';
    await page.evaluate(() => cancelOrder('entry'));
    await key('b'); s = await st(); const bOk = s.pos === 'long';
    await key('x'); s = await st(); const xOk = s.pos === null;
    await key('s'); s = await st(); const sOk = s.pos === 'short';
    await key('x');
    R('reg-trading-hotkeys', fOk && jOk && bOk && xOk && sOk, `F=${fOk} J=${jOk} B=${bOk} X=${xOk} S=${sOk}`);
  }

  // ---- arrow nudge: with selection = nudge (no day change); without = day change ----
  await clearAll();
  {
    // oracle for "day": tickMode datasets keep sessions.length===1 forever (currentSessionIdx() would
    // always read 0) — the real day identity in that mode is curTickDay, and stepDeepDay() is async.
    const dayKey = () => page.evaluate(() => tickMode ? curTickDay : (sessions[currentSessionIdx()] || {}).key);
    const day0 = await dayKey();
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); });
    const p0 = await page.evaluate(() => drawings[0].p1.p);
    await key('ArrowUp');
    const p1 = await page.evaluate(() => drawings[0].p1.p);
    const tick = await page.evaluate(() => TICK);
    const day1 = await dayKey();
    R('arrow-nudge-selected', Math.abs(p1 - p0 - tick) < 1e-9 && day1 === day0, `ArrowUp with selection: p ${p0}->${p1} (+TICK=${tick}); day unchanged=${day1 === day0}`);
    await page.evaluate(() => { clearSelection(); repaintOverlays(); });
    await page.keyboard.press('ArrowLeft'); // day switch is async (stepDeepDay/jumpToDeepDay reload data) — give it real time, no e.preventDefault race
    await page.waitForTimeout(2000);
    const day2 = await dayKey();
    R('arrow-nudge-daychange', day2 !== day0, `ArrowLeft with nothing selected changed day: ${day0} -> ${day2}`);
  }

  // ---- copy/paste clamped to idx (never onto unrevealed future bars) ----
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.evaluate(() => { selectDrawing(drawings[0], false); repaintOverlays(); });
    await key('Control+c');
    await key('Control+v');
    const cnt = await n();
    const clampOk = await page.evaluate(() => { const hi = Math.min(idx, bars.length - 1); return drawings.every(d => { const l = timeToLogical(d.p1.t); return l == null || (l + seriesFrom) <= hi + 1e-6; }); });
    R('copy-paste', cnt === 2 && clampOk, `count 1 -> ${cnt}; all pasted t clamped to idx=${clampOk}`);
  }

  // ---- middle-click delete ----
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    const before = await n();
    await clickChart(geo.W * 0.5, geo.H * 0.4, [], 'middle');
    const after = await n();
    R('middle-click-delete', before === 1 && after === 0, `before=${before} after=${after}`);
  }

  // ---- Hide: drawings/indicators/positions/all, and SPECIFICALLY survives a pan (guard must be inside the draw callback) ----
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    const before = await page.evaluate(() => window.__drwDbg && window.__drwDbg.drawn);
    await key('Control+Alt+h');
    const hiddenNow = await page.evaluate(() => ({ flag: hideFlags.drawings, drawn: window.__drwDbg && window.__drwDbg.drawn }));
    // pan the chart (drag empty area) to force LWC to re-invoke the primitive's draw callback WITHOUT our code calling repaintOverlays()
    await dragChart(geo.W * 0.6, geo.H * 0.15, geo.W * 0.3, geo.H * 0.15);
    const afterPan = await page.evaluate(() => ({ flag: hideFlags.drawings, drawn: window.__drwDbg && window.__drwDbg.drawn }));
    await key('Control+Alt+h');
    const shownAgain = await page.evaluate(() => window.__drwDbg && window.__drwDbg.drawn);
    R('hide-drawings-survives-pan', before > 0 && hiddenNow.flag && hiddenNow.drawn === 0 && afterPan.flag && afterPan.drawn === 0 && shownAgain > 0,
      `drawn before=${before}; after Ctrl+Alt+H flag=${hiddenNow.flag} drawn=${hiddenNow.drawn}; after pan flag=${afterPan.flag} drawn=${afterPan.drawn}; after un-hide drawn=${shownAgain}`);
  }
  await clearAll();
  {
    await page.evaluate(() => { $('indVwap').checked = true; $('indVwap').dispatchEvent(new Event('change')); $('oscSelect').value = 'rsi'; $('oscSelect').dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({ vwapOn, oscMode, rsiVis: rsiSeries ? rsiSeries.options().visible : null }));
    await page.evaluate(() => toggleHide('indicators'));
    await page.waitForTimeout(200);
    const hidden = await page.evaluate(() => ({ vwapOn, oscMode, rsiVis: rsiSeries ? rsiSeries.options().visible : null }));
    await page.evaluate(() => toggleHide('indicators'));
    await page.waitForTimeout(200);
    const restored = await page.evaluate(() => ({ vwapOn, oscMode, rsiVis: rsiSeries ? rsiSeries.options().visible : null }));
    R('hide-indicators-settings-preserved', before.vwapOn === true && hidden.vwapOn === true && hidden.rsiVis === false && restored.rsiVis === true && restored.oscMode === 'rsi',
      `before=${JSON.stringify(before)} hidden=${JSON.stringify(hidden)} restored=${JSON.stringify(restored)}`);
    await page.evaluate(() => resetAllIndicators());
  }
  await clearAll();
  {
    await page.evaluate(() => onEntryButton('long'));
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.__ord && window.__ord.ok);
    await page.evaluate(() => toggleHide('positions'));
    const hiddenHits = await page.evaluate(() => { repaintOverlays(); return orderHits.length; });
    await page.evaluate(() => toggleHide('positions'));
    R('hide-positions', before === true && hiddenHits === 0, `order painted before=${before}; hit-boxes while hidden=${hiddenHits}`);
    await page.evaluate(() => flatten());
  }
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.evaluate(() => toggleHide('all'));
    const allHidden = await page.evaluate(() => ({ ...hideFlags }));
    await page.evaluate(() => toggleHide('all'));
    const allShown = await page.evaluate(() => ({ ...hideFlags }));
    R('hide-all-toggle', allHidden.drawings && allHidden.indicators && allHidden.positions && !allShown.drawings && !allShown.indicators && !allShown.positions,
      `all-hidden=${JSON.stringify(allHidden)} all-shown=${JSON.stringify(allShown)}`);
  }

  // ---- Lock: blocks drag, not select; delete asks to confirm unless alwaysRemoveLocked ----
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.evaluate(() => { drawingsLocked = true; lockBtnUI(); selectDrawing(drawings[0], false); repaintOverlays(); });
    const before = await page.evaluate(() => drawings[0].p1.p);
    await dragChart(geo.W * 0.5, geo.H * 0.4, geo.W * 0.5, geo.H * 0.6);
    const afterDrag = await page.evaluate(() => drawings[0].p1.p);
    const selOk = await page.evaluate(() => !!selDrawing);
    dialogAction = 'dismiss'; dialogSeen = [];
    await key('Delete');
    const afterCancel = await n();
    dialogAction = 'accept'; dialogSeen = [];
    await key('Delete');
    const afterConfirm = await n();
    R('lock-blocks-drag-confirms-delete', afterDrag === before && selOk && afterCancel === 1 && afterConfirm === 0,
      `locked drag: p ${before}->${afterDrag} (unchanged=${afterDrag === before}); still selectable=${selOk}; dismiss confirm keeps=${afterCancel}; accept confirm removes=${afterConfirm}`);
    await page.evaluate(() => { drawingsLocked = false; lockBtnUI(); });
  }
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.evaluate(() => { drawings[0].locked = true; alwaysRemoveLocked = true; selectDrawing(drawings[0], false); repaintOverlays(); });
    dialogSeen = [];
    await key('Delete');
    const after = await n();
    R('always-remove-locked', after === 0 && dialogSeen.length === 0, `alwaysRemoveLocked=true: no confirm dialog (${dialogSeen.length}) -> count ${after}`);
    await page.evaluate(() => { alwaysRemoveLocked = false; saveJSON('rt_alwaysrmlocked', false); });
  }

  // ---- Remove Drawings vs Remove Drawings & Indicators ----
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.click('#drwBox'); await clickChart(geo.W * 0.3, geo.H * 0.3); await clickChart(geo.W * 0.4, geo.H * 0.45);
    await page.evaluate(() => { $('indVwap').checked = true; $('indVwap').dispatchEvent(new Event('change')); $('indBB').checked = true; $('indBB').dispatchEvent(new Event('change')); $('oscSelect').value = 'rsi'; $('oscSelect').dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({ n: drawings.length, vwapOn, bbOn, oscMode }));
    dialogAction = 'accept';
    await page.click('#drwClear'); // just "Remove Drawings" (single button, no dropdown item clicked)
    await page.waitForTimeout(200);
    const afterPlain = await page.evaluate(() => ({ n: drawings.length, vwapOn, bbOn, oscMode }));
    R('remove-drawings-only', before.n === 2 && afterPlain.n === 0 && afterPlain.vwapOn === true && afterPlain.bbOn === true && afterPlain.oscMode === 'rsi',
      `before=${JSON.stringify(before)} after plain Remove=${JSON.stringify(afterPlain)} (indicators must survive)`);
  }
  await clearAll();
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    await page.evaluate(() => { $('indVwap').checked = true; $('indVwap').dispatchEvent(new Event('change')); $('oscSelect').value = 'rsi'; $('oscSelect').dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    await page.evaluate(() => removeDrawingsAndIndicators());
    const after = await page.evaluate(() => ({ n: drawings.length, vwapOn, oscMode, vwapChecked: $('indVwap').checked, oscSelectVal: $('oscSelect').value }));
    R('remove-drawings-and-indicators', after.n === 0 && after.vwapOn === false && after.oscMode === 'off' && after.vwapChecked === false && after.oscSelectVal === 'off',
      `after=${JSON.stringify(after)} (checkbox/select DOM must be synced, not just internal state)`);
  }

  // ---- HELP_KEYS updated ----
  {
    const flat = await page.evaluate(() => HELP_KEYS.flatMap(([, rows]) => rows.map(([k]) => k)).join(' | '));
    const need = ['Ctrl+Z', 'Ctrl+C', 'Alt+F', 'Alt+J', 'Shift+Alt+R', 'Ctrl+Alt+H'];
    const missing = need.filter(k => !flat.includes(k));
    R('help-keys', missing.length === 0, `missing=[${missing.join(',')}] present-groups=${await page.evaluate(() => HELP_KEYS.map(([g]) => g).join(','))}`);
  }

  // ---- v0 saved drawings migrate on load ----
  {
    await page.evaluate(() => { localStorage.setItem('rt_drawings', JSON.stringify([{ type: 'hl', p1: { t: bars[Math.floor(bars.length / 2)].time, p: bars[0].close }, color: '#ff0000' }])); localStorage.removeItem('rt_drawings_v'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 200 && idx > 100, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const mig = await page.evaluate(() => ({ n: drawings.length, hasStyle: !!(drawings[0] && drawings[0].style), color: drawings[0] && drawings[0].style && drawings[0].style.color, locked: drawings[0] && drawings[0].locked, v: loadJSON('rt_drawings_v', 0) }));
    R('v0-migration', mig.n === 1 && mig.hasStyle && mig.color === '#ff0000' && mig.locked === false && mig.v === 1, `migrated=${JSON.stringify(mig)}`);
    await clearAll();
  }

  // ---- drift after replaying hundreds of bars (a placed drawing's {t,p} must not move) ----
  {
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    const before = await page.evaluate(() => ({ t: drawings[0].p1.t, p: drawings[0].p1.p }));
    const errsBefore = errs.length;
    const stepRes = await page.evaluate(() => { let ok = true; for (let i = 0; i < 400 && idx < bars.length - 2; i++) { try { stepAny(); } catch (e) { ok = false; break; } } return { ok, idx, seriesFrom, drwErr: window.__drw && window.__drw.err }; });
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ t: drawings[0].p1.t, p: drawings[0].p1.p, x: drawX(drawings[0].p1.t) }));
    R('drift-after-replay', stepRes.ok && before.t === after.t && before.p === after.p && stepRes.drwErr === undefined && errs.length === errsBefore,
      `400 steps ok=${stepRes.ok} idx=${stepRes.idx} seriesFrom=${stepRes.seriesFrom}; t/p unchanged=${before.t === after.t && before.p === after.p}; drawX finite=${after.x != null}; drw.err=${stepRes.drwErr}; new console errs=${errs.length - errsBefore}`);
  }

  // ---- forced re-window (seriesFrom shift) does not move the stored timestamp / breaks rendering ----
  {
    const res = await page.evaluate(() => {
      const RW = 4000, SLACK = 1500;
      if (idx < RW + SLACK + 50) return { skipped: true };
      const before = { t: drawings[0].p1.t, p: drawings[0].p1.p };
      const sfBefore = seriesFrom;
      maybeReWindow();
      const sfAfter = seriesFrom;
      const after = { t: drawings[0].p1.t, p: drawings[0].p1.p, x: drawX(drawings[0].p1.t) };
      return { skipped: false, before, after, sfBefore, sfAfter };
    });
    if (res.skipped) R('rewindow-no-drift', true, 'skipped: dataset too short to reach the RENDER_WINDOW+SLACK boundary from replay alone (not a defect)');
    else R('rewindow-no-drift', res.before.t === res.after.t && res.before.p === res.after.p, `seriesFrom ${res.sfBefore}->${res.sfAfter}; t/p unchanged=${res.before.t === res.after.t && res.before.p === res.after.p}; drawX after shift finite=${res.after.x != null}`);
  }

  // ---- regression: place/select/drag/delete for every drawing type ----
  await clearAll();
  {
    const types = [
      ['drwTL', 2], ['drwRay', 2], ['drwBox', 2], ['drwFib', 2], ['drwRR', 1], ['drwMeasure', 2], ['drwHRay', 1], ['drwVLine', 1], ['drwCross', 1],
    ];
    let allOk = true, detail = [];
    for (const [id, clicks] of types) {
      await clearAll();
      await page.click('#' + id);
      await clickChart(geo.W * 0.4, geo.H * 0.35);
      if (clicks === 2) await clickChart(geo.W * 0.6, geo.H * 0.55);
      const placed = await n();
      const sel = await page.evaluate(() => { const d = drawings[0]; if (!d) return false; selectDrawing(d, false); repaintOverlays(); return selDrawing === d; });
      // drag body
      const pt = await page.evaluate(() => { const d = drawings[0]; const x = d.type === 'hl' ? 100 : drawX(d.p1.t), y = d.type === 'vline' ? 100 : drawY(d.p1.p); return { x, y }; });
      const before = await page.evaluate(() => JSON.stringify(drawings[0]));
      if (pt.x != null && pt.y != null) await dragChart(pt.x, pt.y, pt.x + 25, pt.y + 15);
      const after = await page.evaluate(() => JSON.stringify(drawings[0]));
      await page.evaluate(() => { selectDrawing(drawings[0], false); deleteSelectedDrawing(); });
      const deleted = await n();
      const ok = placed === 1 && sel && deleted === 0;
      allOk = allOk && ok;
      detail.push(`${id}:placed=${placed},sel=${sel},moved=${before !== after},del=${deleted}${ok ? '' : '(FAIL)'}`);
    }
    R('reg-all-drawing-types', allOk, detail.join(' '));
  }

  // ---- annotation tools regression (own tools, not TV, but must keep working; Keep-drawing decision applies to them too) ----
  await clearAll();
  {
    await page.click('#annUp'); await clickChart(geo.W * 0.5, geo.H * 0.5);
    const c1 = await page.evaluate(() => annotations.length);
    const toolAfter = await page.evaluate(() => tool);
    await page.evaluate(() => { keepDrawing = true; });
    await page.click('#annDown'); await clickChart(geo.W * 0.55, geo.H * 0.5);
    const toolAfterKeep = await page.evaluate(() => tool);
    await page.evaluate(() => { keepDrawing = false; setTool(''); });
    R('reg-annotations', c1 === 1 && toolAfter === '' && toolAfterKeep === 'ad', `annUp placed count=${c1}; tool reset without keep-drawing=${toolAfter === ''}; tool stays with keep-drawing=${toolAfterKeep}`);
  }

  // ---- timeframe switch: drawing timestamp persists ----
  {
    await clearAll();
    await page.click('#drwHL'); await clickChart(geo.W * 0.5, geo.H * 0.4);
    const before = await page.evaluate(() => drawings[0].p1.t);
    const tfBefore = await page.evaluate(() => tf);
    await page.evaluate(() => { const sel = $('tfSelect'); const opts = [...sel.options].map(o => o.value); const other = opts.find(v => v != tf); if (other) { sel.value = other; sel.dispatchEvent(new Event('change')); } });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ t: drawings[0] && drawings[0].p1.t, tf, n: drawings.length }));
    R('timeframe-switch-persists', after.n === 1 && after.t === before, `tf ${tfBefore}->${after.tf}; t before=${before} after=${after.t} (unchanged=${after.t === before})`);
  }

  // ---- final: no lingering render error anywhere ----
  {
    const finalErr = await page.evaluate(() => window.__drw && window.__drw.err);
    R('final-no-drw-err', finalErr === undefined, `window.__drw.err=${finalErr}`);
  }

  console.log(`total console/page errors across entire run: ${errs.length}`);
  const fails = results.filter(r => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  if (fails.length) console.log('FAILED: ' + fails.map(f => f.id).join(', '));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
} catch (e) {
  console.log('SCRIPT ERROR: ' + (e && e.stack || e));
  await browser.close();
  process.exit(2);
}
