/**
 * server/quantitative/atr.js
 * Average True Range Calculation
 */

function calculateATR(history, period = 14) {
  if (!history || history.length < period + 1) return null;

  const trueRanges = [];
  for (let i = 1; i < history.length; i++) {
    const currentHigh = history[i].high;
    const currentLow = history[i].low;
    const prevClose = history[i - 1].close;

    const tr1 = currentHigh - currentLow;
    const tr2 = Math.abs(currentHigh - prevClose);
    const tr3 = Math.abs(currentLow - prevClose);
    const tr = Math.max(tr1, tr2, tr3);
    trueRanges.push(tr);
  }

  // Calculate the first ATR as simple average of first 'period' TRs
  let atr = trueRanges.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

  // Smoothed ATR for the remaining periods
  for (let i = period; i < trueRanges.length; i++) {
    atr = ((atr * (period - 1)) + trueRanges[i]) / period;
  }

  return atr;
}

module.exports = { calculateATR };
