# Handoff Report: VWAP Strategy Signal Generation Analysis (R1, R2, R3)

## 1. Observation

Direct observations from codebase inspection of `/Users/tbrook/Desktop/AI Trader`:

1. **`vwapReversion.js` Implementation**:
   - Path: `server/quantitative/vwapReversion.js` (lines 167–226).
   - Entry points: `calculateVWAP(candles)` (lines 111–163) and `evaluate(history)` (lines 170–226).
   - Signal rules:
     - LONG: `currentCandle.close <= lowerBand` AND `rsi <= rsiOversold` (35) AND `currentCandle.volume >= 1.2 * volumeSMA`. Returns `{ action: 'LONG', entry: currentCandle.close, target: vwap, stopLoss: entry - 1.5 * atr, metadata: {...} }`.
     - SHORT: `currentCandle.close >= upperBand` AND `rsi >= rsiOverbought` (65) AND `currentCandle.volume >= 1.2 * volumeSMA`. Returns `{ action: 'SHORT', entry: currentCandle.close, target: vwap, stopLoss: entry + 1.5 * atr, metadata: {...} }`.
     - Returns `null` if history length < 21 or indicators evaluate to `null` or conditions fail.

2. **Existing Quantitative Indicators**:
   - `adx.js`: Path `server/quantitative/adx.js`. Contains `computeADX(history, period = 14)` (line 9) and `isTrending(history, period = 14, threshold = 25)` (line 81).
   - `hurst.js`: Path `server/quantitative/hurst.js`. Contains `calculateHurst(history)` (line 9) and `classifyRegime(history)` (line 79) where $H > 0.55 \implies \text{'trending'}$.
   - `atr.js`: Path `server/quantitative/atr.js`. Contains `calculateATR(history, period = 14)` (line 6) and `getDynamicATRMultiplier(history, baseMultiplier)` (line 33).
   - `bollingerRsi.js`, `hmm.js`, `kalman.js`, `ouModel.js`, `volumeProfile.js` are also available under `server/quantitative/`.

3. **Timestamp / Time Window Handling**:
   - Candle bars: `{ open, high, low, close, volume, timestamp }`.
   - `vwapReversion.js` lines 116–118 handle converting `timestamp` or `time` into epoch milliseconds.
   - Currently, `vwapReversion.evaluate()` has **no** session time checking. External session checks exist in `server/autonomous/loop.js` (lines 73–77) and `server/backtest.js` (lines 150–156).

4. **Regime and Band Squeeze Filters**:
   - Currently, `vwapReversion.js` does NOT integrate ADX, Hurst, or band squeeze width checks ($| \text{vwap} - \text{entry} | > 1.5 \times \text{ATR}$).

---

## 2. Logic Chain

1. **R1 (Macro Regime Filter)**:
   - Observation: `adx.js` defines `isTrending(history, 14, 25)` and `hurst.js` defines `calculateHurst(history)`.
   - Logic: To prevent mean-reversion entries in strong trending markets, `vwapReversion.evaluate()` should import `adx.js` / `hurst.js` and return `null` immediately whenever `adx >= 25` or `hurst > 0.55`.

2. **R2 (Time-of-Day Filtering)**:
   - Observation: Currently time filtering is in `loop.js` (`timeVal >= 945 ...`), but `evaluate()` lacks internal timestamp checking.
   - Logic: By converting `currentCandle.timestamp` to US Eastern Time (`America/New_York`) inside `vwapReversion.evaluate()`, we can check `timeVal = hours * 100 + minutes`. If `timeVal < 1015` (10:15 AM ET), `evaluate()` will return `null`.

3. **R3 (VWAP Band Squeeze Check)**:
   - Observation: Signal entry is `close` and target is `vwap`. `atr` is already calculated inside `evaluate()`.
   - Logic: Squeeze condition is satisfied when distance to target is less than $1.5 \times \text{ATR}$ (`Math.abs(vwap - close) <= 1.5 * atr`). Adding this check before returning a signal object filters out low-reward setups when bands tighten.

4. **Contract Preservation**:
   - Logic: Maintaining `evaluate(history)` signature and returning `{ action: 'LONG'|'SHORT', entry, target, stopLoss, metadata }` or `null` ensures 100% backward compatibility with `tradeExecutor.js` and `backtest.js`.

---

## 3. Caveats

1. **History Warm-up Length**:
   - ADX requires at least $2 \times \text{period} + 1 = 29$ bars for proper smoothing. `evaluate()` should increase minimum history requirement from 21 bars to 30 bars.
2. **Crypto vs Stock Session Hours**:
   - Crypto trades 24/7. If R2 session time filter (10:15 AM ET) is applied unconditionally, crypto signals before 10:15 AM ET will also be filtered. If crypto needs 24/7 signals, symbol check `isCryptoSymbol(symbol)` can bypass the R2 ET time filter for crypto pairs.
3. **Timezone Conversion Performance**:
   - `toLocaleString('en-US', { timeZone: 'America/New_York' })` handles EST/EDT daylight saving automatically, but string formatting adds a tiny microsecond overhead per bar evaluation.

---

## 4. Conclusion

The current implementation of `vwapReversion.js` provides a clear, well-structured foundation. Integrating Requirements R1, R2, and R3 requires clean, modular additions directly inside `server/quantitative/vwapReversion.js`:
- **R1**: Incorporate `adx.js` / `hurst.js` check to reject trending regimes ($ADX \ge 25$ or $H > 0.55$).
- **R2**: Incorporate ET timezone check to reject bars prior to 10:15 AM ET (`timeVal < 1015`).
- **R3**: Incorporate minimum target distance check ($| \text{vwap} - \text{entry} | > 1.5 \times \text{ATR}$).

---

## 5. Verification Method

1. **Inspect Analysis Report**:
   - View `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_survey_2/analysis.md`.

2. **Run Test Suite**:
   - Execute command: `node test-all.js`
   - All unit tests for quantitative indicators should pass cleanly.

3. **Verify Signal Functionality**:
   - Run: `node scratch/test_vwap.js`
   - Observe bar fetching and VWAP band calculation behavior.
