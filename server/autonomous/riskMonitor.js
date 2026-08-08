const alpaca = require('../execution/alpacaClient');
const http = require('http');
const { getOpenTradeBySymbol, updateTradeOutcome, updateTradeScaleOut, updateTradeStopLoss } = require('../db/tradeLogger');
const { isCryptoSymbol } = require('../data/dataAggregator');
const logger = require('../utils/logger');
const { barsHistory } = require('../data/dataAggregator');
const { calculateATR, getDynamicATRMultiplier } = require('../quantitative/atr');
const { calculateScaleOutQty } = require('../utils/rounding');

// In-memory lock set preventing duplicate order execution across concurrent monitor ticks
const processingTrades = new Set();

/**
 * Periodically checks ALL open positions against local DB scale-out targets,
 * stop-loss limits, and take-profit limits using a 3-stage state machine.
 */
async function monitorRisk() {
  logger.info('🛡️ Running risk monitor for all positions...');
  
  let positions;
  try {
    positions = await alpaca.getOpenPositions();
  } catch (err) {
    logger.error('Risk Monitor: Failed to fetch positions', { error: err.message });
    return;
  }

  const closePromises = [];

  const { ALL_TICKERS } = require('../quantitative/composerStrategy');

  for (const pos of positions) {
    if (ALL_TICKERS.includes(pos.symbol)) {
      // Ignore long-term Composer ETFs so we don't accidentally liquidate them with intraday stops
      continue;
    }

    let symbol = pos.symbol;
    // Map Alpaca format 'DOGEUSD' → internal 'DOGE/USD' using regex
    if (/^[A-Z]+USD$/.test(symbol) && symbol !== 'USD') {
      symbol = symbol.slice(0, -3) + '/USD';
    }
    
    const currentPrice = pos.currentPrice;

    if (!currentPrice) {
      logger.warn('Risk Monitor: No current price available for position', { symbol });
      continue;
    }

    const trade = getOpenTradeBySymbol(symbol);
    let direction = 'LONG';
    let stopLoss = null;
    let targetPrice = null;
    let scaleOutTarget = null;
    let scaleStage = 0;
    let initialQty = pos.qty;
    let remainingQty = pos.qty;
    let tradeId = null;

    if (trade) {
      direction = trade.direction;
      stopLoss = trade.stop_loss;
      targetPrice = trade.target_price;
      scaleOutTarget = trade.scale_out_target;
      scaleStage = trade.scale_stage ?? 0;
      initialQty = trade.qty;
      remainingQty = trade.remaining_qty ?? trade.qty;
      tradeId = trade.id;
    } else {
      // Fail-safe: Apply default risk parameters to orphaned/manual Alpaca positions
      direction = pos.side === 'long' ? 'LONG' : 'SHORT';
      const stopPct = parseFloat(process.env.STOP_LOSS_PCT || '0.02');
      const targetPct = parseFloat(process.env.TAKE_PROFIT_PCT || '0.04');
      
      if (direction === 'LONG') {
        stopLoss = pos.avgEntry * (1 - stopPct);
        targetPrice = pos.avgEntry * (1 + targetPct);
      } else {
        stopLoss = pos.avgEntry * (1 + stopPct);
        targetPrice = pos.avgEntry * (1 - targetPct);
      }
    }

    const lockKey = `${symbol}_${tradeId || pos.symbol}`;
    if (processingTrades.has(lockKey)) {
      logger.debug(`Skipping trade ${lockKey} — already processing`);
      continue;
    }

    // Trailing Stop Logic with Dynamic ATR
    let trailDistance = null;
    const baseMultiplier = parseFloat(process.env.ATR_MULTIPLIER || '3.5');
    
    const history = barsHistory[symbol];
    if (history && history.length >= 14) {
      const atrValue = calculateATR(history, 14);
      if (atrValue) {
        const dynamicMultiplier = getDynamicATRMultiplier(history, baseMultiplier);
        trailDistance = atrValue * dynamicMultiplier;
        logger.debug(`Dynamic Trail Distance for ${symbol}: $${trailDistance.toFixed(4)} (Mult: ${dynamicMultiplier.toFixed(2)})`);
      }
    }

    if (trailDistance !== null && direction === 'LONG') {
      const newTrailingStop = currentPrice - trailDistance;
      if (newTrailingStop > stopLoss) {
        stopLoss = newTrailingStop;
        if (tradeId) {
          logger.info(`Ratcheting Trailing Stop UP for ${symbol} to $${stopLoss.toFixed(2)}`);
          updateTradeStopLoss(tradeId, stopLoss);
        }
      }
    } else if (trailDistance !== null && direction === 'SHORT') {
      const newTrailingStop = currentPrice + trailDistance;
      if (newTrailingStop < stopLoss) {
        stopLoss = newTrailingStop;
        if (tradeId) {
          logger.info(`Ratcheting Trailing Stop DOWN for ${symbol} to $${stopLoss.toFixed(2)}`);
          updateTradeStopLoss(tradeId, stopLoss);
        }
      }
    }

    // Determine Step Size for fractional rounding
    let stepSize = 1.0;
    if (isCryptoSymbol(symbol)) {
      stepSize = 0.0001;
    } else if (Number.isInteger(initialQty)) {
      stepSize = 1.0;
    } else {
      stepSize = 0.01;
    }

    // Evaluate 3-Stage Position State Machine
    if (scaleStage === 0) {
      // Check Stage 0 -> Stage 1 Partial Scale-Out Trigger (1 SD mark)
      const scaleOutHit = direction === 'LONG'
        ? (scaleOutTarget != null && currentPrice >= scaleOutTarget)
        : (scaleOutTarget != null && currentPrice <= scaleOutTarget);

      if (scaleOutHit) {
        processingTrades.add(lockKey);
        closePromises.push((async () => {
          try {
            logger.info(`🎯 Stage 0 -> Stage 1 Scale-Out triggered for ${symbol}`, { currentPrice, scaleOutTarget });
            const { partialQty, remainingQty: newRemainingQty } = calculateScaleOutQty(initialQty, stepSize);
            const exitSide = direction === 'LONG' ? 'sell' : 'buy';

            const order = await alpaca.submitOrder({
              symbol: pos.symbol,
              qty: partialQty,
              side: exitSide
            });

            if (order && order.orderId) {
              const breakevenSL = trade?.entry_price || pos.avgEntry;
              if (tradeId) {
                updateTradeScaleOut({
                  tradeId,
                  scaleStage: 1,
                  remainingQty: newRemainingQty,
                  stopLoss: breakevenSL
                });
              }
              logger.info(`✅ Stage 1 Partial Scale-Out executed for ${symbol}`, {
                partialQty,
                newRemainingQty,
                breakevenSL,
                orderId: order.orderId
              });
            }
          } catch (err) {
            logger.error(`❌ Failed partial scale-out for ${symbol}`, { error: err.message });
          } finally {
            processingTrades.delete(lockKey);
          }
        })());
        continue;
      }

      // Check Stage 0 -> Stage 2 Full Exit Triggers (VWAP Target or Initial SL Breach)
      const fullExitHit = direction === 'LONG'
        ? ((targetPrice != null && currentPrice >= targetPrice) || (stopLoss != null && currentPrice <= stopLoss))
        : ((targetPrice != null && currentPrice <= targetPrice) || (stopLoss != null && currentPrice >= stopLoss));

      if (fullExitHit) {
        processingTrades.add(lockKey);
        closePromises.push((async () => {
          try {
            const trigger = (direction === 'LONG' ? currentPrice >= targetPrice : currentPrice <= targetPrice)
              ? 'TAKE_PROFIT_VWAP'
              : 'INITIAL_STOP_LOSS';

            logger.info(`🚨 Risk limit breached in Stage 0! Triggering ${trigger}`, { symbol, currentPrice, stopLoss, targetPrice });
            const res = await alpaca.closePosition(pos.symbol);
            if (res.closed) {
              const pnl = pos.unrealizedPL;
              if (tradeId) {
                updateTradeOutcome({
                  tradeId,
                  exitPrice: currentPrice,
                  pnl,
                  status: 'closed',
                  scaleStage: 2,
                  remainingQty: 0
                });
              }
              logger.info(`✅ Closed position successfully in Stage 0`, { symbol, pnl });
              sendCloseWebhook(pos.symbol, currentPrice);
            }
          } catch (err) {
            logger.error(`❌ Failed to close Stage 0 position for ${symbol}`, { error: err.message });
          } finally {
            processingTrades.delete(lockKey);
          }
        })());
        continue;
      }
    } else if (scaleStage === 1) {
      // Check Stage 1 -> Stage 2 Full Exit Triggers (VWAP Target or Breakeven SL Breach)
      const fullExitHit = direction === 'LONG'
        ? ((targetPrice != null && currentPrice >= targetPrice) || (stopLoss != null && currentPrice <= stopLoss))
        : ((targetPrice != null && currentPrice <= targetPrice) || (stopLoss != null && currentPrice >= stopLoss));

      if (fullExitHit) {
        processingTrades.add(lockKey);
        closePromises.push((async () => {
          try {
            const trigger = (direction === 'LONG' ? currentPrice >= targetPrice : currentPrice <= targetPrice)
              ? 'TAKE_PROFIT_VWAP'
              : 'BREAKEVEN_STOP';

            logger.info(`🚨 Risk limit breached in Stage 1! Triggering ${trigger}`, { symbol, currentPrice, stopLoss, targetPrice });
            const res = await alpaca.closePosition(pos.symbol);
            if (res.closed) {
              const pnl = pos.unrealizedPL;
              if (tradeId) {
                updateTradeOutcome({
                  tradeId,
                  exitPrice: currentPrice,
                  pnl,
                  status: 'closed',
                  scaleStage: 2,
                  remainingQty: 0
                });
              }
              logger.info(`✅ Closed position successfully in Stage 1`, { symbol, pnl });
              sendCloseWebhook(pos.symbol, currentPrice);
            }
          } catch (err) {
            logger.error(`❌ Failed to close Stage 1 position for ${symbol}`, { error: err.message });
          } finally {
            processingTrades.delete(lockKey);
          }
        })());
        continue;
      }
    }
  }

  if (closePromises.length > 0) {
    await Promise.allSettled(closePromises);
  }
}

function sendCloseWebhook(symbol, price) {
  try {
    const payload = JSON.stringify({
      symbol,
      direction: 'CLOSE',
      price
    });
    const req = http.request({
      hostname: 'localhost',
      port: 4000,
      path: '/api/internal/signal',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    });
    req.on('error', (e) => logger.error(`Webhook error: ${e.message}`));
    req.write(payload);
    req.end();
  } catch (e) {
    logger.error(`Failed to send close webhook: ${e.message}`);
  }
}

module.exports = { monitorRisk };
