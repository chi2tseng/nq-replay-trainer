// Fast toolbar-tier probe: rows / height / natural width / hidden controls at many widths.
// Run: cd /d/SIPs && node D:/Tools/replay-trainer/tests/probe_rows.mjs [w1 w2 ...]
import { createRequire } from 'module';
const sipsRequire = createRequire('D:/SIPs/package.json');
const { chromium } = sipsRequire('playwright');

const WIDTHS = process.argv.slice(2).length ? process.argv.slice(2).map(Number)
  : [2560, 1920, 1800, 1700, 1600, 1560, 1520, 1500, 1490, 1440, 1366, 1280, 1175, 1024];

const browser = await chromium.launch();
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5560/?r=1', { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  const m = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const grps = [...tb.querySelectorAll(':scope > .grp')];
    const tops = [...new Set(grps.map(g => Math.round(g.getBoundingClientRect().top)))].sort((a, b) => a - b);
    const rows = {};
    grps.forEach(g => {
      const r = g.getBoundingClientRect(), t = Math.round(r.top);
      rows[t] = rows[t] || [];
      rows[t].push(`${g.className.replace('grp', '').trim() || 'data'}:${Math.round(r.left)}-${Math.round(r.right)}`);
    });
    const hidden = [];
    document.querySelectorAll('#toolbar button, #toolbar select, #toolbar span[id]').forEach(el => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (cs.display === 'none' || r.width === 0) hidden.push(el.id || el.className);
    });
    // natural (unwrapped) width of the four clusters + gaps
    const gap = parseFloat(getComputedStyle(tb).columnGap) || 0;
    const pad = parseFloat(getComputedStyle(tb).paddingLeft) + parseFloat(getComputedStyle(tb).paddingRight);
    let natural = pad + gap * (grps.length - 1);
    grps.forEach(g => { natural += g.scrollWidth; });
    const chart = document.getElementById('chart').getBoundingClientRect();
    return {
      rows: tops.length, tops, rowContent: rows,
      h: Math.round(tb.getBoundingClientRect().height),
      natural: Math.round(natural),
      hidden,
      date: document.getElementById('dateLabel').textContent,
      clock: document.getElementById('clock').textContent,
      badge: document.getElementById('modeBadge').textContent,
      chartH: Math.round(chart.height),
      bottom: Math.round(document.getElementById('bottom').getBoundingClientRect().height),
    };
  });
  console.log(String(w).padStart(5), 'rows=' + m.rows, 'h=' + m.h, 'natural=' + m.natural, 'chartH=' + m.chartH,
    'bottom=' + m.bottom, '| date=' + m.date, '| clock=' + m.clock, '| badge=' + JSON.stringify(m.badge));
  Object.entries(m.rowContent).forEach(([t, v]) => console.log('        row@' + t, v.join('  ')));
  console.log('        hidden:', m.hidden.join(',') || '(none)');
  await ctx.close();
}
await browser.close();
