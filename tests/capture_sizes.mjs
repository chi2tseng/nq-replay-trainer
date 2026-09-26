// QA screenshot + metrics matrix for NQ Replay Trainer toolbar re-theme.
// Run from D:\SIPs (playwright lives there):
//   cd /d/SIPs && node /d/Tools/replay-trainer/tests/capture_sizes.mjs
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
// playwright lives in D:\SIPs\node_modules, not next to this script — resolve it from there
// regardless of the process cwd (works whether invoked from /d/SIPs or elsewhere).
const sipsRequire = createRequire('D:/SIPs/package.json');
const { chromium } = sipsRequire('playwright');

const BASE_URL = 'http://127.0.0.1:5560/?r=1';
const OUT_DIR = 'D:\\Tools\\replay-trainer\\exports\\qa\\sizes';
fs.mkdirSync(OUT_DIR, { recursive: true });

const SIZES = [
  { w: 1024, h: 1366, touch: true,  label: '1024x1366' }, // iPad Pro portrait
  { w: 1024, h: 768,  touch: false, label: '1024x768' },
  { w: 1175, h: 900,  touch: false, label: '1175x900' },
  { w: 1280, h: 720,  touch: false, label: '1280x720' },
  { w: 1366, h: 768,  touch: false, label: '1366x768' },
  { w: 1366, h: 1024, touch: true,  label: '1366x1024' }, // iPad Pro landscape
  { w: 1440, h: 900,  touch: false, label: '1440x900' },
  { w: 1600, h: 900,  touch: false, label: '1600x900' },
  { w: 1920, h: 1080, touch: false, label: '1920x1080' },
  { w: 2560, h: 1440, touch: false, label: '2560x1440' },
];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function shot(page, sizeLabel, view) {
  const p = path.join(OUT_DIR, `${sizeLabel}_${view}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function cropShot(page, sizeLabel, view, selector) {
  const p = path.join(OUT_DIR, `${sizeLabel}_${view}.png`);
  const el = page.locator(selector).first();
  if (!(await el.count())) { log('  ! missing selector for crop', selector); return null; }
  await el.screenshot({ path: p });
  return p;
}

async function computeMetrics(page) {
  return await page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) }; };
    const toolbar = $('toolbar');
    const chart = $('chart');
    const side = $('side');
    const bottom = $('bottom');

    // distinct rows = distinct rounded top offsets of the direct .grp children
    const grps = toolbar ? Array.from(toolbar.querySelectorAll(':scope > .grp')) : [];
    const rowTops = [...new Set(grps.map(g => Math.round(g.getBoundingClientRect().top)))].sort((a, b) => a - b);

    const overflowX = toolbar ? (toolbar.scrollWidth > toolbar.clientWidth + 1) : null;

    // controls inside the toolbar that are display:none or zero-width
    const controlSel = '#toolbar button, #toolbar select, #toolbar span[id]';
    const hidden = [];
    document.querySelectorAll(controlSel).forEach(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const isNone = cs.display === 'none';
      const isZeroW = !isNone && r.width === 0;
      if (isNone || isZeroW) {
        const inlineDisplay = el.style.display || null;
        hidden.push({
          id: el.id || '(no id)',
          reason: isNone ? (inlineDisplay ? `display:none (inline style="${inlineDisplay}")` : 'display:none (css)') : 'zero-width (rendered, 0px)',
        });
      }
    });

    // text-overflow ellipsis elements that are actually truncated right now
    const truncated = [];
    document.querySelectorAll('#toolbar *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
        truncated.push({ id: el.id || el.className || '(anon)', scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: (el.textContent || '').trim().slice(0, 40) });
      }
    });

    return {
      toolbarHeight: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : null,
      toolbarRows: rowTops.length,
      toolbarRowTops: rowTops,
      toolbarOverflowX: overflowX,
      toolbarScrollWidth: toolbar ? toolbar.scrollWidth : null,
      toolbarClientWidth: toolbar ? toolbar.clientWidth : null,
      chart: rectOf(chart),
      side: rectOf(side),
      bottom: rectOf(bottom),
      hiddenControls: hidden,
      truncatedText: truncated,
      dateLabel: (() => { const el = $('dateLabel'); return el ? { text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, truncated: el.scrollWidth > el.clientWidth + 1 } : null; })(),
      bboTag: (() => { const el = $('bboTag'); if (!el) return null; const cs = getComputedStyle(el); return { display: cs.display, inlineDisplay: el.style.display, width: Math.round(el.getBoundingClientRect().width), text: el.textContent }; })(),
    };
  });
}

// WCAG contrast of every text-bearing element under rootSel against its effective (first opaque ancestor) background.
// Handles rgb()/rgba() and Chromium's color(srgb r g b) serialisation of color-mix() backgrounds.
async function contrastAudit(page, rootSel) {
  return await page.evaluate((rootSel) => {
    const parse = (c) => {
      let m = c.match(/^rgba?\(([^)]+)\)/);
      if (m) { const a = m[1].split(/[ ,\/]+/).map(Number); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; }
      m = c.match(/^color\(srgb ([^)]+)\)/);
      if (m) { const a = m[1].replace('/', ' ').split(/\s+/).map(Number); return { r: a[0] * 255, g: a[1] * 255, b: a[2] * 255, a: a.length > 3 ? a[3] : 1 }; }
      return null;
    };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a >= 0.99) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const root = document.querySelector(rootSel); if (!root) return null;
    const out = [];
    root.querySelectorAll('*').forEach((el) => {
      const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) return;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const fg = parse(cs.color); if (!fg) return;
      const bg = bgOf(el); const px = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = px >= 24 || (px >= 18.66 && bold);
      const r = ratio(fg, bg);
      out.push({ sel: (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''), text: el.textContent.trim().slice(0, 24), fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, px, ratio: Math.round(r * 100) / 100, pass: r >= (large ? 3 : 4.5) });
    });
    return out;
  }, rootSel);
}

async function safeClick(page, selector, opts = {}) {
  try {
    const el = page.locator(selector).first();
    if (!(await el.count())) return false;
    const box = await el.boundingBox();
    if (!box || (box.width === 0 && box.height === 0)) return false;
    await el.click({ timeout: 3000, ...opts });
    return true;
  } catch (e) {
    log('  ! click failed', selector, e.message.split('\n')[0]);
    return false;
  }
}

async function pressKeyForHelp(page) {
  // #btnHelp is visible at every width (LAYOUT_SPEC INV-1); the '?' shortcut is only a fallback here.
  const clicked = await safeClick(page, '#btnHelp');
  if (clicked) return true;
  try { await page.keyboard.press('Shift+Slash'); return true; } catch (e) { return false; }
}

async function run() {
  const browser = await chromium.launch();
  const allMetrics = {};
  const findings = [];
  const contrast = {};

  for (const size of SIZES) {
    log('=== size', size.label, size.touch ? '(touch)' : '');
    const context = await browser.newContext({
      viewport: { width: size.w, height: size.h },
      hasTouch: !!size.touch,
      isMobile: false,
    });
    context.on('page', () => {});
    const page = await context.newPage();
    page.on('dialog', async (d) => { try { await d.accept(); } catch (e) {} });
    page.on('pageerror', (e) => log('  pageerror:', e.message));

    try {
      await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(5000);

      // ---- 1. full page, default day ----
      await shot(page, size.label, 'full');

      // ---- metrics (baseline layout) ----
      const metrics = await computeMetrics(page);

      // ---- 2. toolbar crop ----
      await cropShot(page, size.label, 'toolbar', '#toolbar');

      // ---- 3. position open (BUY) ----
      const bought = await safeClick(page, '#btnBuy');
      if (bought) {
        await page.waitForTimeout(800);
        await shot(page, size.label, 'position_open');
        // flatten to close the trade -> feeds the calendar/day-detail below
        await safeClick(page, '#btnFlatten');
        await page.waitForTimeout(500);
      } else {
        findings.push({ size: size.label, view: 'position_open', issue: '#btnBuy not clickable (missing/zero-size)' });
      }

      // ---- 4. dashboard tab ----
      const tabbed = await safeClick(page, '#tabDash');
      if (tabbed) {
        await page.waitForTimeout(500);
        await shot(page, size.label, 'dashboard');
        // Position card must not be painted over while #side is short (Dashboard open): heading + posBox + actions all visible
        metrics.posCard = await page.evaluate(() => {
          const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
          const h = r('#posBox'), a = r('.pos-actions'), s = r('#side');
          return { posBox: h, actions: a, side: s, overlap: h && a ? a.top < h.bottom : null, posBoxOnScreen: h && s ? (h.top >= s.top && h.bottom <= s.bottom) : null };
        });
        // with a live position + Dashboard open the black P&L strip must stay uncovered
        if (await safeClick(page, '#btnBuy')) {
          await page.waitForTimeout(600);
          await shot(page, size.label, 'dashboard_position');
          metrics.posCardLive = await page.evaluate(() => {
            const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
            const p = r('#posBox .pos-pnl'), a = r('.pos-actions'); return { pnl: p, actions: a, overlap: p && a ? a.top < p.bottom : null };
          });
          await safeClick(page, '#btnFlatten'); await page.waitForTimeout(400);
        }
      } else {
        findings.push({ size: size.label, view: 'dashboard', issue: '#tabDash not clickable' });
      }

      // ---- 4b. day-detail / journal card (click a day with trades on the calendar) ----
      try {
        const dayCell = page.locator('.pc-day[data-day]').first();
        if (await dayCell.count()) {
          await dayCell.click({ timeout: 3000 });
          await page.waitForTimeout(500);
          await shot(page, size.label, 'day_detail');
          await safeClick(page, '#ddClose');
        } else {
          findings.push({ size: size.label, view: 'day_detail', issue: 'no .pc-day[data-day] cell found (no trade logged yet)' });
        }
      } catch (e) { findings.push({ size: size.label, view: 'day_detail', issue: 'exception: ' + e.message.split('\n')[0] }); }

      // ---- 5. indicators popover ----
      const indOpen = await safeClick(page, '#btnIndicators');
      if (indOpen) {
        await page.waitForTimeout(400);
        await shot(page, size.label, 'indicators');
        await safeClick(page, '#btnIndicators'); // close
        await page.waitForTimeout(200);
      } else {
        findings.push({ size: size.label, view: 'indicators', issue: '#btnIndicators not clickable' });
      }

      // ---- 6. help modal ----
      const helpOpen = await pressKeyForHelp(page);
      if (helpOpen) {
        await page.waitForTimeout(400);
        await shot(page, size.label, 'help_modal');
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(200);
      } else {
        findings.push({ size: size.label, view: 'help_modal', issue: 'could not open (#btnHelp missing and ? shortcut failed)' });
      }

      // ---- 7. Random-game HUD ----
      try {
        const rndOpen = await safeClick(page, '#btnRandom');
        if (rndOpen) {
          await page.waitForTimeout(1200);
          const hudVisible = await page.locator('#rndHud').isVisible().catch(() => false);
          if (hudVisible) {
            await shot(page, size.label, 'random_hud');
            // the round captured here is whatever the sandbox produced (usually flat/losing); force the WINNING
            // state too, since --pos-as-text is the case the contrast pass keeps missing (LAYOUT_SPEC G8)
            await page.evaluate(() => { const pe = document.querySelector('#rndHud .rh-pnl'); if (pe) { pe.textContent = '+$125.00'; pe.className = 'rh-pnl pos'; } });
            await shot(page, size.label, 'random_hud_win');
            const audit = await contrastAudit(page, '#rndHud');
            contrast[size.label + ':rndHud'] = audit;
            const bad = (audit || []).filter(a => !a.pass);
            if (bad.length) findings.push({ size: size.label, view: 'random_hud_win', issue: 'contrast < threshold: ' + bad.map(b => `${b.sel} ${b.ratio}:1`).join('; ') });
          } else {
            findings.push({ size: size.label, view: 'random_hud', issue: '#rndHud stayed hidden after clicking #btnRandom' });
          }
          await safeClick(page, '#btnRandom'); // toggle exit
          await page.waitForTimeout(400);
        } else {
          findings.push({ size: size.label, view: 'random_hud', issue: '#btnRandom not clickable' });
        }
      } catch (e) { findings.push({ size: size.label, view: 'random_hud', issue: 'exception: ' + e.message.split('\n')[0] }); }

      // ---- 8. Quiz card ----
      // The quiz log (data/quiz_trades.json) only covers 2026-07-01..2026-07-29; the default
      // replay day (2026-09-15) has no overlapping trades so enterQuiz() always no-ops with a
      // toast. Jump the date picker back to 2026-07-01 first so the card actually has something
      // to show.
      try {
        await safeClick(page, '#dateBtn');
        await page.waitForTimeout(300);
        await safeClick(page, '.cal-nav[data-mo="-1"]');
        await page.waitForTimeout(150);
        await safeClick(page, '.cal-nav[data-mo="-1"]');
        await page.waitForTimeout(150);
        const dayBtn = page.locator('.cal-day.has[data-key="2026-07-01"]').first();
        if (await dayBtn.count()) { await dayBtn.click({ timeout: 3000 }); await page.waitForTimeout(1800); }
        else { findings.push({ size: size.label, view: 'quiz_card', issue: 'date popover: 2026-07-01 not found as a .cal-day.has cell' }); }
      } catch (e) { findings.push({ size: size.label, view: 'quiz_card', issue: 'date jump exception: ' + e.message.split('\n')[0] }); }

      try {
        const quizOpen = await safeClick(page, '#btnQuiz');
        if (quizOpen) {
          await page.waitForTimeout(1200);
          const cardVisible = await page.locator('#quizCard').isVisible().catch(() => false);
          if (cardVisible) {
            await shot(page, size.label, 'quiz_card');
            // answer the question so the verdict / chips render, then force the CORRECT-answer state (green text)
            if (await safeClick(page, '#quizCard .qz-b.buy')) {
              await page.waitForTimeout(500);
              await page.evaluate(() => {
                const v = document.querySelector('#quizCard .qz-verdict'); if (v) { v.className = 'qz-verdict good'; v.textContent = 'Took the winner again'; }
                const r = document.querySelector('#quizCard .qz-res'); if (r) { r.className = 'qz-res pos'; r.textContent = '+$85.00'; }
                const chip = document.querySelector('#quizCard .qz-chip'); if (chip) { chip.className = 'qz-chip good'; chip.textContent = '1'; }
                const b = document.querySelector('#quizCard .qz-cmp b'); if (b) b.className = 'pos';
              });
              await shot(page, size.label, 'quiz_card_answered');
              const audit = await contrastAudit(page, '#quizCard');
              contrast[size.label + ':quizCard'] = audit;
              const bad = (audit || []).filter(a => !a.pass);
              if (bad.length) findings.push({ size: size.label, view: 'quiz_card_answered', issue: 'contrast < threshold: ' + bad.map(b => `${b.sel} ${b.ratio}:1`).join('; ') });
            }
          } else {
            findings.push({ size: size.label, view: 'quiz_card', issue: '#quizCard stayed hidden after clicking #btnQuiz (dataset/log mismatch or locked state)' });
          }
          await safeClick(page, '#btnQuiz'); // toggle exit
          await page.waitForTimeout(400);
        } else {
          findings.push({ size: size.label, view: 'quiz_card', issue: '#btnQuiz not clickable' });
        }
      } catch (e) { findings.push({ size: size.label, view: 'quiz_card', issue: 'exception: ' + e.message.split('\n')[0] }); }

      allMetrics[size.label] = metrics;
      log('  rows=', metrics.toolbarRows, 'toolbarH=', metrics.toolbarHeight, 'chartH=', metrics.chart && metrics.chart.h, 'hidden=', metrics.hiddenControls.map(h => h.id).join(','));

    } catch (e) {
      log('  !! size failed:', e.message);
      findings.push({ size: size.label, view: 'ALL', issue: 'fatal: ' + e.message.split('\n')[0] });
    } finally {
      await context.close();
    }
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'metrics.json'), JSON.stringify({ metrics: allMetrics, captureFindings: findings, contrast }, null, 2));
  log('done. metrics.json written with', Object.keys(allMetrics).length, 'sizes and', findings.length, 'capture-time findings.');
}

run().catch(e => { console.error(e); process.exit(1); });
