# Review Report: Milestone 1 — VWAP Strategy Defensive Filters & Scale Target

**Reviewer**: `teamwork_preview_reviewer_m1_r1_2`  
**Roles**: reviewer, critic  
**Target Files**:
- `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`
- `/Users/tbrook/Desktop/AI Trader/test-all.js`
- `/Users/tbrook/Desktop/AI Trader/package.json`

---

## Review Summary

**Verdict: APPROVE**

The implementation of Milestone 1 in `server/quantitative/vwapReversion.js`, `test-all.js`, and `package.json` fulfills all specified requirements (R1 Macro Regime Filter, R2 Time-of-Day Filter, R3 VWAP Band Squeeze Validator, and R4 Scale-Out Target Export) with high algorithmic integrity and full test suite verification.

---

## Integrity Audit

- **No Hardcoded Test Results**: Code in `vwapReversion.js` contains no embedded outputs or test-specific shortcuts. Indicator math (ADX, Hurst, RSI, VWAP, ATR, ET timestamp formatting) is dynamically computed.
- **No Facade Implementations**: `parseETTime` relies on Node.js `Intl.DateTimeFormat` with explicit `America/New_York` time zone formatting. ADX and Hurst functions compute genuine Wilder smoothing and Rescaled Range (R/S) regressions.
- **No Self-Certifying Work**: The test runner `node test-all.js` independently verified 40 unit and integration tests (including 25 E2E tests in `test-vwap-e2e.js`) without failures.

---

## Detailed Evaluation by Requirement

### R1. Macro Regime Filter (ADX & Hurst)
- **Contract Compliance**: `vwapReversion.evaluate(history)` calls `computeADX(history, 14)` and `calculateHurst(history)`. Signals are rejected (`return null`) if `adx >= 25` OR `hurst > 0.55`.
- **Metadata Integration**: Both `adx` and `hurst` numeric values are attached to the signal `metadata` object.
- **Verification**: Verified via test cases `R1: Returns null when history < 30 bars`, `R1: Returns null when ADX >= 25 or Hurst > 0.55`, `TC-R1-01`, `TC-R1-02`, and `TC-R1-03`.

### R2. Time-of-Day Filter (America/New_York 10:15 AM ET Cutoff)
- **Contract Compliance**: Helper `parseETTime(ts)` parses timestamp input (Date, ISO string, Unix epoch seconds/ms) into US Eastern Time (`America/New_York`). Rejects signals (`return null`) prior to 10:15 AM ET (`totalMinutes < 615`).
- **Metadata Integration**: `sessionTimeET` formatted string (e.g. `"10:15"`) is attached to `metadata`.
- **Verification**: Boundary tested at 10:14:59 AM ET (rejected) vs 10:15:00 AM ET (accepted) in `TC-T2-01`.

### R3. VWAP Band Squeeze Validator
- **Contract Compliance**: Evaluates target distance `Math.abs(vwap - close)`. Rejects signals (`return null`) if `Math.abs(vwap - close) <= 1.5 * atr`.
- **Verification**: Tested at squeeze ratio boundaries (1.49 vs 1.51 * ATR) in `TC-T2-04`.

### R4. Scale-Out Target Export
- **Contract Compliance**: Signals export `scaleOutTarget` alongside `action`, `entry`, `target`, and `stopLoss`.
  - For `LONG`: `scaleOutTarget` = `lowerBand1SD` (`vwap - sd`).
  - For `SHORT`: `scaleOutTarget` = `upperBand1SD` (`vwap + sd`).
- **Metadata Integration**: Signal `metadata` contains `upperBand1SD` and `lowerBand1SD`.
- **Verification**: Verified correct ordering (`entry < scaleOutTarget < target` for LONG; `entry > scaleOutTarget > target` for SHORT).

---

## Critic & Adversarial Stress-Test Findings

### [Minor / Info] Finding 1: Local System Timezone vs ET Midnight in `calculateVWAP`
- **Location**: `server/quantitative/vwapReversion.js:171`
- **Observation**: `calculateVWAP` calculates `startOfDay` using `new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate()).getTime()`, which defaults to system local midnight rather than explicit ET (`America/New_York`) midnight.
- **Impact**: When processing intraday 1-minute bars strictly within US market hours (9:30 AM – 4:00 PM ET), all candles fall on the same date regardless of timezone. However, for post-market or pre-market data on servers running in UTC or non-ET timezones, candles could theoretically cross UTC midnight.
- **Recommendation**: For future hardening, construct `startOfDay` in `America/New_York` timezone. This is non-blocking for M1.

---

## Verified Claims

- [R1 Macro Regime Filter] → verified via code inspection & `node test-all.js` → PASS
- [R2 Time-of-Day Filter] → verified via code inspection & `node test-all.js` → PASS
- [R3 VWAP Band Squeeze Validator] → verified via code inspection & `node test-all.js` → PASS
- [R4 Scale-Out Target Export] → verified via code inspection & `node test-all.js` → PASS
- [Package.json Test Script] → verified `"test": "node test-all.js"` execution → PASS
- [Integrity Violation Check] → verified zero cheating, no hardcoded results → PASS

---

## Coverage Gaps

- None.

## Unverified Items

- None.
