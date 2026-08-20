'use strict';
/* NQ Replay Trainer — Wave 1
 * TradingView-style bar replay with multi-timeframe + manual orders (market/limit/stop entry)
 * + NinjaTrader-style ATM (multi-target scale-out, breakeven, trailing). Fills are always
 * simulated on the underlying 30-second sub-bars, so accuracy is timeframe-independent. */

let INSTR = { symbol: 'NQ', tickSize: 0.25, tickValue: 5 }; // active contract spec (per-dataset; NQ: $20/pt -> $5/tick)
// Deep history (2026-08-13): 3 years of real 15s bars, split one-file-per-month under
// data/chunks/<SYM>/ (scripts/fetch_15s_bulk.py + split_monthly.py) so no single file ever
// approaches GitHub's 100MB push limit. Loaded on demand — picking a day fetches just that
// month (+ the prior month, so day-1 previous-session context exists), never the whole span.
// This is now the default/only VISIBLE pair — the older quick multi-res sets (1m base,
// daily-updated but shallower) are kept (hidden:true) rather than deleted, in case a fast
// single-load-no-day-picker dataset is wanted again later; buildDataSelect() filters them
// out of the dropdown, they still load fine if re-shown or referenced directly.
const DATASETS = [
  { id: 'nqdeep', label: 'NQ', deep: true, instr: { symbol: 'NQ', tickSize: 0.25, tickValue: 5 } },
  { id: 'esdeep', label: 'ES', deep: true, instr: { symbol: 'ES', tickSize: 0.25, tickValue: 12.5 } },
  // Every individual print as a base bar -> fills happen on the real tape (true slippage), and the
  // candle grows print-by-print on Realtime. Days live in data/tick/ (gitignored, ~10MB each), so this
  // one is LOCAL-ONLY: on GitHub Pages the index fetch 404s and it falls back to the "no tick days" toast.
  { id: 'nqtick', label: 'NQ tick', tick: true, instr: { symbol: 'NQ', tickSize: 0.25, tickValue: 5 } },
  { id: 'nq1m', label: 'NQ · multi-res (finest available · daily-updated)', url: 'data/NQ_multi.json', hidden: true, instr: { symbol: 'NQ', tickSize: 0.25, tickValue: 5 } },   // $20/pt
  { id: 'es1m', label: 'ES · multi-res (finest available · daily-updated)', url: 'data/ES_multi.json', hidden: true, instr: { symbol: 'ES', tickSize: 0.25, tickValue: 12.5 } }, // $50/pt
];
const STD_TF = [0.25, 1 / 3, 0.5, 1, 2, 3, 5, 10, 15, 30, 60];   // standard timeframes in minutes (0.25=15s, 1/3=20s, 0.5=30s)
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
const blindDate = () => rndMode || quizMode;   // random + quiz modes hide the calendar date so the practice stays honest
function etTickFmt(ts, type) { const o = etP(ts); if (type === _TM.Year || type === _TM.Month || type === _TM.DayOfMonth) return blindDate() ? '·' : `${o.month}/${o.day}`; if (type === _TM.TimeWithSeconds) return `${o.hour}:${o.minute}:${o.second}`; return `${o.hour}:${o.minute}`; }
const etCrosshairFmt = (ts) => { const o = etP(ts); return blindDate() ? `${o.hour}:${o.minute} ET` : `${o.month}/${o.day} ${o.hour}:${o.minute} ET`; };
const loadJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const saveJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ---------- state ----------
let rndMode = false, rndCurKey = null, rndStartCount = 0, rndRounds = [], rndPrevMin = null, rndSettled = false;   // random-date practice mode
let quizMode = false;   // quiz mode: replay the user's OWN past trades up to the bar before entry and re-decide (declared here so the date-blinding formatters can read it)
let rndSavedTrades = null, rndSavedMarkers = null;   // real trades/markers parked while the random-mode sandbox runs
let baseBars = [];           // raw 1-min bars
let bars = [];               // current-timeframe bars (each carries subStart/subEnd into baseBars)
let tf = 1;                  // timeframe in minutes
let idx = 0;                 // last revealed TF-bar index
let baseIdx = 0;             // last revealed 1-min index (== bars[idx].subEnd)
let playing = false, timer = null;
// windowed rendering: the chart series holds only the recent ~window bars (continuous datasets like
// NQ-1m-year = 350k+ bars would otherwise feed every revealed bar into LWC, making stepping crawl).
const RENDER_WINDOW = 4000, WINDOW_SLACK = 1500;
let seriesFrom = 0;          // first absolute bar index currently in the candle/vol series (logical 0)
// Tradovate-style tick replay: one day's real prints as the base resolution
let tickMode = false, tickMs = [], availTickDays = [], curTickDay = null, simMs = 0, speedUIBase = null;
// multiple-timeframe view — declared up here with the other mode state, NOT next to its functions:
// init() runs early and hardReveal() reads these on the first paint (the TDZ trap seriesFrom and
// deepMode both fell into). mtfPanes holds one {tf, chart, series, bars} per extra chart.
let mtfLayout = loadJSON('rt_mtf_layout', 'off'), mtfTfs = loadJSON('rt_mtf_tfs', [1, 0, 0]), mtfPanes = [];
let deepMode = false, deepSym = null, deepIndex = [], deepAllDays = new Set(), deepMonth = null;   // declared up here (not near enterDeepMode below) — init() runs early and loadDataset() reads deepMode on its first line; a late `let` here is the exact TDZ trap seriesFrom/RENDER_WINDOW already hit once
let fO = 0, fH = 0, fL = 0, fC = 0, fV = 0, fBucket = -1;   // live-forming candle accumulator

let position = null;         // {side,qty,entry,entryTime,atm,slTicks,maxFav,beDone}
let orders = [];             // working: {type:'stop'|'target', price, qty, ticks?}
let entryOrder = null;       // pending entry: {side, kind:'limit'|'stop', price, atm, mult}
let trades = loadJSON('rt_trades', []);
(() => { const bk = loadJSON('rt_trades_prerandom', null); if (bk) { trades = bk; saveJSON('rt_trades', trades); localStorage.removeItem('rt_trades_prerandom'); } })();   // recover real trades if a random-mode session was interrupted mid-round
let showTrades = loadJSON('rt_show_trades', true);   // show entry/exit trade arrows on the chart
let tradeLogs = loadJSON('rt_trade_logs', []);   // named saved trade logs: [{id,name,ts,trades:[...]}]
let alertMin = loadJSON('rt_alert_min', 690);    // remind me when the replay crosses this ET time (minutes since midnight; 690 = 11:30). null = off
let prevAlertMin = null;                          // previous revealed bar's ET minutes — used to detect the upward cross
let markers = [];            // {baseTime, position, color, shape, text}
let lines = [];              // active price-line handles

if (loadJSON('rt_atm_v', 0) < 2) { try { localStorage.removeItem('rt_atm'); } catch (e) {} saveJSON('rt_atm_v', 2); }   // one-time: adopt structural-stop 1:1 default bracket
let atm = normalizeAtms(loadJSON('rt_atm', defaultAtms()));
if (loadJSON('rt_atm_v', 0) < 3) {   // merge new struct presets into an existing saved set (don't clobber user-made ATMs)
  const d = defaultAtms();
  ['Struct SL · 1:2', 'Struct SL · Custom R'].forEach(k => { if (!atm[k]) atm[k] = d[k]; });
  saveJSON('rt_atm', atm); saveJSON('rt_atm_v', 3);
}
if (loadJSON('rt_atm_v', 0) < 4) {   // merge the inline Custom SL/TP preset in without clobbering user-made ATMs
  if (!atm['Custom SL/TP']) atm['Custom SL/TP'] = defaultAtms()['Custom SL/TP'];
  saveJSON('rt_atm', atm); saveJSON('rt_atm_v', 4);
}
if (loadJSON('rt_atm_v', 0) < 5) {   // merge the bar-open structural stop in, same rule: never clobber user-made ATMs
  if (!atm['Struct SL · bar OPEN']) atm['Struct SL · bar OPEN'] = defaultAtms()['Struct SL · bar OPEN'];
  saveJSON('rt_atm', atm); saveJSON('rt_atm_v', 5);
}
let activeAtm = Object.keys(atm)[0];
let riskOn = loadJSON('rt_risk_on', false), riskUsd = loadJSON('rt_risk_usd', 200);   // fixed-$ position sizing: contracts derived from $risk ÷ stop

function defaultAtms() {
  return {
    'Struct SL · 1:1':    { struct: true, rr: 1, sl: 0, targets: [], be: { on: false, trig: 80, off: 4 }, trail: { on: false, trig: 80, dist: 40 } },   // stop at current bar's high(short)/low(long) ±1tick; target = 1× risk
    'Struct SL · 1:2':    { struct: true, rr: 2, sl: 0, targets: [], be: { on: false, trig: 80, off: 4 }, trail: { on: false, trig: 80, dist: 40 } },   // structural stop; target = 2× risk
    'Struct SL · Custom R': { struct: true, rr: 1.5, sl: 0, targets: [], be: { on: false, trig: 80, off: 4 }, trail: { on: false, trig: 80, dist: 40 } }, // structural stop; dial the R multiple with the Target-R input
    // Stop parked at the SIGNAL BAR'S OPEN rather than its wick — on a big breakout bar the low can
    // be 40+ ticks away while the open sits right under the trigger, so this is the tight version of
    // the same idea. Meant for Buy/Sell Stop entries (entry = bar high/low ±1 tick, so the open is
    // always on the correct side), but it works for market and limit entries too.
    'Struct SL · bar OPEN':  { struct: true, openStop: true, rr: 1, sl: 0, targets: [], be: { on: false, trig: 80, off: 4 }, trail: { on: false, trig: 80, dist: 40 } },
    // Driven by the Stop/Target boxes in the order panel (see syncRrField) instead of the template
    // editor — type a distance, trade. It is an ordinary ATM otherwise, so bracketFromAtm,
    // plannedStopTicks, fixed-$ sizing, Buy/Sell Stop and the right-click menu all use it unchanged.
    'Custom SL/TP':       { custom: true, sl: 40, targets: [{ ticks: 40, qty: 1 }], be: { on: false, trig: 80, off: 4 }, trail: { on: false, trig: 80, dist: 40 } },
    '40pt / 40pt':        { sl: 160, targets: [{ ticks: 160, qty: 1 }], be: { on: false, trig: 80, off: 4 }, trail: { on: false, trig: 80, dist: 40 } },   // 160 ticks = 40 pt on NQ/ES (0.25 tick)
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
  layout: { background: { color: '#000000' }, textColor: '#d1d4dc', attributionLogo: false },
  grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#2a2e39' },
  localization: { timeFormatter: etCrosshairFmt },                 // crosshair label in ET
  timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: true, rightOffset: 6, tickMarkFormatter: etTickFmt }, // axis labels in ET (open = 09:30)
});
let candle = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
let vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' } });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
function sizeChart() {
  const el = $('chart'); const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
  chart.resize(w - 1, h, true); chart.resize(w, h, true); // double-resize: LWC no-ops a resize to the same size, so nudge then set
  mtfPanes.forEach(p => { const pw = p.cv.clientWidth, ph = p.cv.clientHeight; if (pw && ph) { p.chart.resize(pw - 1, ph, true); p.chart.resize(pw, ph, true); } });
}
new ResizeObserver(sizeChart).observe($('chartwrap'));
window.addEventListener('resize', sizeChart);
// ---- price-axis vertical zoom (wheel over the right axis) + auto-fit ----
const PX_MARGIN_DEF = 0.15; let pxMargin = PX_MARGIN_DEF;   // symmetric vertical margin on the price scale; wheel grows/shrinks it. Also = the 1:1 vertical-pan range (±pxMargin); wheel-out for more room
let pxShift = 0;                                          // vertical pan offset: drag the chart body up/down to move the price view
let priceAuto = true;                                    // price scale auto-fits (follows price); a manual vertical pan/zoom freezes it (natural), Fit re-enables
function applyPriceZoom() {
  pxShift = Math.max(-pxMargin, Math.min(pxMargin, pxShift));   // clamp to the margin room: both margins stay >=0 so the data block keeps its size → vertical pan tracks the mouse 1:1 (no compression). Wheel-zoom-out grows pxMargin = more pan room.
  chart.priceScale('right').applyOptions({ autoScale: priceAuto, scaleMargins: { top: pxMargin + pxShift, bottom: pxMargin - pxShift } });
}
applyPriceZoom();
function fitRecent(n) {   // frame the most recent n bars (+ a little right margin) and re-fit the price to them
  pxMargin = PX_MARGIN_DEF; pxShift = 0; priceAuto = true;
  const li = idx - seriesFrom;                              // logical index of the latest bar in the windowed series
  const from = Math.max(0, li - (n - 1)), to = li + 6;
  try { chart.timeScale().setVisibleLogicalRange({ from, to }); } catch (e) { chart.timeScale().fitContent(); }
  applyPriceZoom();
}
function fitChart() { fitRecent(100); }   // Fit button / key 0 / dbl-click axis → recent ~100 bars (was: all revealed bars)
function priceAxisW() { try { const w = chart.priceScale('right').width(); if (w > 0) return w; } catch (e) {} return 62; }
function overPriceAxis(clientX) { const r = $('chart').getBoundingClientRect(); return clientX - r.left >= r.width - Math.max(priceAxisW(), 44); }
// wheel over the price axis = zoom price vertically; over the chart = LWC's native time zoom
$('chart').addEventListener('wheel', (e) => {
  if (!overPriceAxis(e.clientX)) return;
  e.preventDefault(); e.stopPropagation();
  priceAuto = false;                                                                  // manual zoom → freeze auto-fit (natural)
  pxMargin = Math.max(0, Math.min(0.45, pxMargin + (e.deltaY > 0 ? 0.03 : -0.03)));   // down=zoom out, up=zoom in
  applyPriceZoom();
}, { capture: true, passive: false });
// double-click the price axis = auto-fit (TradingView behaviour)
$('chart').addEventListener('dblclick', (e) => { if (overPriceAxis(e.clientX)) fitChart(); });

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
  if (a.struct) return { slTicks: 0, tgts: [], struct: true, rr: a.rr || 1 };   // structural stop is computed from the fill bar
  return { slTicks: a.sl || 0, tgts: (a.targets || []).filter(t => t.ticks > 0 && t.qty > 0).map(t => ({ ticks: t.ticks, qty: t.qty })) };
}
function curBarExtreme() { const b = bars[Math.min(idx, bars.length - 1)]; return b ? { hi: b.high, lo: b.low, op: b.open } : { hi: 0, lo: 0, op: 0 }; }   // current K-bar high/low/open for structural stops
// THE one place a structural stop price is decided. Sizing, the working-order preview lines and the
// bracket that actually gets placed all call this, so they can never disagree about where the stop is.
// a.openStop -> park it at the signal bar's OPEN (tighter than the wick on a big breakout bar);
// otherwise the classic opposite extreme +-1 tick. Both are clamped to stay >=1 tick beyond entry.
function structStopPx(side, entryRef, a) {
  const ext = curBarExtreme(), long = side === 'long';
  if (a && a.openStop) return rnd(long ? Math.min(ext.op, entryRef - TICK) : Math.max(ext.op, entryRef + TICK));
  return rnd(long ? Math.min(ext.lo, entryRef) - TICK : Math.max(ext.hi, entryRef) + TICK);
}

// ---- fixed-risk position sizing: contracts = floor($risk ÷ (stopTicks × $/tick)) ----
function plannedStopTicks(side, kind, price) {   // stop distance (ticks) the active ATM would apply to this prospective order
  const a = atm[activeAtm] || {};
  if (a.struct) {                                // structural stop = signal/current bar's opposite extreme ±1 tick
    const ext = curBarExtreme();
    const entryRef = kind === 'stop' ? rnd(side === 'long' ? ext.hi + TICK : ext.lo - TICK)   // breakout level
                   : kind === 'limit' ? (price || curPx()) : curPx();
    return Math.max(1, Math.round(Math.abs(entryRef - structStopPx(side, entryRef, a)) / TICK));   // one shared stop-price rule => sizing always matches the bracket that gets placed
  }
  return a.sl > 0 ? a.sl : 0;                    // fixed SL ticks (0 = template has no stop → can't size)
}
function sizeForRisk(stopTicks) { return (riskUsd > 0 && stopTicks > 0) ? Math.max(1, Math.floor(riskUsd / (stopTicks * INSTR.tickValue))) : null; }
function resolveQty(side, kind, price) { if (riskOn) { const n = sizeForRisk(plannedStopTicks(side, kind, price)); if (n) return n; } return Math.max(1, parseInt($('qty').value, 10) || 1); }
function renderRiskReadout() {
  const box = $('riskReadout'); if (!box) return;
  const q = $('qty'), qm = $('qtyMinus'), qp = $('qtyPlus'); if (q) q.disabled = riskOn; if (qm) qm.disabled = riskOn; if (qp) qp.disabled = riskOn;
  if (!riskOn || !baseBars.length) { box.style.display = 'none'; return; }
  const kind = $('entryType').value;
  const px = kind === 'limit' ? rnd(parseFloat($('entryPrice').value) || curPx()) : undefined;
  const cell = (side, cls, lbl) => {
    const st = plannedStopTicks(side, kind, px), n = sizeForRisk(st);
    if (!n) return `<span class="rk ${cls}"><span>${lbl}</span><span>— set a stop</span></span>`;
    const d = atmUnit === 'pts' ? `${+(st * TICK).toFixed(2)}pt` : `${st}t`;   // quote the stop in whatever unit the ATM editor is set to
    return `<span class="rk ${cls}"><span>${lbl} <b>${n}</b></span><span>${d} · ${usd(n * st * INSTR.tickValue)}</span></span>`;
  };
  box.style.display = ''; box.innerHTML = cell('long', 'buy', 'BUY') + cell('short', 'sell', 'SELL');
}
function structBracket(side, kind, price, name) {   // R-based bracket AT ORDER TIME for struct ATMs: stop beyond the signal bar / entry structure, target = rr × risk
  const a = atm[name || activeAtm] || {}; if (!a.struct) return null;
  const stopPx = structStopPx(side, price, a);
  const slT = Math.max(1, Math.round(Math.abs(price - stopPx) / TICK));
  return { slTicks: slT, tgts: [{ ticks: Math.max(1, Math.round(slT * (a.rr || 1))), qty: 1 }] };
}
const CTX_BRACKET_PTS = 40;   // the "±40pt fixed" option for right-click orders (SL & TP distance in points)
let ctxAtm = loadJSON('rt_ctx_atm', '40pt');   // ATM used by right-click orders: '40pt' sentinel or any template name (selector inside the context menu)
function placeEntryAt(side, kind, price) {
  if (position) return toast('Already in a position — flatten first');
  price = rnd(price);
  let bracket, atmName;
  if (ctxAtm === '40pt' || !atm[ctxAtm]) {   // fixed ±40pt (also the fallback if a saved template no longer exists)
    const t = Math.max(1, Math.round(CTX_BRACKET_PTS / TICK));
    bracket = { slTicks: t, tgts: [{ ticks: t, qty: 1 }] }; atmName = '40pt';
  } else {
    bracket = structBracket(side, kind, price, ctxAtm) || bracketFromAtm(ctxAtm); atmName = ctxAtm;
  }
  const mult = (riskOn && bracket.slTicks && sizeForRisk(bracket.slTicks)) || Math.max(1, parseInt($('qty').value, 10) || 1);
  entryOrder = { side, kind, price, atm: atmName, mult, ...bracket };
  toast(`${side === 'long' ? 'Buy' : 'Sell'} ${kind === 'limit' ? 'Limit' : 'Stop'} @ ${f2(price)} · ${atmName === '40pt' ? '±' + CTX_BRACKET_PTS + 'pt' : atmName}`);
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
    it.push({ atmSel: 1 });   // which ATM the limit/stop rows below will use
    it.push({ sep: 1 });
    it.push({ l: 'Buy Market', cls: 'buy', f: () => onEntryButtonDirect('long') });
    it.push({ l: 'Sell Market', cls: 'sell', f: () => onEntryButtonDirect('short') });
    it.push({ sep: 1 });
    it.push({ l: `Buy Limit @ ${p}`, cls: 'buy', f: () => placeEntryAt('long', 'limit', price) });
    it.push({ l: `Sell Limit @ ${p}`, cls: 'sell', f: () => placeEntryAt('short', 'limit', price) });
    it.push({ l: `Buy Stop @ ${p}`, cls: 'buy', f: () => placeEntryAt('long', 'stop', price) });
    it.push({ l: `Sell Stop @ ${p}`, cls: 'sell', f: () => placeEntryAt('short', 'stop', price) });
  }
  const nDrw = drawings.length + annotations.length;   // always-available: wipe every drawing in one go
  if (nDrw) { it.push({ sep: 1 }); it.push({ l: `Clear all drawings (${nDrw})`, f: () => clearDrawings() }); }
  ctxEl.innerHTML = '';
  it.forEach(x => {
    const d = document.createElement('div');
    if (x.sep) { d.className = 'ctx-sep'; }
    else if (x.h) { d.className = 'ctx-head'; d.textContent = x.h; }
    else if (x.atmSel) {   // order-ATM selector row: change what the limit/stop entries use; doesn't close the menu
      d.className = 'ctx-item ctx-atm';
      const lab = document.createElement('span'); lab.textContent = 'ATM'; d.appendChild(lab);
      const sel = document.createElement('select'); sel.id = 'ctxAtmSel';
      const opts = [['40pt', `±${CTX_BRACKET_PTS}pt fixed`]].concat(Object.keys(atm).map(k => [k, k]));
      sel.innerHTML = opts.map(([v, l]) => `<option value="${escHtml(v)}"${v === (atm[ctxAtm] || ctxAtm === '40pt' ? ctxAtm : '40pt') ? ' selected' : ''}>${escHtml(l)}</option>`).join('');
      ['mousedown', 'click'].forEach(ev => sel.addEventListener(ev, e => e.stopPropagation()));
      sel.onchange = (e) => { ctxAtm = e.target.value; saveJSON('rt_ctx_atm', ctxAtm); };
      d.appendChild(sel); d.onclick = (e) => e.stopPropagation();
    }
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
function legendTfLabel() { return tf < 1 ? Math.round(tf * 60) + 's' : tf + 'm'; }
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
  const add = (key, on, title, params, vals) => { if (!on) return; rows.push(   // TV-style: only ACTIVE indicators show
    `<div class="il-row" data-ind="${key}">` +
    `<span class="il-name">${title}</span>` +
    (params ? `<span class="il-params">${params}</span>` : '') +
    (vals ? `<span class="il-vals">${vals}</span>` : '') +
    `<span class="il-x material-symbols-outlined" data-del="${key}" title="Remove">close</span>` + `</div>`); };
  add('rip', ripsterOn, 'Ripster EMA Clouds', '8·9 5·12 34·50 72·89 180·200', '');
  add('vwap', vwapOn, 'VWAP', '', tint(VWAP_COLOR, `<b>${fmtIndVal(vwapData[i])}</b>`));
  add('bb', bbOn, 'BB', '20 2', `${tint('var(--dim)', fmtIndVal(bbData.up[i]))} ${tint(BB_MID, '<b>' + fmtIndVal(bbData.mid[i]) + '</b>')} ${tint('var(--dim)', fmtIndVal(bbData.lo[i]))}`);
  const emaVals = emaData.map(e => tint(e.color, fmtIndVal(e.arr[i]))).join(' ');
  add('ema', emaOn, 'EMA', emaPeriods.join(' '), emaVals);
  if (vpP.on) add('vpp', true, 'VP prev NY', vpPData ? vpPData.key : '', vpPData ? `${tint(vpP.color, 'PPOC ' + f2(vpPData.poc))}  ${tint(vpP.color, 'PVA ' + f2(vpPData.vah) + '/' + f2(vpPData.val))}` : '–');
  if (vpO.on) add('vpo', true, 'VP overnight', vpOData ? '18:00→09:30' : 'forming', vpOData ? `${tint(vpO.color, 'OPOC ' + f2(vpOData.poc))}  ${tint(vpO.color, 'OVA ' + f2(vpOData.vah) + '/' + f2(vpOData.val))}` : '–');
  if (vpD.on) add('vpd', true, 'VP developing', vpDData ? 'live' : '', vpDData ? `${tint(vpD.color, 'dPOC ' + f2(vpDData.poc))}  ${tint(vpD.color, 'dVA ' + f2(vpDData.vah) + '/' + f2(vpDData.val))}` : '–');
  el.innerHTML = rows.join('');
}
function toggleInd(which) {
  if (which === 'rip') { ripsterOn = !ripsterOn; saveJSON('rt_ripster', ripsterOn); ripsterRepaint(); const c = $('ripsterToggle'); if (c) c.checked = ripsterOn; }
  else if (which === 'vwap') { setVwap(!vwapOn); const c = $('indVwap'); if (c) c.checked = vwapOn; }
  else if (which === 'bb') { setBB(!bbOn); const c = $('indBB'); if (c) c.checked = bbOn; }
  else if (which === 'ema') { setEMA(!emaOn); const c = $('indEma'); if (c) c.checked = emaOn; }
  else if (which === 'vpp') { setVpCfg('p', { on: !vpP.on }); const c = $('indVpP'); if (c) c.checked = vpP.on; }
  else if (which === 'vpo') { setVpCfg('o', { on: !vpO.on }); const c = $('indVpO'); if (c) c.checked = vpO.on; }
  else if (which === 'vpd') { setVpCfg('d', { on: !vpD.on }); const c = $('indVpD'); if (c) c.checked = vpD.on; }
  renderIndLegend();
}
function initIndLegend() {
  const el = $('indLegend'); if (!el) return;
  el.addEventListener('mousedown', (e) => e.stopPropagation());   // clicking the legend must not start a chart drag
  el.addEventListener('click', (e) => { const x = e.target.closest('[data-del]'); if (x) toggleInd(x.dataset.del); });   // X removes (turns off)
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
// one-time reset of indicator prefs → new clean defaults (blank chart, EMA 10 only, TV-style removable)
if (loadJSON('rt_ind_v', 0) < 4) { ['rt_ripster', 'rt_oscMode', 'rt_vwap', 'rt_bb', 'rt_ema', 'rt_ema_p', 'rt_atr_len'].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); saveJSON('rt_ind_v', 4); }
let ripsterOn = loadJSON('rt_ripster', false);
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
          const from = seriesFrom + Math.max(0, Math.floor(range.from)), to = Math.min(bars.length - 1, seriesFrom + Math.ceil(range.to));   // logical→absolute (windowed series)
          const xs = []; for (let i = from; i <= to; i++) xs[i] = ts.timeToCoordinate(bars[i].time);
          for (const cl of ripsterData) {
            for (let i = from; i < to; i++) {
              const x0 = xs[i], x1 = xs[i + 1]; if (x0 == null || x1 == null) continue;
              const f0 = candle.priceToCoordinate(cl.fast[i]), s0 = candle.priceToCoordinate(cl.slow[i]);
              const f1 = candle.priceToCoordinate(cl.fast[i + 1]), s1 = candle.priceToCoordinate(cl.slow[i + 1]);
              if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
              ctx.beginPath(); ctx.moveTo(x0, f0); ctx.lineTo(x1, f1); ctx.lineTo(x1, s1); ctx.lineTo(x0, s0); ctx.closePath();
              ctx.globalAlpha = cl.st.a; ctx.fillStyle = cl.st.dir ? (cl.fast[i] >= cl.slow[i] ? '#26a69a' : '#ef5350') : cl.st.fill; ctx.fill(); ctx.globalAlpha = 1;
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
  bg:    '#000000', grid: '#161616', border: '#2a2e39', txt: '#787b86',
  rsi:   '#c026d3',                       // RSI line (magenta, distinct from Ripster)
  guide: '#3a4150',                       // 30/70/50 guide lines
  macd:  '#2962ff', signal: '#fcd535',    // MACD line / signal line
  up:    '#26a69a', down: '#ef5350',      // histogram + matches candle body colors
  atr:   '#f0b90b',                       // ATR line (amber)
  atrHalf: '#a9842c',                     // half-ATR line (dim amber, dashed) = 0.5-ATR target distance
};

// ---- state ----
let oscMode = loadJSON('rt_oscMode', 'atr');   // 'rsi' | 'macd' | 'atr' | 'off'  (ATR 10 shown by default)
let atrLen  = (n => (Number.isFinite(n) && n >= 1) ? n : 10)(loadJSON('rt_atr_len', 10));  // adjustable ATR period (default 10)
let oscChart = null, oscSyncing = false;       // reentrancy guard for range sync
let rsiSeries = null, macdHist = null, macdLine = null, sigLine = null, atrSeries = null, atrHalfSeries = null;
let oscRsi = [], oscMacd = [], oscAtr = [];    // full-length computed arrays (parallel to bars[])

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

// Wilder's ATR(len): seed with SMA of first `len` true ranges, then RMA. null until seeded.
function computeATR(bars, len) {
  const n = bars.length, out = new Array(n).fill(null);
  if (n < 2 || len < 1) return out;
  const tr = new Array(n);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < n; i++) { const pc = bars[i - 1].close; tr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)); }
  if (n < len) return out;
  let a = 0; for (let i = 0; i < len; i++) a += tr[i]; a /= len; out[len - 1] = a;
  for (let i = len; i < n; i++) { a = (a * (len - 1) + tr[i]) / len; out[i] = a; }
  return out;
}

// ---- compute (call on rebuildTf + dataset load) --------------------------
function oscCompute() {
  const close = bars.map(b => b.close);
  oscRsi = computeRSI(close, 14);
  oscMacd = computeMACD(close, 12, 26, 9);
  oscAtr = computeATR(bars, atrLen);
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
  [rsiSeries, macdHist, macdLine, sigLine, atrSeries, atrHalfSeries].forEach(s => { if (s) try { oscChart.removeSeries(s); } catch (e) {} });
  rsiSeries = macdHist = macdLine = sigLine = atrSeries = atrHalfSeries = null;

  if (oscMode === 'atr') {
    atrSeries = oscChart.addLineSeries({ color: OSC_COL.atr, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    atrHalfSeries = oscChart.addLineSeries({ color: OSC_COL.atrHalf, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true });   // ½ ATR (target distance)
  } else if (oscMode === 'rsi') {
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
  if (!rsiSeries && !macdLine && !atrSeries) oscBuildSeries();
  const hi = Math.min(idx, bars.length - 1), lo = revealStart(hi);   // mirror the price-series render window

  if (oscMode === 'atr' && atrSeries) {
    const d = [], dh = [];
    for (let i = lo; i <= hi; i++) if (oscAtr[i] != null) { d.push({ time: bars[i].time, value: oscAtr[i] }); dh.push({ time: bars[i].time, value: oscAtr[i] / 2 }); }
    atrSeries.setData(d); if (atrHalfSeries) atrHalfSeries.setData(dh);
  } else if (oscMode === 'rsi' && rsiSeries) {
    const d = [];
    for (let i = lo; i <= hi; i++) if (oscRsi[i] != null) d.push({ time: bars[i].time, value: oscRsi[i] });
    rsiSeries.setData(d);
  } else if (oscMode === 'macd' && macdLine) {
    const dl = [], ds = [], dh = [];
    for (let i = lo; i <= hi; i++) {
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
  if (oscMode === 'atr' && atrSeries) {
    if (oscAtr[i] != null) { atrSeries.update({ time: bars[i].time, value: oscAtr[i] }); if (atrHalfSeries) atrHalfSeries.update({ time: bars[i].time, value: oscAtr[i] / 2 }); }
  } else if (oscMode === 'rsi' && rsiSeries) {
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
  const tag = $('oscTag'); if (tag) tag.textContent = m === 'off' ? 'OSC' : (m === 'atr' ? 'ATR ' + atrLen : m.toUpperCase());
  if (m === 'off') {
    if (oscChart) { [rsiSeries, macdHist, macdLine, sigLine, atrSeries, atrHalfSeries].forEach(s => { if (s) try { oscChart.removeSeries(s); } catch (e) {} }); rsiSeries = macdHist = macdLine = sigLine = atrSeries = atrHalfSeries = null; }
    if ($('oscPane')) $('oscPane').style.display = 'none';
  } else {
    ensureOscChart(); oscBuildSeries(); oscHardReveal();
    // adopt the main chart's current visible range immediately
    oscSyncing = true; try { oscChart.timeScale().setVisibleLogicalRange(chart.timeScale().getVisibleLogicalRange()); } catch (e) {} oscSyncing = false;
  }
}

// ---- adjustable ATR period -----------------------------------------------
function setAtrLen(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1 || n > 200) { const inp = $('atrLen'); if (inp) inp.value = atrLen; return toast('ATR period 1–200'); }
  atrLen = n; saveJSON('rt_atr_len', n); oscAtr = computeATR(bars, atrLen);
  if (oscMode === 'atr') { oscHardReveal(); const t = $('oscTag'); if (t) t.textContent = 'ATR ' + n; }
  toast('ATR ' + n);
}

// ---- one-time wiring (call from wire()) ----------------------------------
function wireOsc() {
  const sel = $('oscSelect'); if (!sel) return;
  sel.value = oscMode;
  sel.onchange = (e) => setOscMode(e.target.value);
  const ai = $('atrLen'); if (ai) { ai.value = atrLen; ai.onchange = (e) => setAtrLen(e.target.value); }
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
let vwapOn = loadJSON('rt_vwap', false);
let bbOn   = loadJSON('rt_bb',   false);
let emaOn  = loadJSON('rt_ema',  true);
// Volume Profile trio (each {on,color}, individually toggleable/colorable):
//   P = PREV day's NY session 09:30–16:00 (PVAH/PPOC/PVAL) · O = OVERNIGHT 18:00→09:30 (OVAH/OPOC/OVAL) · D = DEVELOPING (live)
let vpP = Object.assign({ on: loadJSON('rt_vp', true), color: '#3b82f6' }, loadJSON('rt_vp_p', null));
let vpO = Object.assign({ on: true, color: '#26c6da' }, loadJSON('rt_vp_o', null));
let vpD = Object.assign({ on: loadJSON('rt_vp_today', true), color: '#f0b90b', align: 'right' }, loadJSON('rt_vp_d', null));   // align: 'right' = histogram hugs the right edge (TV-style), 'left' = anchored at session start
let vpPData = null, vpPKey = null, vpOData = null, vpOKey = null, vpDData = null, vpDEdge = -1;
let emaPeriods = (loadJSON('rt_ema_p', [10]) || [10])
  .filter(n => Number.isFinite(n) && n >= 1).slice(0, 6); // guard persisted value
const BB_PERIOD = 20, BB_MULT = 2;

// EMA ribbon colors (cool->warm as period grows; falls back to amber if list is longer)
const EMA_COLORS = ['#42a5f5', '#26a69a', '#2962ff', '#ef5350', '#ab47bc', '#787b86'];
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
  emaData = emaPeriods.map((p, i) => ({ period: p, color: EMA_COLORS[i] || '#787b86', arr: emaArr(c, p) }));
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
          // logical→absolute (windowed series); clamp to revealed bars too: don't draw indicator past idx during replay
          const from = seriesFrom + Math.max(0, Math.floor(range.from));
          const to = Math.min(bars.length - 1, idx, seriesFrom + Math.ceil(range.to));
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

// ---------- Volume Profile trio: PREV-day NY session + OVERNIGHT + DEVELOPING — POC + 70% value area ----------
const VP_MAX_BINS = 4000;   // tick-per-bin cap for pathological ranges (a 1000-pt NQ range = 4000 tick bins)
const vpRgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
const vpCol = (c, tag) => ({ fill: vpRgba(c, 0.10), fillVA: vpRgba(c, 0.26), poc: c, va: c, tag });   // one user color per profile; POC = thicker line
function buildProfile(idxs) {   // volume-by-price over the given base-bar indices → bins + POC + 70% value area
  if (!idxs.length) return null;   // a single bar is enough (hi>lo guard below) — today's profile shows from the very first RTH bar
  let lo = Infinity, hi = -Infinity;
  for (const i of idxs) { const b = baseBars[i]; if (b.low < lo) lo = b.low; if (b.high > hi) hi = b.high; }
  if (!(hi > lo)) return null;
  // MAX resolution: one bin per TICK level, so POC/VAH/VAL land on exact tick prices; uniform-bin fallback only for pathological ranges
  const tickBins = Math.round((hi - lo) / TICK) + 1, tickAligned = tickBins <= VP_MAX_BINS;
  const N = tickAligned ? tickBins : VP_MAX_BINS;
  const binH = tickAligned ? TICK : (hi - lo) / N, lo0 = tickAligned ? lo - TICK / 2 : lo;
  const binVol = new Array(N).fill(0);
  const binOf = (p) => Math.max(0, Math.min(N - 1, tickAligned ? Math.round((p - lo) / TICK) : Math.floor((p - lo) / binH)));
  for (const i of idxs) { const b = baseBars[i];
    const a = binOf(b.low), z = binOf(b.high);
    const per = (b.volume || 1) / (z - a + 1);
    for (let k = a; k <= z; k++) binVol[k] += per;
  }
  let pocIdx = 0; for (let k = 1; k < N; k++) if (binVol[k] > binVol[pocIdx]) pocIdx = k;
  const total = binVol.reduce((x, v) => x + v, 0), target = total * 0.7;
  let loI = pocIdx, hiI = pocIdx, acc = binVol[pocIdx];
  while (acc < target && (loI > 0 || hiI < N - 1)) { const up = hiI < N - 1 ? binVol[hiI + 1] : -1, dn = loI > 0 ? binVol[loI - 1] : -1; if (up >= dn) acc += binVol[++hiI]; else acc += binVol[--loI]; }
  const price = (k, edge) => tickAligned ? rnd(lo + k * TICK) : lo + (k + edge) * binH;   // tick bins → the exact tick level; uniform → old edge/center semantics
  return { binVol, N, lo: lo0, hi: lo0 + N * binH, binH, maxVol: Math.max(...binVol), vaLoIdx: loI, vaHiIdx: hiI,
    poc: price(pocIdx, 0.5), vah: price(hiI, 1), val: price(loI, 0) };
}
function rthIdxs(s, endI) { const e = endI == null ? s.end : Math.min(endI, s.end), out = []; for (let i = s.start; i <= e; i++) { const m = etMinutes(baseBars[i].time); if (m >= 570 && m < 960) out.push(i); } return out; }
function onIdxs(s, endI) {   // OVERNIGHT bars of session s: 18:00 evening (m>=1080) through 09:29 morning (m<570)
  const e = endI == null ? s.end : Math.min(endI, s.end), out = [];
  for (let i = s.start; i <= e; i++) { const m = etMinutes(baseBars[i].time); if (m >= 1080 || m < 570) out.push(i); else break; }   // bars are ordered evening→morning→RTH; first RTH bar ends the overnight
  return out;
}
const inOvernight = (m) => m >= 1080 || m < 570;
function computeVPPrev() {   // PREV day's NY-session profile — fixed reference for the current day (PVAH/PPOC/PVAL)
  vpPData = null;
  if (!vpP.on || sessions.length < 2 || !baseBars.length) return;
  const pi = currentSessionIdx() - 1; if (pi < 0) return;
  const s = sessions[pi];
  let idxs = rthIdxs(s); if (idxs.length < 5) { idxs = []; for (let i = s.start; i <= s.end; i++) idxs.push(i); }   // holiday → full session
  const prof = buildProfile(idxs); if (!prof) return;
  vpPData = Object.assign(prof, { rangeStartTime: baseBars[idxs[0]].time, key: s.key });
}
function computeVPO() {   // CURRENT session's overnight profile — fixed once the replay has reached the 09:30 open (OVAH/OPOC/OVAL)
  vpOData = null;
  if (!vpO.on || !sessions.length || !baseBars.length) return;
  const ci = currentSessionIdx(); if (ci < 0) return;
  const s = sessions[ci];
  if (inOvernight(etMinutes(curBaseT()))) return;   // still inside the overnight → the DEVELOPING profile covers it
  const idxs = onIdxs(s); const prof = buildProfile(idxs); if (!prof) return;
  vpOData = Object.assign(prof, { rangeStartTime: baseBars[idxs[0]].time, key: s.key });
}
function computeVPD() {   // DEVELOPING profile of the segment being replayed: overnight 18:00→now, or NY session 09:30→now
  vpDData = null;
  if (!vpD.on || !sessions.length || !baseBars.length) return;
  const ci = currentSessionIdx(); if (ci < 0) return;
  const s = sessions[ci];
  const idxs = inOvernight(etMinutes(curBaseT())) ? onIdxs(s, baseIdx) : rthIdxs(s, baseIdx);
  const prof = buildProfile(idxs); if (!prof) return;
  vpDData = Object.assign(prof, { rangeStartTime: baseBars[idxs[0]].time });
}
function maybeUpdateVP() {   // P on day change; O on day change or crossing the open; D whenever the revealed edge moves
  let dirty = false;
  const s = sessions[currentSessionIdx()];
  if (vpP.on) { const k = s ? s.key : null; if (k !== vpPKey) { vpPKey = k; computeVPPrev(); dirty = true; } }
  else if (vpPData) { vpPData = null; vpPKey = null; dirty = true; }
  if (vpO.on) { const k = s ? s.key + ':' + (baseBars.length ? !inOvernight(etMinutes(curBaseT())) : 0) : null; if (k !== vpOKey) { vpOKey = k; computeVPO(); dirty = true; } }
  else if (vpOData) { vpOData = null; vpOKey = null; dirty = true; }
  if (vpD.on) { if (baseIdx !== vpDEdge) { vpDEdge = baseIdx; computeVPD(); dirty = true; } }
  else if (vpDData) { vpDData = null; vpDEdge = -1; dirty = true; }
  if (dirty) { vpRepaint(); renderIndLegend(); }   // keep the on-chart legend in lockstep with the recomputed levels
}
function drawVPProfile(ctx, ts, paneW, prof, col, dashed, labelLeft, alignRight) {   // histogram + POC/VAH/VAL lines; alignRight = bars grow leftward from the right edge
  const y = p => candle.priceToCoordinate(p);
  const yLo = y(prof.lo), yHi = y(prof.hi);
  let xa = ts.timeToCoordinate(prof.rangeStartTime); if (xa == null) xa = 4; xa = Math.max(4, xa);
  if (yLo != null && yHi != null) {
    const binPx = (yLo - yHi) / prof.N, maxBarW = Math.min(150, paneW * 0.2);
    for (let k = 0; k < prof.N; k++) { const v = prof.binVol[k]; if (v <= 0) continue;
      const bw = (v / prof.maxVol) * maxBarW, yTop = y(prof.lo + (k + 1) * prof.binH);
      ctx.fillStyle = (k >= prof.vaLoIdx && k <= prof.vaHiIdx) ? col.fillVA : col.fill;
      ctx.fillRect(alignRight ? paneW - bw : xa, yTop, bw, Math.max(1, binPx - 1)); }
  }
  const drawLine = (price, color, w, label) => { const yy = y(price); if (yy == null) return;
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dashed ? [5, 3] : []); ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(paneW, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '700 10px ui-monospace,monospace'; const txt = `${label} ${f2(price)}`, tw = ctx.measureText(txt).width + 8, lx = labelLeft ? xa + 2 : paneW - tw - 2;
    rrect(ctx, lx, yy - 7, tw, 14, 3); ctx.fillStyle = color; ctx.fill(); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(txt, lx + 4, yy); };
  drawLine(prof.vah, col.va, 1.2, col.tag + 'VAH');
  drawLine(prof.val, col.va, 1.2, col.tag + 'VAL');
  drawLine(prof.poc, col.poc, 1.8, col.tag + 'POC');
}
const vpPrimitive = {
  attached(p) { this._req = () => p.requestUpdate(); },   // wrap: keep p as receiver so the repaint request can't lose its binding
  updateAllViews() {},
  paneViews: () => [{ zOrder: () => 'bottom', renderer: () => ({ draw: (target) => {
    if ((!vpP.on || !vpPData) && (!vpO.on || !vpOData) && (!vpD.on || !vpDData)) return;
    try {
      target.useMediaCoordinateSpace((scope) => {
        const ctx = scope.context, ts = chart.timeScale(), paneW = (scope.mediaSize && scope.mediaSize.width) || 99999;
        if (vpP.on && vpPData) drawVPProfile(ctx, ts, paneW, vpPData, vpCol(vpP.color, 'P'), false, false);   // prev NY session: solid, labels at the right end
        if (vpO.on && vpOData) drawVPProfile(ctx, ts, paneW, vpOData, vpCol(vpO.color, 'O'), false, false);   // overnight: solid, labels at the right end
        if (vpD.on && vpDData) drawVPProfile(ctx, ts, paneW, vpDData, vpCol(vpD.color, 'd'), true, false, (vpD.align || 'right') === 'right');   // developing: dashed, labels right; histogram side user-selectable
      });
      window.__vp = { n: ((window.__vp || {}).n || 0) + 1, ok: true };
    } catch (e) { window.__vp = { err: String(e) }; }
  } }) }],
};
if (candle.attachPrimitive) candle.attachPrimitive(vpPrimitive);
function vpRepaint() { if (vpPrimitive._req) vpPrimitive._req(); }
function setVpCfg(which, patch) {   // which: 'p'|'o'|'d' — toggle or recolor one profile, persist, recompute, repaint
  const cfg = which === 'p' ? vpP : which === 'o' ? vpO : vpD;
  Object.assign(cfg, patch); saveJSON('rt_vp_' + which, cfg);
  vpPKey = null; vpOKey = null; vpDEdge = -1;
  maybeUpdateVP(); vpRepaint(); renderIndLegend();
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
            for (const pt of hs) { const hx = X(pt.t), hy = Y(pt.p); if (hx == null || hy == null) continue; ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, 7); ctx.fillStyle = '#000000'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = d.color || '#d1d4dc'; ctx.stroke(); }
          }
          // selected drawing: emphasise its anchors in brand amber (signals selected + draggable + deletable)
          if (selDrawing && drawings.includes(selDrawing)) {
            const d = selDrawing, hpts = [];
            if (d.type === 'hl') hpts.push({ t: null, p: d.p1.p });
            else if (d.type === 'rr') { hpts.push({ t: d.p1.t, p: d.p1.p }, { t: d.p1.t, p: d.stop }, { t: d.p1.t, p: d.target }); }
            else { if (d.p1) hpts.push(d.p1); if (d.p2) hpts.push(d.p2); }
            for (const pt of hpts) { const hx = pt.t == null ? W / 2 : X(pt.t), hy = Y(pt.p); if (hx == null || hy == null) continue; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, 7); ctx.fillStyle = '#fcd535'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000000'; ctx.stroke(); }
          }
          if (pendingPt) { const x = X(pendingPt.t), y = Y(pendingPt.p); if (x != null && y != null) { ctx.fillStyle = '#2962ff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); } }
        });
        window.__drw = { n: ((window.__drw || {}).n || 0) + 1, ok: true };
      } catch (e) { window.__drw = { err: String(e) }; }
    } })
  }],
};
if (candle.attachPrimitive) candle.attachPrimitive(drawingsPrimitive);

// ---------- Tradovate-style order bracket: full-width lines + draggable tags w/ live $ + cancel ✕ ----------
let orderHits = [];   // tag cancel hit-boxes captured each paint: {spec, x, y, w, h}
function orderLines() {   // single source for drawing AND dragging (entry / stop / targets)
  const out = [];
  if (entryOrder) {
    const long = entryOrder.side === 'long', q = entryOrder.mult || 1;
    out.push({ price: entryOrder.price, color: '#2962ff', label: `${long ? 'BUY' : 'SELL'} ${entryOrder.kind === 'limit' ? 'LMT' : 'STP'}`, qty: q, cancel: 'entry',
               drag: { get: () => entryOrder.price, set: p => entryOrder.price = p } });
    if (entryOrder.struct) {   // structural preview (computed from the current bar; not independently draggable)
      const sp = structStopPx(side, entryOrder.price, atm[entryOrder.atm] || atm[activeAtm] || {}), risk = Math.abs(entryOrder.price - sp);
      out.push({ price: sp, color: '#ef5350', label: 'STOP', qty: q, ref: entryOrder.price });
      out.push({ price: rnd(long ? entryOrder.price + risk : entryOrder.price - risk), color: '#26a69a', label: 'TGT', qty: q, ref: entryOrder.price });
    } else {
      if (entryOrder.slTicks > 0) out.push({ price: rnd(long ? entryOrder.price - entryOrder.slTicks * TICK : entryOrder.price + entryOrder.slTicks * TICK), color: '#ef5350', label: 'STOP', qty: q, ref: entryOrder.price,
        drag: { get: () => rnd(long ? entryOrder.price - entryOrder.slTicks * TICK : entryOrder.price + entryOrder.slTicks * TICK), set: p => { entryOrder.slTicks = Math.max(1, Math.round(Math.abs(entryOrder.price - p) / TICK)); } } });
      (entryOrder.tgts || []).forEach((tg, i) => { if (tg.ticks > 0) out.push({ price: rnd(long ? entryOrder.price + tg.ticks * TICK : entryOrder.price - tg.ticks * TICK), color: '#26a69a', label: 'TGT' + (entryOrder.tgts.length > 1 ? (i + 1) : ''), qty: tg.qty, ref: entryOrder.price,
        drag: { get: () => rnd(long ? entryOrder.price + tg.ticks * TICK : entryOrder.price - tg.ticks * TICK), set: p => { tg.ticks = Math.max(1, Math.round(Math.abs(p - entryOrder.price) / TICK)); } } }); });
    }
  }
  if (position) {
    const long = position.side === 'long';
    const uT = long ? tcount(curPx(), position.entry) : tcount(position.entry, curPx());
    out.push({ price: position.entry, color: '#2962ff', label: `${long ? 'LONG' : 'SHORT'} ${position.qty}`, pnl: uT * INSTR.tickValue * position.qty, posEntry: true });
    orders.forEach((o, i) => out.push(o.type === 'stop'
      ? { price: o.price, color: '#ef5350', label: 'STOP', qty: o.qty, ref: position.entry, cancel: i, drag: { get: () => o.price, set: p => o.price = p } }
      : { price: o.price, color: '#26a69a', label: 'TGT', qty: o.qty, ref: position.entry, cancel: i, drag: { get: () => o.price, set: p => o.price = p } }));
  }
  return out;
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawOrderBrackets(ctx, W) {
  orderHits = []; const ols = orderLines(); if (!ols.length) return;
  const FONT = '-apple-system,Segoe UI,Roboto,sans-serif', h = 17, PAD = 7, GAP = 9, XW = 17;
  ctx.save(); ctx.textBaseline = 'middle';
  for (const o of ols) {
    const y = candle.priceToCoordinate(o.price); if (y == null) continue;
    const yr = Math.round(y);
    const segs = [o.label + (o.qty ? '  ×' + o.qty : '')];
    if (o.ref != null) { const d = Math.abs(tcount(o.price, o.ref)) * INSTR.tickValue * (o.qty || 1); segs.push((o.color === '#ef5350' ? '−$' : '+$') + d.toFixed(0)); }
    else if (o.pnl != null) segs.push((o.pnl >= 0 ? '+$' : '−$') + Math.abs(o.pnl).toFixed(0));
    segs.push(f2(o.price));
    ctx.font = '600 11px ' + FONT;
    const wseg = segs.map(s => ctx.measureText(s).width);
    const hasX = o.cancel != null;
    const tw = PAD + wseg.reduce((a, b) => a + b, 0) + GAP * (segs.length - 1) + (hasX ? GAP - 2 + XW : PAD);
    const right = W - 3, left = right - tw, top = yr - (h >> 1);
    ctx.strokeStyle = o.color; ctx.lineWidth = 1; ctx.setLineDash(o.posEntry || o.cancel === 'entry' ? [2, 3] : [6, 3]);
    ctx.beginPath(); ctx.moveTo(0, yr + 0.5); ctx.lineTo(left - 2, yr + 0.5); ctx.stroke(); ctx.setLineDash([]);
    rrect(ctx, left, top, tw, h, 3); ctx.fillStyle = o.color; ctx.globalAlpha = 0.96; ctx.fill(); ctx.globalAlpha = 1;
    let cx = left + PAD; const cy = top + h / 2 + 0.5;
    segs.forEach((s, i) => { ctx.fillStyle = '#fff'; ctx.font = (i === segs.length - 1 ? '700 11px ' : '600 11px ') + FONT; ctx.fillText(s, cx, cy); cx += wseg[i] + GAP; });
    if (hasX) { const bx = right - XW;
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, top + 3); ctx.lineTo(bx, top + h - 3); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; const m = 5; ctx.beginPath(); ctx.moveTo(bx + m, top + m); ctx.lineTo(bx + XW - m, top + h - m); ctx.moveTo(bx + XW - m, top + m); ctx.lineTo(bx + m, top + h - m); ctx.stroke();
      orderHits.push({ spec: o.cancel, x: bx, y: top, w: XW, h }); }
  }
  ctx.restore();
}
const orderPrimitive = {
  attached(p) { this._req = p.requestUpdate; },
  updateAllViews() {},
  paneViews: () => [{ zOrder: () => 'top', renderer: () => ({ draw: (target) => {
    try { target.useMediaCoordinateSpace((scope) => drawOrderBrackets(scope.context, scope.mediaSize.width)); window.__ord = { n: ((window.__ord || {}).n || 0) + 1, ok: true }; }
    catch (e) { window.__ord = { err: String(e) }; }
  } }) }],
};
if (candle.attachPrimitive) candle.attachPrimitive(orderPrimitive);
function orderRepaint() { if (orderPrimitive._req) orderPrimitive._req(); }
function orderCancelAt(x, y) { for (const hb of orderHits) { if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) return hb.spec; } return null; }
function repaintOverlays() { if (ripsterPrimitive._req) ripsterPrimitive._req(); if (drawingsPrimitive._req) drawingsPrimitive._req(); indicatorRepaint(); orderRepaint(); }
function handleDrawClick(t, time, price) {
  price = magnetPrice(time, price);   // magnet on -> snap to nearest OHLC; off -> rnd(price)
  if (t === 'hl') { drawings.push({ type: 'hl', p1: { t: time, p: price }, color: '#d1d4dc' }); selDrawing = drawings[drawings.length - 1]; saveJSON('rt_drawings', drawings); repaintOverlays(); resetToolAfterDraw(); return; }
  if (t === 'rr') {   // Long/Short position — ONE click: entry here, default risk below, target at 2R (then drag to adjust)
    const entry = price, riskT = rrDefaultRiskTicks();
    const stop = rnd(entry - riskT * TICK), target = rnd(entry + riskT * RR_DEFAULT * TICK);
    const ci = bars.findIndex(b => b.time === time), hi = Math.min(idx, bars.length - 1);
    const rb = bars[Math.max(0, Math.min(hi, (ci < 0 ? hi : ci) + 20))];
    drawings.push({ type: 'rr', p1: { t: time, p: entry }, p2: { t: rb ? rb.time : time, p: entry }, stop, target, color: '#fcd535' });
    selDrawing = drawings[drawings.length - 1]; saveJSON('rt_drawings', drawings); repaintOverlays(); resetToolAfterDraw(); return;
  }
  if (!pendingPt) { pendingPt = { t: time, p: price }; repaintOverlays(); toast('Click the second point'); return; }
  drawings.push({ type: t, p1: pendingPt, p2: { t: time, p: price }, color: t === 'box' ? '#2962ff' : t === 'fib' ? '#fcd535' : '#d1d4dc' });
  pendingPt = null; selDrawing = drawings[drawings.length - 1]; saveJSON('rt_drawings', drawings); repaintOverlays(); resetToolAfterDraw();
}
function clearDrawings() {   // wipe everything drawn with the toolbar: lines / rays / h-lines / boxes / fib / measure / R:R AND the up/down/long/short arrow markers
  const n = drawings.length + annotations.length;
  if (!n) return toast('No drawings to clear');
  if (!confirm(`Clear all ${n} drawing${n === 1 ? '' : 's'} (lines, shapes, arrows) from the chart?`)) return;
  drawings = []; pendingPt = null; selDrawing = null; annotations = [];
  saveJSON('rt_drawings', drawings); saveJSON('rt_annotations', annotations);
  repaintOverlays(); refreshMarkers(); toast(`Cleared ${n} drawing${n === 1 ? '' : 's'}`);
}
// ---- Fibonacci retracement (drawing type 'fib', 2-point) ----
const FIB_LEVELS = [
  { lv: 0, c: '#787b86' }, { lv: 0.236, c: '#ef5350' }, { lv: 0.382, c: '#ff9f0a' }, { lv: 0.5, c: '#fcd535' },
  { lv: 0.618, c: '#26a69a' }, { lv: 0.786, c: '#22c55e' }, { lv: 1, c: '#787b86' }, { lv: 1.272, c: '#3b82f6' }, { lv: 1.618, c: '#7c5cff' },
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
  const bx = Math.min(x1, x2), by = Math.min(y1, y2), bw = Math.max(1, Math.abs(x2 - x1)), bh = Math.max(1, Math.abs(y2 - y1)), col = up ? '#26a69a' : '#ef5350';
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
  ctx.fillStyle = '#161616'; ctx.globalAlpha = 0.92;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 5); ctx.fill(); } else ctx.fillRect(px, py, pillW, pillH);
  ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(px, py, pillW, pillH, 5); ctx.stroke(); } else ctx.strokeRect(px, py, pillW, pillH);
  ctx.fillStyle = '#d1d4dc'; ctx.textAlign = 'left'; ctx.fillText(label, px + padX, py + pillH / 2 + 0.5);
  ctx.restore();
}
// ---- Long/Short position R:R tool (drawing type 'rr') — entry / stop / target zones + R:R ----
const RR_DEFAULT = 2, RR_BOXW = 300;   // default reward = 2R; default box width (px) when no explicit right edge
function rrRange(d, X) {                // box left/right x (px); falls back to a fixed width near the live edge
  const xe = X(d.p1.t), xa = (xe == null || !isFinite(xe)) ? 0 : xe;
  let xb = d.p2 ? X(d.p2.t) : null;
  if (xb == null || !isFinite(xb) || xb <= xa + 8) xb = xa + RR_BOXW;
  return { xa, xb };
}
function rrDefaultRiskTicks() {          // a visible default = ~25% of the last 30 revealed bars' range
  const lo0 = Math.max(0, idx - 30); let hi = -Infinity, lo = Infinity;
  for (let i = lo0; i <= idx && i < bars.length; i++) { hi = Math.max(hi, bars[i].high); lo = Math.min(lo, bars[i].low); }
  const range = (isFinite(hi) && isFinite(lo)) ? hi - lo : 0;
  return Math.max(8, Math.round((range * 0.25) / TICK) || 8);
}
function drawRR(ctx, d, X, Y, W) {
  const ye = Y(d.p1.p), ys = Y(d.stop), yt = Y(d.target);
  if (ye == null || ys == null || yt == null) return;
  const { xa, xb } = rrRange(d, X), w = Math.max(2, xb - xa), cx = (xa + xb) / 2;
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#26a69a'; ctx.fillRect(xa, Math.min(ye, yt), w, Math.abs(yt - ye));   // reward zone
  ctx.fillStyle = '#ef5350'; ctx.fillRect(xa, Math.min(ye, ys), w, Math.abs(ys - ye));   // risk zone
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(120,130,150,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(xa, Math.min(yt, ys), w, Math.abs(yt - ys));
  const hline = (yy, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xa, yy); ctx.lineTo(xb, yy); ctx.stroke(); };
  hline(yt, '#26a69a'); hline(ys, '#ef5350');
  ctx.setLineDash([5, 3]); hline(ye, '#d1d4dc'); ctx.setLineDash([]);
  // blue handles — squares at the 4 box corners, circles at the entry edges
  const sq = (x, y) => { ctx.fillStyle = '#3b82f6'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 1.5; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); };
  const ci = (x, y) => { ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fillStyle = '#3b82f6'; ctx.fill(); ctx.strokeStyle = '#000000'; ctx.lineWidth = 1.5; ctx.stroke(); };
  sq(xa, yt); sq(xb, yt); sq(xa, ys); sq(xb, ys); ci(xa, ye); ci(xb, ye);
  // metrics + centered label pills — matches TradingView's Long/Short position tool
  const qty = Math.max(1, parseInt(($('qty') || {}).value, 10) || 1);
  const long = d.target >= d.p1.p, pv = INSTR.tickValue / INSTR.tickSize;          // $ per point
  const riskT = Math.abs(tcount(d.p1.p, d.stop)), rewT = Math.abs(tcount(d.target, d.p1.p));
  const rr = riskT > 0 ? rewT / riskT : 0;
  const tPct = d.p1.p ? (d.target - d.p1.p) / d.p1.p * 100 : 0, sPct = d.p1.p ? (d.stop - d.p1.p) / d.p1.p * 100 : 0;
  const tPts = Math.abs(d.target - d.p1.p), sPts = Math.abs(d.p1.p - d.stop);
  const cur = (typeof curPx === 'function' && baseBars.length) ? curPx() : d.p1.p;
  const openPnl = (long ? cur - d.p1.p : d.p1.p - cur) * pv * qty;                  // P&L if entered at the entry line, marked at the live bar
  const sgn = v => (v >= 0 ? '+' : '');
  const pill = (text, y, bg, fg) => {
    ctx.font = '600 11px ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const lines = String(text).split('\n'); let tw = 0; for (const ln of lines) tw = Math.max(tw, ctx.measureText(ln).width);
    const padX = 9, lh = 14, pw = tw + padX * 2, ph = lines.length * lh + 8;
    const px = Math.max(2, Math.min(cx - pw / 2, W - pw - 2)), py = y - ph / 2;
    ctx.globalAlpha = 0.94; ctx.fillStyle = bg;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 5); ctx.fill(); } else ctx.fillRect(px, py, pw, ph);
    ctx.globalAlpha = 1; ctx.fillStyle = fg;
    lines.forEach((ln, i) => ctx.fillText(ln, px + pw / 2, py + 4 + lh / 2 + i * lh));
  };
  pill(`Target: ${f2(d.target)} (${sgn(tPct)}${tPct.toFixed(2)}%) ${tPts.toFixed(2)}, Amount: ${usd(rewT * INSTR.tickValue * qty)}`, yt, '#0b3b2a', '#26a69a');
  pill(`Open PnL: ${usd(openPnl)}, Qty: ${qty}\nRisk/reward ratio: ${rr.toFixed(2)}`, ye, '#161616', '#d1d4dc');
  pill(`Stop: ${f2(d.stop)} (${sgn(sPct)}${sPct.toFixed(2)}%) ${sPts.toFixed(2)}, Amount: ${usd(riskT * INSTR.tickValue * qty)}`, ys, '#3b1418', '#ef5350');
  ctx.restore();
}
function resetToolAfterDraw() { tool = ''; pendingPt = null; updateToolUI(); }   // revert to cursor after a completed drawing (TradingView default)

// ---------- chart tools: drag stop/target/entry lines + click tools (set-start / annotations) ----------
let tool = '', drag = null, dragH = null;   // dragH = drawing-anchor being dragged (endpoint edit)
let vpan = null;                            // vertical price-pan: {y0, s0} while dragging empty chart space up/down
let magnet = loadJSON('rt_magnet', false);  // snap drawing points to the nearest OHLC of the hovered bar (TradingView magnet)
function barByTime(t) { let lo = 0, hi = bars.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time === t) return bars[m]; if (bars[m].time < t) lo = m + 1; else hi = m - 1; } return null; }
function magnetPrice(time, raw) {
  if (!magnet) return rnd(raw);
  const b = barByTime(time); if (!b) return rnd(raw);
  let best = b.close, bd = Infinity;
  for (const v of [b.open, b.high, b.low, b.close]) { const d = Math.abs(v - raw); if (d < bd) { bd = d; best = v; } }
  return rnd(best);
}
let dragBody = null, selDrawing = null;     // dragBody = whole-drawing move; selDrawing = currently selected drawing
let annotations = loadJSON('rt_annotations', []);   // {baseTime, position, color, shape, text}
let drawings = loadJSON('rt_drawings', []);         // {type:'hl'|'tl'|'ray'|'box', p1:{t,p}, p2?:{t,p}, color}
let pendingPt = null;                                // first click of a 2-point drawing
const ANN = {
  au:    { position: 'belowBar', color: '#26a69a', shape: 'arrowUp',   text: '' },
  ad:    { position: 'aboveBar', color: '#ef5350', shape: 'arrowDown', text: '' },
  long:  { position: 'belowBar', color: '#26a69a', shape: 'arrowUp',   text: 'LONG' },
  short: { position: 'aboveBar', color: '#ef5350', shape: 'arrowDown', text: 'SHORT' },
};
const TOOLBTN = { start: 'btnPickStart', au: 'annUp', ad: 'annDown', long: 'annLong', short: 'annShort', hl: 'drwHL', tl: 'drwTL', ray: 'drwRay', box: 'drwBox', fib: 'drwFib', measure: 'drwMeasure', rr: 'drwRR' };
function placeAnnotation(t, baseTime) { const a = ANN[t]; if (!a) return; annotations.push({ baseTime, ...a }); saveJSON('rt_annotations', annotations); refreshMarkers(); }
function clearAnnotations() { annotations = []; markers = []; saveJSON('rt_annotations', annotations); refreshMarkers(); toast('Markers cleared'); }   // clears placed arrows AND in-session trade entry/exit arrows
// click directly on a placed arrow (annotation OR trade marker) to delete just that one — TradingView-style
function markerXY(m) {
  const t = mBucket(m.baseTime), x = chart.timeScale().timeToCoordinate(t); if (x == null) return null;
  let b = null; for (let k = Math.min(idx, bars.length - 1); k >= 0; k--) { if (bars[k].time <= t) { b = bars[k]; break; } }
  if (!b) b = bars[Math.min(idx, bars.length - 1)]; if (!b) return null;
  const yEdge = candle.priceToCoordinate(m.position === 'belowBar' ? b.low : b.high); if (yEdge == null) return null;
  return { x, y: yEdge + (m.position === 'belowBar' ? 14 : -14) };
}
function markerAt(px, py) {
  const all = annotations.map((a, i) => ({ a, i, src: 'ann' })).concat(markers.map((a, i) => ({ a, i, src: 'mk' })));
  for (let j = all.length - 1; j >= 0; j--) { const p = markerXY(all[j].a); if (p && Math.abs(p.x - px) <= 13 && Math.abs(p.y - py) <= 16) return all[j]; }
  return null;
}
function removeMarker(hit) {
  if (hit.src === 'ann') { annotations.splice(hit.i, 1); saveJSON('rt_annotations', annotations); } else markers.splice(hit.i, 1);
  refreshMarkers(); toast('Arrow removed');
}
function updateToolUI() { Object.values(TOOLBTN).forEach(id => { const b = $(id); if (b) b.classList.remove('active'); }); const b = $(TOOLBTN[tool]); if (b) b.classList.add('active'); const cur = $('toolCursor'); if (cur) cur.classList.toggle('active', !tool); $('chart').style.cursor = tool ? 'crosshair' : ''; }
function setTool(t) { tool = (tool === t) ? '' : t; pendingPt = null; repaintOverlays(); updateToolUI(); }
function draggableLines() { return orderLines().filter(o => o.drag).map(o => o.drag); }   // derived from the rendered order set (entry / stop / targets)
function nearestLine(y) { let best = null, bd = 7; for (const L of draggableLines()) { const ly = candle.priceToCoordinate(L.get()); if (ly == null) continue; const d = Math.abs(ly - y); if (d < bd) { bd = d; best = L; } } return best; }
// ---- drawing endpoint editing: hit-test + drag the anchors of placed drawings ----
// Each handle exposes apply(time, price) that writes back into the drawing's p1/p2 in place.
// HL = horizontal full-width line, so only price is editable (horiz:true, time ignored).
function drawingHandles() {
  const out = [], ts = chart.timeScale();
  const X = (t) => ts.timeToCoordinate(t), Y = (p) => candle.priceToCoordinate(p);
  for (const d of drawings) {
    if (d.type === 'hl') { const y = Y(d.p1.p); if (y != null) out.push({ d, horiz: true, hy: y, apply: (t, p) => { d.p1.p = p; } }); continue; }
    if (d.type === 'rr') {   // entry handle shifts all 3 levels; stop/target move individually; grabbable at both box edges
      const { xa, xb } = rrRange(d, X), eY = Y(d.p1.p), sY = Y(d.stop), tY = Y(d.target);
      [xa, xb].forEach(hx => {
        if (eY != null) out.push({ d, hx, hy: eY, apply: (t, p) => { const dp = p - d.p1.p; d.p1.p = p; d.stop += dp; d.target += dp; } });
        if (sY != null) out.push({ d, hx, hy: sY, apply: (t, p) => { d.stop = p; } });
        if (tY != null) out.push({ d, hx, hy: tY, apply: (t, p) => { d.target = p; } });
      });
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
    if (d.type === 'rr') { const { xa, xb } = rrRange(d, X); if (x < xa - 4 || x > xb + 4) continue; const yt = Y(d.target), ys = Y(d.stop); if (yt != null && ys != null && y >= Math.min(yt, ys) - TH && y <= Math.max(yt, ys) + TH) return d; continue; }
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
  if (d.type === 'rr') { A.push({ obj: d.p1, key: 'p', kind: 'p' }, { obj: d, key: 'stop', kind: 'p' }, { obj: d, key: 'target', kind: 'p' }, { obj: d.p1, key: 't', kind: 't' }); if (d.p2) A.push({ obj: d.p2, key: 't', kind: 't' }); return A; }
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
  let i = Math.round(lg) + seriesFrom; i = Math.max(0, Math.min(Math.min(idx, bars.length - 1), i));   // logical→absolute (windowed series)
  return bars[i] ? bars[i].time : null;
}
chart.subscribeClick(param => {
  if (!tool || param.time == null) return;
  const i = bars.findIndex(b => b.time === param.time);
  if (i < 0) return;
  if (tool === 'start') { if (!locked()) setStart(bars[i].subEnd); tool = ''; updateToolUI(); return; }
  if (tool === 'au' || tool === 'ad' || tool === 'long' || tool === 'short') { placeAnnotation(tool, bars[i].time); resetToolAfterDraw(); return; }
  const price = param.point ? candle.coordinateToPrice(param.point.y) : bars[i].close;   // hl / tl / ray / box
  if (price != null) handleDrawClick(tool, param.time, price);
});
$('chart').addEventListener('mousedown', e => {
  if (e.button !== 0 || tool) return;             // left-button only; while a tool is armed, clicks place points
  const rect = $('chart').getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const _ocx = orderCancelAt(x, y); if (_ocx != null) { cancelOrder(_ocx); e.preventDefault(); return; }   // ✕ on an order tag → cancel that order
  const _mk = markerAt(x, y); if (_mk) { removeMarker(_mk); e.preventDefault(); return; }   // click an arrow marker → delete just that one
  const h = nearestHandle(x, y);                  // 1) drawing anchor (endpoint) — most specific; also selects it
  if (h) { dragH = h; selDrawing = h.d; chart.applyOptions({ handleScroll: false, handleScale: false }); repaintOverlays(); e.preventDefault(); return; }
  const hd = drawingAt(x, y);                     // 2) drawing body — select + move the whole drawing
  if (hd) { selDrawing = hd; startBodyDrag(hd, x, y); chart.applyOptions({ handleScroll: false, handleScale: false }); repaintOverlays(); e.preventDefault(); return; }
  if (locked()) { const L = nearestLine(y); if (L) { drag = L; chart.applyOptions({ handleScroll: false, handleScale: false }); e.preventDefault(); return; } }  // 3) stop/target/entry lines
  if (selDrawing) { selDrawing = null; repaintOverlays(); }   // 4) empty space -> deselect (lets the chart pan)
  if (!overPriceAxis(e.clientX)) vpan = { lx: x, ly: y };   // 5) start a free pan — price follows vertical motion, LWC pans time horizontally (never locked)
});
window.addEventListener('mousemove', e => {
  const rect = $('chart').getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (dragH) {                                    // editing a drawing endpoint: snap price to tick, time to bar grid
    const p = candle.coordinateToPrice(y);
    if (p != null) { const st = xToTime(x); dragH.apply(dragH.horiz ? null : st, magnetPrice(st, p)); repaintOverlays(); }
    return;
  }
  if (dragBody) { moveBody(x, y); return; }       // moving a whole drawing
  if (vpan && !drag && !dragH) {                   // free 2D pan: price follows vertical motion (1:1), LWC pans time on horizontal motion — both work, neither locked
    const idy = y - vpan.ly, idx = x - vpan.lx; vpan.lx = x; vpan.ly = y;
    if (idy !== 0 && Math.abs(idy) >= Math.abs(idx)) { priceAuto = false; pxShift += idy / ($('chart').clientHeight || 1); applyPriceZoom(); }
  }
  if (!drag) return;
  const p = candle.coordinateToPrice(y);
  if (p != null) { drag.set(rnd(p)); drawLines(); renderLive(); }
});
window.addEventListener('mouseup', () => {
  vpan = null;
  if (dragH) { dragH = null; saveJSON('rt_drawings', drawings); chart.applyOptions({ handleScroll: true, handleScale: true }); return; }
  if (dragBody) { dragBody = null; saveJSON('rt_drawings', drawings); chart.applyOptions({ handleScroll: true, handleScale: true }); return; }
  if (drag) { drag = null; chart.applyOptions({ handleScroll: true, handleScale: true }); }
});
$('chart').addEventListener('mousemove', e => {
  if (drag || dragH || dragBody) return;
  if (tool) { $('chart').style.cursor = 'crosshair'; return; }
  const rect = $('chart').getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (nearestHandle(x, y) || drawingAt(x, y)) { $('chart').style.cursor = 'move'; return; }   // hovering a drawing/anchor
  if (orderCancelAt(x, y) != null) { $('chart').style.cursor = 'pointer'; return; }            // hovering an order ✕
  $('chart').style.cursor = (locked() && nearestLine(y)) ? 'ns-resize' : '';
});

// ---------- timeframe aggregation ----------
function aggregate(base, m) {
  if (!tickMode && m === BASE_TF) return base.map((b, i) => ({ ...b, subStart: i, subEnd: i }));   // tick mode always buckets (base = individual prints → never 1:1, would collide on shared seconds)
  const out = []; let cur = null; const span = Math.round(m * 60);   // integer seconds — avoids float drift on 20s (=1/3 min)
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
const CT_UP = '#26a69a', CT_DOWN = '#ef5350', CT_LINE = '#fcd535', CT_TXT = '#d1d4dc';
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
  if (chartType === 'cont') {
    // "gapless": draw the body starting at the PREVIOUS bar's close instead of this bar's real open.
    // Purely cosmetic — bars[]/baseBars[] and every fill in the trading engine keep the real open,
    // so P&L is unaffected. Exists because NQ's real open is ~2 ticks off the prior close (bid/ask
    // bounce over the ~180ms between those two trades); verified real against Databento OHLCV,
    // Yahoo 1m AND raw trades, so it is the tape, not a data defect. high/low are widened to cover
    // the stitched open, otherwise the body would stick out past the wick.
    const prev = bars[b.__i - 1], o = prev ? prev.close : b.open;   // __i stamped in rebuildTf()
    return { time: b.time, open: o, high: Math.max(b.high, o), low: Math.min(b.low, o), close: b.close };
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
    case 'cont':
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

  // 3) re-feed exactly what is currently revealed within the render window (idx = last revealed TF bar)
  seriesFrom = revealStart(idx);
  candle.setData(bars.slice(seriesFrom, idx + 1).map(cd));

  // 4) re-attach overlays. Primitives read `candle` via closure, so after the
  //    reassignment above they already point at the new series; we just need to
  //    bind them to the new series object and force a repaint.
  if (candle.attachPrimitive) {
    candle.attachPrimitive(vpPrimitive);
    candle.attachPrimitive(ripsterPrimitive);
    candle.attachPrimitive(indicatorPrimitive);
    candle.attachPrimitive(drawingsPrimitive);
    candle.attachPrimitive(orderPrimitive);
    candle.attachPrimitive(alertLinePrimitive);
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
function vd(b) { return { time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(38,166,154,.5)' : 'rgba(239,83,80,.5)' }; }
const mBucket = (ts) => { const sp = Math.round(tf * 60); return Math.floor(ts / sp) * sp; };

// ---------- init ----------
init();
async function init() { buildDataSelect(); initLayout(); await loadDataset(DATASETS[0]); }

function detectBaseTf(b) { let mn = Infinity; for (let i = 1; i < Math.min(b.length, 800); i++) { const dl = b[i].time - b[i - 1].time; if (dl > 0 && dl < mn) mn = dl; } return mn === Infinity ? 1 : Math.max(1 / 60, mn / 60); }  // floor 1s so 15s/30s bases detect correctly
function buildTfOptions() { const bs = Math.round(BASE_TF * 60); TF_OPTIONS = [BASE_TF, ...STD_TF.filter(m => m > BASE_TF && Math.round(m * 60) % bs === 0)]; }   // only clean multiples of the base (so 20s never shows on a 15s base, etc.)

function showLoading(on, msg) {
  let el = document.getElementById('loadingOverlay');
  if (on) {
    if (!el) { el = document.createElement('div'); el.id = 'loadingOverlay'; el.innerHTML = '<div class="ld-box"><div class="ld-spin"></div><span class="ld-txt"></span></div>'; document.body.appendChild(el); }
    el.querySelector('.ld-txt').textContent = msg || 'Loading…'; el.style.display = 'flex';
  } else if (el) { el.style.display = 'none'; }
}

async function loadDataset(ds) {
  if (ds && ds.tick) return enterTickMode(ds);          // Tradovate-style per-day tick replay
  if (ds && ds.deep) return enterDeepMode(ds);          // GitHub-safe monthly-chunked deep 15s history, loaded on demand
  tickMode = false; deepMode = false; setSpeedOptions(false);
  const url = typeof ds === 'string' ? ds : ds.url;   // tolerate a bare url too
  let data;
  showLoading(true, 'Loading market data…');
  // Cache-bust once per DAY, not per load: reloads within the same day hit the browser/CDN
  // cache (no re-download of ~5.6 MB, no re-parse of 360k bars); the daily data refresh is
  // still picked up the next day. Date.now() here defeated caching entirely on every load.
  try { const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + new Date().toISOString().slice(0, 10)); if (!r.ok) throw 0; data = await r.json(); }
  catch (e) { showLoading(false); toast('This dataset is not ready yet'); return false; }
  pause(); position = null; entryOrder = null; orders = []; markers = []; tool = ''; pendingPt = null;
  if (ds && ds.instr) { INSTR = ds.instr; TICK = INSTR.tickSize; }   // switch active contract spec (tick grid + $/tick + symbol)
  if ($('symbol')) $('symbol').textContent = INSTR.symbol;
  if ($('entryPrice')) $('entryPrice').step = String(TICK);
  finishLoad(data, ds);
  showLoading(false);
  return true;
}
function finishLoad(data, ds) {   // shared tail of loadDataset() / loadDeepMonth(): data is already fetched, INSTR/TICK already set
  baseBars = data;
  BASE_TF = (ds && ds.base) || detectBaseTf(baseBars); buildTfOptions();   // ds.base = explicit base resolution (min) for clean sub-minute sets
  tf = BASE_TF < 1 ? 1 : BASE_TF;                 // default view: 1m when base is sub-minute, else base
  buildSessions(); buildTfSelect(); buildAtmSelect();
  $('startSlider').max = baseBars.length - 1;
  rebuildTf();
  // default: park at the 09:30 ET cash open of the LATEST trading day that actually has an RTH
  // session (skip a trailing partial/evening-only day where rthOpenIdx would fall back to 18:00 ET)
  let startSes = sessions[sessions.length - 1] || sessions[0];
  for (let i = sessions.length - 1; i >= 0; i--) { const m = etMinutes(baseBars[rthOpenIdx(sessions[i])].time); if (m >= 570 && m < 960) { startSes = sessions[i]; break; } }
  baseIdx = startSes ? rthOpenIdx(startSes) : Math.floor(baseBars.length / 2);
  syncIdxFromBase();
  sizeChart(); hardReveal(); fitRecent(150);
  if (chartType && chartType !== 'candles') { const _t = chartType; chartType = '__'; setChartType(_t); }
  requestAnimationFrame(sizeChart); setTimeout(sizeChart, 300); setTimeout(sizeChart, 1200);
  if (!wired) { wire(); wired = true; }
  renderAll();
}

// ---------- deep history: monthly-chunked 15s (fetch only the month you're looking at) ----------
// (state vars declared up top near tickMode — see the TDZ note there)
async function enterDeepMode(ds) {
  tickMode = false;
  if (ds && ds.instr) { INSTR = ds.instr; TICK = INSTR.tickSize; if ($('symbol')) $('symbol').textContent = INSTR.symbol; if ($('entryPrice')) $('entryPrice').step = String(TICK); }
  deepSym = INSTR.symbol;
  let idx;
  try { const r = await fetch(`data/chunks/${deepSym}/index.json?v=` + Date.now()); idx = r.ok ? await r.json() : []; } catch (e) { idx = []; }
  deepIndex = (Array.isArray(idx) ? idx : []).slice().sort((a, b) => a.month < b.month ? -1 : 1);
  deepAllDays = new Set(deepIndex.flatMap(m => m.days));
  if (!deepIndex.length) { deepMode = true; toast('No deep-history months yet — run fetch_15s_bulk.py + split_monthly.py'); if (!wired) { wire(); wired = true; } return true; }
  return loadDeepMonth(deepIndex[deepIndex.length - 1].month);   // default: most recent available month
}
async function loadDeepMonth(month) {
  const mi = deepIndex.findIndex(m => m.month === month); if (mi < 0) return false;
  showLoading(true, `Loading ${month}…`);
  const months = mi > 0 ? [deepIndex[mi - 1].month, month] : [month];   // pull the prior month in too, so day 1's "previous session" VP has something to show
  let bars = [];
  try {
    for (const m of months) { const r = await fetch(`data/chunks/${deepSym}/${m}.json?v=` + Date.now()); if (!r.ok) throw 0; bars = bars.concat(await r.json()); }
  } catch (e) { showLoading(false); toast('Month not available locally: ' + month); return false; }
  pause(); position = null; entryOrder = null; orders = []; markers = []; tool = ''; pendingPt = null;
  tickMode = false; deepMode = true; deepMonth = month; setSpeedOptions(false);
  finishLoad(bars, null);
  showLoading(false);
  toast(`Deep history · ${month} · ${bars.length.toLocaleString()} bars`);
  return true;
}
async function jumpToDeepDay(key) {   // calendar click on a day whose month isn't loaded yet
  closeCal();
  const ok = await loadDeepMonth(key.slice(0, 7));
  if (ok && dayIdx[key] != null) gotoSession(dayIdx[key]);
}

// ---------- sessions (computed on base) ----------
let sessions = [];
let dayIdx = {}, calY = 0, calM = 0;   // calendar: date-key -> session index, and the month being shown
function buildSessions() {
  sessions = []; let cur = null;
  baseBars.forEach((b, i) => { const k = tradingDayKey(b.time); if (!cur || cur.key !== k) { cur = { key: k, start: i, end: i }; sessions.push(cur); } else cur.end = i; });
  $('sessionSelect').innerHTML = sessions.map((s, i) => `<option value="${i}">${s.key}</option>`).join('');
  dayIdx = {}; sessions.forEach((s, i) => { dayIdx[s.key] = i; });   // for the calendar picker
}
// ---------- calendar date picker (replaces the long session dropdown) ----------
const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function renderCalendar() {
  const el = $('datePopover'); if (!el) return;
  const startWd = new Date(Date.UTC(calY, calM, 1)).getUTCDay();
  const days = new Date(Date.UTC(calY, calM + 1, 0)).getUTCDate();
  const curKey = (sessions[currentSessionIdx()] || {}).key;
  let cells = '';
  for (let i = 0; i < startWd; i++) cells += '<span class="cal-day empty"></span>';
  for (let d = 1; d <= days; d++) {
    const key = `${calY}-${pad(calM + 1)}-${pad(d)}`, has = key in dayIdx || (deepMode && deepAllDays.has(key)), sel = key === curKey;
    cells += `<button class="cal-day${has ? ' has' : ''}${sel ? ' sel' : ''}" ${has ? `data-key="${key}"` : 'disabled'}>${d}</button>`;
  }
  el.innerHTML =
    `<div class="cal-h"><button class="cal-nav" data-mo="-1"><span class="material-symbols-outlined">chevron_left</span></button>` +
    `<span class="cal-title">${CAL_MONTHS[calM]} ${calY}</span>` +
    `<button class="cal-nav" data-mo="1"><span class="material-symbols-outlined">chevron_right</span></button></div>` +
    `<div class="cal-wdrow">${['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(w => `<span class="cal-wd">${w}</span>`).join('')}</div>` +
    `<div class="cal-grid">${cells}</div>`;
}
function openCal() { const s = sessions[currentSessionIdx()]; if (s) { const p = s.key.split('-'); calY = +p[0]; calM = +p[1] - 1; } renderCalendar(); $('datePopover').classList.add('open'); $('dateBtn').classList.add('active'); }
function closeCal() { const p = $('datePopover'); if (p) { p.classList.remove('open'); $('dateBtn').classList.remove('active'); } }
function wireCalendar() {
  $('dateBtn').onclick = (e) => { e.stopPropagation(); if (locked()) return toast("Can't jump while in a position / working order"); $('datePopover').classList.contains('open') ? closeCal() : openCal(); };
  $('datePopover').addEventListener('click', (e) => {
    const nav = e.target.closest('.cal-nav'); if (nav) { calM += +nav.dataset.mo; if (calM < 0) { calM = 11; calY--; } if (calM > 11) { calM = 0; calY++; } renderCalendar(); return; }
    const day = e.target.closest('.cal-day.has'); if (day && day.dataset.key != null) {
      if (tickMode) { closeCal(); loadTickDay(day.dataset.key); }
      else if (dayIdx[day.dataset.key] != null) { gotoSession(dayIdx[day.dataset.key]); }   // gotoSession() closes the popover itself
      else if (deepMode) { jumpToDeepDay(day.dataset.key); }   // month not loaded yet — fetch it, then jump
    }
  });
  document.addEventListener('mousedown', (e) => { const p = $('datePopover'); if (p && p.classList.contains('open') && !p.contains(e.target) && !$('dateBtn').contains(e.target)) closeCal(); });
}
function buildTfSelect() { $('tfSelect').innerHTML = TF_OPTIONS.map(m => `<option value="${m}" ${m === tf ? 'selected' : ''}>${m < 1 ? Math.round(m * 60) + 's' : m + 'm'}</option>`).join(''); setSpeedOptions(); buildMtfSelects(); }   // setSpeedOptions here too: BASE_TF is final by now, and the sub-bar labels quote it
function buildDataSelect() { $('dataSelect').innerHTML = DATASETS.map((ds, i) => ds.hidden ? '' : `<option value="${i}" ${i === dataIdx ? 'selected' : ''}>${ds.label}</option>`).join(''); }   // hidden entries stay in DATASETS (still loadable) but never render in the dropdown

// ---------- timeframe / index bookkeeping ----------
function rebuildTf() { bars = aggregate(baseBars, tf); computeRipster(); computeIndicators(); oscCompute(); stampBarIndices(); rebuildHA(); vpPKey = null; vpOKey = null; vpDEdge = -1; }
function tfIndexAtBase(bi) { // TF-bar index whose bucket contains baseBars[bi]
  const t = baseBars[bi].time; let lo = 0, hi = bars.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (bars[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}
function syncIdxFromBase() {
  idx = tfIndexAtBase(baseIdx);
  // tfIndexAtBase returns the TF bar that *contains* baseIdx, which can run past it (an
  // incomplete current bar after a TF switch / jump). Showing that bar would leak future
  // sub-bars, and curPx() would read a sub-bar that isn't the displayed candle's close.
  // Snap back to the last fully-revealed TF bar, then align baseIdx to its end so
  // curPx() (=baseBars[baseIdx].close) always equals the current candle's close.
  // BUT only roll back when baseIdx sits STRICTLY inside the bucket (subStart < baseIdx):
  // landing exactly ON a bucket's first sub-bar is a fresh jump/reveal-reset (gotoSession
  // sets baseIdx = a session's very first bar), not a leftover partial bucket — rolling back
  // then would cross into the PREVIOUS session/day. Only bites when base resolution is finer
  // than the display tf (e.g. 15s deep-history data shown at the default 1m view).
  if (idx > 0 && bars[idx].subEnd > baseIdx && bars[idx].subStart < baseIdx) idx--;
  baseIdx = bars[idx].subEnd;
}

// ---------- reveal / replay ----------
// windowed rendering helpers — RENDER_WINDOW / WINDOW_SLACK / seriesFrom declared up in state
function revealStart(i) { return Math.max(0, i - RENDER_WINDOW + 1); }
function feedWindow(keepView) {                       // (re)feed price+vol with just the recent window ending at idx
  const from = revealStart(idx), shift = from - seriesFrom;
  const range = keepView ? chart.timeScale().getVisibleLogicalRange() : null;
  candle.setData(bars.slice(from, idx + 1).map(cd));
  vol.setData(bars.slice(from, idx + 1).map(vd));
  seriesFrom = from;
  if (range && shift) { try { chart.timeScale().setVisibleLogicalRange({ from: range.from - shift, to: range.to - shift }); } catch (e) {} }
}
function maybeReWindow() {                            // trim once the series has grown a slack past the window (keeps step/play O(window))
  if (idx - seriesFrom <= RENDER_WINDOW + WINDOW_SLACK) return false;
  feedWindow(true); refreshMarkers(); oscHardReveal();
  return true;
}
function hardReveal() { feedWindow(false); refreshMarkers(); drawLines(); renderLegend(null); oscHardReveal(); mtfSync(true); resetForming(); setAlertBaseline(); rndPrevMin = null; }   // rndPrevMin reset: a jump must re-seed the settle-crossing baseline
// Advance exactly ONE base sub-bar (15s on the deep datasets, one print on tick). revealTick() rolls
// the display bar over when the bucket changes AND runs processSub() on the bar, so a stop/target
// sitting inside a 3m candle fires on the 15s slice that actually reached it — not at the bar close.
function stepSub() {
  if (baseIdx >= baseBars.length - 1) { pause(); return; }
  baseIdx++; revealTick(baseIdx);
  maybeReWindow(); commitForming(); mtfSync();
  renderLive(); renderLegend(null); alertCheck(); settleCheck();
}
function stepAny() { return subStepMode() ? stepSub() : stepFwd(); }
function stepFwd() {
  // If sub-stepping left the current display bar half-revealed, FINISH it instead of jumping to the
  // next one — otherwise its remaining sub-bars would never be processed and their fills would vanish.
  const cur = bars[idx];
  if (cur && baseIdx < cur.subEnd) {
    for (let i = baseIdx + 1; i <= cur.subEnd; i++) processSub(baseBars[i]);
    baseIdx = cur.subEnd;
    candle.update(cd(cur)); vol.update(vd(cur));
    resetForming(); mtfSync(); renderLive(); renderLegend(null); alertCheck(); settleCheck();
    return;
  }
  if (idx >= bars.length - 1) { pause(); return; }
  idx++;
  if (maybeReWindow()) {}                             // grew past window → re-fed (incl. the new bar) + osc
  else { candle.update(cd(bars[idx])); vol.update(vd(bars[idx])); oscStepFwd(); }
  for (let i = bars[idx].subStart; i <= bars[idx].subEnd; i++) { processSub(baseBars[i]); }
  baseIdx = bars[idx].subEnd;
  resetForming(); mtfSync();
  renderLive(); renderLegend(null); alertCheck(); settleCheck();
}
function stepBack() {
  if (locked()) return toast("Can't step back while in a position / working order");
  if (idx <= 0) return;
  idx--; baseIdx = bars[idx].subEnd; hardReveal(); renderLive();
}
let playBudget = 0;   // accumulated display-bars to reveal — keeps the play rate steady on ANY base resolution (1m / 5s / tick)
function play() {
  if (playing) return pause();
  if (baseIdx >= baseBars.length - 1) return;
  playing = true; $('btnPlay').textContent = 'pause';
  resetForming();
  const sv = String($('speedSelect').value);
  if (sv.indexOf('rt:') === 0) { simMs = baseMs(baseIdx); timer = setInterval(playRtFrame, TICK_FRAME_MS); }   // Realtime: clock-paced (real tape on tick)
  else if (sv.indexOf('sub:') === 0) { playBudget = 0; timer = setInterval(playSubFrame, TICK_FRAME_MS); }      // sub-bar/s: N base bars per second
  else { playBudget = 0; timer = setInterval(playFrame, TICK_FRAME_MS); }                                       // bars/s: steady display-bar rate
}
function pause() { playing = false; $('btnPlay').textContent = 'play_arrow'; clearInterval(timer); timer = null; }
// ---- time alert: remind when the replay crosses a target ET time ----
function fmtMin(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
function setAlertBaseline() { prevAlertMin = baseBars.length ? etMinutes(curBaseT()) : null; }   // call after any jump/load so a jump never false-fires
function alertCheck() {   // call on forward advance: fire once when the revealed time crosses the target upward
  if (alertMin == null || !baseBars.length) return;
  const cur = etMinutes(curBaseT());
  if (prevAlertMin != null && prevAlertMin < alertMin && cur >= alertMin) fireAlert();
  prevAlertMin = cur;
}
// the alert time is marked by a vertical LINE on the chart (no sound) — drawn at the current session's bar that reaches it
let alertBarTime = null, alertBarKey = null;
function updateAlertBar() {   // the bar where the session's clock first CROSSES the target time upward (the session opens 18:00 ET, so a plain >= match hits the evening)
  const s = sessions[currentSessionIdx()], key = (s ? s.key : '') + ':' + alertMin;
  if (key === alertBarKey) return;
  alertBarKey = key; alertBarTime = null;
  if (alertMin != null && s) for (let i = s.start + 1; i <= s.end; i++) { if (etMinutes(baseBars[i - 1].time) < alertMin && etMinutes(baseBars[i].time) >= alertMin) { alertBarTime = baseBars[i].time; break; } }
  alertLineRepaint();
}
const ALERT_LINE = '#f0b90b';
const alertLinePrimitive = {
  attached(p) { this._req = p.requestUpdate; },
  updateAllViews() {},
  paneViews: () => [{ zOrder: () => 'top', renderer: () => ({ draw: (target) => {
    if (alertMin == null || alertBarTime == null) return;
    try { target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context, ts = chart.timeScale(), H = (scope.mediaSize && scope.mediaSize.height) || 9999;
      const x = ts.timeToCoordinate(alertBarTime); if (x == null) return;   // null until that bar is revealed
      ctx.save(); ctx.strokeStyle = ALERT_LINE; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1; ctx.font = '700 10px ui-monospace,monospace'; const txt = fmtMin(alertMin), tw = ctx.measureText(txt).width + 8;
      rrect(ctx, x - tw / 2, 2, tw, 14, 3); ctx.fillStyle = ALERT_LINE; ctx.fill();
      ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(txt, x, 9);
      ctx.restore();
    }); } catch (e) { window.__aline = { err: String(e) }; }
  } }) }],
};
if (candle.attachPrimitive) candle.attachPrimitive(alertLinePrimitive);
function alertLineRepaint() { if (alertLinePrimitive._req) alertLinePrimitive._req(); }
function fireAlert() {   // crossing the time: a quiet visual nudge (no sound, no pause) — the line is already on the chart
  toast(`Time alert · ${fmtMin(alertMin)} ET`);
  const c = $('clock'); if (c) { c.classList.remove('alert-flash'); void c.offsetWidth; c.classList.add('alert-flash'); setTimeout(() => c.classList.remove('alert-flash'), 1800); }
}
function renderAlertLbl() { const b = $('btnAlert'), l = $('alertLbl'); if (!b || !l) return; l.textContent = alertMin == null ? '' : fmtMin(alertMin); b.classList.toggle('on', alertMin != null); }
function setAlertTime() {
  const inp = prompt('Remind me when the replay reaches (ET, HH:MM). Blank to turn off:', alertMin == null ? '11:30' : fmtMin(alertMin));
  if (inp == null) return;
  const s = inp.trim();
  if (!s) alertMin = null;
  else { const m = s.match(/^(\d{1,2}):(\d{2})$/); if (!m) return toast('Use HH:MM, e.g. 11:30'); const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return toast('Invalid time'); alertMin = h * 60 + mi; }
  saveJSON('rt_alert_min', alertMin); setAlertBaseline(); renderAlertLbl(); alertBarKey = null; updateAlertBar();
  toast(alertMin == null ? 'Time line off' : `Time line set: ${fmtMin(alertMin)} ET`);
}

// ===================== Tradovate-style per-day TICK replay =====================
// A day's real trade prints (data/tick/<SYM>_<day>.json) become the base resolution:
// each print is a sub-bar → fills are tick-accurate, and during PLAY the current candle
// forms live print-by-print, paced in real time (speed = realtime ×).
const TICK_FRAME_MS = 50;
function subUnit() { return tickMode ? 'print' : (BASE_TF < 1 ? Math.round(BASE_TF * 60) + 's' : BASE_TF + 'm'); }   // the base resolution, spelled out for the menu
function subStepMode() { return String($('speedSelect').value).indexOf('sub:') === 0; }
function setSpeedOptions() {   // Sub-bar · Realtime (clock-paced) · steady display-bars/sec. Rebuilt whenever the base resolution changes so the sub-bar labels never lie about it.
  const key = (tickMode ? 'tick' : String(BASE_TF)), first = speedUIBase === null;
  if (speedUIBase === key) return; speedUIBase = key;
  const keep = first ? loadJSON('rt_speed', '1') : $('speedSelect').value, u = subUnit();   // remembered pick; default "1 bar/s" = Step advances ONE bar of the timeframe you have selected
  const sub = [0.5, 1, 2, 4, 10].map(n => [`sub:${n}`, `${u} × ${n}/s`]);
  const rt = [['rt:1', 'Realtime 1×'], ['rt:10', 'Realtime 10×'], ['rt:60', 'Realtime 60×'], ['rt:300', 'Realtime 300×']];
  const bs = [0.5, 1, 2, 5, 10, 30].map(n => [String(n), `${n} bar/s`]);
  const grp = (label, rows) => `<optgroup label="${label}">` + rows.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') + `</optgroup>`;
  $('speedSelect').innerHTML =
    grp(`Sub-bar — ${u} at a time (step + play)`, sub) +
    grp('Real-time (clock-paced)', rt) +
    grp('Steady rate (whole display bars)', bs);
  // keep the pick across a dataset switch; fall back to "1 bar/s" = one WHOLE bar of the selected
  // timeframe per Step (pick a Sub-bar rate instead to crawl through a bar 15s at a time)
  $('speedSelect').value = [...$('speedSelect').options].some(o => o.value === keep) ? keep : '1';
}
async function enterTickMode(ds) {
  // Probe availability BEFORE mutating any mode flag or INSTR: data/tick/ is gitignored (~554MB), so
  // on the published site this 404s and we must leave the currently-loaded dataset fully intact —
  // returning false makes the dataSelect handler revert the dropdown. (Setting tickMode/deepMode here
  // and returning true, as this used to, left the old dataset rendered but running tick-mode logic.)
  let idxFile;
  try { const r = await fetch('data/tick/index.json?v=' + Date.now()); idxFile = r.ok ? await r.json() : []; } catch (e) { idxFile = []; }
  const days = (Array.isArray(idxFile) ? idxFile : (idxFile.days || [])).slice().sort();
  if (!days.length) { toast('Tick days are local-only (data/tick/) — not published, run scripts/fetch_tick_days.py locally'); if (!wired) { wire(); wired = true; } return false; }
  availTickDays = days;
  deepMode = false;
  if (ds && ds.instr) { INSTR = ds.instr; TICK = INSTR.tickSize; if ($('symbol')) $('symbol').textContent = INSTR.symbol; if ($('entryPrice')) $('entryPrice').step = String(TICK); }
  return loadTickDay(availTickDays[availTickDays.length - 1]);
}
async function loadTickDay(day) {
  let d;
  try { const r = await fetch(`data/tick/${INSTR.symbol}_${day}.json?v=` + Date.now()); if (!r.ok) throw 0; d = await r.json(); }
  catch (e) { toast('Tick day not available locally: ' + day); return false; }
  pause(); position = null; entryOrder = null; orders = []; markers = []; tool = ''; pendingPt = null;
  tickMode = true; curTickDay = day; setSpeedOptions(true);
  if (d.tick) { TICK = d.tick; INSTR = { ...INSTR, tickSize: d.tick }; }
  const n = d.p.length; baseBars = new Array(n); tickMs = new Array(n);
  for (let i = 0; i < n; i++) { const p = d.p[i], ms = d.t0 + d.dt[i]; tickMs[i] = ms; baseBars[i] = { time: Math.floor(ms / 1000), open: p, high: p, low: p, close: p, volume: d.s[i] }; }
  BASE_TF = 1 / 60;                                            // nominal; tick mode always buckets
  TF_OPTIONS = [1 / 60, 1 / 12, 0.25, 0.5, 1, 2, 3, 5];        // 1s 5s 15s 30s 1m 2m 3m 5m
  tf = 1;                                                      // default 1-min view (candle forms live)
  sessions = [{ key: day, start: 0, end: n - 1 }];            // one day; calendar lists all fetched days
  dayIdx = {}; availTickDays.forEach(k => { dayIdx[k] = 0; });
  $('sessionSelect').innerHTML = `<option value="0">${day}</option>`;
  buildTfSelect(); buildAtmSelect();
  $('startSlider').max = n - 1;
  rebuildTf();
  baseIdx = rthOpenIdx(sessions[0]); syncIdxFromBase();
  sizeChart(); hardReveal(); fitRecent(150);
  if (chartType && chartType !== 'candles') { const _t = chartType; chartType = '__'; setChartType(_t); }
  if (!wired) { wire(); wired = true; }
  renderAll();
  toast(`Tick replay · ${day} · ${n.toLocaleString()} prints`);
  return true;
}
function resetForming() {
  if (!bars.length || !baseBars.length) return;
  const b = bars[idx], s = b.subStart;
  fBucket = b.time; fO = baseBars[s].close; fH = fO; fL = fO; fC = fO; fV = 0;
  for (let i = s; i <= baseIdx && i < baseBars.length; i++) { const p = baseBars[i].close; if (p > fH) fH = p; if (p < fL) fL = p; fC = p; fV += baseBars[i].volume; }
}
function commitForming() { const bar = { time: fBucket, open: fO, high: fH, low: fL, close: fC, volume: fV, __i: idx }; candle.update(cd(bar)); vol.update(vd(bar)); }
function revealTick(i) {
  const b = baseBars[i], sp = Math.round(tf * 60), bucket = Math.floor(b.time / sp) * sp;
  if (bucket !== fBucket) { if (idx < bars.length) { candle.update(cd(bars[idx])); vol.update(vd(bars[idx])); } idx = Math.min(idx + 1, bars.length - 1); fBucket = bucket; fO = b.close; fH = b.close; fL = b.close; fC = b.close; fV = 0; }
  const p = b.close; if (p > fH) fH = p; if (p < fL) fL = p; fC = p; fV += b.volume;
  processSub(b);
}
function playFrame() {   // steady display-bars/sec reveal; each base sub-bar = 1/S of a display bar, so the candle forms smoothly on any base (1m=whole bars, 5s/tick=live forming)
  const rate = Number($('speedSelect').value) || 1;          // display bars per second
  playBudget += rate * (TICK_FRAME_MS / 1000);
  let n = 0;
  while (baseIdx < baseBars.length - 1) {
    const b = bars[Math.min(idx, bars.length - 1)];
    const cost = 1 / Math.max(1, b.subEnd - b.subStart + 1);  // one sub-bar of the current display bar
    if (playBudget < cost) break;
    playBudget -= cost; baseIdx++; revealTick(baseIdx); if (++n > 500000) break;
  }
  if (n) { maybeReWindow(); commitForming(); mtfSync(); renderLive(); renderLegend(null); alertCheck(); settleCheck(); }
  if (baseIdx >= baseBars.length - 1) pause();
}
function playSubFrame() {   // steady SUB-BAR rate: N base bars/sec regardless of the display timeframe, so on 15s base a 3m candle builds over 12 reveals and every intrabar stop/target lands on its real slice
  const rate = Number(String($('speedSelect').value).slice(4)) || 1;
  playBudget += rate * (TICK_FRAME_MS / 1000);
  let n = 0;
  while (playBudget >= 1 && baseIdx < baseBars.length - 1) { playBudget -= 1; baseIdx++; revealTick(baseIdx); if (++n > 500000) break; }
  if (n) { maybeReWindow(); commitForming(); mtfSync(); renderLive(); renderLegend(null); alertCheck(); settleCheck(); }
  if (baseIdx >= baseBars.length - 1) pause();
}
function baseMs(i) { return tickMode ? tickMs[i] : baseBars[i].time * 1000; }   // absolute ms of base bar i (tick OR normal sub-bar)
function playRtFrame() {   // Realtime: advance a sim clock at mult × real market time, reveal due base bars + form the candle. On tick = the real tape; on bars = a bar every (bar-duration ÷ mult).
  const mult = +String($('speedSelect').value).slice(3) || 1;
  simMs += mult * TICK_FRAME_MS;
  let n = 0;
  while (baseIdx < baseBars.length - 1 && baseMs(baseIdx + 1) <= simMs) { baseIdx++; revealTick(baseIdx); if (++n > 500000) break; }
  if (n) { maybeReWindow(); commitForming(); mtfSync(); renderLive(); renderLegend(null); alertCheck(); settleCheck(); }
  if (baseIdx >= baseBars.length - 1) pause();
}
// ---------- multiple-timeframe view ----------
// Extra read-only candle charts of the SAME baseBars at other timeframes, pinned to the replay
// position: they never show a bar the main chart hasn't reached, and the newest one is drawn partial
// from the sub-bars revealed so far — exactly like the main chart's forming candle. Trading stays on
// the main chart; these are for reading structure, so they carry no orders, markers or primitives.
const MTF_WINDOW = 1500, MTF_FIT = 120;
function mtfSrcKey() { return baseBars.length ? `${baseBars.length}:${baseBars[0].time}:${baseBars[baseBars.length - 1].time}` : ''; }   // identifies the loaded day/month without threading a counter through every loader
function buildMtfSelects() {
  const opts = (sel) => `<option value="0">— off —</option>` + TF_OPTIONS.map(m => `<option value="${m}" ${Math.abs(m - sel) < 1e-9 ? 'selected' : ''}>${m < 1 ? Math.round(m * 60) + 's' : m + 'm'}</option>`).join('');
  ['mtfTf1', 'mtfTf2', 'mtfTf3'].forEach((id, i) => { const el = $(id); if (el) el.innerHTML = opts(mtfTfs[i] || 0); });
  const l = $('mtfLayout'); if (l) l.value = mtfLayout;
}
function destroyMtf() { mtfPanes.forEach(p => { try { p.chart.remove(); } catch (e) {} p.el.remove(); }); mtfPanes = []; }
function rebuildMtf() {
  destroyMtf();
  const wrap = $('chartwrap'), host = $('mtfWrap'); if (!wrap || !host) return;
  wrap.classList.toggle('mtf-on', mtfLayout !== 'off');
  wrap.classList.toggle('mtf-stack', mtfLayout === 'stack');
  wrap.classList.toggle('mtf-side', mtfLayout === 'side');
  wrap.classList.toggle('mtf-grid', mtfLayout === 'grid');
  if (mtfLayout === 'off') { sizeChart(); return; }
  mtfTfs.filter(m => m > 0).forEach(m => {
    const el = document.createElement('div'); el.className = 'mtf-pane';
    const cv = document.createElement('div'); cv.className = 'mtf-chart';
    const tag = document.createElement('div'); tag.className = 'mtf-tag';
    tag.innerHTML = `<b>${m < 1 ? Math.round(m * 60) + 's' : m + 'm'}</b>`;
    el.appendChild(cv); el.appendChild(tag); host.appendChild(el);
    const c = LightweightCharts.createChart(cv, {
      layout: { background: { color: '#000000' }, textColor: '#d1d4dc', fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.12, bottom: 0.12 } },
      localization: { timeFormatter: etCrosshairFmt },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: m < 1, rightOffset: 4, tickMarkFormatter: etTickFmt },
    });
    const s = c.addCandlestickSeries({ upColor: CT_UP, downColor: CT_DOWN, borderVisible: false, wickUpColor: CT_UP, wickDownColor: CT_DOWN });
    mtfPanes.push({ tf: m, el, cv, chart: c, series: s, bars: null, srcKey: '', lastJ: -1 });
  });
  sizeChart(); mtfSync(true);
}
function mtfBarAt(p, bi) {   // index of p.bars containing base index bi (binary search on the sub-bar span)
  const a = p.bars; let lo = 0, hi = a.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bi < a[m].subStart) hi = m - 1; else if (bi > a[m].subEnd) lo = m + 1; else return m; }
  return Math.max(0, Math.min(a.length - 1, hi));
}
function mtfPartial(p, j) {   // the newest bar, built only from sub-bars up to baseIdx — never leaks the rest of the bar
  const b = p.bars[j], s = b.subStart, e = Math.min(baseIdx, b.subEnd);
  let o = baseBars[s].open, h = baseBars[s].high, l = baseBars[s].low, c = baseBars[s].close;
  for (let i = s + 1; i <= e; i++) { const x = baseBars[i]; if (x.high > h) h = x.high; if (x.low < l) l = x.low; c = x.close; }
  return { time: b.time, open: o, high: h, low: l, close: c };
}
function mtfSync(hard) {
  if (mtfLayout === 'off' || !mtfPanes.length || !baseBars.length) return;
  const key = mtfSrcKey();
  mtfPanes.forEach(p => {
    if (!p.bars || p.srcKey !== key) { p.bars = aggregate(baseBars, p.tf); p.srcKey = key; p.lastJ = -1; hard = true; }
    if (!p.bars.length) return;
    const j = mtfBarAt(p, baseIdx);
    if (hard || j < p.lastJ) {                                   // load / jump / step-back → re-feed the window
      const from = Math.max(0, j - MTF_WINDOW + 1);
      const d = p.bars.slice(from, j).map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }));
      d.push(mtfPartial(p, j)); p.series.setData(d);
      const li = d.length - 1;
      try { p.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, li - MTF_FIT), to: li + 4 }); } catch (e) {}
    } else {
      for (let k = p.lastJ; k >= 0 && k < j; k++) { const b = p.bars[k]; p.series.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }); }   // close out any bars completed since last sync
      p.series.update(mtfPartial(p, j));
    }
    p.lastJ = j;
  });
}
function setMtf(layout, tfs) {
  if (layout != null) { mtfLayout = layout; saveJSON('rt_mtf_layout', mtfLayout); }
  if (tfs) { mtfTfs = tfs; saveJSON('rt_mtf_tfs', mtfTfs); }
  rebuildMtf();
}
function rthOpenIdx(s) { for (let i = s.start; i <= s.end; i++) { const m = etMinutes(baseBars[i].time); if (m >= 570 && m < 960) return i; } return s.start; }  // first bar in 09:30–15:59 ET = US cash open (skips the 18:00 ET Globex open)
function gotoSession(i) {
  if (locked()) return toast("Can't jump while in a position / working order");
  pause(); baseIdx = rthOpenIdx(sessions[i]); syncIdxFromBase(); hardReveal(); fitRecent(150); renderAll();   // fitRecent: auto-fit recent bars on day change; renderAll so the dashboard "Today" tally follows
  const sel = $('sessionSelect'); if (sel) sel.value = String(i);
  closeCal();
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
  pause(); tf = m; rebuildTf(); syncIdxFromBase(); hardReveal(); fitRecent(150); renderLive();
}

// ---------- order helpers ----------
function curPx() { return baseBars[baseIdx].close; }
function curBaseT() { return baseBars[baseIdx].time; }
function locked() { return !!position || !!entryOrder; }

// ---------- Random-date GAME mode: one round = one blind random day, 09:30→12:30 ET (or hit End) → settlement dashboard ----------
const RND_OPEN = 570, RND_CLOSE = 750;   // round window: 09:30 → 12:30 ET (minutes since ET midnight)
function rndEligible() {   // full trading days only: a real RTH open AND data through the 12:30 close
  const out = [];
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i], om = etMinutes(baseBars[rthOpenIdx(s)].time);
    if (om < 570 || om >= 960) continue;                        // holiday / evening-only stub: no real 09:30 open
    const em = etMinutes(baseBars[s.end].time);
    if (em >= RND_OPEN && em < RND_CLOSE) continue;             // data ends inside the round window → can't reach 12:30
    out.push(i);
  }
  return out;
}
function rndJump() {   // pick a random eligible day (≠ the one just played) and open it at 09:30 ET
  const el = rndEligible().filter(i => sessions[i].key !== rndCurKey);
  if (!el.length) { toast('Not enough full days in this dataset'); return false; }
  const i = el[Math.floor(Math.random() * el.length)], s = sessions[i];
  rndCurKey = s.key; rndStartCount = trades.length; rndSettled = false;
  pause(); baseIdx = rthOpenIdx(s); syncIdxFromBase(); hardReveal(); fitRecent(150); renderAll();
  const sel = $('sessionSelect'); if (sel) sel.value = String(i);
  return true;
}
function setRndUi(on) {   // blind the date + freeze day-jump controls while a round is live
  ['dateBtn', 'btnPrevDay', 'btnNextDay', 'btnPickStart'].forEach(id => { const b = $(id); if (b) b.disabled = on; });
  const sl = $('startSlider'); if (sl) sl.disabled = on;
  const b = $('btnRandom'); if (b) b.classList.toggle('active', on);
  const sn = $('btnSettleNow'); if (sn) sn.style.display = on ? '' : 'none';
  const hud = $('rndHud'); if (hud) hud.style.display = on ? '' : 'none';
  try { chart.timeScale().applyOptions({}); } catch (e) {}      // refresh axis labels under the new formatter mode
  renderAll();
}
function enterRnd() {
  if (rndMode) {   // toggle: reopen the settlement screen if one is pending, else exit
    if (rndSettled && $('settleModal') && !$('settleModal').classList.contains('open')) return openSettle();
    return exitRnd();   // exitRnd handles its own save prompt
  }
  if (locked()) return toast('Flatten & cancel orders before random mode');
  rndSavedTrades = trades; rndSavedMarkers = markers;          // park the real trade record — the sandbox runs on a clean slate
  saveJSON('rt_trades_prerandom', rndSavedTrades);             // crash-safety: recover real trades if this session is interrupted
  trades = []; markers = [];                                   // sandbox: journal / dashboard / CSV now show ONLY this random run
  rndMode = true; rndRounds = [];
  if (!rndJump()) { trades = rndSavedTrades; markers = rndSavedMarkers; rndSavedTrades = rndSavedMarkers = null; localStorage.removeItem('rt_trades_prerandom'); rndMode = false; return; }
  setRndUi(true);
  toast('Round 1 — trade the day; settles at 12:30 ET or when you hit End');
}
function exitRnd() {
  if (rndMode && trades.length && confirm(`Save this random run (${trades.length} trade${trades.length === 1 ? '' : 's'}) as a log before exiting?`)) {
    const net = trades.reduce((s, t) => s + t.pnl, 0);
    tradeLogs.push({ id: 'log' + Date.now(), name: `Random · ${trades.length} trade${trades.length === 1 ? '' : 's'} · ${INSTR.symbol}`, ts: Math.floor(Date.now() / 1000), n: trades.length, net, trades: JSON.parse(JSON.stringify(trades)) });
    saveJSON('rt_trade_logs', tradeLogs);
  }
  rndMode = false; rndCurKey = null; rndSettled = false;
  trades = rndSavedTrades || []; markers = rndSavedMarkers || [];   // restore the real trade record untouched
  saveJSON('rt_trades', trades); localStorage.removeItem('rt_trades_prerandom');
  rndSavedTrades = rndSavedMarkers = null;
  closeSettle(); refreshMarkers(); setRndUi(false);
}
function settleNow() { if (rndMode && !rndSettled) settleRound(); }   // manual "End round": close out now without playing to 12:30
function rndLivePnl() {   // this round's running P&L = realized (closed trades) + open position mark-to-market
  const real = trades.slice(rndStartCount).reduce((s, t) => s + t.pnl, 0);
  let open = 0;
  if (position) { const long = position.side === 'long', ut = long ? tcount(curPx(), position.entry) : tcount(position.entry, curPx()); open = ut * INSTR.tickValue * position.qty; }
  return { real, open, total: real + open };
}
function rndStreak() { let n = 0; for (let i = rndRounds.length - 1; i >= 0; i--) { if (rndRounds[i].net > 0) n++; else break; } return n; }   // consecutive winning rounds, most-recent back
function updateRndHud() {   // live game HUD over the chart: round #, running P&L, close countdown, streak
  const el = $('rndHud'); if (!el) return;
  if (!rndMode || rndSettled) { el.style.display = 'none'; return; }
  el.style.display = '';
  const p = rndLivePnl(), cur = etMinutes(curBaseT());
  const prog = Math.max(0, Math.min(1, (cur - RND_OPEN) / (RND_CLOSE - RND_OPEN))), left = Math.max(0, RND_CLOSE - cur), streak = rndStreak();
  el.querySelector('.rh-round').textContent = 'ROUND ' + (rndRounds.length + 1);
  const pe = el.querySelector('.rh-pnl'); pe.textContent = usd(p.total); pe.className = 'rh-pnl ' + (p.total > 0 ? 'pos' : p.total < 0 ? 'neg' : '');
  el.querySelector('.rh-sub').textContent = `real ${usd(p.real)} · open ${usd(p.open)}`;
  el.querySelector('.rh-fill').style.width = (prog * 100).toFixed(1) + '%';
  el.querySelector('.rh-left').textContent = left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m left` : `${left}m left`;
  const ss = el.querySelector('.rh-streak'); ss.style.display = streak >= 2 ? '' : 'none';
  if (streak >= 2) ss.innerHTML = `<span class="material-symbols-outlined">local_fire_department</span>${streak}`;
}
function wireRndHudDrag() { wireCardDrag('rndHud', 'rt_hud_pos', '#rhEnd'); }
function wireCardDrag(elId, storeKey, skipSel) {   // let a chart overlay card be dragged anywhere so it never blocks the bars; position persists
  const el = $(elId); if (!el) return;
  const pos = loadJSON(storeKey, null);
  if (pos && typeof pos.left === 'number') { el.style.left = pos.left + 'px'; el.style.top = pos.top + 'px'; el.style.right = 'auto'; }
  let drag = null;
  el.addEventListener('mousedown', (e) => {
    if (skipSel && e.target.closest(skipSel)) return;           // let buttons inside the card click through
    e.stopPropagation(); e.preventDefault();                  // don't start a chart pan
    const r = el.getBoundingClientRect(), wrap = $('chartwrap').getBoundingClientRect();
    el.style.left = (r.left - wrap.left) + 'px'; el.style.top = (r.top - wrap.top) + 'px'; el.style.right = 'auto';   // freeze current spot as left/top (so a plain click doesn't jump it)
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; el.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const wrap = $('chartwrap').getBoundingClientRect();
    const left = Math.max(0, Math.min(e.clientX - drag.dx - wrap.left, wrap.width - el.offsetWidth));
    const top = Math.max(0, Math.min(e.clientY - drag.dy - wrap.top, wrap.height - el.offsetHeight));
    el.style.left = left + 'px'; el.style.top = top + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = null; el.style.cursor = '';
    saveJSON(storeKey, { left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 });
  });
}
function rndRoundStats() {
  const ts = trades.slice(rndStartCount);
  const net = ts.reduce((s, t) => s + t.pnl, 0), w = ts.filter(t => t.pnl > 0).length, l = ts.filter(t => t.pnl < 0).length;
  const rs = ts.filter(t => t.R != null);
  return { key: rndCurKey, ts, net, w, l, n: ts.length, ticks: ts.reduce((s, t) => s + t.ticks, 0),
    avgR: rs.length ? rs.reduce((s, t) => s + t.R, 0) / rs.length : null,
    best: ts.length ? Math.max(...ts.map(t => t.pnl)) : 0, worst: ts.length ? Math.min(...ts.map(t => t.pnl)) : 0 };
}
function settleCheck() {   // settle once the round's day has REACHED 12:30 ET — state-based, so it fires no matter how you got there (fast play, tf switch, step-back-then-forward)
  if (!rndMode || rndSettled) return;
  const si = currentSessionIdx(); if (si < 0 || sessions[si].key !== rndCurKey) return;
  if (etMinutes(curBaseT()) >= RND_CLOSE || baseIdx >= sessions[si].end) settleRound();
}
function settleRound() {
  rndSettled = true; pause();
  if (position) flatten(); else if (entryOrder) cancelEntry();  // round over: flatten everything at the close
  rndRounds.push(rndRoundStats());
  updateRndHud();   // rndSettled is now true → HUD hides itself
  openSettle();
}
function openSettle() {   // settlement dashboard: this day's stats + running totals + per-trade charts
  const el = $('settleModal'); if (!el) return;
  const r = rndRounds[rndRounds.length - 1]; if (!r) return;
  const tot = rndRounds.reduce((s, x) => s + x.net, 0), totN = rndRounds.reduce((s, x) => s + x.n, 0);
  const cell = (k, v, cls) => `<div class="st-cell"><div class="st-k">${k}</div><div class="st-v ${cls || ''}">${v}</div></div>`;
  const wins = rndRounds.filter(x => x.net > 0).length, wr = rndRounds.length ? Math.round(100 * wins / rndRounds.length) : 0;
  const best = Math.max(...rndRounds.map(x => x.net)), streak = rndStreak();
  const verdict = r.net > 0 ? 'win' : r.net < 0 ? 'loss' : 'flat', vlabel = r.net > 0 ? 'WIN' : r.net < 0 ? 'LOSS' : 'FLAT';
  el.innerHTML = `<div class="dd-card"><div class="dd-h"><div><span class="dd-date">Round ${rndRounds.length} · ${r.key}</span></div>`
    + `<button class="dd-x" id="stClose" title="Close — stay on this day"><span class="material-symbols-outlined">close</span></button></div>`
    + `<div class="st-over"><span class="st-badge ${verdict}">${vlabel}</span>`
    + `<div class="st-big ${r.net >= 0 ? 'pos' : 'neg'}">${usd(r.net)}</div>`
    + `<div class="st-tally"><span>Rounds <b>${rndRounds.length}</b></span><span>Win rate <b>${wr}%</b></span><span>Best <b>${usd(best)}</b></span>`
    + (streak >= 2 ? `<span>Streak <b>${streak}W</b></span>` : '')
    + `<span>Total <b class="${tot >= 0 ? 'pos' : 'neg'}">${usd(tot)}</b></span></div></div>`
    + `<div class="st-grid">`
    + cell('Net P&L', usd(r.net), r.net >= 0 ? 'pos' : 'neg')
    + cell('Trades · W-L', `${r.n} · ${r.w}W ${r.l}L`)
    + cell('Win rate', r.n ? Math.round(100 * r.w / r.n) + '%' : '–')
    + cell('Ticks', (r.ticks >= 0 ? '+' : '') + r.ticks)
    + cell('Avg R', r.avgR == null ? '–' : (r.avgR >= 0 ? '+' : '') + r.avgR.toFixed(2))
    + cell('Best / Worst', `${usd(r.best)} · ${usd(r.worst)}`)
    + `</div>`
    + (r.ts.length ? `<div class="dd-list">` + r.ts.map((t, i) => { const long = t.side === 'long';
        return `<div class="dd-trade"><div class="dd-tinfo"><div class="dd-trow">#${i + 1} <span class="${long ? 'long-tag' : 'short-tag'}">${long ? 'LONG' : 'SHORT'} ${t.qty}</span> <b class="${t.pnl >= 0 ? 'pos' : 'neg'}">${usd(t.pnl)}</b> · ${t.ticks >= 0 ? '+' : ''}${t.ticks}t · ${t.R == null ? '–' : (t.R >= 0 ? '+' : '') + t.R.toFixed(2) + 'R'}</div>`
          + `<div class="dd-sub">${tFmt(t.entryTime)} → ${tFmt(t.exitTime)} · ${f2(t.entry)} → ${f2(t.exit)} · ${t.atm} · ${t.exitType}</div></div>`
          + `<canvas class="dd-chart" data-ti="${i}" title="Scroll to zoom · drag to pan · double-click to reset"></canvas></div>`; }).join('') + `</div>` : `<div class="st-run">No trades this round.</div>`)
    + `<div class="st-actions"><button id="stNext" class="primary"><span class="material-symbols-outlined">shuffle</span>Next round</button><button id="stExit">End session</button></div></div>`;
  el.classList.add('open');
  requestAnimationFrame(() => el.querySelectorAll('.dd-chart').forEach(c => mountTradeChart(c, r.ts[+c.dataset.ti])));
  $('stNext').onclick = () => { closeSettle(); rndJump(); };
  $('stExit').onclick = () => { const n = rndRounds.length, t = rndRounds.reduce((s, x) => s + x.net, 0); exitRnd(); toast(`Session over · ${n} round${n === 1 ? '' : 's'} · ${usd(t)}`); };
  $('stClose').onclick = closeSettle;
}
function closeSettle() { const el = $('settleModal'); if (el) { el.classList.remove('open'); el.innerHTML = ''; } }

// ---------- QUIZ mode: replay YOUR real trades to the bar before entry, re-decide, then see what you actually did ----------
const QUIZ_TF = 3;                 // questions are posed on 3-minute bars
let quizAll = [], quizQs = [], quizIdx = 0, quizAns = [], quizShown = false;
let quizSaveTf = null, quizSaveTrades = null, quizSaveMarkers = null, quizSaveShow = null;
const baseIdxAt = (t) => { let a = 0, b = baseBars.length - 1, r = -1; while (a <= b) { const m = (a + b) >> 1; if (baseBars[m].time <= t) { r = m; a = m + 1; } else b = m - 1; } return r; };   // last base bar at/before t
async function loadQuizTrades() {
  if (quizAll.length) return true;
  try { const r = await fetch('data/quiz_trades.json?v=' + new Date().toISOString().slice(0, 10)); if (!r.ok) throw 0; quizAll = await r.json(); }
  catch (e) { toast('data/quiz_trades.json not found'); return false; }
  return quizAll.length > 0;
}
async function enterQuiz() {
  if (quizMode) return exitQuiz();
  if (locked()) return toast('Flatten & cancel orders before the quiz');
  if (!(await loadQuizTrades())) return;
  if (!/NQ/.test(INSTR.symbol)) return toast('Switch to an NQ dataset — the quiz log is MNQ');
  const lo = baseBars[0].time, hi = baseBars[baseBars.length - 1].time;
  const pool = quizAll.filter(q => q.revealTime >= lo && q.exitTime <= hi);   // only questions this dataset can actually replay
  if (!pool.length) return toast('This dataset does not cover any of the logged trades');
  quizQs = pool.slice(); for (let i = quizQs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [quizQs[i], quizQs[j]] = [quizQs[j], quizQs[i]]; }   // shuffle so you can't ride the calendar
  quizAns = []; quizIdx = 0; quizMode = true;
  quizSaveTf = tf; quizSaveTrades = trades; quizSaveMarkers = markers; quizSaveShow = showTrades;
  trades = []; markers = []; showTrades = true;                              // sandbox: your journal is parked, the chart shows only quiz markers
  const b = $('btnQuiz'); if (b) b.classList.add('active');
  const hud = $('quizCard'); if (hud) hud.style.display = '';
  if (pool.length < quizAll.length) toast(`Quiz: ${pool.length} of ${quizAll.length} trades replayable`);
  quizGoto(0);
}
function exitQuiz() {
  quizMode = false;
  trades = quizSaveTrades || []; markers = quizSaveMarkers || []; if (quizSaveShow != null) showTrades = quizSaveShow;
  quizSaveTrades = quizSaveMarkers = null;
  if (quizSaveTf != null && quizSaveTf !== tf) { tf = quizSaveTf; rebuildTf(); syncIdxFromBase(); hardReveal(); const s = $('tfSelect'); if (s) s.value = String(tf); }
  quizSaveTf = null;
  const b = $('btnQuiz'); if (b) b.classList.remove('active');
  const hud = $('quizCard'); if (hud) hud.style.display = 'none';
  closeQuizScore(); refreshMarkers();
  try { chart.timeScale().applyOptions({}); } catch (e) {}                   // un-blind the axis date labels
  renderAll();
}
function quizGoto(i) {
  if (i >= quizQs.length) return quizFinish();
  const q = quizQs[i]; quizIdx = i; quizShown = false;
  position = null; entryOrder = null; orders = []; markers = [];             // a stray hotkey trade must not leak into the next question
  pause();
  if (tf !== QUIZ_TF) { tf = QUIZ_TF; rebuildTf(); const s = $('tfSelect'); if (s) s.value = String(QUIZ_TF); }
  // Land INSIDE the entry bar: it forms only up to the minute you actually entered and never completes.
  // syncIdxFromBase() deliberately snaps back to the last COMPLETE tf bar, so drive idx directly and
  // finish with commitForming() — the same path playback uses to paint a partial candle.
  baseIdx = Math.max(0, baseIdxAt(q.entryTime));
  idx = tfIndexAtBase(baseIdx);
  hardReveal();
  // Pin the forming candle to the entry INSTANT, not the entry minute: the fill price is where
  // price stood at that second, and only minutes that had already closed contribute the range.
  { const s = bars[idx].subStart, emin = Math.floor(q.entryTime / 60) * 60;
    fBucket = bars[idx].time; fO = baseBars[s].open; fC = q.entry;
    fH = Math.max(fO, q.entry); fL = Math.min(fO, q.entry); fV = 0;
    for (let i = s; i < baseBars.length && baseBars[i].time < emin; i++) {
      fH = Math.max(fH, baseBars[i].high); fL = Math.min(fL, baseBars[i].low); fV += baseBars[i].volume; } }
  commitForming(); fitRecent(90); refreshMarkers(); renderAll();
  renderQuizCard();
}
function quizAnswer(ans) {
  if (!quizMode || quizShown) return;
  const q = quizQs[quizIdx]; if (!q) return;
  quizAns[quizIdx] = ans; quizShown = true;
  const end = baseIdxAt(q.exitTime + QUIZ_TF * 60 * 4);                      // play the outcome out, plus a few bars of follow-through
  baseIdx = Math.min(baseBars.length - 1, Math.max(baseIdx, end));
  syncIdxFromBase(); hardReveal();
  markers = [                                                               // reveal what you actually did
    { baseTime: q.entryTime, position: q.side === 'long' ? 'belowBar' : 'aboveBar', color: q.side === 'long' ? '#26a69a' : '#ef5350', shape: q.side === 'long' ? 'arrowUp' : 'arrowDown', text: `YOU ${q.side === 'long' ? 'LONG' : 'SHORT'} ${f2(q.entry)}` },
    { baseTime: q.exitTime, position: q.side === 'long' ? 'aboveBar' : 'belowBar', color: q.pnl >= 0 ? '#26a69a' : '#ef5350', shape: q.side === 'long' ? 'arrowDown' : 'arrowUp', text: `${usd(q.pnl)}` }
  ];
  refreshMarkers(); fitRecent(110); renderAll();
  renderQuizCard();
}
const QZ_FLAT_USD = 15;   // |P&L| under this is a scratch — commission + a tick of noise, not a real win or loss
const qzWin = p => p >= QZ_FLAT_USD, qzLoss = p => p <= -QZ_FLAT_USD;
function quizVerdict(q, a) {   // how this answer compares to what actually happened
  const win = qzWin(q.pnl), loss = qzLoss(q.pnl);
  if (a === 'skip') return loss ? { k: 'good', t: 'Dodged a loser' } : win ? { k: 'miss', t: 'Passed on a winner' } : { k: 'flat', t: 'Passed on a scratch' };
  if (a === q.side) return win ? { k: 'good', t: 'Took the winner again' } : loss ? { k: 'bad', t: 'Repeated the loser' } : { k: 'flat', t: 'Same scratch trade' };
  return loss ? { k: 'good', t: 'Faded it — right call' } : win ? { k: 'bad', t: 'Faded a winner' } : { k: 'flat', t: 'Faded a scratch' };
}
function renderQuizCard() {
  const el = $('quizCard'); if (!el || !quizMode) return;
  const q = quizQs[quizIdx]; if (!q) return;
  const n = quizQs.length, sideTxt = s => s === 'long' ? 'LONG' : s === 'short' ? 'SHORT' : 'SKIP';
  if (!quizShown) {
    el.innerHTML = `<div class="qz-head"><span class="qz-n">Q ${quizIdx + 1} / ${n}</span><span class="qz-tf">${q.etHM} ET · ${QUIZ_TF}m</span></div>`
      + `<div class="qz-ask">Do you take this trade?</div>`
      + `<div class="qz-btns"><button class="qz-b buy" data-a="long">LONG</button><button class="qz-b sell" data-a="short">SHORT</button><button class="qz-b skip" data-a="skip">SKIP</button></div>`
      + `<div class="qz-foot">your entry bar, still forming</div>`;
  } else {
    const a = quizAns[quizIdx], v = quizVerdict(q, a), s = quizScore();
    el.innerHTML = `<div class="qz-head"><span class="qz-n">Q ${quizIdx + 1} / ${n}</span><span class="qz-tf">${q.etHM} ET</span></div>`
      + `<div class="qz-cmp"><span>You <b class="${a === 'long' ? 'pos' : a === 'short' ? 'neg' : ''}">${sideTxt(a)}</b></span><span>Then <b class="${q.side === 'long' ? 'pos' : 'neg'}">${sideTxt(q.side)}</b></span></div>`
      + `<div class="qz-res ${q.pnl >= 0 ? 'pos' : 'neg'}">${usd(q.pnl)}</div>`
      + `<div class="qz-sub">${q.qty} lot · ${q.holdMin}min · ${f2(q.entry)} → ${f2(q.exit)}</div>`
      + `<div class="qz-verdict ${v.k}">${v.t}</div>`
      + `<div class="qz-run">Sim ${usd(s.simPnl)} · then ${usd(s.realPnl)} · WR ${s.simWr == null ? '–' : s.simWr + '%'} vs ${s.realWr == null ? '–' : s.realWr + '%'} · ${s.n}/${n}</div>`
      + `<div class="qz-btns"><button class="qz-b next" data-a="next">${quizIdx + 1 >= n ? 'See results' : 'Next question'}</button></div>`;
  }
  el.querySelectorAll('.qz-b').forEach(b => b.onclick = (e) => { e.stopPropagation(); const a = b.dataset.a; if (a === 'next') quizGoto(quizIdx + 1); else quizAnswer(a); });
}
function quizScore() {
  const r = { n: 0, agree: 0, opp: 0, skip: 0, dodged: 0, losers: 0, caught: 0, winners: 0, simPnl: 0, realPnl: 0, good: 0,
              taken: 0, simW: 0, simL: 0 };
  quizQs.forEach((q, i) => {
    const a = quizAns[i]; if (!a) return;
    r.n++; r.realPnl += q.pnl;
    if (qzWin(q.pnl)) r.winners++; else if (qzLoss(q.pnl)) r.losers++;
    if (a === 'skip') { r.skip++; if (qzLoss(q.pnl)) r.dodged++; }
    else {
      const p = a === q.side ? q.pnl : -q.pnl;   // faded = the mirror outcome at the same exit point (approximation: your own stop/target would differ)
      r.taken++; r.simPnl += p; if (qzWin(p)) r.simW++; else if (qzLoss(p)) r.simL++;
      if (a === q.side) { r.agree++; if (qzWin(q.pnl)) r.caught++; } else r.opp++;
    }
    if (quizVerdict(q, a).k === 'good') r.good++;
  });
  r.simWr = (r.simW + r.simL) ? Math.round(100 * r.simW / (r.simW + r.simL)) : null;         // win rate of the trades you WOULD have taken
  r.realWr = (r.winners + r.losers) ? Math.round(100 * r.winners / (r.winners + r.losers)) : null;   // win rate you actually had, same question set
  return r;
}
function quizFinish() {
  const el = $('quizModal'); if (!el) return;
  const s = quizScore(), n = quizQs.length;
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
  const cell = (k, v, cls) => `<div class="st-cell"><div class="st-k">${k}</div><div class="st-v ${cls || ''}">${v}</div></div>`;
  const delta = s.simPnl - s.realPnl;
  el.innerHTML = `<div class="dd-card"><div class="dd-h"><div><span class="dd-date">Quiz results</span> · ${s.n} answered</div>`
    + `<button class="dd-x" id="qzClose"><span class="material-symbols-outlined">close</span></button></div>`
    + `<div class="st-over"><span class="st-badge ${delta > 0 ? 'win' : delta < 0 ? 'loss' : 'flat'}">${delta > 0 ? 'IMPROVED' : delta < 0 ? 'WORSE' : 'LEVEL'}</span>`
    + `<div class="st-big ${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${usd(delta)}</div>`
    + `<div class="st-tally"><span>Today's calls <b class="${s.simPnl >= 0 ? 'pos' : 'neg'}">${usd(s.simPnl)}</b></span><span>You back then <b class="${s.realPnl >= 0 ? 'pos' : 'neg'}">${usd(s.realPnl)}</b></span></div></div>`
    + `<div class="st-grid">`
    + cell('New win rate', s.simWr == null ? '–' : `${s.simWr}% · ${s.simW}W/${s.simL}L`, s.realWr != null && s.simWr > s.realWr ? 'pos' : s.realWr != null && s.simWr < s.realWr ? 'neg' : '')
    + cell('Then, same set', s.realWr == null ? '–' : `${s.realWr}% · ${s.winners}W/${s.losers}L`)
    + cell('Trades taken', `${s.taken} / ${s.n}`)
    + cell('Dodged losers', `${s.dodged} / ${s.losers}`, s.dodged > s.losers / 2 ? 'pos' : '')
    + cell('Kept winners', `${s.caught} / ${s.winners}`, s.caught > s.winners / 2 ? 'pos' : '')
    + cell('Good calls', `${s.good} / ${s.n} · ${pct(s.good, s.n)}`)
    + cell('Same side', String(s.agree))
    + cell('Faded', String(s.opp))
    + cell('Skipped', String(s.skip))
    + `</div>`
    + `<div class="st-run">Each chip = one question · green = good call, red = bad, grey = neutral</div>`
    + `<div class="qz-chips">` + quizQs.map((q, i) => { const a = quizAns[i]; if (!a) return `<span class="qz-chip"></span>`;
        const v = quizVerdict(q, a); return `<span class="qz-chip ${v.k}" title="${escHtml(q.day + ' ' + q.etHM + ' · you ' + a + ' · then ' + q.side + ' · ' + usd(q.pnl) + ' · ' + v.t)}">${i + 1}</span>`; }).join('') + `</div>`
    + `<div class="st-actions"><button id="qzAgain" class="primary"><span class="material-symbols-outlined">replay</span>New round</button><button id="qzExit">Exit quiz</button></div></div>`;
  el.classList.add('open');
  $('qzAgain').onclick = () => { closeQuizScore(); quizAns = []; for (let i = quizQs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [quizQs[i], quizQs[j]] = [quizQs[j], quizQs[i]]; } quizGoto(0); };
  $('qzExit').onclick = () => { const d = quizScore(); exitQuiz(); toast(`Quiz done · your calls ${usd(d.simPnl)} vs then ${usd(d.realPnl)}`); };
  $('qzClose').onclick = closeQuizScore;
}
function closeQuizScore() { const el = $('quizModal'); if (el) { el.classList.remove('open'); el.innerHTML = ''; } }

function onEntryButton(side) {
  if (position) { if (position.side !== side) return flatten('reverse'); return toast('Already in a position — FLATTEN first'); }
  const kind = $('entryType').value;
  if (kind === 'market') { openPosition(side, curPx(), curBaseT(), activeAtm, resolveQty(side, 'market')); }
  else {
    const a = atm[activeAtm] || {};
    let price, bracket;
    if (kind === 'stop') {                          // stop entry = break of the current K-bar: Buy=high+1tick, Sell=low-1tick
      const ext = curBarExtreme();
      price = rnd(side === 'long' ? ext.hi + TICK : ext.lo - TICK);
      const inp = $('entryPrice'); if (inp) inp.value = f2(price);   // show the auto-computed level
      if (a.struct) {   // snapshot the structural stop to THIS (signal) bar; target = rr×risk
        const stopPx = structStopPx(side, price, a);
        const slT = Math.max(1, Math.round(Math.abs(price - stopPx) / TICK));
        bracket = { slTicks: slT, tgts: [{ ticks: Math.max(1, Math.round(slT * (a.rr || 1))), qty: 1 }] };
      }
    } else {
      price = rnd(parseFloat($('entryPrice').value));
      if (!price) return toast('Enter an entry price');
      if (a.struct) bracket = structBracket(side, 'limit', price);   // limit orders: SL/TP planned NOW from the R dial, not at the fill bar
    }
    const mult = resolveQty(side, kind, price);
    entryOrder = { side, kind, price, atm: activeAtm, mult, ...(bracket || bracketFromAtm(activeAtm)) };
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
  let sl, srcT;
  if (a.struct && (!bracket || !bracket.slTicks)) {   // struct + no snapshot (market entry) → stop from CURRENT bar's extreme
    const stopPx = structStopPx(side, px, a);
    sl = Math.max(1, Math.round(Math.abs(px - stopPx) / TICK));
    srcT = [{ ticks: Math.max(1, Math.round(sl * (a.rr || 1))), qty: 1 }];   // target = rr × risk (1:1)
  } else {
    sl = bracket ? bracket.slTicks : a.sl;                       // honor a working order's (possibly dragged) bracket
    srcT = bracket ? bracket.tgts : a.targets;
  }
  const tgts = (srcT || []).filter(x => x.ticks > 0 && x.qty > 0).map(x => ({ ticks: x.ticks, qty: x.qty * mult }));
  if (!tgts.length) tgts.push({ ticks: sl > 0 ? sl * 2 : 20, qty: mult }); // fallback single target
  const totalQty = tgts.reduce((s, x) => s + x.qty, 0);
  tgts.sort((x, y) => x.ticks - y.ticks);
  const stopPrice = sl > 0 ? rnd(side === 'long' ? px - sl * TICK : px + sl * TICK) : null;   // planned stop + target prices (kept for the journal/CSV)
  const tps = tgts.map(tg => ({ ticks: tg.ticks, qty: tg.qty, price: rnd(side === 'long' ? px + tg.ticks * TICK : px - tg.ticks * TICK) }));
  position = { side, qty: totalQty, entry: px, entryTime: t, atm: atmName, slTicks: sl, maxFav: px, beDone: false, stopPrice, tps };
  orders = [];
  if (sl > 0) orders.push({ type: 'stop', price: stopPrice, qty: totalQty });
  tps.forEach(tg => orders.push({ type: 'target', ticks: tg.ticks, qty: tg.qty, price: tg.price }));
  addMarker(t, side === 'long' ? 'belowBar' : 'aboveBar', side === 'long' ? '#26a69a' : '#ef5350', side === 'long' ? 'arrowUp' : 'arrowDown', `${side === 'long' ? 'L' : 'S'}${totalQty} ${f2(px)}`);
  drawLines(); renderLive();
}

function flatten() { if (position) exitQty(position.qty, curPx(), curBaseT(), 'manual'); else cancelEntry(); }
function reverse() { if (!position) return; const s = position.side; exitQty(position.qty, curPx(), curBaseT(), 'reverse'); onEntryButtonDirect(s === 'long' ? 'short' : 'long'); }
function onEntryButtonDirect(side) { openPosition(side, curPx(), curBaseT(), activeAtm, resolveQty(side, 'market')); }
function placeBreakout(side) {   // Buy/Sell Stop: stop-entry at the current bar high +1t (buy) / low -1t (sell). SL/TP come from the active ATM, SNAPSHOTTED to this signal bar so they never jump to a later (fill) bar.
  if (position) return toast('Already in a position — flatten first');
  if (!baseBars.length) return;
  const long = side === 'long', a = atm[activeAtm] || {}, ext = curBarExtreme();
  const price = rnd(long ? ext.hi + TICK : ext.lo - TICK);
  let bracket;
  if (a.struct) {   // structural stop snapshotted from THIS bar; target = rr × risk (fixed now, not recomputed at fill)
    const stopPx = structStopPx(side, price, a);
    const slT = Math.max(1, Math.round(Math.abs(price - stopPx) / TICK));
    bracket = { slTicks: slT, tgts: [{ ticks: Math.max(1, Math.round(slT * (a.rr || 1))), qty: 1 }] };
  } else {
    bracket = bracketFromAtm(activeAtm);   // fixed SL/TP ticks straight from the ATM template
  }
  const mult = (riskOn && sizeForRisk(bracket.slTicks)) ? sizeForRisk(bracket.slTicks) : Math.max(1, parseInt($('qty').value, 10) || 1);
  entryOrder = { side, kind: 'stop', price, atm: activeAtm, mult, slTicks: bracket.slTicks, tgts: bracket.tgts };
  const inp = $('entryPrice'); if (inp) inp.value = f2(price);
  toast(`${long ? 'Buy' : 'Sell'} Stop @ ${f2(price)} · ${activeAtm}`);
  drawLines(); renderLive();
}

// synthetic bar = only the price action AFTER a stop-entry fill at E, so the fill bar can still
// hit SL/TP this bar without a false trigger from its pre-entry range (price rose/fell to E first).
function postEntryBar(b) {
  const E = position.entry, long = position.side === 'long';
  return long ? { time: b.time, open: E, high: b.high, low: b.close < E ? b.low : E, close: b.close, volume: b.volume }
              : { time: b.time, open: E, high: b.close > E ? b.high : E, low: b.low, close: b.close, volume: b.volume };
}
// ---------- per-(1-min) bar processing ----------
function processSub(b) {
  // 1) pending entry — a STOP entry that fills now also checks SL/TP on the SAME bar (no waiting for the next)
  if (!position && entryOrder) {
    const wasStop = entryOrder.kind === 'stop';
    if (tryEntryFill(b)) { if (wasStop) b = postEntryBar(b); else return; }
  }
  if (!position) return;

  const long = position.side === 'long';
  const stop = orders.find(o => o.type === 'stop');
  // Intrabar fill ORDER (precise): each base sub-bar is processed individually, and within one
  // sub-bar that straddles BOTH stop and target we infer order from the bar's shape —
  // up bar (close>=open) traces O→low→high (low touched first); down bar traces O→high→low.
  // Long: stop is below (low side), target above; short is mirrored. → stopFirst when the
  // stop's side is the first extreme reached. (Use a finer base dataset, e.g. NQ 15s, for fewer ties.)
  const lowFirst = b.close >= b.open;
  const stopFirst = long ? lowFirst : !lowFirst;
  const doStop = () => {
    if (!stop || !position) return false;
    const sP = stop.price;
    const hit = long ? (b.open <= sP || b.low <= sP) : (b.open >= sP || b.high >= sP);
    if (hit) { const px = long ? (b.open <= sP ? b.open : sP) : (b.open >= sP ? b.open : sP); exitQty(position.qty, px, b.time, 'stop'); return true; }
    return false;
  };
  const doTargets = () => {
    const tgs = orders.filter(o => o.type === 'target').sort((x, y) => long ? x.price - y.price : y.price - x.price);
    for (const tg of tgs) {
      if (!position) break;
      const tP = tg.price;
      const hit = long ? (b.open >= tP || b.high >= tP) : (b.open <= tP || b.low <= tP);
      if (hit) { const px = long ? (b.open >= tP ? b.open : tP) : (b.open <= tP ? b.open : tP); orders = orders.filter(o => o !== tg); exitQty(tg.qty, px, b.time, 'target'); }
    }
  };
  if (stopFirst) { if (doStop()) return; doTargets(); }   // stop side reached first this sub-bar
  else { doTargets(); doStop(); }                          // target side reached first; stop takes any remainder
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
  trades.push({ entryTime: position.entryTime, exitTime: t, side: position.side, qty: q, entry: position.entry, exit: px, ticks: netTicks, pnl, R: risk > 0 ? pnl / risk : null, atm: position.atm, exitType: type, tf: (typeof tf === 'number' ? tf : BASE_TF), sym: INSTR.symbol, stop: position.stopPrice, stopTicks: position.slTicks, tps: (position.tps || []).map(p => ({ ticks: p.ticks, price: p.price })), chart: captureTradeChart(position.entryTime, t) });
  addMarker(t, long ? 'aboveBar' : 'belowBar', pnl >= 0 ? '#26a69a' : '#ef5350', long ? 'arrowDown' : 'arrowUp', usd(pnl));
  saveJSON('rt_trades', trades);
  position.qty -= q;
  if (position.qty <= 0) { position = null; orders = []; }
  else { const stop = orders.find(o => o.type === 'stop'); if (stop) stop.qty = position.qty; }
  drawLines(); renderAll();
}

// ---------- chart drawing ----------
function clearLines() { lines.forEach(l => candle.removePriceLine(l)); lines = []; }
function pl(price, color, style, title) { return candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }); }
function drawLines() { clearLines(); orderRepaint(); }   // order bracket now rendered by orderPrimitive (Tradovate tags + lines)
function addMarker(baseTime, position_, color, shape, text) { markers.push({ baseTime, position: position_, color, shape, text }); refreshMarkers(); }
function refreshMarkers() { const ms = (showTrades ? markers : []).concat(annotations); candle.setMarkers(ms.map(m => ({ time: mBucket(m.baseTime), position: m.position, color: m.color, shape: m.shape, text: m.text })).sort((a, b) => a.time - b.time)); }
function setShowTrades(on) {
  showTrades = on; saveJSON('rt_show_trades', showTrades); refreshMarkers();
  document.querySelectorAll('.hidetrades-btn').forEach(b => {   // sync every hide-trades button (top toolbar + trades panel)
    b.classList.toggle('off', !on);
    const ic = b.querySelector('.material-symbols-outlined'); if (ic) ic.textContent = on ? 'visibility' : 'visibility_off';
    const t = b.querySelector('.htxt'); if (t) t.textContent = on ? 'Hide trades' : 'Show trades';
  });
}

// ---------- rendering ----------
function renderAll() { renderLive(); renderTrades(); renderDash(); }
function renderLive() {
  $('clock').textContent = baseBars.length ? (blindDate() ? tFmt(curBaseT()).replace(/^\d\d\/\d\d\s*/, '') : tFmt(curBaseT())) : '--:--';   // blind modes: time only, date hidden
  $('clockPrice').textContent = baseBars.length ? f2(curPx()) : '--';
  maybeUpdateVP();   // recompute the prior-day volume profile when the trading day changes
  updateAlertBar();  // keep the alert-time vertical line anchored to the current session
  updateRndHud();    // game HUD: round #, live P&L, 12:30 countdown
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
  $('startSlider').disabled = lock || rndMode; $('btnStepBack').disabled = lock; $('sessionSelect').disabled = lock; $('tfSelect').disabled = lock; $('dataSelect').disabled = lock;
  const _db = $('dateBtn'); if (_db) _db.disabled = lock || rndMode;   // random mode keeps day-jump + scrub blinded
  const _pn = $('btnPrevDay'), _nn = $('btnNextDay'), _ps = $('btnPickStart');
  if (_pn) _pn.disabled = rndMode; if (_nn) _nn.disabled = rndMode; if (_ps) _ps.disabled = rndMode;
  const _dl = $('dateLabel'); if (_dl) { const _s = sessions[currentSessionIdx()]; _dl.textContent = blindDate() ? '· · ·' : (_s ? _s.key : '—'); }
  $('entryPriceRow').style.display = $('entryType').value === 'market' ? 'none' : '';
  renderRiskReadout();
}

// current replay session (= "today") tally — bucketed by the same futures trading-day key the chart uses
function todayStats() {
  const key = (sessions[currentSessionIdx()] || {}).key || null;
  const ts = key ? trades.filter(t => tradingDayKey(t.entryTime) === key) : [];
  const pnl = ts.reduce((s, t) => s + t.pnl, 0);
  return { key, n: ts.length, pnl, w: ts.filter(t => t.pnl > 0).length, l: ts.filter(t => t.pnl < 0).length };
}
function renderTrades() {
  $('tradesTable').querySelector('tbody').innerHTML = trades.map((t, i) => `<tr>
    <td>${i + 1}</td><td class="${t.side === 'long' ? 'long-tag' : 'short-tag'}">${t.side === 'long' ? 'L' : 'S'}</td><td>${t.qty}</td>
    <td>${tFmt(t.entryTime)}</td><td>${tFmt(t.exitTime)}</td>
    <td class="mono">${f2(t.entry)}</td><td class="mono">${f2(t.exit)}</td>
    <td>${t.ticks >= 0 ? '+' : ''}${t.ticks}</td><td class="${t.pnl >= 0 ? 'pos' : 'neg'}">${usd(t.pnl)}</td>
    <td>${t.R == null ? '–' : t.R.toFixed(2)}</td><td>${t.atm}</td><td>${t.exitType}</td>
    <td><button class="trade-del" data-ti="${i}" title="Delete this trade"><span class="material-symbols-outlined">close</span></button></td></tr>`).reverse().join('');
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  const td = todayStats();
  $('tradesSummary').textContent = `${trades.length} trades · Net ${usd(net)}`
    + (td.key ? `      ·  Today (${td.key}): ${usd(td.pnl)} · ${td.n} trade${td.n === 1 ? '' : 's'}` : '');
}

// ---------- Tradervue-style P&L calendar + per-trade entry/exit chart ----------
let pnlCalY = 0, pnlCalM = 0;
const POST_EXIT_BARS = 5;   // K-bars kept AFTER the sell/close in the journal snapshot
function captureTradeChart(entryT, exitT) {   // OHLC candles around the trade, bucketed at the ACTIVE timeframe, reconstructed from the full dataset
  if (!baseBars.length) return null;
  const endT = baseBars[baseBars.length - 1].time;   // full dataset end — reconstruct PAST the replay edge so the post-exit tail is always there
  const tfSec = Math.max(1, Math.round((typeof tf === 'number' ? tf : BASE_TF) * 60));   // 1 candle = 1 bar of the timeframe in view
  const dur = Math.max(tfSec, exitT - entryT);
  const prePad = Math.max(25 * tfSec, Math.round(dur * 0.8));   // lead-in context before the entry
  const exitBucket = Math.floor(exitT / tfSec) * tfSec;
  const loT = entryT - prePad, hiT = Math.min(exitBucket + (POST_EXIT_BARS + 1) * tfSec - 1, endT);   // through the end of the 5th bar after exit
  let span = tfSec; while ((hiT - loT) / span > 220) span *= 2;   // keep the candle count sane on very long trades
  const out = []; let cur = null;
  for (let i = 0; i < baseBars.length; i++) {
    const b = baseBars[i]; if (b.time < loT) continue; if (b.time > hiT) break;
    const bk = Math.floor(b.time / span) * span;
    if (!cur || cur.t !== bk) { cur = { t: bk, o: b.open, h: b.high, l: b.low, c: b.close }; out.push(cur); }
    else { cur.h = Math.max(cur.h, b.high); cur.l = Math.min(cur.l, b.low); cur.c = b.close; }
  }
  return out.length ? out : null;
}
function pnlByDay() { const m = {}; trades.forEach(t => { const k = tradingDayKey(t.entryTime); const e = m[k] || (m[k] = { net: 0, n: 0 }); e.net += t.pnl; e.n++; }); return m; }
function renderPnlCalendar() {
  const el = $('pnlCalendar'); if (!el) return;
  const byDay = pnlByDay(), keys = Object.keys(byDay).sort();
  if (!pnlCalY) { const last = keys[keys.length - 1]; if (last) { const p = last.split('-'); pnlCalY = +p[0]; pnlCalM = +p[1] - 1; } else { pnlCalY = (sessions[currentSessionIdx()] ? +sessions[currentSessionIdx()].key.split('-')[0] : 2026); pnlCalM = (sessions[currentSessionIdx()] ? +sessions[currentSessionIdx()].key.split('-')[1] - 1 : 5); } }
  const startWd = new Date(Date.UTC(pnlCalY, pnlCalM, 1)).getUTCDay(), days = new Date(Date.UTC(pnlCalY, pnlCalM + 1, 0)).getUTCDate();
  let monthNet = 0, monthDays = 0, cells = '';
  for (let i = 0; i < startWd; i++) cells += '<div class="pc-day empty"></div>';
  for (let d = 1; d <= days; d++) {
    const key = `${pnlCalY}-${pad(pnlCalM + 1)}-${pad(d)}`, e = byDay[key];
    if (e) { monthNet += e.net; monthDays++; }
    cells += `<div class="pc-day ${e ? (e.net >= 0 ? 'win' : 'loss') : ''}" ${e ? `data-day="${key}"` : ''}>`
      + `<div class="pc-d">${d}</div>` + (e ? `<div class="pc-pnl">${usd(e.net)}</div><div class="pc-n">${e.n} trade${e.n === 1 ? '' : 's'}</div>` : '') + `</div>`;
  }
  el.innerHTML =
    `<div class="pc-h"><button class="pc-nav" data-mo="-1"><span class="material-symbols-outlined">chevron_left</span></button>`
    + `<span class="pc-title">${CAL_MONTHS[pnlCalM]} ${pnlCalY} &nbsp;<b class="${monthNet >= 0 ? 'pos' : 'neg'}">${usd(monthNet)}</b> · ${monthDays}d</span>`
    + `<button class="pc-nav" data-mo="1"><span class="material-symbols-outlined">chevron_right</span></button></div>`
    + `<div class="pc-wdrow">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<span>${w}</span>`).join('')}</div>`
    + `<div class="pc-grid">${cells}</div>`;
}
function liveTradeBars(t) {   // fallback when a trade has no stored snapshot: rebuild from the current dataset if it covers the trade
  if (!baseBars.length || t.entryTime < baseBars[0].time || t.exitTime > baseBars[Math.min(baseIdx, baseBars.length - 1)].time) return null;
  return captureTradeChart(t.entryTime, t.exitTime);
}
function tfLab(v) { v = (typeof v === 'number') ? v : BASE_TF; return v < 1 ? Math.round(v * 60) + 's' : v + 'm'; }
function synthBars(t) {   // minimal entry→exit path when no candle snapshot exists, so the screenshot is never blank
  const o = t.entry, c = t.exit, hi = Math.max(o, c), lo = Math.min(o, c), mt = (t.entryTime + t.exitTime) / 2;
  return [{ t: t.entryTime, o, h: o, l: o, c: o }, { t: mt, o, h: hi, l: lo, c: (o + c) / 2 }, { t: t.exitTime, o: c, h: c, l: c, c }];
}
function tradeMarker(ctx, x, y, up, col) { const s = 7, yy = y + (up ? 13 : -13); ctx.fillStyle = col; ctx.strokeStyle = '#0b0e16'; ctx.lineWidth = 1.5; ctx.beginPath(); if (up) { ctx.moveTo(x, yy - s); ctx.lineTo(x - s, yy + s); ctx.lineTo(x + s, yy + s); } else { ctx.moveTo(x, yy + s); ctx.lineTo(x - s, yy - s); ctx.lineTo(x + s, yy - s); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
function priceTag(ctx, xRight, y, text, col) {   // price label pinned to the right gutter on its level line
  ctx.font = '700 11px ui-monospace,monospace'; const w = ctx.measureText(text).width + 12, h = 16, x = xRight - w, yt = Math.max(1, Math.min(y - h / 2, 242));
  rrect(ctx, x, yt, w, h, 3); ctx.fillStyle = col; ctx.fill(); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, x + 6, yt + h / 2);
}
function swingPivots(bars, k) {   // local swing highs/lows: bar i is a pivot if its high/low is the extreme within ±k bars
  const out = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k && (isH || isL); j++) { if (j === i) continue; if (bars[j].h >= bars[i].h) isH = false; if (bars[j].l <= bars[i].l) isL = false; }
    if (isH) out.push({ i, price: bars[i].h, type: 'H' });
    if (isL) out.push({ i, price: bars[i].l, type: 'L' });
  }
  return out;
}
// pan-drag state shared across review canvases (document-level so a drag can continue off-canvas; added once)
let _ddDrag = null;
document.addEventListener('mousemove', (e) => {
  if (!_ddDrag) return; const c = _ddDrag.c; if (!c || !c._view || !c._n) return;
  const L = 6, RG = 70, plotW = Math.max(10, (c.clientWidth || 680) - L - RG);
  const v = _ddDrag.view, width = v.to - v.from;
  let from = v.from - (e.clientX - _ddDrag.startX) * (width / plotW);
  from = Math.max(0, Math.min(c._n - width, from));
  c._view = { from, to: from + width }; drawTradeChart(c, c._t);
});
document.addEventListener('mouseup', () => { if (_ddDrag) { if (_ddDrag.c) _ddDrag.c.style.cursor = 'grab'; _ddDrag = null; } });
function mountTradeChart(c, t) {   // wire zoom (wheel) + pan (drag) + reset (dbl-click) on a trade-review canvas, then draw
  c._t = t; c._view = null;        // fresh full view each open
  if (!c._wired) {
    c._wired = true; c.style.cursor = 'grab';
    c.addEventListener('wheel', (e) => {
      e.preventDefault(); if (!c._view || !c._n) return;
      const L = 6, RG = 70, plotW = Math.max(10, (c.clientWidth || 680) - L - RG);
      const frac = Math.max(0, Math.min(1, (e.clientX - c.getBoundingClientRect().left - L) / plotW));
      const v = c._view, cur = v.from + frac * (v.to - v.from);
      let w = Math.max(4, Math.min(c._n, (v.to - v.from) * (e.deltaY > 0 ? 1.2 : 1 / 1.2)));
      let from = Math.max(0, Math.min(c._n - w, cur - frac * w));
      c._view = { from, to: from + w }; drawTradeChart(c, c._t);
    }, { passive: false });
    c.addEventListener('mousedown', (e) => { if (e.button !== 0) return; _ddDrag = { c, startX: e.clientX, view: { ...c._view } }; c.style.cursor = 'grabbing'; e.preventDefault(); });
    c.addEventListener('dblclick', () => { c._view = { from: 0, to: c._n }; drawTradeChart(c, c._t); });
  }
  drawTradeChart(c, t);
}
function drawTradeChart(c, t) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssW = (c.clientWidth && c.clientWidth > 40) ? c.clientWidth : 680, cssH = 260;   // match the element so candles never squish
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH; ctx.clearRect(0, 0, W, H);
  let bars = (t.chart && t.chart.length) ? t.chart : liveTradeBars(t), synth = false;
  if (!bars || !bars.length) { bars = synthBars(t); synth = true; }
  const n = bars.length; c._n = n;
  if (!c._view) c._view = { from: 0, to: n };          // view = [from,to) in bar-index space (fractional for smooth zoom)
  let from = Math.max(0, c._view.from), to = Math.min(n, c._view.to);
  if (to - from < 2) { to = Math.min(n, from + 2); from = Math.max(0, to - 2); }
  c._view = { from, to };
  const L = 6, RG = 70, TH = 22, BH = 16, padY = 8, top = TH, bot = H - BH, plotW = W - L - RG;
  const x = i => L + (i + 0.5 - from) / (to - from) * plotW, slot = plotW / (to - from), bw = Math.max(1.2, slot * 0.62);
  const idxAt = ts => { const i = bars.findIndex(b => b.t >= ts); return i < 0 ? n - 1 : i; };
  const eIdx = idxAt(t.entryTime), xIdx = idxAt(t.exitTime), eX = x(eIdx), xX = x(xIdx), inPlot = px => px >= L - 1 && px <= W - RG + 1;
  const i0 = Math.max(0, Math.floor(from)), i1 = Math.min(n - 1, Math.ceil(to) - 1), vis = bars.slice(i0, i1 + 1);
  let lo = Math.min(...vis.map(b => b.l)), hi = Math.max(...vis.map(b => b.h));
  if (inPlot(eX)) { lo = Math.min(lo, t.entry); hi = Math.max(hi, t.entry); }
  if (inPlot(xX)) { lo = Math.min(lo, t.exit); hi = Math.max(hi, t.exit); }
  const rng = (hi - lo) || 1, y = p => top + padY + (hi - p) / rng * (bot - top - 2 * padY);
  const long = t.side === 'long', eY = y(t.entry), xY = y(t.exit);
  // header band — symbol · timeframe · side (left), P&L · ticks · R (right)
  const head = `${t.sym || INSTR.symbol} · ${tfLab(t.tf)}`;
  ctx.fillStyle = '#0f1320'; ctx.fillRect(0, 0, W, TH);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#d1d4dc'; ctx.fillText(head, L + 2, TH / 2);
  ctx.fillStyle = long ? '#26a69a' : '#ef5350'; ctx.fillText(`  ${long ? 'LONG' : 'SHORT'} ${t.qty}`, L + 2 + ctx.measureText(head).width, TH / 2);
  if (W > 360) {
    ctx.textAlign = 'right'; ctx.fillStyle = t.pnl >= 0 ? '#26a69a' : '#ef5350'; ctx.font = '700 12px ui-monospace,monospace';
    ctx.fillText(`${usd(t.pnl)} · ${t.ticks >= 0 ? '+' : ''}${t.ticks}t · ${t.R == null ? '–' : (t.R >= 0 ? '+' : '') + t.R.toFixed(2) + 'R'}`, W - 6, TH / 2);
    ctx.textAlign = 'left';
  }
  ctx.save(); ctx.beginPath(); ctx.rect(L, top, plotW, bot - top); ctx.clip();   // everything that scrolls is clipped to the plot
  // trade-span shading
  const sx = Math.min(eX, xX), sw = Math.max(2, Math.abs(xX - eX));
  ctx.fillStyle = t.pnl >= 0 ? 'rgba(38,166,154,.09)' : 'rgba(239,83,80,.09)'; ctx.fillRect(sx, top, sw, bot - top);
  // recent high / low of the visible window: reference lines + price levels (左側標 H/L 點位)
  const vHi = Math.max(...vis.map(b => b.h)), vLo = Math.min(...vis.map(b => b.l));
  ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,158,176,.45)';
  [vHi, vLo].forEach(p => { const yy = y(p); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - RG, yy); ctx.stroke(); });
  ctx.setLineDash([]); ctx.font = '700 10px ui-monospace,monospace'; ctx.fillStyle = '#aeb6c6'; ctx.textAlign = 'left';
  ctx.textBaseline = 'top'; ctx.fillText('H ' + f2(vHi), L + 3, y(vHi) + 2);
  ctx.textBaseline = 'bottom'; ctx.fillText('L ' + f2(vLo), L + 3, y(vLo) - 2);
  // candles (visible range only)
  for (let i = i0; i <= i1; i++) { const b = bars[i], up = b.c >= b.o; ctx.strokeStyle = ctx.fillStyle = up ? '#26a69a' : '#ef5350'; const cx = x(i);
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, y(b.h)); ctx.lineTo(cx, y(b.l)); ctx.stroke();
    const yo = y(b.o), yc = y(b.c); ctx.fillRect(cx - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yo - yc))); }
  // recent swing pivots: small dots + thinned price labels (近期高低點 以及點位)
  const piv = swingPivots(bars, 3); let lastHx = -99, lastLx = -99; ctx.textAlign = 'center';
  piv.forEach(p => { if (p.i < i0 || p.i > i1) return; const up = p.type === 'H', px = x(p.i), py = y(p.price);
    ctx.fillStyle = up ? '#26a69a' : '#ef5350'; ctx.beginPath(); ctx.arc(px, py + (up ? -3 : 3), 2, 0, 6.2832); ctx.fill();
    const last = up ? lastHx : lastLx; if (Math.abs(px - last) > 30) { ctx.font = '9px ui-monospace,monospace'; ctx.fillStyle = up ? '#7fd4cb' : '#f1a3a1'; ctx.textBaseline = up ? 'bottom' : 'top'; ctx.fillText(f2(p.price), px, up ? py - 7 : py + 7); if (up) lastHx = px; else lastLx = px; } });
  // entry / exit level lines + markers
  ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#2962ff'; ctx.beginPath(); ctx.moveTo(L, eY); ctx.lineTo(W - RG, eY); ctx.stroke();
  ctx.strokeStyle = t.pnl >= 0 ? '#26a69a' : '#ef5350'; ctx.beginPath(); ctx.moveTo(L, xY); ctx.lineTo(W - RG, xY); ctx.stroke();
  ctx.setLineDash([]);
  if (inPlot(eX)) tradeMarker(ctx, eX, eY, long, '#2962ff');
  if (inPlot(xX)) tradeMarker(ctx, xX, xY, !long, t.pnl >= 0 ? '#26a69a' : '#ef5350');
  ctx.restore();
  // gutter price tags (entry/exit) — outside the clip
  priceTag(ctx, W - 3, eY, f2(t.entry), '#2962ff');
  priceTag(ctx, W - 3, xY, f2(t.exit), t.pnl >= 0 ? '#26a69a' : '#ef5350');
  if (W > 300) {
    const tmShort = ts => tFmt(ts).replace(/^\d\d\/\d\d\s*/, '');
    ctx.font = '10px ui-monospace,monospace'; ctx.fillStyle = '#787b86'; ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText('In ' + tmShort(t.entryTime), L + 2, H - 2);
    ctx.textAlign = 'right'; ctx.fillText('Out ' + tmShort(t.exitTime), W - RG - 2, H - 2); ctx.textAlign = 'left';
  }
  if (synth) { ctx.font = '10px sans-serif'; ctx.fillStyle = '#5d6573'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('no bar snapshot — entry/exit only', W / 2, TH + 12); ctx.textAlign = 'left'; }
}
function openDayDetail(key) {
  const el = $('dayDetail'); if (!el) return;
  const ts = trades.filter(t => tradingDayKey(t.entryTime) === key).sort((a, b) => a.entryTime - b.entryTime);
  const net = ts.reduce((s, t) => s + t.pnl, 0), w = ts.filter(t => t.pnl > 0).length, l = ts.filter(t => t.pnl < 0).length;
  el.innerHTML = `<div class="dd-card"><div class="dd-h"><div><span class="dd-date">${key}</span> &nbsp;<b class="${net >= 0 ? 'pos' : 'neg'}">${usd(net)}</b> · ${ts.length} trades · ${w}W ${l}L</div>`
    + `<button class="dd-x" id="ddClose"><span class="material-symbols-outlined">close</span></button></div><div class="dd-list">`
    + ts.map((t, i) => { const long = t.side === 'long';
      return `<div class="dd-trade"><div class="dd-tinfo"><div class="dd-trow">#${i + 1} <span class="${long ? 'long-tag' : 'short-tag'}">${long ? 'LONG' : 'SHORT'} ${t.qty}</span> <b class="${t.pnl >= 0 ? 'pos' : 'neg'}">${usd(t.pnl)}</b> · ${t.ticks >= 0 ? '+' : ''}${t.ticks}t · ${t.R == null ? '–' : (t.R >= 0 ? '+' : '') + t.R.toFixed(2) + 'R'}</div>`
        + `<div class="dd-sub">${tFmt(t.entryTime)} → ${tFmt(t.exitTime)} · ${f2(t.entry)} → ${f2(t.exit)} · ${t.atm} · ${t.exitType}</div></div>`
        + `<canvas class="dd-chart" data-ti="${i}" title="Scroll to zoom · drag to pan · double-click to reset"></canvas></div>`; }).join('')
    + `</div></div>`;
  el.classList.add('open');
  requestAnimationFrame(() => el.querySelectorAll('.dd-chart').forEach(c => mountTradeChart(c, ts[+c.dataset.ti])));   // draw after layout so canvas clientWidth is real
  $('ddClose').onclick = closeDayDetail;
}
function closeDayDetail() { const el = $('dayDetail'); if (el) { el.classList.remove('open'); el.innerHTML = ''; } }
// ---------- Tradervue-style session overview ----------
function sessionStats() {   // per trading-day breakdown, most-recent first
  const byDay = {};
  trades.forEach(t => { const k = tradingDayKey(t.entryTime); (byDay[k] ??= []).push(t); });
  return Object.entries(byDay).map(([day, ts]) => {
    const net = ts.reduce((s, t) => s + t.pnl, 0), w = ts.filter(t => t.pnl > 0), l = ts.filter(t => t.pnl < 0);
    const gw = w.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
    const r = ts.filter(t => t.R != null).reduce((s, t) => s + t.R, 0);
    return { day, n: ts.length, w: w.length, l: l.length, winRate: (w.length + l.length) ? w.length / (w.length + l.length) * 100 : 0,
             net, pf: gl ? gw / gl : (gw ? Infinity : 0), best: Math.max(0, ...ts.map(t => t.pnl)), worst: Math.min(0, ...ts.map(t => t.pnl)), r };
  }).sort((a, b) => a.day < b.day ? 1 : -1);
}
function tradervueStats() {
  const w = trades.filter(t => t.pnl > 0), l = trades.filter(t => t.pnl < 0), sc = trades.filter(t => t.pnl === 0), n = trades.length;
  const net = trades.reduce((s, t) => s + t.pnl, 0), gw = w.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
  const avgWin = w.length ? gw / w.length : 0, avgLoss = l.length ? -gl / l.length : 0;
  const rs = trades.filter(t => t.R != null).map(t => t.R), totalR = rs.reduce((a, b) => a + b, 0);
  let mcw = 0, mcl = 0, cw = 0, cl = 0;
  [...trades].sort((a, b) => a.exitTime - b.exitTime).forEach(t => { if (t.pnl > 0) { cw++; cl = 0; mcw = Math.max(mcw, cw); } else if (t.pnl < 0) { cl++; cw = 0; mcl = Math.max(mcl, cl); } else { cw = 0; cl = 0; } });
  const days = sessionStats(), D = days.length;
  return { n, w: w.length, l: l.length, sc: sc.length, net, pf: gl ? gw / gl : (gw ? Infinity : 0),
    winRate: (w.length + l.length) ? w.length / (w.length + l.length) * 100 : 0, avgTrade: n ? net / n : 0, avgWin, avgLoss,
    wlRatio: avgLoss ? Math.abs(avgWin / avgLoss) : 0, largestWin: Math.max(0, ...trades.map(t => t.pnl)), largestLoss: Math.min(0, ...trades.map(t => t.pnl)),
    totalR, avgR: rs.length ? totalR / rs.length : 0, mcw, mcl, D, winDays: days.filter(d => d.net > 0).length, avgDaily: D ? net / D : 0,
    bestDay: D ? Math.max(...days.map(d => d.net)) : 0, worstDay: D ? Math.min(...days.map(d => d.net)) : 0 };
}
function renderTvStats() {
  const el = $('tvStats'); if (!el) return;
  if (!trades.length) { el.innerHTML = '<div class="tv-empty">No trades yet</div>'; return; }
  const s = tradervueStats(), sg = v => (v >= 0 ? 'pos' : 'neg');
  const row = (k, v, c = '') => `<div class="tv-row"><span class="tv-k">${k}</span><span class="tv-v ${c}">${v}</span></div>`;
  el.innerHTML =
    row('Total P&L', usd(s.net), sg(s.net)) + row('Total trades', s.n) + row('Winners', s.w, 'pos') + row('Losers', s.l, 'neg') +
    row('Scratches', s.sc) + row('Win rate', s.winRate.toFixed(1) + '%') + row('Profit factor', s.pf === Infinity ? '∞' : s.pf.toFixed(2)) +
    row('Avg trade', usd(s.avgTrade), sg(s.avgTrade)) + row('Avg win', usd(s.avgWin), 'pos') + row('Avg loss', usd(s.avgLoss), 'neg') +
    row('Win / loss ratio', s.wlRatio.toFixed(2)) + row('Largest win', usd(s.largestWin), 'pos') + row('Largest loss', usd(s.largestLoss), 'neg') +
    row('Max consec W / L', s.mcw + ' / ' + s.mcl) + row('Total R', (s.totalR >= 0 ? '+' : '') + s.totalR.toFixed(2), sg(s.totalR)) +
    row('Avg R', (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2)) + row('Days traded', s.D ? `${s.D} (${s.winDays}W)` : '0') +
    row('Avg daily P&L', usd(s.avgDaily), sg(s.avgDaily)) + row('Best day', usd(s.bestDay), 'pos') + row('Worst day', usd(s.worstDay), 'neg');
}
function renderSessionTable() {
  const el = $('sessionTable'); if (!el) return;
  const days = sessionStats();
  if (!days.length) { el.innerHTML = '<div class="tv-empty">No sessions yet — take some trades</div>'; return; }
  el.innerHTML = `<table class="tv-table"><thead><tr><th>Date</th><th>Trades</th><th>W</th><th>L</th><th>Win%</th><th>PF</th><th>R</th><th>Net P&L</th><th>Best</th><th>Worst</th></tr></thead><tbody>` +
    days.map(d => `<tr><td class="tv-date">${d.day}</td><td>${d.n}</td><td class="pos">${d.w}</td><td class="neg">${d.l}</td><td>${d.winRate.toFixed(0)}%</td><td>${d.pf === Infinity ? '∞' : d.pf.toFixed(2)}</td><td class="${d.r >= 0 ? 'pos' : 'neg'}">${(d.r >= 0 ? '+' : '') + d.r.toFixed(1)}</td><td class="tv-net ${d.net >= 0 ? 'pos' : 'neg'}">${usd(d.net)}</td><td class="pos">${d.best ? usd(d.best) : '–'}</td><td class="neg">${d.worst ? usd(d.worst) : '–'}</td></tr>`).join('') +
    `</tbody></table>`;
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
  const td = todayStats();
  $('todayPnl').className = 'todaypnl ' + (td.n === 0 ? 'flat' : (td.pnl >= 0 ? 'pos' : 'neg'));
  $('todayPnl').innerHTML = `<span class="tp-label">Today</span><span class="tp-date">${td.key || '—'}</span>`
    + `<span class="tp-val ${td.pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}">${usd(td.pnl)}</span>`
    + `<span class="tp-sub">${td.n ? `${td.n} trade${td.n === 1 ? '' : 's'} · ${td.w}W ${td.l}L` : 'no trades yet'}</span>`;
  renderPnlCalendar(); renderTvStats(); renderSessionTable();
  drawEquity();
  $('panelDash').title = `Max Drawdown ${usd(dd)}`;
}
function drawEquity() {
  const c = $('equity'), ctx = c.getContext('2d'); const W = c.width = c.clientWidth || 600, H = c.height;
  ctx.clearRect(0, 0, W, H);
  if (!trades.length) { ctx.fillStyle = '#787b86'; ctx.fillText('No trades yet', 10, 20); return; }
  const eq = []; let s = 0; trades.forEach(t => { s += t.pnl; eq.push(s); });
  const lo = Math.min(0, ...eq), hi = Math.max(0, ...eq), rng = (hi - lo) || 1;
  const x = i => 4 + i * (W - 8) / Math.max(1, eq.length - 1), y = v => H - 6 - (v - lo) / rng * (H - 12);
  ctx.strokeStyle = '#2a2e39'; ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0)); ctx.stroke();
  ctx.strokeStyle = s >= 0 ? '#26a69a' : '#ef5350'; ctx.lineWidth = 1.5; ctx.beginPath(); eq.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))); ctx.stroke();
}

// ---------- ATM editor ----------
// Distances (stop, targets, breakeven, trail) are ALWAYS stored in ticks — the fill engine, saved
// templates and every $ calc read ticks. `atmUnit` only changes what the editor shows and accepts,
// so switching it can never alter an existing template or a live bracket. 1 tick = TICK points
// (0.25 on NQ/ES), and TICK follows the loaded instrument, so the conversion re-derives per dataset.
let atmUnit = loadJSON('rt_atm_unit', 'ticks');
function unitLbl() { return atmUnit === 'pts' ? 'pts' : 'ticks'; }
function tkToDisp(ticks) { return atmUnit === 'pts' ? +(ticks * TICK).toFixed(4) : ticks; }
function dispToTk(v) { const n = +v || 0; return atmUnit === 'pts' ? Math.round(n / TICK) : Math.round(n); }   // pts land on a whole tick — 10.3 pts on NQ becomes 41t, not 41.2t
function applyAtmUnitUI() {
  const u = unitLbl(), step = atmUnit === 'pts' ? String(TICK) : '1';
  const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  set('lblAtmSL', `Stop SL (${u})`); set('lblAtmTgtU', u);
  set('lblAtmBE', `Trigger / offset (${u})`); set('lblAtmTrail', `Start / distance (${u})`);
  ['atmSL', 'atmT1t', 'atmT2t', 'atmT3t', 'atmBEtrig', 'atmBEoff', 'atmTrailTrig', 'atmTrailDist', 'slInput', 'tpInput']
    .forEach(id => { const el = $(id); if (el) el.step = step; });
  set('lblSlU', u); set('lblTpU', u);
  [$('atmUnit'), $('ordUnit')].forEach(sel => { if (sel && sel.value !== atmUnit) sel.value = atmUnit; });   // the editor's and the order panel's unit pickers are one setting
}
function setAtmUnit(u) { atmUnit = (u === 'pts' ? 'pts' : 'ticks'); saveJSON('rt_atm_unit', atmUnit); applyAtmUnitUI(); loadAtmIntoEditor($('atmSelect').value || activeAtm); syncRrField(); renderRiskReadout(); }
function buildAtmSelect() { $('atmSelect').innerHTML = Object.keys(atm).map(k => `<option ${k === activeAtm ? 'selected' : ''}>${k}</option>`).join(''); applyAtmUnitUI(); loadAtmIntoEditor(activeAtm); syncRrField(); }
function syncRrField() {   // show the Target-R dial for structural ATMs, or the inline Stop/Target boxes for the custom one
  const f = $('rrField'); if (!f) return; const a = atm[activeAtm] || {};
  if (a.struct) { f.style.display = ''; $('rrInput').value = a.rr || 1; } else f.style.display = 'none';
  const show = !!a.custom;
  ['ordUnitField', 'slField', 'tpField'].forEach(id => { const el = $(id); if (el) el.style.display = show ? '' : 'none'; });
  if (show) { $('slInput').value = tkToDisp(a.sl || 0); $('tpInput').value = tkToDisp((a.targets && a.targets[0]) ? a.targets[0].ticks : 0); }
}
function setCustomBracket() {   // write the inline boxes back into the Custom SL/TP preset (stored in ticks, as every ATM is)
  const a = atm[activeAtm]; if (!a || !a.custom) return;
  a.sl = Math.max(0, dispToTk($('slInput').value));
  const tp = Math.max(0, dispToTk($('tpInput').value));
  a.targets = tp > 0 ? [{ ticks: tp, qty: (a.targets && a.targets[0] ? a.targets[0].qty : 1) || 1 }] : [];
  saveJSON('rt_atm', atm); renderRiskReadout(); drawLines(); repaintOverlays();
}
function setRr(v) { const a = atm[activeAtm]; if (!a || !a.struct) return; a.rr = Math.max(0.25, Math.round(v * 4) / 4); $('rrInput').value = a.rr; saveJSON('rt_atm', atm); renderRiskReadout(); }
function loadAtmIntoEditor(name) {
  const a = atm[name]; if (!a) return; const t = a.targets || [];
  $('atmName').value = name; $('atmSL').value = tkToDisp(a.sl);
  $('atmT1t').value = tkToDisp(t[0] ? t[0].ticks : 0); $('atmT1q').value = t[0] ? t[0].qty : 0;
  $('atmT2t').value = tkToDisp(t[1] ? t[1].ticks : 0); $('atmT2q').value = t[1] ? t[1].qty : 0;
  $('atmT3t').value = tkToDisp(t[2] ? t[2].ticks : 0); $('atmT3q').value = t[2] ? t[2].qty : 0;
  $('atmBEon').checked = a.be.on; $('atmBEtrig').value = tkToDisp(a.be.trig); $('atmBEoff').value = tkToDisp(a.be.off);
  $('atmTrailon').checked = a.trail.on; $('atmTrailTrig').value = tkToDisp(a.trail.trig); $('atmTrailDist').value = tkToDisp(a.trail.dist);
}
function saveAtm() {
  const name = $('atmName').value.trim(); if (!name) return toast('Template needs a name');
  const targets = [];
  [['atmT1t', 'atmT1q'], ['atmT2t', 'atmT2q'], ['atmT3t', 'atmT3q']].forEach(([t, q]) => { const tk = dispToTk($(t).value), qy = +$(q).value; if (tk > 0 && qy > 0) targets.push({ ticks: tk, qty: qy }); });
  if (!targets.length) return toast(`At least one target (${unitLbl()} & qty > 0)`);
  atm[name] = { sl: dispToTk($('atmSL').value), targets, be: { on: $('atmBEon').checked, trig: dispToTk($('atmBEtrig').value), off: dispToTk($('atmBEoff').value) }, trail: { on: $('atmTrailon').checked, trig: dispToTk($('atmTrailTrig').value), dist: dispToTk($('atmTrailDist').value) } };
  saveJSON('rt_atm', atm); activeAtm = name; buildAtmSelect(); toast('Saved ' + name);
}
function delAtm() { const name = $('atmName').value.trim(); if (atm[name] && Object.keys(atm).length > 1) { delete atm[name]; saveJSON('rt_atm', atm); activeAtm = Object.keys(atm)[0]; buildAtmSelect(); toast('Deleted ' + name); } }

// ---------- misc ----------
let toastT = null;
function toast(msg) { let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); } el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1600); }
function tradeBars(t) {   // the journal candle snapshot for a trade — stored at exit (incl. post-exit tail), else reconstructed from the current dataset
  if (t.chart && t.chart.length) return t.chart;
  const lb = liveTradeBars(t); return lb && lb.length ? lb : [];
}
function tradeTrend(t, _bars) {   // price-action / 走勢 stats from the export window: excursion + trend before entry + follow-through after exit (ticks)
  const bars = (_bars && _bars.length) ? _bars : tradeBars(t); if (!bars.length) return { mfe: '', mae: '', post: '', pre: '', hi: '', lo: '' };
  const tick = (t.sym === INSTR.symbol ? INSTR.tickSize : (INSTR.tickSize || 0.25)) || 0.25, long = t.side === 'long';
  const span = bars.length > 1 ? (bars[1].t - bars[0].t) : Math.max(1, Math.round((t.tf != null ? t.tf : BASE_TF) * 60));
  const eb = Math.floor(t.entryTime / span) * span, xb = Math.floor(t.exitTime / span) * span;
  const inB = bars.filter(b => b.t >= eb && b.t <= xb), aft = bars.filter(b => b.t > xb), bef = bars.filter(b => b.t < eb);
  let mfe = 0, mae = 0;
  if (inB.length) { const hi = Math.max(...inB.map(b => b.h)), lo = Math.min(...inB.map(b => b.l)); mfe = long ? hi - t.entry : t.entry - lo; mae = long ? t.entry - lo : hi - t.entry; }
  const post = aft.length ? (long ? aft[aft.length - 1].c - t.exit : t.exit - aft[aft.length - 1].c) : 0;   // + = price kept going your way after exit (left money on the table)
  const pre = bef.length ? (long ? t.entry - bef[0].o : bef[0].o - t.entry) : 0;                            // + = you entered with momentum (price trended your way into entry)
  const tk = v => Math.round(v / tick);
  return { mfe: tk(Math.max(0, mfe)), mae: tk(Math.max(0, mae)), post: tk(post), pre: tk(pre), hi: f2(Math.max(...bars.map(b => b.h))), lo: f2(Math.min(...bars.map(b => b.l))) };
}
function tradeLevels(t) {   // planned stop + take-profit price/distance — stored on new trades, derived (from R / ATM / exit) for older ones
  const tick = INSTR.tickSize || 0.25, long = t.side === 'long';
  let stopTicks = (t.stopTicks != null) ? t.stopTicks : (t.R ? Math.round(Math.abs(t.ticks / t.R)) : null);
  let stopPrice = (t.stop != null) ? t.stop : (stopTicks != null ? rnd(long ? t.entry - stopTicks * tick : t.entry + stopTicks * tick) : null);
  let tps = (t.tps && t.tps.length) ? t.tps.slice() : null;
  if (!tps) {
    const a = atm[t.atm];
    if (a && a.struct && stopTicks != null) tps = [{ ticks: Math.max(1, Math.round(stopTicks * (a.rr || 1))) }];
    else if (a && a.targets && a.targets.length) tps = a.targets.map(x => ({ ticks: x.ticks }));
    else if (t.exitType === 'target') tps = [{ ticks: Math.abs(t.ticks) }];
    if (tps) tps = tps.map(x => ({ ticks: x.ticks, price: rnd(long ? t.entry + x.ticks * tick : t.entry - x.ticks * tick) }));
  }
  return {
    stopPrice: stopPrice != null ? f2(stopPrice) : '', stopTicks: stopTicks != null ? stopTicks : '',
    tpPrice: tps && tps.length ? tps.map(p => f2(p.price)).join('|') : '', tpTicks: tps && tps.length ? tps.map(p => p.ticks).join('|') : ''
  };
}
function dlCsv(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); }
const EXPORT_PAD_BARS = 80;   // K-bars kept BEFORE the entry and AFTER the exit in the CSV export window
function exportBars(t, pad) {   // reconstruct `pad` candles before entry + the in-trade candles + `pad` candles after exit, at the trade's own timeframe, from the full dataset
  pad = pad || EXPORT_PAD_BARS;
  const sameSym = !t.sym || t.sym === INSTR.symbol;
  if (!(baseBars.length && sameSym && t.entryTime >= baseBars[0].time && t.exitTime <= baseBars[baseBars.length - 1].time))
    return tradeBars(t);   // trade isn't covered by the loaded dataset -> fall back to the stored snapshot
  const tfSec = Math.max(1, Math.round((t.tf != null ? t.tf : BASE_TF) * 60));
  const cand = []; let cur = null;                       // bucket the whole dataset to the trade's timeframe
  for (let i = 0; i < baseBars.length; i++) {
    const b = baseBars[i], bk = Math.floor(b.time / tfSec) * tfSec;
    if (!cur || cur.t !== bk) { cur = { t: bk, o: b.open, h: b.high, l: b.low, c: b.close }; cand.push(cur); }
    else { cur.h = Math.max(cur.h, b.high); cur.l = Math.min(cur.l, b.low); cur.c = b.close; }
  }
  const eBk = Math.floor(t.entryTime / tfSec) * tfSec, xBk = Math.floor(t.exitTime / tfSec) * tfSec;
  let ei = cand.findIndex(c => c.t >= eBk); if (ei < 0) ei = 0;
  let xi = cand.findIndex(c => c.t >= xBk); if (xi < 0) xi = cand.length - 1;
  return cand.slice(Math.max(0, ei - pad), Math.min(cand.length - 1, xi + pad) + 1);   // `pad` bars each side of the trade
}
function exportCsv() {   // ONE file, two sections: [TRADES] summary (+stop/TP +price-trend cols) then [BARS] per-trade candles (80 before entry + 80 after exit)
  if (!trades.length) return toast('No trades to export');
  const xbars = trades.map(t => exportBars(t));   // 80-before-entry … 80-after-exit window per trade, reconstructed from the dataset
  // section 1 — trade summary (stop/take-profit levels + price-trend / 走勢 columns over the export window)
  const head = 'idx,side,qty,entryTime,exitTime,entry,exit,stopPrice,stopTicks,tpPrice,tpTicks,ticks,pnl,R,atm,exitType,tf,sym,bars,mfeTicks,maeTicks,preTrendTicks,postExitTicks,windowHigh,windowLow';
  const rows = trades.map((t, i) => { const tr = tradeTrend(t, xbars[i]), lv = tradeLevels(t); return [i + 1, t.side, t.qty, tFmt(t.entryTime), tFmt(t.exitTime), t.entry, t.exit, lv.stopPrice, lv.stopTicks, lv.tpPrice, lv.tpTicks, t.ticks, t.pnl, t.R == null ? '' : t.R.toFixed(3), t.atm, t.exitType, t.tf != null ? t.tf : '', t.sym || INSTR.symbol, xbars[i].length, tr.mfe, tr.mae, tr.pre, tr.post, tr.hi, tr.lo].join(','); });
  // section 2 — per-trade chart bars (long format): 80 before entry + in-trade + 80 after exit; seg = before|in|after
  const bhead = 'trade_idx,seg,bar_epoch,bar_time,open,high,low,close';
  const brows = [];
  trades.forEach((t, i) => {
    const bars = xbars[i]; if (!bars.length) return;
    const span = bars.length > 1 ? (bars[1].t - bars[0].t) : Math.max(1, Math.round((t.tf != null ? t.tf : BASE_TF) * 60));
    const eb = Math.floor(t.entryTime / span) * span, xb = Math.floor(t.exitTime / span) * span;
    bars.forEach(b => { const seg = b.t < eb ? 'before' : (b.t > xb ? 'after' : 'in'); brows.push([i + 1, seg, b.t, tFmt(b.t), b.o, b.h, b.l, b.c].join(',')); });
  });
  const out = ['# TRADES', head, ...rows, '', '# BARS (per-trade candles · seg=before|in|after · 80 bars before entry + 80 bars after exit)', bhead, ...brows].join('\n');
  dlCsv('replay_trades.csv', out);
  toast(`Exported ${trades.length} trades + ${brows.length} bars (1 file)`);
}
function resetAll() { if (!confirm('Clear all trade records?')) return; trades = []; saveJSON('rt_trades', trades); position = null; entryOrder = null; orders = []; markers = []; refreshMarkers(); drawLines(); renderAll(); }
function deleteTrade(i) {   // remove a single trade record AND its entry/exit arrows from the chart (does not touch a live position)
  if (i < 0 || i >= trades.length) return;
  const t = trades.splice(i, 1)[0];
  saveJSON('rt_trades', trades);
  const drop = pred => { const k = markers.findIndex(pred); if (k >= 0) markers.splice(k, 1); };
  drop(m => m.baseTime === t.exitTime && m.text === usd(t.pnl));                 // this trade's exit arrow (time + $ match)
  if (!trades.some(o => o.entryTime === t.entryTime)) drop(m => m.baseTime === t.entryTime);   // entry arrow — keep if a remaining (scaled) partial shares it
  refreshMarkers(); renderAll();
}

// ---------- saved trade logs (snapshot the current trades under a name, recall/delete later) ----------
function saveTradeLog() {
  if (!trades.length) return toast('No trades to save');
  const def = `${(sessions[currentSessionIdx()] || {}).key || 'Log'} · ${INSTR.symbol}`;
  const name = (prompt('Save current trades as:', def) || '').trim();
  if (!name) return;
  const net = trades.reduce((s, t) => s + t.pnl, 0);
  tradeLogs.push({ id: 'log' + Date.now(), name, ts: Math.floor(Date.now() / 1000), n: trades.length, net, trades: JSON.parse(JSON.stringify(trades)) });
  saveJSON('rt_trade_logs', tradeLogs); toast(`Saved "${name}" (${trades.length} trades)`);
}
function loadTradeLog(id) {
  const log = tradeLogs.find(l => l.id === id); if (!log) return;
  if (trades.length && !confirm(`Load "${log.name}" (${log.trades.length} trades)? This replaces the current trade list — save it first if you want to keep it.`)) return;
  trades = JSON.parse(JSON.stringify(log.trades)); saveJSON('rt_trades', trades);
  pnlCalY = 0; renderAll(); closeLogs(); switchTab(true); toast(`Loaded "${log.name}"`);
}
function deleteTradeLog(id) {
  const log = tradeLogs.find(l => l.id === id); if (!log) return;
  if (!confirm(`Delete saved log "${log.name}"? (your current trades are not affected)`)) return;
  tradeLogs = tradeLogs.filter(l => l.id !== id); saveJSON('rt_trade_logs', tradeLogs); renderLogList();
}
function renameTradeLog(id) {
  const log = tradeLogs.find(l => l.id === id); if (!log) return;
  const name = (prompt('Rename log:', log.name) || '').trim();
  if (!name || name === log.name) return;
  log.name = name; saveJSON('rt_trade_logs', tradeLogs); renderLogList();
}
function escHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function openLogs() { renderLogList(); $('logModal').classList.add('open'); }
function closeLogs() { const el = $('logModal'); if (el) { el.classList.remove('open'); el.innerHTML = ''; } }
function renderLogList() {
  const el = $('logModal'); if (!el) return;
  const logs = tradeLogs.slice().sort((a, b) => b.ts - a.ts);
  const rows = logs.length ? logs.map(l => {
    const net = l.net != null ? l.net : l.trades.reduce((s, t) => s + t.pnl, 0), n = l.n != null ? l.n : l.trades.length;
    return `<div class="log-row"><div class="log-info"><div class="log-name" title="${escHtml(l.name)}">${escHtml(l.name)}</div>`
      + `<div class="log-sub">${tFmt(l.ts)} · ${n} trade${n === 1 ? '' : 's'} · <b class="${net >= 0 ? 'pos' : 'neg'}">${usd(net)}</b></div></div>`
      + `<div class="log-act"><button class="log-load" data-id="${l.id}"><span class="material-symbols-outlined">download_for_offline</span>Load</button>`
      + `<button class="log-rename" data-id="${l.id}" title="Rename log"><span class="material-symbols-outlined">edit</span></button>`
      + `<button class="log-del" data-id="${l.id}" title="Delete saved log"><span class="material-symbols-outlined">delete</span></button></div></div>`;
  }).join('') : `<div class="log-empty">No saved logs yet. Trade, then hit “Save log”.</div>`;
  el.innerHTML = `<div class="dd-card"><div class="dd-h"><div><span class="dd-date">Saved trade logs</span> · ${logs.length}</div>`
    + `<button class="dd-x" id="logClose"><span class="material-symbols-outlined">close</span></button></div>`
    + `<div class="dd-list">${rows}</div></div>`;
  $('logClose').onclick = closeLogs;
  el.querySelectorAll('.log-load').forEach(b => b.onclick = () => loadTradeLog(b.dataset.id));
  el.querySelectorAll('.log-rename').forEach(b => b.onclick = () => renameTradeLog(b.dataset.id));
  el.querySelectorAll('.log-del').forEach(b => b.onclick = () => deleteTradeLog(b.dataset.id));
}

// ---------- wiring ----------
function wire() {
  $('btnPlay').onclick = play;
  $('btnStepFwd').onclick = () => { pause(); stepAny(); };
  $('btnStepBack').onclick = () => { pause(); stepBack(); };
  $('btnToStart').onclick = () => gotoSession(+$('sessionSelect').value);
  $('btnPrevDay').onclick = prevDay;
  $('btnNextDay').onclick = nextDay;
  $('sessionSelect').onchange = (e) => gotoSession(+e.target.value);
  wireCalendar();
  $('tfSelect').onchange = (e) => setTf(+e.target.value);
  $('dataSelect').onchange = async (e) => { if (locked()) { $('dataSelect').value = dataIdx; return toast("Can't switch dataset while in a position / working order"); } const i = +e.target.value; const ok = await loadDataset(DATASETS[i]); if (ok) { if (rndMode) exitRnd(); dataIdx = i; } else $('dataSelect').value = dataIdx; };
  $('speedSelect').onchange = () => { saveJSON('rt_speed', $('speedSelect').value); if (playing) { pause(); play(); } };   // remember the pick across reloads
  $('startSlider').oninput = (e) => setStart(+e.target.value);
  $('btnPickStart').onclick = () => { if (locked()) { return toast("Can't set start while in a position / working order"); } setTool('start'); };
  $('btnFit').onclick = fitChart;
  $('btnRandom').onclick = enterRnd;
  $('btnSettleNow').onclick = settleNow;
  { const rh = $('rhEnd'); if (rh) rh.onclick = settleNow; }
  wireRndHudDrag();
  $('btnQuiz').onclick = enterQuiz;
  wireCardDrag('quizCard', 'rt_quiz_pos', '.qz-b');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('quizModal') && $('quizModal').classList.contains('open')) closeQuizScore(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('settleModal') && $('settleModal').classList.contains('open')) closeSettle(); });
  $('btnAlert').onclick = setAlertTime; renderAlertLbl();
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
  $('btnMagnet').classList.toggle('active', magnet);
  $('btnMagnet').onclick = () => { magnet = !magnet; saveJSON('rt_magnet', magnet); $('btnMagnet').classList.toggle('active', magnet); toast(magnet ? 'Magnet on — snaps to OHLC' : 'Magnet off'); };
  $('ripsterToggle').checked = ripsterOn;
  $('ripsterToggle').onchange = (e) => { ripsterOn = e.target.checked; saveJSON('rt_ripster', ripsterOn); ripsterRepaint(); renderIndLegend(); };
  initChartLegend();
  initIndLegend();
  $('indVwap').checked = vwapOn; $('indVwap').onchange = (e) => setVwap(e.target.checked);
  $('indBB').checked = bbOn; $('indBB').onchange = (e) => setBB(e.target.checked);
  $('indEma').checked = emaOn; $('indEma').onchange = (e) => setEMA(e.target.checked);
  $('indVpP').checked = vpP.on; $('indVpP').onchange = (e) => setVpCfg('p', { on: e.target.checked });
  $('indVpO').checked = vpO.on; $('indVpO').onchange = (e) => setVpCfg('o', { on: e.target.checked });
  $('indVpD').checked = vpD.on; $('indVpD').onchange = (e) => setVpCfg('d', { on: e.target.checked });
  $('colVpP').value = vpP.color; $('colVpP').oninput = (e) => setVpCfg('p', { color: e.target.value });
  $('colVpO').value = vpO.color; $('colVpO').oninput = (e) => setVpCfg('o', { color: e.target.value });
  $('colVpD').value = vpD.color; $('colVpD').oninput = (e) => setVpCfg('d', { color: e.target.value });
  $('vpDAlign').value = vpD.align || 'right'; $('vpDAlign').onchange = (e) => setVpCfg('d', { align: e.target.value });
  $('emaPeriods').value = emaPeriods.join(','); $('emaPeriods').onchange = (e) => setEmaPeriods(e.target.value);
  wireOsc();
  $('chartTypeSelect').value = chartType; $('chartTypeSelect').onchange = (e) => setChartType(e.target.value);
  // MTF dropdown (top toolbar)
  $('btnMtf').onclick = (e) => { e.stopPropagation(); $('mtfPopover').classList.toggle('open'); $('btnMtf').classList.toggle('active'); };
  document.addEventListener('mousedown', (e) => { const p = $('mtfPopover'), b = $('btnMtf'); if (p && p.classList.contains('open') && !p.contains(e.target) && !b.contains(e.target)) { p.classList.remove('open'); b.classList.remove('active'); } });
  const readMtfTfs = () => ['mtfTf1', 'mtfTf2', 'mtfTf3'].map(id => +$(id).value || 0);
  $('mtfLayout').onchange = (e) => setMtf(e.target.value, readMtfTfs());
  ['mtfTf1', 'mtfTf2', 'mtfTf3'].forEach(id => { $(id).onchange = () => setMtf(mtfLayout === 'off' ? 'stack' : mtfLayout, readMtfTfs()); });   // picking a timeframe while Off turns the view on instead of silently doing nothing
  // Indicators dropdown (top toolbar) + oscillator pane close button
  $('btnIndicators').onclick = (e) => { e.stopPropagation(); $('indPopover').classList.toggle('open'); $('btnIndicators').classList.toggle('active'); };
  document.addEventListener('mousedown', (e) => { const p = $('indPopover'), b = $('btnIndicators'); if (p && p.classList.contains('open') && !p.contains(e.target) && !b.contains(e.target)) { p.classList.remove('open'); b.classList.remove('active'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const p = $('indPopover'), b = $('btnIndicators'); if (p && p.classList.contains('open')) { p.classList.remove('open'); if (b) b.classList.remove('active'); } } });
  $('oscClose').onclick = () => { setOscMode('off'); const s = $('oscSelect'); if (s) s.value = 'off'; };

  $('entryType').onchange = () => { $('entryPriceRow').style.display = $('entryType').value === 'market' ? 'none' : ''; if ($('entryType').value !== 'market' && !$('entryPrice').value) $('entryPrice').value = f2(curPx()); renderRiskReadout(); };
  $('btnBuy').onclick = () => onEntryButton('long');
  $('btnSell').onclick = () => onEntryButton('short');
  $('btnBuyStop').onclick = () => placeBreakout('long');
  $('btnSellStop').onclick = () => placeBreakout('short');
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
  // fixed-risk position sizing controls
  $('riskOn').checked = riskOn; $('riskUsd').value = riskUsd;
  $('riskOn').onchange = (e) => { riskOn = e.target.checked; saveJSON('rt_risk_on', riskOn); renderRiskReadout(); };
  $('riskUsd').oninput = (e) => { riskUsd = Math.max(0, parseFloat(e.target.value) || 0); saveJSON('rt_risk_usd', riskUsd); renderRiskReadout(); };
  $('entryPrice').addEventListener('input', renderRiskReadout);
  renderRiskReadout();

  $('atmSelect').onchange = (e) => { activeAtm = e.target.value; loadAtmIntoEditor(activeAtm); syncRrField(); renderRiskReadout(); };
  $('rrInput').oninput = (e) => setRr(parseFloat(e.target.value) || 1);
  $('rrMinus').onclick = () => setRr((+$('rrInput').value || 1) - 0.25);
  $('rrPlus').onclick = () => setRr((+$('rrInput').value || 1) + 0.25);
  $('atmUnit').value = atmUnit; $('atmUnit').onchange = (e) => setAtmUnit(e.target.value);
  $('ordUnit').value = atmUnit; $('ordUnit').onchange = (e) => setAtmUnit(e.target.value);
  $('slInput').oninput = setCustomBracket; $('tpInput').oninput = setCustomBracket;
  $('btnAtmSave').onclick = saveAtm;
  $('btnAtmDel').onclick = delAtm;

  $('tabTrades').onclick = () => switchTab(true);
  $('tabDash').onclick = () => switchTab(false);
  $('pnlCalendar').addEventListener('click', (e) => {
    const nav = e.target.closest('.pc-nav'); if (nav) { pnlCalM += +nav.dataset.mo; if (pnlCalM < 0) { pnlCalM = 11; pnlCalY--; } if (pnlCalM > 11) { pnlCalM = 0; pnlCalY++; } renderPnlCalendar(); return; }
    const day = e.target.closest('.pc-day[data-day]'); if (day) openDayDetail(day.dataset.day);
  });
  $('dayDetail').addEventListener('click', (e) => { if (e.target === $('dayDetail')) closeDayDetail(); });   // click backdrop to close
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('dayDetail') && $('dayDetail').classList.contains('open')) closeDayDetail(); });
  $('logModal').addEventListener('click', (e) => { if (e.target === $('logModal')) closeLogs(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('logModal') && $('logModal').classList.contains('open')) closeLogs(); });
  $('btnSaveLog').onclick = saveTradeLog;
  $('btnLogs').onclick = openLogs;
  $('btnExportCsv').onclick = exportCsv;
  $('btnReset').onclick = resetAll;
  $('btnHideTrades').onclick = () => setShowTrades(!showTrades);
  $('btnHideTradesTop').onclick = () => setShowTrades(!showTrades);
  setShowTrades(showTrades);
  $('tradesTable').addEventListener('click', (e) => { const b = e.target.closest('.trade-del'); if (b) deleteTrade(+b.dataset.ti); });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); pause(); stepAny(); }
    else if (e.key === 'p') play(); else if (e.key === 'b') onEntryButton('long');
    else if (e.key === 's') onEntryButton('short'); else if (e.key === 'f') flatten();
    else if (e.key === '[' || e.key === 'ArrowLeft') { e.preventDefault(); prevDay(); }
    else if (e.key === ']' || e.key === 'ArrowRight') { e.preventDefault(); nextDay(); }
    else if (e.key === '0') { e.preventDefault(); fitChart(); }
    else if (e.key === 'Delete' && e.shiftKey) { e.preventDefault(); clearDrawings(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selDrawing) { e.preventDefault(); deleteSelectedDrawing(); }
    else if (e.key === 'Escape') { if (tool) setTool(''); else if (selDrawing) { selDrawing = null; repaintOverlays(); } }
  });
  buildMtfSelects(); rebuildMtf();   // restore a saved multi-timeframe layout on boot (no-op when Off)
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
  dragLineSet: (gp, np) => { const L = draggableLines().find(L => Math.abs(L.get() - gp) < 0.001); if (L) { L.set(np); drawLines(); renderLive(); } return entryOrder ? entryOrder.slTicks : null; },
  pxm: () => chart.priceScale('right').options().scaleMargins, fit: () => fitChart(),
  dbgAxis: (cx) => ({ axisW: priceAxisW(), over: overPriceAxis(cx) }) };
