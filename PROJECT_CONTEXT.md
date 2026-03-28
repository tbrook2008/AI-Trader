# AI Trader Project Context

## Current Status (March 28, 2026)
The system is currently in a **fully autonomous Paper Trading phase**. After resolving API quota and architecture-related crashes, the system is now successfully executing the "Refinement Loop" (Ollama-Gemini consensus) every 10 minutes.

### Key Architecture
- **Scanning**: Yahoo Finance screeners collect Trending Stocks and Day Gainer Crypto (24/7 scanning).
- **Sentiment**: Local Ollama (`llama3`) performs a deep-dive on news.
- **Judgment**: Gemini (`gemini-flash-latest`) acts as the ultimate judge.
- **Refinement**: If Gemini disagrees with Ollama and provides feedback, Ollama re-analyzes for a final consensus pass.
- **Execution**: Alpaca API (Paper) with 10-point Risk Validator (Confidence, Cooldown, Daily Loss, etc.).

## 🐛 Resolved Issues
- **Gemini Quota**: Switched from experimental models to the stable `gemini-flash-latest` with a Tier 1 paid quota.
- **Logging Crash**: Fixed a crash in `tradeExecutor.js` where missing target prices broke SQLite inserts.
- **Cooldown Bug**: Fixed a bug where loop runs were resetting the 30-minute trade cooldown.
- **Refinement Loop**: Transformed the system from a single-pass AI check to a dual-pass iterative refinement logic.

## 🛠️ Current Bugs/Items to Monitor
- **RSS Availability**: Reuters RSS (`feeds.reuters.com`) is currently unreliable/returning DNS errors. The system falls back to other news sources successfully.
- **Stock Market Hours**: Stock trades (e.g., Unity, SSRM) will only fill on weekdays. Crypto trades (BTC-USD, ETH-USD) will fill 24/7.
- **Dashboard Latency**: The initial "Recent Decisions" table can be slow to refresh on the first load after a cycle.

## 🚀 Vision & Next Steps
- **Live Trading Mode**: Transition from `paper` to `live` once the paper-trading PnL proves positive over 7-14 days.
- **Portfolio Weighting**: Implement dynamic Kelly Criterion adjustments based on cumulative win rate.
- **News Sources**: Add more robust scraping for financial news beyond Yahoo/Reuters (e.g., Benzinga, Twitter/X).

## Verification Strategy
- **Logs**: Monitor `logs/combined.log` for **"✅ Order submitted"**.
- **Dashboard**: Check `http://localhost:3000` for the "Nodes Used" and "Refinement" tags.
- **Alpaca**: Verify orders appear for the current API key (confirmed active with $99k balance).
