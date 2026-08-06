# Scope: Milestone 1 — VWAP Strategy Defensive Filters & Scale Target

## Objectives
Implement and verify strategy signal enhancements in `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`.

## Requirements Breakdown

### R1 Macro Regime Filter
- Integrate ADX (`server/quantitative/adx.js`) and Hurst Exponent (`server/quantitative/hurst.js`) into `vwapReversion.evaluate(history)`.
- Disable mean-reverting signals (return `null`) when the market is in a strong trend (`ADX >= 25` OR `Hurst > 0.55`).

### R2 Time-of-Day Filter
- In `vwapReversion.evaluate(history)`, parse current candle timestamp into US Eastern Time (`America/New_York`).
- Ignore/reject signals before 10:15 AM ET (return `null`).

### R3 VWAP Band Squeeze Validator
- Minimum band-width / target distance check: require distance `Math.abs(vwap - close) > 1.5 * atr`.
- Return `null` if squeeze is detected (i.e. if `Math.abs(vwap - close) <= 1.5 * atr`).

### Scale Out Target Export
- Export `scaleOutTarget` (VWAP +/- 1 SD mark) in strategy signal object alongside `entry`, `vwap target` (or `target`), and `stopLoss`.

## Affected Files
- `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`
- Test files in `/Users/tbrook/Desktop/AI Trader/test/` or `/Users/tbrook/Desktop/AI Trader/server/quantitative/` (if any exist or need updating/adding)

## Status
- Status: IN_PROGRESS
