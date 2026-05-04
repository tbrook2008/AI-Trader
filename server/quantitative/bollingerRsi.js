/**
 * server/quantitative/bollingerRsi.js
 * Deterministic Execution Trigger for Mean-Reverting Regimes
 */

/**
 * Compute SMA for an array of closing prices.
 */
function computeSMA(closes, period) {
  const sma = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma[i] = sum / period;
  }
  return sma;
}

/**
 * Compute Standard Deviation
 */
function computeSD(closes, sma, period) {
  const sd = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const mean = sma[i];
    const variance = closes.slice(i - period + 1, i + 1).reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    sd[i] = Math.sqrt(variance);
  }
  return sd;
}

/**
 * Compute RSI-14
 */
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return new Array(closes.length).fill(null);
  const rsi = new Array(closes.length).fill(null);

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

/**
 * Evaluate Bollinger Bands + RSI for mean reversion
 * @param {Array} history - array of OHLCV bars
 * @returns {string} 'LONG' | 'SHORT' | 'NO_TRADE'
 */
function evaluate(history) {
  if (!history || history.length < 21) return 'NO_TRADE';

  const closes = history.map(b => b.close);
  const sma20 = computeSMA(closes, 20);
  const sd20 = computeSD(closes, sma20, 20);
  const rsi14 = computeRSI(closes, 14);

  const currentClose = closes[closes.length - 1];
  const currentSMA = sma20[sma20.length - 1];
  const currentSD = sd20[sd20.length - 1];
  const currentRSI = rsi14[rsi14.length - 1];

  if (currentSMA === null || currentSD === null || currentRSI === null) {
    return 'NO_TRADE';
  }

  const upperBand = currentSMA + (2 * currentSD);
  const lowerBand = currentSMA - (2 * currentSD);

  // Mean Reversion from bottom (Oversold)
  if (currentClose <= lowerBand && currentRSI < 30) {
    return 'LONG';
  }

  // Mean Reversion from top (Overbought)
  if (currentClose >= upperBand && currentRSI > 70) {
    return 'SHORT';
  }

  return 'NO_TRADE';
}

module.exports = { evaluate };
