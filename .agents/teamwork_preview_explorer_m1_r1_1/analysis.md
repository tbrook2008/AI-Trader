# Analysis Report: VWAP Reversion Strategy & Macro Regime Filter R1 Integration

## Executive Summary
This report analyzes the existing implementation of `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`, `/Users/tbrook/Desktop/AI Trader/server/quantitative/adx.js`, and `/Users/tbrook/Desktop/AI Trader/server/quantitative/hurst.js`. The goal of Milestone 1 Filter R1 is to integrate Average Directional Index (ADX) and the Hurst Exponent into `vwapReversion.evaluate(history)` so that mean-reversion trading signals are disabled (`return null`) whenever the market is in a strong directional trend (`ADX >= 25` OR `Hurst > 0.55`).

---

## 1. Analysis of `vwapReversion.js`

### 1.1 File Overview & Path
- **File**: `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`
- **Exports**: `{ calculateVWAP, evaluate }`

### 1.2 Current Structure & Execution Flow of `evaluate(history)`
1. **Input**: Expects `history` array of candle objects `{ open, high, low, close, volume, timestamp }`.
2. **Min History Check** (Line 172):
   ```javascript
   if (!history || history.length < 21) {
       return null;
   }
   ```
3. **Indicator Calculation**:
   - `calculateVWAP(history)` (Lines 111-163): Computes daily anchored VWAP, variance, and SD bands (`upperBand = vwap + sdMultiplier * sd`, `lowerBand = vwap - sdMultiplier * sd`). Returns `{ vwap, upperBand, lowerBand, sd }`.
   - `calculateRSI(history, 14)` (Lines 31-61): Wilder's 14-period RSI. Returns number or `null`.
   - `calculateVolumeSMA(history, 20)` (Lines 66-73): 20-period simple moving average of volume. Returns number or `null`.
   - `calculateATR(history, 14)` (Lines 78-106): 14-period Average True Range. Returns number or `null`.
4. **Symbol Parameters & Thresholds** (Lines 190-194):
   - `rsiOversold` (default 35), `rsiOverbought` (default 65), `volumeReq` (default 1.2), `slMultiplier` (default 1.5).
5. **Signal Trigger Logic**:
   - `isHighVolume = currentCandle.volume >= (volumeReq * volumeSMA)`.
   - **LONG Signal** (Lines 200-210): `currentCandle.close <= lowerBand` AND `rsi <= rsiOversold` AND `isHighVolume`.
   - **SHORT Signal** (Lines 213-223): `currentCandle.close >= upperBand` AND `rsi >= rsiOverbought` AND `isHighVolume`.
   - Returns signal object or `null`.

### 1.3 Missing Elements in `vwapReversion.js` for Milestone 1 Requirements
1. **Filter R1 (Macro Regime Filter)**: ADX and Hurst exponent calculations are currently missing in `evaluate(history)`. Signals are emitted regardless of overall market trend strength.
2. **Filter R2 (Time-of-Day Filter)**: Session timestamp parsing for 10:15 AM ET boundary is not present.
3. **Filter R3 (VWAP Band Squeeze Validator)**: Minimum band-width distance check (`Math.abs(vwap - close) > 1.5 * atr`) is missing.
4. **Scale-Out Target Export**: 1 SD mark (`scaleOutTarget`) and 1 SD bands (`upperBand1SD`, `lowerBand1SD`) are not currently exported in `metadata` or signal return value.

---

## 2. Analysis of `adx.js`

### 2.1 File Overview & Path
- **File**: `/Users/tbrook/Desktop/AI Trader/server/quantitative/adx.js`
- **Exports**: `{ computeADX, isTrending }`

### 2.2 Exported Functions & Signatures
1. **`computeADX(history, period = 14)`**:
   - **Arguments**:
     - `history`: Array of candle objects containing `high`, `low`, `close`.
     - `period`: Calculation period, default `14`.
   - **Minimum Data Requirement**: `history.length < period * 2` (i.e. `< 28` bars) returns `null`.
   - **Output**: Floating point ADX value (e.g. `32.45`) or `null`.
2. **`isTrending(history, period = 14, threshold = 25)`**:
   - **Arguments**: `history`, `period = 14`, `threshold = 25`.
   - **Output**: `boolean` (`true` if `adx >= threshold`, `false` if `adx === null` or `adx < threshold`).

### 2.3 Internal Algorithm
- Computes True Range ($TR$), $+DM$, $-DM$ for each candle.
- Applies Wilder's smoothing over `period` (14) for $TR$, $+DM$, and $-DM$.
- Calculates Directional Indicators $+DI = 100 \times (+DM / TR)$ and $-DI = 100 \times (-DM / TR)$.
- Computes Directional Index $DX = 100 \times |+DI - -DI| / (+DI + -DI)$.
- ADX is the smoothed moving average of $DX$ over `period` (14 bars).

---

## 3. Analysis of `hurst.js`

### 3.1 File Overview & Path
- **File**: `/Users/tbrook/Desktop/AI Trader/server/quantitative/hurst.js`
- **Exports**: `{ calculateHurst, classifyRegime }`

### 3.2 Exported Functions & Signatures
1. **`calculateHurst(history)`**:
   - **Arguments**: `history`: Array of candle objects containing `close`.
   - **Minimum Data Requirement**: `if (!history || history.length < 30) return 0.5;` (defaults to random walk `0.5` if insufficient history).
   - **Output**: Float bounded between `0.0` and `1.0`.
2. **`classifyRegime(history)`**:
   - **Arguments**: `history`.
   - **Output**: String `'trending'` (if H > 0.55), `'mean-reverting'` (if H < 0.45), or `'chop'` (0.45 <= H <= 0.55).

### 3.3 Internal Algorithm
- Calculates log returns $r_i = \ln(\text{close}_i / \text{close}_{i-1})$.
- Performs Rescaled Range ($R/S$) analysis across variable lags ($10 \le \text{lag} \le N/2$, step 5).
- Calculates standard deviation $S$ and mean-centered cumulative range $R$ across sub-chunks.
- Fits linear regression to $\ln(R/S)$ vs $\ln(\text{lag})$. The slope is the Hurst Exponent $H$.

---

## 4. R1 Filter Integration Strategy

### 4.1 Filter Rule Definition
For Filter R1, mean-reverting signals in `vwapReversion.evaluate(history)` must be disabled (`return null`) if:
$$\text{ADX} \ge 25 \quad \text{OR} \quad \text{Hurst} > 0.55$$

### 4.2 Module Requirements & Imports
In `vwapReversion.js`:
```javascript
const { computeADX } = require('./adx');
const { calculateHurst } = require('./hurst');
```

### 4.3 History Length Safeguard
Since `adx.computeADX` requires 28 bars and `hurst.calculateHurst` requires 30 bars:
- Update minimum history check in `evaluate(history)` from `< 21` to `< 30`:
  ```javascript
  if (!history || history.length < 30) {
      return null;
  }
  ```

### 4.4 Indicator Computation & Rejection Logic
Inside `vwapReversion.evaluate(history)`:
```javascript
const adx = computeADX(history, 14);
const hurst = calculateHurst(history);

// R1 Macro Regime Filter: Disable mean-reversion signals during strong trends
if ((adx !== null && adx >= 25) || (hurst !== null && hurst > 0.55)) {
    return null;
}
```

### 4.5 Metadata Extension
When a signal is valid, include `adx` and `hurst` values in signal metadata:
```javascript
metadata: {
    rsi,
    vwap,
    upperBand,
    lowerBand,
    volume: currentCandle.volume,
    volumeSMA,
    atr,
    adx,
    hurst
}
```

---

## 5. Summary Table of Component Specifications

| Module | Key Method | Input Requirement | Return Value | Role in R1 Filter |
|---|---|---|---|---|
| `vwapReversion.js` | `evaluate(history)` | Array of candles (min 30 bars) | `SignalObject` \| `null` | Main signal evaluator hosting R1 filter |
| `adx.js` | `computeADX(history, 14)` | Array of candles (min 28 bars) | `number` \| `null` | Returns ADX; trend threshold $\ge 25$ |
| `hurst.js` | `calculateHurst(history)` | Array of candles (min 30 bars) | `number` (0 to 1) | Returns Hurst $H$; trend threshold $> 0.55$ |

---

## 6. Next Steps for Implementation
1. Add module imports for `adx.js` and `hurst.js` at the top of `vwapReversion.js`.
2. Update min history length check to 30 bars.
3. Compute `adx` and `hurst` inside `evaluate(history)`.
4. Apply the trend rejection filter `if ((adx !== null && adx >= 25) || (hurst !== null && hurst > 0.55)) return null;`.
5. Attach `adx` and `hurst` to the signal `metadata`.
6. Run unit and synthetic test suites to verify signal rejection under trend conditions.
