# Detailed Survey Analysis: VWAP Strategy Signal Generation (R1, R2, R3)

## Executive Summary
This document presents the detailed architectural and functional investigation of `vwapReversion.js` and related quantitative modules in the AI Trader project (`/Users/tbrook/Desktop/AI Trader`). The survey covers the existing VWAP mean-reversion signal generation, available technical indicators, and concrete design proposals for implementing Requirements R1 (Macro Regime Filter), R2 (Time-of-Day Filtering), and R3 (VWAP Band Squeeze Validator).

---

## 1. Current Implementation of `vwapReversion.js` & Signal Calculations

### File Location
- `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`

### Primary Functionality
`vwapReversion.js` calculates Daily Anchored VWAP with Standard Deviation (SD) bands and evaluates historical 1-minute OHLCV candles to generate mean-reversion trading signals (`LONG` or `SHORT`). If conditions are not satisfied, it returns `null` (representing `HOLD` / `NONE`).

### Internal Indicator Calculations
1. **Daily Anchored VWAP & Standard Deviation Bands (`calculateVWAP(candles)`)**:
   - Anchors to the start of the current day (`startOfDay`) based on the timestamp of the latest candle in local/UTC time.
   - Calculates typical price $TP = \frac{\text{High} + \text{Low} + \text{Close}}{3}$.
   - Cumulative PV: $\sum (TP \times \text{Volume})$, Cumulative Volume: $\sum \text{Volume}$.
   - $\text{VWAP} = \frac{\text{Cumulative PV}}{\text{Cumulative Volume}}$.
   - Sample variance: $\text{Variance} = \frac{\sum (\text{Volume} \times (TP - \text{VWAP})^2)}{\text{Cumulative Volume}}$, $\text{SD} = \sqrt{\text{Variance}}$.
   - Upper Band = $\text{VWAP} + (\text{sdMultiplier} \times \text{SD})$ (default `sdMultiplier = 2.0`).
   - Lower Band = $\text{VWAP} - (\text{sdMultiplier} \times \text{SD})$ (default `sdMultiplier = 2.0`).

2. **Relative Strength Index (`calculateRSI(candles, period = 14)`)**:
   - Standard 14-period Wilder smoothed RSI based on candle close prices.

3. **Volume SMA (`calculateVolumeSMA(candles, period = 20)`)**:
   - Simple 20-period moving average of candle volume.

4. **Average True Range (`calculateATR(candles, period = 14)`)**:
   - 14-period Wilder smoothed ATR derived from True Range $\max(H-L, |H-P_c|, |L-P_c|)$.

5. **Dynamic Parameter Overrides (`getSymbolParams(symbol)`)**:
   - Reads symbol-specific tuning from `server/data/symbolParams.json` or `global.OPTIMIZE_PARAMS`.
   - Tunable parameters: `minVolumeRatio` (default 1.2), `sdMultiplier` (default 2.0), `rsiOversold` (default 35), `rsiOverbought` (default 65), `stopLossMultiplier` (default 1.5).

### Signal Trigger Logic (`evaluate(history)`)
- **Prerequisite**: `history` must have at least 21 candles.
- **LONG Signal**:
  - Price Condition: `currentCandle.close <= lowerBand`
  - RSI Condition: `rsi <= rsiOversold` (default $\le 35$)
  - Volume Condition: `currentCandle.volume >= minVolumeRatio * volumeSMA` (default $\ge 1.2 \times \text{VolumeSMA}$)
  - Target: `vwap`
  - Stop Loss: `currentCandle.close - (stopLossMultiplier * atr)`
  - Output Object: `{ action: 'LONG', entry: currentCandle.close, target: vwap, stopLoss, metadata: { rsi, vwap, lowerBand, volume, volumeSMA, atr } }`
- **SHORT Signal**:
  - Price Condition: `currentCandle.close >= upperBand`
  - RSI Condition: `rsi >= rsiOverbought` (default $\ge 65$)
  - Volume Condition: `currentCandle.volume >= minVolumeRatio * volumeSMA` (default $\ge 1.2 \times \text{VolumeSMA}$)
  - Target: `vwap`
  - Stop Loss: `currentCandle.close + (stopLossMultiplier * atr)`
  - Output Object: `{ action: 'SHORT', entry: currentCandle.close, target: vwap, stopLoss, metadata: { rsi, vwap, upperBand, volume, volumeSMA, atr } }`
- **HOLD / NONE**:
  - Returns `null` if history is insufficient or any indicator evaluation fails or filters reject the setup.

---

## 2. Available Quantitative Indicator Modules

The project maintains a collection of modular quantitative indicators in `/Users/tbrook/Desktop/AI Trader/server/quantitative/`:

| Module Path | Exports | Description / Purpose |
|---|---|---|
| `server/quantitative/vwapReversion.js` | `calculateVWAP`, `evaluate` | Daily Anchored VWAP + SD bands strategy |
| `server/quantitative/vwap.js` | `computeRollingVWAP`, `evaluate` | 24-hour rolling VWAP (for 24/7 crypto markets) |
| `server/quantitative/adx.js` | `computeADX`, `isTrending` | 14-period Average Directional Index (ADX). `isTrending(history, 14, 25)` checks if ADX $\ge 25$. |
| `server/quantitative/hurst.js` | `calculateHurst`, `classifyRegime` | Rescaled Range (R/S) Hurst Exponent. $H > 0.55 \implies$ Trending, $H < 0.45 \implies$ Mean-reverting, $0.45 \le H \le 0.55 \implies$ Chop. |
| `server/quantitative/atr.js` | `calculateATR`, `getDynamicATRMultiplier` | 14-period ATR and volatility-adjusted multiplier |
| `server/quantitative/bollingerRsi.js` | `evaluate`, `computeSMA`, `computeSD`, `computeRSI` | Bollinger Bands + RSI mean reversion strategy with 200-SMA trend filter |
| `server/quantitative/volumeProfile.js` | `analyzeVolume`, `classifyVolume` | Relative volume analysis (`HIGH`, `NORMAL`, `BELOW_AVG`, `DEAD`) |
| `server/quantitative/hmm.js` | `classifyRegime` | Hidden Markov Model 3-state regime classifier (`momentum`, `mean_reverting`, `high_volatility`) |
| `server/quantitative/kalman.js` | `evaluate` | Kalman filter state space trend tracking |
| `server/quantitative/ouModel.js` | `evaluate` | Ornstein-Uhlenbeck stochastic mean-reversion process |
| `server/quantitative/macd.js` | `evaluate`, `computeEMA` | Moving Average Convergence Divergence trend momentum |

---

## 3. Timestamp/Session Time Handling & R2 Analysis

### Current Timestamp Handling
- In bar objects: `{ open, high, low, close, volume, timestamp }` (sometimes `time` or `Timestamp`).
- In `vwapReversion.js` (`calculateVWAP` lines 116-120):
  ```javascript
  let lastTime = lastCandle.timestamp || lastCandle.time;
  if (typeof lastTime === 'string') lastTime = new Date(lastTime).getTime();
  else if (typeof lastTime === 'number' && lastTime < 10000000000) lastTime *= 1000;
  ```
- **Current Limitation**: Time filtering is currently implemented outside `vwapReversion.js` (e.g. in `server/autonomous/loop.js` line 73 and `server/backtest.js` line 150). `vwapReversion.evaluate()` itself does not check bar timestamps or session hours.

### R2 Requirement
- **Requirement**: Ignore all signals generated before 10:15 AM ET to prevent entering trades during opening bell volatility when VWAP bands are unstable.

### Implementation Design for R2 inside `vwapReversion.js`
1. Extract current bar timestamp:
   ```javascript
   const currentCandle = history[history.length - 1];
   let rawTime = currentCandle.timestamp || currentCandle.time || new Date();
   let timeMs = typeof rawTime === 'string' ? new Date(rawTime).getTime() : rawTime;
   if (typeof timeMs === 'number' && timeMs < 10000000000) timeMs *= 1000;
   ```
2. Convert timestamp to US Eastern Time (`America/New_York` timezone):
   ```javascript
   const nyDateStr = new Date(timeMs).toLocaleString('en-US', { timeZone: 'America/New_York' });
   const nyDate = new Date(nyDateStr);
   const timeVal = nyDate.getHours() * 100 + nyDate.getMinutes(); // e.g. 10:15 AM -> 1015
   ```
3. Time Window Validation:
   ```javascript
   // Reject signals before 10:15 AM ET (1015)
   if (timeVal < 1015) {
       return null;
   }
   ```
4. Note on RTH (Regular Trading Hours): Stock trading hours open at 09:30 AM ET (930). 10:15 AM ET is 45 minutes after market open. Signals generated between 09:30 AM and 10:14 AM ET will return `null`.

---

## 4. R1 Macro Regime Filter Integration Analysis

### Requirement R1
- Disable all mean-reverting signals in `vwapReversion.js` when the market is in a strong directional trend.

### Existing Indicators Available for R1
1. `server/quantitative/adx.js`:
   - `isTrending(history, 14, 25)` returns `true` if ADX $\ge 25$.
   - `computeADX(history, 14)` returns exact ADX float.
2. `server/quantitative/hurst.js`:
   - `calculateHurst(history)` returns Hurst exponent $H \in [0, 1]$.
   - `classifyRegime(history)` returns `'trending'` when $H > 0.55$.

### Proposed Integration in `vwapReversion.js`
Import `adx.js` and/or `hurst.js` in `vwapReversion.js`:
```javascript
const { computeADX, isTrending } = require('./adx');
const { calculateHurst, classifyRegime } = require('./hurst');
```

In `evaluate(history)`:
```javascript
// R1: Macro Regime Filter
const params = getSymbolParams(history[0].symbol || 'SPY');
const adxThreshold = params.adxThreshold || 25; // Default 25
const adxVal = computeADX(history, 14);
const hurstVal = calculateHurst(history);

// Block trade if market is strongly trending (ADX >= threshold OR Hurst > 0.55)
const isTrendingRegime = (adxVal !== null && adxVal >= adxThreshold) || (hurstVal > 0.55);
if (isTrendingRegime) {
    return null; // Mean-reversion signals disabled during trend
}
```

This ensures mean-reverting entries only occur in range-bound or low-trend market regimes.

---

## 5. R3 VWAP Band Squeeze Validator Analysis

### Requirement R3
- Add minimum band-width validator to the signal generator: Target Price - Entry Price > 1.5 * ATR (or $\text{Distance to VWAP} > 1.5 \times \text{ATR}$).

### Current Signal Target & Entry Logic
- Entry price = `currentCandle.close`
- Target price = `vwap` (center line)
- Reward distance = $| \text{vwap} - \text{currentCandle.close} |$

### Proposed Validator Logic in `vwapReversion.js`
```javascript
// R3: VWAP Band Squeeze Check
const targetDistance = Math.abs(vwap - currentCandle.close);
const minDistanceRequired = (params.squeezeMultiplier || 1.5) * atr;

if (targetDistance <= minDistanceRequired) {
    return null; // Reject signal due to band squeeze (insufficient reward:risk ratio)
}
```

When VWAP bands squeeze close together during low-volatility consolidation, the distance between the $\pm 2$ SD band and VWAP is small ($< 1.5 \times \text{ATR}$). Rejecting these setups avoids low-profit trades where execution friction or spread eats into returns.

---

## 6. Interface Contracts, Module Exports, Inputs & Outputs

### Module Export Contract
```javascript
module.exports = {
    calculateVWAP,
    calculateRSI,
    calculateVolumeSMA,
    calculateATR,
    evaluate
};
```

### Input Contract for `evaluate(history)`
- **`history`**: Non-empty Array of candle objects sorted chronologically.
  - Required properties per bar:
    * `open` (Number)
    * `high` (Number)
    * `low` (Number)
    * `close` (Number)
    * `volume` (Number)
    * `timestamp` or `time` (ISO String, Date, or Epoch ms/sec)
  - Minimum length required: 30 bars (to warm up ADX and 20-volume SMA).

### Output Contract for `evaluate(history)`
Returns `Signal` object or `null`:
```typescript
interface SignalMetadata {
    rsi: number;
    vwap: number;
    upperBand?: number;
    lowerBand?: number;
    volume: number;
    volumeSMA: number;
    atr: number;
    adx: number;
    hurst: number;
    targetDistance: number;
    sessionTimeET: string;
}

interface StrategySignal {
    action: 'LONG' | 'SHORT';
    entry: number;
    target: number;
    stopLoss: number;
    metadata: SignalMetadata;
}
```

---

## Summary of Proposed Execution Order in `evaluate(history)`

1. **Length Validation**: `if (!history || history.length < 30) return null;`
2. **R2 Session Time Check**: If current bar ET time < 10:15 AM ET, return `null`.
3. **R1 Macro Regime Check**: Calculate ADX / Hurst. If `adx >= 25` or `hurst > 0.55`, return `null`.
4. **Indicator Calculations**: Calculate VWAP, SD bands, RSI(14), Volume SMA(20), ATR(14).
5. **R3 Band Squeeze Check**: If `Math.abs(vwap - close) <= 1.5 * atr`, return `null`.
6. **Price & Trigger Evaluation**: Check close vs bands, RSI thresholds, and volume ratio. Return `LONG` / `SHORT` signal object or `null`.
