# AI Trader — Autonomous Quantitative Trading System

> **Status**: Active — Paper trading on Alpaca. Crypto-first (8 pairs), stock switching supported.  
> **Version**: v3.0.0 — April 2026  
> **Language**: Node.js 18+  
> **Capital**: Designed for small accounts ($500+). No PDT restrictions on crypto.

---

## What This Does

An autonomous algorithmic trading system that runs 24/7, scans 8 crypto markets every 10 minutes, uses a dual-node AI consensus engine to identify high-confidence trade setups, and executes bracket orders on Alpaca (paper or live).

The system is designed to **minimize paid API usage** by running sentiment analysis locally via a custom-trained Ollama model, only escalating to the cloud (Gemini) when a real signal is detected.

**Signal pipeline per symbol:**
1. **Data** — Yahoo Finance price/OHLCV + RSS news headlines aggregated into a research bundle
2. **ARIA (Ollama)** — Local quantitative analyst model (`quant-trader`) reads news headlines → returns sentiment score −1.0 to +1.0. **Always runs first. Free.**
3. **Cost-Saving Gate** — If ARIA's sentiment is weak AND technicals are neutral → skip Gemini entirely and save API costs
4. **Gemini Node** — Cloud technical analysis (EMA, RSI, trend, regime) → score −100 to +100. **Only called when a real signal exists.**
5. **AI Debate (Refinement)** — If Gemini and ARIA scores diverge by >50 points, ARIA is forced to read Gemini's technical thesis and reconsider its stance before a final score is produced
6. **Consensus** — Weighted composite score (configurable weights), approval threshold 45
7. **Validation** — 10-check pre-trade gate (kill switch, confidence, exposure, PDT, cooldown)
8. **Execution** — Bracket order on Alpaca (entry + stop-loss + take-profit, atomic)
9. **Logging** — HMAC-chained tamper-proof SQLite trade log

---

## Architecture

```
server/
├── index.js                  REST API + control panel (Express) + /api/logs streaming
├── autonomous/
│   ├── loop.js               Main cycle: scan → analyze → trade → exit
│   └── scheduler.js          node-cron scheduler (default: every 10 min)
├── ai/
│   ├── consensus.js          Ollama-first weighted dual-node consensus engine
│   ├── geminiNode.js         Technical analysis via Google Gemini Flash (gated)
│   └── ollamaNode.js         ARIA — local quant analyst via custom Ollama model
├── data/
│   ├── dataAggregator.js     Bundles price + indicators + headlines per symbol
│   ├── yahooFinance.js       OHLCV, EMA9/21, RSI14, ATR, regime detection
│   └── newsScraper.js        RSS feed scraper for additional headlines
├── execution/
│   ├── alpacaClient.js       Alpaca SDK v3 — paper/live, crypto/stocks, bracket orders
│   └── tradeExecutor.js      Kelly sizing → validate → bracket order → log
├── risk/
│   ├── kellyCriterion.js     Fractional Kelly with live Alpaca balance
│   ├── validator.js          10-check pre-trade safety gate + PDT warning
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
- **Cooldown**: 30 min minimum between trades on same symbol

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
