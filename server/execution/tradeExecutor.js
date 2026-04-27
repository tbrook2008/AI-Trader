/**
 * server/execution/tradeExecutor.js
 * Full trade execution pipeline:
 * 1. Fetch LIVE balance from Alpaca (not hardcoded env)
 * 2. Kelly position sizing
 * 3. 10-check risk validation
 * 4. Bracket order submission (entry + stop + target)
 * 5. SQLite logging
 */
require('dotenv').config();
const alpaca        = require('./alpacaClient');
const kelly         = require('../risk/kellyCriterion');
const validator     = require('../risk/validator');
const { logTrade }  = require('../db/tradeLogger');
const memory        = require('../db/strategyMemory');
const { setState }  = require('../db/schema');
const logger        = require('../utils/logger');

const STOP_LOSS_PCT    = parseFloat(process.env.STOP_LOSS_PCT    || '0.02');  // 2% stop
const TAKE_PROFIT_PCT  = parseFloat(process.env.TAKE_PROFIT_PCT  || '0.04');  // 4% target (2:1 R/R)
const DRY_RUN          = process.env.DRY_RUN === 'true';

/**
 * Full trade execution pipeline.
 * @param {{ bundle, consensus, decisionId }} params
 */
async function execute({ bundle, consensus, decisionId }) {
  const symbol = bundle.symbol;
  const price  = bundle.price;
  const mode   = process.env.TRADING_MODE || 'paper';

  logger.info('Trade executor started', {
    symbol,
    direction: consensus.direction,
    score: consensus.compositeScore,
  });

  // Step 1: Fetch live account data from Alpaca
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

  // Use LIVE portfolio value for all sizing — never a hardcoded number
  const liveBalance = account.portfolioValue;
  logger.info('Live account balance', { portfolioValue: liveBalance, buyingPower: account.buyingPower });

  if (account.tradingBlocked) {
    logger.warn('Account trading is blocked — skipping', { symbol });
    return { executed: false, reason: 'Alpaca account trading blocked' };
  }

  // Step 2: Kelly position sizing using live balance
  const sizing = kelly.getPositionSize(symbol, price, liveBalance);
  logger.info('Position sizing', {
    symbol,
    positionDollars: sizing.positionDollars,
    qty: sizing.qty,
    fraction: (sizing.fraction * 100).toFixed(2) + '%',
  });

  // Step 3: Pre-trade validator (10 checks)
  const validation = await validator.runChecks({
    consensus,
    symbol,
    positionDollars: sizing.positionDollars,
    alpacaAccount:   account,
    openPositions,
    liveBalance,
  });

  if (!validation.passed) {
    logger.warn('Trade blocked by validator', { symbol, failed: validation.failed });
    return {
      executed: false,
      reason: `Validator: ${validation.failed.join(', ')}`,
      checks: validation.checks,
    };
  }

  // Step 4: Compute bracket order prices
  const side = consensus.direction === 'LONG' ? 'buy' : 'sell';

  const stopPrice = consensus.direction === 'LONG'
    ? price * (1 - STOP_LOSS_PCT)
    : price * (1 + STOP_LOSS_PCT);

  // Use Gemini's target if available, otherwise default to fixed R/R
  const geminiTarget = consensus.nodeResults?.gemini?.target;
  const takeProfitPrice = geminiTarget ?? (
    consensus.direction === 'LONG'
      ? price * (1 + TAKE_PROFIT_PCT)
      : price * (1 - TAKE_PROFIT_PCT)
  );

  // Step 5: Submit bracket order (skip in dry run)
  if (DRY_RUN) {
    logger.info('🔍 DRY RUN — no order submitted', {
      symbol, side, qty: sizing.qty, stopPrice: stopPrice.toFixed(2),
      takeProfitPrice: takeProfitPrice.toFixed(2),
    });
    return { executed: false, dryRun: true, sizing, validation, reason: 'Dry run mode' };
  }

  let order;
  try {
    order = await alpaca.submitOrder({
      symbol,
      qty:             sizing.qty,
      side,
      stopPrice:       parseFloat(stopPrice.toFixed(4)),
      takeProfitPrice: parseFloat(takeProfitPrice.toFixed(4)),
    });
    logger.info('✅ Bracket order submitted', {
      symbol,
      orderId: order.orderId,
      side,
      qty:   sizing.qty,
      stop:  stopPrice.toFixed(2),
      target: takeProfitPrice.toFixed(2),
    });
  } catch (err) {
    logger.error('Order submission failed', { symbol, error: err.message });
    return { executed: false, reason: `Order failed: ${err.message}` };
  }

  // Step 6: Log trade to SQLite
  const tradeId = logTrade({
    symbol,
    direction:      consensus.direction,
    qty:            sizing.qty,
    entryPrice:     price,
    stopLoss:       parseFloat(stopPrice.toFixed(4)),
    targetPrice:    parseFloat(takeProfitPrice.toFixed(4)),
    alpacaOrderId:  order.orderId,
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

  setState('last_run', new Date().toISOString());

  return {
    executed:        true,
    tradeId,
    orderId:         order.orderId,
    symbol,
    direction:       consensus.direction,
    qty:             sizing.qty,
    entryPrice:      price,
    stopLoss:        parseFloat(stopPrice.toFixed(2)),
    takeProfitPrice: parseFloat(takeProfitPrice.toFixed(2)),
    positionDollars: sizing.positionDollars,
    liveBalance,
    checks:          validation.checks,
  };
}

module.exports = { execute };
