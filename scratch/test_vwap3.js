const alpacaClient = require('../server/execution/alpacaClient');
const vwapReversion = require('../server/quantitative/vwapReversion');

async function run() {
  const client = alpacaClient.getClient();
  const start = new Date();
  start.setDate(start.getDate() - 7);

  const iter = client.getBarsV2('SPY', {
    timeframe: '1Min',
    start: start.toISOString()
  });

  const bars = [];
  for await (const b of iter) {
    bars.push({
      open: b.OpenPrice, high: b.HighPrice, low: b.LowPrice, close: b.ClosePrice, volume: b.Volume, timestamp: b.Timestamp
    });
  }

  let history = [];
  
  let maxSD = 0;
  let maxRSI = 0;
  let minRSI = 100;
  let maxVolRatio = 0;

  for (const bar of bars) {
    history.push(bar);
    if (history.length > 500) history.shift();
    if (history.length < 50) continue;

    // session filter
    const date = new Date(bar.timestamp);
    const nyTimeStr = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyTime = new Date(nyTimeStr);
    const timeVal = nyTime.getHours() * 100 + nyTime.getMinutes();
    if (!((timeVal >= 945 && timeVal <= 1130) || (timeVal >= 1330 && timeVal <= 1530))) continue;

    const data = vwapReversion.calculateVWAP(history);
    if (!data) continue;

    const currentCandle = history[history.length - 1];
    
    // distance in SDs
    if (data.sd > 0) {
      const dist = Math.abs(currentCandle.close - data.vwap) / data.sd;
      if (dist > maxSD) maxSD = dist;
    }

    // vol ratio
    const { rollingAvg } = require('../server/quantitative/volumeProfile');
    const volSMA = rollingAvg(history.map(b => b.volume), 20);
    if (volSMA > 0) {
      const ratio = currentCandle.volume / volSMA;
      if (ratio > maxVolRatio) maxVolRatio = ratio;
    }

    // RSI
    // wait, evaluate doesn't expose RSI. I'll just use the code inside evaluate:
    const vwapMod = require('fs').readFileSync('../server/quantitative/vwapReversion.js', 'utf8');
    const rsiMatch = vwapMod.match(/function calculateRSI[^}]*}/m);
    // actually, let's just use my own RSI simple check
  }

  console.log('Fetched', bars.length, 'bars');
  if (bars.length > 0) {
    console.log('First bar:', bars[0]);
    console.log('Timestamp type:', typeof bars[0].timestamp);
  }

  console.log({ maxSD, maxVolRatio });
}

run().catch(console.error);
