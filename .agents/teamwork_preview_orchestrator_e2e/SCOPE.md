# Scope: E2E Testing Track (VWAP Strategy Test Suite)

## Objective
Build and publish a comprehensive, requirements-driven opaque-box E2E test suite for AI Trader's VWAP Mean Reversion Strategy (`test-vwap-e2e.js`), covering Tiers 1-4, and publish `TEST_READY.md`.

## Test Requirements Breakdown

### Tier 1: Feature Coverage (>=5 per feature / core rules)
- **R1: Trend Rejection Filter**: Reject entry when trend strength ADX > 25 or Hurst > 0.55.
- **R2: Morning Open Filter**: Reject entry before 10:15 AM ET (market open noise avoidance).
- **R3: Band Squeeze Filter**: Reject entry when Band Squeeze Ratio > 1.50 (high volatility expansion).
- **R4: Multi-stage Exit & Fractional Share Rounding**:
  - 50% scale-out at 1 SD band reach.
  - Stop loss moved to breakeven upon 1 SD reach.
  - Remaining 50% target profit at VWAP center line.
  - Fractional share quantity calculations & floor/round handling (e.g. 0.33333 shares).

### Tier 2: Boundary & Corner Cases
- **Time Boundary**: 10:14 AM ET (rejected) vs 10:15 AM ET (allowed).
- **ADX Boundary**: 24.9 (allowed) vs 25.0 (rejected).
- **Hurst Boundary**: 0.54 (allowed) vs 0.56 (rejected).
- **Band Squeeze Ratio**: 1.49 (allowed) vs 1.51 (rejected).
- **Exit Price Boundaries**: Exact 1 SD touch (triggers scale-out & SL shift), exact breakeven SL touch.
- **Fractional Shares**: Rounding behavior on odd share counts and fractional quantities (e.g., 100 shares -> 50/50, 1 share -> 0.5 or integer rounding handling).

### Tier 3: Cross-Feature Combinations
- Simultaneous activation of multiple filters (e.g., trend + morning open + band squeeze).
- Multiple trade signals during intraday price movement.

### Tier 4: Real-World Application Scenarios
- Full-day trading stream simulation using realistic synthetic minute bars (9:30 AM to 4:00 PM ET).
- Comprehensive end-to-end execution flow validation.

## Deliverables
1. `/Users/tbrook/Desktop/AI Trader/test-vwap-e2e.js`
2. Update `/Users/tbrook/Desktop/AI Trader/test-all.js` (if appropriate to include E2E runner)
3. `/Users/tbrook/Desktop/AI Trader/TEST_READY.md`
