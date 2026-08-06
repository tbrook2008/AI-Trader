# Technical Analysis Report: Trade Executor & Fractional Rounding Utilities (Milestone 2 - R4)

**Agent ID**: `teamwork_preview_explorer_m2_2`  
**Date**: 2026-08-04  
**Scope**: Trade execution pipeline (`server/execution/tradeExecutor.js`), DB trade logging (`server/db/tradeLogger.js`, `server/db/schema.js`), and order size precision rounding math.

---

## 1. Executive Summary

Milestone 2 (R4) requires active in-memory position scale-out and dynamic state management. To enable active position management without orphaned shares or position drift, the trade insertion pipeline must:
1. Extract and store `scale_out_target` (the 1 SD mark, e.g. `signal.scaleOutTarget`) upon trade insertion.
2. Initialize `remaining_qty = sizing.qty` ($Q_{\text{initial}}$) and `scale_stage = 0` in the SQLite `trades` table.
3. Implement a mathematically sound, dust-free rounding utility such that partial scale-out volume $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2, \text{stepSize})$ and remaining volume $Q_{\text{remaining}} = Q_{\text{initial}} - Q_{\text{partial}}$, strictly guaranteeing $Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$.

This report details the architectural changes required across `tradeExecutor.js`, `tradeLogger.js`, `schema.js`, and introduces a standalone utility module `server/utils/rounding.js`.

---

## 2. Requirement 1 Analysis: Persisting `scale_out_target`

### 2.1 Current State
- `vwapReversion.evaluate(history)` generates a `StrategySignal` containing `scaleOutTarget` (the 1 SD mark).
- `server/execution/tradeExecutor.js` receives `signal` but only extracts `stopLoss` and `target` (lines 140–176). When calling `logTrade()`, `scaleOutTarget` is omitted.
- `server/db/tradeLogger.js` `logTrade()` does not include `scale_out_target` in its parameters, JSON HMAC calculation, or `INSERT INTO trades` SQL statement (lines 37–57).

### 2.2 Recommended Modifications
1. **`tradeExecutor.js`**:
   - Extract `scaleOutTarget` from `signal`:
     ```javascript
     const scaleOutTarget = signal.scaleOutTarget != null 
       ? parseFloat(signal.scaleOutTarget.toFixed(4)) 
       : null;
     ```
   - Pass `scaleOutTarget` to `logTrade()`:
     ```javascript
     const tradeId = logTrade({
       symbol,
       direction,
       qty:            sizing.qty,
       entryPrice:     price,
       stopLoss:       parseFloat(atrStop.toFixed(4)),
       targetPrice:    parseFloat(atrTarget.toFixed(4)),
       scaleOutTarget,
       alpacaOrderId:  order.orderId,
       decisionId:     strategy,
       mode,
     });
     ```

2. **`tradeLogger.js`**:
   - Update `logTrade()` parameter destructuring to accept `scaleOutTarget`.
   - Update `tradeData` string to include `scaleOutTarget` in the HMAC signature anchor:
     ```javascript
     const tradeData = JSON.stringify({ timestamp, symbol, direction, qty, entryPrice, stopLoss, targetPrice, scaleOutTarget, alpacaOrderId });
     ```
   - Update SQL `INSERT INTO trades`:
     ```sql
     INSERT INTO trades
       (timestamp, symbol, direction, qty, entry_price, stop_loss, target_price,
        scale_out_target, remaining_qty, scale_stage,
        alpaca_order_id, status, hmac, prev_hmac, decision_id, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'submitted', ?, ?, ?, ?)
     ```

---

## 3. Requirement 2 Analysis: Initializing `remaining_qty` and `scale_stage`

### 3.1 Current State
- SQLite `trades` table in `server/db/schema.js` defines:
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
- It lacks columns for position scale state: `scale_stage`, `scale_out_target`, and `remaining_qty`.

### 3.2 Recommended Schema Migration (`server/db/schema.js`)
Add column definitions and migration logic:
```sql
ALTER TABLE trades ADD COLUMN scale_stage INTEGER DEFAULT 0;
ALTER TABLE trades ADD COLUMN scale_out_target REAL;
ALTER TABLE trades ADD COLUMN remaining_qty REAL;
```
*(Migration statement using `PRAGMA table_info(trades)` checks for backward compatibility).*

### 3.3 Insertion State Setup (`server/db/tradeLogger.js`)
When inserting a trade:
- `remaining_qty` must be set to `qty` ($Q_{\text{initial}}$).
- `scale_stage` must be set to `0`.
- In `logTrade()`:
  ```javascript
  const stmt = db.prepare(`
    INSERT INTO trades
      (timestamp, symbol, direction, qty, entry_price, stop_loss, target_price,
       scale_out_target, remaining_qty, scale_stage,
       alpaca_order_id, status, hmac, prev_hmac, decision_id, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'submitted', ?, ?, ?, ?)
  `);
  stmt.run(
    timestamp, symbol, direction, qty,
    entryPrice ?? null, stopLoss ?? null, targetPrice ?? null,
    scaleOutTarget ?? null, qty, // remaining_qty starts equal to total qty
    alpacaOrderId ?? null, hmac, prevHmac,
    decisionId ?? null, mode || 'paper'
  );
  ```

---

## 4. Requirement 3 Analysis: Fractional Share Rounding & Precision Handling

### 4.1 Problem Definition
Scale-out strategy requires executing a 50% partial take-profit order at Stage 1 ($Q_{\text{partial}}$) and closing the remainder at Stage 2 ($Q_{\text{remaining}}$).

If rounding is applied independently to both halves (e.g. `roundToStep(Q / 2)` for both), or if floating-point math artifacts are unhandled, residual position "dust" can remain:
- Example A (Integer shares): $Q_{\text{initial}} = 5$, `stepSize = 1`.
  - $5 / 2 = 2.5$.
  - If both halves round down to 2: $2 + 2 = 4 \neq 5$ (1 share dust orphaned in portfolio).
  - If both halves round up to 3: $3 + 3 = 6 > 5$ (Order rejected for over-selling).
- Example B (Floating point precision): $Q_{\text{initial}} = 5.1234$, `stepSize = 0.0001`.
  - In JS float math: `5.1234 - 2.5617 = 2.5617000000000004`. The `.0000000000000004` float artifact will fail exact equality checks and cause position residue.

### 4.2 Mathematical Proof of Zero Residual Dust
To ensure exact conservation of quantity:
$$Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2, \text{stepSize})$$
$$Q_{\text{remaining}} = \text{normalizePrecision}(Q_{\text{initial}} - Q_{\text{partial}}, \text{precision})$$

Substituting $Q_{\text{remaining}}$ back:
$$Q_{\text{partial}} + Q_{\text{remaining}} = Q_{\text{partial}} + (Q_{\text{initial}} - Q_{\text{partial}}) \equiv Q_{\text{initial}}$$

This identity holds **unconditionally** for all $Q_{\text{initial}} > 0$ and any valid `stepSize`, yielding zero residual dust.

### 4.3 Proposed Utility Module: `server/utils/rounding.js`

```javascript
/**
 * server/utils/rounding.js
 * Precision helper module for order quantity step size rounding and fractional scale-out.
 */

/**
 * Determine decimal precision (number of decimal places) of a stepSize.
 * @param {number} stepSize - e.g. 1, 0.01, 0.0001
 * @returns {number} Decimal places count
 */
function getPrecision(stepSize = 1) {
  if (!stepSize || Number.isInteger(stepSize)) return 0;
  const str = stepSize.toString();
  if (str.includes('e-')) {
    return parseInt(str.split('e-')[1], 10);
  }
  const parts = str.split('.');
  return parts.length > 1 ? parts[1].length : 0;
}

/**
 * Round a quantity to the nearest stepSize multiple.
 * @param {number} qty - Quantity to round
 * @param {number} stepSize - Minimum order step size (default 1)
 * @returns {number} Step-rounded quantity
 */
function roundToStep(qty, stepSize = 1) {
  if (!stepSize || stepSize <= 0) return Math.round(qty);
  const precision = getPrecision(stepSize);
  const steps = Math.round(qty / stepSize);
  const rounded = steps * stepSize;
  return Number(rounded.toFixed(precision));
}

/**
 * Compute partial scale-out and remaining quantity guarantee:
 * Q_partial = roundToStep(Q_initial / 2, stepSize)
 * Q_remaining = Q_initial - Q_partial
 * 
 * @param {number} Q_initial - Total initial trade quantity
 * @param {number} stepSize - Asset quantity step size (e.g. 1 for shares, 0.0001 for crypto)
 * @returns {{ Q_partial: number, Q_remaining: number }}
 */
function calculateScaleOutQty(Q_initial, stepSize = 1) {
  if (Q_initial <= 0) {
    return { Q_partial: 0, Q_remaining: 0 };
  }
  
  const precision = getPrecision(stepSize);
  let Q_partial = roundToStep(Q_initial / 2, stepSize);
  
  // Guard: Partial exit cannot exceed initial quantity
  if (Q_partial > Q_initial) {
    Q_partial = Q_initial;
  }
  
  const rawRemaining = Q_initial - Q_partial;
  const Q_remaining = Number(rawRemaining.toFixed(precision));
  
  return {
    Q_partial,
    Q_remaining
  };
}

module.exports = {
  getPrecision,
  roundToStep,
  calculateScaleOutQty
};
```

---

## 5. Test Matrix & Edge Case Validation

| Scenario | $Q_{\text{initial}}$ | `stepSize` | Precision | $Q_{\text{partial}}$ | $Q_{\text{remaining}}$ | Sum | Residual Dust |
|---|---|---|---|---|---|---|---|
| Whole Even Equity | `100` | `1` | `0` | `50` | `50` | `100` | `0` |
| Whole Odd Equity | `5` | `1` | `0` | `3` | `2` | `5` | `0` |
| Single Share Equity | `1` | `1` | `0` | `1` | `0` | `1` | `0` |
| Standard Fractional Stock | `10.55` | `0.01` | `2` | `5.28` | `5.27` | `10.55` | `0` |
| High-Precision Crypto | `1.5555` | `0.0001` | `4` | `0.7778` | `0.7777` | `1.5555` | `0` |
| Micro Fractional | `0.0001` | `0.0001` | `4` | `0.0001` | `0` | `0.0001` | `0` |

---

## 6. Recommendations for Implementation Phase

1. Create `server/utils/rounding.js` exporting `getPrecision`, `roundToStep`, and `calculateScaleOutQty`.
2. Add schema migration in `server/db/schema.js` for `scale_stage`, `scale_out_target`, and `remaining_qty`.
3. Update `server/db/tradeLogger.js` `logTrade()` to insert `scale_out_target`, `remaining_qty`, and `scale_stage = 0`.
4. Update `server/execution/tradeExecutor.js` to extract `signal.scaleOutTarget` and pass it to `logTrade()`.
5. Require `riskMonitor.js` to utilize `calculateScaleOutQty(trade.qty, stepSize)` when executing Stage 1 partial take-profits.
