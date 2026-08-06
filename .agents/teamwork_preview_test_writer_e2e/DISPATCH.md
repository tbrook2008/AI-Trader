## 2026-08-05T07:24:29Z

You are teamwork_preview_test_writer_e2e working in directory /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_test_writer_e2e.
Task: Create /Users/tbrook/Desktop/AI Trader/test-vwap-e2e.js and update master runner test-all.js.

Refer to:
- Requirements: /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md
- Project Spec & Test Infra: /Users/tbrook/Desktop/AI Trader/PROJECT.md and /Users/tbrook/Desktop/AI Trader/TEST_INFRA.md

Implementation Instructions:
1. Create /Users/tbrook/Desktop/AI Trader/test-vwap-e2e.js:
   - Build a comprehensive, zero-external-dependency test runner script using custom `test(name, fn)` assertion framework.
   - Implement Tier 1 (Feature Coverage):
     * Test R1 Macro Regime Filter: verify signals rejected when ADX >= 25 or Hurst > 0.55.
     * Test R2 Time-of-Day Filter: verify signals before 10:15 AM ET are rejected (`null`), and signals at/after 10:15 AM ET are evaluated.
     * Test R3 VWAP Band Squeeze Check: verify signals rejected when target distance <= 1.5 * ATR.
     * Test R4 Autonomous Scale-Out & Breakeven SL: verify 50% partial exit at 1 SD mark, stop-loss update to breakeven, and final 50% exit at VWAP center line.
     * Test R4 Fractional Rounding: verify `Q_partial + Q_remaining == Q_initial` across various step sizes without leaving dust.
   - Implement Tier 2 (Boundary & Corner Cases):
     * 10:14:59 AM ET (reject) vs 10:15:00 AM ET (evaluate).
     * ADX 24.99 (allowed) vs 25.00 (rejected).
     * Hurst 0.540 (allowed) vs 0.551 (rejected).
     * Band squeeze ratio 1.49 * ATR (rejected) vs 1.51 * ATR (allowed).
     * Exact 1 SD touch and exact breakeven SL touch state transitions.
   - Implement Tier 3 (Cross-Feature Combinations):
     * Test simultaneous multi-filter activation (e.g. morning open + high ADX trend).
   - Implement Tier 4 (Real-World Application Scenarios):
     * Full-day stream generator producing 390 1-minute bars (9:30 AM to 4:00 PM ET) simulating full-day trading session with morning open volatility, regime shifts, entry signal, 1 SD scale-out, breakeven stop move, and VWAP target hit.
2. Update /Users/tbrook/Desktop/AI Trader/test-all.js:
   - Integrate `test-vwap-e2e.js` into master test runner execution via `child_process.execSync`.
3. Execute `node test-vwap-e2e.js` and `node test-all.js`. Verify all tests pass with exit code 0.
4. Write your handoff report to /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_test_writer_e2e/handoff.md.

MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.
