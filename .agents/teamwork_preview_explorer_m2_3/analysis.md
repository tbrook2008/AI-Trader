# Active Risk Monitor State Machine Analysis (Milestone 2 - R4)

## Executive Summary

This report presents a thorough investigation of the active position management state machine in `server/autonomous/riskMonitor.js`, as required by Milestone 2 (Autonomous Scale-Out & Position Management Engine - R4). 

Currently, `server/autonomous/riskMonitor.js` implements a simplified single-step exit model that attempts to liquidate 100% of an open position via `alpaca.closePosition()` upon touching `target_price` or `stop_loss`. To meet institutional-grade requirements (R4), `riskMonitor.js` must be refactored into a **3-stage active state machine** supporting 50% partial scale-outs at the 1 StdDev mark (`scale_out_target`), stop-loss ratcheting to breakeven (`entry_price`), final VWAP center line take-profit exits, precise step rounding accounting ($Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$), and robust concurrency controls against interval overlapping and in-flight race conditions.

---

## 1. Current State vs Required State Machine Architecture

### 1.1 Existing Codebase Deficiencies
| Component | Existing Implementation | Required M2 (R4) Architecture |
|---|---|---|
| **Database Schema (`schema.js`)** | `trades` table only stores `qty`, `entry_price`, `stop_loss`, `target_price`, `status` | Needs `scale_stage INTEGER DEFAULT 0`, `scale_out_target REAL`, `remaining_qty REAL` |
| **Trade Logger (`tradeLogger.js`)** | `logTrade()` does not record scale-out target or remaining quantity; no update function for scale stages | `logTrade()` initializes `scale_stage = 0`, `remaining_qty = qty`, `scale_out_target`; add `updateTradeScaleStage()` helper |
| **Trade Execution (`tradeExecutor.js`)** | Submits initial order and logs trade without scale target parameters | Must forward `signal.scaleOutTarget` to `logTrade()` |
| **Risk Monitor (`riskMonitor.js`)** | Single-step check calling `alpaca.closePosition()` (closes 100% position) | 3-state state machine executing partial order submission for Stage 0 $\rightarrow$ Stage 1, breakeven SL adjustment, and Stage 1 $\rightarrow$ Stage 2 final exit |
| **Concurrency Protection** | Unprotected 60s `setInterval()` in `scheduler.js` without in-flight locks | In-memory `processingTrades` lock set preventing duplicate order execution across concurrent monitor ticks |
| **Fractional Rounding** | No step-size rounding logic in `riskMonitor.js` | Exact step rounding: $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2, \text{stepSize})$ and $Q_{\text{remaining}} = Q_{\text{initial}} - Q_{\text{partial}}$ |

---

## 2. 3-State Position Management State Machine Specification

### State Definitions
- **Stage 0 (Initial Position)**: Trade is open at full initial quantity $Q_{\text{initial}}$. `scale_stage = 0`, `remaining_qty = Q_initial`. Active SL is initial risk boundary ($P_0 \pm 1.5 \times \text{ATR}$).
- **Stage 1 (Partial Scale-Out Completed)**: Triggered when market price touches/breaches 1 StdDev mark (`scale_out_target`). 50% partial exit executed. `scale_stage = 1`, `remaining_qty = Q_remaining`. Stop-loss ratcheted to entry price ($P_0$, breakeven).
- **Stage 2 (Fully Closed)**: Triggered when remaining position reaches VWAP center line (`target_price`) OR breaches breakeven stop-loss (or initial stop loss in Stage 0). Trade status set to `'closed'`.

```
         ┌────────────────────────────────────────────────────────┐
         │                  STAGE 0 (Initial)                     │
         │ scale_stage = 0, remaining_qty = Q_initial             │
         │ active_sl = entry_price ± (1.5 * ATR)                  │
         └───────┬────────────────────────────────┬───────────────┘
                 │                                │
                 │ Price reaches                  │ Price breaches
                 │ scale_out_target (1 SD)        │ Initial Stop Loss
                 ▼                                │
  ┌──────────────────────────────┐                │
  │     STAGE 1 (Scale-Out)      │                │
  │ scale_stage = 1              │                │
  │ remaining_qty = Q_remaining  │                │
  │ active_sl = entry_price      │                │
  └──────┬────────────────┬──────┘                │
         │                │                       │
  Price reaches    Price breaches                 │
  VWAP Target      Breakeven SL                   │
         │                │                       │
         └───────┬────────┴───────────────────────┘
                 │
                 ▼
  ┌──────────────────────────────┐
  │      STAGE 2 (Closed)        │
  │ scale_stage = 2              │
  │ status = 'closed'            │
  └──────────────────────────────┘
```

---

## 3. Directional Logic Matrix (LONG vs SHORT)

The state machine evaluation depends strictly on trade direction (`LONG` vs `SHORT`):

| Evaluation Metric | LONG Position | SHORT Position |
|---|---|---|
| **Entry Price ($P_0$)** | $P_0$ | $P_0$ |
| **Initial Stop Loss ($SL_0$)** | $P_0 - 1.5 \times \text{ATR}$ | $P_0 + 1.5 \times \text{ATR}$ |
| **Scale-Out Target ($SO$)** | $\text{VWAP} - 1.0 \times \text{SD}$ ($SO > P_0$) | $\text{VWAP} + 1.0 \times \text{SD}$ ($SO < P_0$) |
| **Target Price ($TP$)** | $\text{VWAP}$ Center Line ($TP > SO > P_0$) | $\text{VWAP}$ Center Line ($TP < SO < P_0$) |
| **Stage 0 $\rightarrow$ 1 Condition** | `currentPrice >= scale_out_target` | `currentPrice <= scale_out_target` |
| **Stage 0 $\rightarrow$ 1 SL Adjustment** | Ratchet `stop_loss = entry_price` | Ratchet `stop_loss = entry_price` |
| **Stage 1 $\rightarrow$ 2 TP Condition** | `currentPrice >= target_price` | `currentPrice <= target_price` |
| **Stage 1 $\rightarrow$ 2 SL Breach** | `currentPrice <= stop_loss` | `currentPrice >= stop_loss` |
| **Stage 0 Direct Exit SL Breach** | `currentPrice <= stop_loss` | `currentPrice >= stop_loss` |
| **Partial Exit Order Side** | `'sell'` | `'buy'` |
| **Final Exit Order Side** | `'sell'` | `'buy'` |

---

## 4. Fractional Share Rounding & Accounting Invariants

To avoid leaving residual position "dust" or submitting orders invalid for the exchange/broker, quantity math must strictly enforce step precision:

1. **Partial Quantity Formula**:
   $$Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} \times 0.5, \text{stepSize})$$
2. **Remaining Quantity Formula**:
   $$Q_{\text{remaining}} = Q_{\text{initial}} - Q_{\text{partial}}$$
3. **Exact Mathematical Invariant**:
   $$Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$$

### Step Size Helper Specification
```javascript
function roundToStep(val, stepSize = 1.0) {
  if (!stepSize || stepSize <= 0) return val;
  const precision = stepSize < 1 ? Math.round(-Math.log10(stepSize)) : 0;
  const steps = Math.floor(val / stepSize);
  const result = steps * stepSize;
  return parseFloat(result.toFixed(precision));
}

function calculateScaleOutQty(initialQty, scalePct = 0.5, stepSize = 1.0) {
  const precision = stepSize < 1 ? Math.round(-Math.log10(stepSize)) : 0;
  let partialQty = roundToStep(initialQty * scalePct, stepSize);
  if (partialQty <= 0 && initialQty >= stepSize) partialQty = stepSize;
  const remainingQty = parseFloat((initialQty - partialQty).toFixed(precision));
  return { partialQty, remainingQty };
}
```

---

## 5. Concurrency & State Update Hardening

### 5.1 Identified Vulnerabilities
1. **Re-entrancy via `setInterval`**: `scheduler.js` invokes `monitorRisk()` every 60 seconds without checking if the previous execution completed. If Alpaca API calls delay execution, concurrent calls can evaluate the same trade in Stage 0 twice and submit duplicate scale-out orders.
2. **In-Flight Order Race Window**: If an exit order is submitted to Alpaca (`alpaca.submitOrder`), but SQLite DB update (`updateTradeScaleStage`) fails or executes after a delay, another tick may see `scale_stage = 0` and fire a second order.
3. **Alpaca API Partial Order Execution**: Stage 0 $\rightarrow$ 1 partial scale-out requires `alpaca.submitOrder({ symbol, qty: Q_partial, side: exitSide })` rather than `alpaca.closePosition()`, which would close the entire 100% position prematurely.

### 5.2 Defensive Design Requirements
- **In-Memory Mutex/Lock Set**: Maintain a module-level `Set` (`processingTrades`) in `riskMonitor.js`.
  ```javascript
  const processingTrades = new Set();
  ```
  Skip any symbol/trade ID currently present in `processingTrades`.
- **Atomic State Update Sequence**:
  1. Add `trade.id` to `processingTrades`.
  2. Execute Alpaca order submission.
  3. If order succeeds, immediately update SQLite database (`scale_stage`, `remaining_qty`, `stop_loss`).
  4. If order fails, log error and leave database state unchanged for retry on next cycle.
  5. Remove `trade.id` from `processingTrades` in a `finally` block.

---

## 6. Implementation Proposals & Proposed Code Changes

### Proposed Changes 1: SQLite Schema Migration (`server/db/schema.js`)
```javascript
// Add column migration helper inside initDb()
const columns = db.prepare("PRAGMA table_info(trades)").all().map(c => c.name);
if (!columns.includes('scale_stage')) {
  db.exec("ALTER TABLE trades ADD COLUMN scale_stage INTEGER DEFAULT 0");
}
if (!columns.includes('scale_out_target')) {
  db.exec("ALTER TABLE trades ADD COLUMN scale_out_target REAL");
}
if (!columns.includes('remaining_qty')) {
  db.exec("ALTER TABLE trades ADD COLUMN remaining_qty REAL");
}
```

### Proposed Changes 2: Helper Functions (`server/db/tradeLogger.js`)
```javascript
function logTrade({ symbol, direction, qty, entryPrice, stopLoss, targetPrice, scaleOutTarget, alpacaOrderId, decisionId, mode }) {
  // Pass scaleOutTarget, set initial scale_stage = 0, remaining_qty = qty
  ...
}

function updateTradeScaleStage({ tradeId, scaleStage, remainingQty, stopLoss }) {
  const db = getDb();
  db.prepare(`
    UPDATE trades 
    SET scale_stage = ?, remaining_qty = ?, stop_loss = ? 
    WHERE id = ?
  `).run(scaleStage, remainingQty, stopLoss, tradeId);
  logger.info('Trade scale stage updated in DB', { tradeId, scaleStage, remainingQty, stopLoss });
}
```

### Proposed Changes 3: Risk Monitor State Machine (`server/autonomous/riskMonitor.js`)
Refactor `monitorRisk()` to iterate over positions, fetch active open trades, lock symbol/trade ID, evaluate 3-stage transitions, execute partial/full market orders, ratchet breakeven stop loss, and update SQLite state atomically.

---

## 7. Verification Method

1. **Unit Test Execution**: Run `node test-all.js` (which executes `test-vwap-e2e.js` Tier 1 R4 tests).
   - `TC-R4-02`: Stage 0 $\rightarrow$ Stage 1 Scale-Out Transition at 1 SD Band Touch.
   - `TC-R4-03`: Stage 1 $\rightarrow$ Stage 2 Final Exit at VWAP Center Touch.
   - `TC-R4-04`: Stage 1 $\rightarrow$ Stage 2 Exit at Breakeven Stop-Loss.
   - `TC-R4-05`: Fractional Share Step Rounding Math Invariant.
2. **Synthetic Dry-Run Simulation**: Run synthetic multi-bar price series through `RiskMonitorStateMachine` verifying zero dust and correct PnL accumulation.
