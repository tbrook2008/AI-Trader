# Scope: Milestone 2 — Autonomous Scale-Out & Position Management Engine (R4)

## Architecture
- SQLite Database Migration: `server/db/schema.js` and `server/db/tradeLogger.js`
- Trade Execution Initialization: `server/execution/tradeExecutor.js`
- Risk Monitor State Machine: `server/autonomous/riskMonitor.js`
- Rounding Utilities / Precision Handling: Ensuring fractional rounding alignment `Q_partial + Q_remaining == Q_initial`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R4 DB Schema Migration | Add `scale_stage` (INTEGER DEFAULT 0), `scale_out_target` (REAL), `remaining_qty` (REAL) to SQLite `trades` table | M2 | DISPATCH / ORIGINAL_REQUEST |
| 2 | R4 Trade Executor Setup | Record `scale_out_target` from `signal.scaleOutTarget`, set initial `remaining_qty = sizing.qty` and `scale_stage = 0` on insert | M2 | DISPATCH / ORIGINAL_REQUEST |
| 3 | R4 Active Risk Monitor State Machine | Implement Stage 0 -> Stage 1 (partial 50% market exit at `scale_out_target`, update `remaining_qty`, ratchet stop_loss to breakeven entry price) and Stage 1 -> Stage 2 (exit remaining at target_price or breakeven SL breach, set status='closed') | M2 | DISPATCH / ORIGINAL_REQUEST |
| 4 | R4 Fractional Rounding | Rounding logic: `Q_partial = roundToStep(Q_initial / 2, stepSize)` and `Q_remaining = Q_initial - Q_partial` ensuring zero dust and precision exactness | M2 | DISPATCH / ORIGINAL_REQUEST |

## Code Layout & File Boundaries
- `server/db/schema.js`: DB schema definition & migration statements.
- `server/db/tradeLogger.js`: Trade logging helper methods (inserting and updating trade records).
- `server/execution/tradeExecutor.js`: Order execution and trade entry creation.
- `server/autonomous/riskMonitor.js`: Real-time active risk monitoring loop and state machine transition evaluation.

## Dependencies
- Pre-requisite: Milestone 1 baseline setup.
