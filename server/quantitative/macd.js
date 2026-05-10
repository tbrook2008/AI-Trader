/**
 * server/quantitative/macd.js
 * v2.2 — MACD Momentum Trigger (Aggressive Mode Support)
 */

const VOL_MULTIPLIER = parseFloat(process.env.VOLUME_SPIKE_MULTIPLIER || '0.7');
const AGGRESSIVE     = process.env.AGGRESSIVE_MODE === 'true';

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

  // Volume filter (Bypassed in Aggressive Mode)
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volumeOK  = AGGRESSIVE || avgVolume === 0 || volumes[last] >= avgVolume * VOL_MULTIPLIER;
  if (!volumeOK) return 'NO_TRADE';

  const currentHistogram = currentMacd - currentSignal;
  const prevHistogram    = prevMacd - prevSignal;
  const currentBarBody   = closes[last] - opens[last];

  // ── LONG: Bullish ──
  const isBullishCrossover = prevMacd <= prevSignal && currentMacd > currentSignal;
  const isBullishContinuation = currentHistogram > prevHistogram && currentHistogram > 0;
  
  // In AGGRESSIVE mode, we don't strictly require a positive candle body if it's a strong crossover
  const bodyConfirmation = AGGRESSIVE ? true : currentBarBody > 0;

  if ((isBullishCrossover || (AGGRESSIVE && isBullishContinuation)) && bodyConfirmation) {
    return 'LONG';
  }

  // ── SHORT: Bearish ──
  const isBearishCrossover = prevMacd >= prevSignal && currentMacd < currentSignal;
  const isBearishContinuation = currentHistogram < prevHistogram && currentHistogram < 0;

  if ((isBearishCrossover || (AGGRESSIVE && isBearishContinuation)) && bodyConfirmation) {
    return 'SHORT';
  }

  return 'NO_TRADE';
}

module.exports = { evaluate, computeEMA };
