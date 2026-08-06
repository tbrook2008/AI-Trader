## 2026-08-05T07:24:29Z
You are teamwork_preview_worker_m1 working in directory /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m1.
Task: Implement VWAP Strategy Defensive Filters (R1, R2, R3, Scale Target) in /Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js.

Refer to:
- Requirements: /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md
- Project Spec & Interface Contracts: /Users/tbrook/Desktop/AI Trader/PROJECT.md
- Survey Analysis: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_survey_2/analysis.md

Implementation Instructions:
1. Modify /Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js:
   - Import adx.js (`computeADX`, `isTrending`) and hurst.js (`calculateHurst`) from `./adx` and `./hurst`.
   - Update `calculateVWAP(candles)` to return `vwap`, `upperBand` (+2 SD), `lowerBand` (-2 SD), `upperBand1SD` (+1 SD), `lowerBand1SD` (-1 SD), `sd`, and `atr`.
   - In `evaluate(history)`:
     * Requirement R2 (Time-of-Day Filter): Parse current candle timestamp (`timestamp` or `time`). Convert to US Eastern Time (`America/New_York`). If current time is before 10:15 AM ET (e.g. `hours * 100 + minutes < 1015`), return `null`.
     * Requirement R1 (Macro Regime Filter): Calculate ADX and Hurst Exponent for `history`. If ADX >= 25 or Hurst > 0.55 (trending regime), return `null` (disable mean-reversion signals during strong trends).
     * Requirement R3 (VWAP Band Squeeze Check): Calculate target distance `Math.abs(vwap - currentCandle.close)`. Require `targetDistance > 1.5 * atr`. If `targetDistance <= 1.5 * atr`, return `null`.
     * Export `scaleOutTarget` in strategy signal output: For LONG trades, `scaleOutTarget = vwap - sd` (1 SD mark). For SHORT trades, `scaleOutTarget = vwap + sd` (1 SD mark). Include `scaleOutTarget`, `adx`, `hurst`, `sessionTimeET`, `upperBand1SD`, `lowerBand1SD` in metadata.
2. Run `node test-all.js` to ensure existing unit tests pass.
3. Write your handoff report to /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_worker_m1/handoff.md with verification commands and build/test results.
