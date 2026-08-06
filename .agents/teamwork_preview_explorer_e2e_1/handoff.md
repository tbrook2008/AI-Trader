# Handoff Report: Tier 1 Feature Coverage Interface & Test Criteria Definition
**Agent**: `teamwork_preview_explorer_e2e_1`  
**Track**: E2E Testing Track  
**Working Directory**: `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_e2e_1`  
**Target Output**: `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_e2e_1/analysis.md`

---

## 1. Observation

Direct code and specification observations made during investigation:

- **Specification Documents**:
  - `ORIGINAL_REQUEST.md`: Defines four core strategy requirements:
    - R1: Macro Regime Filter (disable signals when market is in strong directional trend, ADX / Hurst).
    - R2: Session filtering (ignore signals before 10:15 AM ET).
    - R3: VWAP Band Squeeze Check (target price - entry price > 1.5 * ATR).
    - R4: Autonomous Position Management (50% scale-out at 1 SD band, SL to breakeven, 50% target at VWAP center, fractional share rounding).
  - `PROJECT.md`: Lines 42-67 define `vwapReversion.evaluate(history)` signature and return interface `StrategySignal`; lines 70-85 define DB schema additions (`scale_stage`, `scale_out_target`, `remaining_qty`) and risk monitor state machine transitions.
  - `TEST_INFRA.md`: Lines 7-25 outline Tier 1-4 test matrix and test goals (>= 5 test cases per feature for Tier 1, total 25+ cases).

- **Codebase Files**:
  - `server/quantitative/vwapReversion.js`:
    - Line 170: `evaluate(history)` currently calculates VWAP (line 178), RSI (line 181), Volume SMA (line 184), ATR (line 187).
    - Line 201: LONG signal requires `currentCandle.close <= lowerBand && rsi <= rsiOversold && isHighVolume`.
    - Line 215: SHORT signal requires `currentCandle.close >= upperBand && rsi >= rsiOverbought && isHighVolume`.
    - **Observed Gap**: Does NOT call `computeADX` or `calculateHurst` (R1 missing); does NOT check timestamp against 10:15 AM ET (R2 missing); does NOT check band squeeze ratio $> 1.50$ (R3 missing); does NOT calculate or export `scaleOutTarget` (1 SD mark) in signal return object (R4 missing).
  - `server/quantitative/adx.js`:
    - Line 81: Exports `computeADX(history, period)` and `isTrending(history, period, threshold)`.
  - `server/quantitative/hurst.js`:
    - Line 86: Exports `calculateHurst(history)` and `classifyRegime(history)`.
  - `server/db/schema.js`:
    - Line 43: Table `trades` currently has `id`, `timestamp`, `symbol`, `direction`, `qty`, `entry_price`, `stop_loss`, `target_price`, `alpaca_order_id`, `status`, `exit_price`, `pnl`, `hmac`, `prev_hmac`, `decision_id`, `mode`.
    - **Observed Gap**: Lacks `scale_stage`, `scale_out_target`, and `remaining_qty`.
  - `server/db/tradeLogger.js`:
    - Lines 37-68: `logTrade` inserts initial trade. Lacks logging for `scale_out_target` and `remaining_qty`. Lacks helper function `updateTradeScaleStage`.
  - `server/autonomous/riskMonitor.js`:
    - Lines 103-109: Checks simple binary triggers (`STOP_LOSS`, `TAKE_PROFIT`).
    - **Observed Gap**: Lacks 2-stage scale-out logic, 1 SD mark detection, SL breakeven ratcheting, and fractional step-size rounding math.

---

## 2. Logic Chain

1. **Requirement Mapping to Signal Generation**:
   - R1 requires rejecting signals when ADX >= 25 or Hurst > 0.55. In `vwapReversion.evaluate`, calculating ADX and Hurst on `history` and returning `null` when either threshold is exceeded strictly satisfies R1.
   - R2 requires ignoring signals prior to 10:15 AM ET. Parsing candle timestamps into `America/New_York` timezone and returning `null` if time < 10:15 AM ET satisfies R2.
   - R3 requires target distance $|\text{VWAP} - P_{\text{entry}}| > 1.5 \times \text{ATR}$. Rejecting when distance $\le 1.5 \times \text{ATR}$ satisfies R3.

2. **Requirement Mapping to Autonomous Position State Machine**:
   - R4 requires a 2-stage state transition:
     - Stage 0 -> Stage 1: Triggered when market price touches `scaleOutTarget` (VWAP $\mp$ 1 SD). $Q_{\text{partial}}$ is submitted, `scale_stage` is updated to 1, `remaining_qty` is updated to $Q_{\text{initial}} - Q_{\text{partial}}$, and `stop_loss` is updated to `entry_price`.
     - Stage 1 -> Stage 2: Triggered when market price reaches `target_price` (VWAP center line) OR breaches breakeven `stop_loss`. $Q_{\text{remaining}}$ is submitted, `scale_stage` is set to 2, `remaining_qty` is 0, and `status` is `'closed'`.

3. **Fractional Share Rounding Math**:
   - To prevent fractional share dust on partial exit, $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} \times 0.5, \text{stepSize})$ and $Q_{\text{remaining}} = Q_{\text{initial}} - Q_{\text{partial}}$. The invariant $Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$ guarantees exact share accounting.

4. **Tier 1 Test Vector Selection**:
   - Constructing 5 explicit test cases per requirement (and 10 for R4 state machine + fractional rounding) guarantees full Tier 1 feature coverage ($25+$ total cases), meeting the goals in `TEST_INFRA.md`.

---

## 3. Caveats

- **Timezone Environment Handling**: Test suites must explicitly pass timestamps in ISO format or handle `America/New_York` timezone offsets consistently regardless of local host timezone.
- **Historical Candle Depth**: ADX requires at least 28 bars (`period * 2`), and Hurst requires at least 30 bars. Test input arrays for `vwapReversion.evaluate` must contain at least 30 valid candle objects.
- **Implementation Scope**: This report defines the interfaces, criteria, and gap analysis (read-only exploration). Production code changes to `vwapReversion.js`, `schema.js`, and `riskMonitor.js` are delegated to the Implementer subagent in Milestone M1 / M2.

---

## 4. Conclusion

The specification analysis is complete and documented in `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_e2e_1/analysis.md`. Exact data structures, parameter types, state transitions, and a complete catalog of 25 Tier 1 test cases (TC-R1-01 through TC-R4-10) have been defined to guide implementers and test authors.

---

## 5. Verification Method

To independently verify the findings and analysis in this report:

1. **Verify Report Files Exist and contain expected sections**:
   ```bash
   cat "/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_e2e_1/analysis.md"
   ```
2. **Verify Codebase Gap Observations**:
   - Check `server/quantitative/vwapReversion.js` to confirm ADX/Hurst, session time, band squeeze, and 1 SD scale target are not yet called.
   - Check `server/db/schema.js` to confirm `scale_stage` columns are currently missing.
3. **Run Existing Test Suite**:
   ```bash
   node test-all.js
   ```
