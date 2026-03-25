require('dotenv').config();
const alpaca        = require('./alpacaClient');
const kelly         = require('../risk/kellyCriterion');
const validator     = require('../risk/validator');
const { logTrade }  = require('../db/tradeLogger');
const memory        = require('../db/strategyMemory');
const { setState }  = require('../db/schema');
const logger        = require('../utils/logger');

const STOP_LOSS_PCT = parseFloat(process.env.STOP_LOSS_PCT || '0.02');
const DRY_RUN       = process.env.DRY_RUN === 'true';

/**
 * Full trade execution pipeline:
 * 1. Kelly position sizing
 * 2. 10-check risk validation
 * 3. Alpaca order submission
 * 4. SQLite logging
 */
async function execute({ bundle, consensus, decisionId }) {
  const symbol = bundle.symbol;
  const price  = bundle.price;
  const mode   = process.env.TRADING_MODE || 'paper';

  logger.info('Trade executor started', { symbol, direction: consensus.direction, score: consensus.compositeScore });

  // Step 1: Get account info and open positions for validation
  let account, openPositions;
  try {
    [account, openPositions] = await Promise.all([
      alpaca.getAccount(),
      alpaca.getOpenPositions(),
    ]);
  } catch (err) {
    logger.error('Failed to fetch Alpaca account data', { error: err.message });
    return { executed: false, reason: 'Alpaca account fetch failed' };
  }

  // Step 2: Kelly position sizing
  const sizing = kelly.getPositionSize(symbol, price);
  logger.info('Position sizing', { symbol, positionDollars: sizing.positionDollars, qty: sizing.qty });

  // Step 3: Pre-trade validator (10 checks)
  const validation = await validator.runChecks({
    consensus,
    symbol,
    positionDollars: sizing.positionDollars,
    alpacaAccount: account,
    openPositions,
  });

  if (!validation.passed) {
    logger.warn('Trade blocked by validator', { symbol, failed: validation.failed });
    return { executed: false, reason: `Validator: ${validation.failed.join(', ')}`, checks: validation.checks };
  }

  // Step 4: Compute stop loss
  const side      = consensus.direction === 'LONG' ? 'buy' : 'sell';
  const stopPrice = consensus.direction === 'LONG'
    ? parseFloat((price * (1 - STOP_LOSS_PCT)).toFixed(4))
    : parseFloat((price * (1 + STOP_LOSS_PCT)).toFixed(4));

  // Step 5: Submit order (skip in dry run)
  if (DRY_RUN) {
    logger.info('🔍 DRY RUN — no order submitted', { symbol, side, qty: sizing.qty, stopPrice });
    return { executed: false, dryRun: true, sizing, validation, reason: 'Dry run mode' };
  }

  let order;
  try {
    order = await alpaca.submitOrder({ symbol, qty: sizing.qty, side, stopPrice });
    logger.info('✅ Order submitted', { symbol, orderId: order.orderId, side, qty: sizing.qty });
  } catch (err) {
    logger.error('Order submission failed', { symbol, error: err.message });
    return { executed: false, reason: `Order failed: ${err.message}` };
  }

  // Step 6: Log trade to SQLite
  const tradeId = logTrade({
    symbol,
    direction: consensus.direction,
    qty:       sizing.qty,
    entryPrice: price,
    stopLoss:   stopPrice,
    targetPrice: consensus.nodeResults.gemini?.target ?? null,
    alpacaOrderId: order.orderId,
    decisionId,
    mode,
  });

  // Step 7: Save indicator state to strategy memory
  memory.saveSetup({
    tradeId,
    symbol,
    ema9:           bundle.ema9,
    ema21:          bundle.ema21,
    rsi14:          bundle.rsi14,
    trend:          bundle.trend,
    regime:         bundle.regime,
    direction:      consensus.direction,
    compositeScore: consensus.compositeScore,
  });

  // Update last trade time
  setState('last_run', new Date().toISOString());

  return {
    executed: true,
    tradeId,
    orderId:   order.orderId,
    symbol,
    direction: consensus.direction,
    qty:       sizing.qty,
    entryPrice: price,
    stopLoss:   stopPrice,
    positionDollars: sizing.positionDollars,
    checks:    validation.checks,
  };
}

module.exports = { execute };
