## 2026-08-04T22:52:49Z
<USER_REQUEST>
You are teamwork_preview_worker_m1_r1_1, a Worker agent.
Working Directory: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m1_r1_1
Parent Orchestrator: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_orchestrator_m1

Scope Documents & Reports:
- Scope: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_orchestrator_m1/SCOPE.md
- Original Request: /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md
- Project Spec: /Users/tbrook/Desktop/AI Trader/PROJECT.md
- Explorer 1 Handoff: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m1_r1_1/handoff.md
- Explorer 2 Handoff: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m1_r1_2/handoff.md
- Explorer 3 Handoff: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m1_r1_3/handoff.md

Write Ownership:
You own exclusively:
- /Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js
- /Users/tbrook/Desktop/AI Trader/test-all.js
- /Users/tbrook/Desktop/AI Trader/package.json

Task Description:
Implement and verify strategy signal enhancements for Milestone 1 in /Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js:

1. R1 Macro Regime Filter:
   - Require ./adx (server/quantitative/adx.js) and ./hurst (server/quantitative/hurst.js).
   - In vwapReversion.evaluate(history), update minimum history check to history.length < 30 (return null).
   - Compute adx = computeADX(history, 14) and hurst = calculateHurst(history).
   - Reject mean-reverting signals (return null) when market is in strong trend: (adx !== null && adx >= 25) || (hurst !== null && hurst > 0.55).
   - Include adx and hurst in metadata.

2. R2 Time-of-Day Filter:
   - In vwapReversion.evaluate(history), parse current candle timestamp (currentCandle.timestamp || currentCandle.time) into US Eastern Time (America/New_York).
   - Ignore/reject signals before 10:15 AM ET (return null if total ET minutes < 615).
   - Include formatted sessionTimeET (e.g. "10:15") in metadata.

3. R3 VWAP Band Squeeze Validator:
   - Minimum band-width / target distance check: require Math.abs(vwap - close) > 1.5 * atr.
   - Return null if squeeze detected (Math.abs(vwap - close) <= 1.5 * atr).

4. Scale Out Target Export:
   - Export top-level scaleOutTarget in strategy signal object:
     - LONG signal: scaleOutTarget = vwapData.vwap - vwapData.sd (1 SD mark below VWAP).
     - SHORT signal: scaleOutTarget = vwapData.vwap + vwapData.sd (1 SD mark above VWAP).
   - Export upperBand1SD (vwapData.vwap + vwapData.sd) and lowerBand1SD (vwapData.vwap - vwapData.sd) in metadata.

5. Test Suite Updates:
   - Add unit tests for Milestone 1 (R1, R2, R3, scaleOutTarget) to test-all.js.
   - Ensure package.json scripts has "test": "node test-all.js".
   - Run node test-all.js and ensure ALL tests pass cleanly.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Output:
Write your implementation report to /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m1_r1_1/changes.md and write a handoff report at /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m1_r1_1/handoff.md. Include build and test execution results in handoff.md. Send a message to parent when complete.
</USER_REQUEST>
