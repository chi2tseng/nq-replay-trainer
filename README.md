# NQ Replay Trainer

A TradingView-style **bar-replay practice platform** for NQ (Nasdaq-100) futures. Pure static web app — vanilla JS + [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts). No build step, no backend.

**▶ Live:** https://chi2tseng.github.io/nq-replay-trainer/

## Features
- **Bar replay** — play / step / speed / scrub; jump to any trading day and start right at the **09:30 ET US cash open** (DST-correct).
- **Multi-timeframe** — 30s / 1m / 2m / 3m / 5m / 10m / 15m / 30m / 60m, aggregated from a base resolution; fills are always simulated on the finest sub-bars.
- **Manual orders** — market / limit / stop entry + **NinjaTrader-style ATM** (multi-target scale-out, auto-breakeven, trailing stop, OCO bracket). Drag the stop/target lines on the chart.
- **Indicators** — Ripster EMA Clouds (hl2 source: 8/9, 5/12, 34/50, 72/89, 180/200).
- **Drawing tools** — horizontal line / trend line / ray / rectangle; plus arrow & long/short annotations.
- **Analytics** — per-trade log (ticks / $ / R / exit type) and a dashboard: win rate, profit factor, expectancy, avg R, equity curve. CSV export. Everything persists in `localStorage`.
- **Datasets** (switch top-left) — Nasdaq-100 1-min deep history (Dukascopy) and NQ 30-second bars (real tick).

## Data
- `data/NQ_deep_1m.json` — Nasdaq-100 1-min, ~3.5 months (Dukascopy "USA 100" index CFD; tracks NQ within a small basis).
- `data/NQ_30s.json` — NQ 30-second bars built from tick.
- Regenerate with the helpers in `scripts/` (`fetch_yahoo.py`, `convert_dukascopy.py`, `convert_nt_tick.py`).

## Run locally
```
python -m http.server 5560
```
then open http://localhost:5560

---
*For practice only — not financial advice. Trades are stored in your browser, nothing is sent anywhere.*
