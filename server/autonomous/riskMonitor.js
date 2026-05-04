const alpaca = require('../execution/alpacaClient');
const { getOpenTradeBySymbol, updateTradeOutcome } = require('../db/tradeLogger');
const { isCryptoSymbol } = require('../data/dataAggregator');
const logger = require('../utils/logger');

/**
 * Periodically checks open crypto positions against local DB stop-loss and take-profit limits.
 * Required because Alpaca does not support OCO/Bracket orders natively for crypto.
 */
async function monitorCryptoRisk() {
  logger.info('🛡️ Running crypto risk monitor...');
  
  let positions;
  try {
    positions = await alpaca.getOpenPositions();
  } catch (err) {
    logger.error('Risk Monitor: Failed to fetch positions', { error: err.message });
    return;
  }

  const cryptoPositions = positions.filter(p => isCryptoSymbol(p.symbol));

  for (const pos of cryptoPositions) {
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
    let tradeId = null;

    if (trade) {
      direction = trade.direction;
      stopLoss = trade.stop_loss;
      targetPrice = trade.target_price;
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

    let trigger = null;

    if (direction === 'LONG') {
      if (stopLoss && currentPrice <= stopLoss) trigger = 'STOP_LOSS';
      if (targetPrice && currentPrice >= targetPrice) trigger = 'TAKE_PROFIT';
    } else if (direction === 'SHORT') {
      if (stopLoss && currentPrice >= stopLoss) trigger = 'STOP_LOSS';
      if (targetPrice && currentPrice <= targetPrice) trigger = 'TAKE_PROFIT';
    }

    if (trigger) {
      logger.info(`🚨 Risk limit breached! Triggering ${trigger}`, { 
        symbol, currentPrice, stopLoss, targetPrice 
      });

      // Pass the raw Alpaca symbol (pos.symbol) to closePosition, NOT the DB format
      const res = await alpaca.closePosition(pos.symbol);
      if (res.closed) {
        const pnl = pos.unrealizedPL;
        if (tradeId) {
          updateTradeOutcome({
            tradeId: tradeId,
            exitPrice: currentPrice,
            pnl,
            status: 'closed'
          });
        }
        logger.info(`✅ Closed position successfully`, { symbol, pnl });
      } else {
        logger.error(`❌ Failed to close position during risk event`, { symbol, reason: res.reason });
      }
    }
  }
}

module.exports = { monitorCryptoRisk };
