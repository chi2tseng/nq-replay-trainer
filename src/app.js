'use strict';
/* NQ Replay Trainer — Wave 1
 * TradingView-style bar replay with multi-timeframe + manual orders (market/limit/stop entry)
 * + NinjaTrader-style ATM (multi-target scale-out, breakeven, trailing). Fills are always
 * simulated on the underlying 30-second sub-bars, so accuracy is timeframe-independent. */

let INSTR = { symbol: 'NQ', tickSize: 0.25, tickValue: 5 }; // active contract spec (per-dataset; NQ: $20/pt -> $5/tick)
const DATASETS = [
  { id: 'deep', label: 'NQ · Nasdaq-100 1m · 3.5mo deep (Dukascopy)', url: 'data/NQ_deep_1m.json', instr: { symbol: 'NQ', tickSize: 0.25, tickValue: 5 } },     // $20/pt
  { id: 'es',   label: 'ES · S&P 500 1m · 3.5mo deep (Dukascopy)',    url: 'data/ES_deep_1m.json', instr: { symbol: 'ES', tickSize: 0.25, tickValue: 12.5 } }, // $50/pt
  { id: 'ym',   label: 'YM · Dow 1m · 3.5mo deep (Dukascopy)',        url: 'data/YM_deep_1m.json', instr: { symbol: 'YM', tickSize: 1, tickValue: 5 } },        // $5/pt
  { id: 'tick', label: 'NQ · 30s · Jun 7–12 (real tick)', url: 'data/NQ_30s.json', instr: { symbol: 'NQ', tickSize: 0.25, tickValue: 5 } },
];
const STD_TF = [1, 2, 3, 5, 10, 15, 30, 60];   // standard minute timeframes
let BASE_TF = 1;        // base bar resolution (minutes) — auto-detected per dataset
let TF_OPTIONS = [];    // built per dataset (base + standard multiples)
let wired = false, dataIdx = 0;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
let TICK = INSTR.tickSize;   // reassigned per-dataset in loadDataset(); rnd()/tcount() read it at call time
const rnd = (p) => Math.round(p / TICK) * TICK;
const f2 = (p) => p.toFixed(2);
const tcount = (a, b) => Math.round((a - b) / TICK);
const usd = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const pad = (n) => String(n).padStart(2, '0');
// --- all wall-clock DISPLAY is US-Eastern (the market's session clock), DST-correct via Intl ---
const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etHM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const etDMHMS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function etP(ts) { const o = {}; for (const x of etDMHMS.formatToParts(new Date(ts * 1000))) o[x.type] = x.value; return o; }
const tFmt = (ts) => { const o = etP(ts); return `${o.month}/${o.day} ${o.hour}:${o.minute}:${o.second} ET`; };  // US cash open reads 09:30:00 ET
const dayKey = (ts) => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; };
const tradingDayKey = (ts) => etFmt.format(new Date((ts + 6 * 3600) * 1000)); // futures trading day = ET date (18:00 ET boundary shifted to midnight, DST-correct)
function etMinutes(ts) { const p = etHM.formatToParts(new Date(ts * 1000)); let h = 0, m = 0; for (const x of p) { if (x.type === 'hour') h = +x.value; else if (x.type === 'minute') m = +x.value; } return h * 60 + m; } // minutes since midnight ET (DST-correct)
// ET formatters for the LWC time axis (tick labels) + crosshair label — timestamps are UTC epoch s
const _TM = (window.LightweightCharts && LightweightCharts.TickMarkType) || { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 };
function etTickFmt(ts, type) { const o = etP(ts); if (type === _TM.Year || type === _TM.Month || type === _TM.DayOfMonth) return `${o.month}/${o.day}`; if (type === _TM.TimeWithSeconds) return `${o.hour}:${o.minute}:${o.second}`; return `${o.hour}:${o.minute}`; }
const etCrosshairFmt = (ts) => { const o = etP(ts); return `${o.month}/${o.day} ${o.hour}:${o.minute} ET`; };
const loadJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ---------- state ----------
let baseBars = [];           // raw 1-min bars
let bars = [];               // current-timeframe bars (each carries subStart/subEnd into baseBars)
let tf = 1;                  // timeframe in minutes
let idx = 0;                 // last revealed TF-bar index
let baseIdx = 0;             // last revealed 1-min index (== bars[idx].subEnd)
let playing = false, timer = null;

let position = null;         // {side,qty,entry,entryTime,atm,slTicks,maxFav,beDone}
let orders = [];             // working: {type:'stop'|'target', price, qty, ticks?}
let entryOrder = null;       // pending entry: {side, kind:'limit'|'stop', price, atm, mult}
let trades = loadJSON('rt_trades', []);
let markers = [];            // {baseTime, position, color, shape, text}
let lines = [];              // active price-line handles

let atm = normalizeAtms(loadJSON('rt_atm', defaultAtms()));
let activeAtm = Object.keys(atm)[0];

function defaultAtms() {
  return {
    'Flat 10/20':         { sl: 10, targets: [{ ticks: 20, qty: 1 }], be: { on: false, trig: 12, off: 1 }, trail: { on: false, trig: 16, dist: 8 } },
    'Scalp 8/8 +BE':      { sl: 8,  targets: [{ ticks: 8, qty: 1 }],  be: { on: true,  trig: 6,  off: 1 }, trail: { on: false, trig: 8,  dist: 5 } },
    'Runner 2T BE+Trail': { sl: 12, targets: [{ ticks: 20, qty: 1 }, { ticks: 50, qty: 1 }], be: { on: true, trig: 10, off: 2 }, trail: { on: true, trig: 16, dist: 10 } },
  };
}
function normalizeAtms(obj) { // migrate v1 {tp,qty} -> {targets:[...]}
  for (const k in obj) { const a = obj[k];
    if (!a.targets) a.targets = a.tp > 0 ? [{ ticks: a.tp, qty: a.qty || 1 }] : [];
    a.be = a.be || { on: false, trig: 12, off: 1 }; a.trail = a.trail || { on: false, trig: 16, dist: 8 };
  }
  return obj;
}

// ---------- chart ----------
const chart = LightweightCharts.createChart($('chart'), {
  layout: { background: { color: '#0b0e11' }, textColor: '#eaecef', attributionLogo: false },
  grid: { vertLines: { color: '#1b2027' }, horzLines: { color: '#1b2027' } },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#2b3139' },
  localization: { timeFormatter: etCrosshairFmt },                 // crosshair label in ET
  timeScale: { borderColor: '#2b3139', timeVisible: true, secondsVisible: true, rightOffset: 6, tickMarkFormatter: etTickFmt }, // axis labels in ET (open = 09:30)
});
let candle = chart.addCandlestickSeries({ upColor: '#0ecb81', downColor: '#f6465d', borderVisible: false, wickUpColor: '#0ecb81', wickDownColor: '#f6465d' });
let vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' } });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
function sizeChart() { const el = $('chart'); const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; chart.resize(w - 1, h, true); chart.resize(w, h, true); } // double-resize: LWC no-ops a resize to the same size, so nudge then set
new ResizeObserver(sizeChart).observe($('chartwrap'));
window.addEventListener('resize', sizeChart);
function fitChart() { chart.timeScale().fitContent(); }   // auto-zoom to show all revealed bars (revealed = the only data fed to the series)

// ---------- resizable layout (drag gutters to size #side width & #bottom height) ----------
// Single source of truth = two CSS vars (--side-w, --bottom-h) the grid reads; JS just sets them.
const LAYOUT_DEFAULTS = { side: 320, bottom: 252 }, LAYOUT_MIN = { side: 240, bottom: 130 }, SIDE_MIN_CHART = 420, BOTTOM_MIN_MAIN = 240, TOOLBAR_H = 46, GUTTER = 6;
let layout = Object.assign({}, LAYOUT_DEFAULTS, loadJSON('rt_layout2', {}));   // rt_layout2: fresh key (old saved values were degenerate)
function clampLayout(L) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const maxSide = Math.max(LAYOUT_MIN.side, vw - SIDE_MIN_CHART - GUTTER);
  const maxBottom = Math.max(LAYOUT_MIN.bottom, vh - TOOLBAR_H - GUTTER - BOTTOM_MIN_MAIN);
  L.side = Math.round(Math.min(maxSide, Math.max(LAYOUT_MIN.side, L.side)));
  L.bottom = Math.round(Math.min(maxBottom, Math.max(LAYOUT_MIN.bottom, L.bottom)));
  return L;
}
let _rzRAF = 0;
function applyLayout(persist) {
  clampLayout(layout);
  const r = document.documentElement.style;
  r.setProperty('--side-w', layout.side + 'px');
  r.setProperty('--bottom-h', layout.bottom + 'px');
  if (persist) saveJSON('rt_layout2', { side: layout.side, bottom: layout.bottom });
  // resize the chart bitmaps on the next frame — coalesces rapid drag moves (LWC resize is heavy)
  if (!_rzRAF) _rzRAF = requestAnimationFrame(() => { _rzRAF = 0; if (typeof sizeChart === 'function') sizeChart(); if (typeof oscResize === 'function') oscResize(); });
}
function attachGutter(el, axis) {
  if (!el) return;
  const key = axis === 'x' ? 'side' : 'bottom', cls = axis === 'x' ? 'resizing-x' : 'resizing-y';
  let startPos = 0, startVal = 0, active = false;
  function onMove(e) {
    if (!active) return;
    const cur = axis === 'x' ? e.clientX : e.clientY;
    layout[key] = startVal + (startPos - cur);     // side/bottom grow as you drag toward them (left / up)
    applyLayout(false); e.preventDefault();
  }
  function onUp() {
    if (!active) return; active = false;
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    el.classList.remove('dragging'); document.body.classList.remove('resizing', cls);
    saveJSON('rt_layout2', { side: layout.side, bottom: layout.bottom });
  }
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    active = true; startPos = axis === 'x' ? e.clientX : e.clientY; startVal = layout[key];
    el.classList.add('dragging'); document.body.classList.add('resizing', cls);
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  el.addEventListener('dblclick', () => { layout[key] = LAYOUT_DEFAULTS[key]; applyLayout(true); });
}
function initLayout() { applyLayout(false); attachGutter($('gutterCol'), 'x'); attachGutter($('gutterRow'), 'y'); window.addEventListener('resize', () => applyLayout(false)); }

// ---------- right-click chart trading (context menu at the clicked price) ----------
function ctxPriceAt(clientY) { return candle.coordinateToPrice(clientY - $('chart').getBoundingClientRect().top); }
function bracketFromAtm(name) {   // snapshot an ATM template's stop + targets (ticks) onto a working order
  const a = atm[name] || {};
  return { slTicks: a.sl || 0, tgts: (a.targets || []).filter(t => t.ticks > 0 && t.qty > 0).map(t => ({ ticks: t.ticks, qty: t.qty })) };
}
function placeEntryAt(side, kind, price) {
  if (position) return toast('Already in a position — flatten first');
  const mult = Math.max(1, parseInt($('qty').value, 10) || 1);
  entryOrder = { side, kind, price: rnd(price), atm: activeAtm, mult, ...bracketFromAtm(activeAtm) };
  toast(`${side === 'long' ? 'Buy' : 'Sell'} ${kind === 'limit' ? 'Limit' : 'Stop'} @ ${f2(rnd(price))} + bracket`);
  drawLines(); renderLive();
}
function moveStopTo(price) { if (!position) return; const s = orders.find(o => o.type === 'stop'); if (s) s.price = rnd(price); else orders.push({ type: 'stop', price: rnd(price), qty: position.qty }); drawLines(); renderLive(); toast('Stop → ' + f2(rnd(price))); }
function moveTargetTo(price) { if (!position) return; const t = orders.find(o => o.type === 'target'); if (t) t.price = rnd(price); else orders.push({ type: 'target', price: rnd(price), qty: position.qty }); drawLines(); renderLive(); toast('Target → ' + f2(rnd(price))); }
let ctxEl = null;
function hideCtx() { if (ctxEl) ctxEl.style.display = 'none'; }
function showCtx(clientX, clientY) {
  const price = ctxPriceAt(clientY); if (price == null) return;
  if (!ctxEl) { ctxEl = document.createElement('div'); ctxEl.id = 'ctxMenu'; document.body.appendChild(ctxEl); }
  const p = f2(rnd(price)), it = [];
  if (position) {
    it.push({ h: `${position.side === 'long' ? 'LONG' : 'SHORT'} ${position.qty} @ ${f2(position.entry)}` });
    it.push({ l: `Move stop here @ ${p}`, f: () => moveStopTo(price) });
    it.push({ l: `Move target here @ ${p}`, f: () => moveTargetTo(price) });
    it.push({ sep: 1 });
    it.push({ l: 'Flatten', f: () => flatten('manual') });
    it.push({ l: 'Reverse', f: () => reverse() });
  } else if (entryOrder) {
    it.push({ h: `Working ${entryOrder.side === 'long' ? 'Buy' : 'Sell'} ${entryOrder.kind === 'limit' ? 'Limit' : 'Stop'} @ ${f2(entryOrder.price)}` });
    it.push({ l: 'Cancel order', f: () => cancelEntry() });
  } else {
    it.push({ l: 'Buy Market', cls: 'buy', f: () => onEntryButtonDirect('long') });
    it.push({ l: 'Sell Market', cls: 'sell', f: () => onEntryButtonDirect('short') });
    it.push({ sep: 1 });
    it.push({ l: `Buy Limit @ ${p}`, cls: 'buy', f: () => placeEntryAt('long', 'limit', price) });
    it.push({ l: `Sell Limit @ ${p}`, cls: 'sell', f: () => placeEntryAt('short', 'limit', price) });
    it.push({ l: `Buy Stop @ ${p}`, cls: 'buy', f: () => placeEntryAt('long', 'stop', price) });
    it.push({ l: `Sell Stop @ ${p}`, cls: 'sell', f: () => placeEntryAt('short', 'stop', price) });
  }
  ctxEl.innerHTML = '';
  it.forEach(x => {
    const d = document.createElement('div');
    if (x.sep) { d.className = 'ctx-sep'; }
    else if (x.h) { d.className = 'ctx-head'; d.textContent = x.h; }
    else { d.className = 'ctx-item' + (x.cls ? ' ' + x.cls : ''); d.textContent = x.l; d.onclick = () => { x.f(); hideCtx(); }; }
    ctxEl.appendChild(d);
  });
  ctxEl.style.display = 'block';
  ctxEl.style.left = Math.min(clientX, window.innerWidth - ctxEl.offsetWidth - 6) + 'px';
  ctxEl.style.top = Math.min(clientY, window.innerHeight - ctxEl.offsetHeight - 6) + 'px';
}
$('chart').addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e.clientX, e.clientY); });
window.addEventListener('mousedown', (e) => { if (ctxEl && ctxEl.style.display === 'block' && !ctxEl.contains(e.target)) hideCtx(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); });

// ---------- chart legend overlay (OHLCV readout, follows crosshair) ----------
function legendTfLabel() { return tf < 1 ? (tf * 60) + 's' : tf + 'm'; }
function fmtVol(v) { if (v == null || !isFinite(v)) return '–'; const n = Math.abs(v); if (n >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return String(Math.round(v)); }
function legendBarFor(param) {
  let i = -1;
  if (param && param.time != null) { for (let k = Math.min(idx, bars.length - 1); k >= 0; k--) { if (bars[k].time === param.time) { i = k; break; } } }
  if (i < 0) i = Math.min(idx, bars.length - 1);
  if (i < 0 || !bars[i]) return null;
  return { bar: bars[i], prevClose: i > 0 ? bars[i - 1].close : bars[i].open };
}
function legendCmpClass(val, ref) { return val > ref ? 'up' : (val < ref ? 'down' : ''); }
function renderLegend(param) {
  renderIndLegend(hoveredIndex(param));        // indicator readouts track the same crosshair bar
  const el = document.getElementById('chartLegend'); if (!el) return;
  if (!bars.length) { el.classList.remove('show'); return; }
  const got = legendBarFor(param); if (!got) { el.classList.remove('show'); return; }
  const b = got.bar, pc = got.prevClose, chg = b.close - pc, pct = pc ? (chg / pc) * 100 : 0;
  const chgCls = chg > 0 ? 'up' : (chg < 0 ? 'down' : ''), sign = chg > 0 ? '+' : '', volCls = b.close >= b.open ? 'up' : 'down';
  const cell = (l, v, ref) => `<span class="ll-lbl">${l}</span><span class="ll-val mono ${legendCmpClass(v, ref)}">${f2(v)}</span>`;
  el.innerHTML = `<span class="ll-sym">${INSTR.symbol}</span><span class="ll-tf">${legendTfLabel()}</span>` +
    cell('O', b.open, pc) + cell('H', b.high, pc) + cell('L', b.low, pc) + cell('C', b.close, pc) +
    `<span class="ll-chg mono ${chgCls}">${sign}${f2(chg)} (${sign}${pct.toFixed(2)}%)</span>` +
    `<span class="ll-lbl">Vol</span><span class="ll-val mono ${volCls}">${fmtVol(b.volume)}</span>`;
  el.classList.add('show');
}
function initChartLegend() { chart.subscribeCrosshairMove((param) => renderLegend(param)); renderLegend(null); }

// ---- on-chart indicator legend (TradingView-style stacked rows; each row toggles its indicator) ----
function hoveredIndex(param) {
  if (param && param.time != null) { for (let k = Math.min(idx, bars.length - 1); k >= 0; k--) if (bars[k].time === param.time) return k; }
  return Math.min(idx, bars.length - 1);
}
function fmtIndVal(v) { return (v == null || !isFinite(v)) ? '–' : f2(v); }
function renderIndLegend(i) {
  const el = $('indLegend'); if (!el) return;
  if (!bars.length) { el.innerHTML = ''; return; }
  if (i == null || i < 0 || i >= bars.length) i = Math.min(idx, bars.length - 1);
  const rows = [];
  const tint = (c, s) => `<span style="color:${c}">${s}</span>`;
  const add = (key, on, title, params, vals) => rows.push(
    `<div class="il-row${on ? '' : ' off'}" data-ind="${key}" title="Click to toggle">` +
    `<span class="il-eye material-symbols-outlined">${on ? 'visibility' : 'visibility_off'}</span>` +
    `<span class="il-name">${title}</span>` +
    (params ? `<span class="il-params">${params}</span>` : '') +
    (on && vals ? `<span class="il-vals">${vals}</span>` : '') + `</div>`);
  add('rip', ripsterOn, 'Ripster EMA Clouds', '8·9 5·12 34·50 72·89 180·200', '');
  add('vwap', vwapOn, 'VWAP', '', tint(VWAP_COLOR, `<b>${fmtIndVal(vwapData[i])}</b>`));
  add('bb', bbOn, 'BB', '20 2', `${tint('var(--dim)', fmtIndVal(bbData.up[i]))} ${tint(BB_MID, '<b>' + fmtIndVal(bbData.mid[i]) + '</b>')} ${tint('var(--dim)', fmtIndVal(bbData.lo[i]))}`);
  const emaVals = emaData.map(e => tint(e.color, fmtIndVal(e.arr[i]))).join(' ');
  add('ema', emaOn, 'EMA', emaPeriods.join(' '), emaVals);
  el.innerHTML = rows.join('');
}
function toggleInd(which) {
  if (which === 'rip') { ripsterOn = !ripsterOn; saveJSON('rt_ripster', ripsterOn); ripsterRepaint(); const c = $('ripsterToggle'); if (c) c.checked = ripsterOn; }
  else if (which === 'vwap') { setVwap(!vwapOn); const c = $('indVwap'); if (c) c.checked = vwapOn; }
  else if (which === 'bb') { setBB(!bbOn); const c = $('indBB'); if (c) c.checked = bbOn; }
  else if (which === 'ema') { setEMA(!emaOn); const c = $('indEma'); if (c) c.checked = emaOn; }
  renderIndLegend();
}
function initIndLegend() {
  const el = $('indLegend'); if (!el) return;
  el.addEventListener('mousedown', (e) => e.stopPropagation());   // clicking the legend must not start a chart drag
  el.addEventListener('click', (e) => { const row = e.target.closest('.il-row'); if (row && row.dataset.ind) toggleInd(row.dataset.ind); });
  renderIndLegend();
}

// ---------- indicators: Ripster EMA clouds (filled band between each EMA pair) ----------
const RIPSTER = [   // Ripster EMA Clouds — pairs + per-cloud style; matches the default look (hl2 source)
  { fast: 8,   slow: 9,   a: 0.55, dir: true,  line: 'rgba(255,255,255,0.22)' },               // fast green/red
  { fast: 5,   slow: 12,  a: 0.32, dir: true,  line: 'rgba(255,255,255,0.18)' },               // momentum green/red
  { fast: 34,  slow: 50,  a: 0.22, dir: true,  line: 'rgba(255,255,255,0.15)' },               // medium green/red
  { fast: 72,  slow: 89,  a: 0.30, dir: false, fill: '#9c7a4d', line: 'rgba(156,122,77,0.9)' }, // brown band
  { fast: 180, slow: 200, a: 0.32, dir: false, fill: '#5b8def', line: 'rgba(91,141,239,0.95)' },// blue band
];
let ripsterOn = loadJSON('rt_ripster', true);
let ripsterData = [];
function emaArr(vals, n) { const k = 2 / (n + 1), out = new Array(vals.length); let prev; for (let i = 0; i < vals.length; i++) { prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k); out[i] = prev; } return out; }
function computeRipster() { const c = bars.map(b => (b.high + b.low) / 2); ripsterData = RIPSTER.map(r => ({ fast: emaArr(c, r.fast), slow: emaArr(c, r.slow), st: r })); } // hl2 source (Ripster default)
const ripsterPrimitive = {
  attached(p) { this._req = p.requestUpdate; },
  updateAllViews() {},
  paneViews: () => [{
    zOrder: () => 'bottom',
    renderer: () => ({ draw: (target) => {
      if (!ripsterOn || !ripsterData.length) return;
      try {
        target.useMediaCoordinateSpace((scope) => {
          const ctx = scope.context, ts = chart.timeScale(), range = ts.getVisibleLogicalRange();
          if (!range) return;
          const from = Math.max(0, Math.floor(range.from)), to = Math.min(bars.length - 1, Math.ceil(range.to));
          const xs = []; for (let i = from; i <= to; i++) xs[i] = ts.timeToCoordinate(bars[i].time);
          for (const cl of ripsterData) {
            for (let i = from; i < to; i++) {
              const x0 = xs[i], x1 = xs[i + 1]; if (x0 == null || x1 == null) continue;
              const f0 = candle.priceToCoordinate(cl.fast[i]), s0 = candle.priceToCoordinate(cl.slow[i]);
              const f1 = candle.priceToCoordinate(cl.fast[i + 1]), s1 = candle.priceToCoordinate(cl.slow[i + 1]);
              if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
              ctx.beginPath(); ctx.moveTo(x0, f0); ctx.lineTo(x1, f1); ctx.lineTo(x1, s1); ctx.lineTo(x0, s0); ctx.closePath();
              ctx.globalAlpha = cl.st.a; ctx.fillStyle = cl.st.dir ? (cl.fast[i] >= cl.slow[i] ? '#0ecb81' : '#f6465d') : cl.st.fill; ctx.fill(); ctx.globalAlpha = 1;
            }
            for (const w of ['fast', 'slow']) {
              ctx.beginPath(); let st = false;
              for (let i = from; i <= to; i++) { const x = xs[i]; if (x == null) { st = false; continue; } const y = candle.priceToCoordinate(cl[w][i]); if (y == null) { st = false; continue; } if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y); }
              ctx.strokeStyle = cl.st.line; ctx.lineWidth = w === 'fast' ? 1.4 : 1.0; ctx.stroke();
            }
          }
        });
        window.__rip = { n: ((window.__rip || {}).n || 0) + 1, ok: true };
      } catch (e) { window.__rip = { err: String(e) }; }
    } })
  }],
};
if (candle.attachPrimitive) candle.attachPrimitive(ripsterPrimitive);
function ripsterRepaint() { if (ripsterPrimitive._req) ripsterPrimitive._req(); }

// ===================================================================
//  OSCILLATOR SUB-PANE  — RSI(14) / MACD(12,26,9) in a 2nd LWC chart
//  Lightweight Charts v4.2.3 has no native multi-pane, so we create a
//  SECOND createChart() in #oscPane and keep its time axis locked to
//  the main chart via bidirectional visible-logical-range sync.
//  Reveal is mirrored to the candle reveal (slice 0..idx).
//  Assumes in scope: chart, candle, bars, idx, rebuildTf, loadJSON,
//  saveJSON, $, toast.  (Uses same color tokens as the app.)
// ===================================================================

// ---- palette (must be literal hex — a 2nd chart can't read CSS vars) ----
const OSC_COL = {
  bg:    '#0b0e11', grid: '#1b2027', border: '#2b3139', txt: '#707a8a',
  rsi:   '#c026d3',                       // RSI line (magenta, distinct from Ripster)
  guide: '#3a4150',                       // 30/70/50 guide lines
  macd:  '#2962ff', signal: '#fcd535',    // MACD line / signal line
  up:    '#0ecb81', down: '#f6465d',      // histogram + matches candle body colors
};

// ---- state ----
let oscMode = loadJSON('rt_oscMode', 'rsi');   // 'rsi' | 'macd' | 'off'
let oscChart = null, oscSyncing = false;       // reentrancy guard for range sync
let rsiSeries = null, macdHist = null, macdLine = null, sigLine = null;
let oscRsi = [], oscMacd = [];                 // full-length computed arrays (parallel to bars[])

// ---- indicator math (TradingView-accurate) -------------------------------
// Wilder's RSI(14): seed with simple averages over first `len` deltas, then RMA.
function computeRSI(src, len) {
  const n = src.length, out = new Array(n).fill(null);
  if (n < len + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= len; i++) { const d = src[i] - src[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  let ag = gain / len, al = loss / len;
  out[len] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = len + 1; i < n; i++) {
    const d = src[i] - src[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag * (len - 1) + g) / len; al = (al * (len - 1) + l) / len;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
// EMA over array; null until the series can be seeded (i >= len-1), SMA seed.
function emaSeries(src, len) {
  const n = src.length, out = new Array(n).fill(null), k = 2 / (len + 1);
  if (n < len) return out;
  let sum = 0; for (let i = 0; i < len; i++) sum += src[i];
  let prev = sum / len; out[len - 1] = prev;
  for (let i = len; i < n; i++) { prev = src[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}
// MACD(12,26,9): macd=EMA12-EMA26, signal=EMA9(macd), hist=macd-signal.
function computeMACD(src, fast, slow, sigLen) {
  const n = src.length, ef = emaSeries(src, fast), es = emaSeries(src, slow);
  const macd = new Array(n).fill(null);
  for (let i = 0; i < n; i++) if (ef[i] != null && es[i] != null) macd[i] = ef[i] - es[i];
  // signal = EMA of the dense (non-null) MACD tail, then re-aligned to original indices
  const firstM = macd.findIndex(v => v != null);
  const out = new Array(n).fill(null);
  if (firstM < 0) return out;
  const dense = macd.slice(firstM), sig = emaSeries(dense, sigLen);
  for (let j = 0; j < dense.length; j++) {
    const i = firstM + j;
    out[i] = { macd: dense[j], signal: sig[j], hist: sig[j] == null ? null : dense[j] - sig[j] };
  }
  return out;
}

// ---- compute (call on rebuildTf + dataset load) --------------------------
function oscCompute() {
  const close = bars.map(b => b.close);
  oscRsi = computeRSI(close, 14);
  oscMacd = computeMACD(close, 12, 26, 9);
}

// ---- chart creation (lazy: only when first turned on) --------------------
function ensureOscChart() {
  if (oscChart) return;
  oscChart = LightweightCharts.createChart($('oscPane'), {
    layout: { background: { color: OSC_COL.bg }, textColor: OSC_COL.txt, fontSize: 10 },
    grid: { vertLines: { color: OSC_COL.grid }, horzLines: { color: OSC_COL.grid } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: OSC_COL.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
    localization: { timeFormatter: etCrosshairFmt },
    // keep BOTH time scales identical so columns line up 1:1 with the main chart
    timeScale: { borderColor: OSC_COL.border, timeVisible: true, secondsVisible: true, rightOffset: 6, visible: false, tickMarkFormatter: etTickFmt },
    handleScale: { axisPressedMouseMove: { time: false } }, // x-zoom only via main chart
  });

  // --- bidirectional time-range sync (guarded against feedback loop) ---
  const mainTs = chart.timeScale(), oscTs = oscChart.timeScale();
  mainTs.subscribeVisibleLogicalRangeChange(r => {
    if (oscSyncing || !r) return; oscSyncing = true;
    try { oscTs.setVisibleLogicalRange(r); } catch (e) {} oscSyncing = false;
  });
  oscTs.subscribeVisibleLogicalRangeChange(r => {
    if (oscSyncing || !r) return; oscSyncing = true;
    try { mainTs.setVisibleLogicalRange(r); } catch (e) {} oscSyncing = false;
  });
  // mirror crosshair from main -> osc so the vertical line tracks across both
  chart.subscribeCrosshairMove(p => {
    if (!oscChart) return;
    if (p && p.time != null) { try { oscChart.setCrosshairPosition(0, p.time, oscRsiAnchor()); } catch (e) {} }
    else oscChart.clearCrosshairPosition();
  });

  new ResizeObserver(oscResize).observe($('oscPane'));
}
// any series handle works as the crosshair anchor; pick whichever is live
function oscRsiAnchor() { return rsiSeries || macdLine || macdHist; }

function oscResize() {
  if (!oscChart) return;
  const el = $('oscPane'), w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  oscChart.resize(w - 1, h, true); oscChart.resize(w, h, true); // double-resize (LWC no-ops same-size)
}

// ---- (re)build series for the current mode -------------------------------
function oscBuildSeries() {
  if (!oscChart) return;
  // tear down whatever exists
  [rsiSeries, macdHist, macdLine, sigLine].forEach(s => { if (s) try { oscChart.removeSeries(s); } catch (e) {} });
  rsiSeries = macdHist = macdLine = sigLine = null;

  if (oscMode === 'rsi') {
    rsiSeries = oscChart.addLineSeries({ color: OSC_COL.rsi, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    rsiSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    rsiSeries.createPriceLine({ price: 70, color: OSC_COL.guide, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '70' });
    rsiSeries.createPriceLine({ price: 50, color: OSC_COL.guide, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false });
    rsiSeries.createPriceLine({ price: 30, color: OSC_COL.guide, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '30' });
  } else if (oscMode === 'macd') {
    macdHist = oscChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    macdLine = oscChart.addLineSeries({ color: OSC_COL.macd, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    sigLine  = oscChart.addLineSeries({ color: OSC_COL.signal, lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
  }
}

// ---- reveal helpers (mirror the candle reveal) ---------------------------
// full hard reveal: slice 0..idx, like hardReveal() does for the candle.
function oscHardReveal() {
  if (oscMode === 'off') { if ($('oscPane')) $('oscPane').style.display = 'none'; return; }
  ensureOscChart(); $('oscPane').style.display = '';
  if (!rsiSeries && !macdLine) oscBuildSeries();
  const hi = Math.min(idx, bars.length - 1);

  if (oscMode === 'rsi' && rsiSeries) {
    const d = [];
    for (let i = 0; i <= hi; i++) if (oscRsi[i] != null) d.push({ time: bars[i].time, value: oscRsi[i] });
    rsiSeries.setData(d);
  } else if (oscMode === 'macd' && macdLine) {
    const dl = [], ds = [], dh = [];
    for (let i = 0; i <= hi; i++) {
      const m = oscMacd[i]; if (!m) continue;
      if (m.macd   != null) dl.push({ time: bars[i].time, value: m.macd });
      if (m.signal != null) ds.push({ time: bars[i].time, value: m.signal });
      if (m.hist   != null) dh.push({ time: bars[i].time, value: m.hist, color: m.hist >= 0 ? OSC_COL.up : OSC_COL.down });
    }
    macdLine.setData(dl); sigLine.setData(ds); macdHist.setData(dh);
  }
  oscResize();
}
// incremental reveal of the single newly-revealed bar (call from stepFwd()).
function oscStepFwd() {
  if (oscMode === 'off' || !oscChart) return;
  const i = idx; if (i < 0 || i >= bars.length) return;
  if (oscMode === 'rsi' && rsiSeries) {
    if (oscRsi[i] != null) rsiSeries.update({ time: bars[i].time, value: oscRsi[i] });
  } else if (oscMode === 'macd' && macdLine) {
    const m = oscMacd[i]; if (!m) return;
    if (m.macd   != null) macdLine.update({ time: bars[i].time, value: m.macd });
    if (m.signal != null) sigLine.update({ time: bars[i].time, value: m.signal });
    if (m.hist   != null) macdHist.update({ time: bars[i].time, value: m.hist, color: m.hist >= 0 ? OSC_COL.up : OSC_COL.down });
  }
}

// ---- mode switch (selector handler) --------------------------------------
function setOscMode(m) {
  oscMode = m; saveJSON('rt_oscMode', m);
  const tag = $('oscTag'); if (tag) tag.textContent = m === 'off' ? 'OSC' : m.toUpperCase();
  if (m === 'off') {
    if (oscChart) { [rsiSeries, macdHist, macdLine, sigLine].forEach(s => { if (s) try { oscChart.removeSeries(s); } catch (e) {} }); rsiSeries = macdHist = macdLine = sigLine = null; }
    if ($('oscPane')) $('oscPane').style.display = 'none';
  } else {
    ensureOscChart(); oscBuildSeries(); oscHardReveal();
    // adopt the main chart's current visible range immediately
    oscSyncing = true; try { oscChart.timeScale().setVisibleLogicalRange(chart.timeScale().getVisibleLogicalRange()); } catch (e) {} oscSyncing = false;
  }
}

// ---- one-time wiring (call from wire()) ----------------------------------
function wireOsc() {
  const sel = $('oscSelect'); if (!sel) return;
  sel.value = oscMode;
  sel.onchange = (e) => setOscMode(e.target.value);
  // initial paint (only builds the 2nd chart if not 'off')
  oscCompute(); setOscMode(oscMode);
}

// debug hook (optional)
window.__osc = () => ({ mode: oscMode, hasChart: !!oscChart, rsiLen: oscRsi.filter(v => v != null).length, macdLen: oscMacd.filter(v => v != null).length });

// ===================================================================
// PRICE-OVERLAY INDICATORS — session VWAP + Bollinger Bands + EMA ribbon
// One custom Series Primitive (zOrder 'bottom') drawn under the candles.
// Reuses the existing emaArr(); aligns to the app's real palette + helpers
// (tradingDayKey / etMinutes already in scope). Recompute in rebuildTf().
// ===================================================================

// ---------- indicator state (persisted) ----------
let vwapOn = loadJSON('rt_vwap', true);
let bbOn   = loadJSON('rt_bb',   false);
let emaOn  = loadJSON('rt_ema',  false);
let emaPeriods = (loadJSON('rt_ema_p', [9, 21, 50, 200]) || [9, 21, 50, 200])
  .filter(n => Number.isFinite(n) && n >= 1).slice(0, 6); // guard persisted value
const BB_PERIOD = 20, BB_MULT = 2;

// EMA ribbon colors (cool->warm as period grows; falls back to amber if list is longer)
const EMA_COLORS = ['#42a5f5', '#26a69a', '#f0b90b', '#ef5350', '#ab47bc', '#8b93a7'];
const VWAP_COLOR = '#e040fb';                 // session VWAP — distinct magenta
const BB_LINE = 'rgba(139,147,167,0.85)';     // --dim, opaque-ish
const BB_MID = 'rgba(240,185,11,0.85)';       // --amber mid (basis)
const BB_FILL = 'rgba(139,147,167,0.07)';     // very faint band fill

// ---------- computed arrays (indexed parallel to bars[]) ----------
let vwapData = [];                 // number|null per bar
let bbData = { mid: [], up: [], lo: [] };
let emaData = [];                  // [{ period, color, arr:[...] }]

// Session-anchored VWAP: cumulative (typicalPrice * volume) / cumulative volume,
// re-anchored (a) when the ET trading day changes, and (b) at the 09:30 ET cash
// open — so the overnight Globex session can't pollute the RTH anchor. DST-safe
// via the app's existing tradingDayKey()/etMinutes().
function computeVWAP() {
  vwapData = new Array(bars.length).fill(null);
  let cumPV = 0, cumV = 0, prevDay = null, anchored = false;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const day = tradingDayKey(b.time);          // futures trading-day key (18:00 ET boundary)
    const m = etMinutes(b.time);                 // minutes since ET midnight
    const inRth = m >= 570 && m < 960;           // 09:30–15:59 ET
    if (day !== prevDay) { cumPV = 0; cumV = 0; prevDay = day; anchored = false; }
    // re-anchor exactly on the first RTH bar of the day (cash open)
    if (inRth && !anchored) { cumPV = 0; cumV = 0; anchored = true; }
    const tp = (b.high + b.low + b.close) / 3;   // typical price
    cumPV += tp * b.volume; cumV += b.volume;
    vwapData[i] = cumV > 0 ? cumPV / cumV : null;
  }
}

// Bollinger Bands: 20-period SMA of close ± 2*stdev (population). O(n) rolling sums.
function computeBB() {
  const n = bars.length, P = BB_PERIOD, K = BB_MULT;
  const mid = new Array(n).fill(null), up = new Array(n).fill(null), lo = new Array(n).fill(null);
  let sum = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const c = bars[i].close; sum += c; sq += c * c;
    if (i >= P) { const o = bars[i - P].close; sum -= o; sq -= o * o; }
    if (i >= P - 1) {
      const mean = sum / P; let v = sq / P - mean * mean; if (v < 0) v = 0; // clamp fp noise
      const sd = Math.sqrt(v);
      mid[i] = mean; up[i] = mean + K * sd; lo[i] = mean - K * sd;
    }
  }
  bbData = { mid, up, lo };
}

// EMA ribbon: configurable list of EMA periods over close (reuses emaArr()).
function computeEMA() {
  const c = bars.map(b => b.close);
  emaData = emaPeriods.map((p, i) => ({ period: p, color: EMA_COLORS[i] || '#8b93a7', arr: emaArr(c, p) }));
}

// Call from rebuildTf() (after bars is set). Cheap; only recomputes what's needed.
function computeIndicators() {
  computeVWAP(); computeBB(); computeEMA();
}

// ---------- the primitive (zOrder 'bottom', under candles) ----------
const indicatorPrimitive = {
  attached(p) { this._req = p.requestUpdate; },
  updateAllViews() {},
  paneViews: () => [{
    zOrder: () => 'bottom',
    renderer: () => ({ draw: (target) => {
      if (!vwapOn && !bbOn && !emaOn) return;
      if (!bars.length) return;
      try {
        target.useMediaCoordinateSpace((scope) => {
          const ctx = scope.context, ts = chart.timeScale();
          const range = ts.getVisibleLogicalRange(); if (!range) return;
          // clamp to revealed bars too: don't draw indicator past idx during replay
          const last = Math.min(bars.length - 1, idx);
          const from = Math.max(0, Math.floor(range.from));
          const to = Math.min(last, Math.ceil(range.to));
          if (to < from) return;
          const xs = []; for (let i = from; i <= to; i++) xs[i] = ts.timeToCoordinate(bars[i].time);

          // polyline helper: breaks the path on any null x/y so gaps (warmup, off-screen) don't bridge
          const line = (arr, color, width) => {
            ctx.beginPath(); let started = false;
            for (let i = from; i <= to; i++) {
              const x = xs[i]; const val = arr[i];
              if (x == null || val == null) { started = false; continue; }
              const y = candle.priceToCoordinate(val);
              if (y == null) { started = false; continue; }
              if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
          };

          // --- Bollinger Bands (fill first so lines sit on top) ---
          if (bbOn) {
            // faint band fill: upper across, then lower back, segment-by-segment to respect nulls
            ctx.beginPath(); let open = false;
            for (let i = from; i <= to; i++) {
              const x = xs[i], u = bbData.up[i];
              if (x == null || u == null) { open = false; continue; }
              const yu = candle.priceToCoordinate(u); if (yu == null) { open = false; continue; }
              if (!open) { ctx.moveTo(x, yu); open = true; } else ctx.lineTo(x, yu);
            }
            for (let i = to; i >= from; i--) {
              const x = xs[i], l = bbData.lo[i];
              if (x == null || l == null) continue;
              const yl = candle.priceToCoordinate(l); if (yl == null) continue;
              ctx.lineTo(x, yl);
            }
            ctx.closePath(); ctx.fillStyle = BB_FILL; ctx.fill();
            line(bbData.up, BB_LINE, 1);
            line(bbData.lo, BB_LINE, 1);
            line(bbData.mid, BB_MID, 1);
          }

          // --- EMA ribbon ---
          if (emaOn) for (const e of emaData) line(e.arr, e.color, 1.3);

          // --- session VWAP (drawn last so it reads on top of the ribbon) ---
          if (vwapOn) line(vwapData, VWAP_COLOR, 1.6);
        });
        window.__ind = { n: ((window.__ind || {}).n || 0) + 1, ok: true };
      } catch (e) { window.__ind = { err: String(e) }; }
    } })
  }],
};
if (candle.attachPrimitive) candle.attachPrimitive(indicatorPrimitive);
function indicatorRepaint() { if (indicatorPrimitive._req) indicatorPrimitive._req(); }

// ---------- toggles ----------
function setVwap(on) { vwapOn = on; saveJSON('rt_vwap', vwapOn); indicatorRepaint(); renderIndLegend(); }
function setBB(on)   { bbOn = on;   saveJSON('rt_bb',   bbOn);   indicatorRepaint(); renderIndLegend(); }
function setEMA(on)  { emaOn = on;  saveJSON('rt_ema',  emaOn);  indicatorRepaint(); renderIndLegend(); }
// optional: change the ribbon periods at runtime, e.g. setEmaPeriods("9,21,55,200")
function setEmaPeriods(csv) {
  const list = String(csv).split(/[\s,]+/).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n >= 1).slice(0, 6);
  if (!list.length) return toast('Invalid EMA periods');
  emaPeriods = list; saveJSON('rt_ema_p', emaPeriods);
  computeEMA(); indicatorRepaint(); toast('EMA: ' + list.join('/'));
}

// ---------- drawings (horizontal line / trend line / ray / rectangle) ----------
const drawingsPrimitive = {
  attached(p) { this._req = p.requestUpdate; },
  updateAllViews() {},
  paneViews: () => [{
    zOrder: () => 'top',
    renderer: () => ({ draw: (target) => {
      if (!drawings.length && !pendingPt) return;
      try {
        target.useMediaCoordinateSpace((scope) => {
          const ctx = scope.context, W = scope.mediaSize.width, ts = chart.timeScale();
          const X = (t) => ts.timeToCoordinate(t), Y = (p) => candle.priceToCoordinate(p);
          for (const d of drawings) {
            ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = 1.5;
            if (d.type === 'hl') { const y = Y(d.p1.p); if (y == null) continue; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); continue; }
            if (d.type === 'fib') { drawFib(ctx, d, X, Y, W); continue; }
            if (d.type === 'measure') { drawMeasure(ctx, d, X, Y); continue; }
            if (d.type === 'rr') { drawRR(ctx, d, X, Y, W); continue; }
            const x1 = X(d.p1.t), y1 = Y(d.p1.p), x2 = X(d.p2.t), y2 = Y(d.p2.p);
            if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
            if (d.type === 'box') { const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1); ctx.globalAlpha = 0.12; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeRect(x, y, w, h); }
            else { ctx.beginPath(); ctx.moveTo(x1, y1); if (d.type === 'ray') { const dx = x2 - x1, dy = y2 - y1, tx = dx >= 0 ? W : 0, s = dx !== 0 ? (tx - x1) / dx : 0; ctx.lineTo(dx !== 0 ? tx : x2, dx !== 0 ? y1 + dy * s : y2); } else ctx.lineTo(x2, y2); ctx.stroke(); }
          }
          // editable anchor handles (small dots) so placed drawings can be grabbed + dragged
          for (const d of drawings) {
            if (d.type === 'hl' || d.type === 'measure' || d.type === 'rr') continue;   // these draw their own grab points / lines
            const hs = [d.p1]; if (d.p2) hs.push(d.p2);
            if (d.type === 'box' && d.p2) { hs.push({ t: d.p2.t, p: d.p1.p }, { t: d.p1.t, p: d.p2.p }); }
            for (const pt of hs) { const hx = X(pt.t), hy = Y(pt.p); if (hx == null || hy == null) continue; ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, 7); ctx.fillStyle = '#0b0e11'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = d.color || '#d1d4dc'; ctx.stroke(); }
          }
          // selected drawing: emphasise its anchors in brand amber (signals selected + draggable + deletable)
          if (selDrawing && drawings.includes(selDrawing)) {
            const d = selDrawing, hpts = [];
            if (d.type === 'hl') hpts.push({ t: null, p: d.p1.p });
            else if (d.type === 'rr') { hpts.push({ t: d.p1.t, p: d.p1.p }, { t: d.p1.t, p: d.stop }, { t: d.p1.t, p: d.target }); }
            else { if (d.p1) hpts.push(d.p1); if (d.p2) hpts.push(d.p2); }
            for (const pt of hpts) { const hx = pt.t == null ? W / 2 : X(pt.t), hy = Y(pt.p); if (hx == null || hy == null) continue; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 7); ctx.fillStyle = '#fcd535'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#0b0e11'; ctx.stroke(); }
          }
          if (pendingPt) { const x = X(pendingPt.t), y = Y(pendingPt.p); if (x != null && y != null) { ctx.fillStyle = '#f0b90b'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); } }
        });
        window.__drw = { n: ((window.__drw || {}).n || 0) + 1, ok: true };
      } catch (e) { window.__drw = { err: String(e) }; }
    } })
  }],
};
if (candle.attachPrimitive) candle.attachPrimitive(drawingsPrimitive);
function repaintOverlays() { if (ripsterPrimitive._req) ripsterPrimitive._req(); if (drawingsPrimitive._req) drawingsPrimitive._req(); indicatorRepaint(); }
function handleDrawClick(t, time, price) {
  price = rnd(price);
  if (t === 'hl') { drawings.push({ type: 'hl', p1: { t: time, p: price }, color: '#d1d4dc' }); selDrawing = drawings[drawings.length - 1]; saveJSON('rt_drawings', drawings); repaintOverlays(); return; }
  if (t === 'rr') {   // Long/Short position: click1 = entry, click2 = stop; target auto-placed at 2R
    if (!pendingPt) { pendingPt = { t: time, p: price }; repaintOverlays(); toast('Click the stop level'); return; }
    const entry = pendingPt.p, stop = price, target = rnd(entry + (entry - stop) * RR_DEFAULT);
    drawings.push({ type: 'rr', p1: { t: pendingPt.t, p: entry }, p2: { t: time, p: price }, stop, target, color: '#fcd535' });
    pendingPt = null; selDrawing = drawings[drawings.length - 1]; saveJSON('rt_drawings', drawings); repaintOverlays(); return;
  }
  if (!pendingPt) { pendingPt = { t: time, p: price }; repaintOverlays(); toast('Click the second point'); return; }
  drawings.push({ type: t, p1: pendingPt, p2: { t: time, p: price }, color: t === 'box' ? '#2962ff' : t === 'fib' ? '#fcd535' : '#d1d4dc' });
  pendingPt = null; selDrawing = drawings[drawings.length - 1]; saveJSON('rt_drawings', drawings); repaintOverlays();
}
function clearDrawings() { drawings = []; pendingPt = null; saveJSON('rt_drawings', drawings); repaintOverlays(); toast('Drawings cleared'); }
// ---- Fibonacci retracement (drawing type 'fib', 2-point) ----
const FIB_LEVELS = [
  { lv: 0, c: '#787b86' }, { lv: 0.236, c: '#f6465d' }, { lv: 0.382, c: '#ff9f0a' }, { lv: 0.5, c: '#fcd535' },
  { lv: 0.618, c: '#0ecb81' }, { lv: 0.786, c: '#22c55e' }, { lv: 1, c: '#787b86' }, { lv: 1.272, c: '#3b82f6' }, { lv: 1.618, c: '#7c5cff' },
];
const FIB_FILL_A = 0.05, FIB_LINE_A = 0.85;
function drawFib(ctx, d, X, Y, W) {
  const p1y = Y(d.p1.p), p2y = Y(d.p2.p), xa = X(d.p1.t), xb = X(d.p2.t);
  if (p1y == null || p2y == null) return;
  let xL = Math.min(xa == null ? 0 : xa, xb == null ? 0 : xb); if (!isFinite(xL) || xL < 0) xL = 0;
  const span = d.p2.p - d.p1.p, ys = FIB_LEVELS.map(f => Y(d.p1.p + span * f.lv));
  ctx.save();
  for (let i = 0; i < FIB_LEVELS.length - 1; i++) { const y0 = ys[i], y1 = ys[i + 1]; if (y0 == null || y1 == null) continue; ctx.globalAlpha = FIB_FILL_A; ctx.fillStyle = FIB_LEVELS[i].c; ctx.fillRect(xL, Math.min(y0, y1), Math.max(1, W - xL), Math.abs(y1 - y0)); }
  ctx.globalAlpha = FIB_LINE_A; ctx.lineWidth = 1; ctx.font = '10px "SF Mono",Consolas,monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (let i = 0; i < FIB_LEVELS.length; i++) { const y = ys[i]; if (y == null) continue; const f = FIB_LEVELS[i]; ctx.strokeStyle = f.c; ctx.setLineDash(f.lv === 0 || f.lv === 1 ? [] : [4, 3]); ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(W, y); ctx.stroke(); const price = d.p1.p + span * f.lv; ctx.fillStyle = f.c; ctx.fillText(`${f.lv.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}  ${f2(price)}`, xL + 4, y - 6); }
  ctx.setLineDash([]); ctx.restore();
}
// ---- Measure / ruler (drawing type 'measure', 2-point) ----
function fmtDur(sec) { if (sec < 60) return Math.round(sec) + 's'; const m = Math.round(sec / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60), rm = m % 60; if (h < 24) return rm ? `${h}h ${pad(rm)}m` : `${h}h`; const d = Math.floor(h / 24), rh = h % 24; return rh ? `${d}d ${pad(rh)}h` : `${d}d`; }
function drawMeasure(ctx, d, X, Y) {
  const x1 = X(d.p1.t), y1 = Y(d.p1.p), x2 = X(d.p2.t), y2 = Y(d.p2.p);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;
  const dPts = d.p2.p - d.p1.p, dTicks = tcount(d.p2.p, d.p1.p), dPct = d.p1.p ? (dPts / d.p1.p) * 100 : 0;
  const i1 = bars.findIndex(b => b.time === d.p1.t), i2 = bars.findIndex(b => b.time === d.p2.t);
  const nBars = (i1 >= 0 && i2 >= 0) ? Math.abs(i2 - i1) : 0, dSec = Math.abs(d.p2.t - d.p1.t), up = dPts >= 0;
  const bx = Math.min(x1, x2), by = Math.min(y1, y2), bw = Math.max(1, Math.abs(x2 - x1)), bh = Math.max(1, Math.abs(y2 - y1)), col = up ? '#0ecb81' : '#f6465d';
  ctx.save();
  ctx.globalAlpha = 0.14; ctx.fillStyle = col; ctx.fillRect(bx, by, bw, bh); ctx.globalAlpha = 1;
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, bw, bh);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x1, y1, 3.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(x2, y2, 3.5, 0, 7); ctx.fill();
  const sgn = dPts >= 0 ? '+' : '';
  const label = `Δ ${sgn}${f2(dPts)} (${sgn}${dTicks}t) ${sgn}${dPct.toFixed(2)}%  •  ${nBars} bars  •  ${fmtDur(dSec)}`;
  ctx.font = '600 12px ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif'; ctx.textBaseline = 'middle';
  const padX = 7, tw = ctx.measureText(label).width, pillW = tw + padX * 2, pillH = 20;
  let px = Math.max(2, (x1 + x2) / 2 - pillW / 2), py = Math.max(2, (y1 + y2) / 2 - pillH / 2);
  ctx.fillStyle = '#161a1e'; ctx.globalAlpha = 0.92;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 5); ctx.fill(); } else ctx.fillRect(px, py, pillW, pillH);
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 5); ctx.stroke(); } else ctx.strokeRect(px, py, pillW, pillH);
  ctx.fillStyle = '#eaecef'; ctx.textAlign = 'left'; ctx.fillText(label, px + padX, py + pillH / 2 + 0.5);
  ctx.restore();
}
// ---- Long/Short position R:R tool (drawing type 'rr') — entry / stop / target zones + R:R ----
const RR_DEFAULT = 2;   // default reward = 2R when first placed
function drawRR(ctx, d, X, Y, W) {
  const xe = X(d.p1.t), x2 = X(d.p2.t), ye = Y(d.p1.p), ys = Y(d.stop), yt = Y(d.target);
  if (ye == null || ys == null || yt == null) return;
  let xa = Math.min(xe == null ? 0 : xe, x2 == null ? 0 : x2), xb = Math.max(xe == null ? 0 : xe, x2 == null ? 0 : x2);
  if (!isFinite(xa)) xa = 0; if (!isFinite(xb) || xb <= xa) xb = xa + 120;
  const w = Math.max(2, xb - xa), long = d.target >= d.p1.p;
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#0ecb81'; ctx.fillRect(xa, Math.min(ye, yt), w, Math.abs(yt - ye));   // reward zone
  ctx.fillStyle = '#f6465d'; ctx.fillRect(xa, Math.min(ye, ys), w, Math.abs(ys - ye));   // risk zone
  ctx.globalAlpha = 1;
  const hline = (yy, col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(xb, yy); ctx.stroke(); };
  hline(yt, '#0ecb81'); hline(ys, '#f6465d'); hline(ye, '#d1d4dc', [5, 3]); ctx.setLineDash([]);
  const riskT = Math.abs(tcount(d.p1.p, d.stop)), rewT = Math.abs(tcount(d.target, d.p1.p));
  const rr = riskT > 0 ? rewT / riskT : 0;
  ctx.font = '600 11px ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let lx = xb + 6; const longest = 150; if (lx + longest > W) lx = Math.max(2, xa + 6);   // keep labels on-screen
  ctx.fillStyle = '#0ecb81'; ctx.fillText(`Target +${rewT}t  ${usd(rewT * INSTR.tickValue)}/c`, lx, yt);
  ctx.fillStyle = '#f6465d'; ctx.fillText(`Stop −${riskT}t  ${usd(riskT * INSTR.tickValue)}/c`, lx, ys);
  ctx.fillStyle = '#eaecef'; ctx.fillText(`${long ? 'LONG' : 'SHORT'} @ ${f2(d.p1.p)}  ·  R:R ${rr.toFixed(2)}`, lx, ye);
  ctx.restore();
}

// ---------- chart tools: drag stop/target/entry lines + click tools (set-start / annotations) ----------
let tool = '', drag = null, dragH = null;   // dragH = drawing-anchor being dragged (endpoint edit)
let dragBody = null, selDrawing = null;     // dragBody = whole-drawing move; selDrawing = currently selected drawing
let annotations = loadJSON('rt_annotations', []);   // {baseTime, position, color, shape, text}
let drawings = loadJSON('rt_drawings', []);         // {type:'hl'|'tl'|'ray'|'box', p1:{t,p}, p2?:{t,p}, color}
let pendingPt = null;                                // first click of a 2-point drawing
const ANN = {
  au:    { position: 'belowBar', color: '#0ecb81', shape: 'arrowUp',   text: '' },
  ad:    { position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: '' },
  long:  { position: 'belowBar', color: '#0ecb81', shape: 'arrowUp',   text: 'LONG' },
  short: { position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: 'SHORT' },
};
const TOOLBTN = { start: 'btnPickStart', au: 'annUp', ad: 'annDown', long: 'annLong', short: 'annShort', hl: 'drwHL', tl: 'drwTL', ray: 'drwRay', box: 'drwBox', fib: 'drwFib', measure: 'drwMeasure', rr: 'drwRR' };
function placeAnnotation(t, baseTime) { const a = ANN[t]; if (!a) return; annotations.push({ baseTime, ...a }); saveJSON('rt_annotations', annotations); refreshMarkers(); }
function clearAnnotations() { annotations = []; saveJSON('rt_annotations', annotations); refreshMarkers(); toast('Markers cleared'); }
function updateToolUI() { Object.values(TOOLBTN).forEach(id => { const b = $(id); if (b) b.classList.remove('active'); }); const b = $(TOOLBTN[tool]); if (b) b.classList.add('active'); const cur = $('toolCursor'); if (cur) cur.classList.toggle('active', !tool); $('chart').style.cursor = tool ? 'crosshair' : ''; }
function setTool(t) { tool = (tool === t) ? '' : t; pendingPt = null; repaintOverlays(); updateToolUI(); }
function draggableLines() {
  const a = [];
  if (entryOrder) {
    const long = entryOrder.side === 'long';
    a.push({ get: () => entryOrder.price, set: p => entryOrder.price = p });   // dragging entry moves the whole bracket (ticks fixed)
    if (entryOrder.slTicks > 0) a.push({ get: () => rnd(long ? entryOrder.price - entryOrder.slTicks * TICK : entryOrder.price + entryOrder.slTicks * TICK), set: p => { entryOrder.slTicks = Math.max(1, Math.round(Math.abs(entryOrder.price - p) / TICK)); } });
    (entryOrder.tgts || []).forEach(tg => { if (tg.ticks > 0) a.push({ get: () => rnd(long ? entryOrder.price + tg.ticks * TICK : entryOrder.price - tg.ticks * TICK), set: p => { tg.ticks = Math.max(1, Math.round(Math.abs(p - entryOrder.price) / TICK)); } }); });
  }
  if (position) orders.forEach(o => { if (o.type === 'stop' || o.type === 'target') a.push({ get: () => o.price, set: p => o.price = p }); });
  return a;
}
function nearestLine(y) { let best = null, bd = 7; for (const L of draggableLines()) { const ly = candle.priceToCoordinate(L.get()); if (ly == null) continue; const d = Math.abs(ly - y); if (d < bd) { bd = d; best = L; } } return best; }
// ---- drawing endpoint editing: hit-test + drag the anchors of placed drawings ----
// Each handle exposes apply(time, price) that writes back into the drawing's p1/p2 in place.
// HL = horizontal full-width line, so only price is editable (horiz:true, time ignored).
function drawingHandles() {
  const out = [], ts = chart.timeScale();
  const X = (t) => ts.timeToCoordinate(t), Y = (p) => candle.priceToCoordinate(p);
  for (const d of drawings) {
    if (d.type === 'hl') { const y = Y(d.p1.p); if (y != null) out.push({ d, horiz: true, hy: y, apply: (t, p) => { d.p1.p = p; } }); continue; }
    if (d.type === 'rr') {   // entry handle shifts all 3 levels together; stop / target move on their own
      const xe = X(d.p1.t), eY = Y(d.p1.p), sY = Y(d.stop), tY = Y(d.target);
      if (xe != null) {
        if (eY != null) out.push({ d, hx: xe, hy: eY, apply: (t, p) => { const dp = p - d.p1.p; d.p1.p = p; d.stop += dp; d.target += dp; if (t != null) d.p1.t = t; } });
        if (sY != null) out.push({ d, hx: xe, hy: sY, apply: (t, p) => { d.stop = p; } });
        if (tY != null) out.push({ d, hx: xe, hy: tY, apply: (t, p) => { d.target = p; } });
      }
      continue;
    }
    const x1 = X(d.p1.t), y1 = Y(d.p1.p), x2 = d.p2 ? X(d.p2.t) : null, y2 = d.p2 ? Y(d.p2.p) : null;
    if (x1 != null && y1 != null) out.push({ d, hx: x1, hy: y1, apply: (t, p) => { if (t != null) d.p1.t = t; d.p1.p = p; } });
    if (d.p2 && x2 != null && y2 != null) out.push({ d, hx: x2, hy: y2, apply: (t, p) => { if (t != null) d.p2.t = t; d.p2.p = p; } });
    if (d.type === 'box' && d.p2) {   // box: also let the two cross-corners drag (each writes one t + one p)
      if (x2 != null && y1 != null) out.push({ d, hx: x2, hy: y1, apply: (t, p) => { if (t != null) d.p2.t = t; d.p1.p = p; } });
      if (x1 != null && y2 != null) out.push({ d, hx: x1, hy: y2, apply: (t, p) => { if (t != null) d.p1.t = t; d.p2.p = p; } });
    }
  }
  return out;
}
// hit-test a drawing's BODY (line/shape, not just its anchors) for select + whole-move
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function drawingAt(x, y) {
  const ts = chart.timeScale(), W = $('chart').clientWidth, TH = 6;
  const X = (t) => ts.timeToCoordinate(t), Y = (p) => candle.priceToCoordinate(p);
  for (let k = drawings.length - 1; k >= 0; k--) {   // topmost first
    const d = drawings[k];
    if (d.type === 'hl') { const yy = Y(d.p1.p); if (yy != null && Math.abs(yy - y) < TH) return d; continue; }
    const x1 = X(d.p1.t), y1 = Y(d.p1.p);
    if (d.type === 'rr') { const x2 = X(d.p2.t); if (x1 == null || x2 == null) continue; if (x < Math.min(x1, x2) - 4 || x > Math.max(x1, x2) + 4) continue; for (const p of [d.p1.p, d.stop, d.target]) { const yy = Y(p); if (yy != null && Math.abs(yy - y) < TH) return d; } continue; }
    if (x1 == null || y1 == null) continue;
    if (d.type === 'fib') { const x2 = X(d.p2.t), xL = Math.min(x1, x2 == null ? x1 : x2); if (x < xL - 4) continue; const span = d.p2.p - d.p1.p; for (const f of FIB_LEVELS) { const yy = Y(d.p1.p + span * f.lv); if (yy != null && Math.abs(yy - y) < TH) return d; } continue; }
    const x2 = d.p2 ? X(d.p2.t) : null, y2 = d.p2 ? Y(d.p2.p) : null;
    if (x2 == null || y2 == null) continue;
    if (d.type === 'box') { const xa = Math.min(x1, x2), xb = Math.max(x1, x2), ya = Math.min(y1, y2), yb = Math.max(y1, y2);
      const nearV = (Math.abs(x - xa) < TH || Math.abs(x - xb) < TH) && y >= ya - TH && y <= yb + TH;
      const nearH = (Math.abs(y - ya) < TH || Math.abs(y - yb) < TH) && x >= xa - TH && x <= xb + TH;
      if (nearV || nearH) return d; continue; }
    let ex = x2, ey = y2;   // tl / ray / measure: segment (ray extends to the chart edge)
    if (d.type === 'ray') { const dx = x2 - x1, dy = y2 - y1; if (dx !== 0) { const tx = dx >= 0 ? W : 0, s = (tx - x1) / dx; ex = tx; ey = y1 + dy * s; } }
    if (pointSegDist(x, y, x1, y1, ex, ey) < TH) return d;
  }
  return null;
}
// enumerate a drawing's movable price/time fields (for whole-drawing move)
function drawingFields(d) {
  const A = [];
  if (d.type === 'hl') { A.push({ obj: d.p1, key: 'p', kind: 'p' }); return A; }
  if (d.type === 'rr') { A.push({ obj: d.p1, key: 'p', kind: 'p' }, { obj: d, key: 'stop', kind: 'p' }, { obj: d, key: 'target', kind: 'p' }, { obj: d.p1, key: 't', kind: 't' }, { obj: d.p2, key: 't', kind: 't' }); return A; }
  A.push({ obj: d.p1, key: 'p', kind: 'p' }, { obj: d.p1, key: 't', kind: 't' });
  if (d.p2) A.push({ obj: d.p2, key: 'p', kind: 'p' }, { obj: d.p2, key: 't', kind: 't' });
  return A;
}
function startBodyDrag(d, x, y) {
  const ts = chart.timeScale();
  dragBody = { d, sp: candle.coordinateToPrice(y), sLog: ts.coordinateToLogical(x),
    fields: drawingFields(d).map(f => f.kind === 'p' ? { ...f, orig: f.obj[f.key] } : { ...f, origIdx: bars.findIndex(b => b.time === f.obj[f.key]) }) };
}
function moveBody(x, y) {
  const ts = chart.timeScale(), p = candle.coordinateToPrice(y), lg = ts.coordinateToLogical(x);
  if (p == null || lg == null || !dragBody) return;
  const dPrice = p - dragBody.sp, dIdx = Math.round(lg - dragBody.sLog), hi = Math.min(idx, bars.length - 1);
  for (const f of dragBody.fields) {
    if (f.kind === 'p') f.obj[f.key] = rnd(f.orig + dPrice);
    else if (f.origIdx >= 0) { const ni = Math.max(0, Math.min(hi, f.origIdx + dIdx)); if (bars[ni]) f.obj[f.key] = bars[ni].time; }
  }
  repaintOverlays();
}
function deleteSelectedDrawing() {
  if (!selDrawing) return;
  const i = drawings.indexOf(selDrawing); if (i >= 0) drawings.splice(i, 1);
  selDrawing = null; saveJSON('rt_drawings', drawings); repaintOverlays(); toast('Drawing deleted');
}
function nearestHandle(x, y) {
  let best = null, bd = 9;
  for (const h of drawingHandles()) { const dd = h.horiz ? Math.abs(h.hy - y) : Math.hypot(h.hx - x, h.hy - y); if (dd < bd) { bd = dd; best = h; } }
  return best;
}
// map a chart-x pixel to the nearest revealed bar's time (snap to bar grid, clamp to 0..idx)
function xToTime(x) {
  const lg = chart.timeScale().coordinateToLogical(x); if (lg == null) return null;
  let i = Math.round(lg); i = Math.max(0, Math.min(Math.min(idx, bars.length - 1), i));
  return bars[i] ? bars[i].time : null;
}
chart.subscribeClick(param => {
  if (!tool || param.time == null) return;
  const i = bars.findIndex(b => b.time === param.time);
  if (i < 0) return;
  if (tool === 'start') { if (!locked()) setStart(bars[i].subEnd); tool = ''; updateToolUI(); return; }
  if (tool === 'au' || tool === 'ad' || tool === 'long' || tool === 'short') { placeAnnotation(tool, bars[i].time); return; }
  const price = param.point ? candle.coordinateToPrice(param.point.y) : bars[i].close;   // hl / tl / ray / box
  if (price != null) handleDrawClick(tool, param.time, price);
});
$('chart').addEventListener('mousedown', e => {
  if (e.button !== 0 || tool) return;             // left-button only; while a tool is armed, clicks place points
  const rect = $('chart').getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const h = nearestHandle(x, y);                  // 1) drawing anchor (endpoint) — most specific; also selects it
  if (h) { dragH = h; selDrawing = h.d; chart.applyOptions({ handleScroll: false, handleScale: false }); repaintOverlays(); e.preventDefault(); return; }
  const hd = drawingAt(x, y);                     // 2) drawing body — select + move the whole drawing
  if (hd) { selDrawing = hd; startBodyDrag(hd, x, y); chart.applyOptions({ handleScroll: false, handleScale: false }); repaintOverlays(); e.preventDefault(); return; }
  if (locked()) { const L = nearestLine(y); if (L) { drag = L; chart.applyOptions({ handleScroll: false, handleScale: false }); e.preventDefault(); return; } }  // 3) stop/target/entry lines
  if (selDrawing) { selDrawing = null; repaintOverlays(); }   // 4) empty space -> deselect (lets the chart pan)
});
window.addEventListener('mousemove', e => {
  const rect = $('chart').getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (dragH) {                                    // editing a drawing endpoint: snap price to tick, time to bar grid
    const p = candle.coordinateToPrice(y);
    if (p != null) { dragH.apply(dragH.horiz ? null : xToTime(x), rnd(p)); repaintOverlays(); }
    return;
  }
  if (dragBody) { moveBody(x, y); return; }       // moving a whole drawing
  if (!drag) return;
  const p = candle.coordinateToPrice(y);
  if (p != null) { drag.set(rnd(p)); drawLines(); renderLive(); }
});
window.addEventListener('mouseup', () => {
  if (dragH) { dragH = null; saveJSON('rt_drawings', drawings); chart.applyOptions({ handleScroll: true, handleScale: true }); return; }
  if (dragBody) { dragBody = null; saveJSON('rt_drawings', drawings); chart.applyOptions({ handleScroll: true, handleScale: true }); return; }
  if (drag) { drag = null; chart.applyOptions({ handleScroll: true, handleScale: true }); }
});
$('chart').addEventListener('mousemove', e => {
  if (drag || dragH || dragBody) return;
  if (tool) { $('chart').style.cursor = 'crosshair'; return; }
  const rect = $('chart').getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (nearestHandle(x, y) || drawingAt(x, y)) { $('chart').style.cursor = 'move'; return; }   // hovering a drawing/anchor
  $('chart').style.cursor = (locked() && nearestLine(y)) ? 'ns-resize' : '';
});

// ---------- timeframe aggregation ----------
function aggregate(base, m) {
  if (m === BASE_TF) return base.map((b, i) => ({ ...b, subStart: i, subEnd: i }));
  const out = []; let cur = null; const span = m * 60;
  for (let i = 0; i < base.length; i++) {
    const b = base[i]; const bucket = Math.floor(b.time / span) * span;
    if (!cur || cur.time !== bucket) { cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, subStart: i, subEnd: i }; out.push(cur); }
    else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; cur.subEnd = i; }
  }
  return out;
}
// ===== chart-type module (defines chart-type-aware cd + setChartType) =====
/* =====================================================================
 * CHART-TYPE SELECTOR  — swap the main price series at runtime
 * Candles · Hollow candles · Heikin-Ashi · Bars (OHLC) · Line · Area
 *
 * Mechanism: every reveal/feed in the app routes its bar->point mapping
 * through cd(b). We make cd() chart-type-aware (this is the ONLY seam the
 * reveal code needs), keep a precomputed Heikin-Ashi array, and provide
 * setChartType() which removes the old price series, creates the new one,
 * re-feeds revealed data, re-applies markers + price-lines, and re-attaches
 * the Ripster + drawings primitives onto the new series.
 *
 * REQUIRES (one-line edits, see wiring): `const candle` -> `let candle`,
 * `const vol` -> `let vol`, replace the existing `function cd(b)` with the
 * one below, and call rebuildHA() inside rebuildTf().
 * ===================================================================== */

let chartType = loadJSON('rt_charttype', 'candles');   // candles|hollow|ha|bars|line|area
let haBars = [];                                       // precomputed Heikin-Ashi OHLC, index-aligned to bars[]

// ---- Binance-dark palette for the price series ----
const CT_UP = '#0ecb81', CT_DOWN = '#f6465d', CT_LINE = '#fcd535', CT_TXT = '#eaecef';
const CT_TRANSPARENT = 'rgba(0,0,0,0)';

// Heikin-Ashi (recursive -> must be precomputed over the whole TF array).
// haClose=(o+h+l+c)/4 ; haOpen=avg(prevHaOpen,prevHaClose) ; high/low extend to haO/haC.
function rebuildHA() {
  haBars = new Array(bars.length);
  let pO, pC;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haC = (b.open + b.high + b.low + b.close) / 4;
    const haO = i === 0 ? (b.open + b.close) / 2 : (pO + pC) / 2;
    haBars[i] = { time: b.time, open: haO, high: Math.max(b.high, haO, haC), low: Math.min(b.low, haO, haC), close: haC };
    pO = haO; pC = haC;
  }
}

// ---- chart-type-aware bar -> series-point mapper ----
// REPLACES the app's original `function cd(b)` (which only returned OHLC).
// Candle/hollow/bars: {time,open,high,low,close}. line/area: {time,value}.
// ha: looked up by index from haBars (NOT recomputable from a single bar).
// Hollow look: per-bar transparent body on up-bars (+colored border/wick).
function cd(b) {
  if (chartType === 'line' || chartType === 'area') return { time: b.time, value: b.close };
  if (chartType === 'ha') {
    let h = haBars[b.__i];                                  // fast path: index stamped on bars[]
    if (!h) { const j = bars.indexOf(b); h = (j >= 0 && haBars[j]) ? haBars[j] : b; } // fallback if __i missing
    return { time: h.time, open: h.open, high: h.high, low: h.low, close: h.close };
  }
  if (chartType === 'hollow') {
    const up = b.close >= b.open;
    return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
             color: up ? CT_TRANSPARENT : CT_DOWN, borderColor: up ? CT_UP : CT_DOWN, wickColor: up ? CT_UP : CT_DOWN };
  }
  return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; // candles / bars
}

// ---- create the correct series for the active chart type ----
function makePriceSeries() {
  switch (chartType) {
    case 'bars':
      return chart.addBarSeries({ upColor: CT_UP, downColor: CT_DOWN, thinBars: false });
    case 'line':
      return chart.addLineSeries({ color: CT_LINE, lineWidth: 2, lastValueVisible: true, priceLineVisible: true });
    case 'area':
      return chart.addAreaSeries({ lineColor: CT_LINE, topColor: 'rgba(252,213,53,0.28)', bottomColor: 'rgba(252,213,53,0.02)', lineWidth: 2 });
    case 'hollow':   // hollow = candlestick with per-bar transparent up-bodies (see cd()); set defaults too
      return chart.addCandlestickSeries({ upColor: CT_TRANSPARENT, downColor: CT_DOWN, borderUpColor: CT_UP, borderDownColor: CT_DOWN, borderVisible: true, wickUpColor: CT_UP, wickDownColor: CT_DOWN });
    case 'ha':
    case 'candles':
    default:
      return chart.addCandlestickSeries({ upColor: CT_UP, downColor: CT_DOWN, borderVisible: false, wickUpColor: CT_UP, wickDownColor: CT_DOWN });
  }
}

// ---- THE swap. Removes old price series, builds new, re-feeds revealed
//      slice, re-applies markers + price lines, re-attaches primitives. ----
function setChartType(type) {
  if (type === chartType && candle) return;
  chartType = type;
  saveJSON('rt_charttype', chartType);

  // make sure HA + index stamps exist for the current bars[]
  stampBarIndices();
  if (chartType === 'ha') rebuildHA();

  // 1) tear down current price series (drops its primitives + price lines with it)
  if (candle) { try { chart.removeSeries(candle); } catch (e) {} }
  lines = [];                       // those PriceLine handles died with the old series

  // 2) build + assign the new series to the SAME `candle` variable the whole app uses
  candle = makePriceSeries();

  // 3) re-feed exactly what is currently revealed (idx = last revealed TF bar)
  candle.setData(bars.slice(0, idx + 1).map(cd));

  // 4) re-attach overlays. Primitives read `candle` via closure, so after the
  //    reassignment above they already point at the new series; we just need to
  //    bind them to the new series object and force a repaint.
  if (candle.attachPrimitive) {
    candle.attachPrimitive(ripsterPrimitive);
    candle.attachPrimitive(indicatorPrimitive);
    candle.attachPrimitive(drawingsPrimitive);
  }

  // 5) re-apply markers (entries/exits/annotations) and order/position price lines
  refreshMarkers();
  drawLines();
  repaintOverlays();

  updateChartTypeUI();
}

// stamp bars[i].__i = i so cd()'s HA path is O(1); cheap + idempotent
function stampBarIndices() { for (let i = 0; i < bars.length; i++) bars[i].__i = i; }

function updateChartTypeUI() { const s = $('chartTypeSelect'); if (s && s.value !== chartType) s.value = chartType; }
function vd(b) { return { time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(14,203,129,.35)' : 'rgba(246,70,93,.35)' }; }
const mBucket = (ts) => Math.floor(ts / (tf * 60)) * (tf * 60);

// ---------- init ----------
init();
async function init() { buildDataSelect(); initLayout(); await loadDataset(DATASETS[0]); }

function detectBaseTf(b) { let mn = Infinity; for (let i = 1; i < Math.min(b.length, 800); i++) { const dl = b[i].time - b[i - 1].time; if (dl > 0 && dl < mn) mn = dl; } return mn === Infinity ? 1 : Math.max(0.5, mn / 60); }
function buildTfOptions() { TF_OPTIONS = [BASE_TF, ...STD_TF.filter(m => m > BASE_TF)]; }

async function loadDataset(ds) {
  const url = typeof ds === 'string' ? ds : ds.url;   // tolerate a bare url too
  let data;
  try { const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now()); if (!r.ok) throw 0; data = await r.json(); } // cache-bust so regenerated data files always load fresh
  catch (e) { toast('This dataset is not ready yet'); return false; }
  pause(); position = null; entryOrder = null; orders = []; markers = []; tool = ''; pendingPt = null;
  if (ds && ds.instr) { INSTR = ds.instr; TICK = INSTR.tickSize; }   // switch active contract spec (tick grid + $/tick + symbol)
  if ($('symbol')) $('symbol').textContent = INSTR.symbol;
  if ($('entryPrice')) $('entryPrice').step = String(TICK);
  baseBars = data;
  BASE_TF = detectBaseTf(baseBars); buildTfOptions();
  tf = BASE_TF < 1 ? 1 : BASE_TF;                 // default view: 1m when base is sub-minute, else base
  buildSessions(); buildTfSelect(); buildAtmSelect();
  $('startSlider').max = baseBars.length - 1;
  rebuildTf();
  // default: park at the US cash open (09:30 ET) of the 2nd available trading day
  const startSes = sessions[1] || sessions[0];
  baseIdx = startSes ? rthOpenIdx(startSes) : Math.floor(baseBars.length / 2);
  syncIdxFromBase();
  sizeChart(); hardReveal(); chart.timeScale().fitContent();
  if (chartType && chartType !== 'candles') { const _t = chartType; chartType = '__'; setChartType(_t); }
  requestAnimationFrame(sizeChart); setTimeout(sizeChart, 300); setTimeout(sizeChart, 1200);
  if (!wired) { wire(); wired = true; }
  renderAll();
  return true;
}

// ---------- sessions (computed on base) ----------
let sessions = [];
function buildSessions() {
  sessions = []; let cur = null;
  baseBars.forEach((b, i) => { const k = tradingDayKey(b.time); if (!cur || cur.key !== k) { cur = { key: k, start: i, end: i }; sessions.push(cur); } else cur.end = i; });
  $('sessionSelect').innerHTML = sessions.map((s, i) => `<option value="${i}">${s.key}</option>`).join('');
}
function buildTfSelect() { $('tfSelect').innerHTML = TF_OPTIONS.map(m => `<option value="${m}" ${m === tf ? 'selected' : ''}>${m < 1 ? m * 60 + 's' : m + 'm'}</option>`).join(''); }
function buildDataSelect() { $('dataSelect').innerHTML = DATASETS.map((ds, i) => `<option value="${i}" ${i === dataIdx ? 'selected' : ''}>${ds.label}</option>`).join(''); }

// ---------- timeframe / index bookkeeping ----------
function rebuildTf() { bars = aggregate(baseBars, tf); computeRipster(); computeIndicators(); oscCompute(); stampBarIndices(); rebuildHA(); }
function tfIndexAtBase(bi) { // TF-bar index whose bucket contains baseBars[bi]
  const t = baseBars[bi].time; let lo = 0, hi = bars.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function syncIdxFromBase() { idx = tfIndexAtBase(baseIdx); }

// ---------- reveal / replay ----------
function hardReveal() { candle.setData(bars.slice(0, idx + 1).map(cd)); vol.setData(bars.slice(0, idx + 1).map(vd)); refreshMarkers(); drawLines(); renderLegend(null); oscHardReveal(); }
function stepFwd() {
  if (idx >= bars.length - 1) { pause(); return; }
  idx++; candle.update(cd(bars[idx])); vol.update(vd(bars[idx]));
  for (let i = bars[idx].subStart; i <= bars[idx].subEnd; i++) { processSub(baseBars[i]); }
  baseIdx = bars[idx].subEnd;
  renderLive(); renderLegend(null); oscStepFwd();
}
function stepBack() {
  if (locked()) return toast("Can't step back while in a position / working order");
  if (idx <= 0) return;
  idx--; baseIdx = bars[idx].subEnd; hardReveal(); renderLive();
}
function play() {
  if (playing) return pause();
  if (idx >= bars.length - 1) return;
  playing = true; $('btnPlay').textContent = 'pause';
  timer = setInterval(stepFwd, 1000 / Number($('speedSelect').value));
}
function pause() { playing = false; $('btnPlay').textContent = 'play_arrow'; clearInterval(timer); timer = null; }
function rthOpenIdx(s) { for (let i = s.start; i <= s.end; i++) { const m = etMinutes(baseBars[i].time); if (m >= 570 && m < 960) return i; } return s.start; }  // first bar in 09:30–15:59 ET = US cash open (skips the 18:00 ET Globex open)
function gotoSession(i) {
  if (locked()) return toast("Can't jump while in a position / working order");
  pause(); baseIdx = rthOpenIdx(sessions[i]); syncIdxFromBase(); hardReveal(); renderLive();
}
// ---- quick next/prev trading-day jump (to 09:30 ET open) ----
function currentSessionIdx() {
  for (let i = 0; i < sessions.length; i++) { if (baseIdx >= sessions[i].start && baseIdx <= sessions[i].end) return i; }
  if (sessions.length === 0) return -1;
  if (baseIdx < sessions[0].start) return 0;
  return sessions.length - 1;
}
function jumpDay(dir) {
  if (locked()) return toast("Can't jump while in a position / working order");
  if (sessions.length === 0) return;
  const cur = currentSessionIdx(), next = Math.max(0, Math.min(sessions.length - 1, cur + dir));
  if (next === cur) return toast(dir > 0 ? 'Already the last trading day' : 'Already the first trading day');
  gotoSession(next);
  const sel = $('sessionSelect'); if (sel) sel.value = String(next);
  toast((dir > 0 ? '▶ ' : '◀ ') + sessions[next].key + ' 09:30 ET');
}
function nextDay() { jumpDay(1); }
function prevDay() { jumpDay(-1); }
function setStart(biVal) {
  if (locked()) return;
  pause(); baseIdx = Math.max(0, Math.min(baseBars.length - 1, biVal)); syncIdxFromBase(); hardReveal(); renderLive();
}
function setTf(m) {
  if (locked()) { buildTfSelect(); return toast("Can't change timeframe while in a position / working order"); }
  pause(); tf = m; rebuildTf(); syncIdxFromBase(); hardReveal(); chart.timeScale().fitContent(); renderLive();
}

// ---------- order helpers ----------
function curPx() { return baseBars[baseIdx].close; }
function curBaseT() { return baseBars[baseIdx].time; }
function locked() { return !!position || !!entryOrder; }

function onEntryButton(side) {
  if (position) { if (position.side !== side) return flatten('reverse'); return toast('Already in a position — FLATTEN first'); }
  const kind = $('entryType').value;
  const mult = Math.max(1, parseInt($('qty').value, 10) || 1);
  if (kind === 'market') { openPosition(side, curPx(), curBaseT(), activeAtm, mult); }
  else {
    const price = rnd(parseFloat($('entryPrice').value));
    if (!price) return toast('Enter an entry price');
    entryOrder = { side, kind, price, atm: activeAtm, mult, ...bracketFromAtm(activeAtm) };
    toast(`${side === 'long' ? 'Buy' : 'Sell'} ${kind === 'limit' ? 'Limit' : 'Stop'} @ ${f2(price)} + bracket`);
    drawLines(); renderLive();
  }
}
function cancelEntry() { if (entryOrder) { entryOrder = null; drawLines(); renderLive(); toast('Order cancelled'); } }
function cancelOrder(spec) {   // × on a working order: 'entry' cancels the pending entry, an index cancels that stop/target
  if (spec === 'entry') return cancelEntry();
  const i = +spec, o = orders[i]; if (!o) return;
  orders.splice(i, 1);
  toast((o.type === 'stop' ? 'Stop' : 'Target') + ' order cancelled');
  drawLines(); renderLive();
}

function openPosition(side, px, t, atmName, mult, bracket) {
  const a = atm[atmName] || {}; entryOrder = null;
  const sl = bracket ? bracket.slTicks : a.sl;                 // honor a working order's (possibly dragged) bracket
  const srcT = bracket ? bracket.tgts : a.targets;
  const tgts = (srcT || []).filter(x => x.ticks > 0 && x.qty > 0).map(x => ({ ticks: x.ticks, qty: x.qty * mult }));
  if (!tgts.length) tgts.push({ ticks: sl > 0 ? sl * 2 : 20, qty: mult }); // fallback single target
  const totalQty = tgts.reduce((s, x) => s + x.qty, 0);
  position = { side, qty: totalQty, entry: px, entryTime: t, atm: atmName, slTicks: sl, maxFav: px, beDone: false };
  orders = [];
  if (sl > 0) orders.push({ type: 'stop', price: rnd(side === 'long' ? px - sl * TICK : px + sl * TICK), qty: totalQty });
  tgts.sort((x, y) => x.ticks - y.ticks).forEach(tg => orders.push({ type: 'target', ticks: tg.ticks, qty: tg.qty, price: rnd(side === 'long' ? px + tg.ticks * TICK : px - tg.ticks * TICK) }));
  addMarker(t, side === 'long' ? 'belowBar' : 'aboveBar', side === 'long' ? '#0ecb81' : '#f6465d', side === 'long' ? 'arrowUp' : 'arrowDown', `${side === 'long' ? 'L' : 'S'}${totalQty} ${f2(px)}`);
  drawLines(); renderLive();
}

function flatten() { if (position) exitQty(position.qty, curPx(), curBaseT(), 'manual'); else cancelEntry(); }
function reverse() { if (!position) return; const s = position.side; exitQty(position.qty, curPx(), curBaseT(), 'reverse'); onEntryButtonDirect(s === 'long' ? 'short' : 'long'); }
function onEntryButtonDirect(side) { openPosition(side, curPx(), curBaseT(), activeAtm, Math.max(1, parseInt($('qty').value, 10) || 1)); }

// ---------- per-(1-min) bar processing ----------
function processSub(b) {
  // 1) pending entry
  if (!position && entryOrder) { if (tryEntryFill(b)) return; }   // filled -> manage from next bar
  if (!position) return;

  const long = position.side === 'long';
  const stop = orders.find(o => o.type === 'stop');
  // 2) STOP first (conservative when a bar straddles both stop and target)
  if (stop) {
    const sP = stop.price;
    const hit = long ? (b.open <= sP || b.low <= sP) : (b.open >= sP || b.high >= sP);
    if (hit) { const px = long ? (b.open <= sP ? b.open : sP) : (b.open >= sP ? b.open : sP); exitQty(position.qty, px, b.time, 'stop'); return; }
  }
  // 3) TARGETS (nearest first)
  const tgs = orders.filter(o => o.type === 'target').sort((x, y) => long ? x.price - y.price : y.price - x.price);
  for (const tg of tgs) {
    if (!position) break;
    const tP = tg.price;
    const hit = long ? (b.open >= tP || b.high >= tP) : (b.open <= tP || b.low <= tP);
    if (hit) { const px = long ? (b.open >= tP ? b.open : tP) : (b.open <= tP ? b.open : tP); orders = orders.filter(o => o !== tg); exitQty(tg.qty, px, b.time, 'target'); }
  }
  // 4) breakeven / trailing for subsequent bars
  if (position) updateStops(b);
}

function tryEntryFill(b) {
  const e = entryOrder, long = e.side === 'long';
  let hit = false, px = e.price;
  if (e.kind === 'limit') {
    if (long) { if (b.open <= e.price) { hit = true; px = b.open; } else if (b.low <= e.price) { hit = true; px = e.price; } }
    else { if (b.open >= e.price) { hit = true; px = b.open; } else if (b.high >= e.price) { hit = true; px = e.price; } }
  } else { // stop entry
    if (long) { if (b.open >= e.price) { hit = true; px = b.open; } else if (b.high >= e.price) { hit = true; px = e.price; } }
    else { if (b.open <= e.price) { hit = true; px = b.open; } else if (b.low <= e.price) { hit = true; px = e.price; } }
  }
  if (hit) { openPosition(e.side, rnd(px), b.time, e.atm, e.mult, { slTicks: e.slTicks, tgts: e.tgts }); return true; }
  return false;
}

function updateStops(b) {
  const a = atm[position.atm] || {}; const long = position.side === 'long'; const stop = orders.find(o => o.type === 'stop');
  position.maxFav = long ? Math.max(position.maxFav, b.high) : Math.min(position.maxFav, b.low);
  if (!stop) return;
  if (a.be && a.be.on && !position.beDone) {
    const trig = long ? position.entry + a.be.trig * TICK : position.entry - a.be.trig * TICK;
    if (long ? b.high >= trig : b.low <= trig) { const be = rnd(long ? position.entry + a.be.off * TICK : position.entry - a.be.off * TICK); stop.price = long ? Math.max(stop.price, be) : Math.min(stop.price, be); position.beDone = true; }
  }
  if (a.trail && a.trail.on) {
    const trig = long ? position.entry + a.trail.trig * TICK : position.entry - a.trail.trig * TICK;
    if (long ? position.maxFav >= trig : position.maxFav <= trig) { const ns = rnd(long ? position.maxFav - a.trail.dist * TICK : position.maxFav + a.trail.dist * TICK); stop.price = long ? Math.max(stop.price, ns) : Math.min(stop.price, ns); }
  }
  drawLines();
}

function exitQty(q, px, t, type) {
  const long = position.side === 'long';
  const netTicks = long ? tcount(px, position.entry) : tcount(position.entry, px);
  const pnl = netTicks * INSTR.tickValue * q;
  const risk = (position.slTicks || 0) * INSTR.tickValue * q;
  trades.push({ entryTime: position.entryTime, exitTime: t, side: position.side, qty: q, entry: position.entry, exit: px, ticks: netTicks, pnl, R: risk > 0 ? pnl / risk : null, atm: position.atm, exitType: type });
  addMarker(t, long ? 'aboveBar' : 'belowBar', pnl >= 0 ? '#0ecb81' : '#f6465d', long ? 'arrowDown' : 'arrowUp', usd(pnl));
  saveJSON('rt_trades', trades);
  position.qty -= q;
  if (position.qty <= 0) { position = null; orders = []; }
  else { const stop = orders.find(o => o.type === 'stop'); if (stop) stop.qty = position.qty; }
  drawLines(); renderAll();
}

// ---------- chart drawing ----------
function clearLines() { lines.forEach(l => candle.removePriceLine(l)); lines = []; }
function pl(price, color, style, title) { return candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }); }
function drawLines() {
  clearLines();
  if (entryOrder) {
    lines.push(pl(entryOrder.price, '#f0b90b', LightweightCharts.LineStyle.Dotted, entryOrder.kind === 'limit' ? 'LMT' : 'STP'));
    // preview the ATM bracket that auto-attaches on fill (draggable to adjust before fill)
    const long = entryOrder.side === 'long';
    if (entryOrder.slTicks > 0) lines.push(pl(rnd(long ? entryOrder.price - entryOrder.slTicks * TICK : entryOrder.price + entryOrder.slTicks * TICK), '#f6465d', LightweightCharts.LineStyle.Dashed, '↳STP'));
    (entryOrder.tgts || []).forEach((tg, i) => { if (tg.ticks > 0) lines.push(pl(rnd(long ? entryOrder.price + tg.ticks * TICK : entryOrder.price - tg.ticks * TICK), '#0ecb81', LightweightCharts.LineStyle.Dashed, '↳T' + (i + 1))); });
  }
  if (position) {
    lines.push(pl(position.entry, '#8b93a7', LightweightCharts.LineStyle.Dotted, 'ENTRY'));
    const stop = orders.find(o => o.type === 'stop'); if (stop) lines.push(pl(stop.price, '#f6465d', LightweightCharts.LineStyle.Dashed, 'STOP'));
    orders.filter(o => o.type === 'target').forEach((tg, i) => lines.push(pl(tg.price, '#0ecb81', LightweightCharts.LineStyle.Dashed, 'T' + (i + 1))));
  }
}
function addMarker(baseTime, position_, color, shape, text) { markers.push({ baseTime, position: position_, color, shape, text }); refreshMarkers(); }
function refreshMarkers() { candle.setMarkers(markers.concat(annotations).map(m => ({ time: mBucket(m.baseTime), position: m.position, color: m.color, shape: m.shape, text: m.text })).sort((a, b) => a.time - b.time)); }

// ---------- rendering ----------
function renderAll() { renderLive(); renderTrades(); renderDash(); }
function renderLive() {
  $('clock').textContent = baseBars.length ? tFmt(curBaseT()) : '--:--';
  $('clockPrice').textContent = baseBars.length ? f2(curPx()) : '--';
  if (!playing) $('startSlider').value = baseIdx;

  const box = $('posBox');
  if (!position) {
    box.className = 'posflat';
    box.textContent = entryOrder ? `Working: ${entryOrder.side === 'long' ? 'Buy' : 'Sell'} ${entryOrder.kind === 'limit' ? 'Limit' : 'Stop'} @ ${f2(entryOrder.price)}` : 'Flat';
  } else {
    const long = position.side === 'long';
    const uTicks = long ? tcount(curPx(), position.entry) : tcount(position.entry, curPx());
    const uPnl = uTicks * INSTR.tickValue * position.qty;
    box.className = long ? 'long' : 'short';
    box.innerHTML = `<div class="big">${long ? 'LONG' : 'SHORT'} ${position.qty} @ ${f2(position.entry)}</div>
      <div>Unreal. <b class="${uPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${usd(uPnl)}</b> · ${uTicks >= 0 ? '+' : ''}${uTicks}t · ${position.atm}</div>`;
  }
  const ord = [];
  const oRow = (cls, label, price, spec, title) => `<div class="ord ${cls}"><span>${label}</span><span class="ord-r"><span class="mono">${price}</span><button class="ord-x" data-ord="${spec}" title="${title}"><span class="material-symbols-outlined">close</span></button></span></div>`;
  if (entryOrder) ord.push(oRow('entry', `${entryOrder.kind === 'limit' ? 'LIMIT' : 'STOP'} ${entryOrder.side === 'long' ? 'BUY' : 'SELL'}`, f2(entryOrder.price), 'entry', 'Cancel order'));
  orders.forEach((o, i) => ord.push(oRow(o.type, `${o.type === 'stop' ? 'STOP' : 'TARGET'} ×${o.qty}`, f2(o.price), i, 'Cancel ' + o.type)));
  $('ordersBox').innerHTML = ord.join('');

  const lock = locked();
  $('startSlider').disabled = lock; $('btnStepBack').disabled = lock; $('sessionSelect').disabled = lock; $('tfSelect').disabled = lock; $('dataSelect').disabled = lock;
  $('entryPriceRow').style.display = $('entryType').value === 'market' ? 'none' : '';
}

function renderTrades() {
  $('tradesTable').querySelector('tbody').innerHTML = trades.map((t, i) => `<tr>
    <td>${i + 1}</td><td class="${t.side === 'long' ? 'long-tag' : 'short-tag'}">${t.side === 'long' ? 'L' : 'S'}</td><td>${t.qty}</td>
    <td>${tFmt(t.entryTime)}</td><td>${tFmt(t.exitTime)}</td>
    <td class="mono">${f2(t.entry)}</td><td class="mono">${f2(t.exit)}</td>
    <td>${t.ticks >= 0 ? '+' : ''}${t.ticks}</td><td class="${t.pnl >= 0 ? 'pos' : 'neg'}">${usd(t.pnl)}</td>
    <td>${t.R == null ? '–' : t.R.toFixed(2)}</td><td>${t.atm}</td><td>${t.exitType}</td></tr>`).reverse().join('');
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  $('tradesSummary').textContent = `${trades.length} trades · Net ${usd(net)}`;
}

function renderDash() {
  const n = trades.length;
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  const winRate = (wins.length + losses.length) ? wins.length / (wins.length + losses.length) * 100 : 0;
  const pf = gl ? gw / gl : (gw ? Infinity : 0);
  const exp = n ? net / n : 0;
  const rs = trades.filter(t => t.R != null).map(t => t.R);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  let eq = 0, peak = 0, dd = 0; trades.forEach(t => { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); });
  const card = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  $('statCards').innerHTML = card('Trades', n) + card('Win rate', winRate.toFixed(1) + '%', winRate >= 50 ? 'pnl-pos' : '') +
    card('Net P&L', usd(net), net >= 0 ? 'pnl-pos' : 'pnl-neg') + card('Profit factor', pf === Infinity ? '∞' : pf.toFixed(2)) +
    card('Expectancy', usd(exp), exp >= 0 ? 'pnl-pos' : 'pnl-neg') + card('Avg R', avgR == null ? '–' : avgR.toFixed(2));
  const byAtm = {}; trades.forEach(t => { (byAtm[t.atm] ??= []).push(t); });
  $('atmStats').innerHTML = `<table><thead><tr><th>ATM</th><th>Trades</th><th>Win%</th><th>Net $</th></tr></thead><tbody>` +
    Object.entries(byAtm).map(([k, ts]) => { const w = ts.filter(t => t.pnl > 0).length, l = ts.filter(t => t.pnl < 0).length, nt = ts.reduce((s, t) => s + t.pnl, 0);
      return `<tr><td>${k}</td><td>${ts.length}</td><td>${(w + l) ? (w / (w + l) * 100).toFixed(0) : 0}%</td><td class="${nt >= 0 ? 'pos' : 'neg'}">${usd(nt)}</td></tr>`; }).join('') + `</tbody></table>`;
  drawEquity();
  $('panelDash').title = `Max Drawdown ${usd(dd)}`;
}
function drawEquity() {
  const c = $('equity'), ctx = c.getContext('2d'); const W = c.width = c.clientWidth || 600, H = c.height;
  ctx.clearRect(0, 0, W, H);
  if (!trades.length) { ctx.fillStyle = '#8b93a7'; ctx.fillText('No trades yet', 10, 20); return; }
  const eq = []; let s = 0; trades.forEach(t => { s += t.pnl; eq.push(s); });
  const lo = Math.min(0, ...eq), hi = Math.max(0, ...eq), rng = (hi - lo) || 1;
  const x = i => 4 + i * (W - 8) / Math.max(1, eq.length - 1), y = v => H - 6 - (v - lo) / rng * (H - 12);
  ctx.strokeStyle = '#2a2f3a'; ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0)); ctx.stroke();
  ctx.strokeStyle = s >= 0 ? '#0ecb81' : '#f6465d'; ctx.lineWidth = 1.5; ctx.beginPath(); eq.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))); ctx.stroke();
}

// ---------- ATM editor ----------
function buildAtmSelect() { $('atmSelect').innerHTML = Object.keys(atm).map(k => `<option ${k === activeAtm ? 'selected' : ''}>${k}</option>`).join(''); loadAtmIntoEditor(activeAtm); }
function loadAtmIntoEditor(name) {
  const a = atm[name]; if (!a) return; const t = a.targets || [];
  $('atmName').value = name; $('atmSL').value = a.sl;
  $('atmT1t').value = t[0] ? t[0].ticks : 0; $('atmT1q').value = t[0] ? t[0].qty : 0;
  $('atmT2t').value = t[1] ? t[1].ticks : 0; $('atmT2q').value = t[1] ? t[1].qty : 0;
  $('atmT3t').value = t[2] ? t[2].ticks : 0; $('atmT3q').value = t[2] ? t[2].qty : 0;
  $('atmBEon').checked = a.be.on; $('atmBEtrig').value = a.be.trig; $('atmBEoff').value = a.be.off;
  $('atmTrailon').checked = a.trail.on; $('atmTrailTrig').value = a.trail.trig; $('atmTrailDist').value = a.trail.dist;
}
function saveAtm() {
  const name = $('atmName').value.trim(); if (!name) return toast('Template needs a name');
  const targets = [];
  [['atmT1t', 'atmT1q'], ['atmT2t', 'atmT2q'], ['atmT3t', 'atmT3q']].forEach(([t, q]) => { const tk = +$(t).value, qy = +$(q).value; if (tk > 0 && qy > 0) targets.push({ ticks: tk, qty: qy }); });
  if (!targets.length) return toast('At least one target (ticks & qty > 0)');
  atm[name] = { sl: +$('atmSL').value, targets, be: { on: $('atmBEon').checked, trig: +$('atmBEtrig').value, off: +$('atmBEoff').value }, trail: { on: $('atmTrailon').checked, trig: +$('atmTrailTrig').value, dist: +$('atmTrailDist').value } };
  saveJSON('rt_atm', atm); activeAtm = name; buildAtmSelect(); toast('Saved ' + name);
}
function delAtm() { const name = $('atmName').value.trim(); if (atm[name] && Object.keys(atm).length > 1) { delete atm[name]; saveJSON('rt_atm', atm); activeAtm = Object.keys(atm)[0]; buildAtmSelect(); toast('Deleted ' + name); } }

// ---------- misc ----------
let toastT = null;
function toast(msg) { let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1600); }
function exportCsv() {
  const head = 'idx,side,qty,entryTime,exitTime,entry,exit,ticks,pnl,R,atm,exitType';
  const rows = trades.map((t, i) => [i + 1, t.side, t.qty, tFmt(t.entryTime), tFmt(t.exitTime), t.entry, t.exit, t.ticks, t.pnl, t.R == null ? '' : t.R.toFixed(3), t.atm, t.exitType].join(','));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' })); a.download = 'replay_trades.csv'; a.click();
}
function resetAll() { if (!confirm('Clear all trade records?')) return; trades = []; saveJSON('rt_trades', trades); position = null; entryOrder = null; orders = []; markers = []; refreshMarkers(); drawLines(); renderAll(); }

// ---------- wiring ----------
function wire() {
  $('btnPlay').onclick = play;
  $('btnStepFwd').onclick = () => { pause(); stepFwd(); };
  $('btnStepBack').onclick = () => { pause(); stepBack(); };
  $('btnToStart').onclick = () => gotoSession(+$('sessionSelect').value);
  $('btnPrevDay').onclick = prevDay;
  $('btnNextDay').onclick = nextDay;
  $('sessionSelect').onchange = (e) => gotoSession(+e.target.value);
  $('tfSelect').onchange = (e) => setTf(+e.target.value);
  $('dataSelect').onchange = async (e) => { if (locked()) { $('dataSelect').value = dataIdx; return toast("Can't switch dataset while in a position / working order"); } const i = +e.target.value; const ok = await loadDataset(DATASETS[i]); if (ok) dataIdx = i; else $('dataSelect').value = dataIdx; };
  $('speedSelect').onchange = () => { if (playing) { pause(); play(); } };
  $('startSlider').oninput = (e) => setStart(+e.target.value);
  $('btnPickStart').onclick = () => { if (locked()) { return toast("Can't set start while in a position / working order"); } setTool('start'); };
  $('btnFit').onclick = fitChart;
  $('annUp').onclick = () => setTool('au');
  $('annDown').onclick = () => setTool('ad');
  $('annLong').onclick = () => setTool('long');
  $('annShort').onclick = () => setTool('short');
  $('annClear').onclick = clearAnnotations;
  $('drwHL').onclick = () => setTool('hl');
  $('drwTL').onclick = () => setTool('tl');
  $('drwRay').onclick = () => setTool('ray');
  $('drwBox').onclick = () => setTool('box');
  $('drwFib').onclick = () => setTool('fib');
  $('drwMeasure').onclick = () => setTool('measure');
  $('drwClear').onclick = clearDrawings;
  $('drwRR').onclick = () => setTool('rr');       // Long/Short position (R:R) tool
  $('toolCursor').onclick = () => setTool('');   // deselect any active drawing/annotation tool
  $('ripsterToggle').checked = ripsterOn;
  $('ripsterToggle').onchange = (e) => { ripsterOn = e.target.checked; saveJSON('rt_ripster', ripsterOn); ripsterRepaint(); renderIndLegend(); };
  initChartLegend();
  initIndLegend();
  $('indVwap').checked = vwapOn; $('indVwap').onchange = (e) => setVwap(e.target.checked);
  $('indBB').checked = bbOn; $('indBB').onchange = (e) => setBB(e.target.checked);
  $('indEma').checked = emaOn; $('indEma').onchange = (e) => setEMA(e.target.checked);
  $('emaPeriods').value = emaPeriods.join(','); $('emaPeriods').onchange = (e) => setEmaPeriods(e.target.value);
  wireOsc();
  $('chartTypeSelect').value = chartType; $('chartTypeSelect').onchange = (e) => setChartType(e.target.value);
  // Indicators dropdown (top toolbar) + oscillator pane close button
  $('btnIndicators').onclick = (e) => { e.stopPropagation(); $('indPopover').classList.toggle('open'); $('btnIndicators').classList.toggle('active'); };
  document.addEventListener('mousedown', (e) => { const p = $('indPopover'), b = $('btnIndicators'); if (p && p.classList.contains('open') && !p.contains(e.target) && !b.contains(e.target)) { p.classList.remove('open'); b.classList.remove('active'); } });
  $('oscClose').onclick = () => { setOscMode('off'); const s = $('oscSelect'); if (s) s.value = 'off'; };

  $('entryType').onchange = () => { $('entryPriceRow').style.display = $('entryType').value === 'market' ? 'none' : ''; if ($('entryType').value !== 'market' && !$('entryPrice').value) $('entryPrice').value = f2(curPx()); };
  $('btnBuy').onclick = () => onEntryButton('long');
  $('btnSell').onclick = () => onEntryButton('short');
  $('btnFlatten').onclick = flatten;
  $('btnReverse').onclick = reverse;
  $('btnCancelEntry').onclick = cancelEntry;
  $('ordersBox').addEventListener('click', (e) => { const b = e.target.closest('.ord-x'); if (b) cancelOrder(b.dataset.ord); });
  // order-type segmented control — keeps the hidden #entryType select in sync for the rest of the app
  document.querySelectorAll('#entrySeg .seg-btn').forEach(btn => btn.onclick = () => {
    $('entryType').value = btn.dataset.type; $('entryType').dispatchEvent(new Event('change'));
    document.querySelectorAll('#entrySeg .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  });
  $('qtyMinus').onclick = () => { $('qty').value = Math.max(1, (parseInt($('qty').value, 10) || 1) - 1); };
  $('qtyPlus').onclick = () => { $('qty').value = (parseInt($('qty').value, 10) || 1) + 1; };

  $('atmSelect').onchange = (e) => { activeAtm = e.target.value; loadAtmIntoEditor(activeAtm); };
  $('btnAtmSave').onclick = saveAtm;
  $('btnAtmDel').onclick = delAtm;

  $('tabTrades').onclick = () => switchTab(true);
  $('tabDash').onclick = () => switchTab(false);
  $('btnExportCsv').onclick = exportCsv;
  $('btnReset').onclick = resetAll;

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); pause(); stepFwd(); }
    else if (e.key === 'p') play(); else if (e.key === 'b') onEntryButton('long');
    else if (e.key === 's') onEntryButton('short'); else if (e.key === 'f') flatten();
    else if (e.key === '[' || e.key === 'ArrowLeft') { e.preventDefault(); prevDay(); }
    else if (e.key === ']' || e.key === 'ArrowRight') { e.preventDefault(); nextDay(); }
    else if (e.key === '0') { e.preventDefault(); fitChart(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selDrawing) { e.preventDefault(); deleteSelectedDrawing(); }
    else if (e.key === 'Escape') { if (tool) setTool(''); else if (selDrawing) { selDrawing = null; repaintOverlays(); } }
  });
}
function switchTab(t) { $('tabTrades').classList.toggle('active', t); $('tabDash').classList.toggle('active', !t); $('panelTrades').classList.toggle('hidden', !t); $('panelDash').classList.toggle('hidden', t); if (!t) renderDash(); }

// debug hook (harmless; used for automated verification)
window.__rt = { state: () => ({ tf, idx, baseIdx, bars: bars.length, base: baseBars.length, pos: position && { ...position }, orders: orders.map(o => ({ ...o })), entryOrder }), bar: (i) => bars[i], sub: (i) => baseBars[i], agg: (m) => aggregate(baseBars, m), dresize: (w, h) => chart.resize(w, h, true), sc: sizeChart, chartOpts: () => chart.options(), priceToY: (p) => candle.priceToCoordinate(p), coordToPrice: (y) => candle.coordinateToPrice(y), chartRect: () => $('chart').getBoundingClientRect(), setTool: (t) => setTool(t), getTool: () => tool, placeAnn: (t, time) => placeAnnotation(t, time), annCount: () => annotations.length, ripster: () => ({ on: ripsterOn, clouds: ripsterData.length }), drawCount: () => drawings.length, addDraw: (t, time, price) => handleDrawClick(t, time, price), rthOpenET: (i) => etMinutes(baseBars[rthOpenIdx(sessions[i])].time), nextDay, prevDay, curSession: () => currentSessionIdx(),
  instr: () => ({ ...INSTR, TICK }),
  handles: () => drawingHandles().map(h => ({ horiz: !!h.horiz, hx: h.hx, hy: h.hy })),
  drawingsList: () => drawings.map(d => ({ type: d.type, p1: d.p1 && { ...d.p1 }, p2: d.p2 && { ...d.p2 } })),
  editAt: (x, y, nx, ny) => { const h = nearestHandle(x, y); if (!h) return null; const p = candle.coordinateToPrice(ny); if (p == null) return { noprice: true }; h.apply(h.horiz ? null : xToTime(nx), rnd(p)); saveJSON('rt_drawings', drawings); repaintOverlays(); return { moved: true }; },
  selType: () => selDrawing && selDrawing.type,
  setSel: (i) => { selDrawing = drawings[i] || null; repaintOverlays(); return selDrawing && selDrawing.type; },
  drawingAtXY: (x, y) => { const d = drawingAt(x, y); return d ? d.type : null; },
  moveSel: (x, y, nx, ny) => { const d = drawings[drawings.length - 1]; if (!d) return null; selDrawing = d; startBodyDrag(d, x, y); moveBody(nx, ny); dragBody = null; saveJSON('rt_drawings', drawings); return { moved: true }; },
  deleteSel: () => { const n0 = drawings.length; deleteSelectedDrawing(); return { before: n0, after: drawings.length }; },
  lastDrawing: () => { const d = drawings[drawings.length - 1]; return d ? { type: d.type, entry: d.p1 && d.p1.p, stop: d.stop, target: d.target } : null; },
  entryOrderInfo: () => entryOrder && { side: entryOrder.side, kind: entryOrder.kind, price: entryOrder.price, slTicks: entryOrder.slTicks, tgts: entryOrder.tgts },
  dragLineSet: (gp, np) => { const L = draggableLines().find(L => Math.abs(L.get() - gp) < 0.001); if (L) { L.set(np); drawLines(); renderLive(); } return entryOrder ? entryOrder.slTicks : null; } };
