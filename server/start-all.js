const { spawn } = require('child_process');
const path = require('path');
const logger = require('./utils/logger');

logger.info('🚀 Starting AI-Trader Master Intelligence Suite...');

// 1. Start the API Server & Dashboard
const server = spawn('node', [`"${path.join(__dirname, 'index.js')}"`], {
  stdio: 'inherit',
  shell: true
});

// 2. Start the Autonomous Scheduler
const scheduler = spawn('node', [`"${path.join(__dirname, 'autonomous', 'scheduler.js')}"`], {
  stdio: 'inherit',
  shell: true
});

server.on('error', (err) => logger.error('API Server failed', { error: err.message }));
scheduler.on('error', (err) => logger.error('Scheduler failed', { error: err.message }));

process.on('SIGINT', () => {
  logger.info('🛑 Shutting down AI-Trader...');
  server.kill();
  scheduler.kill();
  process.exit();
});
