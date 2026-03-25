require('dotenv').config();
const cron   = require('node-cron');
const { runLoop } = require('./loop');
const { initDb }  = require('../db/schema');
const logger      = require('../utils/logger');

const SCHEDULE = process.env.CRON_SCHEDULE || '*/15 * * * *';

async function start() {
  logger.info('🚀 AI Trader Scheduler starting');
  logger.info(`📅 Schedule: ${SCHEDULE}`);
  logger.info(`💰 Mode: ${(process.env.TRADING_MODE || 'paper').toUpperCase()}`);
  logger.info(`👁️  Watching: ${process.env.WATCHED_SYMBOLS || 'AAPL,SPY'}`);

  // Initialize DB on startup
  initDb();

  // Run once immediately on startup
  logger.info('Running initial cycle...');
  await runLoop().catch(err => logger.error('Initial cycle error', { error: err.message }));

  // Schedule recurring cycles
  if (!cron.validate(SCHEDULE)) {
    logger.error('Invalid CRON_SCHEDULE — exiting', { schedule: SCHEDULE });
    process.exit(1);
  }

  cron.schedule(SCHEDULE, async () => {
    try {
      await runLoop();
    } catch (err) {
      // Never let scheduler crash
      logger.error('Scheduler cycle error', { error: err.message, stack: err.stack });
    }
  });

  logger.info('Scheduler running. Press Ctrl+C to stop.');
}

// Graceful shutdown
process.on('SIGINT',  () => { logger.info('Scheduler stopped (SIGINT)');  process.exit(0); });
process.on('SIGTERM', () => { logger.info('Scheduler stopped (SIGTERM)'); process.exit(0); });

start();
