/**
 * server/quantitative/bollingerRsi.js
 * v2.2 — Bollinger/RSI Trigger (Aggressive Mode Support)
 */

const TREND_PERIOD   = parseInt(process.env.TREND_FILTER_PERIOD    || '50');
const VOL_MULTIPLIER = parseFloat(process.env.VOLUME_SPIKE_MULTIPLIER || '0.7');
const AGGRESSIVE     = process.env.AGGRESSIVE_MODE === 'true';

function computeSMA(values, period) {
  const sma = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma[i] = sum / period;
  }
  return sma;
}

function computeSD(closes, sma, period) {
  const sd = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const mean = sma[i];
    const variance = closes.slice(i - period + 1, i + 1)
      .reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    sd[i] = Math.sqrt(variance);
  }
  return sd;
}

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

function evaluate(history, isCrypto = false) {
  const minBars = Math.max(TREND_PERIOD + 1, 22);
  if (!history || history.length < minBars) return 'NO_TRADE';

  const closes  = history.map(b => b.close);
  const opens   = history.map(b => b.open);
  const volumes = history.map(b => b.volume);

  const sma20   = computeSMA(closes, 20);
  const sd20    = computeSD(closes, sma20, 20);
  const rsi14   = computeRSI(closes, 14);

  const last = closes.length - 1;
  const prev = last - 1;

  const currentClose  = closes[last];
  const currentOpen   = opens[last];
  const currentSMA    = sma20[last];
  const currentSD     = sd20[last];
  const currentRSI    = rsi14[last];
  const prevRSI       = rsi14[prev];
  const currentVolume = volumes[last];

  if (currentSMA === null || currentSD === null || currentRSI === null) return 'NO_TRADE';

  // Volume filter (Bypassed in Aggressive Mode)
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeOK  = AGGRESSIVE || avgVolume === 0 || currentVolume >= avgVolume * VOL_MULTIPLIER;
  if (!volumeOK) return 'NO_TRADE';

  const upperBand = currentSMA + (2 * currentSD);
  const lowerBand = currentSMA - (2 * currentSD);

  // Buffer for "near touch" in aggressive mode
  const touchBuffer = AGGRESSIVE ? 1.015 : 1.001; // 1.5% buffer vs 0.1%

  // ── LONG: Oversold recovery ──
  const isOversold = currentClose <= lowerBand * touchBuffer;
  const rsiOK      = AGGRESSIVE ? currentRSI < 40 : currentRSI < 35;
  const momentumOK = AGGRESSIVE ? true : (prevRSI !== null && currentRSI > prevRSI);
  const bodyOK     = AGGRESSIVE ? true : currentClose > currentOpen;

  if (isOversold && rsiOK && momentumOK && bodyOK) {
    return 'LONG';
  }

  // ── SHORT: Overbought rejection ──
  const isOverbought = currentClose >= upperBand * (2 - touchBuffer);
  const rsiHigh      = AGGRESSIVE ? currentRSI > 60 : currentRSI > 65;

  if (!isCrypto && isOverbought && rsiHigh && momentumOK && bodyOK) {
    return 'SHORT';
  }

  return 'NO_TRADE';
}

module.exports = { evaluate, computeSMA, computeSD, computeRSI };
