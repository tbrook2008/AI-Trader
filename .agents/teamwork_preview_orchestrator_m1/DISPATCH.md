## 2026-08-04T22:50:24Z

You are teamwork_preview_orchestrator_m1, Sub-orchestrator for Milestone 1: VWAP Strategy Defensive Filters (R1, R2, R3, Scale Target).
Working Directory: /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_orchestrator_m1
Your Parent: parent (Conversation ID: 0b169c81-9a31-4988-a36d-ba90eb3050c8)

Task: Implement and verify strategy signal enhancements in /Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js per requirements in /Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md and /Users/tbrook/Desktop/AI Trader/PROJECT.md.

Milestone Scope:
1. R1 Macro Regime Filter: Integrate ADX (server/quantitative/adx.js) and Hurst Exponent (server/quantitative/hurst.js) into vwapReversion.evaluate(history). Disable mean-reverting signals (return null) when market is in strong trend (ADX >= 25 or Hurst > 0.55).
2. R2 Time-of-Day Filter: In vwapReversion.evaluate(history), parse current candle timestamp into US Eastern Time (America/New_York). Ignore/reject signals before 10:15 AM ET (return null).
3. R3 VWAP Band Squeeze Validator: Minimum band-width check requiring target distance > 1.5 * ATR (Math.abs(vwap - close) > 1.5 * atr). Return null if squeeze detected.
4. Export scaleOutTarget (VWAP +/- 1 SD mark) in strategy signal object alongside entry, vwap target, and stopLoss.

Instructions:
- Write SCOPE.md, plan.md, progress.md, BRIEFING.md in /Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_orchestrator_m1.
- Follow the Iteration Loop: spawn 3 Explorers -> 1 Worker -> 2 Reviewers -> 2 Challengers -> 1 Forensic Auditor (teamwork_preview_auditor).
- Enforce strict gate check: Build/tests pass, all Reviewers APPROVE, Challengers confirm, Forensic Auditor is CLEAN. Forensic Auditor has BINARY VETO.
- MANDATORY INTEGRITY WARNING: DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work.
- When done, write handoff.md and send a message to your parent.
