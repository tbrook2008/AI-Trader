# Comprehensive Analysis & Test Interface Specification for Tier 1 (Feature Coverage)
**Project**: AI Trader — Institutional-Grade VWAP Mean Reversion Upgrade  
**Author**: teamwork_preview_explorer_e2e_1 (Explorer Subagent, E2E Testing Track)  
**Date**: 2026-08-04  
**Target Files**: `test-vwap-e2e.js`, `test-all.js`, `server/quantitative/vwapReversion.js`, `server/autonomous/riskMonitor.js`, `server/db/schema.js`

---

## 1. Executive Summary

This report establishes the explicit test contracts, interface definitions, data structures, and deterministic acceptance criteria for **Tier 1 (Feature Coverage)** end-to-end testing of the AI Trader VWAP Mean Reversion strategy upgrade. 

The strategy upgrade transforms the basic mean-reversion algorithm into an institutional-grade trading system by integrating four core requirements defined in `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `TEST_INFRA.md`:
1. **R1: Macro Regime Filter** — Rejection of mean-reverting signals during strong directional trends using Average Directional Index ($\text{ADX} \ge 25$) and Hurst Exponent ($H > 0.55$).
2. **R2: Time-of-Day Session Filter** — Disabling signal evaluation before 10:15 AM US Eastern Time (`America/New_York`) to eliminate high-noise opening-bell volatility.
3. **R3: VWAP Band Squeeze Validator** — Minimum reward-to-risk bandwidth check requiring target distance $|P_{\text{target}} - P_{\text{entry}}| > 1.5 \times \text{ATR}$ (Band Squeeze Ratio $> 1.50$).
4. **R4: Autonomous Scale-Out & Fractional Rounding Engine** — Multi-stage position manager executing a 50% partial exit at 1 Standard Deviation mark (halfway back to VWAP), ratcheting Stop-Loss to breakeven, taking remaining 50% profit at VWAP center line, and maintaining exact zero-dust fractional share accounting math ($Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$).

This document serves as the authoritative blueprint for implementers and test authors to construct Tier 1 automated unit and synthetic E2E verification suites.

---

## 2. Module Interface & Data Contract Specifications

### 2.1 Strategy Signal Evaluator (`server/quantitative/vwapReversion.js`)

#### `vwapReversion.evaluate(history)`
- **Function Signature**: `evaluate(history: Array<Candle>): StrategySignal | null`
- **Input Constraints**:
  - `history`: Array of candle objects. Must have `history.length >= 30` (to satisfy 28-period ADX requirement, 20-period Volume SMA, 14-period RSI/ATR/Hurst).
  - `Candle` structure:
    ```typescript
    interface Candle {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      timestamp: string | number; // ISO-8601 string or Unix timestamp (ms or sec)
      symbol?: string;
    }
    ```
- **Return Contract**: Returns a `StrategySignal` object if all filters pass and entry conditions are met; otherwise returns `null`.
- **Output Data Structure (`StrategySignal`)**:
  ```typescript
  interface StrategySignal {
    action: 'LONG' | 'SHORT';
    entry: number;          // Current candle close price
    target: number;         // VWAP center line
    scaleOutTarget: number; // 1 SD band level (LONG: VWAP - 1.0*SD, SHORT: VWAP + 1.0*SD)
    stopLoss: number;       // Entry +/- (1.5 * ATR)
    metadata: {
      rsi: number;
      vwap: number;
      upperBand: number;      // 2.0 SD Upper Band
      lowerBand: number;      // 2.0 SD Lower Band
      upperBand1SD: number;   // 1.0 SD Upper Band
      lowerBand1SD: number;   // 1.0 SD Lower Band
      volume: number;
      volumeSMA: number;
      atr: number;
      adx: number;
      hurst: number;
      sessionTimeET: string;  // Formatted ET time e.g., "10:15:00 AM"
    };
  }
  ```

#### `vwapReversion.calculateVWAP(history)`
- **Function Signature**: `calculateVWAP(history: Array<Candle>): VWAPData | null`
- **Output Data Structure (`VWAPData`)**:
  ```typescript
  interface VWAPData {
    vwap: number;
    upperBand: number;    // VWAP + 2.0 * SD
    lowerBand: number;    // VWAP - 2.0 * SD
    upperBand1SD: number; // VWAP + 1.0 * SD
    lowerBand1SD: number; // VWAP - 1.0 * SD
    sd: number;
  }
  ```

---

### 2.2 Trend & Regime Filters

#### ADX Indicator (`server/quantitative/adx.js`)
- `computeADX(history: Array<Candle>, period: number = 14): number | null`
  - Requires `history.length >= period * 2` (min 28 bars).
  - Returns calculated ADX value or `null`.
- `isTrending(history: Array<Candle>, period: number = 14, threshold: number = 25): boolean`
  - Returns `true` if `ADX >= 25`; `false` otherwise.

#### Hurst Exponent (`server/quantitative/hurst.js`)
- `calculateHurst(history: Array<Candle>): number`
  - Computes Hurst exponent $H \in [0, 1]$ via Rescaled Range (R/S) analysis. Default $0.5$ if history $< 30$.
- `classifyRegime(history: Array<Candle>): 'trending' | 'mean-reverting' | 'chop'`
  - Returns `'trending'` if $H > 0.55$, `'mean-reverting'` if $H < 0.45$, and `'chop'` for $0.45 \le H \le 0.55$.

---

### 2.3 Database Schema Extensions (`server/db/schema.js` & `server/db/tradeLogger.js`)

#### `trades` Table Extension
To support R4 autonomous multi-stage exit tracking, the SQLite `trades` table requires the following columns:
```sql
ALTER TABLE trades ADD COLUMN scale_stage INTEGER DEFAULT 0;
ALTER TABLE trades ADD COLUMN scale_out_target REAL;
ALTER TABLE trades ADD COLUMN remaining_qty REAL;
```

#### DB Helper Functions Contract (`server/db/tradeLogger.js`)
- `logTrade(params: TradeParams): number`
  - Saves initial trade with `scale_stage = 0`, `scale_out_target = params.scaleOutTarget`, and `remaining_qty = params.qty`.
- `updateTradeScaleStage(tradeId: number, scaleStage: number, remainingQty: number, stopLoss: number): void`
  - Atomically updates `scale_stage`, `remaining_qty`, and ratchets `stop_loss` to breakeven in SQLite.
- `updateTradeOutcome({ tradeId, exitPrice, pnl, status }): void`
  - Finalizes trade when `scale_stage = 2`, setting `status = 'closed'`.

---

### 2.4 Autonomous Risk & Scale-Out Engine (`server/autonomous/riskMonitor.js`)

#### Risk Monitor State Machine (`monitorRisk()`)
Operates a periodic state machine evaluating open positions against market prices:

```
      +--------------------------------------------------------+
      |                       Stage 0                          |
      | Initial Entry: remaining_qty = initial_qty, stage = 0  |
      +---------------------------+----------------------------+
                                  |
                                  | Price touches 1 SD mark
                                  | (LONG: P >= scale_out_target, SHORT: P <= scale_out_target)
                                  v
      +--------------------------------------------------------+
      |                       Stage 1                          |
      | Partial Scale-Out: Exit Q_partial = roundToStep(Q/2)  |
      | update remaining_qty = Q - Q_partial, stage = 1        |
      | Ratchet Stop-Loss = Entry Price (Breakeven SL)          |
      +---------------------------+----------------------------+
                                  |
                +-----------------+-----------------+
                |                                   |
                | Price touches VWAP Target         | Price breaches Breakeven SL
                | (LONG: P >= target)               | (LONG: P <= entry_price)
                v                                   v
      +--------------------------------------------------------+
      |                       Stage 2                          |
      | Final Exit: Exit remaining_qty                         |
      | update stage = 2, status = 'closed', log final PnL      |
      +--------------------------------------------------------+
```

---

## 3. Detailed Feature Analysis & Tier 1 Test Criteria

### Requirement 1: Macro Trend Rejection Filter (ADX & Hurst)

#### Specification
- **Rule**: If $\text{ADX} \ge 25$ OR $\text{Hurst} > 0.55$, market is classified as trending. The strategy MUST reject all buy/sell signals and return `null`.
- **Rationale**: Mean reversion strategies suffer heavy drawdowns when attempting to short strong uptrends or long strong downtrends.

#### Evaluator Integration Contract
In `vwapReversion.evaluate(history)`:
```javascript
const adx = computeADX(history, 14);
const hurst = calculateHurst(history);

if (adx !== null && adx >= 25) return null; // Reject trend
if (hurst > 0.55) return null; // Reject trend
```

#### Tier 1 Test Matrix (Requirement 1)

| Test ID | Test Name | Input Scenario / Parameters | Expected Output | Verification Method |
|---|---|---|---|---|
| **TC-R1-01** | Strong ADX Trend Rejection | Synthetic history with continuous directional movement ($\text{ADX} = 32.5$, $H = 0.50$, RSI/Volume oversold) | `evaluate(history) === null` | Assert return value is `null`; verify log contains ADX trend rejection. |
| **TC-R1-02** | High Hurst Exponent Rejection | Synthetic history with persistent momentum ($H = 0.62$, $\text{ADX} = 18.0$, RSI/Volume oversold) | `evaluate(history) === null` | Assert return value is `null`; verify log contains Hurst trend rejection. |
| **TC-R1-03** | Dual Trend Trigger Rejection | Strong trend where both conditions trigger ($\text{ADX} = 29.0$, $H = 0.59$) | `evaluate(history) === null` | Assert return value is `null`. |
| **TC-R1-04** | ADX Boundary Threshold (24.9 vs 25.0) | Test two histories: (A) $\text{ADX} = 24.9, H = 0.50$; (B) $\text{ADX} = 25.0, H = 0.50$ | (A) Signal generated<br>(B) `null` (Rejected) | Boundary value comparison. |
| **TC-R1-05** | Hurst Boundary Threshold (0.550 vs 0.551) | Test two histories: (A) $H = 0.549, \text{ADX} = 15$; (B) $H = 0.551, \text{ADX} = 15$ | (A) Signal generated<br>(B) `null` (Rejected) | Boundary value comparison. |

---

### Requirement 2: Time-of-Day Morning Open Filter

#### Specification
- **Rule**: Ignore all signals generated when candle `timestamp` is before 10:15 AM US Eastern Time (`America/New_York`).
- **Rationale**: Morning open (09:30 - 10:15 AM ET) exhibits erratic VWAP band expanding/stretching before daily cumulative volume stabilizes.

#### Timezone Conversion Math
- Convert bar timestamp to Eastern Time (`America/New_York`):
```javascript
function getSessionTimeET(timestamp) {
  const date = new Date(timestamp);
  const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  // Parse hour and minute from ET string
  const [_, timePart] = etStr.split(', ');
  const [hours, minutes] = timePart.split(':').map(Number);
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

// Rejection condition in evaluate(history):
const { totalMinutes } = getSessionTimeET(currentCandle.timestamp);
const cutoffMinutes = 10 * 60 + 15; // 10:15 AM ET = 615 minutes
if (totalMinutes < cutoffMinutes) return null;
```

#### Tier 1 Test Matrix (Requirement 2)

| Test ID | Test Name | Input Timestamp (ET) | Expected Output | Verification Method |
|---|---|---|---|---|
| **TC-R2-01** | Market Open Bell Rejection | `2026-08-04T09:30:00` ET (570 min) | `evaluate() === null` | Timestamp converted to ET; assert `null`. |
| **TC-R2-02** | Mid-Open Volatility Rejection | `2026-08-04T09:45:00` ET (585 min) | `evaluate() === null` | Assert `null`. |
| **TC-R2-03** | Pre-Cutoff Boundary Rejection | `2026-08-04T10:14:59` ET | `evaluate() === null` | Boundary assert: 1 second prior to cutoff returns `null`. |
| **TC-R2-04** | Exact Cutoff Boundary Passing | `2026-08-04T10:15:00` ET (615 min) | Signal generated (if setup valid) | Boundary assert: exact cutoff minute allows signal generation. |
| **TC-R2-05** | Afternoon Session Passing | `2026-08-04T14:30:00` ET (870 min) | Signal generated (if setup valid) | Assert signal output contains `metadata.sessionTimeET`. |

---

### Requirement 3: VWAP Band Squeeze Filter

#### Specification
- **Rule**: Require Target Distance $|P_{\text{target}} - P_{\text{entry}}| > 1.5 \times \text{ATR}$ (or Squeeze Ratio $> 1.50$).
- **Formula**:
  $$\text{Target Distance} = |\text{VWAP} - P_{\text{close}}|$$
  $$\text{Band Squeeze Ratio} = \frac{|\text{VWAP} - P_{\text{close}}|}{\text{ATR}}$$
- **Rejection Condition**: If $|\text{VWAP} - P_{\text{close}}| \le 1.5 \times \text{ATR}$, reject signal and return `null`.

#### Evaluator Integration Contract
In `vwapReversion.evaluate(history)`:
```javascript
const targetDistance = Math.abs(vwap - currentCandle.close);
const minRequiredDistance = 1.5 * atr;
const squeezeRatio = targetDistance / atr;

if (targetDistance <= minRequiredDistance) {
  return null; // Reject due to narrow VWAP band squeeze
}
```

#### Tier 1 Test Matrix (Requirement 3)

| Test ID | Test Name | Squeeze Ratio / Distance | Expected Output | Verification Method |
|---|---|---|---|---|
| **TC-R3-01** | Severe Band Squeeze | Target Dist = $0.50$, ATR = $1.00$ ($\text{Ratio} = 0.50$) | `evaluate() === null` | Assert `null` on tight consolidation. |
| **TC-R3-02** | Moderate Squeeze Rejection | Target Dist = $1.20$, ATR = $1.00$ ($\text{Ratio} = 1.20$) | `evaluate() === null` | Assert `null`. |
| **TC-R3-03** | Exact Threshold Boundary | Target Dist = $1.50$, ATR = $1.00$ ($\text{Ratio} = 1.50$) | `evaluate() === null` | Boundary assert: ratio equal to $1.50$ is rejected. |
| **TC-R3-04** | Valid Band Expansion | Target Dist = $1.80$, ATR = $1.00$ ($\text{Ratio} = 1.80 > 1.50$) | Signal generated | Assert signal object returned. |
| **TC-R3-05** | High Volatility Expansion | Target Dist = $3.50$, ATR = $1.00$ ($\text{Ratio} = 3.50$) | Signal generated | Assert valid signal with correct risk/reward. |

---

### Requirement 4: Autonomous Scale-Out Engine & Fractional Share Rounding Math

#### Specification & Mechanics
1. **Signal Output Structure**:
   - For LONG: `target` = VWAP center line, `scaleOutTarget` = VWAP - 1.0 * SD (1 SD lower band, halfway back from -2 SD entry).
   - For SHORT: `target` = VWAP center line, `scaleOutTarget` = VWAP + 1.0 * SD (1 SD upper band, halfway back from +2 SD entry).
2. **State Machine Execution (`riskMonitor.js`)**:
   - **Stage 0 (Initial Position)**: Entry logged in DB with `scale_stage = 0`, `remaining_qty = initial_qty`.
   - **Stage 1 Transition (1 SD Touch)**:
     - LONG condition: `currentPrice >= trade.scale_out_target`.
     - SHORT condition: `currentPrice <= trade.scale_out_target`.
     - Action:
       1. Compute partial quantity $Q_{\text{partial}}$ using step size precision math.
       2. Submit market exit order for $Q_{\text{partial}}$.
       3. Update DB: set `scale_stage = 1`, `remaining_qty = Q_{\text{initial}} - Q_{\text{partial}}`.
       4. Ratchet Stop-Loss to breakeven (`stop_loss = entry_price`) in DB.
   - **Stage 2 Transition (Final VWAP Exit / Breakeven SL Breach)**:
     - Target condition LONG: `currentPrice >= trade.target_price`.
     - SL condition LONG: `currentPrice <= trade.stop_loss` (entry price).
     - Action: Exit remaining quantity $Q_{\text{remaining}}$, update DB: `scale_stage = 2`, `remaining_qty = 0`, `status = 'closed'`.

3. **Fractional Share Rounding Math Contract**:
   To prevent leaving fractional "dust" or order submission rejections by Alpaca:
   ```javascript
   /**
    * Computes partial scale-out and remaining quantities adhering to step size constraints.
    * Invariant: Q_partial + Q_remaining === Q_initial
    */
   function calculateScaleOutQty(initialQty, scalePct = 0.5, stepSize = 1.0) {
     const rawPartial = initialQty * scalePct;
     const precision = stepSize < 1 ? Math.round(-Math.log10(stepSize)) : 0;
     
     let partialQty;
     if (precision === 0) {
       partialQty = Math.floor(rawPartial);
     } else {
       const factor = Math.pow(10, precision);
       partialQty = Math.floor(rawPartial * factor) / factor;
     }
     
     // Guarantee at least min stepSize if initialQty >= stepSize
     if (partialQty <= 0 && initialQty >= stepSize) {
       partialQty = stepSize;
     }
     
     const remainingQty = Number((initialQty - partialQty).toFixed(precision));
     
     // Invariant validation check
     if (Number((partialQty + remainingQty).toFixed(precision)) !== Number(initialQty.toFixed(precision))) {
       throw new Error(`Fractional accounting error: ${partialQty} + ${remainingQty} !== ${initialQty}`);
     }
     
     return { partialQty, remainingQty };
   }
   ```

#### Tier 1 Test Matrix (Requirement 4)

| Test ID | Test Name | Scenario / Inputs | Expected Output | Verification Method |
|---|---|---|---|---|
| **TC-R4-01** | Signal Export of `scaleOutTarget` | LONG setup on -2 SD band touch | Signal contains `scaleOutTarget === vwap - 1.0*sd` | Assert property presence & accuracy. |
| **TC-R4-02** | Stage 0 -> Stage 1 Transition (LONG) | LONG position active, price reaches 1 SD band | Market sell for 50% qty submitted; DB `scale_stage = 1`; `stop_loss` updated to `entry_price`. | DB query verification; mock Alpaca API call check. |
| **TC-R4-03** | Stage 1 -> Stage 2 Transition via Target | Active Stage 1 position, price reaches VWAP center line | Exit remaining 50% qty; DB `scale_stage = 2`, `status = 'closed'`. | DB status query verification. |
| **TC-R4-04** | Stage 1 -> Stage 2 Transition via Breakeven SL | Active Stage 1 position, price drops to entry price | Exit remaining 50% qty at breakeven; DB `scale_stage = 2`, `status = 'closed'`. | DB status query verification. |
| **TC-R4-05** | SHORT Scale-Out Full State Machine | SHORT position active, price touches +1 SD mark then VWAP center | Stage 0 -> Stage 1 at +1 SD; Stage 1 -> Stage 2 at VWAP center. | State transition event tracking. |
| **TC-R4-06** | Fractional Share Accounting: Even Shares | $Q_{\text{initial}} = 100$, step = $1$ | $Q_{\text{partial}} = 50$, $Q_{\text{remaining}} = 50$; Sum = $100$ | Rounding math invariant check. |
| **TC-R4-07** | Fractional Share Accounting: Odd Shares | $Q_{\text{initial}} = 7$, step = $1$ | $Q_{\text{partial}} = 3$, $Q_{\text{remaining}} = 4$; Sum = $7$ | Zero-dust verification. |
| **TC-R4-08** | Fractional Stock Accounting: Decimal | $Q_{\text{initial}} = 10.55$, step = $0.01$ | $Q_{\text{partial}} = 5.27$, $Q_{\text{remaining}} = 5.28$; Sum = $10.55$ | Exact floating point equality. |
| **TC-R4-09** | Fractional Crypto Accounting: 8 Decimals | $Q_{\text{initial}} = 0.12345678$, step = $0.00000001$ | $Q_{\text{partial}} = 0.06172839$, $Q_{\text{remaining}} = 0.06172839$; Sum = $0.12345678$ | Micro-unit zero-dust assertion. |
| **TC-R4-10** | Single Share Minimum Handling | $Q_{\text{initial}} = 1$, step = $1$ | $Q_{\text{partial}} = 1$, $Q_{\text{remaining}} = 0$ (or non-fractional single share exit) | Graceful single-unit handling. |

---

## 4. Existing Codebase Audit & Gap Analysis

A comprehensive scan of the repository reveals the current state of implementation across key strategy and execution files:

| File Path | Current Status | Required Gaps / Changes Needed |
|---|---|---|
| `server/quantitative/vwapReversion.js` | Evaluates basic lower/upper 2 SD bands, RSI, Volume SMA, ATR | **Gaps**: Does NOT call ADX/Hurst filters (R1); lacks 10:15 AM ET session filter (R2); lacks target/ATR ratio squeeze validator (R3); does NOT calculate or export `scaleOutTarget` or 1 SD band levels (R4). |
| `server/quantitative/adx.js` | Fully implemented (`computeADX`, `isTrending`) | Ready for integration into `vwapReversion.js`. |
| `server/quantitative/hurst.js` | Fully implemented (`calculateHurst`, `classifyRegime`) | Ready for integration into `vwapReversion.js`. |
| `server/db/schema.js` | Defines `trades`, `ai_decisions`, `strategy_memory`, `system_state` | **Gaps**: Missing `scale_stage`, `scale_out_target`, and `remaining_qty` columns in `trades` table. |
| `server/db/tradeLogger.js` | Functions `logTrade`, `updateTradeOutcome`, `updateTradeStopLoss` | **Gaps**: Needs update to log scale-out initial values and helper `updateTradeScaleStage`. |
| `server/execution/tradeExecutor.js` | Handles sizing, validation, Alpaca submit, DB logging | **Gaps**: Needs to store `scaleOutTarget` and initial `remaining_qty` when executing trade. |
| `server/autonomous/riskMonitor.js` | Checks binary stopLoss/targetPrice and trails stop | **Gaps**: Lacks 2-stage scale-out state machine, 1 SD trigger check, breakeven SL ratcheting logic, and step-size fractional rounding math. |
| `test-all.js` | Master unit test runner for indicator functions | **Gaps**: Needs test cases for R1, R2, R3, R4. |
| `test-vwap-e2e.js` | Does not exist yet | **Gaps**: To be built in M3 E2E track to run full synthetic session simulations. |

---

## 5. Master Tier 1 Test Inventory (25+ Checks)

Below is the complete catalog of 25 Tier 1 test cases required to achieve full Feature Coverage verification:

```
[Tier 1 Master Test Catalog]
├── R1 Macro Regime Filter (5 cases)
│   ├── TC-R1-01: Strong ADX Trend Rejection (ADX >= 25)
│   ├── TC-R1-02: High Hurst Exponent Rejection (Hurst > 0.55)
│   ├── TC-R1-03: Dual ADX/Hurst Trend Rejection
│   ├── TC-R1-04: ADX Boundary Threshold Test (24.9 vs 25.0)
│   └── TC-R1-05: Hurst Boundary Threshold Test (0.550 vs 0.551)
├── R2 Time-of-Day Filter (5 cases)
│   ├── TC-R2-01: Market Open Bell Signal Rejection (09:30 ET)
│   ├── TC-R2-02: Mid-Open Volatility Signal Rejection (09:45 ET)
│   ├── TC-R2-03: Pre-Cutoff Boundary Rejection (10:14:59 ET)
│   ├── TC-R2-04: Cutoff Boundary Signal Pass (10:15:00 ET)
│   └── TC-R2-05: Afternoon Session Signal Pass (14:30 ET)
├── R3 VWAP Band Squeeze Check (5 cases)
│   ├── TC-R3-01: Severe Band Squeeze Rejection (Ratio 0.50)
│   ├── TC-R3-02: Moderate Squeeze Rejection (Ratio 1.20)
│   ├── TC-R3-03: Boundary Squeeze Rejection (Ratio 1.50)
│   ├── TC-R3-04: Adequate Band Width Pass (Ratio 1.80)
│   └── TC-R3-05: High Volatility Band Expansion Pass (Ratio 3.50)
└── R4 Autonomous Scale-Out & Fractional Rounding Engine (10 cases)
    ├── TC-R4-01: Signal Object Export of scaleOutTarget (1 SD mark)
    ├── TC-R4-02: LONG Position Stage 0 -> Stage 1 Transition (1 SD Touch)
    ├── TC-R4-03: LONG Position Stage 1 -> Stage 2 Transition (VWAP Center Touch)
    ├── TC-R4-04: LONG Position Stage 1 -> Stage 2 Transition (Breakeven SL Breach)
    ├── TC-R4-05: SHORT Position Full Scale-Out State Cycle
    ├── TC-R4-06: Fractional Math: Even Shares (Q=100, step=1)
    ├── TC-R4-07: Fractional Math: Odd Shares (Q=7, step=1)
    ├── TC-R4-08: Fractional Math: Decimal Stock Shares (Q=10.55, step=0.01)
    ├── TC-R4-09: Fractional Math: High Precision Crypto (Q=0.12345678, step=0.00000001)
    └── TC-R4-10: Fractional Math: Single Unit Minimum (Q=1, step=1)
```

---

## 6. Self-Verification & Independent Test Commands

To independently verify this analysis and future test suites:
1. **Module Load Verification**:
   ```bash
   node -e "require('./server/quantitative/vwapReversion'); require('./server/quantitative/adx'); require('./server/quantitative/hurst'); console.log('Modules loaded successfully');"
   ```
2. **Master Test Suite Execution**:
   ```bash
   node test-all.js
   ```
3. **Synthetic E2E Test Suite Execution**:
   ```bash
   node test-vwap-e2e.js
   ```

---

## 7. Conclusion

The specification and test contracts defined herein provide complete, deterministic criteria for Tier 1 feature coverage. Implementing these contracts will ensure that AI Trader correctly rejects trending and open-market volatility signals, avoids tight-spread trades, and executes multi-stage scale-out position management with mathematical precision.
