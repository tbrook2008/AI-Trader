## 2026-08-04T22:55:00Z
Task: Refactor `/Users/tbrook/Desktop/AI Trader/test-vwap-e2e.js` to address reviewer feedback from reviewer_e2e_2 and replace all inline dummy/facade assertions with genuine strategy evaluation calls.

Files to read:
- /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md
- /Users/tbrook/Desktop/AI Trader/PROJECT.md
- /Users/tbrook/Desktop/AI Trader/TEST_INFRA.md
- /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_reviewer_e2e_2/review.md
- /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_reviewer_e2e_2/handoff.md
- /Users/tbrook/Desktop/AI Trader/test-vwap-e2e.js

Action Required:
1. Fix `TC-T3-01 to T3-08` (Lines 610-640):
   - DO NOT evaluate inline boolean expressions (`if (comb.f1 || comb.f2 || comb.f3) result = null`).
   - Construct 8 distinct synthetic bar history streams (35+ bars each), one for each combination of (Morning Open Filter, Trend Filter ADX/Hurst, Band Squeeze Filter).
   - Pass each synthetic history stream into `evaluateStrategyWithFilters(history)` (or `vwapReversion.evaluate(history)`).
   - Assert that `evaluateStrategyWithFilters(history)` genuinely returns `null` when expected, and returns a valid `StrategySignal` object when expected.

2. Fix `TC-R2-03` (Lines 387-392):
   - Replace raw `getSessionTimeET` check with a call to `evaluateStrategyWithFilters(history)` using a 10:30 AM ET bar history, asserting a non-null signal.

3. Fix `TC-R4-01` (Lines 400-409):
   - Call `evaluateStrategyWithFilters(history)` (or `vwapReversion.evaluate(history)`) and assert `signal.scaleOutTarget` is explicitly exported in the returned `StrategySignal` object.

4. Fix `TC-T2-04` (Lines 540-547):
   - Construct synthetic histories where target distance is 1.49 * ATR vs 1.51 * ATR, pass both to `evaluateStrategyWithFilters(history)`, and assert rejection for 1.49 * ATR and acceptance/signal for 1.51 * ATR.

5. Verify execution:
   - Run `node test-vwap-e2e.js` and `node test-all.js`. Ensure both pass with exit code 0.
