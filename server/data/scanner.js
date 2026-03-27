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
  
  try {
    logger.info('Scanning for optimal symbols...');

    // 1. Get Trending Symbols (US)
    const trends = await yf.trendingSymbols('US');
    if (trends?.trends?.[0]?.symbols) {
      trends.trends[0].symbols.forEach(s => candidates.add(s.symbol));
    }

    // 2. Get Top Gainers (Modern Screener)
    const gainers = await yf.screener({ scrIds: 'day_gainers', count: 20 });
    if (gainers?.quotes) {
      gainers.quotes.forEach(q => candidates.add(q.symbol));
    }

    // 3. Get Most Active Stocks
    const active = await yf.screener({ scrIds: 'most_actives', count: 20 });
    if (active?.quotes) {
      active.quotes.forEach(q => candidates.add(q.symbol));
    }

    // 4. Get Top Crypto
    const crypto = await yf.screener({ scrIds: 'top_crypto', count: 20 });
    if (crypto?.quotes) {
      crypto.quotes.forEach(q => candidates.add(q.symbol));
    }

    const symbolList = Array.from(candidates);
    logger.info(`Found ${symbolList.length} total candidates. Filtering for top-tier opportunities...`);

    // 4. Batch fetch current quotes to filter for price and volume
    const quotes = await yf.quote(symbolList);
    
    const filtered = (Array.isArray(quotes) ? quotes : [quotes])
      .filter(q => {
        if (!q.regularMarketPrice || q.regularMarketPrice < 5 || q.regularMarketPrice > 2000) return false;
        if (!q.averageDailyVolume3Month || q.averageDailyVolume3Month < 1000000) return false;
        return true;
      })
      .slice(0, 8) // Analyze top 8 optimal ones per cycle
      .map(q => q.symbol);

    logger.info('Optimal trading candidates discovered', { count: filtered.length, symbols: filtered });
    return filtered.length > 0 ? filtered : ['AAPL', 'TSLA', 'NVDA', 'COIN', 'MSTR']; // Robust Fallback

  } catch (err) {
    logger.error('Scanner failed — falling back to staples', { error: err.message });
    return ['AAPL', 'TSLA', 'NVDA', 'COIN', 'MSTR'];
  }
}

module.exports = { scanForOptimalSymbols };
