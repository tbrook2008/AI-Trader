/**
 * VWAP Mean Reversion Strategy
 * 
 * 1. Calculate Daily Anchored VWAP and its +2 and -2 Standard Deviation bands.
 * 2. LONG Signal: Price touches or breaches -2 SD lower band, RSI(14) < 35, 
 *    current 1m candle closes GREEN (Close > Open), Volume > 1.2x 20-bar Volume SMA.
 *    Target: VWAP center line. Stop: 1.5 ATR below entry.
 * 3. SHORT Signal: Price touches or breaches +2 SD upper band, RSI(14) > 65, 
 *    current 1m candle closes RED (Close < Open), Volume > 1.2x 20-bar Volume SMA.
 *    Target: VWAP center line. Stop: 1.5 ATR above entry.
 */

const fs = require('fs');
const path = require('path');
const { computeADX, isTrending } = require('./adx');
const { calculateHurst } = require('./hurst');

let symbolParamsCache = null;
function getSymbolParams(symbol) {
  if (global.OPTIMIZE_PARAMS) return global.OPTIMIZE_PARAMS;
  if (!symbolParamsCache) {
    try {
      const p = path.join(__dirname, '../data/symbolParams.json');
      if (fs.existsSync(p)) symbolParamsCache = JSON.parse(fs.readFileSync(p, 'utf-8'));
      else symbolParamsCache = {};
    } catch (e) { symbolParamsCache = {}; }
  }
  return symbolParamsCache[symbol] || {};
}

/**
 * Parse timestamp into US Eastern Time (America/New_York)
 * @param {string|number|Date} ts
 * @returns {{ totalMinutes: number, timeVal: number, sessionTimeET: string } | null}
 */
function parseETTime(ts) {
  if (!ts) return null;
  let date;
  if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'number') {
    date = ts < 10000000000 ? new Date(ts * 1000) : new Date(ts);
  } else if (typeof ts === 'string') {
    date = new Date(ts);
  } else {
    return null;
  }

  if (isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  let hour = null;
  let minute = null;
  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
  }

  if (hour === null || minute === null) return null;
  if (hour === 24) hour = 0;

  const totalMinutes = hour * 60 + minute;
  const timeVal = hour * 100 + minute;
  const formattedHour = String(hour).padStart(2, '0');
  const formattedMinute = String(minute).padStart(2, '0');
  const sessionTimeET = `${formattedHour}:${formattedMinute}`;

  return { totalMinutes, timeVal, sessionTimeET };
}

/**
 * Calculate RSI (14 period)
 */
function calculateRSI(candles, period = 14) {
    if (candles.length <= period) return null;

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        let change = candles[i].close - candles[i - 1].close;
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss -= change;
        }
    }

    avgGain /= period;
    avgLoss /= period;

    for (let i = period + 1; i < candles.length; i++) {
        let change = candles[i].close - candles[i - 1].close;
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? -change : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) return 100;
    let rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

/**
 * Calculate Volume SMA
 */
function calculateVolumeSMA(candles, period = 20) {
    if (candles.length < period) return null;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        sum += candles[i].volume;
    }
    return sum / period;
}

/**
 * Calculate ATR
 */
function calculateATR(candles, period = 14) {
    if (candles.length <= period) return null;

    let trs = [];
    for (let i = 1; i < candles.length; i++) {
        let high = candles[i].high;
        let low = candles[i].low;
        let prevClose = candles[i - 1].close;

        let tr = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        trs.push(tr);
    }

    let atr = 0;
    for (let i = 0; i < period; i++) {
        atr += trs[i];
    }
    atr /= period;

    for (let i = period; i < trs.length; i++) {
        atr = (atr * (period - 1) + trs[i]) / period;
    }

    return atr;
}

/**
 * Calculate Daily Anchored VWAP and SD Bands
 */
function calculateVWAP(candles) {
    if (!candles || candles.length === 0) return null;

    // Anchor VWAP to the start of the current day for the last candle.
    let lastCandle = candles[candles.length - 1];
    let lastTime = lastCandle.timestamp || lastCandle.time;
    if (typeof lastTime === 'string') lastTime = new Date(lastTime).getTime();
    else if (typeof lastTime === 'number' && lastTime < 10000000000) lastTime *= 1000;
    
    let lastDate = new Date(lastTime);
    // Start of the day in local time or UTC (using local time logic here)
    let startOfDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate()).getTime();

    let cumulativePV = 0;
    let cumulativeVolume = 0;

    let dailyCandles = [];
    
    for (let i = 0; i < candles.length; i++) {
        let cTime = candles[i].timestamp || candles[i].time;
        if (typeof cTime === 'string') cTime = new Date(cTime).getTime();
        else if (typeof cTime === 'number' && cTime < 10000000000) cTime *= 1000;
        
        if (cTime >= startOfDay) {
            dailyCandles.push(candles[i]);
            let typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
            cumulativePV += typicalPrice * candles[i].volume;
            cumulativeVolume += candles[i].volume;
        }
    }

    if (cumulativeVolume === 0 || dailyCandles.length === 0) return null;

    let vwap = cumulativePV / cumulativeVolume;

    let cumulativeVariance = 0;
    for (let i = 0; i < dailyCandles.length; i++) {
        let typicalPrice = (dailyCandles[i].high + dailyCandles[i].low + dailyCandles[i].close) / 3;
        cumulativeVariance += dailyCandles[i].volume * Math.pow(typicalPrice - vwap, 2);
    }

    let variance = cumulativeVariance / cumulativeVolume;
    let sd = Math.sqrt(variance);

    const sdMultiplier = getSymbolParams(candles[0].symbol || 'SPY').sdMultiplier || 2.0;

    const atr = calculateATR(candles, 14);

    return {
        vwap: vwap,
        upperBand: vwap + sdMultiplier * sd,
        lowerBand: vwap - sdMultiplier * sd,
        upperBand1SD: vwap + sd,
        lowerBand1SD: vwap - sd,
        sd: sd,
        atr: atr
    };
}

/**
 * Evaluates the history of 1m candles for VWAP Mean Reversion signals
 * @param {Array} history - Array of 1m candle objects {open, high, low, close, volume, timestamp}
 * @returns {Object|null} Signal object or null
 */
function evaluate(history) {
    // Need at least 30 bars of history for ADX and Hurst indicators
    if (!history || history.length < 30) {
        return null;
    }

    const currentCandle = history[history.length - 1];

    // R2 Time-of-Day Filter (ignore signals before 10:15 AM ET, i.e. timeVal < 1015 or totalMinutes < 615)
    const timestamp = currentCandle.timestamp || currentCandle.time;
    const etTime = parseETTime(timestamp);
    if (!etTime || etTime.timeVal < 1015) {
        return null;
    }

    // R1 Macro Regime Filter (reject when ADX >= 25 or Hurst > 0.55)
    const adx = computeADX(history, 14);
    const hurst = calculateHurst(history);
    if ((adx !== null && adx >= 25) || (hurst !== null && hurst > 0.55)) {
        return null;
    }

    const vwapData = calculateVWAP(history);
    if (!vwapData) return null;

    const rsi = calculateRSI(history, 14);
    if (rsi === null) return null;

    const volumeSMA = calculateVolumeSMA(history, 20);
    if (volumeSMA === null) return null;

    const atr = calculateATR(history, 14);
    if (atr === null) return null;

    const { vwap, upperBand, lowerBand, sd } = vwapData;

    // R3 VWAP Band Squeeze Validator (distance |vwap - close| must be > 1.5 * atr)
    if (Math.abs(vwap - currentCandle.close) <= 1.5 * atr) {
        return null;
    }

    const params = getSymbolParams(history[0].symbol || 'SPY');
    const rsiOversold = params.rsiOversold || 35;
    const rsiOverbought = params.rsiOverbought || 65;
    const volumeReq = params.minVolumeRatio || 1.2;
    const slMultiplier = params.stopLossMultiplier || 1.5;

    const isHighVolume = currentCandle.volume >= (volumeReq * volumeSMA);
    const upperBand1SD = vwap + sd;
    const lowerBand1SD = vwap - sd;

    // LONG Signal
    const extendedBelow = currentCandle.close <= lowerBand;
    if (extendedBelow && rsi <= rsiOversold && isHighVolume) {
        const scaleOutTarget = lowerBand1SD;
        return {
            action: 'LONG',
            entry: currentCandle.close,
            target: vwap,
            scaleOutTarget: scaleOutTarget,
            stopLoss: currentCandle.close - (slMultiplier * atr),
            metadata: {
                rsi,
                vwap,
                lowerBand,
                upperBand,
                upperBand1SD,
                lowerBand1SD,
                scaleOutTarget,
                volume: currentCandle.volume,
                volumeSMA,
                atr,
                adx,
                hurst,
                sessionTimeET: etTime.sessionTimeET
            }
        };
    }

    // SHORT Signal
    const extendedAbove = currentCandle.close >= upperBand;
    if (extendedAbove && rsi >= rsiOverbought && isHighVolume) {
        const scaleOutTarget = upperBand1SD;
        return {
            action: 'SHORT',
            entry: currentCandle.close,
            target: vwap,
            scaleOutTarget: scaleOutTarget,
            stopLoss: currentCandle.close + (slMultiplier * atr),
            metadata: {
                rsi,
                vwap,
                lowerBand,
                upperBand,
                upperBand1SD,
                lowerBand1SD,
                scaleOutTarget,
                volume: currentCandle.volume,
                volumeSMA,
                atr,
                adx,
                hurst,
                sessionTimeET: etTime.sessionTimeET
            }
        };
    }

    return null;
}

module.exports = {
    calculateVWAP,
    calculateRSI,
    calculateVolumeSMA,
    calculateATR,
    evaluate
};

