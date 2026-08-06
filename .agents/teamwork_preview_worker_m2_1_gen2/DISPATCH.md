## 2026-08-05T07:30:04Z

Task: Implement and verify Autonomous Scale-Out & Position Management Engine (Milestone 2 - R4).

Context & Specs:
- Read /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md
- Read /Users/tbrook/Desktop/AI Trader/PROJECT.md
- Read /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_orchestrator_m2/SCOPE.md
- Read Explorer Reports:
  - /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m2_1/analysis.md
  - /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m2_2/analysis.md
  - /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m2_3/analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Modifications Required:
1. DB Schema & Logger (`server/db/schema.js`, `server/db/tradeLogger.js`):
   - Add columns `scale_stage` (INTEGER DEFAULT 0), `scale_out_target` (REAL), and `remaining_qty` (REAL) to SQLite `trades` table.
   - Implement runtime schema migration in `initDb()` using `PRAGMA table_info(trades)` so existing databases are migrated safely (`ALTER TABLE ADD COLUMN`), backfilling `remaining_qty = qty`.
   - Update `logTrade()` signature and SQL insert to include `scaleOutTarget`, `scaleStage`, `remainingQty`. Update HMAC hash serialization.
   - Implement `updateTradeScaleOut({ tradeId, scaleStage, remainingQty, stopLoss })` for Stage 0 -> 1 transitions.
   - Support `scaleStage` and `remainingQty` parameters in `updateTradeOutcome()`.

2. Trade Executor (`server/execution/tradeExecutor.js`):
   - Extract `scaleOutTarget` from `signal.scaleOutTarget`.
   - Pass `scale_out_target`, initial `remaining_qty = sizing.qty`, and `scale_stage = 0` when calling `logTrade()`.

3. Rounding Utility (`server/utils/rounding.js`):
   - Implement `roundToStep(qty, stepSize)` and `calculateScaleOutQty(initialQty, stepSize)`.
   - Ensure $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2, \text{stepSize})$ and $Q_{\text{remaining}} = Q_{\text{initial}} - Q_{\text{partial}}$, guaranteeing $Q_{\text{partial}} + Q_{\text{remaining}} == Q_{\text{initial}}$ with zero residual dust.

4. Active Risk Monitor (`server/autonomous/riskMonitor.js`):
   - Implement 3-state active position management:
     * Stage 0 -> Stage 1: When price reaches `scale_out_target` (1 StdDev mark), submit partial market exit for 50% initial quantity using `calculateScaleOutQty(initialQty, stepSize)`. Update `remaining_qty`, set `scale_stage = 1`, and ratchet `stop_loss` to entry price (breakeven SL). Update DB via `updateTradeScaleOut()`.
     * Stage 1 -> Stage 2: When price reaches `target_price` (VWAP center) OR breaches breakeven `stop_loss`, submit market exit for `remaining_qty`, set `scale_stage = 2`, and update status = 'closed'.
   - Ensure proper price direction logic for LONG (scale_out when price >= scale_out_target, breakeven SL breach when price <= stop_loss, target exit when price >= target_price) and SHORT (scale_out when price <= scale_out_target, breakeven SL breach when price >= stop_loss, target exit when price <= target_price).
   - Use in-memory lock set (`processingTrades`) to prevent race conditions during async order placement.

Verification Requirements:
- Run the build and test commands (e.g. `npm test` or `node --test` or whatever test framework the project uses).
- Create or update unit and integration tests covering all M2 features (schema migration, trade logging, fractional rounding, risk monitor Stage 0->1 and Stage 1->2 state transitions).
- Verify all tests pass cleanly.
- Document exact commands executed and build/test output in your handoff report.

Write your changes report to /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m2_1_gen2/changes.md and handoff report to /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m2_1_gen2/handoff.md. Send a message when complete.
