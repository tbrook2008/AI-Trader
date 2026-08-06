# AI Trader Codebase & Architecture Survey

## 1. Repository Structure & File Inventory

The repository `/Users/tbrook/Desktop/AI Trader` is a Node.js-based autonomous trading system using Alpaca API for paper/live trading.

### Top-Level Directory Tree

```
AI Trader/
├── .env                       # Environment variables (API keys, trading parameters)
├── .env.template              # Environment variable template
├── .gitignore                 # Git ignore configuration
├── AGENT_MEMORY.md            # Agent memory / developer log
├── AI_Trader_V1_Plan.md       # Original V1 design document
├── Modelfile                  # Ollama model definition file
├── README.md                  # System overview and quickstart guide
├── WINDOWS_SETUP.md           # Setup instructions for Windows
├── backtest.js                # Historical backtesting script
├── backtest_results.txt       # Saved backtest output
├── context.md                 # System context and architecture documentation
├── package.json               # Node.js package setup and dependencies
├── package-lock.json          # Dependency lockfile
├── real_backtest.js           # Real historical market data backtester
├── scratch/                   # Experimental / research scripts
│   ├── test_vwap.js           # VWAP band touch frequency test
│   ├── test_vwap2.js          # VWAP strategy signal test
│   └── test_vwap3.js          # VWAP indicator distribution test
├── start-trader.bat           # Windows startup script
├── start-trader.vbs           # VBS script for background launch
├── stderr.log                 # Saved standard error log
├── stdout.log                 # Saved standard output log
├── test-all.js                # Custom test runner & module suite
├── test-alpaca-crypto.js      # Alpaca crypto API order test
├── test-bracket.js            # Alpaca bracket order test
├── test-debate.js             # Multi-agent AI debate test
├── test-full-cycle.js         # End-to-end integration test (dry run)
├── test.log                   # Test output log
├── testBar.js                 # Sample market bar test file
├── data/                      # Persistent SQLite database storage
│   ├── trader.sqlite          # SQLite database
│   ├── trader.sqlite-shm      # Shared memory file
│   └── trader.sqlite-wal      # Write-ahead log file
├── logs/                      # Application logging directory
│   ├── combined.log           # Winston combined logs
│   └── error.log              # Winston error logs
├── public/                    # Web UI dashboard frontend
│   └── index.html             # Control panel dashboard interface
└── server/                    # Server backend application code
    ├── index.js               # Express API server & engine entry point
    ├── backtest.js            # Server-side backtesting engine
    ├── optimize.js            # Strategy parameter grid-search optimizer
    ├── query.js               # Database query CLI helper
    ├── ai/                    # Multi-model AI decision engines
    │   ├── consensus.js       # Tri-node consensus aggregator
    │   ├── deepseekNode.js    # DeepSeek API integration
    │   ├── geminiNode.js      # Google Gemini API integration
    │   └── ollamaNode.js      # Local Ollama LLM integration
    ├── autonomous/            # Core loop execution & risk orchestration
    │   ├── loop.js            # WebSocket market data listener & processing loop
    │   ├── riskMonitor.js     # 1-min position risk monitor & trailing stop engine
    │   └── scheduler.js       # Standalone CLI entry point for stream & risk monitor
    ├── data/                  # Market data ingestion & parameter configuration
    │   ├── dataAggregator.js  # Candle buffer & news headline aggregator
    │   ├── newsScraper.js     # RSS feed scraper for news sentiment
    │   └── symbolParams.json  # Per-symbol optimized strategy parameters
    ├── db/                    # Data persistence layer
    │   ├── schema.js          # SQLite table definitions & key-value state store
    │   ├── strategyMemory.js  # Setup and win-rate tracker
    │   └── tradeLogger.js     # Trade history and decision log persistence
    ├── execution/             # Order execution and broker client layer
    │   ├── alpacaClient.js    # Alpaca Trade API wrapper (Paper/Live)
    │   ├── liquidate.js       # Emergency portfolio liquidation script
    │   └── tradeExecutor.js   # Main trade execution pipeline
    ├── quantitative/          # Math indicators and quantitative signal generators
    │   ├── adx.js             # Average Directional Index (ADX) trend strength
    │   ├── atr.js             # Average True Range (ATR) & dynamic multiplier
    │   ├── bollingerRsi.js    # Bollinger Bands + RSI mean reversion logic
    │   ├── hmm.js             # Hidden Markov Model regime classification
    │   ├── hurst.js           # Hurst Exponent rescaled range analysis
    │   ├── kalman.js          # Kalman Filter pair trading & trend estimation
    │   ├── macd.js            # Moving Average Convergence Divergence
    │   ├── ouModel.js         # Ornstein-Uhlenbeck mean reversion process
    │   ├── volumeProfile.js   # Volume classification & profile validation
    │   ├── vwap.js            # General VWAP calculation utilities
    │   └── vwapReversion.js   # VWAP Mean Reversion Strategy implementation
    ├── risk/                  # Risk management & pre-trade validation
    │   ├── correlation.js     # Open position correlation filter
    │   ├── kellyCriterion.js  # Kelly criterion position sizing logic
    │   ├── killSwitch.js      # Global panic kill-switch state manager
    │   ├── propRiskManager.js # Prop firm risk limits & position sizing
    │   └── validator.js       # Pre-trade risk validator checks
    └── utils/                 # Utilities
        ├── logger.js          # Winston logger instance
        └── timeframe.js       # Timeframe conversion utilities
```

---

## 2. Package Setup & Dependencies

### Package Manager & Node Engine
- **Engine**: Node.js `>= 18.0.0`
- **Main Entry Point**: `server/index.js`
- **NPM Scripts**:
  - `npm start`: `node server/index.js`
  - `npm run dev`: `node --watch server/index.js`
  - `npm run loop`: `node server/autonomous/scheduler.js`
  - `npm run test:data`: Quick check of Yahoo Finance API
  - `npm run test:db`: DB schema initialization test
  - `npm run test:kelly`: Kelly criterion test script
  - `npm run test:ollama`: Ollama API test script
  - `npm run dry-run`: `DRY_RUN=true node server/autonomous/loop.js`

### External Dependencies
| Dependency | Version | Purpose |
| --- | --- | --- |
| `@alpacahq/alpaca-trade-api` | `^3.1.3` | Alpaca REST & WebSocket trading client |
| `@google/generative-ai` | `^0.21.0` | Google Gemini API SDK |
| `axios` | `^1.7.2` | HTTP requests for DeepSeek and webhooks |
| `better-sqlite3` | `^9.4.3` | Synchronous high-performance SQLite database |
| `dotenv` | `^16.4.5` | Environment variable loader |
| `express` | `^4.19.2` | Web API server & control panel static host |
| `node-cron` | `^3.0.3` | Cron task scheduler |
| `rss-parser` | `^3.13.0` | RSS market news ingestion |
| `winston` | `^3.13.0` | File & console logger |
| `yahoo-finance2` | `^2.11.3` | Market data fallback / news source |

### Key Findings on Technical Indicators & Math Packages
- **No external indicator library** (such as `technicalindicators` or `ta-lib`) is used.
- All technical indicators (VWAP, Anchored VWAP, Standard Deviation Bands, RSI, ATR, ADX, Hurst Exponent, Volume SMA, MACD, Bollinger Bands, Kalman Filter, HMM, OU Model) are **100% custom JavaScript math implementations** located under `server/quantitative/`.

### Key Findings on Test Framework
- **No standard test framework** (such as `Jest`, `Mocha`, `Vitest`, or `Jasmine`) is installed.
- Automated tests are written as standalone Node.js scripts (`test-all.js`, `test-full-cycle.js`, etc.) using custom assertion helpers (`test()`, `assert()`, `assertEqual()`).

---

## 3. Strategy & Trade Execution Interaction Flow

```
+-------------------------------------------------------------------------+
|                              ENTRY POINTS                               |
|  - server/index.js (Express server + starts scheduler.js)                |
|  - server/autonomous/scheduler.js (CLI loop launcher)                   |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                  server/autonomous/loop.js (startStream)                |
|  - Connects to Alpaca WebSockets (Stock data_stream_v2 / Crypto v1beta3)|
|  - On 1-min bar -> processSymbol(symbol, bar)                           |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                  server/autonomous/loop.js (processSymbol)              |
|  1. Check killSwitch.isActive()                                         |
|  2. Check session time window (9:45-11:30, 13:30-15:30 EST)             |
|  3. Aggregate candle history (dataAggregator.aggregate)                 |
|  4. Check open position correlation (correlation.checkCorrelation)      |
|  5. Call tradeExecutor.execute({ bundle })                              |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                      server/execution/tradeExecutor.js                  |
|  1. Load per-symbol params from server/data/symbolParams.json           |
|  2. Call strategy signal generator: vwapReversion.evaluate(history)     |
|  3. Fetch live account balance & open positions via alpacaClient        |
|  4. Size position via propRiskManager.calculatePositionSize             |
|  5. Run pre-trade checks via validator.runChecks                        |
|  6. Validate volume profile via volumeProfile.analyzeVolume             |
|  7. If DRY_RUN=true -> Log dry run & return without placing order       |
|  8. Submit Alpaca market order via alpacaClient.submitOrder             |
|  9. Log open trade to DB via tradeLogger.logTrade                       |
| 10. Record setup in strategyMemory.saveSetup                            |
| 11. Send POST signal webhook payload to Friends Exec Node (port 4000)   |
+-------------------------------------------------------------------------+
                                     ^
                                     | (Parallel Async Loop)
+-------------------------------------------------------------------------+
|                 server/autonomous/riskMonitor.js (monitorRisk)          |
|  - Runs every 60 seconds via setInterval                                |
|  - Fetches open Alpaca positions                                        |
|  - Matches positions with DB open trade records                         |
|  - Dynamically ratchets trailing stop using ATR                         |
|  - Evaluates current price against stopLoss and targetPrice             |
|  - If breached -> Closes position via alpacaClient.closePosition        |
|  - Updates trade outcome in DB & sends CLOSE webhook payload to port 4000|
+-------------------------------------------------------------------------+
```

---

## 4. Existing Test Setup & Automated Scripts

1. **`node test-all.js`**:
   - Primary custom integration & unit test suite.
   - Tests `ATR`, `Bollinger+RSI`, `MACD`, `Volume Profile`, `Kelly Criterion`, `Symbol Detection`, `RSI`, and verifies syntax/module exports for core pipeline modules (`tradeExecutor`, `consensus`, `riskMonitor`, `validator`, `dataAggregator`, `alpacaClient`).
2. **`node test-full-cycle.js`**:
   - Integration test running synthetic market data through `dataAggregator` -> `consensus` -> DB decision logging -> `tradeExecutor` (enforcing `DRY_RUN=true`).
3. **`npm run dry-run`** (`DRY_RUN=true node server/autonomous/loop.js`):
   - Connects live to WebSocket stream and processes signals without executing actual broker orders.
4. **Specific Test Scripts**:
   - `test-alpaca-crypto.js`: Tests crypto order submission to Alpaca.
   - `test-bracket.js`: Tests bracket order submission.
   - `test-debate.js`: Tests AI multi-node consensus output.
   - `scratch/test_vwap.js`, `scratch/test_vwap2.js`, `scratch/test_vwap3.js`: VWAP strategy evaluation against historical Alpaca bar data.
5. **Backtest Runners**:
   - `backtest.js` & `real_backtest.js`: Offline backtesters simulating historical bar sequences.

---

## 5. Gap Analysis Against Target Requirements (`ORIGINAL_REQUEST.md`)

| Requirement | Current Status in Codebase | Required Action |
| --- | --- | --- |
| **R1. Macro Regime Filter** | `adx.js` (`isTrending`) and `hurst.js` (`classifyRegime`) exist in `server/quantitative/`, but `vwapReversion.js` does NOT call or enforce them in `evaluate()`. | Integrate `adx.js` or `hurst.js` into `vwapReversion.js` so mean reversion signals are disabled when market is in a strong trend regime. |
| **R2. Time-of-Day Filtering** | Session filter exists in `loop.js` (9:45-11:30, 13:30-15:30), but NOT inside `vwapReversion.js`. | Implement time check directly inside `vwapReversion.js` to reject signals prior to 10:15 AM ET. |
| **R3. VWAP Band Squeeze Check** | `vwapReversion.js` does not check if target price distance is greater than `1.5 * ATR`. | Add validator in `vwapReversion.js` confirming `Target Price - Entry Price > 1.5 * ATR`. |
| **R4. Autonomous Position Management (Scale-Out)** | `tradeExecutor.js` submits single 100% position orders, and `riskMonitor.js` closes 100% of open position at target or stop. | Upgrade `tradeExecutor.js` and `riskMonitor.js` (and in-memory position tracker) to execute scale-out: 50% partial exit at 1 SD band, move stop to breakeven, final 50% exit at VWAP center line, supporting fractional rounding. |
