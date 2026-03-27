# 🚀 AI Trader: Autonomous Staged Intelligence

AI Trader is a high-performance, autonomous trading system that combines local LLM reasoning (Ollama) with cloud-scale quantitative verification (Gemini). It is designed to scan the market for optimal opportunities, perform deep technical analysis, and execute trades with advanced risk management.

## 🧠 Staged AI Architecture

The system uses a unique **Hierarchical Consensus Pipeline**:

1.  **🔍 Market Scanner**: Scans real-time data for "Trending US Symbols," "Daily Top Gainers," and "Daily Losers."
2.  **📊 Data Aggregator**: Fetches OHLCV charts, RSI14, EMA cross-overs, and latest news headlines (RSS/Reuters).
3.  **🦙 Local AI (Ollama)**: Llama-3 performs the initial trade thesis generation locally on your hardware.
4.  **💎 Remote AI (Gemini)**: The "Ultimate Judge." Receives a batch of all Ollama results in ONE request to Approve or Reject each trade.
5.  **🔁 Refinement Loop**: If Gemini rejects a trade but provides feedback, Ollama re-processes the data for a final "Deep-Dive."

## 🛠️ Key Features

-   **Dynamic Discovery**: Finds "Optimal" symbols in real-time — no hardcoded watchlists.
-   **Consensus Verification**: Prevents "hallucinations" by requiring agreement between local and cloud AI models.
-   **Risk Management**:
    -   **Kelly Criterion**: Dynamic position sizing based on AI confidence.
    -   **Stop Loss / Take Profit**: Automatic risk/reward ratios.
    -   **Daily Loss Limit**: Auto-halts trading if a loss threshold is reached.
-   **Remote Dashboard**: Accessible via Tailscale on port `3000` from any authorized device (Mac/iOS/Phone).
-   **Paper & Live Mode**: Switch modes in `.env` for safe testing on Alpaca.

## 🚀 Getting Started

### Prerequisites
-   **Node.js v24+**
-   **Ollama**: Install and run `ollama run llama3` locally.
-   **Alpaca Trading Account**: Get API/Secret keys (Paper or Live).
-   **Google AI Studio**: Get a free Gemini API key.

### Installation
```powershell
npm install
```

### Configuration
Copy `.env.example` to `.env` and fill in your keys:
- `GEMINI_API_KEY`: Your Google AI Studio key.
- `ALPACA_API_KEY`: Your Alpaca key.
- `TRADING_MODE`: `paper` (Recommended) or `live`.

### Usage

**1. Start the API Server & Dashboard:**
```powershell
npm start
```
*Accessible at http://localhost:3000*

**2. Start the Autonomous Scheduler:**
```powershell
npm run loop
```
*The loop runs every 15 minutes by default.*

## 📂 Project Structure

- `server/data/`: Scanners and market data aggregators.
- `server/ai/`: AI node logic for Ollama and Gemini (Batch and Verify).
- `server/execution/`: Alpaca trade execution and order management.
- `server/db/`: SQLite database for logging and state.
- `server/risk/`: Kill-switch and risk calculations.

## 🛡️ Security

- **LOG_HMAC_SECRET**: All sensitive logs are integrity-checked using HMAC.
- **Environment Isolation**: API keys are never committed to Git (via `.gitignore`).

## 📜 License
MIT
