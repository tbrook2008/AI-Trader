# Handoff Report: Trade Executor & Rounding Utilities (Milestone 2 - R4)

**Agent**: `teamwork_preview_explorer_m2_2`  
**Role**: Explorer  
**Target Subsystem**: `server/execution/tradeExecutor.js`, `server/db/tradeLogger.js`, `server/db/schema.js`, `server/utils/rounding.js`  
**Handoff Type**: Hard (Task Complete)

---

## 1. Observation

### 1.1 Source Files Inspected
1. `/Users/tbrook/Desktop/AI Trader/server/execution/tradeExecutor.js` (lines 52, 92–104, 166–176):
   - Line 52: `const signal = vwapReversion.evaluate(history);`
   - Line 166: `logTrade` call currently omits `scaleOutTarget`:
     ```javascript
     const tradeId = logTrade({
       symbol,
       direction,
       qty:            sizing.qty,
       entryPrice:     price,
       stopLoss:       parseFloat(atrStop.toFixed(4)),
       targetPrice:    parseFloat(atrTarget.toFixed(4)),
       alpacaOrderId:  order.orderId,
       decisionId:     strategy,
       mode,
     });
     ```
2. `/Users/tbrook/Desktop/AI Trader/server/db/schema.js` (lines 43–60):
   - Table `trades` currently has 16 columns: `id`, `timestamp`, `symbol`, `direction`, `qty`, `entry_price`, `stop_loss`, `target_price`, `alpaca_order_id`, `status`, `exit_price`, `pnl`, `hmac`, `prev_hmac`, `decision_id`, `mode`.
   - Missing columns: `scale_stage`, `scale_out_target`, `remaining_qty`.
3. `/Users/tbrook/Desktop/AI Trader/server/db/tradeLogger.js` (lines 37–68):
   - `logTrade` function does not record `scaleOutTarget`, `remaining_qty`, or `scale_stage` in SQLite or in `tradeData` HMAC computation string.
4. `/Users/tbrook/Desktop/AI Trader/server/quantitative/vwapReversion.js`:
   - `evaluate()` generates a signal object containing `scaleOutTarget` (the 1 SD mark).
5. `/Users/tbrook/Desktop/AI Trader/server/execution/alpacaClient.js` (lines 106–109):
   - Market orders accept string quantities (`orderParams.qty = qty.toString()`), supporting fractional shares.

---

## 2. Logic Chain

1. **Trade Entry & Log Initialization**:
   - `vwapReversion.evaluate()` produces `signal.scaleOutTarget`.
   - `tradeExecutor.js` evaluates position size `sizing.qty` ($Q_{\text{initial}}$).
   - Passing `scaleOutTarget` into `logTrade()` allows `tradeLogger.js` to write `scale_out_target` into the database.
   - Setting `remaining_qty = sizing.qty` and `scale_stage = 0` on insertion establishes the baseline state for the `riskMonitor.js` active position scale-out state machine.

2. **Database Integrity & Security Chain**:
   - Adding `scaleOutTarget` to `tradeData` before calculating SHA256 HMAC guarantees that scale targets cannot be tampered with post-insertion without invalidating the HMAC chain.

3. **Dust-Free Rounding Precision**:
   - Standard rounding algorithms independently applied to $Q / 2$ suffer from under-selling or over-selling due to rounding direction or floating-point IEEE 754 precision artifacts (e.g. `5.1234 - 2.5617 = 2.5617000000000004`).
   - Defining $Q_{\text{partial}} = \text{roundToStep}(Q_{\text{initial}} / 2, \text{stepSize})$ and $Q_{\text{remaining}} = \text{normalizePrecision}(Q_{\text{initial}} - Q_{\text{partial}}, \text{precision})$ mathematically forces $Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$.
   - This identity guarantees zero position dust remaining in portfolio when both stages complete.

---

## 3. Caveats

1. **Alpaca Step Sizes**: Alpaca fractional share step sizes vary by asset class (US equities vs Crypto). Defaulting `stepSize = 1` for equities and `0.0001` or `0.00000001` for crypto is recommended unless dynamic asset step size querying is added.
2. **Single-Share Positions**: When $Q_{\text{initial}} = 1$ and `stepSize = 1`, $Q_{\text{partial}} = 1$ and $Q_{\text{remaining}} = 0$. Stage 1 scale-out will close 100% of the single share position at the 1 SD mark.
3. **Read-Only Scope**: This report is produced under read-only investigation rules. Implementation must be performed by the implementer agent.

---

## 4. Conclusion

1. **Trade Executor Setup**: Update `tradeExecutor.js` to extract `signal.scaleOutTarget` and supply it to `logTrade()`.
2. **Trade Logger & Schema Setup**: Add `scale_stage`, `scale_out_target`, and `remaining_qty` to `schema.js`. Modify `logTrade()` in `tradeLogger.js` to record `remaining_qty = qty`, `scale_stage = 0`, and `scale_out_target = scaleOutTarget`.
3. **Rounding Module**: Create `server/utils/rounding.js` exporting `getPrecision`, `roundToStep`, and `calculateScaleOutQty`.

---

## 5. Verification Method

### 5.1 Step Size & Rounding Unit Verification
Run Node.js assertions on the proposed `server/utils/rounding.js`:
```bash
node -e "
const { calculateScaleOutQty, roundToStep } = require('./server/utils/rounding');
const assert = require('assert');

// Case 1: Odd integer
const res1 = calculateScaleOutQty(5, 1);
assert.strictEqual(res1.Q_partial, 3);
assert.strictEqual(res1.Q_remaining, 2);
assert.strictEqual(res1.Q_partial + res1.Q_remaining, 5);

// Case 2: Fractional stock
const res2 = calculateScaleOutQty(10.55, 0.01);
assert.strictEqual(res2.Q_partial, 5.28);
assert.strictEqual(res2.Q_remaining, 5.27);
assert.strictEqual(res2.Q_partial + res2.Q_remaining, 10.55);

// Case 3: High precision crypto
const res3 = calculateScaleOutQty(1.5555, 0.0001);
assert.strictEqual(res3.Q_partial, 0.7778);
assert.strictEqual(res3.Q_remaining, 0.7777);
assert.strictEqual(res3.Q_partial + res3.Q_remaining, 1.5555);

console.log('✅ Rounding utility verification passed!');
"
```

### 5.2 Database Insertion Verification
Run dry-run trade logging test to verify DB fields:
```bash
node -e "
const { initDb, getDb } = require('./server/db/schema');
const { logTrade, getOpenTradeBySymbol } = require('./server/db/tradeLogger');
initDb();

const tradeId = logTrade({
  symbol: 'TEST/USD',
  direction: 'LONG',
  qty: 10.5,
  entryPrice: 100,
  stopLoss: 95,
  targetPrice: 110,
  scaleOutTarget: 105,
  alpacaOrderId: 'mock-123',
  decisionId: 'VWAP Test',
  mode: 'paper'
});

const row = getDb().prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
console.log('Logged trade row:', row);
if (row.scale_out_target === 105 && row.remaining_qty === 10.5 && row.scale_stage === 0) {
  console.log('✅ Database insertion verification passed!');
} else {
  console.error('❌ Database insertion verification failed');
}
"
```
