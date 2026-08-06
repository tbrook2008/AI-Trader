# Analysis Report: scaleOutTarget Export Requirement & Project Test Setup

**Agent**: teamwork_preview_explorer_m1_r1_3  
**Role**: Explorer Agent (Read-Only Investigator)  
**Target Repository**: `/Users/tbrook/Desktop/AI Trader`  
**Date**: 2026-08-04  

---

## 1. Executive Summary

This investigation analyzed two primary focus areas for the AI Trader project:
1. **`scaleOutTarget` Export Requirement**: Defined the exact calculation logic, formula, and export structure for the 1 Standard Deviation mark (`scaleOutTarget`) within `server/quantitative/vwapReversion.js` for both LONG and SHORT mean-reversion signals.
2. **Project Test Setup & Runner Mapping**: Mapped out the entire test architecture, dependencies, npm package scripts, unit test runners (`test-all.js`), full cycle integration scripts (`test-full-cycle.js`), synthetic E2E specs (`test-vwap-e2e.js`), and scratch analysis scripts.

---

## 2. Analysis: `scaleOutTarget` Export Requirement

### 2.1 Context & Objectives
In institutional VWAP mean-reversion strategies, positions are taken when price strays significantly from the mean (e.g. touching +/- 2 SD bands). Profit taking is staged:
- **Stage 1 (Partial 50% Scale-Out)**: Taken when price reverts halfway to the VWAP center line, which corresponds to the **1 Standard Deviation mark** (`scaleOutTarget`).
- **Stage 2 (Final Exit)**: Taken when price reaches the VWAP center line (`target`).

To support autonomous position management in downstream execution (`tradeExecutor.js` and `riskMonitor.js`), `vwapReversion.evaluate(history)` must export `scaleOutTarget` directly in the signal payload.

### 2.2 Current Signal Structure in `vwapReversion.js`
Currently, `calculateVWAP(candles)` in `server/quantitative/vwapReversion.js` returns:
```javascript
{
    vwap: vwap,
    upperBand: vwap + sdMultiplier * sd, // +2 SD by default
    lowerBand: vwap - sdMultiplier * sd, // -2 SD by default
    sd: sd                               // Standard deviation value
}
```
Currently, `evaluate(history)` returns:
- **LONG Signal**:
  ```javascript
  {
      action: 'LONG',
      entry: currentCandle.close,
      target: vwap,
      stopLoss: currentCandle.close - (slMultiplier * atr),
      metadata: { rsi, vwap, lowerBand, volume: currentCandle.volume, volumeSMA, atr }
  }
  ```
- **SHORT Signal**:
  ```javascript
  {
      action: 'SHORT',
      entry: currentCandle.close,
      target: vwap,
      stopLoss: currentCandle.close + (slMultiplier * atr),
      metadata: { rsi, vwap, upperBand, volume: currentCandle.volume, volumeSMA, atr }
  }
  ```

### 2.3 `scaleOutTarget` Mathematical Calculation & Logic
The 1 Standard Deviation mark represents the halfway recovery point between the +/- 2 SD entry zone and the VWAP mean line (0 SD):

1. **LONG Position Logic**:
   - **Entry condition**: Price $\le$ lower band ($-2\text{SD}$: $\text{vwap} - 2 \cdot \text{sd}$).
   - **Mean Reversion Trajectory**: Price rises upward from entry toward VWAP mean.
   - **1 SD Mark Calculation**: 
     $$\text{scaleOutTarget}_{\text{LONG}} = \text{vwap} - 1 \cdot \text{sd}$$
   - **Rationale**: For a long position entered below the mean, the halfway recovery point is 1 SD below VWAP. When rising price reaches $\text{vwap} - \text{sd}$, the position scales out 50%.

2. **SHORT Position Logic**:
   - **Entry condition**: Price $\ge$ upper band ($+2\text{SD}$: $\text{vwap} + 2 \cdot \text{sd}$).
   - **Mean Reversion Trajectory**: Price falls downward from entry toward VWAP mean.
   - **1 SD Mark Calculation**: 
     $$\text{scaleOutTarget}_{\text{SHORT}} = \text{vwap} + 1 \cdot \text{sd}$$
   - **Rationale**: For a short position entered above the mean, the halfway recovery point is 1 SD above VWAP. When falling price reaches $\text{vwap} + \text{sd}$, the position scales out 50%.

### 2.4 Proposed Enhanced StrategySignal Export
The signal returned by `vwapReversion.evaluate(history)` should conform to the project interface contract defined in `PROJECT.md`:

```javascript
// LONG Signal Payload
{
    action: 'LONG',
    entry: currentCandle.close,
    target: vwapData.vwap,
    scaleOutTarget: vwapData.vwap - vwapData.sd,
    stopLoss: currentCandle.close - (slMultiplier * atr),
    metadata: {
        rsi,
        vwap: vwapData.vwap,
        upperBand: vwapData.upperBand,
        lowerBand: vwapData.lowerBand,
        upperBand1SD: vwapData.vwap + vwapData.sd,
        lowerBand1SD: vwapData.vwap - vwapData.sd,
        volume: currentCandle.volume,
        volumeSMA,
        atr,
        adx,
        hurst,
        sessionTimeET
    }
}

// SHORT Signal Payload
{
    action: 'SHORT',
    entry: currentCandle.close,
    target: vwapData.vwap,
    scaleOutTarget: vwapData.vwap + vwapData.sd,
    stopLoss: currentCandle.close + (slMultiplier * atr),
    metadata: {
        rsi,
        vwap: vwapData.vwap,
        upperBand: vwapData.upperBand,
        lowerBand: vwapData.lowerBand,
        upperBand1SD: vwapData.vwap + vwapData.sd,
        lowerBand1SD: vwapData.vwap - vwapData.sd,
        volume: currentCandle.volume,
        volumeSMA,
        atr,
        adx,
        hurst,
        sessionTimeET
    }
}
```

---

## 3. Analysis: Project Test Setup & Test Runner Mapping

### 3.1 Package Configuration & Dependencies (`package.json`)
- **Node Environment**: Engine requires Node `>=18.0.0`. System currently runs Node `v22.15.0`.
- **Module Format**: Pure Node.js CommonJS (`require` / `module.exports`). No transpilation or build step (e.g. Babel or TypeScript) is required before running tests.
- **Dependencies**:
  - Direct execution dependencies: `@alpacahq/alpaca-trade-api`, `better-sqlite3`, `dotenv`, `express`, `node-cron`, `rss-parser`, `winston`, `yahoo-finance2`, `@google/generative-ai`, `axios`.
- **Existing `package.json` Scripts**:
  - `npm start`: `node server/index.js`
  - `npm run dev`: `node --watch server/index.js`
  - `npm run loop`: `node server/autonomous/scheduler.js`
  - `npm run test:data`: Inline CLI test for `yahooFinance.getQuote`
  - `npm run test:db`: Inline CLI test for `schema.initDb()`
  - `npm run test:kelly`: Inline CLI test for `kellyCriterion.calculate`
  - `npm run test:ollama`: Inline CLI test for `ollamaNode.test()`
  - `npm run dry-run`: `DRY_RUN=true node server/autonomous/loop.js`
- **Gap Identified**: There is currently no standard `"test"` command entry (e.g. `"test": "node test-all.js"`) inside `package.json`.

### 3.2 Master Unit Test Suite (`test-all.js`)
- **Location**: `/Users/tbrook/Desktop/AI Trader/test-all.js`
- **Execution Command**: `node test-all.js`
- **Test Framework Architecture**: Custom lightweight test harness. Uses helper functions `test(name, fn)`, `assert(condition, msg)`, and `assertEqual(a, b, msg)`. Tracks `passed` and `failed` metrics, exiting with code `0` on success or `1` on failure.
- **Test Coverage Breakdown**:
  1. **ATR Tests** (`calculateATR`): Validates handling of insufficient history length, return of positive values on sufficient data, and higher ATR values on volatile price action.
  2. **Bollinger + RSI Tests** (`bollingerRsi.evaluate`): Tests `NO_TRADE` on insufficient data or flat market, restriction preventing `SHORT` signals on crypto pairs, and mandatory bullish candle body check for `LONG` signals.
  3. **MACD Tests** (`macd.evaluate` & `computeEMA`): Tests `NO_TRADE` on $<35$ bars, correct output array sizing, EMA convergence to flat input, and flat market suppression.
  4. **Volume Profile Tests** (`volumeProfile.analyzeVolume` & `classifyVolume`): Tests dead volume filtering ($<20\%$ of 20-period average) and volume classification (`HIGH`, `BELOW_AVG`).
  5. **Kelly Criterion Tests** (`kellyCriterion.getPositionSize`): Tests position sizing structure, maximum position cap enforcement, and confidence-scaled position sizing.
  6. **Symbol Detection Tests** (`dataAggregator.isCryptoSymbol`): Validates crypto classification for slashed (`BTC/USD`) and unslashed (`BTCUSD`) symbols vs equity symbols (`AAPL`, `TSLA`).
  7. **RSI Tests** (`computeRSI`): Tests null handling on short data, extreme overbought output ($>90$) on continuous gain sequences, and neutral output ($\approx 50$) in alternating flat markets.
  8. **Module Integration Checks**: Syntax and import verification for `tradeExecutor`, `consensus`, `riskMonitor`, `validator`, `dataAggregator`, and `alpacaClient`.

- **Observed Test Failure / Discrepancy**:
  - Running `node test-all.js` executes 26 test assertions.
  - 25 pass, 1 fails: `❌ getPositionSize returns valid sizing object: Position should respect MAX_POSITION_PCT=6%`.
  - **Root Cause**: `test-all.js` line 183 asserts `sizing.positionDollars <= 100000 * 0.06`, but `server/risk/kellyCriterion.js` line 90 hardcodes default `maxPct = parseFloat(process.env.MAX_POSITION_PCT || '0.10')` ($10\%$). Without setting `MAX_POSITION_PCT=0.06` in the test environment, the Kelly test produces a position size up to $10\%$.

### 3.3 Integration & End-to-End Runners
1. **Full Synthetic Integration Runner (`test-full-cycle.js`)**:
   - Location: `/Users/tbrook/Desktop/AI Trader/test-full-cycle.js`
   - Purpose: End-to-end integration test executing `aggregate()` $\rightarrow$ `runConsensus()` $\rightarrow$ `logDecision()` $\rightarrow$ `execute()` under `DRY_RUN=true`.
   - Execution Command: `node test-full-cycle.js`

2. **Synthetic E2E Test Runner (`test-vwap-e2e.js`)**:
   - Specified in `TEST_INFRA.md` & `PROJECT.md` for Milestone 3 verification.
   - Purpose: Simulates streaming market bar feeds across full day sessions to test R1 trend rejection, R2 session time rejection, R3 squeeze check rejection, and R4 position management state machine transitions.

### 3.4 Auxiliary & Scratch Test Scripts (`scratch/`)
- `scratch/test_vwap.js`: Historical 3-day SPY bar backtest testing VWAP upper/lower band touch frequency.
- `scratch/test_vwap2.js`: Historical 7-day SPY bar backtest testing `vwapReversion.evaluate` with parameter overrides (`global.OPTIMIZE_PARAMS`).
- `scratch/test_vwap3.js`: Statistical analysis script inspecting standard deviation distance distribution and volume ratios across 7-day SPY 1m candles.
- Root test scripts: `test-alpaca-crypto.js`, `test-bracket.js`, `test-debate.js`, `testBar.js`.

---

## 4. Recommendations for Implementer Agent

1. **In `vwapReversion.js`**:
   - Export `scaleOutTarget` as `vwapData.vwap - vwapData.sd` for `LONG` signals.
   - Export `scaleOutTarget` as `vwapData.vwap + vwapData.sd` for `SHORT` signals.
   - Include `upperBand1SD` (`vwapData.vwap + vwapData.sd`) and `lowerBand1SD` (`vwapData.vwap - vwapData.sd`) in signal `metadata`.

2. **In Test Infrastructure**:
   - Add unit tests to `test-all.js` specifically verifying `vwapReversion.evaluate` signal structure, including `scaleOutTarget` export for both long and short setups.
   - Fix the environment setup in `test-all.js` (or `kellyCriterion.js`) for `MAX_POSITION_PCT` so all unit tests pass cleanly.
