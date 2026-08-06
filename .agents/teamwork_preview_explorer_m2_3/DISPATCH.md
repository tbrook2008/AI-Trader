## 2026-08-05T02:52:00Z
Task: Investigate active risk monitor state machine for Milestone 2: Autonomous Scale-Out & Position Management Engine (R4).
Files to inspect:
- /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md
- /Users/tbrook/Desktop/AI Trader/PROJECT.md
- /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_orchestrator_m2/SCOPE.md
- server/autonomous/riskMonitor.js
- Existing test suites for risk monitor and order execution.

Requirements to analyze:
1. 3-state active position management logic:
   - Stage 0 -> 1: When price reaches `scale_out_target` (1 StdDev mark), submit partial market exit for 50% initial quantity (using exact step rounding: Q_partial = roundToStep(Q_initial / 2, stepSize)), update remaining_qty in DB, set scale_stage = 1, and ratchet stop_loss to entry price (breakeven SL).
   - Stage 1 -> 2: When price reaches target_price (VWAP center) OR breaches breakeven stop_loss, submit market exit for remaining_qty, set scale_stage = 2, and update status = 'closed'.
2. Handling of long vs short positions (direction of price movement relative to targets/stops).
3. Concurrency and state update details in `riskMonitor.js`.

Write your full findings and recommendations to /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m2_3/analysis.md and handoff.md. Send a message when done.
