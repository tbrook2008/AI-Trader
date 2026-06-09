require('dotenv').config();
const { aggregate, isCryptoSymbol } = require('../data/dataAggregator');
const { execute }      = require('../execution/tradeExecutor');
const alpacaClient     = require('../execution/alpacaClient');
const { logDecision }  = require('../db/tradeLogger');
const killSwitch       = require('../risk/killSwitch');
const logger           = require('../utils/logger');
const { checkCorrelation } = require('../risk/correlation');

const SYMBOLS = (process.env.WATCHED_SYMBOLS || 'BTC/USD,ETH/USD,AAPL').split(',').map(s => s.trim());

const tickBuffer = {};

function startStream() {
  const client = alpacaClient.getClient();
  const stockStream  = client.data_stream_v2;
  const cryptoStream = client.crypto_stream_v1beta3;

  // Prevent MaxListenersExceededWarning on WebSocket reconnect loops
  stockStream.setMaxListeners  && stockStream.setMaxListeners(20);
  cryptoStream.setMaxListeners && cryptoStream.setMaxListeners(20);

  stockStream.onConnect(() => {
    logger.info('Connected to Alpaca Stock WebSocket');
    const stocks = SYMBOLS.filter(s => !isCryptoSymbol(s));
    if (stocks.length > 0) stockStream.subscribeForQuotes(stocks);
  });

  stockStream.onStockQuote(quote => {
    const midPrice = (quote.BidPrice + quote.AskPrice) / 2;
    handleTick(quote.Symbol || quote.S, midPrice, quote.BidSize + quote.AskSize, new Date(quote.Timestamp));
  });
  
  cryptoStream.onConnect(() => {
    logger.info('Connected to Alpaca Crypto WebSocket');
    const cryptos = SYMBOLS.filter(s => isCryptoSymbol(s));
    if (cryptos.length > 0) cryptoStream.subscribeForQuotes(cryptos);
  });

  cryptoStream.onCryptoQuote(quote => {
    const midPrice = (quote.BidPrice + quote.AskPrice) / 2;
    handleTick(quote.S, midPrice, quote.BidSize + quote.AskSize, new Date(quote.Timestamp));
  });

  cryptoStream.onError(err => logger.error('Alpaca Crypto WS Error', { error: err.message || err }));
  stockStream.onError(err => logger.error('Alpaca Stock WS Error', { error: err.message || err }));

  stockStream.connect();
  cryptoStream.connect();
  
  // To handle minute bar closures deterministically, we can use an interval 
  // that flushes the buffer at the top of every minute.
  setInterval(flushBars, 60000);
}

async function handleTick(symbol, price, size, timestamp) {
  if (!tickBuffer[symbol]) {
    tickBuffer[symbol] = {
      open: price, high: price, low: price, close: price, volume: size,
      minute: timestamp.getMinutes()
    };
  } else {
    const b = tickBuffer[symbol];
    b.high = Math.max(b.high, price);
    b.low = Math.min(b.low, price);
    b.close = price;
    b.volume += size;
  }
}

async function flushBars() {
  const snapshot = { ...tickBuffer };     // snapshot before clearing
  for (const symbol of Object.keys(snapshot)) {
    delete tickBuffer[symbol];            // clear buffer entry
    const bar = snapshot[symbol];
    if (!bar || typeof bar.close !== 'number') {
      logger.warn(`flushBars: invalid bar for ${symbol}, skipping`, { bar });
      continue;
    }
    logger.info(`Flushed 1-min bar for ${symbol}`, { close: bar.close, volume: bar.volume });
    await processSymbol(symbol, bar);
  }
}

async function processSymbol(symbol, latestBar) {
  try {
    if (killSwitch.isActive()) return;

    // 1. Aggregate market data
    const bundle = await aggregate(symbol, latestBar);
    if (!bundle) return;

    // 2. Correlation Check
    const correlationPass = await checkCorrelation(symbol);
    if (!correlationPass) {
      logger.info('Trade rejected due to high correlation with open positions', { symbol });
      return;
    }

    // 3. Execute purely based on math logic
    await execute({ bundle });

  } catch (err) {
    logger.error('Unhandled error in processSymbol', { symbol, error: err.message });
  }
}

module.exports = { startStream, processSymbol };
