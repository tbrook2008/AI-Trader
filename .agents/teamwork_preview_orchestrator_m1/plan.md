# Execution Plan: Milestone 1 — VWAP Strategy Defensive Filters

## Phase 1: Setup & Initialization
- Create state and metadata files (`DISPATCH.md`, `BRIEFING.md`, `SCOPE.md`, `plan.md`, `progress.md`).
- Start heartbeat cron schedule.

## Phase 2: Iteration Loop - Round 1
1. **Exploration**:
   - Spawn 3 Explorers in parallel to inspect:
     - `server/quantitative/vwapReversion.js`
     - `server/quantitative/adx.js`
     - `server/quantitative/hurst.js`
     - Existing tests / test setup
     - Requirements from `ORIGINAL_REQUEST.md` and `PROJECT.md`
2. **Implementation**:
   - Spawn 1 Worker with Explorer findings to implement R1, R2, R3, and `scaleOutTarget` export in `vwapReversion.js` and run tests.
3. **Review**:
   - Spawn 2 Reviewers independently to verify code quality, correctness, and adherence to requirements.
4. **Adversarial Verification**:
   - Spawn 2 Challengers independently to write stress tests / empirical tests verifying edge cases.
5. **Integrity Audit**:
   - Spawn 1 Forensic Auditor (`teamwork_preview_auditor`) to perform binary integrity veto check.
6. **Gate Evaluation**:
   - Evaluate all verdicts in `GATE_STATUS.md`.
   - If ALL pass (Build/test OK, Reviewers APPROVE, Challengers confirm, Auditor CLEAN), proceed to completion.
   - If ANY fail, loop back to step 1/2 with remediation evidence.

## Phase 3: Completion & Handoff
- Write `handoff.md` soft/hard report.
- Report completion to parent.
