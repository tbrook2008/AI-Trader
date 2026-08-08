require('dotenv').config();
const { startStream } = require('./loop');
const { monitorRisk } = require('./riskMonitor');
const { rebalancePortfolio } = require('../execution/portfolioRebalancer');
const { initDb }  = require('../db/schema');
const logger      = require('../utils/logger');
const cron        = require('node-cron');

async function start() {
  logger.info('🚀 AI Trader Event-Driven Stream starting');
  logger.info(`💰 Mode: ${(process.env.TRADING_MODE || 'paper').toUpperCase()}`);
  logger.info(`👁️  Watching: ${process.env.WATCHED_SYMBOLS || 'BTC/USD,ETH/USD,AAPL'}`);

  // Initialize DB on startup
  initDb();

  // Start the Alpaca WebSocket stream
  startStream();

  // 1-Minute Crypto Risk Monitor via simple interval instead of cron
  setInterval(async () => {
    try {
      await monitorRisk();
    } catch (err) {
      logger.error('Risk Monitor cycle error', { error: err.message });
    }
  }, 60000);

  // Daily Composer Portfolio Rebalancer
  // Runs at 3:50 PM ET (15:50) Monday-Friday
  // Note: Assuming server time is ET, otherwise we need to specify timezone
  cron.schedule('50 15 * * 1-5', async () => {
    logger.info('⏰ Triggering daily Composer Portfolio Rebalancer at 3:50 PM...');
    await rebalancePortfolio();
  }, {
    timezone: "America/New_York"
  });

  logger.info('Stream running. Press Ctrl+C to stop.');
}

// Graceful shutdown
process.on('SIGINT',  () => { logger.info('Stream stopped (SIGINT)');  process.exit(0); });
process.on('SIGTERM', () => { logger.info('Stream stopped (SIGTERM)'); process.exit(0); });

start();
