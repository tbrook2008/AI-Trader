# Handoff Report: Active Risk Monitor State Machine Analysis (Milestone 2 - R4)

## 1. Observation
Direct observations from codebase inspection:
- **`server/autonomous/riskMonitor.js` (lines 103-128)**: Current implementation checks `currentPrice <= stopLoss` or `currentPrice >= targetPrice` and calls `alpaca.closePosition(pos.symbol)`. It has no logic for `scale_stage`, `scale_out_target`, or `remaining_qty`, and liquidates 100% of open positions in a single step upon breach.
- **`server/db/schema.js` (lines 43-60)**: `trades` table schema definition contains columns `(id, timestamp, symbol, direction, qty, entry_price, stop_loss, target_price, alpaca_order_id, status, exit_price, pnl, hmac, prev_hmac, decision_id, mode)`. It lacks `scale_stage`, `scale_out_target`, and `remaining_qty`.
- **`server/db/tradeLogger.js` (lines 37-68)**: `logTrade()` inserts into `trades` table without setting `scale_stage`, `scale_out_target`, or `remaining_qty`. Helper functions `updateTradeOutcome()` and `updateTradeStopLoss()` do not handle scale stages.
- **`server/execution/tradeExecutor.js` (lines 166-176)**: `execute()` logs trade without forwarding `signal.scaleOutTarget`.
- **`test-vwap-e2e.js` (lines 161-262)**: `RiskMonitorStateMachine` reference class defines the target state machine logic for Stage 0 $\rightarrow$ Stage 1 (partial 50% scale-out at 1 SD mark, ratcheting SL to breakeven, $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2, \text{stepSize})$) and Stage 1 $\rightarrow$ Stage 2 (final exit at VWAP center line or breakeven SL breach).
- **`server/autonomous/scheduler.js` (lines 19-25)**: Invokes `monitorRisk()` inside an un-guarded `setInterval(async () => { await monitorRisk(); }, 60000)` without in-flight mutex or processing lock.

## 2. Logic Chain
1. **Requirement Check**: M2 (R4) requires an autonomous 3-stage position management state machine that takes 50% profit at 1 StdDev mark (`scale_out_target`), moves stop loss on the remaining 50% to breakeven (`entry_price`), and exits the final 50% at the VWAP center line (`target_price`).
2. **Database Prerequisite**: Because trade state (`scale_stage`, `remaining_qty`, `scale_out_target`) must survive system restarts, SQLite `trades` table requires migration to store `scale_stage` (default 0), `scale_out_target`, and `remaining_qty`.
3. **Execution Pipeline Link**: `tradeExecutor.js` receives `signal.scaleOutTarget` from `vwapReversion.js`. It must record this target and initialize `remaining_qty = initial_qty` and `scale_stage = 0` via `tradeLogger.js`.
4. **Scale-Out Order Execution**: In Stage 0 $\rightarrow$ Stage 1 transition, `riskMonitor.js` must submit a partial market exit order using `alpaca.submitOrder({ symbol, qty: Q_partial, side })`. Calling `alpaca.closePosition()` at Stage 0 would erroneously liquidate 100% of the position.
5. **Breakeven SL Ratcheting**: Immediately upon successful partial scale-out order execution, `riskMonitor.js` must update SQLite DB to set `scale_stage = 1`, update `remaining_qty = Q_remaining`, and ratchet `stop_loss = entry_price`.
6. **Final Exit Execution**: In Stage 1 $\rightarrow$ Stage 2 transition, when price reaches `target_price` (VWAP center) or breaches `stop_loss` (breakeven), `riskMonitor.js` submits market exit for `remaining_qty`, sets `scale_stage = 2`, and updates trade status to `'closed'`.
7. **Concurrency & Race Condition Handling**: Overlapping `setInterval` ticks or slow API responses could trigger duplicate partial order submissions. An in-memory mutex set (`processingTrades`) prevents concurrent execution on the same active position while API calls are pending.

## 3. Caveats
- **Alpaca Crypto vs Equity Step Sizes**: Step sizes vary between equities (`stepSize = 1` for integer share accounts or `0.0001` for fractional accounts) and crypto symbols (e.g. `0.0001` for BTC/USD). Step size parameter should default to symbol/asset standard.
- **Intraday Trailing Stops**: If dynamic ATR trailing stop logic ratchets `stop_loss` above `entry_price` while in Stage 1, the higher ratcheted `stop_loss` must be preserved as the breakeven/trailing floor.
- **Live Trading Orders**: Market orders submitted during after-hours for non-crypto assets (stocks) may be queued or rejected by Alpaca depending on standard market hours rules.

## 4. Conclusion
The baseline codebase requires refactoring in 4 core files (`schema.js`, `tradeLogger.js`, `tradeExecutor.js`, and `riskMonitor.js`) to implement the M2 Autonomous Scale-Out & Position Management Engine (R4). Detailed code change proposals and architectural specifications have been written to `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m2_3/analysis.md`.

## 5. Verification Method
1. **Run Unit & E2E Tests**:
   Command: `node test-all.js`
   Expected result: All 33 test cases (including 25 tests in `test-vwap-e2e.js`) pass cleanly with 0 failures.
2. **Inspect Reference State Machine**:
   Inspect `test-vwap-e2e.js` lines 161-262 (`RiskMonitorStateMachine`) to verify alignment with proposed refactored `riskMonitor.js`.
3. **Invalidation Conditions**:
   If partial scale-out quantity plus remaining quantity does not equal initial quantity ($Q_{\text{partial}} + Q_{\text{remaining}} \neq Q_{\text{initial}}$), or if `scale_stage` fails to transition from 0 to 1 upon touching `scale_out_target`, the implementation is invalid.
