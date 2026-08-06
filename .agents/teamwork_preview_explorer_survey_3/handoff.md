# Handoff Report: Trade Execution & Active Position Management Analysis (R4)

**Agent**: `teamwork_preview_explorer_survey_3`  
**Working Directory**: `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_survey_3`  
**Date**: 2026-08-05  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

Direct code observations from the codebase investigation:

1. **Trade Executor Flow (`server/execution/tradeExecutor.js`)**:
   - `execute({ bundle })` at line 40 receives price and history bundle.
   - `getSymbolParams(symbol)` at line 16 checks parameter presence in `server/data/symbolParams.json`.
   - `vwapReversion.evaluate(history)` at line 52 generates trade signal.
   - `alpaca.getAccount()` and `alpaca.getOpenPositions()` called at line 75 via `Promise.all`.
   - `propRiskManager.calculatePositionSize(symbol, price, signal.stopLoss)` at line 94 determines fixed-risk trade quantity.
   - `validator.runChecks(...)` at line 111 verifies risk rules (drawdown, max position size, post-loss cooldown).
   - `DRY_RUN` check at line 143 exits before order submission when `process.env.DRY_RUN === 'true'`.
   - Market order placement at line 153: `alpaca.submitOrder({ symbol, qty: sizing.qty, side })`.
   - `logTrade(...)` at line 166 inserts record into SQLite `trades` table with `status = 'submitted'`.

2. **Alpaca SDK Integration (`server/execution/alpacaClient.js`)**:
   - Uses `@alpacahq/alpaca-trade-api` SDK v3.
   - Client instantiated at lines 15-19 with `paper: !isLive`.
   - `submitOrder` at lines 95-138 submits standard market order with `qty.toString()`. Native Alpaca bracket/OCO orders are not passed, delegating TP/SL to software monitoring.
   - `closePosition` at lines 62-89 converts symbol to stripped format (e.g. `BTCUSD`), fetches and cancels matching open orders, and calls `getClient().closePosition(alpacaSymbol)`.

3. **Position State Maintenance (`server/db/schema.js`, `server/db/tradeLogger.js`, `server/autonomous/riskMonitor.js`)**:
   - Position state is held in Alpaca broker API (`alpaca.getOpenPositions()`) and persisted in SQLite `trades` table (`schema.js:43-60`).
   - SQLite `trades` table columns: `id`, `timestamp`, `symbol`, `direction`, `qty`, `entry_price`, `stop_loss`, `target_price`, `alpaca_order_id`, `status`, `exit_price`, `pnl`, `hmac`, `prev_hmac`, `decision_id`, `mode`.
   - `riskMonitor.js:13-164` runs every 60 seconds (via `scheduler.js:19-25`), matches open positions to DB via `getOpenTradeBySymbol(symbol)`, ratchets trailing ATR stops via `updateTradeStopLoss`, and calls `alpaca.closePosition` for 100% liquidation when price crosses stop or target.
   - Currently, there is NO schema field or in-memory tracking structure for partial scale-out stages (`scale_stage`, `scale_out_target`, `remaining_qty`).

4. **VWAP Strategy Signal Generator (`server/quantitative/vwapReversion.js`)**:
   - `calculateVWAP(candles)` at lines 110-163 calculates `vwap`, `upperBand` (+2 SD), `lowerBand` (-2 SD), and standard deviation `sd`.
   - `evaluate(history)` at lines 170-226 triggers LONG on price $\le$ `lowerBand` and SHORT on price $\ge$ `upperBand`.
   - Currently returns `target: vwap` (center line) and `stopLoss: entry ± (1.5 * atr)`, but does NOT export `scaleOutTarget` (1 SD mark).

---

## 2. Logic Chain

1. **Observation 1 & 2** show that trade execution is currently a single-tranche market order flow. Once submitted, orders rely entirely on software monitoring in `riskMonitor.js` because native Alpaca bracket orders are bypassed to avoid bracket distance/fractional constraints.
2. **Observation 3** reveals that `riskMonitor.js` currently only checks binary 100% position exits (`stopLoss` vs `targetPrice`). It lacks intermediate state management for multi-stage scale-out.
3. **Observation 3 & 4** show that neither SQLite `trades` schema nor `vwapReversion.evaluate()` output currently includes the 1 StdDev scale-out target ($\text{VWAP} \pm 1 \sigma$) or scale stage indicators (`scale_stage = 0, 1, 2`).
4. Therefore, implementing R4 Autonomous Scale-Out requires a connected 3-part update:
   - Extend `vwapReversion.evaluate()` to calculate and return `scaleOutTarget` ($\text{VWAP} \pm 1 \sigma$).
   - Extend SQLite `trades` table schema and `tradeLogger.js` to persist `scale_stage`, `scale_out_target`, and `remaining_qty`.
   - Upgrade `riskMonitor.js` to execute a 3-state state machine: Stage 0 (Entry) $\rightarrow$ 1 SD hit $\rightarrow$ Stage 1 (50% partial market exit, update SL to breakeven $P_{\text{entry}}$) $\rightarrow$ VWAP center touch or breakeven SL breach $\rightarrow$ Stage 2 (Close remaining 50%).
   - Apply strict decimal precision math ($Q_{\text{partial}} + Q_{\text{remaining}} \equiv Q_{\text{initial}}$) to avoid fractional share/satoshi dust.

---

## 3. Caveats

- **No Source Code Modifications Made**: This investigation was strictly read-only per system prompt rules. No source files under `server/` were modified.
- **Alpaca Fractional Share API Variation**: Equity fractional share precision vs crypto step size vary across Alpaca endpoints. The implementation agent must verify specific step sizes for configured trading assets.

---

## 4. Conclusion

The current codebase has a well-structured execution pipeline and custom software risk monitor that is well-suited for R4 enhancement. Implementing R4 Autonomous Scale-Out requires updating `vwapReversion.js` to export the 1 SD band level, extending SQLite `trades` schema to track `scale_stage` and `scale_out_target`, and upgrading `riskMonitor.js` to manage partial exits and breakeven stop-loss adjustments.

Full technical details and design recommendations are documented in `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_survey_3/analysis.md`.

---

## 5. Verification Method

To verify these survey findings and test the future implementation:

1. **Inspect Analysis Artifacts**:
   - Review `/Users/tbrook/Desktop/AI Trader/.agents/teamwork_preview_explorer_survey_3/analysis.md`
   - Verify code references in `server/execution/tradeExecutor.js`, `server/execution/alpacaClient.js`, `server/autonomous/riskMonitor.js`, `server/quantitative/vwapReversion.js`.

2. **Run Test Suite**:
   ```bash
   cd "/Users/tbrook/Desktop/AI Trader"
   node test-all.js
   node test-full-cycle.js
   ```

3. **Invalidation Conditions**:
   - If Alpaca SDK v3 native bracket orders support partial scaling and fractional quantities natively for crypto, custom software risk monitoring would not be required. (Confirmed: Alpaca crypto REST API does not support native partial scale-out OCO brackets, validating our software state machine design).
