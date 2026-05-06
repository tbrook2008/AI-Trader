# AI Trader — Autonomous Quantitative Trading System

> **Status**: Active — Paper trading on Alpaca. Crypto-first (8 pairs).  
> **Version**: v4.1.0 — May 2026  
> **Language**: Node.js 18+  
> **Capital**: Designed for small accounts ($500+). No PDT restrictions on crypto.

---

## What This Does

An autonomous algorithmic trading system that runs 24/7, streams real-time quotes from Alpaca WebSockets, and uses a two-layer decision model to identify and execute high-confidence trades.

**Two-Layer Decision Architecture:**
- **Layer 1 (AI Regime)** — Gemini 2.0 Flash + ARIA (Ollama) classify the market as `momentum` or `mean-reverting`
- **Layer 2 (Quant Trigger)** — MACD v2 (momentum) or Bollinger+RSI v2 (mean-reverting) confirms entry direction with 4–5 gates each

Both layers must agree before a trade is placed. This dramatically reduces false positives.

---

## Signal Pipeline (fires every 60 seconds per symbol)

```
Alpaca WebSocket Quote Stream
    → 1-minute bar buffer (mid-price of bid/ask)
    → dataAggregator: historical bar priming + news scraping (5-min cache)
    → consensus: Gemini 2.0 Flash + ARIA regime classification
        → circuit breaker: if Gemini 429/rate-limited, Ollama-only mode (threshold raised to 72)
        → AI Debate: if nodes strongly disagree (>70 conf), ARIA refines its position
    → tradeExecutor:
        → macd.evaluate() OR bollingerRsi.evaluate() → LONG/SHORT/NO_TRADE
        → volumeProfile.analyzeVolume() → blocks dead-volume entries
        → kellyCriterion.getPositionSize() → fractional Kelly sizing
        → validator.runChecks() → 12-point pre-trade safety gate
        → calculateATR() → dynamic stop/target (3.5x ATR stop, 7.0x ATR target)
        → alpacaClient.submitOrder() → market order on Alpaca
        → tradeLogger.logTrade() → HMAC-chained SQLite record
    → riskMonitor (every 60s): software stop-loss/take-profit for open crypto positions
```

---

## Architecture

```
server/
├── index.js                  REST API + control panel (Express)
│                             /api/status → live Alpaca balance (real-time)
│                             /api/account → full account details
│                             /api/positions → open positions
├── autonomous/
│   ├── loop.js               WebSocket handler — 1-min bar builder + processSymbol()
│   ├── scheduler.js          Entry point: starts stream + 60s risk monitor
│   └── riskMonitor.js        Crypto software stop/target monitor (every 60s)
├── ai/
│   ├── consensus.js          Weighted dual-node consensus + single-node degraded mode
│   ├── geminiNode.js         Gemini 2.0 Flash — circuit breaker on 429/spending cap
│   └── ollamaNode.js         ARIA — local quant analyst (analyze + refine)
├── data/
│   ├── dataAggregator.js     Historical bar priming (Alpaca REST) + news bundling
│   └── newsScraper.js        RSS scraper — 9 feeds, 5-min cache, error throttling
├── quantitative/
│   ├── macd.js               MACD v2 — crossover + histogram + zero-line + bar body
│   ├── bollingerRsi.js       Bollinger+RSI v2 — 5-gate: band + RSI + trend + body + momentum
│   ├── atr.js                ATR calculator for dynamic stop sizing
│   └── volumeProfile.js      Volume analysis — dead volume gate + classification
├── execution/
│   ├── alpacaClient.js       Alpaca SDK wrapper — orders, positions, account, closePosition
│   └── tradeExecutor.js      Full 8-step execution pipeline with volume profile gate
├── risk/
│   ├── kellyCriterion.js     Fractional Kelly (÷4) capped at 6% portfolio
│   ├── validator.js          12-check pre-trade gate + post-loss cooldown multiplier
│   ├── correlation.js        Pearson correlation guard against open positions
│   └── killSwitch.js         Auto (daily loss limit) + manual kill switch
├── db/
│   ├── schema.js             SQLite: decisions, trades, strategy_memory, state
│   ├── tradeLogger.js        HMAC-chained tamper-proof trade log
│   └── strategyMemory.js     Per-symbol win stats for adaptive Kelly sizing
└── utils/
    └── logger.js             Winston logger (combined.log + console)

Modelfile                     Custom ARIA quant-trader Ollama model definition
test-all.js                   32 unit tests — run before every deployment
test-full-cycle.js            End-to-end pipeline integration test (DRY_RUN)
public/
└── index.html                Live dashboard — real balance, trades, decisions, logs
```

---

## The ARIA Model (`quant-trader`)

ARIA (Autonomous Risk & Intelligence Analyst) is a custom Ollama model built specifically for this project. It is **not** a modification of the base `llama3.1` — it is a separately named model.

**What makes it different:**
- Permanently baked-in identity as an elite quantitative analyst
- 10 calibrated financial few-shot examples with precise scoring standards
- Hard rules: regulatory events floor sentiment at ≤−0.7, no hedge-phrasing
- Crypto-specific awareness: BTC dominance, DeFi risk, on-chain sentiment
- Low temperature (0.1) baked in for decisive, consistent outputs

```bash
# Rebuild the model from scratch
ollama create quant-trader -f Modelfile

# Verify it exists
ollama list    # Should show: quant-trader (separately from llama3.1)
```

---

## Quickstart

### 1. Install dependencies
```bash
npm install
```

### 2. Build the ARIA model
```bash
ollama create quant-trader -f Modelfile
```

### 3. Configure environment
```bash
# Edit .env with your API keys (see Key Configuration below)
```

### 4. Run tests
```bash
node test-all.js          # 32 unit tests — must all pass before running
node test-full-cycle.js   # End-to-end DRY_RUN integration test
```

### 5. Start with PM2 (recommended)
```bash
pm2 start ecosystem.config.js
pm2 save                  # Persist across reboots
```

### 6. Monitor
Open `http://localhost:3000` — live dashboard with real-time balance, trades, decisions, and logs.

Or double-click the **AI Trader Dashboard** shortcut on your Desktop.

---

## Key Configuration (`.env`)

```env
# --- AI Models ---
GEMINI_MODEL=gemini-2.0-flash        # Working model as of May 2026
OLLAMA_MODEL=quant-trader            # NEVER change to llama3.1
OLLAMA_DESKTOP_IP=localhost          # Or Tailscale IP for remote Ollama

# --- What to trade ---
WATCHED_SYMBOLS=BTC/USD,ETH/USD,SOL/USD,ADA/USD,DOGE/USD,AVAX/USD,DOT/USD,LINK/USD

# --- AI Consensus ---
WEIGHT_GEMINI=0.65
WEIGHT_OLLAMA=0.35
APPROVAL_THRESHOLD=62                # Two-node threshold (raised from 45 → 62)
SINGLE_NODE_THRESHOLD=72             # Ollama-only threshold when Gemini is circuit-broken
GEMINI_CIRCUIT_BREAK_MS=3600000     # Pause Gemini for 1hr after 429 (default)

# --- ATR Risk Rails ---
ATR_MULTIPLIER=3.5                   # Stop = 3.5x ATR from entry (raised from 2.0)
ATR_TARGET_MULTIPLIER=2.0            # Target = 2x stop distance (1:2 R:R)
TREND_FILTER_PERIOD=50               # SMA period for trend direction filter

# --- Risk Management ---
TRADING_MODE=paper                   # paper or live — always start with paper
MAX_POSITION_PCT=0.06                # Max 6% portfolio per trade (reduced from 15%)
MAX_CONCURRENT_POSITIONS=5
MAX_DAILY_LOSS_PCT=0.03              # Kill switch at 3% daily drawdown (tightened)
MAX_CONSECUTIVE_LOSSES=3
COOLDOWN_MINUTES=45                  # Base cooldown (multiplied after losses)
KELLY_FRACTION_DIVISOR=4
```

---

## Risk Model (v4.1.0)

| Rule | Value | Notes |
|------|-------|-------|
| Stop distance | ATR × 3.5 | ~0.28–0.45% for BTC on 1-min bars |
| Target distance | Stop × 2.0 | 1:2 risk/reward |
| Max position size | 6% of portfolio | Reduced from 15% after May 5 analysis |
| Post-loss cooldown | 45 min × (losses+1) | 1 loss = 90 min, 2 = 135 min |
| Daily loss limit | 3% of account | Triggers kill switch for rest of day |
| Consecutive losses | 3 max | Kill switch |
| Portfolio exposure | Max 40% | Across all open positions |

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/status` | Live balance from Alpaca, kill switch, Gemini status |
| GET | `/api/account` | Full account details + open positions |
| GET | `/api/positions` | Open positions list |
| GET | `/api/decisions?limit=20` | Last N AI decisions with regime + scores |
| GET | `/api/trades?limit=20` | Last N executed trades with PnL |
| GET | `/api/logs` | Last 30 lines of combined log |
| GET | `/api/killswitch` | Kill switch status |
| POST | `/api/killswitch` | `{"action":"activate"}` or `{"action":"deactivate"}` |
| POST | `/api/mode` | `{"mode":"paper"}` or `{"mode":"live"}` |

---

## News Sources (Active)

| Feed | Type | Status |
|------|------|--------|
| Yahoo Finance | General | ✅ Active |
| MarketWatch | General | ✅ Active |
| Seeking Alpha | General | ✅ Active |
| Benzinga | General | ✅ Active |
| Investing.com | General | ✅ Active |
| CoinTelegraph | Crypto | ✅ Active |
| CoinDesk | Crypto | ✅ Active |
| Decrypt | Crypto | ✅ Active |
| CryptoSlate | Crypto | ✅ Active |
| Reuters | General | ❌ Removed (DNS unreachable) |

Feeds are cached for 5 minutes. Error warnings are throttled to once per 10 min per feed.

---

## Gemini Rate Limiting

Gemini API has a monthly spending cap on the free tier. When the cap is hit:
- System logs **one** `warn` message, then **silences** for 1 hour (circuit breaker)
- Falls back to **Ollama-only** consensus (single-node mode)
- Single-node approval threshold is raised to `72` (vs `62` for dual-node)
- Trading continues automatically — only with stricter signal requirements
- When cap resets: Gemini resumes automatically at next cycle

To check/raise your cap: https://ai.studio/spend

---

## Deployment (PM2 — Windows)

```bash
# Start both processes
pm2 start ecosystem.config.js

# Restart with new .env values
pm2 restart all --update-env

# Check logs
pm2 logs ai-trader-loop --lines 30 --nostream

# Status
pm2 list
```

Both `ai-trader-api` (port 3000) and `ai-trader-loop` auto-start on Windows boot.

---

## Testing Protocol

Run these before **every deployment**:
```bash
node test-all.js          # 32 unit tests covering ATR, MACD, Bollinger, Volume, Kelly, RSI
node test-full-cycle.js   # End-to-end DRY_RUN — must complete without crash
```

---

## Changelog

### v4.1.0 (May 6, 2026)
- **Gemini circuit breaker**: Detects 429/spending-cap, logs once, silent for 1hr
- **Single-node consensus**: Ollama-only mode with raised threshold (72) when Gemini unavailable
- **Live balance API**: `/api/status` now fetches real portfolio value from Alpaca
- **News overhaul**: Removed dead Reuters feed, added CoinTelegraph/CoinDesk/Decrypt/CryptoSlate
- **RSS caching**: 5-min feed cache stops per-bar HTTP fetching; error throttling (once/10min)
- **BollingerRsi v2**: 50-bar SMA trend filter + bar body confirmation + RSI momentum guard
- **MACD v2**: Histogram acceleration + zero-line filter + bar body confirmation
- **volumeProfile.js (NEW)**: Dead volume gate + volume classification
- **ATR**: 2.0x → 3.5x (stops now 0.28–0.45% vs 0.16% that kept getting hit by noise)
- **Max position**: 15% → 6% of portfolio per trade
- **Cooldown**: 30min → 45min base + post-loss multiplier (2x, 3x)
- **Approval threshold**: 45 → 62 (reduced approval rate from 78% to ~45%)
- **Gemini model**: Fixed gemini-1.5-flash → gemini-2.0-flash (1.5 was deprecated)
- **flushBars crash fix**: Snapshot copy prevents race condition on undefined bar
- **MaxListeners warning**: setMaxListeners(20) on both WebSocket clients

### v4.0.0 (May 4, 2026)
- Event-driven WebSocket architecture (Quotes stream → 1-min bar buffer)
- Dual-layer decision model: AI regime → Quant trigger
- ATR-derived stop/target stored in DB for software risk monitor
- Symbol normalization bugs fixed (DOGE/USDUSD, DOTUSDUSD etc.)
- Bollinger+RSI: crypto short guard added (Alpaca cannot short crypto)
- Validator: fixed marketValue property name mismatch

---

## Switching to Live Trading

```bash
# In .env
TRADING_MODE=live

# Restart
pm2 restart all --update-env
```

> ⚠️ Only do this after 2+ weeks of consistently profitable paper trading. Start with small capital.
