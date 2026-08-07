// Shared quiz engine. The page sets window.QUIZ_SET (a file in data/) and window.QUIZ_TITLE
// before loading this; everything else — markup, chart, scoring — lives here.
document.body.innerHTML = `<div id="loading"><div class="spin"></div><span>載入題庫…</span></div>

<div id="app">
  <header>
    <span class="brand"><span class="material-symbols-outlined">quiz</span>Entry Quiz</span>
    <div class="prog">
      <span class="prog-n" id="progN">— / —</span>
      <div class="prog-bar"><div class="prog-fill" id="progFill"></div></div>
    </div>
    <div class="score">
      <div class="sc"><span class="sc-k">新版勝率</span><span class="sc-v" id="scWr">–</span></div>
      <div class="sc"><span class="sc-k">當時勝率</span><span class="sc-v" id="scWrThen">–</span></div>
      <div class="sc"><span class="sc-k">模擬損益</span><span class="sc-v" id="scPnl">$0</span></div>
      <div class="sc"><span class="sc-k">當時損益</span><span class="sc-v" id="scPnlThen">$0</span></div>
      <div class="sc"><span class="sc-k">避開虧損</span><span class="sc-v" id="scDodge">0/0</span></div>
      <div class="sc"><span class="sc-k">抓住獲利</span><span class="sc-v" id="scKeep">0/0</span></div>
      <div class="sc"><button id="btnRes" class="endq-top" title="中途結束,直接看成績(Esc)"><span class="material-symbols-outlined">flag</span>結束測驗</button></div>
    </div>
  </header>

  <section id="chartwrap">
    <div id="chart"></div>
    <div id="badge">NQ · 3m · <b id="bTime">--:--</b> ET<br><span id="bNote">進場那根形成中</span></div>
  </section>

  <footer id="foot"></footer>
</div>

<div id="res"><div class="card" id="resCard"></div></div>`;
if (window.QUIZ_TITLE) document.querySelector('.brand').lastChild.textContent = window.QUIZ_TITLE;

const $ = id => document.getElementById(id);
const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
const usd = v => (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';

let QS = [], qi = 0, ans = [], shown = false, chart, candle;

// ---------- chart ----------
function initChart() {
  const etP = ts => { const o = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts * 1000))) o[x.type] = x.value; return o; };
  chart = LightweightCharts.createChart($('chart'), {
    layout: { background: { color: '#131722' }, textColor: '#9aa0ad', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(42,46,57,.55)' }, horzLines: { color: 'rgba(42,46,57,.55)' } },
    rightPriceScale: { borderColor: '#2a2e39' },
    // date is deliberately blinded — you should not be able to recognise the day
    timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 8,
                 tickMarkFormatter: (ts, type) => { const o = etP(ts); return type <= 2 ? '·' : `${o.hour}:${o.minute}`; } },
    localization: { timeFormatter: ts => { const o = etP(ts); return `${o.hour}:${o.minute} ET`; } },
    crosshair: { mode: 0 },
    handleScroll: true, handleScale: true
  });
  candle = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
  new ResizeObserver(() => { const r = $('chart').getBoundingClientRect(); chart.resize(r.width - 1, r.height, true); chart.resize(r.width, r.height, true); }).observe($('chart'));
}
const cd = b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c });
// Put `price` on the pane's centre line. Autoscale frames the visible bars, then scaleMargins
// shift that band; solving for the margins is what actually centres a given price instead of
// leaving it pinned near an edge. `vis` must be the same bars the time scale will show.
function frameOn(price, vis) {
  let lo = Infinity, hi = -Infinity;
  vis.forEach(b => { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; });
  const ps = chart.priceScale('right');
  if (!(hi > lo)) { ps.applyOptions({ autoScale: true, scaleMargins: { top: .1, bottom: .1 } }); return; }
  const f = (hi - price) / (hi - lo);            // 0 = price at the top of the range, 1 = at the bottom
  const EDGE = .05, cl = v => Math.max(.02, Math.min(.45, v));
  let t, b;
  if (f <= .5) { b = EDGE; t = (.5 - (1 - EDGE) * f) / (1 - f); }   // price high in the range -> pad the top
  else { t = EDGE; b = (1 - EDGE) - .45 / f; }                      // price low in the range -> pad the bottom
  ps.applyOptions({ autoScale: true, scaleMargins: { top: cl(t), bottom: cl(b) } });
}

// ---------- questions ----------
function showQuestion() {
  const q = QS[qi]; shown = false;
  candle.setMarkers([]);
  candle.setData(q.pre.concat([q.form]).map(cd));            // history + the entry bar, formed only up to the entry second
  // Re-frame vertically every question: panning or zooming turns autoscale off, and the next
  // question can sit 1,000+ points away, which would leave its candles off-screen entirely.
  const from = Math.max(0, q.pre.length - 70);
  frameOn(q.entry, q.pre.concat([q.form]).slice(from));   // your fill price lands on the centre line
  chart.timeScale().setVisibleLogicalRange({ from, to: q.pre.length + 8 });
  $('bTime').textContent = q.etHM;
  $('bNote').textContent = `進場當下 第 ${q.formSec} 秒 · 這根還沒收(收盤 = 你的成交價)`;
  renderFoot(); renderScore();
}
function answer(a) {
  if (shown) return;
  const q = QS[qi]; ans[qi] = a; shown = true;
  candle.setData(q.pre.concat(q.post).map(cd));              // play the outcome out
  const eb = Math.floor(q.entryTime / 180) * 180, xb = Math.floor(q.exitTime / 180) * 180;
  candle.setMarkers([
    { time: eb, position: q.side === 'long' ? 'belowBar' : 'aboveBar', color: q.side === 'long' ? '#26a69a' : '#ef5350', shape: q.side === 'long' ? 'arrowUp' : 'arrowDown', text: `當時 ${q.side === 'long' ? '多' : '空'} ${f2(q.entry)}` },
    { time: xb, position: q.side === 'long' ? 'aboveBar' : 'belowBar', color: q.pnl >= 0 ? '#26a69a' : '#ef5350', shape: q.side === 'long' ? 'arrowDown' : 'arrowUp', text: usd(q.pnl) }
  ].sort((x, y) => x.time - y.time));
  chart.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: .1, bottom: .1 } });   // reveal: frame the whole move, not just the entry
  chart.timeScale().setVisibleLogicalRange({ from: q.pre.length - 60, to: q.pre.length + q.post.length + 4 });
  $('bNote').textContent = '揭曉:當時的你';
  renderFoot(); renderScore();
}
function next() { if (qi + 1 >= QS.length) { qi = QS.length; return showResults(); } qi++; showQuestion(); }

function verdict(q, a) {
  const w = q.pnl > 0, l = q.pnl < 0;
  if (a === 'skip') return l ? { k: 'good', t: '成功避雷' } : w ? { k: 'miss', t: '錯過獲利' } : { k: 'flat', t: '跳過平盤單' };
  if (a === q.side) return w ? { k: 'good', t: '抓住獲利' } : l ? { k: 'bad', t: '重蹈覆轍' } : { k: 'flat', t: '一樣平盤' };
  return l ? { k: 'good', t: '反手正確' } : w ? { k: 'bad', t: '反手做錯' } : { k: 'flat', t: '反手平盤' };
}
const sideTxt = s => s === 'long' ? '做多' : s === 'short' ? '做空' : '不進場';

function renderFoot() {
  const q = QS[qi], f = $('foot');
  if (!shown) {
    f.innerHTML = `<div class="ask">這裡你要進場嗎?<small>${q.etHM} ET · 3 分 K · 畫面就是你按下去那一秒的樣子,最後一根還沒收</small></div>`
      + `<div class="acts"><button class="endq" data-a="end">結束測驗</button>`
      + `<button class="big buy" data-a="long">做多<kbd>A</kbd></button>`
      + `<button class="big sell" data-a="short">做空<kbd>D</kbd></button>`
      + `<button class="big skip" data-a="skip">不進場<kbd>S</kbd></button></div>`;
  } else {
    const a = ans[qi], v = verdict(q, a);
    f.innerHTML = `<div class="rev">`
      + `<div><div class="rev-cmp">你 <b class="${a === 'long' ? 'pos' : a === 'short' ? 'neg' : ''}">${sideTxt(a)}</b> · 當時 <b class="${q.side === 'long' ? 'pos' : 'neg'}">${sideTxt(q.side)}</b></div>`
      + `<div class="rev-pnl ${q.pnl >= 0 ? 'pos' : 'neg'}">${usd(q.pnl)}</div>`
      + `<div class="rev-sub">${q.qty} 口 · 持倉 ${q.holdMin} 分 · ${f2(q.entry)} → ${f2(q.exit)}</div></div>`
      + `<div class="verdict ${v.k}">${v.t}</div></div>`
      + `<div class="acts"><button class="endq" data-a="end">結束測驗</button>`
      + `<button class="big next" data-a="next">${qi + 1 >= QS.length ? '看成績' : '下一題'}<kbd>Enter</kbd></button></div>`;
  }
  f.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'end') showResults(); else if (a === 'next') next(); else answer(a);
  });
}

// ---------- scoring (always visible) ----------
function score() {
  const r = { n: 0, taken: 0, simW: 0, simL: 0, winners: 0, losers: 0, dodged: 0, caught: 0, simPnl: 0, realPnl: 0, good: 0, agree: 0, opp: 0, skip: 0 };
  QS.forEach((q, i) => {
    const a = ans[i]; if (!a) return;
    r.n++; r.realPnl += q.pnl;
    if (q.pnl > 0) r.winners++; else if (q.pnl < 0) r.losers++;
    if (a === 'skip') { r.skip++; if (q.pnl < 0) r.dodged++; }
    else {
      const p = a === q.side ? q.pnl : -q.pnl;   // 反手 = 同一出場點的鏡像結果(近似:你自己的停損停利會不同)
      r.taken++; r.simPnl += p; if (p > 0) r.simW++; else if (p < 0) r.simL++;
      if (a === q.side) { r.agree++; if (q.pnl > 0) r.caught++; } else r.opp++;
    }
    if (verdict(q, a).k === 'good') r.good++;
  });
  r.simWr = (r.simW + r.simL) ? Math.round(100 * r.simW / (r.simW + r.simL)) : null;
  r.realWr = (r.winners + r.losers) ? Math.round(100 * r.winners / (r.winners + r.losers)) : null;
  return r;
}
function renderScore() {
  const s = score(), done = Math.min(qi + (shown ? 1 : 0), QS.length);
  $('progN').textContent = `第 ${Math.min(qi + 1, QS.length)} / ${QS.length} 題`;
  $('progFill').style.width = (100 * done / QS.length).toFixed(1) + '%';
  const wr = $('scWr'); wr.textContent = s.simWr == null ? '–' : s.simWr + '%';
  wr.innerHTML = (s.simWr == null ? '–' : s.simWr + '%') + (s.taken ? ` <small>${s.simW}W/${s.simL}L</small>` : '');
  wr.className = 'sc-v ' + (s.simWr == null || s.realWr == null ? '' : s.simWr > s.realWr ? 'pos' : s.simWr < s.realWr ? 'neg' : '');
  $('scWrThen').innerHTML = (s.realWr == null ? '–' : s.realWr + '%') + (s.n ? ` <small>${s.winners}W/${s.losers}L</small>` : '');
  $('scPnl').textContent = usd(s.simPnl); $('scPnl').className = 'sc-v ' + (s.simPnl >= 0 ? 'pos' : 'neg');
  $('scPnlThen').textContent = usd(s.realPnl); $('scPnlThen').className = 'sc-v ' + (s.realPnl >= 0 ? 'pos' : 'neg');
  $('scDodge').innerHTML = `${s.dodged}/${s.losers}`; $('scDodge').className = 'sc-v ' + (s.losers && s.dodged > s.losers / 2 ? 'pos' : '');
  $('scKeep').innerHTML = `${s.caught}/${s.winners}`; $('scKeep').className = 'sc-v ' + (s.winners && s.caught > s.winners / 2 ? 'pos' : '');
}

// ---------- results ----------
function showResults() {
  const s = score(), d = s.simPnl - s.realPnl;
  const byGroup = (name, test) => {
    const set = QS.map((q, i) => ({ q, a: ans[i] })).filter(x => x.a && test(x.q));
    if (!set.length) return '';
    let tk = 0, w = 0, l = 0, p = 0;
    set.forEach(x => { if (x.a === 'skip') return; tk++; const v = x.a === x.q.side ? x.q.pnl : -x.q.pnl; p += v; if (v > 0) w++; else if (v < 0) l++; });
    return `<tr><td>${name}</td><td>${set.length}</td><td>${tk}</td><td>${set.length - tk}</td><td>${pct(w, w + l)}</td><td class="${p >= 0 ? 'pos' : 'neg'}">${usd(p)}</td></tr>`;
  };
  const ended = qi >= QS.length;
  $('resCard').innerHTML = `<h2>考試成績</h2>`
    + `<div class="sub">${ended ? `全部 ${QS.length} 題作答完畢` : `已作答 ${s.n} / ${QS.length} 題(中途結束)`} · 題庫來自你 ${QS.length} 筆真實進場</div>`
    + `<div class="hero"><span class="tag ${d > 0 ? 'win' : d < 0 ? 'loss' : 'flat'}">${d > 0 ? '有進步' : d < 0 ? '退步' : '持平'}</span>`
    + `<div class="hero-n ${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${usd(d)}</div>`
    + `<div class="hero-s">你這次的判斷 ${usd(s.simPnl)} &nbsp;vs&nbsp; 當時的你 ${usd(s.realPnl)}</div></div>`
    + `<div class="grid">`
    + `<div class="cell"><div class="k">新版勝率</div><div class="v ${s.realWr != null && s.simWr > s.realWr ? 'pos' : s.realWr != null && s.simWr < s.realWr ? 'neg' : ''}">${s.simWr == null ? '–' : s.simWr + '%'} <small style="font-size:11px;color:var(--dim)">${s.simW}W/${s.simL}L</small></div></div>`
    + `<div class="cell"><div class="k">當時勝率(同題)</div><div class="v">${s.realWr == null ? '–' : s.realWr + '%'} <small style="font-size:11px;color:var(--dim)">${s.winners}W/${s.losers}L</small></div></div>`
    + `<div class="cell"><div class="k">出手 / 跳過</div><div class="v">${s.taken} / ${s.skip}</div></div>`
    + `<div class="cell"><div class="k">避開虧損單</div><div class="v ${s.losers && s.dodged > s.losers / 2 ? 'pos' : ''}">${s.dodged} / ${s.losers}</div></div>`
    + `<div class="cell"><div class="k">抓住獲利單</div><div class="v ${s.winners && s.caught > s.winners / 2 ? 'pos' : ''}">${s.caught} / ${s.winners}</div></div>`
    + `<div class="cell"><div class="k">好判斷</div><div class="v">${s.good} / ${s.n} · ${pct(s.good, s.n)}</div></div>`
    + `</div>`
    + `<table class="brk"><tr><th>分類</th><th>題數</th><th>出手</th><th>跳過</th><th>勝率</th><th>模擬損益</th></tr>`
    + byGroup('當時做多的題', q => q.side === 'long') + byGroup('當時做空的題', q => q.side === 'short')
    + byGroup('當時賺錢的題', q => q.pnl > 0) + byGroup('當時賠錢的題', q => q.pnl < 0)
    + byGroup('11:00 前', q => q.etHM < '11:00') + byGroup('11:00 後', q => q.etHM >= '11:00')
    + `</table>`
    + `<div class="chips">` + QS.map((q, i) => { const a = ans[i]; if (!a) return `<span class="chip"></span>`;
        const v = verdict(q, a); return `<span class="chip ${v.k}" title="${q.etHM} ET · 你${sideTxt(a)} · 當時${sideTxt(q.side)} · ${usd(q.pnl)} · ${v.t}">${i + 1}</span>`; }).join('') + `</div>`
    + `<div class="row-end"><button class="next" id="again"><span class="material-symbols-outlined">replay</span> 重新測驗</button>`
    + `<button id="close">${ended ? '關閉' : '繼續作答'}</button></div>`;
  $('res').classList.add('open');
  $('again').onclick = () => { $('res').classList.remove('open'); start(); };
  $('close').onclick = () => { $('res').classList.remove('open'); if (qi >= QS.length) { qi = QS.length - 1; shown = true; renderFoot(); } };
}

// ---------- boot ----------
function start() {
  for (let i = QS.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [QS[i], QS[j]] = [QS[j], QS[i]]; }
  ans = []; qi = 0; showQuestion();
}
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ($('res').classList.contains('open')) { if (k === 'escape') $('close').click(); return; }
  if (k === 'escape') { showResults(); return; }                 // bail out mid-quiz straight to the scorecard
  if (!shown && (k === 'a' || k === '1')) answer('long');
  else if (!shown && (k === 'd' || k === '3')) answer('short');
  else if (!shown && (k === 's' || k === '2')) answer('skip');
  else if (shown && (k === 'enter' || k === ' ')) { e.preventDefault(); next(); }
});
$('btnRes').onclick = showResults;
(async () => {
  try {
    // always take the freshest build: a per-day key silently served a stale question bank
    // after a same-day rebuild, and 600 KB off local disk costs nothing.
    const r = await fetch('data/' + (window.QUIZ_SET || 'quiz_bars.json') + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    QS = await r.json();
    if (!QS.length) throw new Error('題庫是空的');
  } catch (err) {
    $('loading').innerHTML = `<span style="color:var(--red)">載入題庫失敗:${err.message}<br>先跑 <code>py scripts/build_quiz_bars.py</code></span>`;
    return;
  }
  initChart(); start();
  $('loading').style.display = 'none';
})();
