# AI Trader — Context for Future AI Agents

This document provides essential context for any AI agent continuing development or maintenance of this system. Read this before making any changes.

---

## Project Vision

A fully autonomous, headless quantitative trading system for small accounts ($500+). It bridges high-level AI analysis with low-level bracket order execution on Alpaca, with a hard constraint of minimizing paid API usage by relying on a local LLM as the primary intelligence layer.

---

## Current Architecture (v3.0.0)

### AI Pipeline — Ollama-First Design
The consensus engine runs in this exact order per symbol:

1. **ARIA (Ollama / `quant-trader`)** — always runs first. Free, local, fast. Reads news headlines and returns a sentiment score (-1.0 to 1.0).
2. **Cost-Saving Gate** — if `abs(ollamaScore) < 25` AND `trend == 'neutral'`, **skip Gemini entirely** and log "flat market". This is the key cost-control mechanism.
3. **Gemini Node** — only called when ARIA detects real signal OR technicals show a trend. Performs technical analysis (EMA, RSI, regime) and returns score (-100 to 100).
4. **AI Debate Loop** — if Gemini and ARIA scores diverge by ≥50 points, `ollamaNode.refine()` is called, forcing ARIA to re-evaluate its sentiment against Gemini's technical thesis.
5. **Weighted Composite** — final score computed from available nodes. Approval threshold: 45.

### The ARIA Model (`quant-trader`)
ARIA is a **custom Ollama model** — not a modified version of llama3.1, but a separate named model built on top of it. It is defined in `Modelfile` at the project root.

**Critical details:**
- Model name: `quant-trader`
- Rebuild command: `ollama create quant-trader -f Modelfile`
- Temperature: 0.1 (baked in — do not increase, it makes outputs inconsistent)
- Contains 10 calibrated financial few-shot examples permanently in system prompt
- Hard-coded rules: regulatory events ≤−0.7, no hedge-phrasing, JSON-only output
- `llama3.1` still exists untouched as the user's general-purpose model

**Never change `OLLAMA_MODEL` in `.env` to `llama3.1`** — the generic model lacks the calibration and will produce inconsistent sentiment scores.

### Consensus Engine (`server/ai/consensus.js`)
- Weights: `WEIGHT_GEMINI=0.40`, `WEIGHT_OLLAMA=0.25` (note: weights get renormalized if a node is skipped/fails)
- The `redistributeWeights()` function handles dynamic renormalization when nodes are absent
- `resolveDirection()` uses simple vote majority between available nodes
- When Gemini is skipped (flat market), only Ollama is available → `redistributeWeights` returns `null` (< 2 nodes) → trade is automatically rejected. This is correct behavior.

**IMPORTANT**: The 2-node minimum in `redistributeWeights` means a flat-market skip = automatic NO_TRADE. This is intentional — if Ollama alone detects something, it still needs Gemini confirmation. The system is designed to be conservative.

---

## Key Files

| File | Purpose |
|------|---------|
| `Modelfile` | ARIA model definition — edit to change persona/examples |
| `server/ai/consensus.js` | Main pipeline orchestrator — Ollama-first gating logic lives here |
| `server/ai/ollamaNode.js` | ARIA API client — `analyze()` and `refine()` functions |
| `server/ai/geminiNode.js` | Gemini technical analysis — gated, not always called |
| `server/autonomous/loop.js` | Main trading cycle — processes symbols one at a time |
| `server/data/dataAggregator.js` | Symbol normalization (BTC/USD ↔ BTC-USD), data bundling |
| `server/risk/validator.js` | 10-check pre-trade safety gate |
| `server/execution/tradeExecutor.js` | Kelly sizing → bracket order submission |
| `server/db/tradeLogger.js` | HMAC-chained tamper-proof SQLite logging |
| `public/index.html` | Dashboard — polls `/api/logs` for live terminal output |

---

## Environment Variables (Critical Ones)

```env
OLLAMA_MODEL=quant-trader        # NEVER change to llama3.1
GEMINI_MODEL=gemini-flash-latest
OLLAMA_DESKTOP_IP=localhost      # Or Tailscale IP for remote Ollama
APPROVAL_THRESHOLD=45            # Lower = more trades, higher = more selective
WEIGHT_GEMINI=0.40
WEIGHT_OLLAMA=0.25
CRON_SCHEDULE=*/10 * * * *       # Every 10 minutes
TRADING_MODE=paper               # Always paper until profitable
```

---

## Critical Implementation Details

### Symbol Normalization
- Internal/Alpaca format: `BTC/USD`
- Yahoo Finance format: `BTC-USD`
- Logic centralized in `server/data/dataAggregator.js` → `toYahooSymbol()`
- **Never** pass raw Yahoo symbols to Alpaca or vice versa

### Market Hours
- `loop.js` handles per-symbol logic
- Crypto: always open (24/7, isCrypto=true bypasses market hours check)
- Stocks: NYSE hours only (Mon–Fri 9:30–16:00 ET)

### Ollama Failure Handling
- If Ollama returns `null` (offline/error), `redistributeWeights` gets only Gemini → still < 2 nodes → consensus aborts → NO_TRADE
- This is correct — the system requires both nodes (or the Gemini-only path after gating is bypassed)
- **Do not lower the 2-node minimum** without careful consideration of the risk implications

### Gemini Rate Limits
- `gemini-flash-latest` has generous free tier
- The Ollama-first gating significantly reduces calls
- If rate limits appear, increase the divergence threshold for the debate loop from 50 to 70

### Yahoo Finance Rate Limits
- Symbol fetches are staggered by `SYMBOL_FETCH_DELAY_MS` (default 3000ms)
- Do not decrease below 2000ms
- Exponential backoff on 429 errors is implemented in `yahooFinance.js`

---

## Deployment

- **Process manager**: PM2 (Windows)
- **Processes**: `ai-trader-api` (port 3000) + `ai-trader-loop`
- **Persistence**: `pm2 startup` + `pm2 save` — survives reboots
- **Logs**: `pm2 logs ai-trader-loop --lines 100` or watch via dashboard terminal
- **Restart after .env changes**: `pm2 restart all --update-env`

---

## Known Issues / Gotchas

- `yahoo-finance2 v2.11.3` is pinned — do not upgrade without testing (breaking API changes)
- Reuters RSS feed (`feeds.reuters.com`) is currently unreachable — this is a known external issue, not a code bug. Other RSS sources work fine.
- `[yahooFinance.historical] Invalid options` warnings in PM2 error log are benign deprecation notices from the Yahoo library — not affecting data quality
- ARIA (quant-trader) Ollama responses are extremely fast (~1-2s) because the model identity/persona is pre-baked, not injected per-request

---

## Relationship to "Betting Analysis"

This project lives alongside a Python-based sports betting engine. They share conceptual architecture (EV scoring, Kelly sizing). Future integration goal: unified dashboard and shared signal intelligence layer.
