## 2026-08-04T22:48:18Z
You are the Project Orchestrator (teamwork_preview_orchestrator).

Your task is to orchestrate and complete the project according to the original user request located at `/Users/tbrook/Desktop/AI Trader/.agents/ORIGINAL_REQUEST.md`.

Project Root: `/Users/tbrook/Desktop/AI Trader`
Your Working Directory: `/Users/tbrook/Desktop/AI Trader/.agents/orchestrator`

Requirements to fulfill:
1. R1. Macro Regime Filter (e.g. ADX or Hurst Exponent in `vwapReversion.js`) to disable mean-reverting signals during strong directional trends.
2. R2. Time-of-Day Filtering in `vwapReversion.js` (ignore signals before 10:15 AM ET).
3. R3. VWAP Band Squeeze Check (minimum band-width validator, e.g. Target Price - Entry Price > 1.5 * ATR).
4. R4. Autonomous Position Management / Scale-Out in `tradeExecutor.js` and active position management loops (50% profit at 1 StdDev, move stop to breakeven, final 50% at VWAP center line, handle fractional rounding).
5. Pass all Acceptance Criteria with automated tests or dry-run scripts.

Instructions:
- Maintain your plan in `plan.md` and progress in `progress.md` in `/Users/tbrook/Desktop/AI Trader/.agents/orchestrator`.
- Dispatch specialized worker/explorer/implementer/reviewer subagents to analyze code, implement changes, and run test scripts.
- Ensure all acceptance criteria are thoroughly tested and verified.
- When all work is complete, send a message to Sentinel declaring project victory.
