/**
 * server/quantitative/macd.js
 * Deterministic Execution Trigger for Momentum Regimes
 */

/**
 * Compute EMA for an array of closing prices.
 */
function computeEMA(closes, period) {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const emas = new Array(period - 1).fill(null);
  emas.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    emas.push(ema);
  }
  return emas;
}

/**
 * Evaluate MACD for the given history.
 * @param {Array} history - array of OHLCV bars
 * @returns {string} 'LONG' | 'SHORT' | 'NO_TRADE'
 */
function evaluate(history) {
  if (!history || history.length < 35) return 'NO_TRADE';

  const closes = history.map(b => b.close);
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);

  // Compute MACD Line
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      macdLine.push(ema12[i] - ema26[i]);
    } else {
      macdLine.push(null);
    }
  }

  // Extract non-null MACD values for Signal Line
  const validMacd = macdLine.filter(m => m !== null);
  if (validMacd.length < 9) return 'NO_TRADE';

  const signalEma = computeEMA(validMacd, 9);
  
  // Reconstruct Signal Line aligning with original indices
  const signalLine = new Array(closes.length - validMacd.length).fill(null).concat(signalEma);

  const currentMacd = macdLine[macdLine.length - 1];
  const currentSignal = signalLine[signalLine.length - 1];
  const prevMacd = macdLine[macdLine.length - 2];
  const prevSignal = signalLine[signalLine.length - 2];

  if (currentMacd === null || currentSignal === null || prevMacd === null || prevSignal === null) {
    return 'NO_TRADE';
  }

  // Bullish Crossover
  if (prevMacd <= prevSignal && currentMacd > currentSignal) {
    return 'LONG';
  }

  // Bearish Crossover
  if (prevMacd >= prevSignal && currentMacd < currentSignal) {
    return 'SHORT';
  }

  return 'NO_TRADE';
}

module.exports = { evaluate };
