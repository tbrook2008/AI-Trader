# AI Trader — Context for Future AI Agents

This document provides essential context for any AI agent continuing development or maintenance of this system. Read this **before** making any changes.

---

## Project Vision

A fully autonomous, headless quantitative trading system for small accounts ($500+). It uses a two-layer decision model: an AI layer (Ollama + Gemini) that classifies the market regime, and a deterministic quantitative layer (MACD / Bollinger+RSI) that decides the exact trade direction. Execution is via Alpaca (paper or live), with a custom software risk monitor replacing native bracket orders for crypto.

---

## Current Architecture (v4.0.0 — Event-Driven)

### Data Flow
```
Alpaca WebSocket Quotes (crypto + stocks)
    → handleTick() → 1-minute bar buffer
    → flushBars() every 60s
    → processSymbol()
        → dataAggregator.aggregate()   (primes history + scrapes news)
        → consensus.runConsensus()     (Gemini + Ollama regime classification)
        → correlation.checkCorrelation() (Pearson guard)
        → tradeLogger.logDecision()
        → tradeExecutor.execute()
            → macd.evaluate() | bollingerRsi.evaluate()
            → kellyCriterion.getPositionSize()
            → validator.runChecks()
            → calculateATR() for stop/trail
            → alpacaClient.submitOrder()
            → tradeLogger.logTrade()   (with ATR-derived stop/target)
```

### AI Pipeline (Regime Classification)
1. **ARIA (Ollama / `quant-trader`)** — always runs first. Local, free, fast. Reads news headlines, returns `{regime, confidence, summary}`.
2. **Gemini Node** — always runs (institutional system requires it). Returns `{regime, confidence, thesis, keyRisk}`.
3. **AI Debate** — if regimes conflict AND max confidence > 70, Ollama's `refine()` is called to re-evaluate against Gemini's thesis.
4. **Weighted Composite** — Gemini 65% / Ollama 35%. Approval threshold: 55 (configurable via `APPROVAL_THRESHOLD`).

### Quantitative Execution Triggers (Deterministic)
- **Momentum regime** → `macd.evaluate()` — bullish MACD crossover = LONG, bearish = SHORT
- **Mean-reverting regime** → `bollingerRsi.evaluate(history, isCrypto)` — price below lower Bollinger Band + RSI < 30 = LONG, above upper + RSI > 70 = SHORT (SHORT is blocked for crypto)
- Both functions return `'LONG' | 'SHORT' | 'NO_TRADE'`. If `NO_TRADE`, execution is skipped.

### Risk Management
- **Stocks**: Alpaca OTO trailing stop order (native)
- **Crypto**: `riskMonitor.js` runs every 60 seconds via `setInterval`, checks live Alpaca positions against ATR-derived stop/target levels stored in DB. Executes market close if breached.
- **ATR Multiplier**: Default 2.0x ATR for stop, 4.0x ATR for target (stored in DB at trade time).

### The ARIA Model (`quant-trader`)
Custom Ollama model built on Llama 3.1 8B (Q4_K_M). Defined in `Modelfile` at project root.
- **Rebuild command**: `ollama create quant-trader -f Modelfile`
- **Temperature**: 0.1 (baked in — do not change)
- **Never change** `OLLAMA_MODEL=quant-trader` to `llama3.1` — generic model lacks calibration

---

## Key Files

| File | Purpose |
|------|---------|
| `Modelfile` | ARIA model definition |
| `server/autonomous/scheduler.js` | Entry point — starts WebSocket stream + 60s risk monitor |
| `server/autonomous/loop.js` | WebSocket handler — builds 1-min bars from quote stream, calls processSymbol |
| `server/autonomous/riskMonitor.js` | Crypto stop-loss/take-profit monitor (runs every 60s) |
| `server/ai/consensus.js` | Regime classification pipeline — Gemini + Ollama |
| `server/ai/ollamaNode.js` | ARIA API client — analyze() and refine() |
| `server/ai/geminiNode.js` | Gemini technical analysis |
| `server/data/dataAggregator.js` | Historical bar priming (Alpaca REST), news scraping, bundle creation |
| `server/quantitative/macd.js` | MACD crossover detector (momentum trigger) |
| `server/quantitative/bollingerRsi.js` | Bollinger+RSI detector (mean-reversion trigger) |
| `server/quantitative/atr.js` | Average True Range calculator for dynamic stops |
| `server/risk/validator.js` | 12-check pre-trade safety gate |
| `server/risk/kellyCriterion.js` | Kelly position sizing with Platt-scaled AI confidence |
| `server/risk/correlation.js` | Pearson correlation guard against open positions |
| `server/execution/alpacaClient.js` | Alpaca SDK wrapper — submitOrder, closePosition, getOpenPositions |
| `server/execution/tradeExecutor.js` | Full execution pipeline (steps 1-8) |
| `server/db/tradeLogger.js` | HMAC-chained tamper-proof SQLite logging |
| `public/index.html` | Dashboard — polls `/api/logs` for live status |

---

## Environment Variables (Critical)

```env
OLLAMA_MODEL=quant-trader        # NEVER change to llama3.1
GEMINI_MODEL=gemini-1.5-flash    # Current working model
OLLAMA_DESKTOP_IP=localhost      # Or Tailscale IP for remote Ollama
OLLAMA_PORT=11434

APPROVAL_THRESHOLD=55            # Min composite confidence to approve a trade
WEIGHT_GEMINI=0.65               # Gemini weight in composite score
WEIGHT_OLLAMA=0.35               # Ollama weight in composite score

TRADING_MODE=paper               # 'paper' or 'live' — always paper until profitable
WATCHED_SYMBOLS=BTC/USD,ETH/USD,SOL/USD,ADA/USD,DOGE/USD,AVAX/USD,DOT/USD,LINK/USD

ATR_MULTIPLIER=2.0               # ATR multiplier for trailing stop distance
KELLY_FRACTION_DIVISOR=4         # Divides full Kelly to get fractional Kelly
MAX_POSITION_PCT=0.10            # Max 10% of portfolio per trade
COOLDOWN_MINUTES=30              # Minimum minutes between trades on same symbol
MAX_DAILY_LOSS_PCT=0.05          # Kill switch if daily loss > 5% of balance
MAX_CONSECUTIVE_LOSSES=3         # Kill switch after 3 consecutive losses

STOP_LOSS_PCT=0.02               # Fallback stop for orphaned positions (riskMonitor)
TAKE_PROFIT_PCT=0.04             # Fallback target for orphaned positions (riskMonitor)
```

---

## Critical Implementation Details

### Symbol Format Conventions
| Context | Format | Example |
|---------|--------|---------|
| Internal / DB / WebSocket subscription | `BASE/USD` | `BTC/USD` |
| Alpaca closePosition API | `BASEUSD` (no slash) | `BTCUSD` |
| Alpaca submitOrder / getCryptoBars | `BASE/USD` | `BTC/USD` |
| Alpaca getBarsV2 (stocks) | plain ticker | `AAPL` |

**Never** mix these up. `alpacaClient.closePosition()` strips the slash automatically. `alpacaClient.submitOrder()` calls `normalizeSymbol()` which adds the slash for crypto.

### Alpaca SDK Quirks (IMPORTANT)
- `getCryptoBars([symbol], opts)` → returns `Promise<Map<string, Bar[]>>`. Crypto bars use: `Close`, `High`, `Low`, `Open`, `Volume` (no "Price" suffix).
- `getBarsV2(symbol, opts)` → returns an **async iterable** (NOT a Promise). Stock bars use: `ClosePrice`, `HighPrice`, `LowPrice`, `OpenPrice`, `Volume`.
- `closePosition(symbol)` → expects `BTCUSD` format, NOT `BTC/USD`.
- WebSocket crypto quotes: symbol field is `quote.S` (not `quote.Symbol`).
- WebSocket stock quotes: symbol field is `quote.Symbol || quote.S`.

### Crypto Trading Constraints
- Alpaca **does not support short selling crypto**. `bollingerRsi.evaluate()` takes an `isCrypto` flag and returns `NO_TRADE` instead of `SHORT` when overbought.
- Alpaca **does not support bracket orders for crypto**. Use the software risk monitor instead.
- Alpaca crypto orders require `time_in_force: 'gtc'` (not `'day'`).
- Minimum crypto order value is ~$10. Orders below this will get a 403 error.

### WebSocket Architecture
The loop subscribes to **Quotes** (not Trades) because:
- Quotes stream continuously even during low-volume periods
- Mid-price `(bid + ask) / 2` is used as the close price for each tick
- This ensures bars are always built, even overnight or in thin markets

### Risk Monitor Symbol Mapping
`riskMonitor.js` converts Alpaca's position format (`DOGEUSD`) back to internal format (`DOGE/USD`) using:
```js
if (/^[A-Z]+USD$/.test(symbol) && symbol !== 'USD') {
  symbol = symbol.slice(0, -3) + '/USD';
}
```
**Never** use `.replace('USD', '/USD')` — this creates `DOGE/USDUSD` for symbols that already contain USD in the base name.

---

## Deployment

- **Process manager**: PM2 (Windows)
- **Processes**: `ai-trader-api` (Express, port 3000) + `ai-trader-loop` (autonomous trader)
- **Entry points**: `server/index.js` (API) + `server/autonomous/scheduler.js` (loop)
- **Persistence**: `pm2 startup` + `pm2 save` — survives reboots automatically
- **Dashboard shortcut**: Desktop shortcut `AI Trader Dashboard.url` → `http://localhost:3000`
- **Logs**: `pm2 logs ai-trader-loop --lines 100 --nostream`
- **Restart**: `pm2 restart ai-trader-loop` (after code changes)
- **Restart with env changes**: `pm2 restart all --update-env`

---

## Known Issues / Gotchas

- Reuters RSS feed (`feeds.reuters.com`) is DNS-unreachable — this is an external issue, not a bug. The scraper gracefully falls back to other sources.
- `url.parse()` deprecation warnings in PM2 error log come from the `yahoo-finance2` library internals — they are harmless.
- Paper trading WebSocket quotes come through slower than live trading — this is normal.
- The correlation guard passes by default when history < 30 bars (insufficient data for Pearson). This is a safe fail-open behavior.

---

## Architecture Decision Log

| Decision | Reason |
|----------|--------|
| Switched from polling to WebSocket event-driven | Faster reaction to price moves; no wasted API calls when nothing changes |
| Subscribe to Quotes instead of Trades | Quotes stream 24/7 even in thin markets; trades only fire when actual transactions occur |
| Mid-price `(bid+ask)/2` for bar close | More stable and continuous than last-trade price |
| Software risk monitor for crypto | Alpaca doesn't support bracket/OCO orders for crypto — had to build custom |
| Two-layer decision (AI regime + quant trigger) | AI alone produces too many false positives; quant layer acts as a deterministic confirmation gate |
| Kelly with Platt scaling | Raw Kelly on AI confidence produces oversized positions; Platt-scaling maps confidence to realistic probabilities |
