# Technical Analysis: Database Schema & Trade Logger Engine for Scale-Out (R4)

**Agent**: `teamwork_preview_explorer_m2_1`  
**Milestone**: Milestone 2 — Autonomous Scale-Out & Position Management Engine (R4)  
**Date**: 2026-08-05  

---

## 1. Executive Summary

Milestone 2 requires upgrading the `AI Trader` position management architecture to autonomously manage dynamic scale-out positions. Specifically, section **R4** demands tracking position scale stages, scale-out target prices (1 Standard Deviation mark), and remaining quantities in the persistence layer.

This investigation evaluates:
1. Addition of SQLite columns `scale_stage` (`INTEGER DEFAULT 0`), `scale_out_target` (`REAL`), and `remaining_qty` (`REAL`) to the `trades` table in `server/db/schema.js`.
2. Safe runtime schema migration strategy for existing SQLite databases (`trader.sqlite`).
3. Updates to trade logging functions in `server/db/tradeLogger.js` (`logTrade`, `updateTradeOutcome`, `updateTradeStopLoss`, and new scale-out update helpers).
4. Maintenance of HMAC cryptographic hash chain integrity and backward compatibility across existing tests and consumers (`tradeExecutor.js`, `riskMonitor.js`).

---

## 2. Current Codebase Assessment

### 2.1 Database Schema (`server/db/schema.js`)
Currently, `initDb()` executes table creation SQL (lines 43–60 of `server/db/schema.js`):
```sql
CREATE TABLE IF NOT EXISTS trades (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp        TEXT    NOT NULL,
  symbol           TEXT    NOT NULL,
  direction        TEXT    NOT NULL,
  qty              REAL    NOT NULL,
  entry_price      REAL,
  stop_loss        REAL,
  target_price     REAL,
  alpaca_order_id  TEXT,
  status           TEXT    NOT NULL DEFAULT 'submitted',
  exit_price       REAL,
  pnl              REAL,
  hmac             TEXT    NOT NULL,
  prev_hmac        TEXT    NOT NULL,
  decision_id      INTEGER,
  mode             TEXT    NOT NULL DEFAULT 'paper'
);
```

**Deficiencies**:
- `CREATE TABLE IF NOT EXISTS` only runs when creating a brand-new table. If an existing `trader.sqlite` file is present on disk, calling `initDb()` will not add missing columns (`scale_stage`, `scale_out_target`, `remaining_qty`).
- No migration logic currently exists in `schema.js`.

### 2.2 Trade Logger (`server/db/tradeLogger.js`)
Currently, `logTrade` (lines 37–68) inserts records into `trades`:
```javascript
function logTrade({ symbol, direction, qty, entryPrice, stopLoss, targetPrice, alpacaOrderId, decisionId, mode }) {
  // ...
  const tradeData = JSON.stringify({ timestamp, symbol, direction, qty, entryPrice, stopLoss, alpacaOrderId });
  const hmac = createHmac(prevHmac + tradeData);
  // ...
}
```

**Deficiencies**:
- `logTrade` does not receive or persist `scale_stage`, `scale_out_target`, or `remaining_qty`.
- `updateTradeOutcome` only updates `exit_price`, `pnl`, and `status`. It cannot update `scale_stage` or `remaining_qty` when partial scale-out exits occur.
- No helper function exists in `tradeLogger.js` to handle Stage 0 $\rightarrow$ Stage 1 partial scale-out transitions (where `scale_stage` updates to 1, `remaining_qty` decreases, and `stop_loss` ratchets to breakeven).

---

## 3. Recommended Design & Implementation Specification

### 3.1 Schema Definition & Migration Specification (`server/db/schema.js`)

1. **Table Definition Update**:
   Update `CREATE TABLE IF NOT EXISTS trades` to include the three new columns:
   - `scale_stage INTEGER DEFAULT 0`
   - `scale_out_target REAL`
   - `remaining_qty REAL`

2. **Idempotent Migration Helper (`migrateSchema`)**:
   Implement a migration routine in `schema.js` using SQLite `PRAGMA table_info(trades)` to detect and apply missing column migrations safely without crashing on existing databases:

```javascript
function migrateSchema(db) {
  const columns = db.prepare("PRAGMA table_info(trades)").all().map(c => c.name);

  if (!columns.includes('scale_stage')) {
    db.exec('ALTER TABLE trades ADD COLUMN scale_stage INTEGER DEFAULT 0');
    logger.info('Migrated schema: added scale_stage column to trades');
  }

  if (!columns.includes('scale_out_target')) {
    db.exec('ALTER TABLE trades ADD COLUMN scale_out_target REAL');
    logger.info('Migrated schema: added scale_out_target column to trades');
  }

  if (!columns.includes('remaining_qty')) {
    db.exec('ALTER TABLE trades ADD COLUMN remaining_qty REAL');
    logger.info('Migrated schema: added remaining_qty column to trades');
  }

  // Backfill existing trade rows where remaining_qty is unpopulated
  db.exec('UPDATE trades SET remaining_qty = qty WHERE remaining_qty IS NULL');
}
```

In `initDb()`:
```javascript
function initDb() {
  const db = getDb();
  db.exec(`... CREATE TABLE IF NOT EXISTS trades ...`);
  migrateSchema(db);
  // ... seed system state ...
  return db;
}
```

---

### 3.2 Trade Logger Specification (`server/db/tradeLogger.js`)

#### A. Updated `logTrade`
Modify `logTrade` to accept optional scale-out parameters:
- `scaleOutTarget` (REAL, default `null`)
- `scaleStage` (INTEGER, default `0`)
- `remainingQty` (REAL, default `qty`)

```javascript
function logTrade({
  symbol, direction, qty, entryPrice, stopLoss, targetPrice,
  scaleOutTarget, scaleStage = 0, remainingQty,
  alpacaOrderId, decisionId, mode
}) {
  const db = getDb();
  const timestamp = new Date().toISOString();
  const prevHmac = getState('last_hmac');

  const initialScaleStage = scaleStage ?? 0;
  const initialRemainingQty = remainingQty ?? qty;

  const tradeData = JSON.stringify({
    timestamp, symbol, direction, qty, entryPrice, stopLoss,
    scaleOutTarget, remainingQty: initialRemainingQty, alpacaOrderId
  });
  const hmac = createHmac(prevHmac + tradeData);

  const stmt = db.prepare(`
    INSERT INTO trades
      (timestamp, symbol, direction, qty, entry_price, stop_loss, target_price,
       scale_stage, scale_out_target, remaining_qty,
       alpaca_order_id, status, hmac, prev_hmac, decision_id, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)
  `);

  const result = stmt.run(
    timestamp, symbol, direction, qty,
    entryPrice ?? null, stopLoss ?? null, targetPrice ?? null,
    initialScaleStage, scaleOutTarget ?? null, initialRemainingQty,
    alpacaOrderId ?? null, hmac, prevHmac,
    decisionId ?? null, mode || 'paper'
  );

  setState('last_hmac', hmac);
  const total = parseInt(getState('total_trades') || '0') + 1;
  setState('total_trades', total);

  logger.info('Trade logged with scale-out parameters', {
    id: result.lastInsertRowid, symbol, direction, qty, scaleOutTarget, remainingQty: initialRemainingQty, scaleStage: initialScaleStage
  });

  return result.lastInsertRowid;
}
```

#### B. Dedicated Scale-Out Update Helper (`updateTradeScaleOut`)
Add a clean helper function for position state transitions:

```javascript
function updateTradeScaleOut({ tradeId, scaleStage, remainingQty, stopLoss }) {
  const db = getDb();
  if (stopLoss !== undefined && stopLoss !== null) {
    db.prepare('UPDATE trades SET scale_stage = ?, remaining_qty = ?, stop_loss = ? WHERE id = ?')
      .run(scaleStage, remainingQty, stopLoss, tradeId);
  } else {
    db.prepare('UPDATE trades SET scale_stage = ?, remaining_qty = ? WHERE id = ?')
      .run(scaleStage, remainingQty, tradeId);
  }
  logger.info('Trade scale-out state updated', { tradeId, scaleStage, remainingQty, stopLoss });
}
```

#### C. Enhanced `updateTradeOutcome`
Update `updateTradeOutcome` to allow optionally passing `scaleStage` and `remainingQty` on exit:

```javascript
function updateTradeOutcome({ tradeId, exitPrice, pnl, status, scaleStage, remainingQty }) {
  const db = getDb();
  
  if (scaleStage !== undefined || remainingQty !== undefined) {
    db.prepare(`
      UPDATE trades 
      SET exit_price = ?, pnl = ?, status = ?,
          scale_stage = COALESCE(?, scale_stage),
          remaining_qty = COALESCE(?, remaining_qty)
      WHERE id = ?
    `).run(exitPrice ?? null, pnl ?? null, status, scaleStage ?? null, remainingQty ?? null, tradeId);
  } else {
    db.prepare('UPDATE trades SET exit_price = ?, pnl = ?, status = ? WHERE id = ?')
      .run(exitPrice ?? null, pnl ?? null, status, tradeId);
  }

  // Update daily PnL and win/loss records ...
}
```

---

## 4. Operational Risk & Compatibility Analysis

1. **HMAC Integrity Chain Compatibility**:
   - The HMAC chain (`prev_hmac` $\rightarrow$ `hmac` $\rightarrow$ `last_hmac`) is anchored by `system_state.last_hmac`.
   - Existing trades in SQLite retain their `hmac` values.
   - Adding `scaleOutTarget` and `remainingQty` to the hashed `tradeData` payload for *new* trades preserves full cryptographic chain security while enriching signed metadata.

2. **Backward Compatibility**:
   - Existing callers (`tradeExecutor.js`, `riskMonitor.js`, test mocks) that invoke `logTrade` without `scaleStage` or `remainingQty` will default cleanly: `scaleStage = 0`, `remainingQty = qty`.
   - `getOpenTradeBySymbol` uses `SELECT * FROM trades`, so returning objects will automatically expose `trade.scale_stage`, `trade.scale_out_target`, and `trade.remaining_qty`.

3. **Database Performance**:
   - `PRAGMA table_info(trades)` runs in $< 1 \text{ ms}$ during `initDb()`.
   - SQLite table schema modifications (`ALTER TABLE ADD COLUMN`) operate instantly on SQLite tables without requiring table rewrites.

---

## 5. Verification & Test Plan

A dedicated test suite should verify:
1. `initDb()` creates the table with all required columns on fresh databases.
2. `migrateSchema()` accurately applies missing columns on existing databases and backfills `remaining_qty = qty`.
3. `logTrade` correctly persists `scale_stage` (0), `scale_out_target`, and `remaining_qty`.
4. `updateTradeScaleOut` updates `scale_stage` to 1, updates `remaining_qty`, and ratchets `stop_loss`.
5. `updateTradeOutcome` updates `status`, `scale_stage` (2), `remaining_qty` (0), and `pnl`.
