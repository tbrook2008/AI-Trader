require('dotenv').config();
const crypto = require('crypto');
const https = require('https');
const { getDb, getState, setState } = require('./schema');
const logger = require('../utils/logger');

function pushToSupabase(trade) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    logger.warn('Supabase URL or Key missing, skipping cloud sync.');
    return;
  }
  
  const payload = JSON.stringify({
    bot_name: 'AI Trader',
    trade_date: new Date().toISOString(),
    asset: trade.symbol,
    side: trade.direction,
    entry_price: trade.entry_price,
    exit_price: trade.exit_price,
    pnl: trade.pnl
  });

  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/trade_history`);
  const req = https.request({
    hostname: url.hostname,
    port: 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'apikey': process.env.SUPABASE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Prefer': 'return=minimal'
    }
  }, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      logger.info('Successfully synced trade to Supabase', { tradeId: trade.id });
    } else {
      logger.error('Failed to sync trade to Supabase', { statusCode: res.statusCode });
    }
  });

  req.on('error', (err) => logger.error('Supabase request error', { error: err.message }));
  req.write(payload);
  req.end();
}

function createHmac(data) {
  return crypto
    .createHmac('sha256', process.env.LOG_HMAC_SECRET || 'fallback-secret')
    .update(data)
    .digest('hex');
}

function logDecision({ symbol, geminiScore, geminiThesis, ollamaSentiment, deepseekScore, compositeScore, approved, direction, reason, nodesUsed }) {
  const db = getDb();
  const timestamp = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO ai_decisions
      (timestamp, symbol, gemini_score, gemini_thesis, ollama_sentiment, deepseek_score,
       composite_score, approved, direction, reason, nodes_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    timestamp, symbol,
    geminiScore ?? null, geminiThesis ?? null,
    ollamaSentiment ?? null, deepseekScore ?? null,
    compositeScore, approved ? 1 : 0,
    direction ?? null, reason ?? null,
    nodesUsed ? JSON.stringify(nodesUsed) : null
  );

  logger.info('Decision logged', { id: result.lastInsertRowid, symbol, approved, compositeScore });
  return result.lastInsertRowid;
}

function logTrade({ symbol, direction, qty, entryPrice, stopLoss, targetPrice, scaleOutTarget, scaleStage = 0, remainingQty, alpacaOrderId, decisionId, mode }) {
  const db = getDb();
  const timestamp = new Date().toISOString();
  const prevHmac = getState('last_hmac');

  const initialScaleStage = scaleStage ?? 0;
  const initialRemainingQty = remainingQty ?? qty;

  const tradeData = JSON.stringify({
    timestamp, symbol, direction, qty, entryPrice, stopLoss, targetPrice,
    scaleStage: initialScaleStage, scaleOutTarget: scaleOutTarget ?? null, remainingQty: initialRemainingQty, alpacaOrderId
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

  // Update chain anchor
  setState('last_hmac', hmac);

  // Update counters
  const total = parseInt(getState('total_trades') || '0') + 1;
  setState('total_trades', total);

  logger.info('Trade logged', { id: result.lastInsertRowid, symbol, direction, qty, scaleOutTarget, remainingQty: initialRemainingQty, hmac: hmac.slice(0, 8) + '...' });
  return result.lastInsertRowid;
}

function updateTradeScaleOut(params) {
  const db = getDb();
  let tradeId, scaleStage, remainingQty, stopLoss;
  if (typeof params === 'object' && params !== null && !Array.isArray(params)) {
    ({ tradeId, scaleStage, remainingQty, stopLoss } = params);
  } else {
    [tradeId, scaleStage, remainingQty, stopLoss] = arguments;
  }

  if (stopLoss !== undefined && stopLoss !== null) {
    db.prepare('UPDATE trades SET scale_stage = ?, remaining_qty = ?, stop_loss = ? WHERE id = ?')
      .run(scaleStage, remainingQty, stopLoss, tradeId);
  } else {
    db.prepare('UPDATE trades SET scale_stage = ?, remaining_qty = ? WHERE id = ?')
      .run(scaleStage, remainingQty, tradeId);
  }
  logger.info('Trade scale-out state updated', { tradeId, scaleStage, remainingQty, stopLoss });
}

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

  // Update daily PnL
  const today = new Date().toISOString().slice(0, 10);
  const storedDate = getState('daily_pnl_date');
  let dailyPnl = storedDate === today ? parseFloat(getState('daily_pnl') || '0') : 0;
  dailyPnl += (pnl || 0);
  setState('daily_pnl', dailyPnl);
  setState('daily_pnl_date', today);

  // Track wins/losses
  if (pnl !== null && pnl !== undefined) {
    if (pnl > 0) {
      const wins = parseInt(getState('total_wins') || '0') + 1;
      setState('total_wins', wins);
      setState('consecutive_losses', '0');
    } else {
      const losses = parseInt(getState('consecutive_losses') || '0') + 1;
      setState('consecutive_losses', losses);
    }
  }

  logger.info('Trade outcome updated', { tradeId, pnl, status, scaleStage, remainingQty });

  // Push to Supabase if trade is closed
  if (status === 'closed' || status === 'liquidated') {
    const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
    if (trade) {
      pushToSupabase(trade);
    }
  }
}

function updateTradeStopLoss(tradeId, stopLoss) {
  const db = getDb();
  db.prepare('UPDATE trades SET stop_loss = ? WHERE id = ?').run(stopLoss, tradeId);
  logger.info('Trade stop loss updated in DB', { tradeId, stopLoss });
}

function getRecentDecisions(limit = 20) {
  return getDb()
    .prepare('SELECT * FROM ai_decisions ORDER BY id DESC LIMIT ?')
    .all(limit);
}

function getRecentTrades(limit = 20) {
  return getDb()
    .prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?')
    .all(limit);
}

function getOpenTradeBySymbol(symbol) {
  return getDb()
    .prepare(`
      SELECT * FROM trades 
      WHERE symbol = ? AND status IN ('submitted', 'open') 
      ORDER BY id DESC LIMIT 1
    `)
    .get(symbol);
}

function getDailyPnl() {
  const today = new Date().toISOString().slice(0, 10);
  const storedDate = getState('daily_pnl_date');
  return storedDate === today ? parseFloat(getState('daily_pnl') || '0') : 0;
}

module.exports = { logDecision, logTrade, updateTradeScaleOut, updateTradeOutcome, updateTradeStopLoss, getRecentDecisions, getRecentTrades, getOpenTradeBySymbol, getDailyPnl };
