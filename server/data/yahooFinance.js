require('dotenv').config();
const yahooFinance = require('yahoo-finance2').default;
const logger = require('../utils/logger');

// Suppress yahoo-finance2 validation warnings in production
yahooFinance.suppressNotices(['yahooSurvey']);

/**
 * Compute EMA for an array of closing prices.
 * @param {number[]} closes - Array of closing prices (oldest first)
 * @param {number} period
 */
function computeEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(4));
}

/**
 * Compute RSI-14 using Wilder's smoothing.
 */
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

/**
 * Compute ATR (Average True Range) for regime detection.
 */
function computeATR(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prev = bars[i - 1];
    return Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close));
  });
  const avgTr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return parseFloat(avgTr.toFixed(4));
}

/**
 * Detect market regime: trending / ranging / volatile.
 */
function detectRegime(closes, bars) {
  const atr = computeATR(bars);
  const price = closes[closes.length - 1];
  const atrPct = atr ? (atr / price) * 100 : 0;

  const ema9  = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const spread = ema9 && ema21 ? Math.abs(ema9 - ema21) / price * 100 : 0;

  if (atrPct > 3) return 'volatile';
  if (spread > 1.5) return 'trending';
  return 'ranging';
}

/**
 * Get latest quote for a symbol.
 */
async function getQuote(symbol) {
  try {
    const q = await yahooFinance.quote(symbol);
    return {
      symbol: q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
      volume: q.regularMarketVolume,
      high: q.regularMarketDayHigh,
      low: q.regularMarketDayLow,
      open: q.regularMarketOpen,
      prevClose: q.regularMarketPreviousClose,
      marketCap: q.marketCap,
      currency: q.currency,
    };
  } catch (err) {
    logger.error('Yahoo Finance quote error', { symbol, error: err.message });
    throw err;
  }
}

/**
 * Get OHLCV bars and compute EMA9, EMA21, RSI14.
 * @param {string} symbol
 * @param {string} period1 - start date string (e.g. '2024-01-01')
 * @param {string} interval - '1d', '1h', '15m'
 */
async function getOHLCVWithIndicators(symbol, period1, interval = '1d') {
  try {
    // Yahoo finance2 historical only supports daily on free; use chart for intraday
    const bars = await yahooFinance.historical(symbol, { period1, interval });

    if (!bars || bars.length < 30) {
      logger.warn('Insufficient bars for indicators', { symbol, count: bars?.length });
      return null;
    }

    const closes = bars.map(b => b.close);
    const ema9   = computeEMA(closes, 9);
    const ema21  = computeEMA(closes, 21);
    const rsi14  = computeRSI(closes, 14);
    const regime = detectRegime(closes, bars);

    let trend = 'neutral';
    if (ema9 && ema21) {
      if (ema9 > ema21 * 1.005) trend = 'bullish';
      else if (ema9 < ema21 * 0.995) trend = 'bearish';
    }

    // Volume trend: compare last 5 vs prior 5
    const vols = bars.map(b => b.volume).filter(Boolean);
    const recentVol = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const priorVol  = vols.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const volumeTrend = recentVol > priorVol * 1.2 ? 'increasing' : recentVol < priorVol * 0.8 ? 'decreasing' : 'stable';

    return { ema9, ema21, rsi14, trend, regime, volumeTrend, barsCount: bars.length };
  } catch (err) {
    logger.error('Yahoo Finance historical error', { symbol, error: err.message });
    return null;
  }
}

/**
 * Get recent news for a symbol from Yahoo Finance.
 */
async function getSymbolNews(symbol) {
  try {
    const result = await yahooFinance.search(symbol, { newsCount: 10, quotesCount: 0 });
    return (result.news || []).map(n => ({
      title: n.title,
      publisher: n.publisher,
      link: n.link,
      timestamp: n.providerPublishTime,
    }));
  } catch (err) {
    logger.warn('Yahoo Finance news error', { symbol, error: err.message });
    return [];
  }
}

module.exports = { getQuote, getOHLCVWithIndicators, getSymbolNews, computeEMA, computeRSI };
