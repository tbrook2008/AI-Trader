const { scrapeForSymbol } = require('./newsScraper');
const alpacaClient = require('../execution/alpacaClient');
const logger = require('../utils/logger');

// Local buffer of historical bars to compute indicators
const barsHistory = {};

const CRYPTO_BASES = ['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC', 'XRP', 'MATIC'];

function isCryptoSymbol(symbol) {
  let base = symbol.split(/[-/]/)[0].toUpperCase();
  if (base.endsWith('USD') && base !== 'USD') {
    base = base.replace('USD', '');
  }
  return CRYPTO_BASES.includes(base);
}

function getSearchTerm(symbol) {
  const base = symbol.split(/[-/]/)[0].toUpperCase();
  const names = {
    BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', ADA: 'Cardano',
    DOGE: 'Dogecoin', AVAX: 'Avalanche', DOT: 'Polkadot', LINK: 'Chainlink',
    LTC: 'Litecoin', XRP: 'XRP', MATIC: 'Polygon',
  };
  return names[base] || symbol;
}

/**
 * Prime the historical bars using Alpaca REST API
 */
async function primeHistory(symbol) {
  if (barsHistory[symbol]) return; // Already primed

  logger.info(`Priming historical bars for ${symbol}...`);
  const client = alpacaClient.getClient();
  const isCrypto = isCryptoSymbol(symbol);
  
  // Get bars for the last 2 days to ensure we have enough data
  const start = new Date();
  start.setDate(start.getDate() - 2);
  
  try {
    let bars = [];
    if (isCrypto) {
      // Crypto: getCryptoBars returns Promise<Map<symbol, Bar[]>>
      // Crypto bars use PascalCase without 'Price' suffix: Close, High, Low, Open, Volume
      const resp = await client.getCryptoBars([symbol], {
        timeframe: '1Min',
        start: start.toISOString(),
        limit: 100
      });
      bars = resp.get(symbol) || [];
      barsHistory[symbol] = bars.map(b => ({
        open:   b.Open,
        high:   b.High,
        low:    b.Low,
        close:  b.Close,
        volume: b.Volume
      }));
    } else {
      // Stocks: getBarsV2 is an async iterable, NOT a Promise
      // Stock bars use PascalCase with 'Price' suffix: ClosePrice, HighPrice etc.
      const iter = client.getBarsV2(symbol, {
        timeframe: '1Min',
        start: start.toISOString(),
        limit: 100
      });
      for await (const b of iter) {
        bars.push({
          open:   b.OpenPrice,
          high:   b.HighPrice,
          low:    b.LowPrice,
          close:  b.ClosePrice,
          volume: b.Volume
        });
      }
      barsHistory[symbol] = bars;
    }
    logger.info(`Primed ${barsHistory[symbol].length} historical bars for ${symbol}`);
  } catch (err) {
    logger.error(`Failed to prime history for ${symbol}`, { error: err.message });
    barsHistory[symbol] = [];
  }
}

/**
 * Aggregate data and append the incoming live bar.
 */
async function aggregate(symbol, latestBar) {
  logger.info('Aggregating data from live bar', { symbol });

  const searchTerm = getSearchTerm(symbol);
  const isCrypto_  = isCryptoSymbol(symbol);

  // Prime history if needed
  if (!barsHistory[symbol]) {
    await primeHistory(symbol);
  }

  // Append new live bar
  barsHistory[symbol].push(latestBar);
  
  // Keep only the last 100 bars to prevent memory leaks
  if (barsHistory[symbol].length > 100) {
    barsHistory[symbol].shift();
  }

  const [rssNews] = await Promise.allSettled([
    scrapeForSymbol(searchTerm, 6),
  ]);

  const rss = rssNews.status === 'fulfilled' ? rssNews.value : [];
  const allHeadlines = rss.map(n => ({ title: n.title, source: n.source })).slice(0, 12);

  const bundle = {
    symbol,
    isCrypto: isCrypto_,
    timestamp: new Date().toISOString(),
    // Latest bar price data
    price:     latestBar.close,
    high:      latestBar.high,
    low:       latestBar.low,
    volume:    latestBar.volume,
    
    // Pass the full historical array to be used by the deterministic quantitative scripts
    history:   barsHistory[symbol],
    
    // News
    headlines:    allHeadlines,
    headlineText: allHeadlines.map(h => h.title).join(' | '),
  };

  return bundle;
}

module.exports = { aggregate, isCryptoSymbol, getSearchTerm, barsHistory };
