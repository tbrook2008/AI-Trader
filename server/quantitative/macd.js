/**
 * server/quantitative/macd.js
 * v2.1 — Relaxed MACD Momentum Trigger
 * 
 * Relaxed constraints to ensure higher trade frequency while maintaining 
 * core momentum checks.
 */

const VOL_MULTIPLIER = parseFloat(process.env.VOLUME_SPIKE_MULTIPLIER || '0.8'); // Lowered from 1.0

function computeEMA(closes, period) {
  if (closes.length < period) return [];
  const k   = 2 / (period + 1);
  let ema   = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const emas = new Array(period - 1).fill(null);
  emas.push(ema);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    emas.push(ema);
  }
  return emas;
}

/**
 * Evaluate MACD for a momentum entry.
 *
 * Gates (Relaxed):
 * 1. Bullish/Bearish crossover OR MACD moving away from signal with high momentum
 * 2. Histogram acceleration
 * 3. Volume above 80% of 20-bar average
 * 4. Bar body confirmation (Directional candle)
 */
function evaluate(history, isCrypto = false) {
  if (!history || history.length < 35) return 'NO_TRADE';

  const closes  = history.map(b => b.close);
  const opens   = history.map(b => b.open);
  const volumes = history.map(b => b.volume);

  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);

  const macdLine = closes.map((_, i) =>
    (ema12[i] !== null && ema26[i] !== null) ? ema12[i] - ema26[i] : null
  );

  const validMacd = macdLine.filter(m => m !== null);
  if (validMacd.length < 9) return 'NO_TRADE';

  const signalEma  = computeEMA(validMacd, 9);
  const signalLine = new Array(closes.length - validMacd.length).fill(null).concat(signalEma);

  const last = closes.length - 1;
  const prev = last - 1;

  const currentMacd   = macdLine[last];
  const currentSignal = signalLine[last];
  const prevMacd      = macdLine[prev];
  const prevSignal    = signalLine[prev];

  if (currentMacd === null || currentSignal === null || prevMacd === null || prevSignal === null) {
    return 'NO_TRADE';
  }

  // Volume filter (Relaxed)
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeOK  = avgVolume === 0 || volumes[last] >= avgVolume * VOL_MULTIPLIER;
  if (!volumeOK) return 'NO_TRADE';

  const currentHistogram = currentMacd - currentSignal;
  const prevHistogram    = prevMacd - prevSignal;
  const currentBarBody   = closes[last] - opens[last];

  // ── LONG: Bullish ──
  const isBullishCrossover = prevMacd <= prevSignal && currentMacd > currentSignal;
  const isBullishContinuation = currentHistogram > prevHistogram && currentHistogram > 0 && prevHistogram > 0;
  
  if ((isBullishCrossover || isBullishContinuation) && currentBarBody > 0) {
    // REQUISITE: If not a crossover, histogram must be expanding significantly
    if (!isBullishCrossover && (currentHistogram <= prevHistogram * 1.1)) return 'NO_TRADE';
    return 'LONG';
  }

  // ── SHORT: Bearish ──
  const isBearishCrossover = prevMacd >= prevSignal && currentMacd < currentSignal;
  const isBearishContinuation = currentHistogram < prevHistogram && currentHistogram < 0 && prevHistogram < 0;

  if ((isBearishCrossover || isBearishContinuation) && currentBarBody < 0) {
    if (!isBearishCrossover && (currentHistogram >= prevHistogram * 1.1)) return 'NO_TRADE';
    return 'SHORT';
  }

  return 'NO_TRADE';
}

module.exports = { evaluate, computeEMA };
