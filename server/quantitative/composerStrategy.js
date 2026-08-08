const alpacaClient = require('../execution/alpacaClient');
const logger = require('../utils/logger');

const ALL_TICKERS = ['AGG', 'BIL', 'TLT', 'UUP', 'SOXL', 'TQQQ', 'UPRO', 'TECL', 'QID', 'TBF', 'UGL', 'TMF', 'BTAL', 'XLP'];

// Helper to calculate RSI
function calculateRSI(closes, periods = 14) {
  if (closes.length < periods + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= periods; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / periods;
  let avgLoss = losses / periods;

  for (let i = periods + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const currentGain = diff >= 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (periods - 1) + currentGain) / periods;
    avgLoss = (avgLoss * (periods - 1) + currentLoss) / periods;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function fetchHistoricalDailyCloses(symbol, days) {
  const client = alpacaClient.getClient();
  const start = new Date();
  start.setDate(start.getDate() - (days + 40)); // Generous buffer for weekends/holidays

  try {
    const iter = client.getBarsV2(symbol, {
      timeframe: '1Day',
      start: start.toISOString(),
      limit: days * 2 
    });

    const closes = [];
    for await (const b of iter) {
      closes.push(b.ClosePrice);
    }
    
    // Return only the last N days required
    return closes.slice(-days);
  } catch (err) {
    logger.error(`Failed to fetch daily bars for ${symbol}`, { error: err.message });
    return [];
  }
}

/**
 * Main Strategy Logic
 */
async function calculateTargetPortfolio() {
  logger.info('Calculating Composer Risk-On/Risk-Off Portfolio targets...');
  
  const data = {};
  for (const ticker of ALL_TICKERS) {
    // Need at least 61 days of data to calculate 60-day returns
    const closes = await fetchHistoricalDailyCloses(ticker, 70);
    if (closes.length < 61) {
      logger.warn(`Not enough historical data for ${ticker}, strategy might fail or be inaccurate`);
    }
    data[ticker] = closes;
  }

  // Calculate Returns
  const getReturn = (ticker, periods) => {
    const closes = data[ticker];
    if (closes.length < periods + 1) return 0;
    const current = closes[closes.length - 1];
    const past = closes[closes.length - 1 - periods];
    return (current - past) / past;
  };

  const agg_60d = getReturn('AGG', 60);
  const bil_60d = getReturn('BIL', 60);
  
  const tlt_20d = getReturn('TLT', 20);
  const bil_20d = getReturn('BIL', 20);

  const isRiskOn = agg_60d > bil_60d;
  const isRiskOffRising = tlt_20d < bil_20d;

  logger.info(`Macro Status: AGG 60d (${(agg_60d*100).toFixed(2)}%) vs BIL 60d (${(bil_60d*100).toFixed(2)}%)`);
  logger.info(`Macro Status: TLT 20d (${(tlt_20d*100).toFixed(2)}%) vs BIL 20d (${(bil_20d*100).toFixed(2)}%)`);

  let allocations = {};
  ALL_TICKERS.forEach(t => allocations[t] = 0.0);

  if (isRiskOn) {
    logger.info('Signal: 🟢 RISK ON');
    const candidates = ['SOXL', 'TQQQ', 'UPRO', 'TECL'];
    // For a 10-period RSI, we need 11 days of data
    const rsis = candidates.map(t => ({ ticker: t, rsi: calculateRSI(data[t].slice(-11), 10) }));
    rsis.sort((a, b) => a.rsi - b.rsi); // ascending, lowest first
    
    logger.info(`RSI(10) values: ${JSON.stringify(rsis)}`);
    allocations[rsis[0].ticker] = 0.5;
    allocations[rsis[1].ticker] = 0.5;
  } else if (isRiskOffRising) {
    logger.info('Signal: 🔴 RISK OFF (Rising Rates)');
    const candidates = ['QID', 'TBF'];
    // For a 20-period RSI, we need 21 days of data
    const rsis = candidates.map(t => ({ ticker: t, rsi: calculateRSI(data[t].slice(-21), 20) }));
    rsis.sort((a, b) => a.rsi - b.rsi); // ascending, lowest first
    
    logger.info(`RSI(20) values: ${JSON.stringify(rsis)}`);
    allocations['UUP'] = 0.5;
    allocations[rsis[0].ticker] = 0.5;
  } else {
    logger.info('Signal: 🟡 RISK OFF (Falling Rates)');
    allocations['UGL'] = 0.25;
    allocations['TMF'] = 0.25;
    allocations['BTAL'] = 0.25;
    allocations['XLP'] = 0.25;
  }

  // Filter out 0 allocations
  const targetPortfolio = {};
  for (const [ticker, weight] of Object.entries(allocations)) {
    if (weight > 0) targetPortfolio[ticker] = weight;
  }
  
  logger.info(`Target Portfolio Weights: ${JSON.stringify(targetPortfolio)}`);
  return targetPortfolio;
}

module.exports = { calculateTargetPortfolio, ALL_TICKERS };
