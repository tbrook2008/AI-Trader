# Orchestrator Plan — AI Trader VWAP Mean Reversion Upgrade

## Objectives
1. Survey the codebase using 3 parallel Explorers to analyze project structure, current implementation of `vwapReversion.js`, `tradeExecutor.js`, test files, configuration, and dependencies.
2. Formulate `PROJECT.md` (Architecture, Feature Inventory, Milestones, Interface Contracts, Code Layout) and `TEST_INFRA.md`.
3. Spawn E2E Testing Orchestrator and Milestone Sub-orchestrators.
   - Milestone 1: Strategy Filters (R1 ADX/Hurst Macro Regime Filter, R2 Time-of-Day Filter, R3 VWAP Band Squeeze Validator in `vwapReversion.js`).
   - Milestone 2: Active Position Manager & Scale-Out Engine (R4 Autonomous Position Management, 50% profit at 1 StdDev, Breakeven stop adjustment, final profit at VWAP center line, fractional share rounding handling in `tradeExecutor.js`).
   - E2E Test Suite: Requirements-driven opaque box tests for R1-R4 (Tiers 1-4).
4. Run sub-orchestrator loops (Explorer -> Worker -> Reviewer -> Challenger -> Auditor gate cycles).
5. Pass Tier 1-4 E2E test suite and Tier 5 Adversarial Coverage Hardening.
6. Verify all acceptance criteria and declare project victory to Sentinel.

## Milestones & Status
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Codebase Survey & Specification Mining | Map existing code, indicators, execution loops, test framework | None | IN_PROGRESS |
| M1 | VWAP Strategy Defensive Filters (R1, R2, R3) | Implement ADX/Hurst regime filter, 10:15 AM ET session filter, band squeeze check in `vwapReversion.js` | M0 | PLANNED |
| M2 | Autonomous Scale-Out & Position Management (R4) | Implement memory position state, 50% TP at 1 StdDev, SL to breakeven, final 50% TP at VWAP, fractional rounding in `tradeExecutor.js` | M0, M1 contract | PLANNED |
| M3 | E2E Testing Track & Acceptance Verification | E2E test suite (Tiers 1-4 + Tier 5 Hardening) verifying all acceptance criteria | M0 | PLANNED |
