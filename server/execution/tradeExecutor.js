/**
 * server/execution/tradeExecutor.js
 * Full trade execution pipeline
 */
require('dotenv').config();
const alpaca        = require('./alpacaClient');
const kelly         = require('../risk/kellyCriterion');
const validator     = require('../risk/validator');
const { logTrade }  = require('../db/tradeLogger');
const memory        = require('../db/strategyMemory');
const { setState }  = require('../db/schema');
const logger        = require('../utils/logger');

const macd = require('../quantitative/macd');
const bollingerRsi = require('../quantitative/bollingerRsi');
const { calculateATR } = require('../quantitative/atr');

const DRY_RUN = process.env.DRY_RUN === 'true';
const ATR_MULTIPLIER = parseFloat(process.env.ATR_MULTIPLIER || '2.0');

/**
 * Full trade execution pipeline.
 * @param {{ bundle, consensus, decisionId }} params
 */
async function execute({ bundle, consensus, decisionId }) {
  const symbol = bundle.symbol;
  const price  = bundle.price;
  const mode   = process.env.TRADING_MODE || 'paper';

  // Step 1: Quantitative Trigger
  let direction = 'NO_TRADE';
  if (consensus.regime === 'momentum') {
    direction = macd.evaluate(bundle.history);
  } else if (consensus.regime === 'mean-reverting') {
    direction = bollingerRsi.evaluate(bundle.history, bundle.isCrypto);
  }

  if (direction === 'NO_TRADE') {
    logger.info('Quantitative trigger condition not met — skipping execution', { symbol, regime: consensus.regime });
    return { executed: false, reason: 'Quantitative trigger condition not met' };
  }

  logger.info('Trade executor started', {
    symbol,
    direction,
    regime: consensus.regime,
    score: consensus.compositeScore,
  });

  // Step 2: Fetch live account data
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

  const liveBalance = account.portfolioValue;

  if (account.tradingBlocked) {
    logger.warn('Account trading is blocked — skipping', { symbol });
    return { executed: false, reason: 'Alpaca account trading blocked' };
  }

  // Step 3: Kelly sizing
  const sizing = kelly.getPositionSize(symbol, price, liveBalance, consensus.compositeScore);
  
  // Step 4: Validation
  const validation = await validator.runChecks({
    consensus: { ...consensus, direction }, // pass direction to validator
    symbol,
    positionDollars: sizing.positionDollars,
    alpacaAccount:   account,
    openPositions,
    liveBalance,
  });

  if (!validation.passed) {
    logger.warn('Trade blocked by validator', { symbol, failed: validation.failed });
    return { executed: false, reason: `Validator: ${validation.failed.join(', ')}` };
  }

  // Step 5: Dynamic ATR Risk Rails
  const atrValue = calculateATR(bundle.history, 14);
  if (!atrValue) {
    logger.warn('Insufficient data to calculate ATR — skipping', { symbol });
    return { executed: false, reason: 'Insufficient ATR data' };
  }

  const trailPrice = atrValue * ATR_MULTIPLIER;
  const side = direction === 'LONG' ? 'buy' : 'sell';

  if (DRY_RUN) {
    logger.info('🔍 DRY RUN — no order submitted', {
      symbol, side, qty: sizing.qty, trailPrice: trailPrice.toFixed(2),
    });
    return { executed: false, dryRun: true, sizing, validation, reason: 'Dry run mode' };
  }

  // Step 6: Submit Order
  let order;
  try {
    order = await alpaca.submitOrder({
      symbol,
      qty:        sizing.qty,
      side,
      trailPrice: parseFloat(trailPrice.toFixed(4)),
    });
    logger.info(`✅ OTO Trailing Stop order submitted: ${symbol} | OrderID: ${order.orderId} | Qty: ${sizing.qty} | Trail: $${trailPrice.toFixed(2)}`);
  } catch (err) {
    logger.error('❌ Order submission failed', { symbol, error: err.message });
    return { executed: false, reason: `Alpaca Error: ${err.message}` };
  }

  // Step 7: Log trade — store ATR-derived stop/target so riskMonitor can pick them up
  const atrStop   = direction === 'LONG' ? price - trailPrice : price + trailPrice;
  const atrTarget = direction === 'LONG' ? price + (trailPrice * 2) : price - (trailPrice * 2);
  const tradeId = logTrade({
    symbol,
    direction,
    qty:            sizing.qty,
    entryPrice:     price,
    stopLoss:       parseFloat(atrStop.toFixed(4)),
    targetPrice:    parseFloat(atrTarget.toFixed(4)),
    alpacaOrderId:  order.orderId,
    decisionId,
    mode,
  });

  // Step 8: Strategy memory
  memory.saveSetup({
    tradeId,
    symbol,
    regime:         consensus.regime,
    direction,
    compositeScore: consensus.compositeScore,
  });

  setState(`last_trade_${symbol}`, new Date().toISOString());

  return {
    executed:        true,
    tradeId,
    orderId:         order.orderId,
    symbol,
    direction,
    qty:             sizing.qty,
    entryPrice:      price,
    trailPrice:      parseFloat(trailPrice.toFixed(2)),
    positionDollars: sizing.positionDollars,
  };
}

module.exports = { execute };
