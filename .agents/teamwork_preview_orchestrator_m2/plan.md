# Execution Plan — Milestone 2: Autonomous Scale-Out & Position Management Engine (R4)

## Overview
This plan governs the execution of Milestone 2 (M2) using the standard Project Orchestration iteration loop.

## Phases

### Phase 1: Survey & Exploration
- Spawn 3 Explorers (`teamwork_preview_explorer`) to investigate:
  - `server/db/schema.js` and `server/db/tradeLogger.js`
  - `server/execution/tradeExecutor.js`
  - `server/autonomous/riskMonitor.js`
  - Existing tests, build scripts, and helper functions (e.g. step rounding or math utilities).
- Aggregate Explorer findings to formulate a unified implementation strategy.

### Phase 2: Implementation
- Spawn 1 Worker (`teamwork_preview_worker`) with:
  - Clear file ownership instructions.
  - Detailed design for schema migration, trade executor insertion, 3-state risk monitor transitions, and fractional rounding.
  - MANDATORY INTEGRITY WARNING.
  - Command instructions to execute unit/integration tests and confirm build status.

### Phase 3: Review & Verification
- Spawn 2 Reviewers (`teamwork_preview_reviewer`) to independently review code, test outcomes, and contract compliance.
- Spawn 2 Challengers (`teamwork_preview_challenger`) to stress test fractional rounding edge cases and state machine transitions.
- Spawn 1 Forensic Auditor (`teamwork_preview_auditor`) to perform static and dynamic integrity forensics.

### Phase 4: Gate Verdict Evaluation
- Record all verdicts in `GATE_STATUS.md`.
- Evaluate Forensic Auditor verdict FIRST (BINARY VETO).
- Ensure 100% APPROVAL from Reviewers and Challengers.

### Phase 5: Handoff & Notification
- Update `SCOPE.md`, `BRIEFING.md`, `progress.md`.
- Write `handoff.md`.
- Send completion message to parent (`0b169c81-9a31-4988-a36d-ba90eb3050c8`).
