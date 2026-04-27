/**
 * server/execution/alpacaClient.js
 * Alpaca SDK v3 wrapper — paper & live trading.
 * v3 uses named exports from '@alpacahq/alpaca-trade-api'.
 */
require('dotenv').config();
const Alpaca = require('@alpacahq/alpaca-trade-api');
const logger = require('../utils/logger');

let _client = null;

function getClient() {
  if (!_client) {
    const isLive = (process.env.TRADING_MODE || 'paper') === 'live';
    _client = new Alpaca({
      keyId:     process.env.ALPACA_API_KEY,
      secretKey: process.env.ALPACA_SECRET_KEY,
      paper:     !isLive,
    });
    logger.info('Alpaca client initialized', { mode: isLive ? 'LIVE' : 'PAPER' });
  }
  return _client;
}

/**
 * Fetch the live Alpaca account — use portfolio_value for Kelly sizing.
 */
async function getAccount() {
  const account = await getClient().getAccount();
  return {
    portfolioValue:   parseFloat(account.portfolio_value),
    buyingPower:      parseFloat(account.buying_power),
    cash:             parseFloat(account.cash),
    equity:           parseFloat(account.equity),
    daytradeCount:    parseInt(account.daytrade_count || 0),
    patternDayTrader: account.pattern_day_trader,
    tradingBlocked:   account.trading_blocked,
    status:           account.status,
  };
}

/**
 * Fetch all open positions.
 */
async function getOpenPositions() {
  const positions = await getClient().getPositions();
  return positions.map(p => ({
    symbol:      p.symbol,
    qty:         parseFloat(p.qty),
    side:        p.side,
    marketValue: parseFloat(p.market_value),
    avgEntry:    parseFloat(p.avg_entry_price),
    unrealizedPL: parseFloat(p.unrealized_pl),
    unrealizedPLPct: parseFloat(p.unrealized_plpc),
  }));
}

/**
 * Close a specific open position (market order).
 */
async function closePosition(symbol) {
  const alpacaSymbol = normalizeSymbol(symbol);
  logger.info('Closing position', { symbol: alpacaSymbol });
  try {
    await getClient().closePosition(alpacaSymbol);
    logger.info('Position closed', { symbol: alpacaSymbol });
    return { closed: true };
  } catch (err) {
    logger.error('Failed to close position', { symbol: alpacaSymbol, error: err.message });
    return { closed: false, reason: err.message };
  }
}

/**
 * Submit a bracket order (entry + stop-loss + take-profit in one atomic order).
 * Alpaca paper trading fully supports bracket orders.
 */
async function submitOrder({ symbol, qty, side, stopPrice, takeProfitPrice }) {
  const alpacaSymbol = normalizeSymbol(symbol);
  const isCrypto     = isCryptoSymbol(symbol);

  const orderParams = {
    symbol:        alpacaSymbol,
    side:          side.toLowerCase(),
    type:          'market',
    time_in_force: isCrypto ? 'gtc' : 'day',
    order_class:   'bracket',
  };

  // Crypto uses fractional qty; stocks must be whole shares
  orderParams.qty = isCrypto ? qty : Math.floor(qty);

  // Bracket legs — these trigger after fill
  if (stopPrice) {
    orderParams.stop_loss = { stop_price: stopPrice.toFixed(2) };
  }
  if (takeProfitPrice) {
    orderParams.take_profit = { limit_price: takeProfitPrice.toFixed(2) };
  }

  logger.info('Submitting bracket order', { ...orderParams });

  const order = await getClient().createOrder(orderParams);

  return {
    orderId:   order.id,
    clientId:  order.client_order_id,
    symbol:    order.symbol,
    qty:       order.qty,
    side:      order.side,
    type:      order.type,
    status:    order.status,
    createdAt: order.created_at,
  };
}

async function getOrderStatus(orderId) {
  const order = await getClient().getOrder(orderId);
  return {
    status:    order.status,
    filledAt:  order.filled_at,
    filledQty: order.filled_qty,
    avgPrice:  order.filled_avg_price,
  };
}

async function cancelOrder(orderId) {
  return getClient().cancelOrder(orderId);
}

/**
 * Normalize symbol for Alpaca (BTC-USD → BTC/USD for crypto).
 */
function normalizeSymbol(symbol) {
  if (isCryptoSymbol(symbol)) {
    // Alpaca v3 crypto uses BTC/USD format
    const base = symbol.split(/[-/]/)[0].toUpperCase();
    return `${base}/USD`;
  }
  return symbol.toUpperCase();
}

function isCryptoSymbol(symbol) {
  const cryptos = ['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC'];
  const base = symbol.split(/[-/]/)[0].toUpperCase();
  return cryptos.includes(base);
}

module.exports = {
  getClient,
  getAccount,
  getOpenPositions,
  closePosition,
  submitOrder,
  getOrderStatus,
  cancelOrder,
};
