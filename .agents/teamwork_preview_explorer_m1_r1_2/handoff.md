# Handoff Report: R2 Time-of-Day Filter & R3 VWAP Band Squeeze Validator

**Agent:** `teamwork_preview_explorer_m1_r1_2`  
**Target File:** `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`  
**Working Directory:** `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m1_r1_2`  

---

## 1. Observation

1. **Candle Timestamps in History**:
   - `server/data/dataAggregator.js` line 103 emits ISO 8601 strings (`new Date().toISOString()`).
   - `server/backtest.js` lines 63 & 77 populate `b.Timestamp` from Alpaca REST API.
   - `server/quantitative/vwapReversion.js` lines 116 & 130 access timestamp as `candles[i].timestamp || candles[i].time`.
   - String ISO timestamps, Unix epoch numbers (milliseconds or seconds), and Date objects are present across data sources.

2. **Current `vwapReversion.evaluate(history)` Flow**:
   - `server/quantitative/vwapReversion.js` lines 170-226 calculate VWAP, RSI(14), Volume SMA(20), and ATR(14).
   - Currently, there is NO check for candle time of day (opening bell filter before 10:15 AM ET is absent).
   - Currently, there is NO check for minimum band width / VWAP target distance vs ATR (band squeeze validator is absent).

3. **Timezone & Threshold**:
   - Requirement R2 requires parsing candle timestamp into US Eastern Time (`America/New_York`) and returning `null` before 10:15 AM ET.
   - Node.js native `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false })` correctly formats US Eastern Time across Daylight Saving (EDT, UTC-4) and Standard Time (EST, UTC-5).
   - 10:15 AM ET corresponds to 615 total minutes from midnight ET (`hour * 60 + minute`).

4. **Squeeze Check Formula**:
   - Requirement R3 requires `Math.abs(vwap - close) > 1.5 * atr`. If `Math.abs(vwap - close) <= 1.5 * atr`, return `null`.
   - `vwap` is available from `vwapData.vwap`.
   - `close` is available from `currentCandle.close`.
   - `atr` is available from `calculateATR(history, 14)`.

---

## 2. Logic Chain

1. **Observation 1 → Step 1**: Since candle timestamps vary in representation (`timestamp` or `time`; ISO string, unix ms, unix sec), the timestamp extractor must normalize `currentCandle.timestamp || currentCandle.time` into millisecond epoch time before parsing.
2. **Observation 3 → Step 2**: Converting millisecond epoch time to `America/New_York` using `Intl.DateTimeFormat` yields exact ET hour and minute. Total ET minutes from midnight is computed as `hour * 60 + minute`. If `totalMinutes < 615` (10:15 AM ET), the market is in morning open volatility. The function must return `null` immediately.
3. **Observation 2 & 4 → Step 3**: For any valid candle at or after 10:15 AM ET (`totalMinutes >= 615`), indicators (`vwapData`, `rsi`, `volumeSMA`, `atr`) are computed.
4. **Observation 4 → Step 4**: The distance between current price (`close`) and VWAP target is $D = | \text{vwap} - \text{close} |$. The minimum risk distance for stop loss is $1.5 \times \text{ATR}$. To ensure Reward > Risk, if $D \le 1.5 \times \text{ATR}$, a squeeze condition is detected and the strategy must return `null`.

---

## 3. Caveats

- If a synthetic test fixture passes candles without any `timestamp` or `time` property, `parseETTime` returns `null`. In production and requirement-driven testing, timestamp is mandatory. For test fixtures, candles must include a valid timestamp at or after 10:15 AM ET to produce signals.
- Standard market hours are 09:30 AM to 04:00 PM ET. The 10:15 AM ET cutoff filters out the first 45 minutes of trading.

---

## 4. Conclusion

- **R2 Time-of-Day Filter**: Must be placed at the entry of `vwapReversion.evaluate(history)`. Parse `currentCandle.timestamp || currentCandle.time` to `America/New_York` using `Intl.DateTimeFormat`. If total ET minutes < 615 (10:15 AM ET), return `null`. Populates `metadata.sessionTimeET` in output.
- **R3 VWAP Band Squeeze Validator**: Must be placed after `vwapData` and `atr` are calculated. If `Math.abs(vwap - currentCandle.close) <= 1.5 * atr`, return `null`.

---

## 5. Verification Method

Run the following standalone verification script via Node:

```bash
node -e "
const { evaluate } = require('./server/quantitative/vwapReversion');

// Test 1: R2 filter rejects signal before 10:15 AM ET
// Test 2: R3 filter rejects signal when Math.abs(vwap - close) <= 1.5 * atr
"
```

Detailed test cases and validation results are documented in `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_m1_r1_2/analysis.md`.
