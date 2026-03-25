const { getQuote, getOHLCVWithIndicators, getSymbolNews } = require('./yahooFinance');
const { scrapeForSymbol } = require('./newsScraper');
const logger = require('../utils/logger');

// Period for historical bars: ~3 months back
function getPeriod1() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate all data for a symbol into a single research bundle.
 * Returns null if critical data is unavailable.
 */
async function aggregate(symbol) {
  logger.info('Aggregating data', { symbol });

  const [quoteResult, indicatorsResult, yahooNews, rssNews] = await Promise.allSettled([
    getQuote(symbol),
    getOHLCVWithIndicators(symbol, getPeriod1(), '1d'),
    getSymbolNews(symbol),
    scrapeForSymbol(symbol, 6),
  ]);

  if (quoteResult.status === 'rejected') {
    logger.error('Failed to get quote — skipping symbol', { symbol, error: quoteResult.reason?.message });
    return null;
  }

  const quote      = quoteResult.value;
  const indicators = indicatorsResult.status === 'fulfilled' ? indicatorsResult.value : null;
  const yhNews     = yahooNews.status === 'fulfilled' ? yahooNews.value : [];
  const rss        = rssNews.status === 'fulfilled' ? rssNews.value : [];

  // Merge and deduplicate headlines
  const allHeadlines = [
    ...yhNews.map(n => ({ title: n.title, source: 'Yahoo Finance' })),
    ...rss.map(n => ({ title: n.title, source: n.source })),
  ].slice(0, 12);

  const bundle = {
    symbol,
    timestamp: new Date().toISOString(),
    // Price data
    price:     quote.price,
    changePct: quote.changePct,
    volume:    quote.volume,
    high:      quote.high,
    low:       quote.low,
    // Indicators (from historical analysis)
    ema9:        indicators?.ema9 ?? null,
    ema21:       indicators?.ema21 ?? null,
    rsi14:       indicators?.rsi14 ?? null,
    trend:       indicators?.trend ?? 'neutral',
    regime:      indicators?.regime ?? 'ranging',
    volumeTrend: indicators?.volumeTrend ?? 'stable',
    // News
    headlines: allHeadlines,
    headlineText: allHeadlines.map(h => h.title).join(' | '),
  };

  logger.info('Bundle ready', {
    symbol,
    price: bundle.price,
    trend: bundle.trend,
    rsi: bundle.rsi14,
    headlines: allHeadlines.length,
  });

  return bundle;
}

module.exports = { aggregate };
