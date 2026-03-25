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
      baseUrl:   isLive ? process.env.ALPACA_LIVE_URL : process.env.ALPACA_PAPER_URL,
      paper:     !isLive,
    });
    logger.info('Alpaca client initialized', { mode: isLive ? 'LIVE' : 'PAPER' });
  }
  return _client;
}

async function getAccount() {
  return getClient().getAccount();
}

async function getOpenPositions() {
  return getClient().getPositions();
}

/**
 * Submit a market order with stop-loss.
 * For crypto and forex, Alpaca uses 'notional' (dollar amount) instead of qty.
 */
async function submitOrder({ symbol, qty, side, stopPrice }) {
  const alpacaSymbol = normalizeSymbol(symbol);
  const isCrypto = isCryptoSymbol(symbol);

  const orderParams = {
    symbol:        alpacaSymbol,
    side:          side.toLowerCase(),   // 'buy' or 'sell'
    type:          'market',
    time_in_force: isCrypto ? 'gtc' : 'day',
  };

  if (isCrypto) {
    // Crypto uses fractional quantities
    orderParams.qty = qty;
  } else {
    orderParams.qty = Math.floor(qty);  // Stocks must be whole
  }

  // Attach stop-loss as a separate order after fill (bracket orders require premium)
  logger.info('Submitting order', { ...orderParams, stopPrice });
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
    status:   order.status,
    filledAt: order.filled_at,
    filledQty: order.filled_qty,
    avgPrice: order.filled_avg_price,
  };
}

async function cancelOrder(orderId) {
  return getClient().cancelOrder(orderId);
}

/**
 * Normalize symbol for Alpaca (BTC-USD → BTCUSD, etc.)
 */
function normalizeSymbol(symbol) {
  if (symbol.includes('-')) {
    const base = symbol.split('-')[0].toUpperCase();
    const quote = symbol.split('-')[1].toUpperCase();
    return `${base}${quote === 'USD' ? 'USD' : quote}`;
  }
  return symbol.toUpperCase();
}

function isCryptoSymbol(symbol) {
  const cryptos = ['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC'];
  const base = symbol.split('-')[0].toUpperCase();
  return cryptos.includes(base);
}

module.exports = { getClient, getAccount, getOpenPositions, submitOrder, getOrderStatus, cancelOrder };
