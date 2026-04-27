# AI Trader — Autonomous Quantitative Trading System

> **Status**: Active — Paper trading on Alpaca. Crypto-first (8 pairs), stock switching supported.  
> **Version**: v2.0.0 — April 2026  
> **Language**: Node.js 18+  
> **Capital**: Designed for small accounts ($500+). No PDT restrictions on crypto.

---

## What This Does

An autonomous algorithmic trading system that runs 24/7, scans 8 crypto markets every 15 minutes, uses a dual-node AI consensus engine to identify high-confidence trade setups, and executes bracket orders on Alpaca (paper or live).

**Signal pipeline per symbol:**
1. **Data** — Yahoo Finance price/OHLCV + RSS news headlines aggregated into a research bundle
2. **Gemini Node** — Technical analysis AI (EMA, RSI, trend, regime) → score −100 to +100
3. **Ollama Node** — Local LLM news sentiment → score −100 to +100 (excluded gracefully if offline)
4. **Consensus** — Weighted composite (Gemini 65%, Ollama 35%), approval threshold 60
5. **Validation** — 10-check pre-trade gate (kill switch, confidence, exposure, PDT, cooldown)
6. **Execution** — Bracket order on Alpaca (entry + stop-loss + take-profit, atomic)
7. **Logging** — HMAC-chained tamper-proof SQLite trade log

---

## Architecture

```
server/
├── index.js                  REST API + control panel (Express)
├── autonomous/
│   ├── loop.js               Main cycle: scan → analyze → trade → exit
│   └── scheduler.js          node-cron scheduler (default: every 15 min)
├── ai/
│   ├── consensus.js          Weighted dual-node consensus engine
│   ├── geminiNode.js         Technical analysis via Google Gemini Flash
│   └── ollamaNode.js         News sentiment via local Ollama LLM
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
```

---

## Quickstart

### 1. Install
```bash
npm install
```

### 2. Configure
```bash
cp .env.template .env
```
Fill in these 4 values in `.env`:
```env
GEMINI_API_KEY=AIza...          # Google AI Studio — free tier works
ALPACA_API_KEY=PK...            # From alpaca.markets → Paper Trading → API Keys
ALPACA_SECRET_KEY=...
OLLAMA_DESKTOP_IP=100.x.x.x    # Tailscale IP of Windows machine running Ollama
                                # OR leave as 'localhost' if Ollama runs locally
                                # OR ignore — system degrades to Gemini-only gracefully
```

### 3. Smoke Tests
Run in order, stop if any fail:
```bash
npm run test:db       # Database initializes cleanly
npm run test:data     # Yahoo Finance returns quotes (may rate-limit, retry once)
npm run test:kelly    # Kelly math is correct
npm run dry-run       # Full cycle without placing any orders
```

### 4. Run
```bash
npm start             # Server + auto-loop at localhost:3000
```

### 5. Trigger First Cycle
```bash
curl -X POST http://localhost:3000/api/run-now
```
Then check Alpaca paper dashboard: https://app.alpaca.markets/paper/dashboard/overview

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/status` | System health, live balance, kill switch state |
| GET | `/api/decisions?limit=20` | Last N AI decisions with node scores |
| GET | `/api/trades?limit=20` | Last N executed trades |
| GET | `/api/killswitch` | Kill switch status |
| POST | `/api/killswitch` | `{"action":"activate"}` or `{"action":"deactivate"}` |
| POST | `/api/run-now` | Trigger one analysis cycle immediately |
| POST | `/api/mode` | `{"mode":"paper"}` or `{"mode":"live"}` |

---

## Key Configuration (`.env`)

```env
# What to trade
WATCHED_SYMBOLS=BTC/USD,ETH/USD,SOL/USD,AVAX/USD,LINK/USD,DOGE/USD,LTC/USD,XRP/USD

# Switching to stocks (no code change needed):
# WATCHED_SYMBOLS=SPY,AAPL,TSLA
# Mixed (crypto 24/7, stocks during NYSE hours only):
# WATCHED_SYMBOLS=BTC/USD,ETH/USD,SPY

# Risk (crypto defaults)
STOP_LOSS_PCT=0.03            # 3% stop per trade
TAKE_PROFIT_PCT=0.06          # 6% target (2:1 R/R)
MAX_POSITION_PCT=0.05         # Max 5% portfolio per position
MAX_CONCURRENT_POSITIONS=3    # Correlation guard — never open >3 at once
MAX_DAILY_LOSS_PCT=0.03       # Kill switch trigger

# AI
APPROVAL_THRESHOLD=60         # Composite score needed to approve a trade
WEIGHT_GEMINI=0.65
WEIGHT_OLLAMA=0.35
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

## How the Cycle Works

```
Every 15 minutes:
  1. Fetch live Alpaca balance
  2. Check daily loss limit → kill switch if exceeded
  3. Check open positions → emergency close if >7% loss
  4. For each symbol in WATCHED_SYMBOLS:
     a. If stock + market closed → skip
     b. If open positions >= MAX_CONCURRENT_POSITIONS → stop scanning
     c. Aggregate price + news data
     d. Run Gemini + Ollama consensus
     e. If approved AND direction != NO_TRADE:
        - Kelly position sizing (live balance)
        - 10-check validator
        - Submit bracket order (entry + stop + target)
        - Log to SQLite
     f. Wait 3.5s before next symbol (Yahoo rate limit protection)
```

---

## Risk Model

- **Position size**: Quarter-Kelly (÷4) capped at 5% of live portfolio
- **Stop-loss**: 3% below entry (bracket order, atomic with entry)
- **Take-profit**: 6% above entry (2:1 reward/risk)
- **Emergency stop**: 7% unrealized loss triggers immediate close
- **Daily loss limit**: 3% of account triggers kill switch for rest of day
- **Consecutive losses**: 3 in a row triggers kill switch
- **Cooldown**: 30 min minimum between trades on same symbol

---

## Related Projects

- **Betting Analysis** (`/Users/tbrook/Desktop/Betting Analysis`) — Python MLB/NBA prop betting engine. Same conceptual architecture (EV scoring, Kelly sizing, confidence models). These two systems are designed to eventually share a unified dashboard.

---

## Roadmap

- [ ] Phase 1: WebSocket real-time data for intraday signals (5-min candles)
- [ ] Phase 2: Unified dashboard showing Alpaca trades + PrizePicks picks
- [ ] Phase 3: True scalping mode (1-min candles, sub-minute cycles)
- [ ] Phase 4: Shared signal layer between Betting Analysis and AI Trader
