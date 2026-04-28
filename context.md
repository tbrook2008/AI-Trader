# AI Trader - Context for Future AI Agents

This document provides essential context for any AI agent continuing the development or maintenance of the AI Trader system.

## Project Vision
A fully autonomous, headless quantitative trading system designed for small accounts ($500+). It bridges the gap between high-level AI analysis and low-level trade execution.

## System Core Logic
1.  **Architecture**: Node.js (CommonJS) with a modular approach.
2.  **Consensus Engine (`server/ai/consensus.js`)**: Uses a weighted multi-node model. Current primary nodes are Gemini (Technical) and Ollama (Sentiment). 
    *   **AI Debate (Refinement Loop)**: If Gemini and Ollama heavily disagree (e.g., >50 score divergence), a `refine()` pass is triggered where Ollama is forced to read Gemini's technical thesis and re-evaluate its stance.
    *   **Few-Shot Calibration**: Ollama uses few-shot prompting to strictly adhere to precise sentiment scoring.
3.  **Data Strategy**:
    *   Uses `yahoo-finance2` (pinned to v2.11.3 for CJS compatibility).
    *   Handles "Too Many Requests" (429) errors with exponential backoff in `server/data/yahooFinance.js`.
    *   Staggers symbol fetching with `SYMBOL_FETCH_DELAY_MS` to prevent rate-limiting when scanning many symbols.
4.  **Risk Management (`server/risk/`)**:
    *   **Kelly Criterion**: Uses fractional Kelly sizing based on strategy memory (win rate/avg pnl).
    *   **Validator**: 10-point pre-trade safety gate. Includes a PDT warning for stocks on accounts <$25k.
    *   **Kill Switch**: Automatic halting if daily P&L drops below `MAX_DAILY_LOSS_PCT`.
5.  **Execution (`server/execution/`)**:
    *   Uses Alpaca SDK v3 (`@alpacahq/alpaca-trade-api`).
    *   Supports **Bracket Orders** (entry, stop-loss, and take-profit in one atomic submission).
    *   Fetches **Live Balance** from Alpaca for accurate position sizing.
6.  **Persistence**:
    *   SQLite (`data/trader.sqlite`) for decisions and trades.
    *   **HMAC Chaining**: Every trade log entry is cryptographically linked to the previous one to prevent tampering (`server/db/tradeLogger.js`).

## Critical Implementation Details
- **Symbol Normalization**: 
    - Internal/Alpaca format: `BTC/USD`
    - Yahoo Finance format: `BTC-USD`
    - Logic for this is centralized in `server/data/dataAggregator.js`.
- **Market Hours**: `loop.js` handles per-symbol logic. Crypto is 24/7, stocks follow NYSE hours.
- **Correlation Guard**: `MAX_CONCURRENT_POSITIONS` prevents the system from over-leveraging into correlated assets.

## Deployment & Setup
- Environment variables are in `.env`. Key keys: `GEMINI_API_KEY`, `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `OLLAMA_DESKTOP_IP`.
- `npm start` runs both the Express API and the autonomous loop scheduler.
- `public/index.html` is a simple functional dashboard.

## Known Limitations / Roadblocks
- Yahoo Finance rate limits are strict. Do not decrease `SYMBOL_FETCH_DELAY_MS` without testing.
- Ollama node expects a remote IP (via Tailscale) but falls back gracefully.
- Currently uses daily bars for 15-minute cycles; it is a **swing trader**, not a high-frequency scalper.

## Relationship to "Betting Analysis"
This project lives alongside a Python-based sports betting engine. They share a conceptual architecture (EV scoring, Kelly sizing). Future integration should aim for a unified dashboard and shared signal intelligence.
