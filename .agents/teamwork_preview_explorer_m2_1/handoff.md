# Handoff Report: Milestone 2 Schema & Trade Logger Investigation (R4)

**Agent**: `teamwork_preview_explorer_m2_1`  
**Working Directory**: `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m2_1`  
**Date**: 2026-08-05  

---

## 1. Observation

Direct code observations from inspecting the codebase:

1. **`server/db/schema.js` (lines 43–60)**:
   - `CREATE TABLE IF NOT EXISTS trades` defines 16 columns (`id`, `timestamp`, `symbol`, `direction`, `qty`, `entry_price`, `stop_loss`, `target_price`, `alpaca_order_id`, `status`, `exit_price`, `pnl`, `hmac`, `prev_hmac`, `decision_id`, `mode`).
   - Missing required R4 columns: `scale_stage`, `scale_out_target`, `remaining_qty`.
   - `initDb()` executes table creation and `system_state` seeding, but has no migration capability for existing `trader.sqlite` databases.

2. **`server/db/tradeLogger.js` (lines 37–96)**:
   - `logTrade` takes `{ symbol, direction, qty, entryPrice, stopLoss, targetPrice, alpacaOrderId, decisionId, mode }`. It does not accept or write `scale_stage`, `scale_out_target`, or `remaining_qty`.
   - `logTrade` computes HMAC over `JSON.stringify({ timestamp, symbol, direction, qty, entryPrice, stopLoss, alpacaOrderId })`.
   - `updateTradeOutcome` executes `UPDATE trades SET exit_price = ?, pnl = ?, status = ? WHERE id = ?`. It cannot record partial scale-out state updates.
   - `updateTradeStopLoss` updates `stop_loss`. No single function exists to record scale-out stage transitions (`scale_stage`, `remaining_qty`, and ratcheted `stop_loss`).

3. **`server/execution/tradeExecutor.js` (lines 166–176)**:
   - Calls `logTrade({ symbol, direction, qty, entryPrice, stopLoss, targetPrice, alpacaOrderId, decisionId, mode })`.
   - Currently does not pass `scaleOutTarget`, `scaleStage`, or `remainingQty`.

4. **`server/autonomous/riskMonitor.js` (lines 40, 70–99, 122–128)**:
   - Queries open trade via `getOpenTradeBySymbol(symbol)`.
   - Reads `trade.stop_loss` and `trade.target_price`.
   - Calls `updateTradeStopLoss` and `updateTradeOutcome`.

---

## 2. Logic Chain

1. **Premise 1**: Section **R4** of `ORIGINAL_REQUEST.md` and `PROJECT.md` mandates autonomous position management with a multi-stage scale-out strategy (Stage 0: entry; Stage 1: 50% partial exit at 1 SD band + breakeven SL ratchet; Stage 2: 50% exit at VWAP center target).
2. **Premise 2**: Active position monitoring (`riskMonitor.js`) requires persistent state in SQLite (`trades` table) to maintain scale stage context across restarts and execution cycles.
3. **Inference 1**: `trades` table must store `scale_stage` (`INTEGER DEFAULT 0`), `scale_out_target` (`REAL`), and `remaining_qty` (`REAL`).
4. **Premise 3**: Running environments may already have an initialized `trader.sqlite` database file. `CREATE TABLE IF NOT EXISTS` will not alter existing tables.
5. **Inference 2**: `schema.js` must implement runtime schema migration using `PRAGMA table_info(trades)` to add missing columns safely and backfill `remaining_qty = qty` for existing records.
6. **Premise 4**: `tradeLogger.js` is the single source of truth for persisting trade mutations.
7. **Inference 3**: `logTrade` must support writing `scale_stage` (default 0), `scale_out_target`, and `remaining_qty` (default `qty`). Additional helper functions (`updateTradeScaleOut` and enhanced `updateTradeOutcome`) are needed to log Stage 0 $\rightarrow$ Stage 1 $\rightarrow$ Stage 2 state transitions.

---

## 3. Caveats

- **Read-Only Scope**: Per agent role constraints, this agent performed investigation and specification only. Code modification in project source files (`server/db/schema.js`, `server/db/tradeLogger.js`) will be performed by implementer agents.
- **Upstream Strategy Export**: `vwapReversion.evaluate()` in Milestone 1 must export `signal.scaleOutTarget` (1 StdDev mark) so `tradeExecutor.js` can supply it to `logTrade()`.

---

## 4. Conclusion

1. **`server/db/schema.js`**: Add `scale_stage` (`INTEGER DEFAULT 0`), `scale_out_target` (`REAL`), and `remaining_qty` (`REAL`) to `trades` schema definition and add an idempotent `migrateSchema(db)` function in `initDb()`.
2. **`server/db/tradeLogger.js`**:
   - Update `logTrade` to insert `scale_stage` (default 0), `scale_out_target` (default `null`), and `remaining_qty` (default `qty`), and include `scaleOutTarget` & `remainingQty` in the HMAC signature string.
   - Add `updateTradeScaleOut({ tradeId, scaleStage, remainingQty, stopLoss })` for Stage 1 transitions.
   - Enhance `updateTradeOutcome` to support optional `scaleStage` and `remainingQty` parameters.
3. **Full Analysis Details**: Detailed proposed diff sketches, logic flow, and parameter specifications are documented in `analysis.md`.

---

## 5. Verification Method

To independently verify the schema and trade logger changes once implemented:

1. **Run Full Test Suite**:
   ```bash
   node test-all.js
   ```
2. **Database Schema & Migration Inspection**:
   Execute a Node snippet or sqlite command to check column layout:
   ```javascript
   const { getDb, initDb } = require('./server/db/schema');
   initDb();
   const cols = getDb().prepare("PRAGMA table_info(trades)").all();
   console.log(cols.map(c => c.name));
   ```
   *Expected Output*: Includes `'scale_stage'`, `'scale_out_target'`, `'remaining_qty'`.

3. **Trade Logging Verification**:
   ```javascript
   const { initDb } = require('./server/db/schema');
   const { logTrade, getOpenTradeBySymbol, updateTradeScaleOut } = require('./server/db/tradeLogger');
   initDb();
   const id = logTrade({ symbol: 'TEST/USD', direction: 'LONG', qty: 10, entryPrice: 100, scaleOutTarget: 105, remainingQty: 10 });
   updateTradeScaleOut({ tradeId: id, scaleStage: 1, remainingQty: 5, stopLoss: 100 });
   const trade = getOpenTradeBySymbol('TEST/USD');
   console.assert(trade.scale_stage === 1 && trade.remaining_qty === 5 && trade.stop_loss === 100);
   ```
