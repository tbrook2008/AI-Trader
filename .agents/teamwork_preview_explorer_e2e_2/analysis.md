# Technical Analysis Report: Tier 2 Boundary Conditions & Tier 3 Cross-Feature Interactions

**Agent**: `teamwork_preview_explorer_e2e_2`  
**Track**: E2E Testing Track (M3)  
**Target Repository**: `/Users/tbrook/Desktop/AI Trader`  
**Date**: 2026-08-04  

---

## 1. Executive Summary

This report delivers an exhaustive, requirements-driven analysis of **Tier 2 Boundary Conditions** and **Tier 3 Cross-Feature Interactions** for the AI Trader VWAP Mean Reversion Upgrade (Requirements R1–R4).

The primary objective is to define the exact mathematical specifications, edge-case behavior contracts, synthetic data fixture parameters, and state-machine transition assertions necessary for building `test-vwap-e2e.js`.

### Key Findings
1. **Tier 2 Boundaries**: Precise threshold demarcation must be enforced between allowed and rejected strategy states. Floating-point precision (JavaScript double-precision 64-bit IEEE 754) requires strict comparison operators (`>=` vs `>`, `<=` vs `<`) and rounding guarantees.
2. **Tier 3 Multi-Filter Interactions**: When multiple defensive filters activate simultaneously (Morning Open + Trend Regime + Band Squeeze), the signal generator must reject signals cleanly (return `null`) without throwing exceptions or leaking intermediate state.
3. **Scale-Out & Rounding Invariant**: In position management (R4), fractional quantity splitting must strictly preserve the sum invariant: $Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$, ensuring zero dust remaining and zero rounding mismatch across Alpaca API calls.

---

## 2. Tier 2 Boundary Condition Specifications

Below is the detailed specification for all six Tier 2 boundary categories.

---

### Boundary 1: Time-of-Day Filter (R2)
* **Requirement**: Ignore all strategy signals before 10:15 AM ET (`America/New_York`).
* **Threshold Definition**: `sessionTimeET < 10:15` -> REJECT (`null`). `sessionTimeET >= 10:15` -> ALLOWED.

#### Boundary Comparison Matrix

| Boundary Point | Timestamp / Input Time | NY Time Conversion | Filter Result | Rationale |
|---|---|---|---|---|
| **Sub-Boundary** | `09:30:00 AM ET` | `09:30:00` | **REJECTED (`null`)** | Market open, extreme opening volatility |
| **Near-Boundary (Reject)** | `10:14:59 AM ET` | `10:14:59` | **REJECTED (`null`)** | 1 second prior to cutoff threshold |
| **Exact-Boundary (Accept)** | `10:15:00 AM ET` | `10:15:00` | **ACCEPTED** | Threshold inclusive cutoff (`>= 10:15:00`) |
| **Post-Boundary (Accept)** | `10:15:01 AM ET` | `10:15:01` | **ACCEPTED** | Regular session trading |

#### Technical & Implementation Requirements
* **Timezone Specification**: Must explicitly use `America/New_York` timezone (handles EST UTC-5 and EDT UTC-4 automatically). Do **not** rely on server local time.
* **Format Parsing**: The time checker must parse timestamps formatted as ISO 8601 strings (e.g. `"2026-08-04T10:14:00-04:00"` or `"2026-08-04T14:14:00Z"`) as well as epoch millisecond numbers.
* **Timestamp Comparison Logic**:
  ```javascript
  const nyDateStr = new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' });
  const nyDate = new Date(nyDateStr);
  const minutesSinceMidnight = nyDate.getHours() * 60 + nyDate.getMinutes();
  const thresholdMinutes = 10 * 60 + 15; // 615 minutes (10:15 AM)

  if (minutesSinceMidnight < thresholdMinutes) {
    return null; // Reject signal before 10:15 AM ET
  }
  ```

---

### Boundary 2: ADX Trend Regime Threshold (R1)
* **Requirement**: Disable mean-reversion signals when market is in a strong directional trend (ADX >= 25.0).
* **Threshold Definition**: `adx >= 25.0` -> TRENDING -> REJECT (`null`). `adx < 25.0` -> NON-TRENDING -> ALLOWED.

#### Boundary Comparison Matrix

| Boundary Point | ADX Value | Floating Point Value | Filter Result | Rationale |
|---|---|---|---|---|
| **Sub-Boundary** | `24.89` | `24.89000000000000` | **ALLOWED** | Well within non-trending regime |
| **Near-Boundary (Allow)** | `24.99` | `24.99000000000000` | **ALLOWED** | Below 25.0 threshold (`< 25.0`) |
| **Exact-Boundary (Reject)**| `25.00` | `25.00000000000000` | **REJECTED (`null`)** | Inclusive threshold boundary (`>= 25.0`) |
| **Post-Boundary (Reject)** | `25.01` | `25.01000000000000` | **REJECTED (`null`)** | Strong trending regime |

#### Technical & Implementation Requirements
* **Calculation Period**: Standard 14-period Wilder's ADX calculation (`adx.js`).
* **Floating Point Safety**: Double-precision floats can yield values like `24.999999999999996`. Comparison must strictly evaluate `adx >= 25.0`.
* **ADX Check Implementation**:
  ```javascript
  const adx = computeADX(history, 14);
  if (adx !== null && adx >= 25.0) {
    return null; // Reject due to high ADX trend
  }
  ```

---

### Boundary 3: Hurst Exponent Regime Threshold (R1)
* **Requirement**: Disable mean-reversion signals when market is trending (Hurst Exponent > 0.55).
* **Threshold Definition**: `hurst > 0.55` -> TRENDING -> REJECT (`null`). `hurst <= 0.55` -> NON-TRENDING (Chop/Mean-reverting) -> ALLOWED.

#### Boundary Comparison Matrix

| Boundary Point | Hurst Value | Regime Classification | Filter Result | Rationale |
|---|---|---|---|---|
| **Sub-Boundary** | `0.540` | Random Walk / Chop | **ALLOWED** | Below 0.55 threshold |
| **Exact Cutoff Boundary** | `0.550` | Random Walk / Chop | **ALLOWED** | Boundary condition (`> 0.55` is false for 0.550) |
| **Near-Boundary (Reject)** | `0.551` | Trending | **REJECTED (`null`)** | Above 0.55 threshold |
| **Post-Boundary (Reject)** | `0.560` | Strong Trend | **REJECTED (`null`)** | Strong trending persistence |

#### Technical & Implementation Requirements
* **Calculation Method**: Rescaled Range (R/S) Analysis over price log-returns (`hurst.js`).
* **Threshold Operator**: Strictly strictly greater than (`> 0.55`).
* **Hurst Check Implementation**:
  ```javascript
  const hurst = calculateHurst(history);
  if (hurst > 0.55) {
    return null; // Reject due to trending regime (Hurst > 0.55)
  }
  ```

---

### Boundary 4: VWAP Band Squeeze Ratio (R3)
* **Requirement**: Distance between entry price and VWAP target must exceed 1.5 * ATR (`|Target - Entry| > 1.5 * ATR`).
* **Squeeze Ratio Definition**: $\text{Ratio} = \frac{|\text{VWAP Target} - \text{Entry Price}|}{\text{ATR}(14)}$.
* **Threshold Condition**: $\text{Ratio} > 1.50$ -> ALLOWED. $\text{Ratio} \le 1.50$ -> SQUEEZED -> REJECT (`null`).

#### Boundary Comparison Matrix

| Boundary Point | Distance / ATR Ratio | Target Distance | ATR(14) | Filter Result | Rationale |
|---|---|---|---|---|---|
| **Sub-Boundary (Squeezed)** | `1.40` | `$1.40` | `$1.00` | **REJECTED (`null`)** | Insufficient reward-to-risk |
| **Near-Boundary (Reject)** | `1.49` | `$1.49` | `$1.00` | **REJECTED (`null`)** | Below 1.50 requirement |
| **Exact-Boundary (Reject)**| `1.50` | `$1.50` | `$1.00` | **REJECTED (`null`)** | Strict inequality (`> 1.5 * ATR`) fails at equal |
| **Near-Boundary (Accept)** | `1.51` | `$1.51` | `$1.00` | **ACCEPTED** | Exceeds 1.50 requirement |

#### Technical & Implementation Requirements
* **LONG Trade Distance**: $\text{Distance} = \text{VWAP Target} - \text{Entry Close}$.
* **SHORT Trade Distance**: $\text{Distance} = \text{Entry Close} - \text{VWAP Target}$.
* **Validator Implementation**:
  ```javascript
  const targetDist = Math.abs(vwap - currentCandle.close);
  const minRequiredDist = 1.5 * atr;
  if (targetDist <= minRequiredDist) {
    return null; // Reject due to band squeeze (target distance <= 1.5 * ATR)
  }
  ```

---

### Boundary 5: Price Touches & Risk State Machine Transitions (R4)
* **Requirement**: 50% scale-out at 1 SD band mark, ratchet stop-loss to breakeven, exit final 50% at VWAP center line.

#### LONG Position State Machine Transition Matrix

| Current Stage | Event / Price Condition | Target Mark | Price Level Example | Triggered Action | New Stage | New Position Status |
|---|---|---|---|---|---|---|
| **Stage 0 (Initial)** | Price below 1 SD mark | Lower Band 1 SD (`VWAP - 1SD`) | `$99.99` (vs `$100.00` SD mark) | **No Action** (Hold full position) | Stage 0 | `open` |
| **Stage 0 (Initial)** | Price touches exact 1 SD mark | Lower Band 1 SD (`VWAP - 1SD`) | `$100.00` (exact touch) | **Scale-Out 50% Qty**; Ratchet `stop_loss = entryPrice` | **Stage 1** | `open` (partial) |
| **Stage 0 (Initial)** | Price breaches above 1 SD mark | Lower Band 1 SD (`VWAP - 1SD`) | `$100.05` | **Scale-Out 50% Qty**; Ratchet `stop_loss = entryPrice` | **Stage 1** | `open` (partial) |
| **Stage 1 (Partial)** | Price touches exact Breakeven SL | Breakeven (`stop_loss = entryPrice`)| `$95.00` (exact entry price) | **Close Remaining 50% Qty** at Breakeven | **Stage 2** | `closed` |
| **Stage 1 (Partial)** | Price breaches below Breakeven | Breakeven (`stop_loss = entryPrice`)| `$94.95` | **Close Remaining 50% Qty** at Market | **Stage 2** | `closed` |
| **Stage 1 (Partial)** | Price touches exact VWAP center | VWAP Target (`VWAP`) | `$105.00` (exact VWAP center) | **Close Remaining 50% Qty** at VWAP Target | **Stage 2** | `closed` |

#### Technical & Implementation Requirements
* **LONG Direction Conditions**:
  * Scale-out condition: $\text{Current Price} \ge \text{LowerBand1SD}$ (where $\text{LowerBand1SD} = \text{VWAP} - 1\sigma$).
  * Breakeven SL condition: $\text{Current Price} \le \text{EntryPrice}$.
  * VWAP Target condition: $\text{Current Price} \ge \text{VWAP}$.
* **SHORT Direction Conditions**:
  * Scale-out condition: $\text{Current Price} \le \text{UpperBand1SD}$ (where $\text{UpperBand1SD} = \text{VWAP} + 1\sigma$).
  * Breakeven SL condition: $\text{Current Price} \ge \text{EntryPrice}$.
  * VWAP Target condition: $\text{Current Price} \le \text{VWAP}$.

---

### Boundary 6: Fractional Share Math & Step Size Precision Limits (R4)
* **Requirement**: Correct step size rounding and exact sum invariant without leaving residual "dust" shares.

#### Mathematical Specification
Let $Q_{\text{initial}}$ be initial position quantity, and $S$ be symbol step size (e.g. $S = 0.001$, $S = 0.0001$, or $S = 1.0$).
1. Partial scale-out quantity:
   $$Q_{\text{partial}} = \text{roundToStep}\left(\frac{Q_{\text{initial}}}{2}, S\right)$$
2. Remaining quantity:
   $$Q_{\text{remaining}} = Q_{\text{initial}} - Q_{\text{partial}}$$
3. **Strict Invariant Guarantee**:
   $$Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$$

#### Test Case Precision Matrix

| Test Case | Initial Qty ($Q_{\text{initial}}$) | Step Size ($S$) | Calculation ($Q_{\text{initial}} / 2$) | $Q_{\text{partial}}$ | $Q_{\text{remaining}}$ | Sum Invariant Verified? |
|---|---|---|---|---|---|---|
| **Odd Integer Shares** | `1.0` share | `0.001` | `0.500` | `0.500` | `0.500` | `0.500 + 0.500 = 1.000` ✅ |
| **Fractional Crypto** | `0.33333` | `0.00001` | `0.166665` | `0.16667` | `0.16666` | `0.16667 + 0.16666 = 0.33333` ✅ |
| **Small Fractional** | `0.005` | `0.001` | `0.0025` | `0.003` | `0.002` | `0.003 + 0.002 = 0.005` ✅ |
| **Whole Integer Stock**| `10` shares | `1.0` | `5.0` | `5` | `5` | `5 + 5 = 10` ✅ |
| **Odd Integer Stock** | `3` shares | `1.0` | `1.5` | `2` | `1` | `2 + 1 = 3` ✅ |

#### Helper Code Implementation for Test Suite
```javascript
function roundToStep(value, stepSize) {
  const precision = Math.round(-Math.log10(stepSize));
  const factor = Math.pow(10, Math.max(0, precision));
  return Math.round(value * factor) / factor;
}

function calculateScaleOutQuantities(initialQty, stepSize = 0.0001) {
  const rawHalf = initialQty / 2;
  const qPartial = roundToStep(rawHalf, stepSize);
  const qRemaining = roundToStep(initialQty - qPartial, stepSize);

  // Assert exact floating-point invariant
  const sumDiff = Math.abs((qPartial + qRemaining) - initialQty);
  if (sumDiff > 1e-9) {
    throw new Error(`Rounding invariant failed! ${qPartial} + ${qRemaining} !== ${initialQty}`);
  }

  return { qPartial, qRemaining };
}
```

---

## 3. Tier 3 Multi-Filter Cross-Feature Interactions

Tier 3 evaluates scenarios where **multiple defensive filters are triggered simultaneously**.

The signal generator must evaluate all active conditions and reject signals whenever **at least one** filter fails. When multiple filters fail at once, the strategy must prioritize safety (return `null`) without crashing or producing partial state corruption.

### 8-Combination Filter Truth Table (Tier 3 Matrix)

Let:
* **F1**: Time Filter (Active if `timestamp < 10:15 AM ET` -> REJECT)
* **F2**: Trend Regime Filter (Active if `ADX >= 25.0 || Hurst > 0.55` -> REJECT)
* **F3**: Band Squeeze Filter (Active if `targetDist <= 1.5 * ATR` -> REJECT)
* **Signal Setup**: Price touched -2 SD lower band, RSI <= 35, Volume >= 1.2x SMA (all setup criteria met).

| Scenario # | F1 (Morning Open < 10:15 ET) | F2 (Macro Trend Active) | F3 (Band Squeezed) | Strategy Signal Output | Rejection Rationale |
|---|---|---|---|---|---|
| **Comb 1** | **TRUE (Reject)** | **TRUE (Reject)** | **TRUE (Reject)** | `null` | All 3 filters active simultaneously |
| **Comb 2** | **TRUE (Reject)** | **TRUE (Reject)** | FALSE (Valid) | `null` | Morning Open & Macro Trend active |
| **Comb 3** | **TRUE (Reject)** | FALSE (Valid) | **TRUE (Reject)** | `null` | Morning Open & Band Squeeze active |
| **Comb 4** | **TRUE (Reject)** | FALSE (Valid) | FALSE (Valid) | `null` | Morning Open active only |
| **Comb 5** | FALSE (Valid) | **TRUE (Reject)** | **TRUE (Reject)** | `null` | Macro Trend & Band Squeeze active |
| **Comb 6** | FALSE (Valid) | **TRUE (Reject)** | FALSE (Valid) | `null` | Macro Trend active only |
| **Comb 7** | FALSE (Valid) | FALSE (Valid) | **TRUE (Reject)** | `null` | Band Squeeze active only |
| **Comb 8** | FALSE (Valid) | FALSE (Valid) | FALSE (Valid) | **`StrategySignal`** | All filters pass -> Signal generated! |

---

### Filter Cascade & Short-Circuit Optimization

To maximize execution efficiency during live 1-minute streaming bar evaluation, the filters should be evaluated in increasing order of computational cost:

```
[ Incoming Bar ]
       │
       ▼
 1. Time Check (Fastest: Timestamp check < 10:15 AM ET) ───(Fail)───► Return null
       │
      (Pass)
       ▼
 2. Indicator Calculation (VWAP, RSI, ATR, ADX, Hurst)
       │
       ▼
 3. Trend Regime Check (ADX >= 25.0 || Hurst > 0.55) ──────(Fail)───► Return null
       │
      (Pass)
       ▼
 4. Entry & Indicator Setup (Price <= -2 SD, RSI <= 35, Vol >= 1.2x) ─(Fail)─► Return null
       │
      (Pass)
       ▼
 5. Band Squeeze Validator (Target Distance > 1.5 * ATR) ──(Fail)───► Return null
       │
      (Pass)
       ▼
 Return Valid StrategySignal { action, entry, target, scaleOutTarget, stopLoss, metadata }
```

---

## 4. Synthetic Bar Feed & Data Generation Strategy

To test these boundary conditions and multi-filter combinations deterministically, the test suite (`test-vwap-e2e.js`) requires synthetic candle generators.

### Synthetic Candle Data Structures

Each synthetic bar object must conform to:
```javascript
interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string | number;
}
```

### Generator Helper Functions

```javascript
/**
 * Generates a base daily 1m bar series starting at 9:30 AM ET
 */
function generateBaseSession(numBars = 60, startPrice = 100.0) {
  const bars = [];
  const baseTime = new Date('2026-08-04T13:30:00.000Z').getTime(); // 9:30 AM EDT

  for (let i = 0; i < numBars; i++) {
    const timeMs = baseTime + i * 60 * 1000;
    const isoTime = new Date(timeMs).toISOString();
    bars.push({
      open: startPrice,
      high: startPrice + 0.10,
      low: startPrice - 0.10,
      close: startPrice,
      volume: 1000,
      timestamp: isoTime
    });
  }
  return bars;
}

/**
 * Injects a sharp dip to trigger a LONG signal (-2 SD breach, RSI oversold, volume surge)
 */
function injectLongSignalCandle(history, vwap, lowerBand, timestampStr) {
  const entryPrice = lowerBand - 0.50; // Below lower band
  history.push({
    open: entryPrice + 0.20,
    high: entryPrice + 0.30,
    low: entryPrice - 0.10,
    close: entryPrice,
    volume: 5000, // 5x normal volume
    timestamp: timestampStr
  });
}
```

---

## 5. Test Suite Blueprint for `test-vwap-e2e.js`

Below is the concrete plan for integrating Tier 2 and Tier 3 tests into `test-vwap-e2e.js`.

### Test Group Structure

1. **Group 1: Tier 1 Feature Basic Tests** (Covered by Explorer 1 & Test Writer)
2. **Group 2: Tier 2 Boundary Condition Suite**
   - `[T2.1]` Time boundary: 10:14 AM ET (reject) vs 10:15 AM ET (accept).
   - `[T2.2]` ADX boundary: 24.9 (accept) vs 25.0 (reject).
   - `[T2.3]` Hurst boundary: 0.54 (accept) vs 0.56 (reject).
   - `[T2.4]` Band squeeze boundary: 1.49 * ATR (reject) vs 1.51 * ATR (accept).
   - `[T2.5]` Price touch boundary: 1 SD near touch (hold) vs 1 SD exact touch (scale-out).
   - `[T2.6]` Price touch boundary: Breakeven SL near touch (hold) vs exact touch (close).
   - `[T2.7]` Fractional share math: `0.33333` shares splitting with step size `0.00001`.
   - `[T2.8]` Fractional share math: `1.0` odd share splitting with step size `0.001`.
3. **Group 3: Tier 3 Multi-Filter Interaction Suite**
   - `[T3.1]` Simultaneous Morning Open + Trend + Band Squeeze -> Null signal.
   - `[T3.2]` Morning Open + Trend (Normal Band) -> Null signal.
   - `[T3.3]` Post 10:15 AM + Trend + Band Squeeze -> Null signal.
   - `[T3.4]` All 3 Filters Clear (Post 10:15 AM + Non-trending + Wide Band) -> Valid Signal generated.
4. **Group 4: Tier 4 Full-Day Synthetic Scenario** (Covered by Explorer 3)

---

## 6. Verification Methods & Checklist

To independently verify all findings and test suite readiness:

1. **Verify Strategy Interface Export**:
   Run `node -e "const v = require('./server/quantitative/vwapReversion'); console.log(typeof v.evaluate);"`
2. **Verify Codebase Files Exist**:
   - `server/quantitative/vwapReversion.js`
   - `server/quantitative/adx.js`
   - `server/quantitative/hurst.js`
   - `server/execution/tradeExecutor.js`
   - `server/autonomous/riskMonitor.js`
3. **Verify Master Test Suite Runner**:
   Run `node test-all.js` to ensure baseline unit test suite executes cleanly before running E2E suites.

---
*End of Analysis Report*
