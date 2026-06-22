function aggregateCandles(history1m, timeframeMinutes) {
  if (!history1m || history1m.length === 0) return [];
  const aggregated = [];
  let currentCandle = null;

  for (const bar of history1m) {
    const timestamp = new Date(bar.timestamp).getTime();
    // Round down timestamp to the nearest timeframe block
    const msPerTimeframe = timeframeMinutes * 60 * 1000;
    const blockStart = Math.floor(timestamp / msPerTimeframe) * msPerTimeframe;

    if (!currentCandle || currentCandle.timestamp !== new Date(blockStart).toISOString()) {
      if (currentCandle) {
        aggregated.push(currentCandle);
      }
      currentCandle = {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        timestamp: new Date(blockStart).toISOString()
      };
    } else {
      currentCandle.high = Math.max(currentCandle.high, bar.high);
      currentCandle.low = Math.min(currentCandle.low, bar.low);
      currentCandle.close = bar.close;
      currentCandle.volume += bar.volume;
    }
  }

  if (currentCandle) {
    aggregated.push(currentCandle);
  }

  return aggregated;
}

function calculateEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data[0].close; // Simple initialization
  for (let i = 1; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
  }
  return ema;
}

module.exports = { aggregateCandles, calculateEMA };
