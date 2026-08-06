# Handoff Report: scaleOutTarget Export Requirement & Project Test Setup

**Agent**: teamwork_preview_explorer_m1_r1_3  
**Working Directory**: `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m1_r1_3`  
**Parent Orchestrator**: `f15b3436-d0e5-45b9-ae33-e17058e7a87f`  

---

## 1. Observation

### Codebase Observations
1. **`vwapReversion.js` (`server/quantitative/vwapReversion.js:157-163`)**:
   - `calculateVWAP(candles)` returns:
     ```javascript
     return {
         vwap: vwap,
         upperBand: vwap + sdMultiplier * sd,
         lowerBand: vwap - sdMultiplier * sd,
         sd: sd
     };
     ```
2. **`vwapReversion.evaluate(history)` (`server/quantitative/vwapReversion.js:203-222`)**:
   - Currently returns:
     - LONG signal: `{ action: 'LONG', entry: currentCandle.close, target: vwap, stopLoss: currentCandle.close - (slMultiplier * atr), metadata: { rsi, vwap, lowerBand, volume, volumeSMA, atr } }`
     - SHORT signal: `{ action: 'SHORT', entry: currentCandle.close, target: vwap, stopLoss: currentCandle.close + (slMultiplier * atr), metadata: { rsi, vwap, upperBand, volume, volumeSMA, atr } }`
   - Notice: Top-level property `scaleOutTarget` is missing, as are `upperBand1SD` and `lowerBand1SD` in `metadata`.

3. **Interface Contract (`PROJECT.md:46-67`)**:
   - Specifies `StrategySignal` interface:
     ```typescript
     interface StrategySignal {
       action: 'LONG' | 'SHORT';
       entry: number;
       target: number; // VWAP center line
       scaleOutTarget: number; // 1 StdDev mark (VWAP +/- 1 SD)
       stopLoss: number; // Entry +/- (1.5 * ATR)
       metadata: {
         rsi: number;
         vwap: number;
         upperBand: number;
         lowerBand: number;
         upperBand1SD: number;
         lowerBand1SD: number;
         volume: number;
         volumeSMA: number;
         atr: number;
         adx: number;
         hurst: number;
         sessionTimeET: string;
       };
     }
     ```

4. **Test Architecture & Execution (`test-all.js`, `package.json`)**:
   - Executing `node test-all.js` ran 32 assertion checks (31 passed, 1 failed).
   - Assertion failure: `❌ getPositionSize returns valid sizing object: Position should respect MAX_POSITION_PCT=6%` in `test-all.js:183`.
   - Cause: `server/risk/kellyCriterion.js:90` defaults `maxPct` to `0.10` ($10\%$) when environment variable `MAX_POSITION_PCT` is not explicitly set to `0.06`.
   - `package.json` contains CLI helper scripts (`test:data`, `test:db`, `test:kelly`, `test:ollama`, `dry-run`), but currently lacks a standard `"test": "node test-all.js"` entry in `scripts`.

---

## 2. Logic Chain

1. **Calculating `scaleOutTarget`**:
   - The strategy takes positions at outer band extremes ($\pm 2\text{SD}$).
   - Reversion target for full exit is the VWAP center line ($0\text{SD}$).
   - The 50% partial scale-out target corresponds to halfway reversion, i.e., the 1 Standard Deviation line ($1\text{SD}$).
   - For a **LONG position** (entered below VWAP at or near $-2\text{SD}$), price reverts UP toward VWAP. The halfway mark is $-1\text{SD}$, calculated as `vwapData.vwap - vwapData.sd`.
   - For a **SHORT position** (entered above VWAP at or near $+2\text{SD}$), price reverts DOWN toward VWAP. The halfway mark is $+1\text{SD}$, calculated as `vwapData.vwap + vwapData.sd`.
   - In both cases, standard deviation (`sd`) is already calculated and exported by `calculateVWAP()`.

2. **Project Test Setup Mapping**:
   - Pure Node.js environment (Node v22.15.0 runtime, CommonJS modules).
   - Core test suites:
     - `test-all.js`: Master unit test suite testing indicators, sizing, volume profile, symbol detection, and module load validation.
     - `test-full-cycle.js`: End-to-end integration flow runner.
     - `test-vwap-e2e.js`: Synthetic E2E runner for milestone verification.
     - `scratch/*.js`: Ad-hoc backtest & parameter analysis scripts.
   - Identified test issue: `test-all.js` requires `MAX_POSITION_PCT=0.06` to pass Kelly test, and `package.json` needs a `"test": "node test-all.js"` script.

---

## 3. Caveats

1. **Read-Only Scope**: As an Explorer agent, no changes were committed to source files or test files. Code changes must be performed by the Implementer agent.
2. **Environment Variable Dependency**: `test-all.js` failure on Kelly criterion is due to missing process env defaults in the test process.
3. **Additional M1 Filters**: Note that `vwapReversion.js` signal object will also need `adx`, `hurst`, and `sessionTimeET` in `metadata` as features R1 and R2 are integrated.

---

## 4. Conclusion

1. **`scaleOutTarget` Formula & Export**:
   - Export `scaleOutTarget` in strategy signal output:
     - LONG: `scaleOutTarget = vwapData.vwap - vwapData.sd`
     - SHORT: `scaleOutTarget = vwapData.vwap + vwapData.sd`
   - Include `upperBand1SD: vwapData.vwap + vwapData.sd` and `lowerBand1SD: vwapData.vwap - vwapData.sd` in signal `metadata`.
2. **Test Setup & Execution**:
   - Master test runner is `node test-all.js`.
   - Full integration runner is `node test-full-cycle.js`.
   - Synthetic E2E runner is `node test-vwap-e2e.js`.
   - Adding unit tests for `vwapReversion.evaluate` scaleOutTarget export to `test-all.js` will ensure automated coverage.

---

## 5. Verification Method

1. **Inspect Analysis Report**:
   - View `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m1_r1_3/analysis.md`
2. **Execute Test Suite**:
   - Run `node test-all.js` in `/Users/tbrook/Desktop/AI Trader` to observe current test suite output.
   - Run `MAX_POSITION_PCT=0.06 node test-all.js` to observe all 32 assertions passing.
