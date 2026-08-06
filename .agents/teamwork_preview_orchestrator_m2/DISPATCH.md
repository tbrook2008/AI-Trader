## 2026-08-04T22:51:48Z
Task: Implement and verify Autonomous Scale-Out & Position Management Engine per requirements in /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md, /Users/tbrook/Desktop/AI Trader/PROJECT.md, and interface contracts.

Milestone Scope:
1. R4 DB Schema Migration: In server/db/schema.js and server/db/tradeLogger.js, add columns `scale_stage` (INTEGER DEFAULT 0), `scale_out_target` (REAL), and `remaining_qty` (REAL) to SQLite `trades` table.
2. R4 Trade Executor Setup: In server/execution/tradeExecutor.js, save `scale_out_target` (from signal.scaleOutTarget) and set initial `remaining_qty = sizing.qty`, `scale_stage = 0` when inserting trade into database.
3. R4 Active Risk Monitor State Machine: In server/autonomous/riskMonitor.js, implement 3-state active position management:
   - Stage 0 -> 1: When price reaches `scale_out_target` (1 StdDev mark), submit partial market exit for 50% initial quantity (using exact step rounding: Q_partial = roundToStep(Q_initial / 2, stepSize)), update remaining_qty in DB, set scale_stage = 1, and ratchet stop_loss to entry price (breakeven SL).
   - Stage 1 -> 2: When price reaches target_price (VWAP center) OR breaches breakeven stop_loss, submit market exit for remaining_qty, set scale_stage = 2, and update status = 'closed'.
4. R4 Fractional Rounding: Implement fractional share rounding logic ensuring Q_partial + Q_remaining == Q_initial, avoiding residual dust for Alpaca partial fills.
