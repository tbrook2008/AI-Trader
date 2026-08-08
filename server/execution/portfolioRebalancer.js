const alpacaClient = require('./alpacaClient');
const logger = require('../utils/logger');
const { calculateTargetPortfolio, ALL_TICKERS } = require('../quantitative/composerStrategy');

const COMPOSER_CAPITAL_ALLOCATION = parseFloat(process.env.COMPOSER_ALLOCATION || '0.50');

async function rebalancePortfolio() {
  logger.info(`[Composer Rebalancer] Starting daily portfolio rebalance. Allocation: ${COMPOSER_CAPITAL_ALLOCATION*100}% of portfolio.`);

  try {
    // 1. Get targets
    const targetWeights = await calculateTargetPortfolio();
    
    // 2. Get account status & current positions
    const account = await alpacaClient.getAccount();
    const positions = await alpacaClient.getOpenPositions();

    const composerCapital = account.portfolioValue * COMPOSER_CAPITAL_ALLOCATION;
    logger.info(`[Composer Rebalancer] Total Portfolio: $${account.portfolioValue.toFixed(2)} | Composer Capital: $${composerCapital.toFixed(2)}`);

    // 3. Find current Composer ETF holdings
    const currentHoldings = {};
    for (const ticker of ALL_TICKERS) {
      currentHoldings[ticker] = { qty: 0, marketValue: 0 };
    }
    
    for (const pos of positions) {
      if (ALL_TICKERS.includes(pos.symbol)) {
        currentHoldings[pos.symbol] = {
          qty: pos.qty,
          marketValue: pos.marketValue
        };
      }
    }

    // 4. Calculate Buy/Sell orders required
    const orders = []; // { symbol, side, qty }
    
    // Process SELLs first to free up buying power
    for (const ticker of ALL_TICKERS) {
      const targetWeight = targetWeights[ticker] || 0.0;
      const targetValue = composerCapital * targetWeight;
      const currentValue = currentHoldings[ticker].marketValue;

      // Need current price to calculate fractional qty difference
      // We can approximate using currentValue / qty, or fetch latest quote.
      // If we hold it, we can calculate price:
      let currentPrice = 0;
      if (currentHoldings[ticker].qty > 0) {
        currentPrice = currentValue / currentHoldings[ticker].qty;
      } else if (targetWeight > 0) {
        // We don't hold it, need to fetch latest price from Alpaca
        const client = alpacaClient.getClient();
        const quote = await client.getLatestTrade(ticker);
        currentPrice = quote.Price;
      }

      if (currentPrice > 0) {
        const targetQty = targetValue / currentPrice;
        const currentQty = currentHoldings[ticker].qty;
        const deltaQty = targetQty - currentQty;

        // Threshold to avoid dust trading ($5 difference minimum)
        if (Math.abs(deltaQty * currentPrice) > 5.0) {
          if (deltaQty < 0) {
            // If targetQty is 0, just use alpaca.closePosition to avoid dust
            if (targetQty === 0) {
              logger.info(`[Composer Rebalancer] Liquidating ${ticker}`);
              await alpacaClient.closePosition(ticker);
            } else {
              orders.push({
                symbol: ticker,
                side: 'sell',
                // Alpaca supports fractional shares up to 4-9 decimals depending on symbol. Round to 4.
                qty: Math.abs(Math.floor(deltaQty * 10000) / 10000)
              });
            }
          }
        }
      }
    }

    // Execute SELLs
    for (const order of orders.filter(o => o.side === 'sell')) {
      await alpacaClient.submitOrder({
        symbol: order.symbol,
        qty: order.qty,
        side: order.side
      });
      await new Promise(r => setTimeout(r, 1000)); // sleep 1s between orders
    }

    // Calculate BUYs
    const buyOrders = [];
    for (const ticker of ALL_TICKERS) {
      const targetWeight = targetWeights[ticker] || 0.0;
      const targetValue = composerCapital * targetWeight;
      const currentValue = currentHoldings[ticker].marketValue;

      let currentPrice = 0;
      if (currentHoldings[ticker].qty > 0) {
        currentPrice = currentValue / currentHoldings[ticker].qty;
      } else if (targetWeight > 0) {
        const client = alpacaClient.getClient();
        const quote = await client.getLatestTrade(ticker);
        currentPrice = quote.Price;
      }

      if (currentPrice > 0) {
        const targetQty = targetValue / currentPrice;
        const currentQty = currentHoldings[ticker].qty;
        // If we just sold, currentQty in Alpaca is lower, but we already handled sells.
        // For buys, currentQty is the starting qty.
        const deltaQty = targetQty - currentQty;

        if (deltaQty > 0 && Math.abs(deltaQty * currentPrice) > 5.0) {
          buyOrders.push({
            symbol: ticker,
            side: 'buy',
            qty: Math.floor(deltaQty * 10000) / 10000
          });
        }
      }
    }

    // Execute BUYs
    for (const order of buyOrders) {
      await alpacaClient.submitOrder({
        symbol: order.symbol,
        qty: order.qty,
        side: order.side
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    logger.info('[Composer Rebalancer] Rebalance complete!');

  } catch (err) {
    logger.error('[Composer Rebalancer] Failed to rebalance', { error: err.message, stack: err.stack });
  }
}

module.exports = { rebalancePortfolio };
