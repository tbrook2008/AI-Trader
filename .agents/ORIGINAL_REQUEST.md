# Original User Request

## Initial Request — 2026-08-04T22:48:10Z

Upgrade the Alpaca Node.js trading bot (`AI Trader`) with an institutional-grade VWAP Mean Reversion architecture. The bot must actively manage dynamic scale-out positions in memory and employ defensive filters to avoid trending regimes and opening-bell volatility.

Working directory: `/Users/tbrook/Desktop/AI Trader`
Integrity mode: development

## Requirements

### R1. Macro Regime Filter
Implement a regime filter (e.g., ADX or Hurst Exponent) in `vwapReversion.js`. The bot must disable all mean-reverting signals when the market is in a strong directional trend.

### R2. Time-of-Day Filtering
Implement session filtering logic in `vwapReversion.js`. The strategy must ignore all signals before 10:15 AM ET to avoid the highly volatile and unreliable VWAP bands during the morning open.

### R3. VWAP Band Squeeze Check
Add a minimum band-width validator to the signal generator. The distance between the entry price and the VWAP target must be large enough to justify the trade (e.g., Target Price - Entry Price > 1.5 * ATR).

### R4. Autonomous Position Management (Scale-Out)
Update `tradeExecutor.js` and any active position management loops so the bot actively manages the trade in memory. The bot should execute a scale-out strategy:
- Take 50% profit when the price reverts halfway (e.g., touches the 1 Standard Deviation band).
- Move the stop-loss on the remaining 50% to breakeven.
- Take the final 50% profit at the VWAP center line.

## Acceptance Criteria

### Execution & Logic
- [ ] Automated tests or dry-run scripts demonstrate that signals are rejected when the regime filter detects a trend.
- [ ] Automated tests or dry-run scripts demonstrate that signals before 10:15 AM ET are rejected.
- [ ] A mock trading test confirms that upon reaching the 1 Standard Deviation mark, a 50% partial take-profit order is submitted, and the stop-loss for the remainder is updated to breakeven.
- [ ] The codebase successfully handles fractional rounding if required by Alpaca for partial fills.
