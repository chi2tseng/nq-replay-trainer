// Visual/UX QA for the TV drawing tools re-theme. Screenshots selected-state (floating toolbar + handles)
// for each of the 10 drawing types, plus magnet menu, preview line, and leftbar close-up.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/visual_qa_drawing.mjs
import { createRequire } from 'module';
const { chromium } = createRequire('D:/SIPs/package.json')('playwright');

const URL = 'http://127.0.0.1:5560/';
const OUT = 'D:/Tools/replay-trainer/exports/qa/';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('dialog', d => d.accept());

const chartRect = () => page.evaluate(() => document.getElementById('chart').getBoundingClientRect().toJSON());
const barX = (k) => page.evaluate((k) => chart.timeScale().timeToCoordinate(bars[k].time), k);
const clickChart = async (x, y) => { const r = await chartRect(); await page.mouse.click(r.left + x, r.top + y); await page.waitForTimeout(700); };
const moveChart = async (x, y) => { const r = await chartRect(); await page.mouse.move(r.left + x, r.top + y); await page.waitForTimeout(150); };
const dg = (i = 0) => page.evaluate((i) => { const d = drawings[i]; if (!d) return null; return { type: d.type, x1: drawX(d.p1.t), y1: drawY(d.p1.p), x2: d.p2 ? drawX(d.p2.t) : null, y2: d.p2 ? drawY(d.p2.p) : null }; }, i);
const clear = () => page.evaluate(() => { drawings.length = 0; clearSelection(); hoverDrawing = null; pendingPt = null; previewXY = null; saveJSON('rt_drawings', drawings); if (tool) setTool(''); drawingsLocked = false; lockBtnUI(); if ($('drawSettings').classList.contains('open')) closeDrawSettings(); repaintOverlays(); });
const TOOLID = { tl: 'drwTL', ray: 'drwRay', hl: 'drwHL', box: 'drwBox', fib: 'drwFib', measure: 'drwMeasure', rr: 'drwRR', hray: 'drwHRay', vline: 'drwVLine', cross: 'drwCross' };
const TWO_POINT = ['tl', 'ray', 'box', 'fib', 'measure'];

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.setItem('rt_drawings', '[]'); localStorage.setItem('rt_drawings_v', '1'); localStorage.setItem('rt_magnet', '"off"'); localStorage.setItem('rt_lockdrw', 'false'); localStorage.setItem('rt_keepdraw', 'false'); localStorage.setItem('rt_annotations', '[]'); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof bars !== 'undefined' && bars.length > 200 && idx > 100, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const geo = await page.evaluate(() => ({ H: document.getElementById('chart').clientHeight, W: document.getElementById('chart').clientWidth, idx }));
  const k = geo.idx - 60;
  console.log('geo=', JSON.stringify(geo));

  // 0. clean initial chart (baseline for color/legibility reference)
  await page.screenshot({ path: OUT + '00_chart_baseline.png' });

  // 1. leftbar close-up (cursor/magnet/keepdraw/lock/hide + drawing tool icons)
  const leftbar = await page.locator('#leftbar').boundingBox();
  await page.screenshot({ path: OUT + '01_leftbar.png', clip: { x: 0, y: leftbar.y, width: leftbar.width + 4, height: Math.min(leftbar.height, 520) } });

  // 2. Magnet menu open (chevron click)
  await page.hover('#btnMagnet');
  await page.click('#btnMagnetMenu');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '02_magnet_menu.png' });
  await page.keyboard.press('Escape');
  await clickChart(geo.W * 0.9, geo.H * 0.9); // close any popover

  // 3. Preview line while placing a trend line (rubber-band, G2)
  await clear();
  await page.click('#' + TOOLID.tl);
  const xa = await barX(k), ya = geo.H * 0.35;
  await clickChart(xa, ya);
  await moveChart(xa + 140, ya + 90);
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT + '03_preview_line.png' });
  await page.keyboard.press('Escape');
  await clear();

  // 4. Hover cursor over a placed line (before selecting)
  await page.click('#' + TOOLID.tl);
  await clickChart(xa, ya);
  await clickChart(xa + 130, ya + 60);
  const hoverG = await dg(0);
  await moveChart((hoverG.x1 + hoverG.x2) / 2, (hoverG.y1 + hoverG.y2) / 2);
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT + '04_hover_cursor.png' });
  await clear();

  // 5. Per-tool: draw, select, screenshot with floating toolbar + handles
  for (const type of Object.keys(TOOLID)) {
    await clear();
    const xa2 = await barX(k), ya2 = geo.H * 0.38;
    await page.click('#' + TOOLID[type]);
    await clickChart(xa2, ya2);
    if (TWO_POINT.includes(type)) await clickChart(xa2 + 110, ya2 + 65);
    const g = await dg(0);
    if (!g) { console.log('MISSING drawing for', type); continue; }
    let selX, selY;
    if (type === 'hl') { selX = geo.W / 2; selY = g.y1; }
    else if (type === 'vline') { selX = g.x1; selY = geo.H / 2; }
    else if (type === 'hray' || type === 'cross') { selX = g.x1 + 30; selY = g.y1; }
    else if (type === 'rr') { const r = await page.evaluate(() => rrRange(drawings[0], drawX)); selX = (r.xa + r.xb) / 2; selY = g.y1; }
    else if (type === 'box') { selX = (g.x1 + g.x2) / 2; selY = Math.min(g.y1, g.y2); }
    else { selX = (g.x1 + g.x2) / 2; selY = (g.y1 + g.y2) / 2; }
    await clickChart(selX, selY);
    await page.waitForTimeout(200);
    const selType = await page.evaluate(() => selDrawing && selDrawing.type);
    const tbVisible = await page.locator('#drawToolbar').isVisible();
    console.log(`${type}: selType=${selType} toolbarVisible=${tbVisible}`);
    await page.screenshot({ path: OUT + `drawing_${type}.png` });
  }
  await clear();

  // 6. Keep-drawing / Lock / Hide active states in leftbar
  await page.click('#btnKeepDraw');
  await page.click('#btnLockDrw');
  await page.waitForTimeout(150);
  const lb2 = await page.locator('#leftbar').boundingBox();
  await page.screenshot({ path: OUT + '06_leftbar_active_states.png', clip: { x: 0, y: lb2.y, width: lb2.width + 4, height: Math.min(lb2.height, 250) } });
  await page.click('#btnKeepDraw'); await page.click('#btnLockDrw');

  // 7. Hide menu + Remove menu popovers
  await page.hover('#btnHideDrw'); await page.click('#btnHideMenu'); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '07_hide_menu.png' });
  await page.keyboard.press('Escape');
  await page.hover('#drwClear'); await page.click('#btnRemoveMenu'); await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '08_remove_menu.png' });
  await page.keyboard.press('Escape');

  // 8. Settings panel (dblclick a drawing)
  await clear();
  await page.click('#' + TOOLID.box);
  await clickChart(xa, ya);
  await clickChart(xa + 100, ya + 70);
  const bx = await dg(0);
  const r = await chartRect();
  await page.mouse.dblclick(r.left + (bx.x1 + bx.x2) / 2, r.top + Math.min(bx.y1, bx.y2));
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '09_settings_panel.png' });
  await clear();

  console.log('DONE. console errors=' + errs.length, errs.slice(0, 5));
} catch (e) {
  console.log('EXCEPTION: ' + (e && e.stack || e));
} finally {
  await browser.close();
}
