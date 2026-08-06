## 2026-08-05T07:24:29Z
You are teamwork_preview_worker_m2 working in directory /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m2.
Task: Implement Autonomous Scale-Out & Active Position Management Engine (R4) in schema.js, tradeLogger.js, tradeExecutor.js, and riskMonitor.js.

Refer to:
- Requirements: /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md
- Project Spec & Interface Contracts: /Users/tbrook/Desktop/AI Trader/PROJECT.md
- Survey Analysis: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_survey_3/analysis.md

Implementation Instructions:
1. Update /Users/tbrook/Desktop/AI Trader/server/db/schema.js and /Users/tbrook/Desktop/AI Trader/server/db/tradeLogger.js:
   - Ensure `trades` table schema includes `scale_stage` (INTEGER DEFAULT 0), `scale_out_target` (REAL), and `remaining_qty` (REAL).
   - Add SQLite column migrations (`ALTER TABLE trades ADD COLUMN ...`) if table already exists, wrapping in try/catch for safety.
   - Update `logTrade(...)` and trade query helper functions in `tradeLogger.js` to support `scale_stage`, `scale_out_target`, and `remaining_qty`.
2. Update /Users/tbrook/Desktop/AI Trader/server/execution/tradeExecutor.js:
   - When signal is executed and trade logged, set initial `scale_stage = 0`, `scale_out_target = signal.scaleOutTarget`, `remaining_qty = sizing.qty`.
3. Update /Users/tbrook/Desktop/AI Trader/server/autonomous/riskMonitor.js:
   - Implement active 3-state scale-out state machine in `monitorRisk()`:
     * Stage 0 -> Stage 1 (1 StdDev Scale-Out):
       When open trade is in Stage 0 (`scale_stage === 0`) and current price touches/crosses `scale_out_target` (for LONG: price >= scale_out_target; for SHORT: price <= scale_out_target):
       - Calculate 50% partial exit quantity: `roundToStep(initial_qty / 2, stepSize)` (default stepSize = 0.001 or symbol precision).
       - Ensure exact accounting invariant: `remaining_qty = initial_qty - partial_qty` (prevent residual fractional dust).
       - Submit partial market exit order via Alpaca API or mock executor (`alpaca.submitOrder` or `closePosition` with partial qty).
       - Update SQLite database trade record: set `scale_stage = 1`, `remaining_qty = remaining_qty`, and ratchet `stop_loss = entry_price` (Breakeven SL).
     * Stage 1 -> Stage 2 (VWAP Center or Breakeven Exit):
       When open trade is in Stage 1 (`scale_stage === 1`):
       - If price touches/crosses `target_price` (VWAP center line) OR breaches breakeven `stop_loss` (for LONG: price <= entry_price; for SHORT: price >= entry_price):
       - Submit market exit order for `remaining_qty`.
       - Update SQLite database trade record: set `scale_stage = 2`, `remaining_qty = 0`, `status = 'closed'`.
4. Run `node test-all.js` and `node test-full-cycle.js` to verify pipeline execution.
5. Write your handoff report to /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m2/handoff.md with verification commands and build/test results.

MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.
