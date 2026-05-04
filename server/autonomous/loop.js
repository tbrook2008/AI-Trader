require('dotenv').config();
const { aggregate, isCryptoSymbol } = require('../data/dataAggregator');
const { runConsensus } = require('../ai/consensus');
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
  const stockStream = client.data_stream_v2;
  const cryptoStream = client.crypto_stream_v1beta3;

  stockStream.onConnect(() => {
    logger.info('Connected to Alpaca Stock WebSocket');
    const stocks = SYMBOLS.filter(s => !isCryptoSymbol(s));
    if (stocks.length > 0) stockStream.subscribeForTrades(stocks);
  });

  stockStream.onStockTrade(trade => handleTick(trade.Symbol, trade.Price, trade.Size, new Date(trade.Timestamp)));
  
  cryptoStream.onConnect(() => {
    logger.info('Connected to Alpaca Crypto WebSocket');
    const cryptos = SYMBOLS.filter(s => isCryptoSymbol(s)).map(s => s.replace('/', ''));
    if (cryptos.length > 0) cryptoStream.subscribeForTrades(cryptos);
  });

  cryptoStream.onCryptoTrade(trade => {
    // Re-add slash for our internal representation
    const symbol = SYMBOLS.find(s => s.replace('/', '') === trade.Symbol) || trade.Symbol;
    handleTick(symbol, trade.Price, trade.Size, new Date(trade.Timestamp));
  });

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
  const symbols = Object.keys(tickBuffer);
  for (const symbol of symbols) {
    const bar = tickBuffer[symbol];
    delete tickBuffer[symbol];
    
    // Process the completed minute bar
    logger.info(`Flushed 1-min bar for ${symbol}`, { close: bar.close, volume: bar.volume });
    await processSymbol(symbol, bar);
  }
}

async function processSymbol(symbol, latestBar) {
  try {
    if (killSwitch.isActive()) return;

    // 1. Aggregate market data + news
    const bundle = await aggregate(symbol, latestBar);
    if (!bundle) return;

    // 2. Run Regime Classification Consensus (Gemini + Ollama)
    const consensus = await runConsensus(bundle);

    // 3. Correlation Check
    const correlationPass = await checkCorrelation(symbol);
    if (!correlationPass) {
      logger.info('Trade rejected due to high correlation with open positions', { symbol });
      return;
    }

    // 4. Log the AI decision
    const decisionId = logDecision({
      symbol,
      geminiThesis:    consensus.nodeResults?.gemini?.thesis,
      ollamaSentiment: consensus.nodeResults?.ollama?.sentiment,
      compositeScore:  consensus.compositeScore,
      approved:        consensus.approved,
      direction:       consensus.regime, // Now logs the regime
      reason:          consensus.reason,
      nodesUsed:       consensus.nodesUsed,
    });

    // 5. Execute if approved
    if (consensus.approved) {
      // execute will now handle the quantitative execution trigger and ATR risk rails
      await execute({ bundle, consensus, decisionId });
    }

  } catch (err) {
    logger.error('Unhandled error in processSymbol', { symbol, error: err.message });
  }
}

module.exports = { startStream, processSymbol };
