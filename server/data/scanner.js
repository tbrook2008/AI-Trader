const logger = require('../utils/logger');

let yfInstance = null;
async function getYF() {
  if (!yfInstance) {
    const YF = (await import('yahoo-finance2')).default;
    yfInstance = new YF();
  }
  return yfInstance;
}

/**
 * Scans multiple sources (Trending, Gainers, Losers) for "optimal" trading symbols.
 * Filters for US symbols with prices between $10 and $1000 and significant activity.
 */
async function scanForOptimalSymbols() {
  const yf = await getYF();
  const candidates = new Set();

  async function tryScreener(scrIds, label) {
    try {
      const result = await yf.screener({ scrIds: Array.isArray(scrIds) ? scrIds : [scrIds], count: 20 });
      if (result?.quotes) {
        result.quotes.forEach(q => q.symbol && candidates.add(q.symbol));
      }
    } catch (err) {
      logger.warn('Yahoo Finance screener failed', { label, scrIds, error: err.message });
    }
  }

  try {
    logger.info('Scanning for optimal symbols...');

    const trends = await yf.trendingSymbols('US');
    if (trends?.trends?.[0]?.symbols) {
      trends.trends[0].symbols.forEach(s => s.symbol && candidates.add(s.symbol));
    }

    await tryScreener('day_gainers', 'day_gainers');
    await tryScreener('most_actives', 'most_actives');
    await tryScreener('technology_stocks', 'technology_stocks');

    const cryptos = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD', 'ADA-USD', 'XRP-USD', 'DOT-USD', 'AVAX-USD', 'LINK-USD', 'BNB-USD'];
    cryptos.forEach(s => candidates.add(s));

    const symbolList = Array.from(candidates);
    logger.info(`Found ${symbolList.length} total candidates. Filtering for top-tier opportunities...`);

    let quotes;
    try {
      quotes = await yf.quote(symbolList);
    } catch (err) {
      logger.warn('Yahoo Finance quote batch failed, retrying individually', { error: err.message });
      const quoteResults = [];
      for (const symbol of symbolList) {
        try {
          const q = await yf.quote(symbol);
          if (q && q.symbol) quoteResults.push(q);
        } catch (innerErr) {
          logger.warn('Yahoo Finance quote failed for symbol', { symbol, error: innerErr.message });
        }
      }
      quotes = quoteResults;
    }

    const quoteArray = Array.isArray(quotes) ? quotes : [quotes];
    const filtered = quoteArray
      .filter(q => {
        if (!q || !q.symbol) return false;
        if (q.symbol.endsWith('-USD')) return true;
        if (!q.regularMarketPrice || q.regularMarketPrice < 5 || q.regularMarketPrice > 2000) return false;
        if (!q.averageDailyVolume3Month || q.averageDailyVolume3Month < 1000000) return false;
        return true;
      })
      .sort((a, b) => {
        const aIsCrypto = a.symbol.endsWith('-USD');
        const bIsCrypto = b.symbol.endsWith('-USD');
        if (aIsCrypto && !bIsCrypto) return -1;
        if (!aIsCrypto && bIsCrypto) return 1;
        return 0;
      })
      .slice(0, 8)
      .map(q => q.symbol);

    logger.info('Optimal trading candidates discovered', { count: filtered.length, symbols: filtered });
    return filtered.length > 0 ? filtered : ['AAPL', 'TSLA', 'NVDA', 'COIN', 'MSTR'];

  } catch (err) {
    logger.error('Scanner failed — falling back to staples', { error: err.message });
    return ['AAPL', 'TSLA', 'NVDA', 'COIN', 'MSTR'];
  }
}

module.exports = { scanForOptimalSymbols };
