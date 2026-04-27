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
 * Staggered sleep to avoid Yahoo Finance rate limits when scanning many symbols.
 * Configurable via SYMBOL_FETCH_DELAY_MS env (default 3000ms between symbols).
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FETCH_DELAY_MS = parseInt(process.env.SYMBOL_FETCH_DELAY_MS || '3000');

// ─────────────────────────────────────────────────────────────
// Symbol normalization helpers
// Internal format: BTC/USD (Alpaca crypto format)
// Yahoo Finance format: BTC-USD
// Stock symbols: unchanged (SPY, AAPL, etc.)
// ─────────────────────────────────────────────────────────────

const CRYPTO_BASES = ['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC', 'XRP', 'MATIC'];

function isCryptoSymbol(symbol) {
  const base = symbol.split(/[-/]/)[0].toUpperCase();
  return CRYPTO_BASES.includes(base);
}

/**
 * Convert internal symbol to Yahoo Finance format.
 * BTC/USD → BTC-USD, ETH/USD → ETH-USD, SPY → SPY
 */
function toYahooSymbol(symbol) {
  if (isCryptoSymbol(symbol)) {
    // Yahoo Finance uses BTC-USD format
    const base = symbol.split(/[-/]/)[0].toUpperCase();
    return `${base}-USD`;
  }
  return symbol.toUpperCase();
}

/**
 * Get a short human-readable name for news searches.
 * BTC/USD → Bitcoin, ETH/USD → Ethereum, SPY → SPY
 */
function getSearchTerm(symbol) {
  const base = symbol.split(/[-/]/)[0].toUpperCase();
  const names = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    SOL: 'Solana',
    ADA: 'Cardano',
    DOGE: 'Dogecoin',
    AVAX: 'Avalanche',
    DOT: 'Polkadot',
    LINK: 'Chainlink',
    LTC: 'Litecoin',
    XRP: 'XRP',
    MATIC: 'Polygon',
  };
  return names[base] || symbol;
}

/**
 * Aggregate all data for a symbol into a single research bundle.
 * Returns null if critical data is unavailable.
 *
 * Supports both:
 *   - Crypto: BTC/USD, ETH/USD, SOL/USD (translates to Yahoo BTC-USD format)
 *   - Stocks: SPY, AAPL, TSLA (passed through unchanged)
 */
async function aggregate(symbol) {
  logger.info('Aggregating data', { symbol });

  const yahooSymbol  = toYahooSymbol(symbol);
  const searchTerm   = getSearchTerm(symbol);
  const issCrypto    = isCryptoSymbol(symbol);

  logger.info('Symbol resolved', { internal: symbol, yahoo: yahooSymbol, isCrypto: issCrypto });

  const [quoteResult, indicatorsResult, yahooNews, rssNews] = await Promise.allSettled([
    getQuote(yahooSymbol),
    getOHLCVWithIndicators(yahooSymbol, getPeriod1(), '1d'),
    getSymbolNews(yahooSymbol),
    scrapeForSymbol(searchTerm, 6),   // Use human-readable term for RSS scraping
  ]);

  if (quoteResult.status === 'rejected') {
    logger.error('Failed to get quote — skipping symbol', {
      symbol,
      yahooSymbol,
      error: quoteResult.reason?.message,
    });
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
    symbol,              // Always use internal symbol (BTC/USD, SPY) as the canonical identifier
    yahooSymbol,         // Yahoo-format (BTC-USD, SPY) — used by Alpaca order normalizer
    isCrypto: issCrypto,
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
    headlines:    allHeadlines,
    headlineText: allHeadlines.map(h => h.title).join(' | '),
  };

  logger.info('Bundle ready', {
    symbol,
    isCrypto: issCrypto,
    price:    bundle.price,
    trend:    bundle.trend,
    rsi:      bundle.rsi14,
    headlines: allHeadlines.length,
  });

  return bundle;
}

module.exports = { aggregate, isCryptoSymbol, toYahooSymbol };
