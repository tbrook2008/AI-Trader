# AI Trader — Context for Future AI Agents

This document provides essential context for any AI agent continuing development or maintenance of this system. Read this **before** making any changes.

---

## Project Vision

A fully autonomous, headless quantitative trading system for small accounts ($500+). Uses a two-layer decision model: an AI layer (Ollama + Gemini) that classifies the market regime, and a deterministic quantitative layer (MACD / Bollinger+RSI) that decides the exact trade direction. Execution is via Alpaca (paper or live), with a custom software risk monitor replacing native bracket orders for crypto.

---

## Current Architecture (v4.1.0 — Event-Driven + Hardened Filters)

### Data Flow
```
Alpaca WebSocket Quotes (crypto + stocks)
    → handleTick() → 1-minute bar buffer (mid-price of bid/ask)
    → flushBars() every 60s
    → processSymbol()
        → dataAggregator.aggregate()    (primes history + scrapes news)
        → consensus.runConsensus()      (Gemini + Ollama regime classification)
        → correlation.checkCorrelation()
        → tradeLogger.logDecision()
        → tradeExecutor.execute()
            → macd.evaluate(history, isCrypto)         [momentum]
            → bollingerRsi.evaluate(history, isCrypto) [mean-reverting]
            → kellyCriterion.getPositionSize()
            → validator.runChecks()                    [12 pre-trade gates]
            → calculateATR() for stop/trail
            → volumeProfile.analyzeVolume()            [NEW: liquidity check]
            → alpacaClient.submitOrder()
            → tradeLogger.logTrade()                   (ATR stop/target stored)
```

### AI Pipeline (Regime Classification)
1. **ARIA (Ollama / `quant-trader`)** — always runs first. Local, free, fast. Reads news headlines, returns `{regime, confidence, summary}`.
2. **Gemini Node** — always runs (model: `gemini-2.0-flash`). Returns `{regime, confidence, thesis, keyRisk}`.
3. **AI Debate** — if regimes conflict AND max confidence > 70, Ollama `refine()` re-evaluates against Gemini's thesis.
4. **Weighted Composite** — Gemini 65% / Ollama 35%. Approval threshold: **62** (raised from 55 to cut weak signals).

### Quantitative Execution Triggers (v2 — Multi-Gate)

#### Bollinger+RSI (mean-reverting regime) — `bollingerRsi.js`
All 5 gates must pass:
1. Price at Bollinger Band extreme (lower/upper)
2. RSI < 32 (oversold) or RSI > 68 (overbought)
3. **NEW: 50-bar SMA trend filter** — LONG only if price > SMA50, SHORT only if price < SMA50
4. **NEW: Bar body confirmation** — LONG bar must close green (close > open)
5. **NEW: RSI momentum guard** — RSI must be turning up (recovering) for LONG entry

#### MACD (momentum regime) — `macd.js`
All 4 gates must pass:
1. MACD line crosses signal line
2. **NEW: Histogram growing** — crossover must have accelerating momentum
3. **NEW: MACD zero-line filter** — MACD must be above zero for LONG (confirms macro trend)
4. **NEW: Bar body confirmation** — entry bar must close in trade direction

### Risk Management
- **ATR Multiplier**: **3.5x** (raised from 2.0x) — stops now 0.28-0.45% from entry vs 0.16% before
- **ATR Target**: 2.0x stop distance (configurable via `ATR_TARGET_MULTIPLIER`)
- **NEW: Volume Profile Gate** — `volumeProfile.analyzeVolume()` blocks trades when volume < 20% of 20-bar average (dead market)
- **NEW: Post-Loss Cooldown Multiplier** — after 1 loss: 2x cooldown, after 2: 3x (max 3x). e.g., 45 min × 2 = 90 min after 1 loss.
- **Max Position**: 6% of portfolio (reduced from 15%)
- **Max Daily Loss**: 3% (reduced from 5%)
- **Crypto**: software risk monitor every 60s, no bracket orders

---

## Key Files

| File | Purpose |
|------|---------|
| `Modelfile` | ARIA model definition |
| `server/autonomous/scheduler.js` | Entry point — starts WebSocket stream + 60s risk monitor |
| `server/autonomous/loop.js` | WebSocket handler — builds 1-min bars from quote stream |
| `server/autonomous/riskMonitor.js` | Crypto stop-loss/take-profit monitor (every 60s) |
| `server/ai/consensus.js` | Regime classification pipeline — Gemini + Ollama |
| `server/ai/ollamaNode.js` | ARIA API client — analyze() and refine() |
| `server/ai/geminiNode.js` | Gemini regime analysis (model: gemini-2.0-flash) |
| `server/data/dataAggregator.js` | Historical bar priming (Alpaca REST), news bundling |
| `server/quantitative/macd.js` | MACD v2 — crossover + histogram + zero-line + bar body |
| `server/quantitative/bollingerRsi.js` | Bollinger+RSI v2 — 5-gate filter with trend + momentum |
| `server/quantitative/atr.js` | ATR calculator for dynamic stops |
| `server/quantitative/volumeProfile.js` | NEW: Volume analysis — dead volume filter, exhaustion detection |
| `server/risk/validator.js` | 12-check pre-trade safety gate + post-loss cooldown multiplier |
| `server/risk/kellyCriterion.js` | Kelly sizing (max 6% position) |
| `server/risk/correlation.js` | Pearson correlation guard |
| `server/execution/alpacaClient.js` | Alpaca SDK wrapper |
| `server/execution/tradeExecutor.js` | Full 8-step execution pipeline |
| `server/db/tradeLogger.js` | HMAC-chained tamper-proof SQLite log |
| `test-all.js` | Unit test suite (32 tests) — run before any deployment |
| `test-full-cycle.js` | End-to-end integration test (DRY_RUN=true) |
| `analyze-trades.js` | Trade analytics script — run to review performance |

---

## Environment Variables (Critical)

```env
OLLAMA_MODEL=quant-trader        # NEVER change to llama3.1
GEMINI_MODEL=gemini-2.0-flash    # Working model as of May 2026
OLLAMA_DESKTOP_IP=localhost      # Or Tailscale IP for remote Ollama

APPROVAL_THRESHOLD=62            # Raised from 55 — reduces approval rate to ~45%
WEIGHT_GEMINI=0.65
WEIGHT_OLLAMA=0.35

TRADING_MODE=paper
WATCHED_SYMBOLS=BTC/USD,ETH/USD,SOL/USD,ADA/USD,DOGE/USD,AVAX/USD,DOT/USD,LINK/USD

ATR_MULTIPLIER=3.5               # Raised from 2.0 — gives stops breathing room
ATR_TARGET_MULTIPLIER=2.0        # Target = 2x stop distance (1:2 R:R)
TREND_FILTER_PERIOD=50           # SMA period for trend direction filter
VOLUME_SPIKE_MULTIPLIER=1.0      # Min volume ratio to enter (1.0 = at or above average)

KELLY_FRACTION_DIVISOR=4
MAX_POSITION_PCT=0.06            # Reduced from 0.15 — 6% max per trade
COOLDOWN_MINUTES=45              # Base cooldown; multiplied after losses
MAX_DAILY_LOSS_PCT=0.03          # Kill at 3% daily drawdown (tightened from 5%)
MAX_CONSECUTIVE_LOSSES=3
STOP_LOSS_PCT=0.02               # Fallback for orphaned positions
TAKE_PROFIT_PCT=0.04
```

---

## Critical Implementation Details

### Symbol Format Conventions
| Context | Format | Example |
|---------|--------|---------|
| Internal / DB / WebSocket | `BASE/USD` | `BTC/USD` |
| Alpaca closePosition | `BASEUSD` (no slash) | `BTCUSD` |
| Alpaca submitOrder / getCryptoBars | `BASE/USD` | `BTC/USD` |
| Alpaca getBarsV2 (stocks) | plain ticker | `AAPL` |

### Alpaca SDK Quirks (DO NOT FORGET)
- `getCryptoBars([symbol], opts)` → `Promise<Map<string, Bar[]>>`. Crypto bars: `Close`, `High`, `Low`, `Open`, `Volume`.
- `getBarsV2(symbol, opts)` → **async iterable** (NOT a Promise). Stock bars: `ClosePrice`, `HighPrice`, `LowPrice`, `OpenPrice`, `Volume`.
- `closePosition(symbol)` → expects `BTCUSD` format (slash stripped). Our wrapper does this automatically.
- WebSocket crypto quotes: symbol = `quote.S`. Stock quotes: `quote.Symbol || quote.S`.
- Alpaca **cannot short crypto**. bollingerRsi.evaluate() takes `isCrypto` flag.
- Crypto orders require `time_in_force: 'gtc'`.
- Minimum crypto order ~$10.

### Risk Monitor Symbol Mapping
```js
// DOGEUSD → DOGE/USD (correct)
if (/^[A-Z]+USD$/.test(symbol) && symbol !== 'USD') {
  symbol = symbol.slice(0, -3) + '/USD';
}
// NEVER use: symbol.replace('USD', '/USD') — produces DOGE/USDUSD
```

### Gemini API Notes
- **Working model**: `gemini-2.0-flash` (as of May 2026). `gemini-1.5-flash` returns 404.
- If you see 429 (spending cap exceeded): the free tier quota was hit. Wait for reset or upgrade.
- Gemini failure is handled gracefully — Ollama continues alone, consensus uses 1-node weights.

### Post-Loss Cooldown Logic
```js
// In validator.js
const cooldownMultiplier = consecLoss > 0 ? Math.min(consecLoss + 1, 3) : 1;
const effectiveCooldown  = COOLDOWN_MIN * cooldownMultiplier;
// 0 losses → 45 min, 1 loss → 90 min, 2 losses → 135 min, 3+ losses → 135 min
```

### Deployment
- **Processes**: PM2 `ai-trader-api` (port 3000) + `ai-trader-loop`
- **Restart with env**: `pm2 restart all --update-env`
- **Logs**: `pm2 logs ai-trader-loop --lines 100 --nostream`
- **Dashboard**: http://localhost:3000
- **Desktop shortcut**: `AI Trader Dashboard.url`

---

## Testing Protocol (Run Before Every Deployment)

```bash
node test-all.js          # 32 unit tests — must all pass
node test-full-cycle.js   # End-to-end pipeline — must complete
pm2 restart ai-trader-loop --update-env
pm2 logs ai-trader-loop --lines 30 --nostream  # Confirm connected + no errors
```

---

## Known Issues / Gotchas

- Reuters RSS (`feeds.reuters.com`) is DNS-unreachable — external issue, not a bug.
- `url.parse()` deprecation warnings in PM2 error log — from yahoo-finance2 internals, harmless.
- Windows `UV_HANDLE_CLOSING` assertion on process.exit() — harmless libuv cleanup warning on Node 24.
- Crypto WebSocket volume is very low for some pairs (DOT, LINK) — volume filter may produce `BELOW_AVG` frequently.
- Paper trading WebSocket quotes are slightly delayed vs live — normal.

---

## Architecture Decision Log

| Decision | Reason |
|----------|--------|
| WebSocket Quotes (not Trades) | Quotes stream 24/7; trades only fire on actual transactions |
| Mid-price (bid+ask)/2 for close | More stable and continuous than last-trade price |
| 50-bar SMA trend filter | Mean-reversion entries against trend were top cause of losses on May 5 |
| ATR 3.5x (was 2.0x) | 0.16% stops were too tight; got hit by normal bid/ask spread noise |
| Volume profile gate | Prevents entering during dead-market periods (late night, thin alts) |
| Post-loss cooldown multiplier | Prevents immediate re-entry after stop-out on same symbol |
| Kelly capped at 6% | Losses up to $84/trade with 10% position; 6% reduces to ~$50 max |
| Software risk monitor for crypto | Alpaca doesn't support bracket/OCO orders for crypto |
