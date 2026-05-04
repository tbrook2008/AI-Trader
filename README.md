# AI Trader — Autonomous Quantitative Trading System

> **Status**: Active — Paper trading on Alpaca. Crypto-first (8 pairs), stock switching supported.  
> **Version**: v4.0.0 — May 2026  
> **Language**: Node.js 18+  
> **Capital**: Designed for small accounts ($500+). No PDT restrictions on crypto.

---

## What This Does

An autonomous algorithmic trading system that runs 24/7, streams real-time quotes from Alpaca WebSockets, and uses a two-layer decision model to identify and execute high-confidence trades.

**Two-Layer Decision Architecture:**
- **Layer 1 (AI Regime)** — Gemini + Ollama classify the market as "momentum" or "mean-reverting"
- **Layer 2 (Quant Trigger)** — MACD crossover (momentum) or Bollinger+RSI (mean-reverting) confirms entry direction

Both layers must agree before a trade is placed. This dramatically reduces false positives.

**Signal pipeline per symbol (fires every minute when a new bar completes):**
1. **WebSocket** — Alpaca Quotes stream into a 1-minute bar buffer (mid-price of bid/ask)
2. **Data** — Historical bars primed from Alpaca REST API + RSS news scraping
3. **AI Consensus** — Gemini + ARIA (Ollama) classify market regime. AI Debate runs if they disagree.
4. **Quant Trigger** — MACD (momentum) or Bollinger+RSI (mean-reverting) determines LONG/SHORT/NO_TRADE
5. **Validation** — 12-check pre-trade gate (kill switch, correlation guard, exposure, cooldown, no crypto shorts)
6. **Kelly Sizing** — Fractional Kelly with Platt-calibrated AI confidence
7. **ATR Risk Rails** — Dynamic stop distance based on Average True Range (stored in DB for risk monitor)
8. **Execution** — Market order on Alpaca (trailing stop for stocks, software monitor for crypto)
9. **Risk Monitor** — Background loop every 60s checks crypto positions against ATR stop/target levels
10. **Logging** — HMAC-chained tamper-proof SQLite trade log

---

## Architecture

```
server/
├── index.js                  REST API + control panel (Express)
├── autonomous/
│   ├── loop.js               WebSocket handler — builds 1-min bars from quotes
│   ├── scheduler.js          Entry point: starts stream + 60s risk monitor
│   └── riskMonitor.js        Crypto software stop-loss/take-profit (every 60s)
├── ai/
│   ├── consensus.js          Weighted dual-node regime consensus engine
│   ├── geminiNode.js         Regime classification via Google Gemini Flash
│   └── ollamaNode.js         ARIA — local quant analyst (analyze + refine)
├── data/
│   ├── dataAggregator.js     Historical bar priming (Alpaca REST) + news bundling
│   └── newsScraper.js        RSS feed scraper for news headlines
├── quantitative/
│   ├── macd.js               MACD crossover detector (momentum entry trigger)
│   ├── bollingerRsi.js       Bollinger+RSI detector (mean-reversion entry trigger)
│   └── atr.js                Average True Range for dynamic stop sizing
├── execution/
│   ├── alpacaClient.js       Alpaca SDK wrapper — orders, positions, closePosition
│   └── tradeExecutor.js      Full execution pipeline (sizing → validate → order → log)
├── risk/
│   ├── kellyCriterion.js     Fractional Kelly with Platt-scaled AI confidence
│   ├── validator.js          12-check pre-trade safety gate
│   ├── correlation.js        Pearson correlation guard against open positions
│   └── killSwitch.js         Auto (daily loss limit) + manual kill switch
├── db/
│   ├── schema.js             SQLite: decisions, trades, strategy_memory, state
│   ├── tradeLogger.js        HMAC-chained trade log (tamper-proof)
│   └── strategyMemory.js     Per-symbol win stats for adaptive Kelly sizing
└── utils/
    └── logger.js             Winston logger

Modelfile                     Custom ARIA quant-trader Ollama model definition
public/
└── index.html                Live dashboard with real-time system terminal
```

---

## The ARIA Model (`quant-trader`)

ARIA (Autonomous Risk & Intelligence Analyst) is a custom Ollama model built specifically for this project. It is **not** a modification of the base `llama3.1` — it is a separate named model that only this trader uses.

**What makes it different from a stock LLM:**
- Permanently baked-in identity as an elite quantitative analyst
- 10 calibrated financial few-shot examples defining precise scoring standards
- Hard rules: regulatory events always floor sentiment at ≤−0.7, no hedge-phrasing, no generic summaries
- Crypto-specific awareness: BTC dominance correlation, DeFi risk, on-chain sentiment
- Low temperature (0.1) baked in for decisive, consistent outputs

**To rebuild the model from scratch:**
```bash
ollama create quant-trader -f Modelfile
```

**To verify it exists:**
```bash
ollama list    # Should show: quant-trader, llama3.1 (separately)
```

---

## Quickstart

### 1. Install
```bash
npm install
```

### 2. Build the ARIA model
```bash
ollama create quant-trader -f Modelfile
```

### 3. Configure
```bash
cp .env.template .env
```
Fill in these values in `.env`:
```env
GEMINI_API_KEY=AIza...          # Google AI Studio — free tier works, used sparingly
ALPACA_API_KEY=PK...            # From alpaca.markets → Paper Trading → API Keys
ALPACA_SECRET_KEY=...
OLLAMA_DESKTOP_IP=localhost     # OR Tailscale IP if Ollama is on another machine
```

### 4. Smoke Tests
Run in order, stop if any fail:
```bash
npm run test:db       # Database initializes cleanly
npm run test:data     # Yahoo Finance returns quotes (may rate-limit, retry once)
npm run test:kelly    # Kelly math is correct
npm run dry-run       # Full cycle without placing any orders
```

### 5. Run
```bash
npm start             # Server + auto-loop at localhost:3000
```
Or with PM2 for background operation:
```bash
pm2 start ecosystem.config.js
pm2 save              # Persist across reboots
```

### 6. Monitor
Open the dashboard at `http://localhost:3000` — includes a live system terminal that streams real-time log output.

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/status` | System health, live balance, kill switch state |
| GET | `/api/decisions?limit=20` | Last N AI decisions with node scores |
| GET | `/api/trades?limit=20` | Last N executed trades |
| GET | `/api/logs` | Last 100 lines of the combined log file |
| GET | `/api/killswitch` | Kill switch status |
| POST | `/api/killswitch` | `{"action":"activate"}` or `{"action":"deactivate"}` |
| POST | `/api/run-now` | Trigger one analysis cycle immediately |
| POST | `/api/mode` | `{"mode":"paper"}` or `{"mode":"live"}` |

---

## Key Configuration (`.env`)

```env
# What to trade
WATCHED_SYMBOLS=BTC/USD,ETH/USD,SOL/USD,ADA/USD,DOGE/USD,AVAX/USD,DOT/USD,LINK/USD

# Switching to stocks (no code change needed):
# WATCHED_SYMBOLS=SPY,AAPL,TSLA
# Mixed (crypto 24/7, stocks during NYSE hours only):
# WATCHED_SYMBOLS=BTC/USD,ETH/USD,SPY

# Ollama model — do not change unless rebuilding ARIA
OLLAMA_MODEL=quant-trader

# Risk (current defaults)
STOP_LOSS_PCT=0.015           # 1.5% stop per trade
MAX_POSITION_PCT=0.15         # Max 15% portfolio per position
MAX_CONCURRENT_POSITIONS=10   # Correlation guard
MAX_DAILY_LOSS_PCT=0.05       # Kill switch trigger at 5% daily loss
COOLDOWN_MINUTES=30           # Min time between trades on same symbol

# AI Consensus
APPROVAL_THRESHOLD=45         # Composite score needed to approve a trade
WEIGHT_GEMINI=0.40            # Gemini weight (only active when gated in)
WEIGHT_OLLAMA=0.25            # ARIA/Ollama weight
```

---

## Ollama-First Cost Gating

To conserve the Gemini API budget ($10/month cap), the consensus engine uses a **local-first strategy**:

```
Every symbol cycle:
  1. ARIA (quant-trader) reads news headlines → sentiment score [FREE]
  2. IF abs(sentiment) >= 25 OR trend != 'neutral':
       → Call Gemini for technical confirmation [PAID]
       → Run AI Debate if scores diverge by >50 points
     ELSE:
       → Skip Gemini entirely, log "flat market" [FREE]
  3. Compute weighted composite score
  4. Approve / reject trade
```

This reduces Gemini API calls by ~70-90% when markets are quiet.

---

## How the Cycle Works

```
Every 10 minutes:
  1. Fetch live Alpaca balance
  2. Check daily loss limit → kill switch if exceeded
  3. Check open positions → emergency close if >7% loss
  4. For each symbol in WATCHED_SYMBOLS:
     a. If stock + market closed → skip
     b. If open positions >= MAX_CONCURRENT_POSITIONS → stop scanning
     c. Aggregate price + news data
     d. Run ARIA first (local), then Gemini if signal detected
     e. If approved AND direction != NO_TRADE:
        - Kelly position sizing (live balance)
        - 10-check validator
        - Submit bracket order (entry + stop + target)
        - Log to SQLite
     f. Wait 3s before next symbol (Yahoo rate limit protection)
```

---

## Switching Between Paper and Live

```bash
# Stay on paper (default, always start here):
TRADING_MODE=paper

# Switch to live (only after 2+ weeks profitable paper trading):
TRADING_MODE=live
```

Or via API at runtime (no restart needed):
```bash
curl -X POST http://localhost:3000/api/mode -H "Content-Type: application/json" -d '{"mode":"live"}'
```

---

## Risk Model

- **Position size**: Fractional Kelly (÷2) capped at 15% of live portfolio
- **Stop-loss**: 1.5% below entry (bracket order, atomic with entry)
- **Emergency stop**: 7% unrealized loss triggers immediate close
- **Daily loss limit**: 5% of account triggers kill switch for rest of day
- **Consecutive losses**: 3 in a row triggers kill switch
- **Cooldown**: 30 min minimum between trades on the SAME symbol (tracked individually)

---

## Deployment (PM2 — Windows)

The system runs headlessly via PM2 with two persistent processes:
- `ai-trader-api` — Express REST API + dashboard server
- `ai-trader-loop` — Autonomous trading cycle scheduler

Both are configured to start automatically on Windows boot via `pm2 startup`.

---

## Related Projects

- **Betting Analysis** — Python MLB/NBA prop betting engine. Same conceptual architecture (EV scoring, Kelly sizing, confidence models). These two systems are designed to eventually share a unified dashboard.

---

## Roadmap

- [ ] Phase 1: WebSocket real-time data for intraday signals (5-min candles)
- [ ] Phase 2: Unified dashboard showing Alpaca trades + PrizePicks picks
- [ ] Phase 3: True scalping mode (1-min candles, sub-minute cycles)
- [ ] Phase 4: Shared signal layer between Betting Analysis and AI Trader
- [ ] Phase 5: Fine-tune ARIA on historical financial news/price datasets
