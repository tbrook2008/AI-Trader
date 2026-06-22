const alpacaClient = require('../server/execution/alpacaClient');
const vwapReversion = require('../server/quantitative/vwapReversion');

async function run() {
  const client = alpacaClient.getClient();
  const start = new Date();
  start.setDate(start.getDate() - 3);

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

  console.log('Fetched', bars.length, 'bars');

  let history = [];
  let hits = 0;
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
    
    const isLower = currentCandle.low <= data.lowerBand;
    const isUpper = currentCandle.high >= data.upperBand;
    
    if (isLower || isUpper) {
      hits++;
    }
  }

  console.log('Total touches of SD bands:', hits);
}

run().catch(console.error);
