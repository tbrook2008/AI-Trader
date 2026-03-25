const Parser = require('rss-parser');
const logger = require('../utils/logger');

const parser = new Parser({ timeout: 8000, maxRedirects: 3 });

const FEEDS = [
  { name: 'Reuters Markets',    url: 'https://feeds.reuters.com/reuters/businessNews' },
  { name: 'Yahoo Finance',       url: 'https://finance.yahoo.com/news/rssindex' },
  { name: 'MarketWatch',         url: 'https://feeds.marketwatch.com/marketwatch/topstories' },
  { name: 'Seeking Alpha',       url: 'https://seekingalpha.com/market_currents.xml' },
  { name: 'Benzinga',            url: 'https://www.benzinga.com/feed' },
  { name: 'Investing.com',       url: 'https://www.investing.com/rss/news.rss' },
];

/**
 * Fetch one RSS feed, return items or [] on failure.
 */
async function fetchFeed(feed) {
  try {
    const data = await Promise.race([
      parser.parseURL(feed.url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    return (data.items || []).slice(0, 15).map(item => ({
      source: feed.name,
      title: item.title || '',
      summary: (item.contentSnippet || item.content || '').slice(0, 300),
      link: item.link || '',
      date: item.isoDate || item.pubDate || new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn(`RSS feed failed: ${feed.name}`, { error: err.message });
    return [];
  }
}

/**
 * Normalize a symbol for text matching (e.g. BTC-USD → btc).
 */
function getSearchTerms(symbol) {
  const base = symbol.split('-')[0].split('/')[0].toLowerCase();
  const terms = [base];
  // Map common tickers to company names
  const names = {
    aapl: 'apple', tsla: 'tesla', spy: 's&p', btc: 'bitcoin',
    eth: 'ethereum', nvda: 'nvidia', msft: 'microsoft', amzn: 'amazon',
    googl: 'google', meta: 'meta', qqq: 'nasdaq',
  };
  if (names[base]) terms.push(names[base]);
  return terms;
}

function isRelevant(item, terms) {
  const text = (item.title + ' ' + item.summary).toLowerCase();
  return terms.some(t => text.includes(t));
}

/**
 * Scrape all feeds and return articles relevant to a symbol.
 * @param {string} symbol
 * @param {number} limit  max articles to return
 */
async function scrapeForSymbol(symbol, limit = 8) {
  const allItems = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const terms = getSearchTerms(symbol);

  const relevant = allItems
    .filter(item => isRelevant(item, terms))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

  logger.info('News scraped', { symbol, total: allItems.length, relevant: relevant.length });
  return relevant;
}

/**
 * Scrape all feeds and return general market news (not symbol-specific).
 */
async function scrapeMarketNews(limit = 10) {
  const allItems = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  return allItems
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

module.exports = { scrapeForSymbol, scrapeMarketNews };
