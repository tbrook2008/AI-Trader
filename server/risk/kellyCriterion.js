require('dotenv').config();
const { getWinStats } = require('../db/strategyMemory');
const logger = require('../utils/logger');

const KELLY_DIVISOR  = parseFloat(process.env.KELLY_FRACTION_DIVISOR || '4');
const MIN_FRACTION   = parseFloat(process.env.MIN_KELLY_FRACTION     || '0.005');
const MAX_FRACTION   = parseFloat(process.env.MAX_KELLY_FRACTION     || '0.15');

/**
 * Full Kelly formula: K = (p * b - q) / b
 * where p = win rate, q = 1-p, b = avg_win / avg_loss (profit factor)
 * Fractional Kelly = K / KELLY_DIVISOR
 *
 * @param {{ winRate, avgWin, avgLoss, balance }} params
 * @returns {{ fraction, positionSize, dollarRisk }}
 */
function calculate({ winRate, avgWin, avgLoss, balance }) {
  if (!winRate || !avgWin || !avgLoss || !balance) {
    return { fraction: MIN_FRACTION, positionSize: balance * MIN_FRACTION, dollarRisk: balance * MIN_FRACTION };
  }

  const q = 1 - winRate;
  const b = avgWin / avgLoss;           // profit factor
  const kelly = (winRate * b - q) / b; // full Kelly fraction

  if (kelly <= 0) {
    logger.warn('Kelly <= 0 — using minimum fraction', { winRate, avgWin, avgLoss });
    return { fraction: MIN_FRACTION, positionSize: balance * MIN_FRACTION, dollarRisk: balance * MIN_FRACTION };
  }

  const fractional = kelly / KELLY_DIVISOR;
  const clamped    = Math.max(MIN_FRACTION, Math.min(MAX_FRACTION, fractional));
  const positionSize = parseFloat((balance * clamped).toFixed(2));

  logger.info('Kelly sizing', {
    winRate: (winRate * 100).toFixed(1) + '%',
    avgWin:  (avgWin * 100).toFixed(2) + '%',
    avgLoss: (avgLoss * 100).toFixed(2) + '%',
    fullKelly:        (kelly * 100).toFixed(2) + '%',
    fractionalKelly:  (fractional * 100).toFixed(2) + '%',
    clampedFraction:  (clamped * 100).toFixed(2) + '%',
    positionSize,
  });

  return { fraction: clamped, positionSize, dollarRisk: positionSize };
}

/**
 * Calculate shares/units to buy given position dollar size and current price.
 */
function calculateQty(positionDollars, price) {
  if (!price || price <= 0) return 0;
  return Math.max(1, Math.floor(positionDollars / price));
}

/**
 * Get position size for a symbol using strategy memory stats.
 */
function getPositionSize(symbol, currentPrice) {
  const isLive = (process.env.TRADING_MODE || 'paper') === 'live';
  const balance = isLive
    ? parseFloat(process.env.LIVE_ACCOUNT_BALANCE  || '5000')
    : parseFloat(process.env.PAPER_ACCOUNT_BALANCE || '100000');

  const maxPct = parseFloat(process.env.MAX_POSITION_PCT || '0.10');
  const maxPosition = balance * maxPct;

  const stats = getWinStats(symbol);
  const { fraction, positionSize } = calculate({
    winRate: stats.winRate,
    avgWin:  stats.avgWin,
    avgLoss: stats.avgLoss,
    balance,
  });

  const finalSize = Math.min(positionSize, maxPosition);
  const qty = calculateQty(finalSize, currentPrice);

  return {
    balance,
    fraction,
    positionDollars: finalSize,
    qty,
    stats,
  };
}

module.exports = { calculate, calculateQty, getPositionSize };
