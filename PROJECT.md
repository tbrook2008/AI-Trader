# Project: AI Trader — Institutional-Grade VWAP Mean Reversion Upgrade

## Architecture
- **Strategy Module (`server/quantitative/vwapReversion.js`)**: Signal generator calculating Anchored VWAP, SD bands (+/- 2 SD, +/- 1 SD), RSI, Volume SMA, ATR, ADX/Hurst macro trend regime, 10:15 AM ET session filter, and VWAP band squeeze validator.
- **Trade Execution Engine (`server/execution/tradeExecutor.js`)**: Position sizing, risk parameter validation, order submission to Alpaca REST API, and SQLite database logging with scale-out state fields.
- **Active Risk Monitor (`server/autonomous/riskMonitor.js`)**: 1-minute active position management state machine enforcing 50% scale-out at 1 StdDev, stop-loss ratcheting to breakeven, and 50% center line exit with fractional rounding precision.
- **Persistence (`server/db/schema.js`, `server/db/tradeLogger.js`)**: SQLite database tracking trade records, `scale_stage`, `scale_out_target`, and `remaining_qty`.
- **Test Harness (`test-all.js`, `test-full-cycle.js`, `test-vwap-e2e.js`)**: Automated unit test runner and end-to-end dry-run synthetic simulation scripts.

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | R1. Macro Regime Filter | Integrate ADX (`adx.js`) and Hurst Exponent (`hurst.js`) into `vwapReversion.js` to disable mean-reversion signals during strong trends (ADX >= 25 or Hurst > 0.55) | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 2 | R2. Time-of-Day Filter | Filter out signals in `vwapReversion.js` before 10:15 AM US Eastern Time (`America/New_York`) to avoid morning open volatility | M1 | ORIGINAL_REQUEST §R2 | DONE |
| 3 | R3. VWAP Band Squeeze Check | Minimum band-width validator in `vwapReversion.js` requiring target distance > 1.5 * ATR (Reward:Risk ratio check) | M1 | ORIGINAL_REQUEST §R3 | DONE |
| 4 | R4. Scale-Out Target Calculation | Export `scaleOutTarget` (1 StdDev mark: VWAP +/- 1 SD) in strategy signal output | M1 | ORIGINAL_REQUEST §R4 | DONE |
| 5 | R4. Database Schema Update | Add `scale_stage`, `scale_out_target`, and `remaining_qty` columns to SQLite `trades` table in `schema.js` and `tradeLogger.js` | M2 | ORIGINAL_REQUEST §R4 | DONE |
| 6 | R4. Autonomous Position Management & Scale-Out | Update `tradeExecutor.js` & `riskMonitor.js` to execute 50% scale-out at 1 SD mark, move stop to breakeven, and exit remaining 50% at VWAP center | M2 | ORIGINAL_REQUEST §R4 | DONE |
| 7 | R4. Fractional Share Rounding | Ensure exact step size rounding ($Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$) handling Alpaca partial fills without leaving dust | M2 | ORIGINAL_REQUEST §R4 | DONE |
| 8 | E2E Automated Verification | Build requirements-driven automated unit and synthetic E2E test suite (Tiers 1-4 + Tier 5 Hardening) verifying all acceptance criteria | M3 (E2E Track) | ORIGINAL_REQUEST §Acceptance Criteria | DONE |

## Code Layout
- `server/quantitative/vwapReversion.js`: Strategy signal evaluation and technical indicator calculations.
- `server/quantitative/adx.js`: ADX indicator calculation and trend threshold check.
- `server/quantitative/hurst.js`: Hurst exponent calculation and regime classification.
- `server/db/schema.js`: SQLite database tables creation and migrations.
- `server/db/tradeLogger.js`: Trade log persistence helper functions.
- `server/execution/tradeExecutor.js`: Order submission and initial position setup.
- `server/autonomous/riskMonitor.js`: Active position monitoring loop and scale-out state machine.
- `test-all.js`: Master unit test runner script.
- `test-full-cycle.js`: Full synthetic cycle runner script.
- `test-vwap-e2e.js`: Comprehensive requirements-driven test suite for R1-R4.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1. VWAP Strategy Filters (R1, R2, R3, Scale Target) | Implement ADX/Hurst regime filter, 10:15 AM ET session filter, band squeeze validator, and 1 SD scale target export in `vwapReversion.js` | M0 | DONE |
| 2 | M2. Autonomous Scale-Out Engine (R4) | Implement DB schema migration, 50% scale-out at 1 SD, breakeven SL adjustment, final VWAP exit, and fractional rounding in `tradeExecutor.js`, `riskMonitor.js`, `schema.js`, `tradeLogger.js` | M1 | DONE |
| 3 | M3. E2E Testing Suite & Hardening | Build comprehensive test suite verifying R1 trend rejection, R2 morning rejection, R3 squeeze rejection, R4 50% scale-out + breakeven SL + fractional rounding, and run Tier 5 adversarial hardening | M1, M2 | DONE |
