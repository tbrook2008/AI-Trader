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
const kalman = require('../quantitative/kalman');
const ouModel = require('../quantitative/ouModel');
const { calculateATR, getDynamicATRMultiplier } = require('../quantitative/atr');
const { analyzeVolume, classifyVolume } = require('../quantitative/volumeProfile');
const hmm = require('../quantitative/hmm');
const vwap = require('../quantitative/vwap');

const DRY_RUN            = process.env.DRY_RUN === 'true';
const ATR_MULTIPLIER     = parseFloat(process.env.ATR_MULTIPLIER        || '3.5');
const ATR_TARGET_MULT    = parseFloat(process.env.ATR_TARGET_MULTIPLIER || '2.0');

/**
 * Full trade execution pipeline based purely on math.
 * @param {{ bundle }} params
 */
async function execute({ bundle }) {
  const symbol = bundle.symbol;
  const price  = bundle.price;
  const mode   = process.env.TRADING_MODE || 'paper';
  const history = bundle.history;

  // Step 1: Regime Classification via HMM (Gaussian Mixture Model)
  const regime = hmm.classifyRegime(history);
  const isTrending = regime === 'momentum';
  
  // Step 2: Quantitative Trigger
  let direction = 'NO_TRADE';
  let strategy = '';

  if (isTrending) {
    direction = kalman.evaluate(history);
    if (direction !== 'NO_TRADE') strategy = 'KalmanFilter';
  } else {
    direction = ouModel.evaluate(history);
    if (direction !== 'NO_TRADE') strategy = 'OrnsteinUhlenbeck';
  }

  if (direction === 'NO_TRADE') {
    return { executed: false, reason: 'Quantitative trigger condition not met' };
  }

  logger.info('Trade executor started', {
    symbol,
    direction,
    regime,
    strategy
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

  // Step 3: Kelly sizing (no consensus score, default 80 confidence)
  const sizing = kelly.getPositionSize(symbol, price, liveBalance, 80, account.buyingPower);
  
  if (sizing.qty === 0) {
    logger.warn('Insufficient buying power for trade', { symbol, buyingPower: account.buyingPower });
    return { executed: false, reason: 'Insufficient buying power' };
  }
  
  // Step 4: Validation
  const validation = await validator.runChecks({
    consensus: { approved: true, direction, regime }, // Mock consensus for validator backward compatibility
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

  const dynamicMultiplier = getDynamicATRMultiplier(bundle.history, ATR_MULTIPLIER);
  const trailPrice  = atrValue * dynamicMultiplier;
  const targetDist  = atrValue * dynamicMultiplier * ATR_TARGET_MULT;
  const side = direction === 'LONG' ? 'buy' : 'sell';

  // Step 5b: Volume Profile check
  const volAnalysis = analyzeVolume(bundle.history, direction);
  const volClass    = classifyVolume(bundle.history);
  logger.info('Volume profile', { symbol, volume: volClass, ratio: volAnalysis.ratio?.toFixed(2), reason: volAnalysis.reason });
  if (!volAnalysis.supported) {
    logger.warn('Trade blocked by volume profile', { symbol, reason: volAnalysis.reason, ratio: volAnalysis.ratio });
    return { executed: false, reason: `Volume: ${volAnalysis.reason}` };
  }

  // Step 6: Calculate Stops & Targets

  const atrStop   = direction === 'LONG' ? price - trailPrice : price + trailPrice;
  const atrTarget = direction === 'LONG' ? price + targetDist  : price - targetDist;

  if (DRY_RUN) {
    logger.info('🔍 DRY RUN — no order submitted', {
      symbol, side, qty: sizing.qty, trailPrice: trailPrice.toFixed(2),
    });
    return { executed: false, dryRun: true, sizing, validation, reason: 'Dry run mode' };
  }

  // Step 7: Execute via Alpaca
  let order;
  try {
    order = await alpaca.submitOrder({
      symbol,
      qty:        sizing.qty,
      side,
    });
    logger.info(`✅ Market order submitted: ${symbol} | OrderID: ${order.orderId} | Qty: ${sizing.qty}`);
  } catch (err) {
    const errorDetails = err.response ? err.response.data : err.message;
    logger.error('❌ Order submission failed', { symbol, error: err.message, details: errorDetails });
    return { executed: false, reason: `Alpaca Error: ${err.message}` };
  }

  // Step 8: Log trade — store ATR-derived stop/target so riskMonitor can pick them up
  const tradeId = logTrade({
    symbol,
    direction,
    qty:            sizing.qty,
    entryPrice:     price,
    stopLoss:       parseFloat(atrStop.toFixed(4)),
    targetPrice:    parseFloat(atrTarget.toFixed(4)),
    alpacaOrderId:  order.orderId,
    decisionId:     strategy, // Use strategy name as decision ID for logging
    mode,
  });

  // Step 9: Strategy memory
  memory.saveSetup({
    tradeId,
    symbol,
    regime,
    direction,
    compositeScore: 80,
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
