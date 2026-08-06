# Handoff Report: Filter R1 ADX & Hurst Regime Filter Analysis

## 1. Observation
- **File Paths & Functions Inspected**:
  - `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`:
    - `calculateVWAP(candles)` (Lines 111-163): Returns `{ vwap, upperBand, lowerBand, sd }`.
    - `evaluate(history)` (Lines 170-226): Currently checks `history.length < 21`, computes VWAP, RSI(14), Volume SMA(20), and ATR(14), then evaluates LONG/SHORT conditions. Does NOT import or invoke ADX or Hurst calculations.
  - `/Users/tbrook/Desktop/AI Trader/server/quantitative/adx.js`:
    - Exports `{ computeADX, isTrending }` (Line 87).
    - `computeADX(history, period = 14)` (Lines 9-76): Requires `history.length >= period * 2` (28 bars). Returns floating point ADX or `null`.
    - `isTrending(history, period = 14, threshold = 25)` (Lines 81-85): Returns `true` if `adx >= threshold`.
  - `/Users/tbrook/Desktop/AI Trader/server/quantitative/hurst.js`:
    - Exports `{ calculateHurst, classifyRegime }` (Line 86).
    - `calculateHurst(history)` (Lines 9-77): Expects `history` with `close` values. Requires `history.length >= 30` (returns default `0.5` if shorter). Returns float $H \in [0, 1]$.
    - `classifyRegime(history)` (Lines 79-84): Returns `'trending'` if $H > 0.55$.

- **Project Requirements (from `SCOPE.md` & `PROJECT.md`)**:
  - **R1 Rule**: Return `null` from `vwapReversion.evaluate(history)` when `ADX >= 25` OR `Hurst > 0.55`.
  - **Signal Metadata Requirement**: Include `adx` and `hurst` values in the `metadata` property of `StrategySignal`.

---

## 2. Logic Chain
1. **Observation**: `vwapReversion.evaluate(history)` currently evaluates entry signals based solely on VWAP SD band breaches, RSI, and Volume SMA without checking macro trend strength.
2. **Observation**: `adx.js` exports `computeADX(history, 14)` which returns numerical ADX (min 28 bars), and `hurst.js` exports `calculateHurst(history)` which returns numerical Hurst exponent $H$ (min 30 bars).
3. **Reasoning**: To implement Filter R1, `vwapReversion.js` must require `computeADX` from `./adx` and `calculateHurst` from `./hurst`.
4. **Reasoning**: Minimum history check in `evaluate(history)` must be raised from 21 bars to 30 bars so both indicators have sufficient data to return valid values instead of `null` or default `0.5`.
5. **Reasoning**: If `(adx !== null && adx >= 25) || (hurst !== null && hurst > 0.55)`, `evaluate(history)` must immediately return `null`.
6. **Reasoning**: If no trend is detected and a valid signal is formed, `adx` and `hurst` must be included in `metadata: { ..., adx, hurst }`.

---

## 3. Caveats
- **Short History Edge Case**: If `history.length` is between 28 and 29, ADX is valid but Hurst defaults to `0.5`. Raising the minimum history requirement in `evaluate(history)` to 30 bars completely eliminates this edge case.
- **R2 and R3 Filters**: This report specifically addresses R1 (ADX and Hurst trend filter). Integration of R2 (10:15 AM ET session filter) and R3 (Band squeeze validator) can be performed sequentially in `vwapReversion.evaluate(history)`.

---

## 4. Conclusion
Filter R1 integration into `vwapReversion.js` requires requiring `adx.js` and `hurst.js`, computing `adx = computeADX(history, 14)` and `hurst = calculateHurst(history)`, rejecting signals (`return null`) when `adx >= 25` or `hurst > 0.55`, and passing `adx` and `hurst` into the signal's `metadata` object.

---

## 5. Verification Method
1. **File Inspection**:
   - Verify `vwapReversion.js` requires `./adx` and `./hurst`.
   - Verify `if (!history || history.length < 30) return null;` is at the beginning of `evaluate(history)`.
   - Verify `if ((adx !== null && adx >= 25) || (hurst !== null && hurst > 0.55)) return null;` is executed before signal output.
2. **Automated Unit Tests**:
   - Run `node test-all.js` (or synthetic E2E test script `node test-vwap-e2e.js` when constructed).
   - Test synthetic trending candles: Verify `vwapReversion.evaluate(trendingHistory)` returns `null`.
   - Test synthetic mean-reverting candles: Verify `vwapReversion.evaluate(rangingHistory)` returns a valid `LONG` or `SHORT` signal with `adx` and `hurst` fields in `metadata`.
