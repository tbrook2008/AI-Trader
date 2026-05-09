const alpaca = require('../execution/alpacaClient');
const { getOpenTradeBySymbol, updateTradeOutcome } = require('../db/tradeLogger');
const logger = require('../utils/logger');

/**
 * server/autonomous/riskMonitor.js
 * v2.1 — Universal Risk Monitor
 * 
 * Periodically checks ALL open positions in the Alpaca account.
 * For known trades: uses DB-stored ATR stops/targets.
 * For orphaned/manual trades: applies default % limits from .env.
 */
async function monitorRisk() {
  logger.info('🛡️ Running universal risk monitor...');
  
  let positions;
  try {
    positions = await alpaca.getOpenPositions();
  } catch (err) {
    logger.error('Risk Monitor: Failed to fetch positions', { error: err.message });
    return;
  }

  if (!positions.length) return;

  for (const pos of positions) {
    let rawSymbol = pos.symbol;
    let dbSymbol = rawSymbol;

    // Normalize crypto symbol for DB lookup (Alpaca 'BTCUSD' → internal 'BTC/USD')
    if (/^[A-Z]{3,5}USD$/.test(rawSymbol) && rawSymbol !== 'USD') {
      dbSymbol = rawSymbol.slice(0, -3) + '/USD';
    }
    
    const currentPrice = parseFloat(pos.currentPrice);
    const avgEntry    = parseFloat(pos.avgEntryPrice || pos.avgEntry);

    if (!currentPrice || isNaN(currentPrice)) {
      logger.warn('Risk Monitor: Invalid current price', { symbol: rawSymbol });
      continue;
    }

    // 1. Try to find the trade in our local database
    const trade = getOpenTradeBySymbol(dbSymbol);
    
    let direction, stopLoss, targetPrice, tradeId;

    if (trade) {
      direction   = trade.direction;
      stopLoss    = trade.stop_loss;
      targetPrice = trade.target_price;
      tradeId     = trade.id;
    } else {
      // 2. Failsafe: Handle orphaned or manual positions
      direction = pos.side.toUpperCase() === 'LONG' ? 'LONG' : 'SHORT';
      
      const stopPct   = parseFloat(process.env.STOP_LOSS_PCT   || '0.02');
      const targetPct = parseFloat(process.env.TAKE_PROFIT_PCT || '0.04');
      
      if (direction === 'LONG') {
        stopLoss    = avgEntry * (1 - stopPct);
        targetPrice = avgEntry * (1 + targetPct);
      } else {
        stopLoss    = avgEntry * (1 + stopPct);
        targetPrice = avgEntry * (1 - targetPct);
      }

      // Log that we've "adopted" this position for risk monitoring
      logger.info('Risk Monitor: Monitoring orphaned position', { 
        symbol: rawSymbol, direction, entry: avgEntry, stopLoss, targetPrice 
      });
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
        symbol: rawSymbol, currentPrice, stopLoss, targetPrice 
      });

      const res = await alpaca.closePosition(rawSymbol);
      if (res.closed) {
        const pnl = parseFloat(pos.unrealizedPl || 0);
        if (tradeId) {
          updateTradeOutcome({
            tradeId: tradeId,
            exitPrice: currentPrice,
            pnl,
            status: 'closed'
          });
        }
        logger.info(`✅ Closed position successfully`, { symbol: rawSymbol, pnl });
      } else {
        logger.error(`❌ Failed to close position during risk event`, { symbol: rawSymbol, reason: res.reason });
      }
    }
  }
}

module.exports = { monitorCryptoRisk: monitorRisk }; // Exporting as monitorCryptoRisk for backward compatibility
