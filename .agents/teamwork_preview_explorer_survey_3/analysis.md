# Technical Analysis: Trade Execution & Active Position Management (R4 Scale-Out Architecture)

**Agent**: `teamwork_preview_explorer_survey_3`  
**Date**: 2026-08-05  
**Target Repository**: `/Users/tbrook/Desktop/AI Trader`  
**Focus Scope**: `server/execution/tradeExecutor.js`, `server/execution/alpacaClient.js`, `server/autonomous/riskMonitor.js`, `server/autonomous/loop.js`, `server/autonomous/scheduler.js`, `server/quantitative/vwapReversion.js`, `server/db/tradeLogger.js`, `server/db/schema.js`, `server/risk/propRiskManager.js`.

---

## Executive Summary

This report presents an architectural investigation of the AI Trader execution engine and active position management pipeline. The primary objective is to define the technical requirements and architecture for **R4: Autonomous Position Management (Scale-Out Strategy)** for the VWAP Mean Reversion trading module.

Under R4, the trading bot must actively manage dynamic positions in memory and SQLite state, implementing a 2-stage scale-out protocol:
1. **Stage 1 (1 StdDev Mark)**: Submit a 50% partial take-profit market order upon price reaching the 1 Standard Deviation band ($\text{VWAP} \pm 1 \sigma$).
2. **Breakeven Stop Adjustment**: Automatically update the stop-loss on the remaining 50% position to the entry price ($P_{\text{entry}}$).
3. **Stage 2 (VWAP Center Line)**: Close the final 50% position when price reaches the VWAP center line.
4. **Fractional Precision**: Maintain exact decimal accounting ($Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$) to prevent fractional share/satoshi dust orphaned on Alpaca.

---

## 1. Trade Execution Flow & Alpaca Integration Analysis

### 1.1 Execution Pipeline Sequence in `tradeExecutor.js`

The trade execution pipeline is triggered in `server/execution/tradeExecutor.js` via `execute({ bundle })`. The step-by-step control flow is as follows:

```
[processSymbol in loop.js]
         │
         ▼
 1. getSymbolParams(symbol) (tradeExecutor.js:16)
         │  ├─ Checks symbolParams.json or global.OPTIMIZE_PARAMS
         │  └─ Rejects trade if symbol parameters missing (lines 47-50)
         ▼
 2. vwapReversion.evaluate(history) (tradeExecutor.js:52)
         │  ├─ Evaluates 1-minute candle history against VWAP ± 2 SD & RSI gates
         │  └─ Returns signal { action: 'LONG'|'SHORT', entry, target, stopLoss, metadata }
         ▼
 3. Alpaca Account & Positions Fetch (tradeExecutor.js:75)
         │  ├─ Promise.all([alpaca.getAccount(), alpaca.getOpenPositions()])
         │  └─ Validates account.tradingBlocked (lines 86-89)
         ▼
 4. Position Sizing via Prop Risk Manager (tradeExecutor.js:94)
         │  ├─ propRiskManager.calculatePositionSize(symbol, price, signal.stopLoss)
         │  └─ Divides RISK_PER_TRADE ($200) by stop distance Math.abs(price - stopLoss)
         ▼
 5. Validator Checks (tradeExecutor.js:111)
         │  └─ Runs validator.runChecks(...) (drawdown, max position %, cooldown)
         ▼
 6. Volume Profile Gate (tradeExecutor.js:131)
         │  └─ analyzeVolume(history, direction, symbol) checks liquid volume
         ▼
 7. Dry-Run & Order Placement Guard (tradeExecutor.js:143)
         │  ├─ If DRY_RUN === true: logs dry run and exits without network order
         │  └─ If DRY_RUN === false: calls alpaca.submitOrder({ symbol, qty, side })
         ▼
 8. Database Logging & Webhook Broadcast (tradeExecutor.js:166)
         │  ├─ logTrade(...) writes record to SQLite trades table
         │  ├─ memory.saveSetup(...) stores setup features
         │  └─ HTTP POST to localhost:4000/api/internal/signal (Friends Exec Node)
```

### 1.2 Alpaca SDK Usage (`server/execution/alpacaClient.js`)

- **SDK Package**: `@alpacahq/alpaca-trade-api` (SDK v3).
- **Client Instantiation** (`alpacaClient.js:15-19`):
  ```javascript
  const isLive = (process.env.TRADING_MODE || 'paper') === 'live';
  _client = new Alpaca({
    keyId:     process.env.ALPACA_API_KEY,
    secretKey: process.env.ALPACA_SECRET_KEY,
    paper:     !isLive,
  });
  ```
- **Symbol Format Handling**:
  - Internal / DB format: `BTC/USD` or `SPY`.
  - Alpaca order placement (`submitOrder` in `alpacaClient.js:95`): uses `normalizeSymbol(symbol)` (`BTC/USD` for crypto, `SPY` for stock).
  - Alpaca position close (`closePosition` in `alpacaClient.js:64`): expects stripped slash format `BTCUSD`.
- **Order Placement Method**:
  - `submitOrder` in `alpacaClient.js:95-138` constructs `orderParams = { symbol, side, type: 'market', time_in_force: isCrypto ? 'gtc' : 'day', qty: qty.toString() }`.
  - **Key Finding**: Native Alpaca bracket/OCO orders are **bypassed**. `tradeExecutor.js:153` calls `submitOrder` without passing `stopPrice` or `takeProfitPrice`. All stop-loss and take-profit enforcement is delegated to custom software risk monitoring.

---

## 2. Position State Maintenance & Database Architecture

### 2.1 Current Position Storage Mechanisms

| Mechanism | Component | Data Maintained | Lifetime / Durability |
| :--- | :--- | :--- | :--- |
| **Broker State** | Alpaca REST API (`alpacaClient.getOpenPositions()`) | Live positions: `symbol`, `qty`, `side`, `avgEntry`, `currentPrice`, `unrealizedPL` | Source of truth for actual asset ownership |
| **Database State** | SQLite `trades` table (`schema.js:43-60`) | Historical & active trade records: `id`, `symbol`, `direction`, `qty`, `entry_price`, `stop_loss`, `target_price`, `status`, `alpaca_order_id` | Persistent across process restarts; HMAC integrity protection |
| **In-Memory State** | `barsHistory` in `dataAggregator.js` | Rolling 1m candle buffers for indicator calculation | volatile in-memory Javascript objects |

### 2.2 Current SQLite `trades` Table Schema (`server/db/schema.js:43-60`)

```sql
CREATE TABLE IF NOT EXISTS trades (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp        TEXT    NOT NULL,
  symbol           TEXT    NOT NULL,
  direction        TEXT    NOT NULL,
  qty              REAL    NOT NULL,
  entry_price      REAL,
  stop_loss        REAL,
  target_price     REAL,
  alpaca_order_id  TEXT,
  status           TEXT    NOT NULL DEFAULT 'submitted',
  exit_price       REAL,
  pnl              REAL,
  hmac             TEXT    NOT NULL,
  prev_hmac        TEXT    NOT NULL,
  decision_id      INTEGER,
  mode             TEXT    NOT NULL DEFAULT 'paper'
);
```

### 2.3 Identified Position State Maintenance Gaps for R4

1. **Single Target Column Limit**: The existing `trades` schema only stores a single `target_price` (the final VWAP center line). It lacks a field for the Stage 1 scale-out target (`scale_out_target` / 1 SD mark).
2. **Missing Sub-Position Stage Tracking**: There is no column or in-memory state tracking whether a position is in Stage 0 (Initial entry), Stage 1 (50% scaled-out, stop moved to breakeven), or Stage 2 (Fully closed).
3. **Quantity Accounting**: The `qty` column reflects initial order quantity. When 50% is closed, there is no `remaining_qty` or `scaled_qty` column to track execution history.

---

## 3. Detailed Technical Requirements for R4 (Autonomous Scale-Out)

### 3.1 Mathematical Definition of VWAP Scale-Out Levels

VWAP Reversion entry occurs when price reaches or breaches the $\pm 2 \sigma$ outer band (`lowerBand` for LONG, `upperBand` for SHORT).

```
   LONG TRADE SCALE-OUT TRAJECTORY:
   
   VWAP Center Line ─────────────────────── [Stage 2: Final Take-Profit (Remaining 50%)]
         ▲
         │
   -1 SD Lower Band ─────────────────────── [Stage 1: Partial Take-Profit (Submit 50% Market Order)]
         ▲                                   └──> Action: Update Stop-Loss on remaining 50% to Breakeven
         │
   -2 SD Entry Price ────────────────────── [Entry Level & New Breakeven Stop-Loss Level]
         │
         ▼
   Initial ATR Stop ─────────────────────── [Initial Stop-Loss (1.5 * ATR below entry)]
```

#### Price Band Formulas (`server/quantitative/vwapReversion.js:145-163`):
- $\text{VWAP} = \frac{\sum (P_{\text{typical}} \times V)}{\sum V}$
- $\sigma = \sqrt{\frac{\sum (V \times (P_{\text{typical}} - \text{VWAP})^2)}{\sum V}}$
- **LONG Entry**: $P_{\text{close}} \le \text{VWAP} - 2 \sigma$.
  - Stage 1 Scale-Out Target ($+1 \sigma$ mark): $T_{1} = \text{VWAP} - 1 \sigma$.
  - Stage 2 Final Target (Center line): $T_{2} = \text{VWAP}$.
  - Initial Stop-Loss: $SL_{0} = P_{\text{entry}} - 1.5 \times \text{ATR}$.
  - Breakeven Stop-Loss: $SL_{1} = P_{\text{entry}}$.
- **SHORT Entry**: $P_{\text{close}} \ge \text{VWAP} + 2 \sigma$.
  - Stage 1 Scale-Out Target ($-1 \sigma$ mark): $T_{1} = \text{VWAP} + 1 \sigma$.
  - Stage 2 Final Target (Center line): $T_{2} = \text{VWAP}$.
  - Initial Stop-Loss: $SL_{0} = P_{\text{entry}} + 1.5 \times \text{ATR}$.
  - Breakeven Stop-Loss: $SL_{1} = P_{\text{entry}}$.

### 3.2 Handling Fractional Rounding & Partial Fill Precision

When executing partial fills on Alpaca:
- **Quantity Allocation Rules**:
  - Given initial position quantity $Q_{\text{initial}}$:
  - Partial exit quantity: $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2, \text{stepSize})$.
  - Remaining position quantity: $Q_{\text{remaining}} = Q_{\text{initial}} - Q_{\text{partial}}$.
  - This identity ($Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$) **must strictly hold** to avoid unhandled residual position fractions ("dust").
- **Asset Step Size & Precision Mapping**:
  - Stock equities (e.g. `SPY`, `AAPL`): Integer share quantities or fractional precision up to 4 decimal places for Alpaca market orders.
  - Crypto assets (e.g. `BTC/USD`, `ETH/USD`): Fractional step sizes vary by asset:
    - BTC: 0.0001 (4 decimals)
    - ETH: 0.001 (3 decimals)
    - SOL: 0.01 (2 decimals)
- **Final Exit Execution Safeguard**:
  - For Stage 2 (final closure), the system must submit `closePosition(symbol)` or pass the exact live `pos.qty` returned by `alpaca.getOpenPositions()`, rather than relying on cached initial calculations.

---

## 4. Active Position Management Loop & Risk Monitor Mechanisms

### 4.1 Current Risk Monitor Architecture (`server/autonomous/riskMonitor.js`)

Currently, `scheduler.js:19-25` invokes `monitorRisk()` once every 60 seconds:

```javascript
// scheduler.js:19-25
setInterval(async () => {
  try {
    await monitorRisk();
  } catch (err) {
    logger.error('Risk Monitor cycle error', { error: err.message });
  }
}, 60000);
```

Inside `riskMonitor.js:13-164`:
1. Calls `alpaca.getOpenPositions()`.
2. Matches each Alpaca position to local DB trade using `getOpenTradeBySymbol(symbol)`.
3. Recalculates dynamic ATR trailing stop and ratchets stop-loss in SQLite DB (`updateTradeStopLoss`).
4. Checks binary exit conditions (`currentPrice <= stopLoss` or `currentPrice >= targetPrice`).
5. Executes full 100% position liquidation via `alpaca.closePosition(pos.symbol)`.

### 4.2 Required State Machine for R4 Position Management

To support autonomous scale-out, `riskMonitor.js` must implement a 3-state state machine for active trades:

```
                  ┌─────────────────────────┐
                  │    State 0: Initial     │
                  │  (Qty: 100%, SL: SL_0)  │
                  └────────────┬────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │ Price hits Scale-Out Target (1 SD)  │ Price breaches SL_0
            ▼                                     ▼
┌─────────────────────────┐             ┌───────────────────┐
│     State 1: Scaled     │             │  State 2: Closed  │
│  (Qty: 50%, SL: P_entry)│             │ (Position Liquid) │
└────────────┬────────────┘             └───────────────────┘
             │                                    ▲
             ├────────────────────────────────────┤
             │ Price hits Final Target (VWAP)     │
             │ OR Price breaches Breakeven SL     │
             └────────────────────────────────────┘
```

#### Detailed State Transition Logic:

1. **State 0 (Initial Position)**:
   - Check if `currentPrice` reaches `scale_out_target` (1 SD band):
     - LONG: `currentPrice >= scale_out_target`
     - SHORT: `currentPrice <= scale_out_target`
   - **Transition to State 1**:
     - Compute $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2)$.
     - Submit partial order via `alpaca.submitOrder({ symbol, qty: Q_partial, side: exitSide })`.
     - Update SQLite trade record: `scale_stage = 1`, `stop_loss = entry_price`, `remaining_qty = Q_initial - Q_partial`.
     - Log partial scale-out event.
   - If `currentPrice` breaches `stop_loss`:
     - Liquidate 100% via `alpaca.closePosition(symbol)`.
     - Transition to State 2 (`status = 'closed'`).

2. **State 1 (Scaled Position - 50% Remaining)**:
   - Check if `currentPrice` reaches `target_price` (VWAP center line):
     - LONG: `currentPrice >= target_price`
     - SHORT: `currentPrice <= target_price`
   - Check if `currentPrice` breaches Breakeven Stop-Loss (`stop_loss` = $P_{\text{entry}}$):
     - LONG: `currentPrice <= stop_loss`
     - SHORT: `currentPrice >= stop_loss`
   - **Transition to State 2**:
     - Liquidate remaining 50% via `alpaca.closePosition(symbol)`.
     - Update SQLite trade record: `status = 'closed'`, record final PnL.

---

## 5. Interface Contracts Between Strategy Signals & Trade Executor

### 5.1 Current Signal Contract (`server/quantitative/vwapReversion.js:203-224`)

Currently, `evaluate(history)` returns:

```javascript
{
    action: 'LONG',
    entry: 50000,
    target: 51000,       // VWAP center line
    stopLoss: 49500,     // 1.5 * ATR below entry
    metadata: { rsi, vwap, lowerBand, upperBand, volume, volumeSMA, atr }
}
```

### 5.2 Required R4 Extended Signal Contract

For R4 scale-out, `vwapReversion.js` must export both the 1 StdDev scale-out target and the final VWAP center line target:

```javascript
{
    action: 'LONG' | 'SHORT',
    entry: number,                // Current candle close
    stopLoss: number,             // Entry ± (1.5 * ATR)
    scaleOutTarget: number,       // 1 StdDev mark (VWAP ± 1 * SD)
    finalTarget: number,          // VWAP center line
    target: number,               // Legacy alias pointing to finalTarget
    metadata: {
        rsi: number,
        vwap: number,
        lowerBand: number,        // -2 SD band
        upperBand: number,        // +2 SD band
        sd: number,               // Standard Deviation value
        volume: number,
        volumeSMA: number,
        atr: number
    }
}
```

### 5.3 Database Contract Extensions (`server/db/schema.js` & `tradeLogger.js`)

To support state persistence across process restarts, `schema.js` and `tradeLogger.js` require schema updates:

```sql
-- Schema Migration Proposal for trades table
ALTER TABLE trades ADD COLUMN scale_stage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trades ADD COLUMN scale_out_target REAL;
ALTER TABLE trades ADD COLUMN remaining_qty REAL;
```

Updated `logTrade` interface signature:
```javascript
logTrade({
    symbol,
    direction,
    qty,
    entryPrice,
    stopLoss,
    scaleOutTarget,
    targetPrice,
    alpacaOrderId,
    decisionId,
    mode
});
```

---

## 6. Recommendations & Implementation Plan for R4

1. **Update Signal Generator (`vwapReversion.js`)**:
   - Return `scaleOutTarget` ($\text{VWAP} \pm 1 \times SD$) alongside `finalTarget` ($\text{VWAP}$) in `evaluate()`.

2. **Update Database Schema (`schema.js` & `tradeLogger.js`)**:
   - Add `scale_stage` (0, 1, 2), `scale_out_target`, `remaining_qty` columns to `trades` table.
   - Add helper `updateTradeScaleStage(tradeId, stage, remainingQty, newStopLoss)`.

3. **Enhance Risk Monitor (`riskMonitor.js`)**:
   - Implement State 0 -> State 1 -> State 2 transition logic.
   - Add precise fractional rounding helper `roundToStep(qty, step)`.
   - Submit 50% partial exit order at 1 SD mark, ratchet stop-loss to entry price, update DB state.
   - Submit full exit at VWAP center line or breakeven stop breach.

4. **Verification Test Suite**:
   - Write dry-run / mock tests in `test-all.js` and a dedicated `test-scale-out.js` validating partial exit order generation, stop update to breakeven, fractional quantity precision, and full exit on VWAP touch.

---
*End of Technical Analysis.*
