'use strict';
/* NQ Replay Trainer — Wave 1
 * TradingView-style bar replay with multi-timeframe + manual orders (market/limit/stop entry)
 * + NinjaTrader-style ATM (multi-target scale-out, breakeven, trailing). Fills are always
 * simulated on the underlying 30-second sub-bars, so accuracy is timeframe-independent. */

const INSTR = { symbol: 'NQ', tickSize: 0.25, tickValue: 5 }; // NQ: $20/pt -> $5/tick
const DATASETS = [
  { id: 'deep', label: 'Nasdaq100 1m · 深歷史 3.5個月 (Dukascopy)', url: 'data/NQ_deep_1m.json' },
  { id: 'tick', label: 'NQ 30s · 6/7–6/12 (真實 tick)', url: 'data/NQ_30s.json' },
];
const STD_TF = [1, 2, 3, 5, 10, 15, 30, 60];   // standard minute timeframes
let BASE_TF = 1;        // base bar resolution (minutes) — auto-detected per dataset
let TF_OPTIONS = [];    // built per dataset (base + standard multiples)
let wired = false, dataIdx = 0;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const TICK = INSTR.tickSize;
const rnd = (p) => Math.round(p / TICK) * TICK;
const f2 = (p) => p.toFixed(2);
const tcount = (a, b) => Math.round((a - b) / TICK);
const usd = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const pad = (n) => String(n).padStart(2, '0');
const tFmt = (ts) => { const d = new Date(ts * 1000); return `${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const dayKey = (ts) => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; };
const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const tradingDayKey = (ts) => etFmt.format(new Date((ts + 6 * 3600) * 1000)); // futures trading day = ET date (18:00 ET boundary shifted to midnight, DST-correct)
const etHM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function etMinutes(ts) { const p = etHM.formatToParts(new Date(ts * 1000)); let h = 0, m = 0; for (const x of p) { if (x.type === 'hour') h = +x.value; else if (x.type === 'minute') m = +x.value; } return h * 60 + m; } // minutes since midnight ET (DST-correct)
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
  timeScale: { borderColor: '#2b3139', timeVisible: true, secondsVisible: true, rightOffset: 6 },
});
const candle = chart.addCandlestickSeries({ upColor: '#0ecb81', downColor: '#f6465d', borderVisible: false, wickUpColor: '#0ecb81', wickDownColor: '#f6465d' });
const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' } });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
function sizeChart() { const el = $('chart'); const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; chart.resize(w - 1, h, true); chart.resize(w, h, true); } // double-resize: LWC no-ops a resize to the same size, so nudge then set
new ResizeObserver(sizeChart).observe($('chartwrap'));
window.addEventListener('resize', sizeChart);

// ---------- resizable layout (drag gutters to resize #side width & #bottom height) ----------
const LAYOUT_DEFAULTS = { side: 320, bottom: 252 }, LAYOUT_MIN = { side: 220, bottom: 120 }, SIDE_MIN_CHART = 360, BOTTOM_MIN_MAIN = 220, TOOLBAR_H = 46;
let layout = Object.assign({}, LAYOUT_DEFAULTS, loadJSON('rt_layout', {}));
function clampLayout(L) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const maxSide = Math.max(LAYOUT_MIN.side, vw - SIDE_MIN_CHART), maxBottom = Math.max(LAYOUT_MIN.bottom, vh - TOOLBAR_H - BOTTOM_MIN_MAIN);
  L.side = Math.round(Math.min(maxSide, Math.max(LAYOUT_MIN.side, L.side)));
  L.bottom = Math.round(Math.min(maxBottom, Math.max(LAYOUT_MIN.bottom, L.bottom)));
  return L;
}
function applyLayout(persist) {
  clampLayout(layout);
  const main = $('main'), app = $('app');
  if (main) main.style.gridTemplateColumns = `1fr 6px ${layout.side}px`;
  if (app) app.style.gridTemplateRows = `${TOOLBAR_H}px 1fr 6px ${layout.bottom}px`;
  if (persist) saveJSON('rt_layout', { side: layout.side, bottom: layout.bottom });
  if (typeof sizeChart === 'function') sizeChart();
}
function attachGutter(el, axis) {
  if (!el) return;
  let startPos = 0, startVal = 0;
  function onMove(e) { if (axis === 'x') layout.side = startVal + (startPos - e.clientX); else layout.bottom = startVal + (startPos - e.clientY); applyLayout(false); }
  function onUp(e) { el.releasePointerCapture && el.releasePointerCapture(e.pointerId); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); el.classList.remove('dragging'); document.body.classList.remove('resizing'); saveJSON('rt_layout', { side: layout.side, bottom: layout.bottom }); }
  el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; startPos = axis === 'x' ? e.clientX : e.clientY; startVal = axis === 'x' ? layout.side : layout.bottom; el.setPointerCapture && el.setPointerCapture(e.pointerId); el.classList.add('dragging'); document.body.classList.add('resizing'); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); e.preventDefault(); });
  el.addEventListener('dblclick', () => { if (axis === 'x') layout.side = LAYOUT_DEFAULTS.side; else layout.bottom = LAYOUT_DEFAULTS.bottom; applyLayout(true); });
}
function initLayout() { applyLayout(false); attachGutter($('gutterCol'), 'x'); attachGutter($('gutterRow'), 'y'); window.addEventListener('resize', () => applyLayout(false)); }

// ---------- right-click chart trading (context menu at the clicked price) ----------
function ctxPriceAt(clientY) { return candle.coordinateToPrice(clientY - $('chart').getBoundingClientRect().top); }
function placeEntryAt(side, kind, price) {
  if (position) return toast('已有部位 — 先平倉');
  const mult = Math.max(1, parseInt($('qty').value, 10) || 1);
  entryOrder = { side, kind, price: rnd(price), atm: activeAtm, mult };
  toast(`${side === 'long' ? '買' : '賣'} ${kind === 'limit' ? '限價' : '停損'} @ ${f2(rnd(price))} 掛單`);
  drawLines(); renderLive();
}
function moveStopTo(price) { if (!position) return; const s = orders.find(o => o.type === 'stop'); if (s) s.price = rnd(price); else orders.push({ type: 'stop', price: rnd(price), qty: position.qty }); drawLines(); renderLive(); toast('停損 → ' + f2(rnd(price))); }
function moveTargetTo(price) { if (!position) return; const t = orders.find(o => o.type === 'target'); if (t) t.price = rnd(price); else orders.push({ type: 'target', price: rnd(price), qty: position.qty }); drawLines(); renderLive(); toast('停利 → ' + f2(rnd(price))); }
let ctxEl = null;
function hideCtx() { if (ctxEl) ctxEl.style.display = 'none'; }
function showCtx(clientX, clientY) {
  const price = ctxPriceAt(clientY); if (price == null) return;
  if (!ctxEl) { ctxEl = document.createElement('div'); ctxEl.id = 'ctxMenu'; document.body.appendChild(ctxEl); }
  const p = f2(rnd(price)), it = [];
  if (position) {
    it.push({ h: `${position.side === 'long' ? 'LONG' : 'SHORT'} ${position.qty} @ ${f2(position.entry)}` });
    it.push({ l: `停損移到此 @ ${p}`, f: () => moveStopTo(price) });
    it.push({ l: `停利移到此 @ ${p}`, f: () => moveTargetTo(price) });
    it.push({ sep: 1 });
    it.push({ l: '平倉 Flatten', f: () => flatten('manual') });
    it.push({ l: '反手 Reverse', f: () => reverse() });
  } else if (entryOrder) {
    it.push({ h: `掛單 ${entryOrder.side === 'long' ? '買' : '賣'}${entryOrder.kind === 'limit' ? '限' : '停'} @ ${f2(entryOrder.price)}` });
    it.push({ l: '取消掛單 Cancel', f: () => cancelEntry() });
  } else {
    it.push({ l: '市價買進 Buy Market', cls: 'buy', f: () => onEntryButtonDirect('long') });
    it.push({ l: '市價賣出 Sell Market', cls: 'sell', f: () => onEntryButtonDirect('short') });
    it.push({ sep: 1 });
    it.push({ l: `限價買 @ ${p}`, cls: 'buy', f: () => placeEntryAt('long', 'limit', price) });
    it.push({ l: `限價賣 @ ${p}`, cls: 'sell', f: () => placeEntryAt('short', 'limit', price) });
    it.push({ l: `停損買 @ ${p}`, cls: 'buy', f: () => placeEntryAt('long', 'stop', price) });
    it.push({ l: `停損賣 @ ${p}`, cls: 'sell', f: () => placeEntryAt('short', 'stop', price) });
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
function setVwap(on) { vwapOn = on; saveJSON('rt_vwap', vwapOn); indicatorRepaint(); }
function setBB(on)   { bbOn = on;   saveJSON('rt_bb',   bbOn);   indicatorRepaint(); }
function setEMA(on)  { emaOn = on;  saveJSON('rt_ema',  emaOn);  indicatorRepaint(); }
// optional: change the ribbon periods at runtime, e.g. setEmaPeriods("9,21,55,200")
function setEmaPeriods(csv) {
  const list = String(csv).split(/[\s,]+/).map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n >= 1).slice(0, 6);
  if (!list.length) return toast('EMA 週期格式錯誤');
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
            const x1 = X(d.p1.t), y1 = Y(d.p1.p), x2 = X(d.p2.t), y2 = Y(d.p2.p);
            if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
            if (d.type === 'box') { const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1); ctx.globalAlpha = 0.12; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeRect(x, y, w, h); }
            else { ctx.beginPath(); ctx.moveTo(x1, y1); if (d.type === 'ray') { const dx = x2 - x1, dy = y2 - y1, tx = dx >= 0 ? W : 0, s = dx !== 0 ? (tx - x1) / dx : 0; ctx.lineTo(dx !== 0 ? tx : x2, dx !== 0 ? y1 + dy * s : y2); } else ctx.lineTo(x2, y2); ctx.stroke(); }
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
  if (t === 'hl') { drawings.push({ type: 'hl', p1: { t: time, p: price }, color: '#d1d4dc' }); saveJSON('rt_drawings', drawings); repaintOverlays(); return; }
  if (!pendingPt) { pendingPt = { t: time, p: price }; repaintOverlays(); toast('再點第二個點'); return; }
  drawings.push({ type: t, p1: pendingPt, p2: { t: time, p: price }, color: t === 'box' ? '#2962ff' : t === 'fib' ? '#fcd535' : '#d1d4dc' });
  pendingPt = null; saveJSON('rt_drawings', drawings); repaintOverlays();
}
function clearDrawings() { drawings = []; pendingPt = null; saveJSON('rt_drawings', drawings); repaintOverlays(); toast('已清除繪圖'); }
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

// ---------- chart tools: drag stop/target/entry lines + click tools (set-start / annotations) ----------
let tool = '', drag = null;
let annotations = loadJSON('rt_annotations', []);   // {baseTime, position, color, shape, text}
let drawings = loadJSON('rt_drawings', []);         // {type:'hl'|'tl'|'ray'|'box', p1:{t,p}, p2?:{t,p}, color}
let pendingPt = null;                                // first click of a 2-point drawing
const ANN = {
  au:    { position: 'belowBar', color: '#0ecb81', shape: 'arrowUp',   text: '' },
  ad:    { position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: '' },
  long:  { position: 'belowBar', color: '#0ecb81', shape: 'arrowUp',   text: 'LONG' },
  short: { position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: 'SHORT' },
};
const TOOLBTN = { start: 'btnPickStart', au: 'annUp', ad: 'annDown', long: 'annLong', short: 'annShort', hl: 'drwHL', tl: 'drwTL', ray: 'drwRay', box: 'drwBox', fib: 'drwFib', measure: 'drwMeasure' };
function placeAnnotation(t, baseTime) { const a = ANN[t]; if (!a) return; annotations.push({ baseTime, ...a }); saveJSON('rt_annotations', annotations); refreshMarkers(); }
function clearAnnotations() { annotations = []; saveJSON('rt_annotations', annotations); refreshMarkers(); toast('已清除標註'); }
function updateToolUI() { Object.values(TOOLBTN).forEach(id => { const b = $(id); if (b) b.classList.remove('active'); }); const b = $(TOOLBTN[tool]); if (b) b.classList.add('active'); $('chart').style.cursor = tool ? 'crosshair' : ''; }
function setTool(t) { tool = (tool === t) ? '' : t; pendingPt = null; repaintOverlays(); updateToolUI(); }
function draggableLines() {
  const a = [];
  if (entryOrder) a.push({ get: () => entryOrder.price, set: p => entryOrder.price = p });
  if (position) orders.forEach(o => { if (o.type === 'stop' || o.type === 'target') a.push({ get: () => o.price, set: p => o.price = p }); });
  return a;
}
function nearestLine(y) { let best = null, bd = 7; for (const L of draggableLines()) { const ly = candle.priceToCoordinate(L.get()); if (ly == null) continue; const d = Math.abs(ly - y); if (d < bd) { bd = d; best = L; } } return best; }
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
  if (!locked()) return;                          // only stop/target/entry lines are draggable
  const L = nearestLine(e.clientY - $('chart').getBoundingClientRect().top);
  if (L) { drag = L; chart.applyOptions({ handleScroll: false, handleScale: false }); e.preventDefault(); }
});
window.addEventListener('mousemove', e => {
  if (!drag) return;
  const p = candle.coordinateToPrice(e.clientY - $('chart').getBoundingClientRect().top);
  if (p != null) { drag.set(rnd(p)); drawLines(); renderLive(); }
});
window.addEventListener('mouseup', () => { if (drag) { drag = null; chart.applyOptions({ handleScroll: true, handleScale: true }); } });
$('chart').addEventListener('mousemove', e => {
  if (drag) return;
  if (tool) { $('chart').style.cursor = 'crosshair'; return; }
  $('chart').style.cursor = nearestLine(e.clientY - $('chart').getBoundingClientRect().top) ? 'ns-resize' : '';
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
function cd(b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }
function vd(b) { return { time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(14,203,129,.35)' : 'rgba(246,70,93,.35)' }; }
const mBucket = (ts) => Math.floor(ts / (tf * 60)) * (tf * 60);

// ---------- init ----------
init();
async function init() { buildDataSelect(); initLayout(); await loadDataset(DATASETS[0].url); }

function detectBaseTf(b) { let mn = Infinity; for (let i = 1; i < Math.min(b.length, 800); i++) { const dl = b[i].time - b[i - 1].time; if (dl > 0 && dl < mn) mn = dl; } return mn === Infinity ? 1 : Math.max(0.5, mn / 60); }
function buildTfOptions() { TF_OPTIONS = [BASE_TF, ...STD_TF.filter(m => m > BASE_TF)]; }

async function loadDataset(url) {
  let data;
  try { const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now()); if (!r.ok) throw 0; data = await r.json(); } // cache-bust so regenerated data files always load fresh
  catch (e) { toast('此資料集還沒準備好'); return false; }
  pause(); position = null; entryOrder = null; orders = []; markers = []; tool = ''; pendingPt = null;
  baseBars = data;
  BASE_TF = detectBaseTf(baseBars); buildTfOptions();
  tf = BASE_TF < 1 ? 1 : BASE_TF;                 // default view: 1m when base is sub-minute, else base
  buildSessions(); buildTfSelect(); buildAtmSelect();
  $('startSlider').max = baseBars.length - 1;
  rebuildTf();
  // default: park at the US cash open (09:30 ET) of the 2nd available trading day
  const ds = sessions[1] || sessions[0];
  baseIdx = ds ? rthOpenIdx(ds) : Math.floor(baseBars.length / 2);
  syncIdxFromBase();
  sizeChart(); hardReveal(); chart.timeScale().fitContent();
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
function rebuildTf() { bars = aggregate(baseBars, tf); computeRipster(); computeIndicators(); }
function tfIndexAtBase(bi) { // TF-bar index whose bucket contains baseBars[bi]
  const t = baseBars[bi].time; let lo = 0, hi = bars.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function syncIdxFromBase() { idx = tfIndexAtBase(baseIdx); }

// ---------- reveal / replay ----------
function hardReveal() { candle.setData(bars.slice(0, idx + 1).map(cd)); vol.setData(bars.slice(0, idx + 1).map(vd)); refreshMarkers(); drawLines(); renderLegend(null); }
function stepFwd() {
  if (idx >= bars.length - 1) { pause(); return; }
  idx++; candle.update(cd(bars[idx])); vol.update(vd(bars[idx]));
  for (let i = bars[idx].subStart; i <= bars[idx].subEnd; i++) { processSub(baseBars[i]); }
  baseIdx = bars[idx].subEnd;
  renderLive(); renderLegend(null);
}
function stepBack() {
  if (locked()) return toast('有部位/掛單時不能後退');
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
  if (locked()) return toast('有部位/掛單時不能跳轉');
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
  if (locked()) return toast('有部位/掛單時不能跳轉');
  if (sessions.length === 0) return;
  const cur = currentSessionIdx(), next = Math.max(0, Math.min(sessions.length - 1, cur + dir));
  if (next === cur) return toast(dir > 0 ? '已是最後一個交易日' : '已是第一個交易日');
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
  if (locked()) { buildTfSelect(); return toast('有部位/掛單時不能換週期'); }
  pause(); tf = m; rebuildTf(); syncIdxFromBase(); hardReveal(); chart.timeScale().fitContent(); renderLive();
}

// ---------- order helpers ----------
function curPx() { return baseBars[baseIdx].close; }
function curBaseT() { return baseBars[baseIdx].time; }
function locked() { return !!position || !!entryOrder; }

function onEntryButton(side) {
  if (position) { if (position.side !== side) return flatten('reverse'); return toast('已有部位 — 先 FLATTEN'); }
  const kind = $('entryType').value;
  const mult = Math.max(1, parseInt($('qty').value, 10) || 1);
  if (kind === 'market') { openPosition(side, curPx(), curBaseT(), activeAtm, mult); }
  else {
    const price = rnd(parseFloat($('entryPrice').value));
    if (!price) return toast('請輸入進場價');
    entryOrder = { side, kind, price, atm: activeAtm, mult };
    toast(`${side === 'long' ? '買' : '賣'} ${kind === 'limit' ? '限價' : '停損'} @ ${f2(price)} 掛單`);
    drawLines(); renderLive();
  }
}
function cancelEntry() { if (entryOrder) { entryOrder = null; drawLines(); renderLive(); toast('已取消掛單'); } }

function openPosition(side, px, t, atmName, mult) {
  const a = atm[atmName]; entryOrder = null;
  const tgts = (a.targets || []).filter(x => x.ticks > 0 && x.qty > 0).map(x => ({ ticks: x.ticks, qty: x.qty * mult }));
  if (!tgts.length) tgts.push({ ticks: a.sl > 0 ? a.sl * 2 : 20, qty: mult }); // fallback single target
  const totalQty = tgts.reduce((s, x) => s + x.qty, 0);
  position = { side, qty: totalQty, entry: px, entryTime: t, atm: atmName, slTicks: a.sl, maxFav: px, beDone: false };
  orders = [];
  if (a.sl > 0) orders.push({ type: 'stop', price: rnd(side === 'long' ? px - a.sl * TICK : px + a.sl * TICK), qty: totalQty });
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
  if (hit) { openPosition(e.side, rnd(px), b.time, e.atm, e.mult); return true; }
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
  if (entryOrder) lines.push(pl(entryOrder.price, '#f0b90b', LightweightCharts.LineStyle.Dotted, entryOrder.kind === 'limit' ? 'LMT' : 'STP'));
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
    box.textContent = entryOrder ? `掛單中:${entryOrder.side === 'long' ? '買' : '賣'} ${entryOrder.kind === 'limit' ? '限價' : '停損'} @ ${f2(entryOrder.price)}` : '空手 Flat';
  } else {
    const long = position.side === 'long';
    const uTicks = long ? tcount(curPx(), position.entry) : tcount(position.entry, curPx());
    const uPnl = uTicks * INSTR.tickValue * position.qty;
    box.className = long ? 'long' : 'short';
    box.innerHTML = `<div class="big">${long ? 'LONG' : 'SHORT'} ${position.qty} @ ${f2(position.entry)}</div>
      <div>未實現 <b class="${uPnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${usd(uPnl)}</b> · ${uTicks >= 0 ? '+' : ''}${uTicks}t · ${position.atm}</div>`;
  }
  const ord = [];
  if (entryOrder) ord.push(`<div class="ord entry"><span>${entryOrder.kind === 'limit' ? 'LIMIT' : 'STOP'} ${entryOrder.side === 'long' ? 'BUY' : 'SELL'}</span><span class="mono">${f2(entryOrder.price)}</span></div>`);
  orders.forEach(o => ord.push(`<div class="ord ${o.type}"><span>${o.type === 'stop' ? 'STOP' : 'TARGET'} ×${o.qty}</span><span class="mono">${f2(o.price)}</span></div>`));
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
  $('tradesSummary').textContent = `${trades.length} 筆 · 淨損益 ${usd(net)}`;
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
  $('statCards').innerHTML = card('交易數', n) + card('勝率', winRate.toFixed(1) + '%', winRate >= 50 ? 'pnl-pos' : '') +
    card('淨損益', usd(net), net >= 0 ? 'pnl-pos' : 'pnl-neg') + card('獲利因子', pf === Infinity ? '∞' : pf.toFixed(2)) +
    card('期望值/筆', usd(exp), exp >= 0 ? 'pnl-pos' : 'pnl-neg') + card('平均 R', avgR == null ? '–' : avgR.toFixed(2));
  const byAtm = {}; trades.forEach(t => { (byAtm[t.atm] ??= []).push(t); });
  $('atmStats').innerHTML = `<table><thead><tr><th>ATM</th><th>筆</th><th>勝率</th><th>淨 $</th></tr></thead><tbody>` +
    Object.entries(byAtm).map(([k, ts]) => { const w = ts.filter(t => t.pnl > 0).length, l = ts.filter(t => t.pnl < 0).length, nt = ts.reduce((s, t) => s + t.pnl, 0);
      return `<tr><td>${k}</td><td>${ts.length}</td><td>${(w + l) ? (w / (w + l) * 100).toFixed(0) : 0}%</td><td class="${nt >= 0 ? 'pos' : 'neg'}">${usd(nt)}</td></tr>`; }).join('') + `</tbody></table>`;
  drawEquity();
  $('panelDash').title = `Max Drawdown ${usd(dd)}`;
}
function drawEquity() {
  const c = $('equity'), ctx = c.getContext('2d'); const W = c.width = c.clientWidth || 600, H = c.height;
  ctx.clearRect(0, 0, W, H);
  if (!trades.length) { ctx.fillStyle = '#8b93a7'; ctx.fillText('尚無交易', 10, 20); return; }
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
  const name = $('atmName').value.trim(); if (!name) return toast('範本要有名稱');
  const targets = [];
  [['atmT1t', 'atmT1q'], ['atmT2t', 'atmT2q'], ['atmT3t', 'atmT3q']].forEach(([t, q]) => { const tk = +$(t).value, qy = +$(q).value; if (tk > 0 && qy > 0) targets.push({ ticks: tk, qty: qy }); });
  if (!targets.length) return toast('至少一個目標 (ticks 與口數 > 0)');
  atm[name] = { sl: +$('atmSL').value, targets, be: { on: $('atmBEon').checked, trig: +$('atmBEtrig').value, off: +$('atmBEoff').value }, trail: { on: $('atmTrailon').checked, trig: +$('atmTrailTrig').value, dist: +$('atmTrailDist').value } };
  saveJSON('rt_atm', atm); activeAtm = name; buildAtmSelect(); toast('已儲存 ' + name);
}
function delAtm() { const name = $('atmName').value.trim(); if (atm[name] && Object.keys(atm).length > 1) { delete atm[name]; saveJSON('rt_atm', atm); activeAtm = Object.keys(atm)[0]; buildAtmSelect(); toast('已刪除 ' + name); } }

// ---------- misc ----------
let toastT = null;
function toast(msg) { let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1600); }
function exportCsv() {
  const head = 'idx,side,qty,entryTime,exitTime,entry,exit,ticks,pnl,R,atm,exitType';
  const rows = trades.map((t, i) => [i + 1, t.side, t.qty, tFmt(t.entryTime), tFmt(t.exitTime), t.entry, t.exit, t.ticks, t.pnl, t.R == null ? '' : t.R.toFixed(3), t.atm, t.exitType].join(','));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' })); a.download = 'replay_trades.csv'; a.click();
}
function resetAll() { if (!confirm('清空所有交易紀錄?')) return; trades = []; saveJSON('rt_trades', trades); position = null; entryOrder = null; orders = []; markers = []; refreshMarkers(); drawLines(); renderAll(); }

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
  $('dataSelect').onchange = async (e) => { if (locked()) { $('dataSelect').value = dataIdx; return toast('有部位/掛單時不能換資料集'); } const i = +e.target.value; const ok = await loadDataset(DATASETS[i].url); if (ok) dataIdx = i; else $('dataSelect').value = dataIdx; };
  $('speedSelect').onchange = () => { if (playing) { pause(); play(); } };
  $('startSlider').oninput = (e) => setStart(+e.target.value);
  $('btnPickStart').onclick = () => { if (locked()) { return toast('有部位/掛單時不能設起點'); } setTool('start'); };
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
  $('ripsterToggle').checked = ripsterOn;
  $('ripsterToggle').onchange = (e) => { ripsterOn = e.target.checked; saveJSON('rt_ripster', ripsterOn); ripsterRepaint(); };
  initChartLegend();
  $('indVwap').checked = vwapOn; $('indVwap').onchange = (e) => setVwap(e.target.checked);
  $('indBB').checked = bbOn; $('indBB').onchange = (e) => setBB(e.target.checked);
  $('indEma').checked = emaOn; $('indEma').onchange = (e) => setEMA(e.target.checked);
  $('emaPeriods').value = emaPeriods.join(','); $('emaPeriods').onchange = (e) => setEmaPeriods(e.target.value);

  $('entryType').onchange = () => { $('entryPriceRow').style.display = $('entryType').value === 'market' ? 'none' : ''; if ($('entryType').value !== 'market' && !$('entryPrice').value) $('entryPrice').value = f2(curPx()); };
  $('btnBuy').onclick = () => onEntryButton('long');
  $('btnSell').onclick = () => onEntryButton('short');
  $('btnFlatten').onclick = flatten;
  $('btnReverse').onclick = reverse;
  $('btnCancelEntry').onclick = cancelEntry;

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
  });
}
function switchTab(t) { $('tabTrades').classList.toggle('active', t); $('tabDash').classList.toggle('active', !t); $('panelTrades').classList.toggle('hidden', !t); $('panelDash').classList.toggle('hidden', t); if (!t) renderDash(); }

// debug hook (harmless; used for automated verification)
window.__rt = { state: () => ({ tf, idx, baseIdx, bars: bars.length, base: baseBars.length, pos: position && { ...position }, orders: orders.map(o => ({ ...o })), entryOrder }), bar: (i) => bars[i], sub: (i) => baseBars[i], agg: (m) => aggregate(baseBars, m), dresize: (w, h) => chart.resize(w, h, true), sc: sizeChart, chartOpts: () => chart.options(), priceToY: (p) => candle.priceToCoordinate(p), coordToPrice: (y) => candle.coordinateToPrice(y), chartRect: () => $('chart').getBoundingClientRect(), setTool: (t) => setTool(t), getTool: () => tool, placeAnn: (t, time) => placeAnnotation(t, time), annCount: () => annotations.length, ripster: () => ({ on: ripsterOn, clouds: ripsterData.length }), drawCount: () => drawings.length, addDraw: (t, time, price) => handleDrawClick(t, time, price), rthOpenET: (i) => etMinutes(baseBars[rthOpenIdx(sessions[i])].time), nextDay, prevDay, curSession: () => currentSessionIdx() };
